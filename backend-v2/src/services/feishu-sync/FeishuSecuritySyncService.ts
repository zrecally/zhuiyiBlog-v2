import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { blacklistedIPs } from '../../middlewares/RateLimitMiddleware';
import { filterFeishuRecordsForCurrentEnvironment } from '../../utils/FeishuEnvironment';

export class FeishuSecuritySyncService {
public static async syncBlacklistFromFeishuToLocal() {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.blacklist) {
      console.log(`[Security] 跳过黑名单同步: 缺少飞书客户端或表ID`);
      return;
    }
    try {
      console.log(`[Security] 开始从飞书同步黑名单...`);
      let pageToken: string | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const res = await feishuClient.bitable.appTableRecord.list({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.blacklist,
          },
          params: {
            page_size: 500,
            page_token: pageToken
          },
        });

        if (res.data && res.data.items) {
          const environmentRecords = filterFeishuRecordsForCurrentEnvironment(res.data.items);
          console.log(`[Security] 获取到当前环境飞书黑名单记录数: ${environmentRecords.length}`);
          for (const record of environmentRecords) {
            const fields = record.fields;

            let ip = '';
            if (fields.IP && Array.isArray(fields.IP)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ip = fields.IP.map((item: any) => item.text).join('');
            } else if (typeof fields.IP === 'string') {
              ip = fields.IP;
            }
            if (!ip) {
               console.log(`[Security] 忽略黑名单记录, 因为 IP 为空, 记录:`, fields);
               continue;
            }

            // 飞书的 checkbox 在不勾选时可能是 null, undefined, false 或 "false"
            const isBanned = fields.Status === true || fields.Status === 'true';
            console.log(`[Security] 检查飞书黑名单 IP: ${ip}, Status: ${fields.Status}, isBanned: ${isBanned}`);

            if (!isBanned) {
              // 如果飞书里已解禁，则从本地黑名单中移除
              if (blacklistedIPs.has(ip)) {
                blacklistedIPs.delete(ip);
                console.log(`[Security] 已通过飞书后台解禁 IP: ${ip}`);
              }
            } else {
              // 如果飞书里是封禁状态，确保本地也处于封禁状态
              if (!blacklistedIPs.has(ip)) {
                blacklistedIPs.set(ip, true);
                console.log(`[Security] 已通过飞书后台封禁 IP: ${ip}`);
              }
            }
          }
        }
        hasMore = res.data?.has_more || false;
        pageToken = res.data?.page_token;
      }
    } catch (error) {
      console.error("[Sync] 从飞书同步黑名单失败:", error);
      throw error;
    }
  }
}
