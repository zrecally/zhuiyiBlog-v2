import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { FeishuBaseSyncService } from './FeishuBaseSyncService';
import { withCurrentFeishuEnvironment } from '../../utils/FeishuEnvironment';

export class FeishuI18nSyncService extends FeishuBaseSyncService {
  private static isI18nSyncing = false;

  public static async syncI18nFromFeishuToLocal() {
    if (this.isI18nSyncing) {
      console.log('[Sync] I18n 字典正在同步中，跳过本次拉取，避免冲突');
      return;
    }
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.i18nDict) return;

    this.isI18nSyncing = true;
    try {
      const records = await this.fetchAllRecords(config.feishu.tables.i18nDict);

      if (records && records.length > 0) {
        // 使用事务以提升批量更新性能
        await prisma.$transaction(async (tx) => {
          for (const record of records) {
            const fields = record.fields;
            if (!fields) continue;

            const key = this.textValue(fields['Key']);
            const zh_CN = this.textValue(fields['zh-CN']);
            const en_US = this.textValue(fields['en-US']);

            if (!key) continue;

            const localI18n = await (tx as any).i18nDict.findUnique({ where: { key } });

            if (localI18n) {
              if (localI18n.zh_CN !== zh_CN || localI18n.en_US !== en_US) {
                await (tx as any).i18nDict.update({
                  where: { key },
                  data: { zh_CN, en_US }
                });
                console.log(`[I18n] 已同步更新飞书多语言字典至本地: ${key}`);
              }
            } else {
              await (tx as any).i18nDict.create({
                data: {
                  key,
                  zh_CN,
                  en_US
                }
              });
              console.log(`[I18n] 从飞书拉取到新多语言字典至本地: ${key}`);
            }
          }
        });
      }
    } catch (error) {
      console.error("[Sync] 从飞书同步多语言字典失败:", error);
    } finally {
      this.isI18nSyncing = false;
    }
  }

  // 当开发环境下，前端报告了未翻译的词汇时，自动向飞书写入一条新的待翻译记录
  public static async addMissingKeyToFeishu(key: string) {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.i18nDict) return;
    try {
      // 1. 检查本地是否已经有了
      const existing = await (prisma as any).i18nDict.findUnique({ where: { key } });
      if (existing) return;

      // 2. 检查飞书中是否已经有了 (通过 filter)
      // 必须转义双引号和反斜杠，防止恶意的 key 注入破坏 Filter 语法
      const safeKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const res = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.i18nDict,
        },
        params: {
          filter: `CurrentValue.[Key]="${safeKey}"`,
        }
      });

      // 注意：这里由于可能环境还没标记，我们直接看飞书里有没有任何一条这个 key
      if (res.data?.items && res.data.items.length > 0) return;

      // 3. 写入飞书，自动带上当前 Environment
      const fields = withCurrentFeishuEnvironment({
        Key: key,
        'zh-CN': key,
        'en-US': '' // 留空等待人工或机器翻译
      });

      await feishuClient.bitable.appTableRecord.create({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.i18nDict,
        },
        data: { fields }
      });
      console.log(`[I18n] 已自动向飞书提交缺失的多语言词条: ${key}`);

      // 4. 立刻在本地也写一条，避免重复上报
      await (prisma as any).i18nDict.create({
        data: {
          key,
          zh_CN: key,
          en_US: ''
        }
      });
    } catch (e) {
      console.error(`[I18n] 自动上报缺失词条到飞书失败:`, e);
    }
  }
}
