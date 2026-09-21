import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import {
  filterFeishuRecordsForCurrentEnvironment,
  withCurrentFeishuEnvironment,
} from '../../utils/FeishuEnvironment';

export class FeishuConfigSyncService {
private static configSyncQueue: Array<{
    key: string;
    value: string;
    isSecret: boolean;
    action: 'UPDATE' | 'CREATE';
  }> = [];

private static isConfigSyncing = false;

public static async queueConfigSyncToFeishu(key: string, value: string, isSecret: boolean) {
    // 脱敏写入队列
    const syncValue = isSecret ? '********' : value;
    this.configSyncQueue.push({ key, value: syncValue, isSecret, action: 'UPDATE' });
    this.processConfigSyncQueue();
  }

private static async processConfigSyncQueue() {
    if (this.isConfigSyncing || this.configSyncQueue.length === 0) return;
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.config) {
      this.configSyncQueue = []; // 如果没配置，直接清空队列
      return;
    }

    this.isConfigSyncing = true;
    try {
      while (this.configSyncQueue.length > 0) {
        const batch = this.configSyncQueue.splice(0, 10); // 每次处理 10 条

        // 获取现有的配置列表，以便查找 record_id
        const res = await feishuClient.bitable.appTableRecord.list({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.config,
          },
          params: { page_size: 500 },
        });

        const records = filterFeishuRecordsForCurrentEnvironment(res.data?.items || []);
        const keyToRecordId = new Map<string, string>();
        records.forEach(r => {
          const k = typeof r.fields.Key === 'string' ? r.fields.Key : (Array.isArray(r.fields.Key) ? r.fields.Key.map((i: any) => i.text).join('') : '');
          if (k) keyToRecordId.set(k, r.record_id as string);
        });

        for (const item of batch) {
          const recordId = keyToRecordId.get(item.key);
          const fields = withCurrentFeishuEnvironment({
            Key: item.key,
            Value: item.value,
            IsSecret: item.isSecret ? 'true' : 'false',
            UpdatedAt: new Date().toISOString()
          });

          try {
            if (recordId) {
              await feishuClient.bitable.appTableRecord.update({
                path: {
                  app_token: config.feishu.baseToken,
                  table_id: config.feishu.tables.config,
                  record_id: recordId,
                },
                data: { fields }
              });
            } else {
              const createRes = await feishuClient.bitable.appTableRecord.create({
                path: {
                  app_token: config.feishu.baseToken,
                  table_id: config.feishu.tables.config,
                },
                data: { fields }
              });
              // 更新本地的 feishuRecordId
              if (createRes.data?.record?.record_id) {
                await prisma.systemConfig.update({
                  where: { key: item.key },
                  data: { feishuRecordId: createRes.data.record.record_id }
                });
              }
            }
          } catch (e) {
            console.error(`[Sync] 同步配置 ${item.key} 到飞书失败:`, e);
          }

          // 每次 API 调用间隔 200ms 以避免超时和限流
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    } finally {
      this.isConfigSyncing = false;
    }
  }

public static async syncConfigFromFeishuToLocal() {
    if (this.isConfigSyncing) {
      console.log('[Sync] 配置轻队列正在向飞书同步数据，跳过本次定时拉取，避免冲突...');
      return;
    }
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.config) return;
    try {
      const res = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.config,
        },
        params: { page_size: 500 },
      });

      if (res.data && res.data.items) {
        for (const record of filterFeishuRecordsForCurrentEnvironment(res.data.items)) {
          const fields = record.fields;

          let key = '';
          if (fields.Key && Array.isArray(fields.Key)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            key = fields.Key.map((item: any) => item.text).join('');
          } else if (typeof fields.Key === 'string') {
            key = fields.Key;
          }

          let value = '';
          if (fields.Value && Array.isArray(fields.Value)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = fields.Value.map((item: any) => item.text).join('');
          } else if (typeof fields.Value === 'string') {
            value = fields.Value;
          }

          let isSecretStr = '';
          if (fields.IsSecret && Array.isArray(fields.IsSecret)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            isSecretStr = fields.IsSecret.map((item: any) => item.text).join('');
          } else if (typeof fields.IsSecret === 'string') {
            isSecretStr = fields.IsSecret;
          }
          const isSecret = isSecretStr === 'true' || isSecretStr === 'True';

          if (!key) continue;

          // 飞书中是隐藏的脱敏数据（********），本地如果存在真实数据则不覆盖。
          // 但如果是普通数据或本地不存在，则更新/创建。
          let localConfig = await prisma.systemConfig.findUnique({ where: { key } });

          if (localConfig) {
            // 只有当不是密文，且值有变化时才更新本地
            if (value !== '********' && localConfig.value !== value) {
              await prisma.systemConfig.update({
                where: { key },
                data: { value, isSecret, feishuRecordId: record.record_id as string }
              });
              console.log(`[Config] 已同步更新飞书配置至本地: ${key}`);
            }
          } else {
            // 本地不存在，创建
            await prisma.systemConfig.create({
              data: {
                key,
                value,
                isSecret,
                feishuRecordId: record.record_id as string
              }
            });
            console.log(`[Config] 从飞书拉取到新配置至本地: ${key}`);
          }
        }
      }
    } catch (error) {
      console.error("[Sync] 从飞书同步配置列表失败:", error);
      throw error;
    }
  }
}
