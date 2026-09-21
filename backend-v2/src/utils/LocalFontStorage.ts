import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_LOCAL_FONT_BYTES = 10 * 1024 * 1024;
export const LOCAL_FONT_STORAGE_DIR = path.resolve(process.cwd(), 'cache_data/fonts');

const FONT_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(ttf|woff|woff2)$/;

export type SupportedFontType = {
  extension: 'ttf' | 'woff' | 'woff2';
  mimeType: 'font/ttf' | 'font/woff' | 'font/woff2';
};

export class LocalFontStorageError extends Error {
  constructor(
    public readonly code: 'INVALID_NAME' | 'INVALID_FONT' | 'TOO_LARGE' | 'UNSAFE_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'LocalFontStorageError';
  }
}

const supportedFontTypeByExtension: Record<SupportedFontType['extension'], SupportedFontType> = {
  ttf: { extension: 'ttf', mimeType: 'font/ttf' },
  woff: { extension: 'woff', mimeType: 'font/woff' },
  woff2: { extension: 'woff2', mimeType: 'font/woff2' },
};

export const isAllowedLocalFontFileName = (fileName: string): boolean => FONT_FILE_NAME.test(fileName);

export const detectSupportedFontType = (buffer: Buffer): SupportedFontType | null => {
  if (buffer.length < 4) return null;
  const signature = buffer.subarray(0, 4).toString('ascii');
  if (signature === 'wOFF') return supportedFontTypeByExtension.woff;
  if (signature === 'wOF2') return supportedFontTypeByExtension.woff2;
  if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) {
    return supportedFontTypeByExtension.ttf;
  }
  return null;
};

const extensionForFileName = (fileName: string): SupportedFontType['extension'] => {
  const match = fileName.match(FONT_FILE_NAME);
  if (!match) throw new LocalFontStorageError('INVALID_NAME', 'Invalid local font file name');
  return match[1] as SupportedFontType['extension'];
};

const assertFont = (buffer: Buffer, extension: SupportedFontType['extension']): SupportedFontType => {
  if (buffer.length === 0 || buffer.length > MAX_LOCAL_FONT_BYTES) {
    throw new LocalFontStorageError('TOO_LARGE', 'Font must be between 1 byte and 10 MiB');
  }
  const detected = detectSupportedFontType(buffer);
  if (!detected || detected.extension !== extension) {
    throw new LocalFontStorageError('INVALID_FONT', 'Font signature does not match its file name');
  }
  return detected;
};

const assertStorageDirectory = async (storageDir: string): Promise<void> => {
  await fs.mkdir(storageDir, { recursive: true, mode: 0o750 });
  const stats = await fs.lstat(storageDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LocalFontStorageError('UNSAFE_FILE', 'Font storage path is not a real directory');
  }
  await fs.chmod(storageDir, 0o750);
};

let writeQueue: Promise<void> = Promise.resolve();

export const saveLocalFont = async (
  buffer: Buffer,
  extension: SupportedFontType['extension'],
  storageDir: string = LOCAL_FONT_STORAGE_DIR,
): Promise<{ fileName: string; type: SupportedFontType }> => {
  const operation = writeQueue.then(async () => {
    const type = assertFont(buffer, extension);
    await assertStorageDirectory(storageDir);
    const fileName = `${randomUUID()}.${extension}`;
    const destination = path.resolve(storageDir, fileName);
    if (path.dirname(destination) !== path.resolve(storageDir)) {
      throw new LocalFontStorageError('INVALID_NAME', 'Invalid local font destination');
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
      return { fileName, type };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

export const readLocalFont = async (
  fileName: string,
  storageDir: string = LOCAL_FONT_STORAGE_DIR,
): Promise<{ buffer: Buffer; type: SupportedFontType }> => {
  const extension = extensionForFileName(fileName);
  const filePath = path.resolve(storageDir, fileName);
  if (path.dirname(filePath) !== path.resolve(storageDir)) {
    throw new LocalFontStorageError('INVALID_NAME', 'Invalid local font path');
  }
  const pathStats = await fs.lstat(filePath);
  if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new LocalFontStorageError('UNSAFE_FILE', 'Font file is not a regular file');
  }

  const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== pathStats.size) {
      throw new LocalFontStorageError('UNSAFE_FILE', 'Font file changed while being read');
    }
    const buffer = await handle.readFile();
    return { buffer, type: assertFont(buffer, extension) };
  } finally {
    await handle.close();
  }
};

export const removeLocalFont = async (
  fileName: string,
  storageDir: string = LOCAL_FONT_STORAGE_DIR,
): Promise<void> => {
  extensionForFileName(fileName);
  const filePath = path.resolve(storageDir, fileName);
  if (path.dirname(filePath) !== path.resolve(storageDir)) return;
  const stats = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) return;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new LocalFontStorageError('UNSAFE_FILE', 'Font file is not a regular file');
  }
  await fs.unlink(filePath);
};
