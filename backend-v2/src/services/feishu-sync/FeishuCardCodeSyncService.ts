import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import {
  readCardFile,
  storeCardFile,
  type StoredCardFile,
} from '../../utils/CardFileStorage';
import { cardCodeDigest, normalizeCardCode, validateCardCode } from '../../utils/CardRedeem';
import { withCurrentFeishuEnvironment } from '../../utils/FeishuEnvironment';
import { maskIpForAudit } from '../../utils/ArticleAccess';
import { FeishuBaseSyncService } from './FeishuBaseSyncService';

type FeishuAttachment = { token: string; name: string };

const boundedText = (value: unknown, maxLength: number): string => (
  FeishuBaseSyncService.textValue(value).slice(0, maxLength)
);

export const attachmentValue = (value: unknown): FeishuAttachment | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entry = value[0];
  if (!entry || typeof entry !== 'object') return null;
  const item = entry as Record<string, unknown>;
  const token = typeof item.file_token === 'string' ? item.file_token : '';
  const name = typeof item.name === 'string' ? item.name : 'download.bin';
  return /^[A-Za-z0-9_-]{1,256}$/.test(token) ? { token, name } : null;
};

const writeFeishuStatus = async (recordId: string, fields: Record<string, unknown>): Promise<void> => {
  if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.cardCodes) return;
  await feishuClient.bitable.appTableRecord.update({
    path: {
      app_token: config.feishu.baseToken,
      table_id: config.feishu.tables.cardCodes,
      record_id: recordId,
    },
    data: { fields: withCurrentFeishuEnvironment(fields) as any },
  });
};

export const downloadAttachment = async (
  recordId: string,
  fieldId: string,
  attachment: FeishuAttachment,
): Promise<StoredCardFile> => {
  if (!feishuClient) throw new Error('飞书客户端未配置');
  const extra = JSON.stringify({
    bitablePerm: {
      tableId: config.feishu.tables.cardCodes,
      attachments: { [fieldId]: { [recordId]: [attachment.token] } },
    },
  });
  const download = await feishuClient.drive.media.download({
    path: { file_token: attachment.token },
    params: { extra },
  });
  return storeCardFile(download.getReadableStream(), attachment.name);
};

type CardSyncReport = { imported: number; updated: number; revoked: number; skipped: boolean };

export class FeishuCardCodeSyncService {
  private static inFlight: Promise<CardSyncReport> | null = null;

  public static syncToLocal(): Promise<CardSyncReport> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private static async performSync(): Promise<CardSyncReport> {
    // 默认关闭：卡密数据不经过飞书以减少暴露面，显式 CARD_REDEEM_FEISHU_SYNC=true 才启用。
    if (!config.cardRedeem.feishuSyncEnabled) {
      return { imported: 0, updated: 0, revoked: 0, skipped: true };
    }
    if (!config.cardRedeem.enabled || !config.feishu.tables.cardCodes) {
      return { imported: 0, updated: 0, revoked: 0, skipped: true };
    }
    if (!feishuClient || !config.feishu.baseToken) throw new Error('飞书卡密同步配置不完整');
    if (config.cardRedeem.secret.length < 32) throw new Error('CARD_REDEEM_SECRET 必须至少 32 个字符');
    if (config.cardRedeem.previousSecrets.some(secret => secret.length < 32)) {
      throw new Error('CARD_REDEEM_PREVIOUS_SECRETS 中的密钥必须至少 32 个字符');
    }

    const fieldResponse = await feishuClient.bitable.appTableField.list({
      path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.cardCodes },
      params: { page_size: 100 },
    });
    if (fieldResponse.code !== 0) {
      throw new Error(`飞书卡密字段读取失败 (${fieldResponse.code}: ${fieldResponse.msg})`);
    }
    const fileField = (fieldResponse.data?.items || []).find(field => field.field_name === 'File');
    if (!fileField?.field_id || fileField.ui_type !== 'Attachment') {
      throw new Error('飞书 CardCodes 表缺少 Attachment 类型的 File 字段');
    }

    // Any read failure throws before the revocation pass, so already-cached
    // private files remain usable when Feishu is temporarily unreachable.
    const records = await FeishuBaseSyncService.fetchAllRecords(config.feishu.tables.cardCodes);
    const seenRecordIds: string[] = [];
    let imported = 0;
    let updated = 0;

    for (const record of records) {
      const recordId = record.record_id || '';
      const fields = record.fields || {};
      if (!recordId) continue;
      seenRecordIds.push(recordId);

      const existing = await prisma.cardCode.findUnique({ where: { feishuRecordId: recordId } });
      const requestedStatus = boundedText(fields.Status, 24).toLocaleLowerCase();

      // 台账记录已关联本地卡：镜像本地状态（核销时间等台账信息以本地为准），
      // 不要求附件、不重复导入。飞书侧把 Active 改为撤销仍然生效（封禁）。
      if (existing) {
        if (existing.status === 'active' && (requestedStatus === 'revoked' || requestedStatus === '已撤销')) {
          const revoked = await prisma.cardCode.updateMany({
            where: { id: existing.id, status: 'active', usedAt: null },
            data: { status: 'revoked' },
          });
          if (revoked.count === 1) {
            await writeFeishuStatus(recordId, { Status: 'Revoked', SyncMessage: '已在飞书撤销本地卡密' });
          }
          continue;
        }
        const statusMap: Record<string, string> = {
          active: 'Active', used: 'Used', revoked: 'Revoked', expired: 'Expired', error: 'Error',
        };
        const statusAliases: Record<string, string> = { '已使用': 'used', '已撤销': 'revoked', '已过期': 'expired' };
        const effectiveStatus = statusAliases[requestedStatus] || requestedStatus;
        if (effectiveStatus !== existing.status) {
          await writeFeishuStatus(recordId, {
            Status: statusMap[existing.status] || 'Active',
            ...(existing.status === 'used' && existing.usedAt ? { UsedAt: existing.usedAt.getTime() } : {}),
            SyncMessage: '已按本地卡密状态同步',
          });
        }
        continue;
      }

      const productName = boundedText(fields.ProductName || fields.Name, 120);
      const productKey = boundedText(fields.ProductKey, 80) || null;
      const salesChannel = boundedText(fields.SalesChannel, 80) || 'external';
      const orderReference = boundedText(fields.OrderReference, 160) || null;
      const expiresAt = FeishuBaseSyncService.dateValue(fields.ExpiresAt);
      const attachment = attachmentValue(fields.File);
      const code = normalizeCardCode(fields.CodeInput);

      // 对账关联：台账里的卡密已在本地存在（如工作台直发），回填 feishuRecordId、
      // 清空明文并回写状态；不需要附件，也不再重复导入。
      if (code) {
        let localCard = null;
        for (const secret of [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]) {
          const localDigest = cardCodeDigest(secret, config.feishu.dataEnvironment, code);
          localCard = await prisma.cardCode.findUnique({
            where: { environment_codeDigest: { environment: config.feishu.dataEnvironment, codeDigest: localDigest } },
          });
          if (localCard) break;
        }
        if (localCard) {
          if (!localCard.feishuRecordId) {
            await prisma.cardCode.update({ where: { id: localCard.id }, data: { feishuRecordId: recordId } });
          }
          const statusMap: Record<string, string> = {
            active: 'Active', used: 'Used', revoked: 'Revoked', expired: 'Expired', error: 'Error',
          };
          await writeFeishuStatus(recordId, {
            CodeInput: '',
            Status: statusMap[localCard.status] || 'Active',
            CodeHint: localCard.codeHint,
            ...(localCard.status === 'used' && localCard.usedAt ? { UsedAt: localCard.usedAt.getTime() } : {}),
            SyncMessage: '已关联本地卡密（本地直发）',
          });
          continue;
        }
      }

      if (!productName || !attachment) {
        await writeFeishuStatus(recordId, {
          Status: 'Error',
          SyncMessage: !productName ? '请填写 ProductName' : '请在 File 字段上传一个文件或压缩包',
        });
        continue;
      }
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        await writeFeishuStatus(recordId, { CodeInput: '', Status: 'Expired', SyncMessage: '卡密已过期' });
        continue;
      }

      const codeError = code ? validateCardCode(code) : '请填写 CodeInput';
      if (codeError) {
        await writeFeishuStatus(recordId, { Status: 'Error', SyncMessage: codeError });
        continue;
      }

      let codeDigest = '';
      let codeHash = '';
      let codeHint = '';
      if (code) {
        codeDigest = cardCodeDigest(config.cardRedeem.secret, config.feishu.dataEnvironment, code);
        const candidateDigests = [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]
          .map(secret => cardCodeDigest(secret, config.feishu.dataEnvironment, code));
        const duplicate = await prisma.cardCode.findFirst({
          where: {
            environment: config.feishu.dataEnvironment,
            codeDigest: { in: candidateDigests },
            NOT: { feishuRecordId: recordId },
          },
        });
        if (duplicate) {
          await writeFeishuStatus(recordId, {
            CodeInput: '',
            Status: 'Error',
            SyncMessage: '该卡密已经存在，请生成新卡密',
          });
          continue;
        }
        codeHash = await bcrypt.hash(code, 10);
        codeHint = code.slice(-4);
      }

      let fileData: {
        fileKey: string;
        fileName: string;
        fileMediaType: string;
        fileSize: number;
        fileChecksum: string;
        feishuFileToken: string | null;
      };
      {
        const stored = await downloadAttachment(recordId, fileField.field_id, attachment);
        fileData = {
          fileKey: stored.fileKey,
          fileName: stored.fileName,
          fileMediaType: stored.mediaType,
          fileSize: stored.fileSize,
          fileChecksum: stored.checksum,
          feishuFileToken: attachment?.token ?? null,
        };
      }

      await prisma.cardCode.create({
        data: {
          feishuRecordId: recordId,
          environment: config.feishu.dataEnvironment,
          source: 'feishu',
          productKey,
          productName,
          codeDigest,
          codeHash,
          codeHint,
          ...fileData,
          salesChannel,
          orderReference,
          expiresAt,
          status: 'active',
        },
      });
      imported += 1;

      await writeFeishuStatus(recordId, {
        ...(code ? { CodeInput: '' } : {}),
        Status: 'Active',
        CodeHint: codeHint,
        SyncMessage: '文件已同步到本地私有缓存',
      });
    }

    // 数据库是生命周期和审计的唯一真相源。飞书导入卡在台账删除后只撤销，
    // 工作台直发卡则解除台账关联；任何情况都不物理删除核销历史。
    const missing = await prisma.cardCode.findMany({
      where: {
        environment: config.feishu.dataEnvironment,
        feishuRecordId: { not: null },
        ...(seenRecordIds.length > 0 ? { feishuRecordId: { notIn: seenRecordIds } } : {}),
      },
      select: { id: true, source: true, status: true },
    });
    const importedActiveIds = missing
      .filter(item => item.source === 'feishu' && item.status === 'active')
      .map(item => item.id);
    const localIssuedIds = missing
      .filter(item => item.source !== 'feishu')
      .map(item => item.id);
    const [revoked] = await prisma.$transaction([
      prisma.cardCode.updateMany({
        where: { id: { in: importedActiveIds }, status: 'active', usedAt: null },
        data: { status: 'revoked' },
      }),
      prisma.cardCode.updateMany({
        where: { id: { in: localIssuedIds } },
        data: { feishuRecordId: null },
      }),
    ]);
    if (missing.length > 0) {
      console.log(`[CardSync] 台账缺失 ${missing.length} 条：撤销导入卡 ${revoked.count} 条，解除直发卡关联 ${localIssuedIds.length} 条`);
    }

    return { imported, updated, revoked: revoked.count, skipped: false };
  }

  public static async reportUsed(recordId: string, usedAt: Date, ip: string): Promise<void> {
    if (!config.cardRedeem.feishuSyncEnabled) return;
    try {
      await writeFeishuStatus(recordId, {
        Status: 'Used',
        UsedAt: usedAt.getTime(),
        UsedIP: maskIpForAudit(ip),
        SyncMessage: '卡密已核销',
      });
    } catch (error) {
      console.error('[CardRedeem] 回写飞书核销状态失败:', error);
    }
  }

  /** GC 过期后回写飞书台账（仅限已关联台账记录的卡）。 */
  public static async reportExpiredToFeishu(recordId: string): Promise<void> {
    if (!config.cardRedeem.feishuSyncEnabled) return;
    await writeFeishuStatus(recordId, {
      Status: 'Expired',
      SyncMessage: '卡密已过有效期',
    });
  }

  /** 文件删除导致卡密作废时，立即回写飞书台账。 */
  public static async reportRevokedToFeishu(recordId: string): Promise<void> {
    if (!config.cardRedeem.feishuSyncEnabled) return;
    await writeFeishuStatus(recordId, {
      Status: 'Revoked',
      SyncMessage: '绑定文件已删除，卡密作废',
    });
  }
}
