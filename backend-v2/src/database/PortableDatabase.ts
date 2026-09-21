import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MODEL_SPEC } from './modelSpec';

const MAX_ROWS = 100_000;
export const MAX_BYTES = 64 * 1024 * 1024;
// Parents before children; Comment.parentId is restored in a second pass.
export const TABLE_ORDER = ['Admin', 'User', 'ArticleAccessCode', 'AnonymousAccessSession',
  'CardIssueBatch', 'CardCode', 'CardDownloadLog',
  'LicenseKey', 'LicenseActivation',
  'Post', 'Friend', 'ImageCache', 'SiteStat', 'MagicToken', 'SystemConfig', 'AuditLog',
  'PollVote', 'AlbumPhoto', 'I18nDict', 'AccessRequest', 'ArticleLike', 'Comment',
  'CommentAction', 'Danmaku', 'Notification', 'ViewHistory', 'ArticleAccessGrant'];
const AUTO_TABLES = TABLE_ORDER.filter(name => MODEL_SPEC[name].id.type === 'Int' && name !== 'SiteStat');
const MYSQL_TABLE_NAME_BY_FOLDED = new Map(TABLE_ORDER.map(name => [name.toLocaleLowerCase(), name]));
type Row = Record<string, any>;
export type Snapshot = {
  format: 'zhuiyi-portable-v1'; provider: 'mysql'; createdAt: string;
  schemaHash: string; nextIds: Record<string, number>;
  tables: Array<{ name: string; count: number; sha256: string; rows: Row[] }>;
};

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const schemaHash = digest(MODEL_SPEC);
const delegate = (db: any, name: string) => db[name[0].toLowerCase() + name.slice(1)];
const normalizedRows = (rows: Row[]) => rows.map(row => JSON.parse(JSON.stringify(row)))
  .sort((a, b) => canonical(a.id) < canonical(b.id) ? -1 : canonical(a.id) > canonical(b.id) ? 1 : 0);

async function mysqlFoldsTableNames(db: any): Promise<boolean> {
  // PolarDB-X exposes this read-only server variable without the SESSION qualifier.
  const [row] = await db.$queryRawUnsafe('SELECT @@lower_case_table_names AS value');
  const value = Number(row?.value);
  if (!Number.isInteger(value) || value < 0 || value > 2) throw new Error('无法确认 MySQL 表名大小写规则');
  return value !== 0;
}

function canonicalMySqlTableName(value: string, foldsTableNames: boolean): string {
  if (!foldsTableNames) return value;
  return MYSQL_TABLE_NAME_BY_FOLDED.get(value.toLocaleLowerCase()) || value;
}

export function validateSnapshot(value: unknown): asserts value is Snapshot {
  const data = value as Snapshot;
  if (!data || data.format !== 'zhuiyi-portable-v1' || data.schemaHash !== schemaHash
    || data.provider !== 'mysql' || !Array.isArray(data.tables)
    || data.tables.length !== TABLE_ORDER.length) throw new Error('备份格式或模型版本不匹配');
  if (!data.nextIds || canonical(Object.keys(data.nextIds).sort()) !== canonical([...AUTO_TABLES].sort())) throw new Error('自增序列清单不匹配');
  const seen = new Set<string>();
  let total = 0;
  for (const table of data.tables) {
    if (!TABLE_ORDER.includes(table.name) || seen.has(table.name) || !Array.isArray(table.rows)) throw new Error('备份表清单无效');
    seen.add(table.name);
    if (table.count !== table.rows.length || table.sha256 !== digest(normalizedRows(table.rows))) throw new Error(`${table.name}: 行数或校验和不匹配`);
    total += table.count;
    if (total > MAX_ROWS) throw new Error('超过 100000 行上限，请使用分批迁移方案');
    const fields = MODEL_SPEC[table.name];
    const ids = new Set();
    if (AUTO_TABLES.includes(table.name)) {
      const next = data.nextIds[table.name];
      if (!Number.isSafeInteger(next) || next < 1 || next > 2147483647
        || table.rows.some(row => row.id >= next)) throw new Error(`${table.name}: 自增序列超出可迁移范围`);
    }
    for (const row of table.rows) {
      if (!row || canonical(Object.keys(row).sort()) !== canonical(Object.keys(fields).sort())) throw new Error(`${table.name}: 字段清单不匹配`);
      if (ids.has(row.id)) throw new Error(`${table.name}: 主键重复`);
      ids.add(row.id);
      for (const [key, field] of Object.entries(fields)) {
        const item = row[key];
        const invalid = () => new Error(`${table.name}.${key}: 类型、长度或时间超出 MySQL 范围（未输出字段值）`);
        if (item === null && field.nullable) continue;
        if (field.type === 'String' && (typeof item !== 'string'
          || (field.maxLength && Array.from(item).length > field.maxLength))) throw invalid();
        if (field.type === 'Int' && (!Number.isInteger(item) || item < -2147483648 || item > 2147483647)) throw invalid();
        if (field.type === 'Boolean' && typeof item !== 'boolean') throw invalid();
        if (field.type === 'DateTime' && (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item)
          || !Number.isFinite(Date.parse(item)) || Number(item.slice(0, 4)) < 1000
          || new Date(item).toISOString() !== item)) throw invalid();
        if (table.name === 'AlbumPhoto' && key === 'tags'
          && (!Array.isArray(item) || item.some(tag => typeof tag !== 'string'))) throw invalid();
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw new Error('超过 64 MiB 上限，请使用分批迁移方案');
}

async function assertDatabaseShape(db: any) {
  const foldsMySqlTableNames = await mysqlFoldsTableNames(db);
  const columns: Array<{ table_name: string; column_name: string; datetime_precision: number | null }> = await db.$queryRawUnsafe(
    "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATETIME_PRECISION AS datetime_precision FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION");
  const actual: Record<string, string[]> = {};
  for (const column of columns) {
    if (column.table_name.toLocaleLowerCase() === '_prisma_migrations') continue;
    const tableName = canonicalMySqlTableName(column.table_name, foldsMySqlTableNames);
    (actual[tableName] ||= []).push(column.column_name);
    if (column.datetime_precision != null && Number(column.datetime_precision) > 3) throw new Error('发现高于毫秒精度的时间列；需单独处理，禁止静默截断');
  }
  if (canonical(Object.keys(actual).sort()) !== canonical([...TABLE_ORDER].sort())) throw new Error('数据库存在缺失或未纳入迁移的表，停止迁移');
  for (const name of TABLE_ORDER) if (canonical(actual[name].sort()) !== canonical(Object.keys(MODEL_SPEC[name]).sort())) throw new Error(`${name}: 数据库字段与副本模型存在差异`);
  const collations: Array<{ collation_name: string }> = await db.$queryRawUnsafe("SELECT DISTINCT COLLATION_NAME AS collation_name FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations' AND COLLATION_NAME IS NOT NULL");
  if (collations.some(row => row.collation_name !== 'utf8mb4_0900_bin')) throw new Error('MySQL 文本列必须使用 utf8mb4_0900_bin，避免大小写或尾部空格被合并');
}

async function readSnapshot(tx: any): Promise<Snapshot> {
  await assertDatabaseShape(tx);
  const tables: Snapshot['tables'] = [];
  let total = 0;
  for (const name of TABLE_ORDER) {
    const count = await delegate(tx, name).count();
    total += count;
    if (total > MAX_ROWS) throw new Error('数据量超过迁移工具上限');
    const rows = normalizedRows(await delegate(tx, name).findMany({ take: MAX_ROWS + 1 }));
    tables.push({ name, count, sha256: digest(rows), rows });
  }
  const nextIds: Record<string, number> = {};
  const foldsTableNames = await mysqlFoldsTableNames(tx);
  const [settings] = await tx.$queryRawUnsafe('SELECT @@SESSION.information_schema_stats_expiry AS expiry');
  try {
    // Cached INFORMATION_SCHEMA statistics may lag behind a deleted high ID.
    await tx.$executeRawUnsafe('SET SESSION information_schema_stats_expiry = 0');
    const sequences = await tx.$queryRawUnsafe('SELECT TABLE_NAME AS name, AUTO_INCREMENT AS next_id FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
    for (const name of AUTO_TABLES) nextIds[name] = Number(sequences.find((row: any) => (
      canonicalMySqlTableName(row.name, foldsTableNames) === name
    ))?.next_id || 1);
  } finally {
    await tx.$executeRawUnsafe('SET SESSION information_schema_stats_expiry = ?', Number(settings.expiry));
  }
  for (const name of AUTO_TABLES) {
    // Explicit imports may be ahead of the source sequence; never reuse a live or previously allocated ID.
    for (const row of tables.find(table => table.name === name)!.rows) nextIds[name] = Math.max(nextIds[name], row.id + 1);
  }
  const snapshot: Snapshot = { format: 'zhuiyi-portable-v1', provider: 'mysql', createdAt: new Date().toISOString(), schemaHash, nextIds, tables };
  validateSnapshot(snapshot);
  return snapshot;
}

export async function exportSnapshot(client: any): Promise<Snapshot> {
  return client.$transaction((tx: any) => readSnapshot(tx),
    { isolationLevel: 'RepeatableRead', timeout: 600_000, maxWait: 10_000 });
}

function compare(expected: Snapshot, actual: Snapshot) {
  for (const table of expected.tables) {
    const target = actual.tables.find(item => item.name === table.name);
    if (!target || table.count !== target.count || table.sha256 !== target.sha256) throw new Error(`${table.name}: 导入后全量校验失败`);
  }
  for (const name of AUTO_TABLES) if (actual.nextIds[name] < expected.nextIds[name]) throw new Error(`${name}: 自增序列低于源库高水位`);
}
export async function verifySnapshot(client: any, snapshot: Snapshot) {
  validateSnapshot(snapshot);
  compare(snapshot, await exportSnapshot(client));
}

export async function importSnapshot(client: any, snapshot: Snapshot) {
  validateSnapshot(snapshot);
  await assertDatabaseShape(client);
  for (const name of TABLE_ORDER) if (await delegate(client, name).count()) throw new Error(`${name}: 目标不为空，拒绝导入`);
  // MySQL DDL implicitly commits. Advance sequences BEFORE the data transaction, on an isolated empty target only.
  // A failed import may leave higher counters, but never partially committed business rows.
  for (const name of AUTO_TABLES) await client.$executeRawUnsafe(`ALTER TABLE \`${name}\` AUTO_INCREMENT = ${snapshot.nextIds[name]}`);
  await client.$transaction(async (tx: any) => {
    await assertDatabaseShape(tx);
    // No deletion, reset, upsert or foreign-key disabling. Target must be empty.
    for (const name of TABLE_ORDER) if (await delegate(tx, name).count()) throw new Error(`${name}: 目标不为空，拒绝导入`);
    // Explicit ID=0 must not become an auto-generated ID. Restore session mode before returning the pooled connection.
    const modes: Array<{ value: string }> = await tx.$queryRawUnsafe('SELECT @@SESSION.sql_mode AS value');
    await tx.$executeRawUnsafe('SET SESSION sql_mode = ?', [...new Set([...modes[0].value.split(','), 'NO_AUTO_VALUE_ON_ZERO'])].join(','));
    try {
      for (const name of TABLE_ORDER) {
        const table = snapshot.tables.find(item => item.name === name)!;
        const rows = table.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
          const type = MODEL_SPEC[name][key].type;
          if (name === 'Comment' && key === 'parentId') return [key, null];
          if (value === null && type === 'Json') return [key, Prisma.JsonNull];
          return [key, type === 'DateTime' && value !== null ? new Date(value) : value];
        })));
        for (let offset = 0; offset < rows.length; offset += 100) await delegate(tx, name).createMany({ data: rows.slice(offset, offset + 100) });
      }
      for (const row of snapshot.tables.find(item => item.name === 'Comment')!.rows) {
        if (row.parentId !== null) await tx.comment.update({ where: { id: row.id }, data: { parentId: row.parentId } });
      }
      compare(snapshot, await readSnapshot(tx));
    } finally {
      await tx.$executeRawUnsafe('SET SESSION sql_mode = ?', modes[0].value);
    }
  }, { isolationLevel: 'Serializable', timeout: 600_000, maxWait: 10_000 });
}
