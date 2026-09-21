import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../core/Database';
import { cacheService } from '../services/CacheService';
import { StaticSnapshotService } from '../services/static-snapshot/StaticSnapshotService';
import {
  LocalFontStorageError,
  MAX_LOCAL_FONT_BYTES,
  readLocalFont,
  removeLocalFont,
  saveLocalFont,
  type SupportedFontType,
} from '../utils/LocalFontStorage';

const FONT_PATH = /^\/api\/v1\/fonts\/([0-9a-f-]{36}\.(?:ttf|woff|woff2))$/;

const typeForUploadedFile = (fileName: string): SupportedFontType['extension'] | null => {
  const match = fileName.toLowerCase().match(/\.(ttf|woff|woff2)$/);
  return match ? match[1] as SupportedFontType['extension'] : null;
};

export class FontController {
  public static async getFont(req: Request, res: Response) {
    try {
      const font = await readLocalFont(req.params.fileName as string);
      res.set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': font.type.mimeType,
        'Content-Length': font.buffer.byteLength.toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(font.buffer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[Font] Rejected local font read:', (error as Error).message);
      }
      return res.status(404).send('Font not found');
    }
  }

  public static async uploadFont(req: Request, res: Response) {
    if (!req.file) return res.status(400).json({ success: false, message: '请选择字体文件' });
    const extension = typeForUploadedFile(req.file.originalname);
    if (!extension) {
      return res.status(415).json({ success: false, message: '仅支持 .ttf、.woff 或 .woff2 字体文件' });
    }
    if (!Buffer.isBuffer(req.file.buffer) || req.file.buffer.length > MAX_LOCAL_FONT_BYTES) {
      return res.status(413).json({ success: false, message: '字体文件不能超过 10 MiB' });
    }

    try {
      const previous = await prisma.systemConfig.findUnique({ where: { key: 'custom_font_url' } });
      const saved = await saveLocalFont(req.file.buffer, extension);
      const fontUrl = `/api/v1/fonts/${saved.fileName}`;
      const fontHash = createHash('sha256').update(saved.fileName).digest('hex').slice(0, 12);
      try {
        await prisma.systemConfig.upsert({
          where: { key: 'custom_font_url' },
          update: { value: fontUrl, isSecret: false },
          create: { key: 'custom_font_url', value: fontUrl, isSecret: false },
        });
      } catch (error) {
        await removeLocalFont(saved.fileName).catch(() => undefined);
        throw error;
      }

      const previousMatch = previous?.value.match(FONT_PATH);
      if (previousMatch && previousMatch[1] !== saved.fileName) {
        await removeLocalFont(previousMatch[1]).catch(() => undefined);
      }
      cacheService.configCache = { ...(cacheService.configCache || {}), custom_font_url: fontUrl };
      if (cacheService.postsCache?.config && typeof cacheService.postsCache.config === 'object') {
        cacheService.postsCache.config = { ...cacheService.postsCache.config, custom_font_url: fontUrl };
      }

      void StaticSnapshotService.publishAfterFeishuSync().catch(error => {
        console.warn('[Font] Static snapshot refresh failed:', (error as Error).message);
      });

      return res.json({
        success: true,
        message: '字体已保存，动态站刷新后生效；静态站快照已排队更新。',
        data: { url: fontUrl, format: saved.type.extension, version: fontHash },
      });
    } catch (error) {
      const status = error instanceof LocalFontStorageError && error.code === 'TOO_LARGE' ? 413 : 500;
      console.error('[Font] Upload failed:', error);
      return res.status(status).json({ success: false, message: '字体保存失败' });
    }
  }
}
