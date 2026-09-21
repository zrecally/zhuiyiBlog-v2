import fs from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prisma } from '../core/Database';
import { exportSnapshot } from './PortableDatabase';

// A model-complete, consistent logical backup. Not a server-wide MySQL dump.
export async function writeDatabaseBackup(destination: string) {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL || ''); }
  catch { throw new Error('DATABASE_URL 未配置'); }
  if (url.protocol !== 'mysql:') throw new Error('MySQL 副本只允许 mysql: 数据库');
  const snapshot = await exportSnapshot(prisma);
  const dir = path.dirname(destination);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const handle = await fs.open(destination, 'wx', 0o600);
  try {
    await pipeline(Readable.from([JSON.stringify(snapshot)]), createGzip(),
      createWriteStream(destination, { fd: handle.fd, autoClose: false }));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(destination).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return { bytes: (await fs.stat(destination)).size, tables: snapshot.tables.length };
}
