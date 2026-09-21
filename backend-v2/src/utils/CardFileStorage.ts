import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import {
  cardOssDelete,
  cardOssHead,
  cardOssPut,
  cardOssReady,
} from '../core/CardOssClient';

export const SAFE_FILE_KEY_PATTERN = /^[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/;
// OSS 模式下 fileKey 为完整对象 key：禁止绝对路径、父目录段与控制字符。
export const OSS_FILE_KEY_PATTERN = /^(?!\/)(?!\.)[^\\\u0000-\u001f]{1,512}$/;

export const isSafeOssKey = (key: string): boolean => (
  OSS_FILE_KEY_PATTERN.test(key) && !key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')
);

export type StoredCardFile = {
  fileKey: string;
  fileName: string;
  mediaType: string;
  fileSize: number;
  checksum: string;
};

export type CardFileHandle =
  | { storage: 'local'; filePath: string; fileSize: number }
  | { storage: 'oss'; fileKey: string; fileSize: number; etag: string | null; versionId: string | null };

export type CardFileIdentity = {
  etag?: string | null;
  versionId?: string | null;
};

export class CardFileStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardFileStorageError';
  }
}

export const sanitizeCardFileName = (value: string): string => {
  const base = path.basename(value || 'download.bin')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (base || 'download.bin').slice(0, 180);
};

export const cardFileMediaType = (fileName: string): string => {
  const extension = path.extname(fileName).toLocaleLowerCase();
  const known: Record<string, string> = {
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain; charset=utf-8',
  };
  return known[extension] || 'application/octet-stream';
};

const fileKeyForName = (fileName: string): string => {
  const extension = path.extname(fileName).toLocaleLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  return `${randomUUID()}${safeExtension}`;
};

const useOss = (): boolean => cardOssReady();

const localPathFor = (fileKey: string): string => {
  const filePath = path.resolve(config.cardRedeem.fileDir, fileKey);
  if (path.dirname(filePath) !== path.resolve(config.cardRedeem.fileDir)) {
    throw new CardFileStorageError('文件存储路径无效');
  }
  return filePath;
};

// 落盘到临时文件以强制执行大小上限并计算 SHA256，随后上传 OSS、删除临时文件。
const storeToOss = async (
  stream: NodeJS.ReadableStream,
  fileKey: string,
): Promise<Omit<StoredCardFile, 'fileName' | 'mediaType'>> => {
  const tempPath = path.resolve(config.cardRedeem.fileDir, `.staging-${randomUUID()}`);
  await fsp.mkdir(config.cardRedeem.fileDir, { recursive: true, mode: 0o700 });
  const handle = await fsp.open(tempPath, 'wx', 0o600);
  const digest = createHash('sha256');
  let fileSize = 0;
  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      fileSize += chunk.length;
      if (fileSize > config.cardRedeem.maxFileBytes) {
        if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
        throw new CardFileStorageError(`文件不能超过 ${config.cardRedeem.maxFileBytes} 字节`);
      }
      digest.update(chunk);
      await handle.write(chunk);
    }
    if (fileSize === 0) throw new CardFileStorageError('文件内容为空');
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fsp.unlink(tempPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await cardOssPut(fileKey, fs.createReadStream(tempPath), 'application/octet-stream');
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => undefined);
    throw error;
  }
  await fsp.unlink(tempPath).catch(() => undefined);
  return {
    fileKey,
    fileSize,
    checksum: digest.digest('hex'),
  };
};

export const storeCardFile = async (
  stream: NodeJS.ReadableStream,
  originalFileName: string,
): Promise<StoredCardFile> => {
  const fileName = sanitizeCardFileName(originalFileName);
  const fileKey = useOss()
    ? `${config.cardRedeem.oss.keyPrefix}${fileKeyForName(fileName)}`
    : fileKeyForName(fileName);
  const mediaType = cardFileMediaType(fileName);

  if (useOss()) {
    const stored = await storeToOss(stream, fileKey);
    return { ...stored, fileName, mediaType };
  }

  const filePath = localPathFor(fileKey);
  const handle = await fsp.open(filePath, 'wx', 0o600);
  const digest = createHash('sha256');
  let fileSize = 0;
  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      fileSize += chunk.length;
      if (fileSize > config.cardRedeem.maxFileBytes) {
        if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
        throw new CardFileStorageError(`文件不能超过 ${config.cardRedeem.maxFileBytes} 字节`);
      }
      digest.update(chunk);
      await handle.write(chunk);
    }
    if (fileSize === 0) throw new CardFileStorageError('文件内容为空');
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fsp.unlink(filePath).catch(() => undefined);
    throw error;
  }
  await handle.close();

  return {
    fileKey,
    fileName,
    mediaType,
    fileSize,
    checksum: digest.digest('hex'),
  };
};

export const readCardFile = async (
  fileKey: string,
  expectedSize?: number | null,
  expectedIdentity: CardFileIdentity = {},
): Promise<CardFileHandle> => {
  if (useOss()) {
    if (!isSafeOssKey(fileKey)) throw new CardFileStorageError('文件标识无效');
    let meta;
    try {
      // Versioned buckets can keep serving the exact object that was bound at
      // issue time even when the key later points at a newer object.
      meta = await cardOssHead(fileKey, expectedIdentity.versionId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) throw new CardFileStorageError('文件不可用');
      throw error;
    }
    if (typeof expectedSize === 'number' && meta.size !== expectedSize) {
      throw new CardFileStorageError('文件大小校验失败');
    }
    if (expectedIdentity.etag && meta.etag !== expectedIdentity.etag) {
      throw new CardFileStorageError('文件版本校验失败');
    }
    return {
      storage: 'oss',
      fileKey,
      fileSize: meta.size,
      etag: meta.etag,
      versionId: meta.versionId,
    };
  }
  if (!SAFE_FILE_KEY_PATTERN.test(fileKey)) throw new CardFileStorageError('文件标识无效');
  const filePath = localPathFor(fileKey);
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CardFileStorageError('文件不可用');
  if (typeof expectedSize === 'number' && stat.size !== expectedSize) {
    throw new CardFileStorageError('文件大小校验失败');
  }
  return { storage: 'local', filePath, fileSize: stat.size };
};

export const deleteCardFile = async (fileKey: string | null | undefined): Promise<void> => {
  if (!fileKey) return;
  if (useOss()) {
    if (!isSafeOssKey(fileKey)) return;
    await cardOssDelete(fileKey).catch(error => {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 204 && status !== 200) throw error;
    });
    return;
  }
  if (!SAFE_FILE_KEY_PATTERN.test(fileKey)) return;
  const filePath = localPathFor(fileKey);
  await fsp.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
};
