import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import {
  deleteAlbumImages,
  MAX_ALBUM_SOURCE_BYTES,
  processAndStoreAlbumImage,
} from '../../utils/AlbumImageStorage';
import { FeishuBaseSyncService, FeishuRecord } from './FeishuBaseSyncService';

type AlbumSyncReport = {
  remoteRecords: number;
  published: number;
  downloaded: number;
  updated: number;
  hidden: number;
  deleted: number;
  failed: number;
};

const readLimitedStream = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.length;
    if (total > MAX_ALBUM_SOURCE_BYTES) {
      if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
      throw new Error('飞书相册附件超过 15 MiB');
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new Error('飞书相册附件为空');
  return Buffer.concat(chunks, total);
};

export class FeishuAlbumSyncService {
  private static inFlight: Promise<AlbumSyncReport> | null = null;

  public static syncAlbumsToLocal(): Promise<AlbumSyncReport> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private static async performSync(): Promise<AlbumSyncReport> {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.album) {
      throw new Error('飞书相册同步配置不完整');
    }

    const report: AlbumSyncReport = {
      remoteRecords: 0,
      published: 0,
      downloaded: 0,
      updated: 0,
      hidden: 0,
      deleted: 0,
      failed: 0,
    };

    const fieldResponse = await feishuClient.bitable.appTableField.list({
      path: {
        app_token: config.feishu.baseToken,
        table_id: config.feishu.tables.album,
      },
      params: { page_size: 100 },
    });
    if (fieldResponse.code !== 0) {
      throw new Error(`飞书相册字段读取失败 (${fieldResponse.code}: ${fieldResponse.msg})`);
    }
    const photoField = (fieldResponse.data?.items || []).find(field => field.field_name === 'Photo');
    if (!photoField?.field_id || photoField.ui_type !== 'Attachment') {
      throw new Error('飞书相册缺少 Attachment 类型的 Photo 字段');
    }

    const environmentRecords = await FeishuBaseSyncService.fetchAllRecords(config.feishu.tables.album);

    report.remoteRecords = environmentRecords.length;
    const remoteRecordIds = environmentRecords
      .map(record => record.record_id)
      .filter((recordId): recordId is string => Boolean(recordId));

    for (const record of environmentRecords) {
      const recordId = record.record_id;
      const fields = record.fields;
      if (!recordId || !fields || Object.keys(fields).length === 0) continue;

      const status = FeishuBaseSyncService.publishedStatus(fields.Status);
      const token = FeishuBaseSyncService.attachmentToken(fields.Photo);
      const title = (FeishuBaseSyncService.textValue(fields.Name) || '生活随拍').slice(0, 120);
      const caption = FeishuBaseSyncService.textValue(fields.Caption).slice(0, 500) || null;
      const sortOrderValue = Number(fields.Order);
      const sortOrder = Number.isSafeInteger(sortOrderValue) ? sortOrderValue : 0;
      const takenAt = FeishuBaseSyncService.dateValue(fields.TakenAt);
      const featured = fields.Featured === true;
      const tags = FeishuBaseSyncService.stringList(fields.Tags);
      const existing = await prisma.albumPhoto.findUnique({ where: { feishuRecordId: recordId } });

      if (status !== 'Published' || !token) {
        if (existing) {
          await prisma.albumPhoto.update({
            where: { feishuRecordId: recordId },
            data: {
              title,
              caption,
              sortOrder,
              takenAt,
              featured,
              tags,
              status: token ? status : 'Hidden',
              syncedAt: new Date(),
            },
          });
          report.hidden += 1;
        }
        continue;
      }

      report.published += 1;
      if (existing?.feishuFileToken === token) {
        await prisma.albumPhoto.update({
          where: { feishuRecordId: recordId },
          data: {
            title,
            caption,
            sortOrder,
            takenAt,
            featured,
            tags,
            status: 'Published',
            syncedAt: new Date(),
            deletedAt: null,
          },
        });
        report.updated += 1;
        continue;
      }

      try {
        const extra = JSON.stringify({
          bitablePerm: {
            tableId: config.feishu.tables.album,
            attachments: {
              [photoField.field_id]: { [recordId]: [token] },
            },
          },
        });
        const download = await feishuClient.drive.media.download({
          path: { file_token: token },
          params: { extra },
        });
        const source = await readLimitedStream(download.getReadableStream());
        const stored = await processAndStoreAlbumImage(source);

        try {
          await prisma.albumPhoto.upsert({
            where: { feishuRecordId: recordId },
            update: {
              feishuFileToken: token,
              title,
              caption,
              displayFileName: stored.displayFileName,
              thumbnailFileName: stored.thumbnailFileName,
              mimeType: stored.mimeType,
              width: stored.width,
              height: stored.height,
              fileSize: stored.fileSize,
              checksum: stored.checksum,
              sortOrder,
              takenAt,
              featured,
              tags,
              status: 'Published',
              syncedAt: new Date(),
              deletedAt: null,
            },
            create: {
              feishuRecordId: recordId,
              feishuFileToken: token,
              title,
              caption,
              displayFileName: stored.displayFileName,
              thumbnailFileName: stored.thumbnailFileName,
              mimeType: stored.mimeType,
              width: stored.width,
              height: stored.height,
              fileSize: stored.fileSize,
              checksum: stored.checksum,
              sortOrder,
              takenAt,
              featured,
              tags,
              status: 'Published',
              syncedAt: new Date(),
            },
          });
        } catch (error) {
          await deleteAlbumImages(stored.displayFileName, stored.thumbnailFileName);
          throw error;
        }

        if (existing) {
          await deleteAlbumImages(existing.displayFileName, existing.thumbnailFileName);
        }
        report.downloaded += 1;
      } catch (error) {
        report.failed += 1;
        console.error(`[AlbumSync] 相册记录 ${recordId} 同步失败:`, (error as Error).message);
      }
    }

    // === 清理已在飞书中物理删除或非当前环境的相册记录 ===
    // 修复 C4：若 remoteRecordIds 为空，notIn 被丢弃将导致全表被标记删除。
    // 同时，在未加 environment 字段前，直接全量 notIn 会导致误删另一环境的相册数据。
    // 因此这里安全起见，仅当我们明确知道需要删除哪些不在当前拉取列表的数据，且能隔离环境时才执行。
    // 这里我们先改为：仅当 remoteRecordIds 存在且有长度时，才进行“软删除不在列表中的项”？
    // 不行，若当前环境没有任何照片，remoteRecordIds 为空，会导致不清理。
    // 建议暂时注释掉自动清理，或者采用严格的 ID 前缀/环境过滤（当前表结构无环境字段）。
    /*
    const removed = await prisma.albumPhoto.updateMany({
      where: {
        feishuRecordId: remoteRecordIds.length > 0 ? { notIn: remoteRecordIds } : { notIn: ['dummy-to-prevent-delete-all'] },
        status: { not: 'Deleted' },
      },
      data: { status: 'Deleted', deletedAt: new Date(), syncedAt: new Date() },
    });
    report.deleted = removed.count;
    */
    report.deleted = 0;
    console.log(`[AlbumSync] 完成：远端 ${report.remoteRecords}，公开 ${report.published}，下载 ${report.downloaded}，失败 ${report.failed}`);
    return report;
  }
}
