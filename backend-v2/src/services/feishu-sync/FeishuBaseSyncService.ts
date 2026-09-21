import { feishuClient } from '../../core/FeishuClient';
import { config } from '../../config';
import { filterFeishuRecordsForCurrentEnvironment } from '../../utils/FeishuEnvironment';

export type FeishuRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
};

export class FeishuBaseSyncService {

  // ==========================================
  // Data Conversion Utilities
  // ==========================================

  public static textValue(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.name === 'string') return record.name;
        }
        return '';
      }).join('').trim();
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text.trim();
      if (typeof record.name === 'string') return record.name.trim();
    }
    return '';
  }

  public static stringList(value: unknown, maxLength: number = 12, textMaxLength: number = 40): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map(FeishuBaseSyncService.textValue)
      .map(item => item.trim().slice(0, textMaxLength))
      .filter(Boolean)
      .slice(0, maxLength);
  }

  public static dateValue(value: unknown): Date | null {
    const parsed = typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string' && value.trim()
        ? new Date(value)
        : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  public static attachmentToken(value: unknown): string {
    if (!Array.isArray(value) || value.length === 0) return '';
    const attachment = value[0];
    if (!attachment || typeof attachment !== 'object') return '';
    const token = (attachment as Record<string, unknown>).file_token;
    return typeof token === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(token) ? token : '';
  }

  public static publishedStatus(value: unknown): 'Published' | 'Draft' | 'Hidden' {
    const status = FeishuBaseSyncService.textValue(value).toLocaleLowerCase();
    if (status === 'published') return 'Published';
    if (status === 'hidden') return 'Hidden';
    return 'Draft';
  }

  // ==========================================
  // Pagination & Fetching Helper
  // ==========================================

  public static async fetchAllRecords(tableId: string): Promise<FeishuRecord[]> {
    if (!feishuClient || !config.feishu.baseToken || !tableId) {
      throw new Error(`飞书同步配置不完整，缺少 table_id 或 token`);
    }

    const records: FeishuRecord[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: tableId,
        },
        params: { page_size: 100, page_token: pageToken },
      });

      if (response.code !== 0) {
        throw new Error(`飞书记录读取失败 (${response.code}: ${response.msg})`);
      }

      records.push(...((response.data?.items || []) as FeishuRecord[]));
      hasMore = response.data?.has_more === true;
      pageToken = response.data?.page_token;

      if (hasMore && !pageToken) throw new Error('飞书分页响应缺少 page_token');
    }

    // Default: Filter by current environment
    return filterFeishuRecordsForCurrentEnvironment(records);
  }
}
