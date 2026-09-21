import { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CardOssSettingsService, type CardOssSettings } from '../services/CardOssSettingsService';
import { cardOssSettings as cardOssSettingsGet, cardOssMultipartPut, cardOssHead, cardOssDelete, cardOssReady } from '../core/CardOssClient';
import { sanitizeCardFileName } from '../utils/CardFileStorage';
import { config } from '../config';
import { prisma } from '../core/Database';
import { FeishuCardCodeSyncService } from '../services/feishu-sync/FeishuCardCodeSyncService';
import { auditTrail } from '../utils/AuditTrail';

/**
 * 对象存储连接配置的管理接口（配合发卡中心 App 的设置页）。
 * 保存后立即生效（重建 OSS 客户端），并持久化到 cache_data/card-oss-config.json。
 */
export class CardOssConfigController {
  public static async get(_req: Request, res: Response) {
    return res.json({ success: true, config: maskSecret(CardOssSettingsService.get()) });
  }

  public static async save(req: Request, res: Response) {
    try {
      const body = req.body ?? {};
      const patch: Partial<CardOssSettings> = {};
      for (const key of ['endpoint', 'accessKeyId', 'accessKeySecret', 'bucket', 'keyPrefix', 'publicEndpoint', 'region'] as const) {
        if (typeof body[key] === 'string' && !(key === 'accessKeySecret' && body[key] === MASKED_SECRET)) {
          patch[key] = body[key];
        }
      }
      if (body.presignTtlSeconds !== undefined) patch.presignTtlSeconds = Number(body.presignTtlSeconds);
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.pathStyle === 'boolean') patch.pathStyle = body.pathStyle;

      const settings = await CardOssSettingsService.save(patch);
      auditTrail(req, 'CARD_OSS_CONFIG_UPDATE', `管理员更新了卡密对象存储配置（bucket: ${settings.bucket || '-'}，${settings.enabled ? '已启用' : '已停用'}，密钥不落审计）`);
      return res.json({ success: true, config: maskSecret(settings) });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '保存失败',
      });
    }
  }

  public static async test(_req: Request, res: Response) {
    try {
      const result = await CardOssSettingsService.test();
      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : '连接失败',
      });
    }
  }
}

const MASKED_SECRET = '********';

function maskSecret(settings: CardOssSettings): CardOssSettings {
  return {
    ...settings,
    accessKeySecret: settings.accessKeySecret ? MASKED_SECRET : '',
  };
}

// multipart 上传依赖（与 FontController 同款模式）
import multer from 'multer';
import { isSafeOssKey } from '../utils/CardFileStorage';

// 磁盘暂存（而非内存）：大文件上传不能整份缓冲进 RAM，否则容器会被 OOM 杀死
const ossUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp',
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}`),
  }),
  limits: { fileSize: config.cardRedeem.maxFileBytes, files: 1, fields: 2 },
});

export const ossUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  ossUpload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `文件不能超过 ${config.cardRedeem.maxFileBytes} 字节`,
      });
    }
    return res.status(400).json({ success: false, message: '上传请求格式无效' });
  });
};

// 转存进度表：uploadId → OSS 转存进度（App 上传完成后轮询此表拼接统一进度条）
const uploadProgressMap = new Map<string, {
  size: number;
  transferred: number;
  done: boolean;
  key?: string;
  ts: number;
}>();

function pruneProgressMap() {
  const now = Date.now();
  for (const [id, entry] of uploadProgressMap) {
    if (entry.done && now - entry.ts > 5 * 60 * 1000) uploadProgressMap.delete(id);
    else if (now - entry.ts > 15 * 60 * 1000) uploadProgressMap.delete(id);
  }
}

/** 上传交付文件到私有桶（key 自动生成：keyPrefix + uuid.ext）。 */
export async function uploadObject(req: Request, res: Response) {
  let temporaryPath: string | null = null;
  try {
    if (!cardOssReady()) return res.status(503).json({ success: false, message: '对象存储未启用' });
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ success: false, message: '缺少文件' });
    temporaryPath = file.path;
    const prefix = cardOssSettingsGet().keyPrefix;
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.slice(0, 64) : randomUUID();

    // curl/部分客户端以 UTF-8 原始字节发送 filename，而 multipart 头默认按 Latin-1 解析，
    // 这里把字节还原为 UTF-8 文本（纯 ASCII 名不受影响），否则中文文件名会变乱码
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // 对象 key 使用原始文件名（可读），重名时追加短随机后缀
    const safeName = sanitizeCardFileName(originalName);
    let key = `${prefix}${safeName}`;
    if (await objectExists(key)) {
      const ext = path.extname(safeName);
      const stem = safeName.slice(0, safeName.length - ext.length) || 'file';
      key = `${prefix}${stem}-${randomUUID().slice(0, 8)}${ext}`;
    }

    // 注册转存进度，供 App 轮询拼接统一进度条
    const entry = { size: file.size, transferred: 0, done: false, key: undefined as string | undefined, ts: Date.now() };
    uploadProgressMap.set(uploadId, entry);
    pruneProgressMap();

    try {
      // 分片流式转存到 OSS（低内存），进度写入 entry
      await cardOssMultipartPut(key, file.path, fraction => {
        entry.transferred = Math.round(fraction * entry.size);
      });
      entry.done = true;
      entry.key = key;
      entry.ts = Date.now();
    } catch (error) {
      uploadProgressMap.delete(uploadId);
      await fsp.unlink(file.path).catch(() => undefined); // 清理暂存文件
      throw error;
    }
    const meta = await cardOssHead(key);
    return res.json({ success: true, key: meta.key, size: meta.size, fileName: originalName, uploadId });
  } catch (error) {
    console.error('[CardOss] 上传失败:', error);
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '上传失败' });
  } finally {
    if (temporaryPath) await fsp.unlink(temporaryPath).catch(() => undefined);
  }
}

/** 删除桶内对象；若仍有卡密绑定则返回引用数供前端二次确认。 */
export async function deleteObject(req: Request, res: Response) {
  try {
    if (!cardOssReady()) return res.status(503).json({ success: false, message: '对象存储未启用' });
    const key = String(req.query.key || '');
    if (!isSafeOssKey(key)) return res.status(400).json({ success: false, message: '对象 key 不合法' });
    // 删除文件的同时，自动作废所有绑定此文件的活跃卡密（本地置 revoked，
    // 已关联飞书台账的记录由同步服务回写 Revoked 状态）。
    const boundLive = await prisma.cardCode.findMany({
      where: { environment: config.feishu.dataEnvironment, fileKey: key, status: { in: ['active', 'used'] } },
      select: { id: true, feishuRecordId: true, fileVersionId: true },
    });
    const referencedBy = await prisma.cardCode.count({
      where: { environment: config.feishu.dataEnvironment, fileKey: key },
    });
    // A version-pinned presigned URL survives a plain DeleteObject marker.
    // Remove every bound immutable version first, then the current key.
    for (const versionId of new Set(boundLive.map(card => card.fileVersionId).filter(Boolean))) {
      await cardOssDelete(key, versionId);
    }
    await cardOssDelete(key);
    if (boundLive.length > 0) {
      await prisma.cardCode.updateMany({
        where: { id: { in: boundLive.map(item => item.id) }, status: { in: ['active', 'used'] } },
        data: { status: 'revoked' },
      });
      // 已关联飞书台账的记录立即回写 Revoked，不等 60 秒同步
      for (const card of boundLive) {
        if (card.feishuRecordId) {
          void FeishuCardCodeSyncService.reportRevokedToFeishu(card.feishuRecordId).catch(
            error => console.error('[CardOss] 回写飞书撤销状态失败:', error),
          );
        }
      }
    }
    return res.json({ success: true, deleted: key, referencedBy, revoked: boundLive.length });
  } catch (error) {
    console.error('[CardOss] 删除对象失败:', error);
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '删除失败' });
  }
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await cardOssHead(key);
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) return false;
    throw error;
  }
}

/** 查询转存进度（App 上传完成后轮询，拼接统一进度条）。 */
export function uploadProgress(req: Request, res: Response) {
  pruneProgressMap();
  const id = String(req.query.id || '');
  const entry = uploadProgressMap.get(id);
  if (!entry) return res.json({ success: true, size: 0, transferred: 0, done: true });
  return res.json({
    success: true,
    size: entry.size,
    transferred: entry.transferred,
    done: entry.done,
    key: entry.key ?? null,
  });
}
