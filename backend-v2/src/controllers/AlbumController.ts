import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { FeishuSyncService } from '../services/FeishuSyncService';
import { StaticSnapshotService } from '../services/static-snapshot/StaticSnapshotService';
import { StaticPublishControlService } from '../services/StaticPublishControlService';
import { readAlbumImage } from '../utils/AlbumImageStorage';

const positiveInteger = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export class AlbumController {
  public static async listPublished(req: Request, res: Response) {
    const page = positiveInteger(req.query.page, 1, 100_000);
    const limit = positiveInteger(req.query.limit, 24, 48);

    try {
      const where = { status: 'Published', deletedAt: null } as const;
      const [total, photos] = await prisma.$transaction([
        prisma.albumPhoto.count({ where }),
        prisma.albumPhoto.findMany({
          where,
          orderBy: [
            { featured: 'desc' },
            { sortOrder: 'asc' },
            { takenAt: 'desc' },
            { id: 'desc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            title: true,
            caption: true,
            width: true,
            height: true,
            sortOrder: true,
            takenAt: true,
            featured: true,
            tags: true,
            displayFileName: true,
            thumbnailFileName: true,
          },
        }),
      ]);

      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json({
        success: true,
        data: {
          items: photos.map(photo => ({
            id: String(photo.id),
            title: photo.title,
            caption: photo.caption || '',
            width: photo.width,
            height: photo.height,
            takenAt: photo.takenAt?.toISOString() || null,
            featured: photo.featured,
            tags: photo.tags,
            imageUrl: `/api/v1/albums/images/display/${photo.displayFileName}`,
            thumbnailUrl: `/api/v1/albums/images/thumbnail/${photo.thumbnailFileName}`,
          })),
          page,
          limit,
          total,
          hasMore: page * limit < total,
        },
      });
    } catch (error) {
      console.error('[Album] 读取公开相册失败:', error);
      return res.status(500).json({ success: false, message: '相册暂时无法读取' });
    }
  }

  public static async getImage(req: Request, res: Response) {
    const variant = req.params.variant;
    if (variant !== 'display' && variant !== 'thumbnail') {
      return res.status(404).send('Image not found');
    }

    try {
      const image = await readAlbumImage(variant, req.params.fileName as string);
      res.set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': image.mimeType,
        'Content-Length': image.buffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(image.buffer);
    } catch {
      return res.status(404).send('Image not found');
    }
  }

  public static async syncFromFeishu(req: Request, res: Response) {
    try {
      const report = await FeishuSyncService.syncAlbumsToLocal();
      const snapshot = await StaticSnapshotService.publishAfterFeishuSync();
      const publishRequested = Boolean(snapshot && StaticPublishControlService.isConfigured());
      if (snapshot && publishRequested) {
        await StaticPublishControlService.requestPublish(snapshot, req.user?.username || 'admin');
      }
      await prisma.auditLog.create({
        data: {
          ip: req.ip || 'unknown',
          action: 'ALBUM_SYNC_TRIGGERED',
          details: `管理员手动同步飞书相册，远端 ${report.remoteRecords} 条，下载 ${report.downloaded} 张，失败 ${report.failed} 张`,
        },
      });
      return res.json({ success: true, data: { report, snapshot, publishRequested } });
    } catch (error) {
      console.error('[Album] 手动同步失败:', error);
      return res.status(500).json({ success: false, message: '飞书相册同步失败' });
    }
  }
}
