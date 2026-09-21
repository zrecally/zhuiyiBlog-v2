import { ZipArchive } from 'archiver';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { writeDatabaseBackup } from '../src/database/DatabaseBackup';
import { prisma } from '../src/core/Database';
import { finished } from 'node:stream/promises';
import { feishuClient } from '../src/core/FeishuClient';

dotenv.config();

const EXPORT_DIR = path.join(process.cwd(), 'exports');
const EXPORT_TIME = new Date().toISOString().replace(/[:.]/g, '-');
const TEMP_DIR = path.join(EXPORT_DIR, `temp_${EXPORT_TIME}`);
const FEISHU_DIR = path.join(TEMP_DIR, 'feishu');
const MYSQL_DUMP_FILE = 'mysql.portable.json.gz';

type ExportedTable = {
  name: string;
  configured: boolean;
  exported: boolean;
  recordCount: number;
  file?: string;
  error?: string;
};


const TABLES: Array<[string, string]> = [
  ['Admins', 'FEISHU_ADMINS_TABLE_ID'],
  ['Users', 'FEISHU_USERS_TABLE_ID'],
  ['Config', 'FEISHU_CONFIG_TABLE_ID'],
  ['Comments', 'FEISHU_COMMENTS_TABLE_ID'],
  ['Danmaku', 'FEISHU_DANMAKU_TABLE_ID'],
  ['AccessRequests', 'FEISHU_ACCESS_REQUESTS_TABLE_ID'],
  ['ArticleAccessCodes', 'FEISHU_ARTICLE_ACCESS_CODES_TABLE_ID'],
  ['AuditLogs', 'FEISHU_AUDIT_LOGS_TABLE_ID'],
  ['Friends', 'FEISHU_FRIENDS_TABLE_ID'],
  ['Projects', 'FEISHU_PROJECTS_TABLE_ID'],
  ['Album', 'FEISHU_ALBUM_TABLE_ID'],
  ['Timeline', 'FEISHU_TIMELINE_TABLE_ID'],
  ['I18nDict', 'FEISHU_I18N_DICT_TABLE_ID'],
  ['Blacklist', 'FEISHU_BLACKLIST_TABLE_ID'],
];

function printHelp() {
  console.log(`ZhuiYi 数据导出工具

用法：npm run export:data

导出内容：
  - MySQL 应用库逻辑备份（mysql.portable.json.gz，全部模型与校验摘要）
  - 已配置飞书数据表的原始 JSON
  - manifest.json（导出结果与恢复说明，不含任何密钥）

前提：DATABASE_URL 已配置为 MySQL。导出文件仅用于受控备份，
其中包含密码哈希、TOTP、配置表密钥等敏感数据；脚本会以仅所有者可读写的权限创建文件，
但不会自动加密。全部模型合计上限 100000 行 / 64 MiB，超出时停止。`);
}

function ensureDirs() {
  fs.mkdirSync(FEISHU_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(EXPORT_DIR, 0o700);
  fs.chmodSync(TEMP_DIR, 0o700);
  fs.chmodSync(FEISHU_DIR, 0o700);
}

async function exportMysqlDatabase() {
  const result = await writeDatabaseBackup(path.join(TEMP_DIR, MYSQL_DUMP_FILE));
  return { file: MYSQL_DUMP_FILE, bytes: result.bytes };
}

async function exportTableData(tableId: string | undefined, tableName: string): Promise<ExportedTable> {
  if (!tableId) return { name: tableName, configured: false, exported: false, recordCount: 0 };
  if (!feishuClient || !process.env.FEISHU_BASE_TOKEN) {
    return { name: tableName, configured: true, exported: false, recordCount: 0, error: '飞书客户端或 FEISHU_BASE_TOKEN 未配置' };
  }

  console.log(`[Export] 正在提取飞书 ${tableName} 表数据…`);
  try {
    const items: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const response = await feishuClient.bitable.appTableRecord.list({
        path: { app_token: process.env.FEISHU_BASE_TOKEN, table_id: tableId },
        params: { page_size: 500, page_token: pageToken },
      });
      if (response.code && response.code !== 0) throw new Error(response.msg || `飞书错误码 ${response.code}`);
      items.push(...(response.data?.items || []));
      pageToken = response.data?.has_more ? response.data.page_token : undefined;
      if (response.data?.has_more && !pageToken) throw new Error('飞书分页响应缺少 page_token');
    } while (pageToken);

    const file = `feishu/${tableName.toLowerCase()}.json`;
    fs.writeFileSync(path.join(TEMP_DIR, file), JSON.stringify(items, null, 2), { mode: 0o600 });
    return { name: tableName, configured: true, exported: true, recordCount: items.length, file };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Export] 飞书 ${tableName} 导出失败：${message}`);
    return { name: tableName, configured: true, exported: false, recordCount: 0, error: message };
  }
}

async function createArchive() {
  const archivePath = path.join(EXPORT_DIR, `zhuiyi_export_${EXPORT_TIME}.zip`);
  const output = fs.createWriteStream(archivePath, { mode: 0o600 });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const errors: Error[] = [];
  archive.on('warning', warning => errors.push(warning));
  archive.on('error', error => errors.push(error));
  archive.pipe(output);
  archive.directory(TEMP_DIR, false);
  await archive.finalize();
  await finished(output);
  if (errors.length) throw errors[0];
  fs.chmodSync(archivePath, 0o600);
  return archivePath;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  ensureDirs();
  try {
    const database = await exportMysqlDatabase();
    const feishuTables = await Promise.all(TABLES.map(([name, envKey]) => exportTableData(process.env[envKey], name)));
    const feishuFailures = feishuTables.filter(table => table.configured && !table.exported);
    const manifest = {
      formatVersion: 2,
      generatedAt: new Date().toISOString(),
      database: {
        exported: true,
        format: 'zhuiyi-portable-v1 gzip (MySQL application models)',
        file: database.file,
        bytes: database.bytes,
        restore: 'umask 077; gunzip -c mysql.portable.json.gz > private-backup.json; ALLOW_MYSQL_IMPORT=<empty-target-db> npm run db:transfer -- --import private-backup.json',
      },
      feishu: { exportedTables: feishuTables, failures: feishuFailures.length },
      security: '不会复制 .env 或私钥文件，但数据库与飞书记录可能包含密码哈希、TOTP 和配置密钥。归档未加密；须加密异地保管，禁止提交 Git。',
    };
    fs.writeFileSync(path.join(TEMP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    const archivePath = await createArchive();
    const size = fs.statSync(archivePath).size;
    console.log(`[Export] 导出完成：${archivePath}（${(size / 1024 / 1024).toFixed(2)} MiB）`);
    if (feishuFailures.length) console.warn(`[Export] 注意：${feishuFailures.length} 张已配置飞书表未成功导出；MySQL 备份仍已完成。`);
  } finally {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  console.error(`[Export] 失败：${error?.name?.startsWith('Prisma') ? (error.code || error.name) : error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
