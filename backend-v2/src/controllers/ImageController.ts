import { Request, Response } from 'express';
import { feishuClient } from '../core/FeishuClient';
import { ossClient } from '../core/OssClient';
import { config } from '../config';
import { prisma } from '../core/Database';
import { createHash, randomUUID } from 'crypto';
import { detectSupportedImageType } from '../utils/ImageFileUtils';
import {
  MAX_LOCAL_IMAGE_BYTES,
  LocalImageStorageError,
  readLocalImage,
  saveLocalImage,
} from '../utils/LocalImageStorage';

const MAX_FEISHU_IMAGE_BYTES = 10 * 1024 * 1024;
const FEISHU_IMAGE_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

const toImageBuffer = (value: unknown): Buffer | null => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value === 'object' && 'data' in value) {
    return toImageBuffer((value as { data: unknown }).data);
  }
  return null;
};

const imageReference = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 12);

export class ImageController {
  public static async getUploadedImage(req: Request, res: Response) {
    try {
      const image = await readLocalImage(req.params.fileName as string);
      res.set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': image.mimeType,
        'Content-Length': image.buffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(image.buffer);
    } catch (error) {
      // Invalid names, missing files, symlinks and corrupted files all look the
      // same externally so this endpoint never leaks filesystem details.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[Upload] Rejected local image read:', (error as Error).message);
      }
      return res.status(404).send('Image not found');
    }
  }

  public static async handleGet0(req: Request, res: Response) {
  const imageToken = req.params.imageToken as string;
  if (!FEISHU_IMAGE_TOKEN.test(imageToken)) {
    return res.status(404).send('Image not found');
  }
  const reference = imageReference(imageToken);

  if (!feishuClient) {
    return res.status(500).send('Feishu client not initialized');
  }

  // Check if we have CDN domain configured and we are instructed to redirect
  // We can redirect the frontend to the CDN URL directly if the image is already in OSS
  const isPrivateArticleAsset = res.locals.privateArticleAsset === true;
  const isOssEnabled = ossClient.isConfigured && !isPrivateArticleAsset;

  if (isOssEnabled) {
    try {
      const cache = await prisma.imageCache.findUnique({ where: { token: imageToken } });
      if (cache && cache.ossUrl) {
        // 如果数据库中有 OSS URL，直接 302 重定向到 CDN
        return res.redirect(302, cache.ossUrl);
      }
    } catch (e) {
      console.warn(`[OSS] DB lookup failed for image ${reference}, falling back to Feishu fetch.`);
    }
  }

  try {
    // 飞书 node-sdk 的 request 接口在 responseType 为 arraybuffer 时，
    // 会直接返回 Buffer 对象，而不是包含 data 属性的对象。
    const response = await feishuClient.request({
      method: 'GET',
      url: `https://open.feishu.cn/open-apis/drive/v1/medias/${imageToken}/download`,
      responseType: 'arraybuffer',
      timeout: 15_000,
      maxContentLength: MAX_FEISHU_IMAGE_BYTES,
      maxBodyLength: MAX_FEISHU_IMAGE_BYTES,
    });
    const imageBuffer = toImageBuffer(response);
    if (!imageBuffer || imageBuffer.length <= 0 || imageBuffer.length > MAX_FEISHU_IMAGE_BYTES) {
      throw new Error('飞书图片响应大小无效');
    }
    const detectedType = detectSupportedImageType(imageBuffer);
    if (!detectedType) throw new Error('飞书图片响应签名无效');

    // 设置缓存头，让浏览器缓存图片 30 天，减少服务器压力。
    res.set({
      'Cache-Control': isPrivateArticleAsset ? 'private, no-store, max-age=0' : 'public, max-age=2592000',
      'Content-Type': detectedType.mimeType,
      'Content-Length': imageBuffer.length.toString(),
      'X-Content-Type-Options': 'nosniff',
    });

    // ==========================================
    // 异步将图片上传到 OSS 并记录到数据库
    // ==========================================
    if (isOssEnabled) {
      const objectName = `images/${imageToken}.${detectedType.extension}`;
      // 不阻塞前端请求，后台异步上传到 OSS
      ossClient.uploadBuffer(objectName, imageBuffer, detectedType.mimeType).then(async (cdnUrl) => {
        if (cdnUrl) {
          console.log(`[OSS] Image ${reference} uploaded successfully.`);
          try {
            await prisma.imageCache.upsert({
              where: { token: imageToken },
              update: { ossUrl: cdnUrl },
              create: { token: imageToken, ossUrl: cdnUrl }
            });
          } catch (e) {
            console.error(`[OSS] Failed to save DB cache for image ${reference}`, e);
          }
        }
      });
    }

    // 将二进制流直接返回给前端
    res.send(imageBuffer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(`[Feishu] 获取图片 ${reference} 失败:`, error.message || error);
    res.status(404).send('Image not found');
  }
  }

  // 为第三方编辑器（如 PicGo, Typora）提供图片上传 API
  public static async uploadImage(req: Request, res: Response) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
      const buffer = req.file.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length > MAX_LOCAL_IMAGE_BYTES) {
        return res.status(413).json({
          success: false,
          message: '图片不能超过 5 MiB',
        });
      }
      const detectedType = detectSupportedImageType(buffer);

      if (!detectedType) {
        return res.status(415).json({
          success: false,
          message: '文件内容不是受支持的有效图片',
        });
      }

      // 文件名、扩展名和 Content-Type 均由服务端生成/检测，避免信任客户端输入。
      const fileName = `${randomUUID()}.${detectedType.extension}`;

      // 如果配置了 OSS，则上传到 OSS
      if (ossClient.isConfigured) {
        const objectName = `uploads/${fileName}`;
        const cdnUrl = await ossClient.uploadBuffer(objectName, buffer, detectedType.mimeType);

        if (cdnUrl) {
          // 返回 PicGo / Typora 兼容的格式
          return res.json({
            success: true,
            url: cdnUrl,
            contentType: detectedType.mimeType,
            message: 'Uploaded to OSS'
          });
        }
      }

      // OSS 未启用或上传失败时使用后端持久卷。本地文件在完全
      // 写入并验签后才会原子切换为可访问状态。
      await saveLocalImage(buffer, fileName);
      const localUrl = `${config.backendUrl}/api/v1/image/uploads/${fileName}`;
      return res.json({
        success: true,
        url: localUrl,
        contentType: detectedType.mimeType,
        message: 'Uploaded to local storage',
      });

    } catch (error) {
      console.error('[Upload] Image upload failed:', error);
      if (error instanceof LocalImageStorageError && error.code === 'QUOTA_EXCEEDED') {
        return res.status(507).json({ success: false, message: '图片存储空间已达到安全上限' });
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

}
