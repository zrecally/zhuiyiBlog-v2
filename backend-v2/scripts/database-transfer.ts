import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { exportSnapshot, importSnapshot, verifySnapshot, validateSnapshot, MAX_BYTES } from '../src/database/PortableDatabase';

async function main() {
  const [mode, file, ...extra] = process.argv.slice(2);
  if (!mode || mode === '--help') {
    console.log('database-transfer.ts --export-mysql|--check|--import|--verify FILE.json\n显式设置 DATABASE_URL；不自动读取 .env。导入需 ALLOW_MYSQL_IMPORT=<目标库名> 且目标为空。');
    return;
  }
  if (!file || extra.length || !['--export-mysql', '--check', '--import', '--verify'].includes(mode)) throw new Error('命令参数无效');
  const absolute = path.resolve(file);
  let snapshot: any;
  if (!mode.startsWith('--export-')) {
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('备份文件类型或大小无效');
    snapshot = JSON.parse(await fs.readFile(absolute, 'utf8'));
    validateSnapshot(snapshot);
    if (mode === '--check') {
      console.log(JSON.stringify(snapshot.tables.map((table: any) => ({ table: table.name, count: table.count })), null, 2));
      return;
    }
  }
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL || ''); }
  catch { throw new Error('请显式提供 DATABASE_URL，未读取默认连接配置'); }
  if (url.protocol !== 'mysql:') throw new Error('只允许 MySQL 数据库连接');
  if (mode === '--import' && process.env.ALLOW_MYSQL_IMPORT !== decodeURIComponent(url.pathname.slice(1))) throw new Error('必须用 ALLOW_MYSQL_IMPORT 明确确认目标库名');
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    if (mode.startsWith('--export-')) {
      snapshot = await exportSnapshot(client);
      await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
      await fs.writeFile(absolute, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
      console.log(`导出完成：${snapshot.tables.length} 张表；文件含敏感数据，仅限受控保管。`);
    } else if (mode === '--import') {
      await importSnapshot(client, snapshot);
      console.log('导入完成：所有表在提交前已通过行数和全字段 SHA-256 校验。');
    } else {
      await verifySnapshot(client, snapshot);
      console.log('全量校验通过。');
    }
  } finally { await client.$disconnect(); }
}
main().catch(error => {
  // Prisma errors can include connection URLs or record values. Never print them.
  console.error(error?.name?.startsWith('Prisma') ? `数据库操作失败（${error.code || error.name}），未输出凭据或记录。` : error.message);
  process.exitCode = 1;
});
