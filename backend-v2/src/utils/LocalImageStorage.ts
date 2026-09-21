import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { detectSupportedImageType, SupportedImageType } from './ImageFileUtils';

export const MAX_LOCAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const LOCAL_IMAGE_UPLOAD_DIR = path.resolve(process.cwd(), 'cache_data/uploads');

export type LocalImageStorageLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  minFreeBytes: number;
};

const positiveIntegerFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const DEFAULT_LOCAL_IMAGE_STORAGE_LIMITS: LocalImageStorageLimits = {
  maxFiles: positiveIntegerFromEnv('LOCAL_IMAGE_MAX_FILES', 2000),
  maxTotalBytes: positiveIntegerFromEnv('LOCAL_IMAGE_MAX_TOTAL_BYTES', 2 * 1024 * 1024 * 1024),
  minFreeBytes: positiveIntegerFromEnv('LOCAL_IMAGE_MIN_FREE_BYTES', 2 * 1024 * 1024 * 1024),
};

const LOCAL_IMAGE_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;

export class LocalImageStorageError extends Error {
  constructor(
    public readonly code: 'INVALID_NAME' | 'INVALID_IMAGE' | 'TOO_LARGE' | 'UNSAFE_FILE' | 'QUOTA_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'LocalImageStorageError';
  }
}

export type StoredLocalImage = {
  buffer: Buffer;
  mimeType: SupportedImageType['mimeType'];
};

export const isAllowedLocalImageFileName = (fileName: string): boolean =>
  LOCAL_IMAGE_FILE_NAME.test(fileName);

const requireAllowedFileName = (fileName: string): string => {
  if (!isAllowedLocalImageFileName(fileName)) {
    throw new LocalImageStorageError('INVALID_NAME', 'Invalid local image file name');
  }
  return fileName.slice(fileName.lastIndexOf('.') + 1);
};

const validateImage = (buffer: Buffer, expectedExtension: string): SupportedImageType => {
  if (buffer.length === 0 || buffer.length > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageStorageError('TOO_LARGE', 'Image must be between 1 byte and 5 MiB');
  }

  const detectedType = detectSupportedImageType(buffer);
  if (!detectedType || detectedType.extension !== expectedExtension) {
    throw new LocalImageStorageError('INVALID_IMAGE', 'Image signature does not match its file name');
  }
  return detectedType;
};

const ensureStorageDirectory = async (storageDir: string): Promise<void> => {
  await fs.mkdir(storageDir, { recursive: true, mode: 0o750 });
  const stats = await fs.lstat(storageDir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new LocalImageStorageError('UNSAFE_FILE', 'Local image storage path is not a real directory');
  }
  await fs.chmod(storageDir, 0o750);
};

const assertStorageCapacity = async (
  storageDir: string,
  incomingBytes: number,
  limits: LocalImageStorageLimits,
): Promise<void> => {
  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of await fs.readdir(storageDir, { withFileTypes: true })) {
    const entryPath = path.join(storageDir, entry.name);
    const stats = await fs.lstat(entryPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new LocalImageStorageError('UNSAFE_FILE', 'Local image storage contains an unsafe entry');
    }
    fileCount += 1;
    totalBytes += stats.size;
    if (fileCount >= limits.maxFiles || totalBytes + incomingBytes > limits.maxTotalBytes) {
      throw new LocalImageStorageError('QUOTA_EXCEEDED', 'Local image storage quota exceeded');
    }
  }

  const filesystem = await fs.statfs(storageDir, { bigint: true });
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes - BigInt(incomingBytes) < BigInt(limits.minFreeBytes)) {
    throw new LocalImageStorageError('QUOTA_EXCEEDED', 'Local image storage free-space reserve reached');
  }
};

let storageWriteQueue: Promise<void> = Promise.resolve();

/**
 * Persist a validated image without ever exposing a partially written file.
 * The temporary file lives in the same directory so the final rename is
 * atomic on the deployment filesystem.
 */
export const saveLocalImage = async (
  buffer: Buffer,
  fileName: string,
  storageDir: string = LOCAL_IMAGE_UPLOAD_DIR,
  limits: LocalImageStorageLimits = DEFAULT_LOCAL_IMAGE_STORAGE_LIMITS,
): Promise<void> => {
  const operation = storageWriteQueue.then(async () => {
    const expectedExtension = requireAllowedFileName(fileName);
    validateImage(buffer, expectedExtension);
    await ensureStorageDirectory(storageDir);
    await assertStorageCapacity(storageDir, buffer.byteLength, limits);

    const destination = path.resolve(storageDir, fileName);
    if (path.dirname(destination) !== path.resolve(storageDir)) {
      throw new LocalImageStorageError('INVALID_NAME', 'Invalid local image destination');
    }

    const temporary = path.join(storageDir, `.${fileName}.${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, 'wx', 0o640);
      await handle.writeFile(buffer);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, destination);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  });
  storageWriteQueue = operation.catch(() => undefined);
  return operation;
};

/**
 * Read a locally uploaded image through a no-follow file descriptor, then
 * validate its size and signature again before returning any bytes.
 */
export const readLocalImage = async (
  fileName: string,
  storageDir: string = LOCAL_IMAGE_UPLOAD_DIR,
): Promise<StoredLocalImage> => {
  const expectedExtension = requireAllowedFileName(fileName);
  const filePath = path.resolve(storageDir, fileName);
  if (path.dirname(filePath) !== path.resolve(storageDir)) {
    throw new LocalImageStorageError('INVALID_NAME', 'Invalid local image path');
  }

  const pathStats = await fs.lstat(filePath);
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new LocalImageStorageError('UNSAFE_FILE', 'Local image is not a regular file');
  }
  if (pathStats.size === 0 || pathStats.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageStorageError('TOO_LARGE', 'Stored image has an invalid size');
  }

  const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStats = await handle.stat();
    if (
      !openedStats.isFile()
      || openedStats.size !== pathStats.size
      || openedStats.dev !== pathStats.dev
      || openedStats.ino !== pathStats.ino
    ) {
      throw new LocalImageStorageError('UNSAFE_FILE', 'Local image changed while it was being opened');
    }

    const buffer = await handle.readFile();
    const detectedType = validateImage(buffer, expectedExtension);
    return { buffer, mimeType: detectedType.mimeType };
  } finally {
    await handle.close();
  }
};
