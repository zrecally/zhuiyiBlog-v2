import { config } from '../src/config';
import { feishuClient } from '../src/core/FeishuClient';

type FieldDefinition = {
  field_name: string;
  type: number;
  property?: { options?: Array<{ name: string; color?: number }> };
};

const apply = process.argv.includes('--apply');
const accessFields: FieldDefinition[] = [
  { field_name: 'Name', type: 1 },
  { field_name: 'PostID', type: 1 },
  { field_name: 'PasswordInput', type: 1 },
  { field_name: 'BindIP', type: 7 },
  { field_name: 'GrantHours', type: 2 },
  { field_name: 'ExpiresAt', type: 5 },
  {
    field_name: 'Status', type: 3, property: {
      options: [
        { name: 'Active', color: 1 },
        { name: 'Used', color: 2 },
        { name: 'Revoked', color: 3 },
        { name: 'Expired', color: 4 },
        { name: 'Error', color: 5 },
      ],
    },
  },
  { field_name: 'UsedAt', type: 5 },
  { field_name: 'UsedIP', type: 1 },
  { field_name: 'CodeHint', type: 1 },
  { field_name: 'SyncMessage', type: 1 },
  {
    field_name: 'Environment', type: 3, property: {
      options: [{ name: 'Test', color: 1 }, { name: 'Production', color: 2 }],
    },
  },
];

const postFields: FieldDefinition[] = [
  {
    field_name: 'AccessMode', type: 3, property: {
      options: [
        { name: 'Public', color: 1 },
        { name: 'Approval', color: 2 },
        { name: 'Password', color: 3 },
      ],
    },
  },
  { field_name: 'ShowLockedMetadata', type: 7 },
];

const assertResponse = (response: { code?: number; msg?: string }, operation: string) => {
  if (response.code && response.code !== 0) {
    throw new Error(`${operation}失败：${response.msg || `code=${response.code}`}`);
  }
};

const ensureFields = async (tableId: string, definitions: FieldDefinition[], label: string) => {
  if (!feishuClient) throw new Error('飞书客户端未配置');
  const response = await feishuClient.bitable.appTableField.list({
    path: { app_token: config.feishu.baseToken, table_id: tableId },
    params: { page_size: 100 },
  });
  assertResponse(response, `读取 ${label} 字段`);
  const existing = new Map((response.data?.items || []).map(field => [field.field_name, field]));

  for (const definition of definitions) {
    const current = existing.get(definition.field_name);
    if (current) {
      if (current.type !== definition.type) {
        throw new Error(`${label}.${definition.field_name} 类型为 ${current.type}，预期 ${definition.type}；为避免破坏数据已停止`);
      }
      console.log(`[OK] ${label}.${definition.field_name}`);
      continue;
    }
    console.log(`[MISSING] ${label}.${definition.field_name}`);
    if (!apply) continue;
    const created = await feishuClient.bitable.appTableField.create({
      path: { app_token: config.feishu.baseToken, table_id: tableId },
      data: definition,
    });
    assertResponse(created, `创建 ${label}.${definition.field_name}`);
    console.log(`[CREATED] ${label}.${definition.field_name}`);
  }
};

const main = async () => {
  if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.posts) {
    throw new Error('需要 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_BASE_TOKEN 和 FEISHU_POSTS_TABLE_ID');
  }

  const tablesResponse = await feishuClient.bitable.appTable.list({
    path: { app_token: config.feishu.baseToken },
    params: { page_size: 100 },
  });
  assertResponse(tablesResponse, '读取飞书数据表');
  const tables = tablesResponse.data?.items || [];
  const configuredId = config.feishu.tables.articleAccessCodes;
  let accessTableId = configuredId || tables.find(table => table.name === 'ArticleAccessCodes')?.table_id || '';

  if (!accessTableId) {
    console.log('[MISSING] ArticleAccessCodes 数据表');
    if (apply) {
      const created = await feishuClient.bitable.appTable.create({
        path: { app_token: config.feishu.baseToken },
        data: {
          table: {
            name: 'ArticleAccessCodes',
            default_view_name: '密码管理',
            fields: accessFields,
          },
        },
      });
      assertResponse(created, '创建 ArticleAccessCodes 数据表');
      accessTableId = created.data?.table_id || '';
      if (!accessTableId) throw new Error('飞书未返回新数据表 ID');
      console.log('[CREATED] ArticleAccessCodes 数据表');
    }
  } else {
    console.log('[OK] ArticleAccessCodes 数据表');
    await ensureFields(accessTableId, accessFields, 'ArticleAccessCodes');
  }

  await ensureFields(config.feishu.tables.posts, postFields, 'Posts');
  if (!apply) {
    console.log('预检完成；使用 --apply 仅新增上方缺失项。');
  } else {
    console.log('飞书文章密码结构初始化完成。');
  }
  if (accessTableId) {
    console.log(`FEISHU_ARTICLE_ACCESS_CODES_TABLE_ID=${accessTableId}`);
  }
};

void main().catch(error => {
  console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
