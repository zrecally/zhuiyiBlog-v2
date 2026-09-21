import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { cacheService } from './CacheService';
import { filterFeishuRecordsForCurrentEnvironment } from '../utils/FeishuEnvironment';

export interface PublicTimelineItem {
  id: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  category: 'Timeline';
  image: string;
}

export interface PublicFriendItem {
  id: string;
  name: string;
  link: string;
  avatar: string;
  description: string;
  order: number;
}

const CACHE_TTL_MS = 60_000;

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      }
      return '';
    }).join('');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.link === 'string') return record.link;
    if (typeof record.text === 'string') return record.text;
  }
  return value == null ? '' : String(value);
};

const isPublishedValue = (value: unknown): boolean => (
  value === true || value === 'true' || value === 'True' || value === '是' || value === 'Yes'
);

export class FeishuPublicDataService {
  public static async fetchTimeline(force = false): Promise<PublicTimelineItem[]> {
    const now = Date.now();
    if (!force && cacheService.timelineCache && now - cacheService.lastTimelineCacheTime < CACHE_TTL_MS) {
      return cacheService.timelineCache as PublicTimelineItem[];
    }
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.timeline) {
      if (config.feishu.dataEnvironment === 'Test' && !config.feishu.appId && !config.feishu.appSecret) {
        return Array.isArray(cacheService.timelineCache) ? cacheService.timelineCache as PublicTimelineItem[] : [];
      }
      throw new Error('后端未配置动态专属的 Feishu Table ID');
    }

    const response = await feishuClient.bitable.appTableRecord.list({
      path: {
        app_token: config.feishu.baseToken,
        table_id: config.feishu.tables.timeline,
      },
      params: { page_size: 500 },
    });
    if (typeof response.code === 'number' && response.code !== 0) {
      throw new Error(`飞书动态列表返回错误码 ${response.code}`);
    }

    const timeline = filterFeishuRecordsForCurrentEnvironment(response.data?.items || []).flatMap(record => {
      const fields = record.fields;
      if (!fields || Object.keys(fields).length === 0 || fields.Published === false) return [];

      const timestamp = Number(fields.Date);
      const dateValue = new Date(timestamp);
      if (!Number.isFinite(timestamp) || Number.isNaN(dateValue.getTime()) || dateValue.getTime() > now) return [];

      const tags = Array.isArray(fields.Tags)
        ? fields.Tags.map(tag => {
          if (typeof tag === 'string') return tag;
          if (tag && typeof tag === 'object' && 'name' in tag) return String(tag.name);
          return String(tag);
        })
        : [];
      const cover = Array.isArray(fields.Cover) ? fields.Cover[0] : fields.Cover;

      return [{
        id: String(record.record_id || ''),
        title: textValue(fields.Name) || '无标题',
        summary: textValue(fields.Summary),
        date: `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(dateValue.getDate()).padStart(2, '0')} ${String(dateValue.getHours()).padStart(2, '0')}:${String(dateValue.getMinutes()).padStart(2, '0')}`,
        tags,
        category: 'Timeline' as const,
        image: textValue(cover),
      }];
    }).filter(item => item.id);

    timeline.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    cacheService.timelineCache = timeline;
    cacheService.lastTimelineCacheTime = now;
    return timeline;
  }

  public static async fetchFriends(force = false): Promise<PublicFriendItem[]> {
    const now = Date.now();
    if (!force && cacheService.friendsCache && now - cacheService.lastFriendsCacheTime < CACHE_TTL_MS) {
      return cacheService.friendsCache as PublicFriendItem[];
    }
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.friends) {
      if (config.feishu.dataEnvironment === 'Test' && !config.feishu.appId && !config.feishu.appSecret) {
        return Array.isArray(cacheService.friendsCache) ? cacheService.friendsCache as PublicFriendItem[] : [];
      }
      throw new Error('后端未配置友邻 Feishu Table ID');
    }

    const response = await feishuClient.bitable.appTableRecord.list({
      path: {
        app_token: config.feishu.baseToken,
        table_id: config.feishu.tables.friends,
      },
      params: { page_size: 500 },
    });
    if (typeof response.code === 'number' && response.code !== 0) {
      throw new Error(`飞书友邻列表返回错误码 ${response.code}`);
    }

    const friends = filterFeishuRecordsForCurrentEnvironment(response.data?.items || []).flatMap(record => {
      const fields = record.fields;
      if (!fields || !isPublishedValue(fields.Published) || fields.Status !== 'Approved') return [];
      const name = textValue(fields.Name);
      if (!name) return [];

      return [{
        id: String(record.record_id || ''),
        name,
        link: textValue(fields.Link),
        avatar: textValue(fields.Avatar),
        description: textValue(fields.Content) || textValue(fields.Description),
        order: Number(fields.Order) || 0,
      }];
    }).filter(item => item.id);

    friends.sort((left, right) => left.order - right.order);
    cacheService.friendsCache = friends;
    cacheService.lastFriendsCacheTime = now;
    return friends;
  }
}
