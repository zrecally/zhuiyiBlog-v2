import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { detectSupportedImageType } from './ImageFileUtils';
import {
  isAllowedLocalImageFileName,
  readLocalImage,
  saveLocalImage,
  type LocalImageStorageLimits,
} from './LocalImageStorage';
import { feishuEnvironmentCacheSegment } from './FeishuEnvironment';

const albumEnvironmentSegment = feishuEnvironmentCacheSegment();
export const ALBUM_ROOT_DIR = path.resolve(
  process.cwd(),
  'cache_data/albums',
  albumEnvironmentSegment,
);
export const ALBUM_DISPLAY_DIR = path.join(ALBUM_ROOT_DIR, 'display');
export const ALBUM_THUMBNAIL_DIR = path.join(ALBUM_ROOT_DIR, 'thumbnails');

const positiveIntegerFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_ALBUM_SOURCE_BYTES = positiveIntegerFromEnv(
  'ALBUM_MAX_SOURCE_BYTES',
  15 * 1024 * 1024,
);

const MAX_ALBUM_INPUT_PIXELS = positiveIntegerFromEnv('ALBUM_MAX_INPUT_PIXELS', 40_000_000);

const sharedLimits = {
  maxFiles: positiveIntegerFromEnv('ALBUM_MAX_FILES', 6000),
  minFreeBytes: positiveIntegerFromEnv('ALBUM_MIN_FREE_BYTES', 8 * 1024 * 1024 * 1024),
};

const displayLimits: LocalImageStorageLimits = {
  ...sharedLimits,
  maxTotalBytes: positiveIntegerFromEnv('ALBUM_DISPLAY_MAX_TOTAL_BYTES', 8 * 1024 * 1024 * 1024),
};

const thumbnailLimits: LocalImageStorageLimits = {
  ...sharedLimits,
  maxTotalBytes: positiveIntegerFromEnv('ALBUM_THUMBNAIL_MAX_TOTAL_BYTES', 2 * 1024 * 1024 * 1024),
};

export class AlbumImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlbumImageError';
  }
}

export type StoredAlbumImage = {
  displayFileName: string;
  thumbnailFileName: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  fileSize: number;
  checksum: string;
};

const safeUnlink = async (directory: string, fileName: string): Promise<void> => {
  if (!isAllowedLocalImageFileName(fileName)) return;
  const filePath = path.resolve(directory, fileName);
  if (path.dirname(filePath) !== path.resolve(directory)) return;
  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

export const deleteAlbumImages = async (
  displayFileName: string,
  thumbnailFileName: string,
): Promise<void> => {
  await Promise.all([
    safeUnlink(ALBUM_DISPLAY_DIR, displayFileName),
    safeUnlink(ALBUM_THUMBNAIL_DIR, thumbnailFileName),
  ]);
};

export const processAndStoreAlbumImage = async (source: Buffer): Promise<StoredAlbumImage> => {
  if (source.length <= 0 || source.length > MAX_ALBUM_SOURCE_BYTES) {
    throw new AlbumImageError('相册原图大小必须在 1 字节到 15 MiB 之间');
  }
  if (!detectSupportedImageType(source)) {
    throw new AlbumImageError('相册只支持有效的 JPEG、PNG、GIF 或 WebP 图片');
  }

  const input = sharp(source, {
    animated: false,
    failOn: 'warning',
    limitInputPixels: MAX_ALBUM_INPUT_PIXELS,
  }).rotate();
  const metadata = await input.metadata();
  if (!metadata.width || !metadata.height) {
    throw new AlbumImageError('无法识别照片尺寸');
  }

  // Sharp strips EXIF/GPS metadata unless keepMetadata/withMetadata is called.
  const display = await input
    .clone()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await input
    .clone()
    .resize({ width: 720, height: 900, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75, effort: 4 })
    .toBuffer();

  if (!display.info.width || !display.info.height) {
    throw new AlbumImageError('照片处理后尺寸无效');
  }

  const displayFileName = `${randomUUID()}.webp`;
  const thumbnailFileName = `${randomUUID()}.webp`;
  try {
    await saveLocalImage(display.data, displayFileName, ALBUM_DISPLAY_DIR, displayLimits);
    await saveLocalImage(thumbnail, thumbnailFileName, ALBUM_THUMBNAIL_DIR, thumbnailLimits);
  } catch (error) {
    await deleteAlbumImages(displayFileName, thumbnailFileName);
    throw error;
  }

  return {
    displayFileName,
    thumbnailFileName,
    mimeType: 'image/webp',
    width: display.info.width,
    height: display.info.height,
    fileSize: display.data.length,
    checksum: createHash('sha256').update(source).digest('hex'),
  };
};

export const readAlbumImage = (
  variant: 'display' | 'thumbnail',
  fileName: string,
) => readLocalImage(
  fileName,
  variant === 'display' ? ALBUM_DISPLAY_DIR : ALBUM_THUMBNAIL_DIR,
);
