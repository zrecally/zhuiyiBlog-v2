import * as lark from '@larksuiteoapi/node-sdk';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * 初始化当前项目使用的飞书多维表格。
 *
 * 安全边界：本脚本不读取或修改本地 .env，不删除数据、不删除字段、不变更已有字段类型。
 * 它只会创建缺失的数据表与字段，并在结束时打印应写入环境变量的 Table ID。
 */

type FieldDefinition = {
  field_name: string;
  type: number;
  property?: { options?: Array<{ name: string; color?: number }> };
};

type TableDefinition = {
  key: string;
  envKey: string;
  name: string;
  aliases: string[];
  view: string;
  fields: FieldDefinition[];
};

type BitableTable = { table_id?: string; name?: string };
type BitableField = { field_id?: string; field_name?: string; type?: number };

const environmentField: FieldDefinition = {
  field_name: 'Environment',
  type: 3,
  property: { options: [{ name: 'Test', color: 1 }, { name: 'Production', color: 2 }] },
};

// 每次变更此脚本的字段契约时递增，用于终端输出和部署记录核对。
const SCHEMA_VERSION = '2026.08.28.1';

const select = (field_name: string, options: string[]): FieldDefinition => ({
  field_name,
  type: 3,
  property: { options: options.map((name, index) => ({ name, color: (index % 10) + 1 })) },
});

const TABLES: TableDefinition[] = [
  {
    key: 'admins', envKey: 'FEISHU_ADMINS_TABLE_ID', name: '管理员', aliases: ['Admins'], view: '管理员账户',
    fields: [
      { field_name: 'Username', type: 1 }, { field_name: 'Set Password', type: 1 },
      { field_name: 'Active', type: 7 }, environmentField,
    ],
  },
  {
    key: 'posts', envKey: 'FEISHU_POSTS_TABLE_ID', name: '文章', aliases: ['Posts'], view: '文章管理',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'Date', type: 5 }, { field_name: 'Summary', type: 1 },
      { field_name: 'Slug', type: 1 }, { field_name: 'Cover', type: 15 }, { field_name: 'Doc_Link', type: 15 },
      { field_name: 'Category', type: 4 }, { field_name: 'Tags', type: 4 }, { field_name: 'Private', type: 7 },
      select('AccessMode', ['Public', 'Approval', 'Password']), { field_name: 'ShowLockedMetadata', type: 7 },
      select('Status', ['Draft', 'Published', 'Archived']), { field_name: 'Views', type: 2 }, environmentField,
    ],
  },
  {
    key: 'ipWhitelist', envKey: 'FEISHU_IP_WHITELIST_TABLE_ID', name: '控制面 IP 白名单', aliases: ['IPWhitelist'], view: '访问白名单',
    fields: [{ field_name: 'IP', type: 1 }, { field_name: 'Remark', type: 1 }, { field_name: 'Active', type: 7 }, environmentField],
  },
  {
    key: 'users', envKey: 'FEISHU_USERS_TABLE_ID', name: '访客用户', aliases: ['Users'], view: '用户列表',
    fields: [
      { field_name: 'Id', type: 1 }, { field_name: 'Username', type: 1 }, { field_name: 'Email', type: 1 },
      { field_name: 'Avatar', type: 15 }, select('Provider', ['github', 'magic-link', 'email']),
      select('Role', ['user', 'admin']), select('Status', ['active', 'inactive']), { field_name: 'LastLogin', type: 5 }, environmentField,
    ],
  },
  {
    key: 'comments', envKey: 'FEISHU_COMMENTS_TABLE_ID', name: '评论', aliases: ['Comments'], view: '评论管理',
    fields: [
      // ArticleID 是当前评论写入端的标准字段；PostId 保留用于读取历史数据。
      { field_name: 'ArticleID', type: 1 }, { field_name: 'PostId', type: 1 },
      { field_name: 'Content', type: 1 }, { field_name: 'Author', type: 1 },
      select('Status', ['Approved', 'Pending', 'Hidden', 'Reject']), { field_name: 'Published', type: 7 },
      { field_name: 'ParentId', type: 1 }, { field_name: 'Ip', type: 1 }, { field_name: 'FeishuMessageId', type: 1 },
      { field_name: 'Date', type: 5 }, environmentField,
    ],
  },
  {
    key: 'friends', envKey: 'FEISHU_FRIENDS_TABLE_ID', name: '友邻', aliases: ['Friends'], view: '友邻录',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'Link', type: 15 }, { field_name: 'Avatar', type: 15 },
      { field_name: 'Description', type: 1 }, { field_name: 'Content', type: 1 },
      select('Status', ['Pending', 'Approved', 'Rejected']), { field_name: 'Published', type: 7 },
      { field_name: 'Order', type: 2 }, environmentField,
    ],
  },
  {
    key: 'requests', envKey: 'FEISHU_REQUESTS_TABLE_ID', name: '文章访问申请', aliases: ['AccessRequests'], view: '访问审批',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'UserID', type: 1 }, { field_name: 'Username', type: 1 },
      { field_name: 'PostID', type: 1 }, { field_name: 'PostTitle', type: 1 },
      select('Status', ['pending', 'approved', 'rejected']), { field_name: 'Date', type: 5 }, environmentField,
    ],
  },
  {
    key: 'articleAccessCodes', envKey: 'FEISHU_ARTICLE_ACCESS_CODES_TABLE_ID', name: '文章一次性密码', aliases: ['ArticleAccessCodes'], view: '密码管理',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'PostID', type: 1 }, { field_name: 'PasswordInput', type: 1 },
      { field_name: 'BindIP', type: 7 }, { field_name: 'GrantHours', type: 2 }, { field_name: 'ExpiresAt', type: 5 },
      select('Status', ['Active', 'Used', 'Revoked', 'Expired', 'Error']), { field_name: 'UsedAt', type: 5 },
      { field_name: 'UsedIP', type: 1 }, { field_name: 'CodeHint', type: 1 }, { field_name: 'SyncMessage', type: 1 }, environmentField,
    ],
  },
  {
    key: 'feedback', envKey: 'FEISHU_FEEDBACK_TABLE_ID', name: '访客反馈', aliases: ['Feedback'], view: '反馈与建议',
    fields: [
      { field_name: 'Title', type: 1 }, select('Type', ['bug', 'suggestion']), { field_name: 'Content', type: 1 },
      select('Status', ['pending', 'processing', 'resolved']), { field_name: 'Date', type: 5 }, environmentField,
    ],
  },
  {
    key: 'projects', envKey: 'FEISHU_PROJECTS_TABLE_ID', name: '项目', aliases: ['Projects'], view: '项目集',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'Link', type: 15 }, { field_name: 'Cover', type: 15 },
      { field_name: 'Description', type: 1 }, { field_name: 'Docs', type: 15 }, { field_name: 'Doc_Link', type: 15 },
      { field_name: 'Tags', type: 4 }, select('Status', ['WIP', 'Active', 'Archived']), { field_name: 'Published', type: 7 }, environmentField,
    ],
  },
  {
    key: 'config', envKey: 'FEISHU_CONFIG_TABLE_ID', name: '系统配置', aliases: ['Config'], view: '站点配置',
    fields: [
      { field_name: 'Key', type: 1 }, { field_name: 'Value', type: 1 }, { field_name: 'IsSecret', type: 1 },
      { field_name: 'UpdatedAt', type: 5 }, environmentField,
    ],
  },
  {
    key: 'timeline', envKey: 'FEISHU_TIMELINE_TABLE_ID', name: '动态', aliases: ['Timeline'], view: '动态列表',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'Summary', type: 1 }, { field_name: 'Date', type: 5 },
      { field_name: 'Tags', type: 4 }, { field_name: 'Cover', type: 15 }, { field_name: 'Published', type: 7 }, environmentField,
    ],
  },
  {
    key: 'album', envKey: 'FEISHU_ALBUM_TABLE_ID', name: '相册', aliases: ['Album'], view: '相册管理',
    fields: [
      { field_name: 'Name', type: 1 }, { field_name: 'Photo', type: 17 }, { field_name: 'Caption', type: 1 },
      { field_name: 'Order', type: 2 }, { field_name: 'TakenAt', type: 5 }, { field_name: 'Featured', type: 7 },
      { field_name: 'Tags', type: 4 }, select('Status', ['Published', 'Hidden']), environmentField,
    ],
  },
  {
    key: 'blacklist', envKey: 'FEISHU_BLACKLIST_TABLE_ID', name: 'IP 黑名单', aliases: ['Blacklist'], view: '访问黑名单',
    fields: [{ field_name: 'IP', type: 1 }, { field_name: 'Reason', type: 1 }, { field_name: 'Status', type: 7 }, environmentField],
  },
  {
    key: 'i18nDict', envKey: 'FEISHU_I18N_DICT_TABLE_ID', name: '国际化词典', aliases: ['I18nDict'], view: '翻译词典',
    fields: [{ field_name: 'Key', type: 1 }, { field_name: 'zh-CN', type: 1 }, { field_name: 'en-US', type: 1 }, environmentField],
  },
  {
    key: 'danmaku', envKey: 'FEISHU_DANMAKU_TABLE_ID', name: '弹幕', aliases: ['Danmaku'], view: '弹幕管理',
    fields: [{ field_name: 'Text', type: 1 }, { field_name: 'Color', type: 1 }, { field_name: 'Ip', type: 1 }, { field_name: 'UserId', type: 1 }, { field_name: 'CreatedAt', type: 5 }, environmentField],
  },
  {
    key: 'auditLogs', envKey: 'FEISHU_AUDIT_LOGS_TABLE_ID', name: '审计日志', aliases: ['AuditLogs'], view: '审计日志',
    fields: [{ field_name: 'Action', type: 1 }, { field_name: 'Details', type: 1 }, { field_name: 'Ip', type: 1 }, { field_name: 'CreatedAt', type: 5 }, environmentField],
  },
];

const help = `飞书数据表一键初始化

用法：npm run init:feishu
      npm run init:feishu -- --yes
      npm run init:feishu -- --help

当前字段结构版本：${SCHEMA_VERSION}

脚本会创建或补齐当前项目的 17 张飞书多维表格，并打印 Table ID 环境变量。
不会写入本地 .env，不会删除飞书数据，也不会修改已有字段类型。`;

function printPermissions() {
  console.log(`\n需要在飞书开放平台为“企业自建应用”开通：
  1. bitable:app（必需）— 查看、评论、编辑和管理多维表格。
  2. 将该应用添加为目标多维表格的“文档应用/协作者”，并授予可编辑权限（必需）。

本工具只管理一个已创建的多维表格（Bitable App Token），不会创建云文档或知识库。
若你把表格放在知识库中，仍只需确保该应用对这张多维表格具有可编辑权限。\n`);
}

function assertResponse(response: { code?: number; msg?: string }, operation: string): void {
  if (typeof response.code === 'number' && response.code !== 0) {
    throw new Error(`${operation}失败：${response.msg || `飞书错误码 ${response.code}`}`);
  }
}

function normalizeBaseToken(value: string): string {
  const trimmed = value.trim();
  if (/^bas[a-zA-Z0-9]+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:base|app)\/([a-zA-Z0-9]+)/);
  if (match?.[1]?.startsWith('bas')) return match[1];
  throw new Error('Bitable App Token 格式无效，应为 bas 开头的 Token，或包含它的多维表格链接。');
}

async function listTables(client: any, appToken: string): Promise<BitableTable[]> {
  const tables: BitableTable[] = [];
  let pageToken: string | undefined;
  do {
    const response = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_size: 100, page_token: pageToken },
    });
    assertResponse(response, '读取多维表格列表');
    tables.push(...(response.data?.items || []));
    pageToken = response.data?.has_more ? response.data?.page_token : undefined;
    if (response.data?.has_more && !pageToken) throw new Error('飞书表格分页响应缺少 page_token');
  } while (pageToken);
  return tables;
}

async function listFields(client: any, appToken: string, tableId: string): Promise<BitableField[]> {
  const fields: BitableField[] = [];
  let pageToken: string | undefined;
  do {
    const response = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100, page_token: pageToken },
    });
    assertResponse(response, `读取数据表 ${tableId} 的字段`);
    fields.push(...(response.data?.items || []));
    pageToken = response.data?.has_more ? response.data?.page_token : undefined;
    if (response.data?.has_more && !pageToken) throw new Error(`数据表 ${tableId} 字段分页响应缺少 page_token`);
  } while (pageToken);
  return fields;
}

function findTable(definition: TableDefinition, tables: BitableTable[]): BitableTable | undefined {
  const expectedNames = new Set([definition.name, ...definition.aliases].map(name => name.toLocaleLowerCase()));
  return tables.find(table => expectedNames.has((table.name || '').toLocaleLowerCase()));
}

async function promptCredentials(): Promise<{ appId: string; appSecret: string; appToken: string }> {
  const rl = createInterface({ input, output });
  try {
    const appId = (await rl.question('飞书 App ID（cli_ 开头）：')).trim();
    const appSecret = (await rl.question('飞书 App Secret（仅本次运行使用，不会输出或写入文件）：')).trim();
    const appToken = normalizeBaseToken(await rl.question('目标多维表格 App Token（bas 开头，或粘贴链接）：'));
    if (!appId || !appSecret) throw new Error('App ID 与 App Secret 均不能为空。');
    return { appId, appSecret, appToken };
  } finally {
    rl.close();
  }
}

async function preflight(client: any, appToken: string, tables: BitableTable[]) {
  const plan: Array<{ definition: TableDefinition; tableId?: string; missingFields: FieldDefinition[] }> = [];
  const conflicts: string[] = [];
  for (const definition of TABLES) {
    const existing = findTable(definition, tables);
    if (!existing?.table_id) {
      plan.push({ definition, missingFields: definition.fields });
      continue;
    }
    const fields = await listFields(client, appToken, existing.table_id);
    const byName = new Map(fields.filter(field => field.field_name).map(field => [field.field_name!, field]));
    const missingFields = definition.fields.filter(field => {
      const current = byName.get(field.field_name);
      if (!current) return true;
      if (current.type !== field.type) {
        conflicts.push(`${definition.name}.${field.field_name} 当前类型为 ${current.type}，预期为 ${field.type}`);
      }
      return false;
    });
    plan.push({ definition, tableId: existing.table_id, missingFields });
  }
  if (conflicts.length) {
    throw new Error(`发现字段类型冲突，为保护现有数据未执行任何写入：\n- ${conflicts.join('\n- ')}`);
  }
  return plan;
}

async function applyPlan(client: any, appToken: string, plan: Awaited<ReturnType<typeof preflight>>) {
  const tableIds = new Map<string, string>();
  for (const item of plan) {
    const { definition } = item;
    let tableId = item.tableId;
    if (!tableId) {
      console.log(`[创建] ${definition.name}`);
      const response = await client.bitable.appTable.create({
        path: { app_token: appToken },
        data: { table: { name: definition.name, default_view_name: definition.view, fields: definition.fields } },
      });
      assertResponse(response, `创建 ${definition.name}`);
      tableId = response.data?.table_id;
      if (!tableId) throw new Error(`创建 ${definition.name} 后未返回 table_id`);
    } else if (item.missingFields.length) {
      for (const field of item.missingFields) {
        console.log(`[补齐] ${definition.name}.${field.field_name}`);
        const response = await client.bitable.appTableField.create({
          path: { app_token: appToken, table_id: tableId },
          data: field,
        });
        assertResponse(response, `创建字段 ${definition.name}.${field.field_name}`);
      }
    } else {
      console.log(`[已存在] ${definition.name}`);
    }
    tableIds.set(definition.envKey, tableId);
  }
  return tableIds;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(help);
    return;
  }
  printPermissions();
  const { appId, appSecret, appToken } = await promptCredentials();
  const client: any = new lark.Client({ appId, appSecret });

  console.log('\n[检查] 正在验证应用权限与目标多维表格访问权限…');
  console.log(`[检查] 飞书表结构版本：${SCHEMA_VERSION}`);
  const tables = await listTables(client, appToken);
  console.log(`[检查] 可以访问目标多维表格，当前已有 ${tables.length} 张数据表。`);
  const plan = await preflight(client, appToken, tables);
  const newTables = plan.filter(item => !item.tableId);
  const missingFields = plan.reduce((total, item) => total + (item.tableId ? item.missingFields.length : 0), 0);
  console.log(`[计划] 新建 ${newTables.length} 张表，补齐 ${missingFields} 个字段；其余 ${TABLES.length - newTables.length} 张表保留原数据。`);

  if (!process.argv.includes('--yes')) {
    const rl = createInterface({ input, output });
    try {
      const answer = (await rl.question('输入 yes 开始执行，其它输入取消：')).trim().toLocaleLowerCase();
      if (answer !== 'yes') {
        console.log('已取消，飞书中没有发生任何修改。');
        return;
      }
    } finally {
      rl.close();
    }
  }

  const tableIds = await applyPlan(client, appToken, plan);
  console.log('\n[完成] 飞书数据表初始化完成。将以下内容写入部署环境的 .env（不要提交密钥）：');
  console.log(`FEISHU_APP_ID=${appId}`);
  console.log('FEISHU_APP_SECRET=<使用本次输入的 App Secret>');
  console.log(`FEISHU_BASE_TOKEN=${appToken}`);
  for (const definition of TABLES) console.log(`${definition.envKey}=${tableIds.get(definition.envKey) || ''}`);
  console.log('\n建议继续执行：npm run sync:feishu-schema -- --apply（生成“ZhuiYi 字段说明”表）。');
}

void main().catch(error => {
  console.error(`\n[失败] ${error instanceof Error ? error.message : String(error)}`);
  console.error('请确认：应用已开通 bitable:app 权限，并已被添加到该多维表格且具有可编辑权限。');
  process.exitCode = 1;
});
