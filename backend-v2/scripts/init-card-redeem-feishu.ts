import { config } from '../src/config';
import { feishuClient } from '../src/core/FeishuClient';

type FieldDefinition = {
  field_name: string;
  type: number;
  property?: { options?: Array<{ name: string; color?: number }> };
};

const apply = process.argv.includes('--apply');

const environmentOptions = {
  field_name: 'Environment', type: 3, property: {
    options: [{ name: 'Test', color: 1 }, { name: 'Production', color: 2 }],
  },
};

const cardCodesFields: FieldDefinition[] = [
  { field_name: 'Name', type: 1 },
  { field_name: 'ProductName', type: 1 },
  { field_name: 'ProductKey', type: 1 },
  { field_name: 'CodeInput', type: 1 },
  { field_name: 'File', type: 17 },
  { field_name: 'SalesChannel', type: 1 },
  { field_name: 'OrderReference', type: 1 },
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
  environmentOptions,
];

const assertResponse = (response: { code?: number; msg?: string }, operation: string) => {
  if (response.code && response.code !== 0) {
    throw new Error(`${operation}失败：${response.msg || `code=${response.code}`}`);
  }
};

type TableSpec = {
  tableName: string;
  viewName: string;
  envKey: string;
  configuredId: string;
  fields: FieldDefinition[];
};

const ensureTable = async (spec: TableSpec): Promise<string> => {
  if (!feishuClient) throw new Error('飞书客户端未配置');
  const tablesResponse = await feishuClient.bitable.appTable.list({
    path: { app_token: config.feishu.baseToken },
    params: { page_size: 100 },
  });
  assertResponse(tablesResponse, '读取飞书数据表');
  const tables = tablesResponse.data?.items || [];
  let tableId = spec.configuredId || tables.find(table => table.name === spec.tableName)?.table_id || '';

  if (!tableId) {
    console.log(`[MISSING] ${spec.tableName} 数据表`);
    if (!apply) return '';
    const created = await feishuClient.bitable.appTable.create({
      path: { app_token: config.feishu.baseToken },
      data: { table: { name: spec.tableName, default_view_name: spec.viewName, fields: spec.fields } },
    });
    assertResponse(created, `创建 ${spec.tableName} 数据表`);
    tableId = created.data?.table_id || '';
    if (!tableId) throw new Error('飞书未返回新数据表 ID');
    console.log(`[CREATED] ${spec.tableName} 数据表`);
    return tableId;
  }

  console.log(`[OK] ${spec.tableName} 数据表`);
  const fieldsResponse = await feishuClient.bitable.appTableField.list({
    path: { app_token: config.feishu.baseToken, table_id: tableId },
    params: { page_size: 100 },
  });
  assertResponse(fieldsResponse, `读取 ${spec.tableName} 字段`);
  const existing = new Map((fieldsResponse.data?.items || []).map(field => [field.field_name, field]));

  for (const definition of spec.fields) {
    const current = existing.get(definition.field_name);
    if (current) {
      if (current.type !== definition.type) {
        throw new Error(`${spec.tableName}.${definition.field_name} 类型为 ${current.type}，预期 ${definition.type}；为避免破坏数据已停止`);
      }
      console.log(`[OK] ${spec.tableName}.${definition.field_name}`);
      continue;
    }
    console.log(`[MISSING] ${spec.tableName}.${definition.field_name}`);
    if (!apply) continue;
    const created = await feishuClient.bitable.appTableField.create({
      path: { app_token: config.feishu.baseToken, table_id: tableId },
      data: definition,
    });
    assertResponse(created, `创建 ${spec.tableName}.${definition.field_name}`);
    console.log(`[CREATED] ${spec.tableName}.${definition.field_name}`);
  }
  return tableId;
};

const main = async () => {
  if (!feishuClient || !config.feishu.baseToken) {
    throw new Error('需要 FEISHU_APP_ID、FEISHU_APP_SECRET 和 FEISHU_BASE_TOKEN');
  }

  // 仅在显式启用 CARD_REDEEM_FEISHU_SYNC 时才需要飞书表；默认本地直发不依赖飞书。
  const cardCodesTableId = await ensureTable({
    tableName: 'CardCodes',
    viewName: '卡密管理',
    envKey: 'FEISHU_CARD_CODES_TABLE_ID',
    configuredId: config.feishu.tables.cardCodes,
    fields: cardCodesFields,
  });

  console.log(apply ? '飞书卡密表初始化完成。' : '预检完成；使用 --apply 仅新增上方缺失项。');
  if (cardCodesTableId) console.log(`FEISHU_CARD_CODES_TABLE_ID=${cardCodesTableId}`);
};

void main().catch(error => {
  console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
