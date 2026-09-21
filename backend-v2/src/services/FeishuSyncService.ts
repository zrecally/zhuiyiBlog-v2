import { FeishuCommentSyncService } from './feishu-sync/FeishuCommentSyncService';
import { FeishuAlbumSyncService } from './feishu-sync/FeishuAlbumSyncService';
import { FeishuConfigSyncService } from './feishu-sync/FeishuConfigSyncService';
import { FeishuContentSyncService } from './feishu-sync/FeishuContentSyncService';
import { FeishuIdentitySyncService } from './feishu-sync/FeishuIdentitySyncService';
import { FeishuSecuritySyncService } from './feishu-sync/FeishuSecuritySyncService';
import { FeishuArticleAccessSyncService } from './feishu-sync/FeishuArticleAccessSyncService';
import { FeishuCardCodeSyncService } from './feishu-sync/FeishuCardCodeSyncService';

/**
 * Compatibility facade for existing controllers and schedulers. Domain-specific
 * synchronization logic lives in the services under ./feishu-sync.
 */
import { FeishuI18nSyncService } from './feishu-sync/FeishuI18nSyncService';

type SyncTaskName = 'admins' | 'posts' | 'users' | 'comments' | 'albums' | 'blacklist' | 'config' | 'i18n' | 'articleAccess' | 'cardCodes';

interface SyncTaskRuntime {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export class FeishuSyncService {
  private static readonly runtime = new Map<SyncTaskName, SyncTaskRuntime>();

  private static async track<T>(task: SyncTaskName, operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      const previous = this.runtime.get(task);
      this.runtime.set(task, {
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastError: null,
      });
      return result;
    } catch (error) {
      const previous = this.runtime.get(task);
      this.runtime.set(task, {
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastFailureAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message.slice(0, 160) : '未知同步错误',
      });
      throw error;
    }
  }

  /** Runtime-only summary; persisted data remains in the respective business tables. */
  public static getRuntimeStatus() {
    const tasks = Array.from(this.runtime.entries());
    const latestSuccessAt = tasks.map(([, value]) => value.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const latestFailureAt = tasks.map(([, value]) => value.lastFailureAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const hasRecentFailure = Boolean(latestFailureAt && (!latestSuccessAt || latestFailureAt > latestSuccessAt));
    return { trackedTaskCount: tasks.length, latestSuccessAt, latestFailureAt, hasRecentFailure };
  }

  public static syncAdminsToLocal() {
    return this.track('admins', () => FeishuIdentitySyncService.syncAdminsToLocal());
  }

  public static syncPostsInBackground() {
    return this.track('posts', () => FeishuContentSyncService.syncPostsInBackground());
  }

  public static syncUsersFromFeishuToLocal() {
    return this.track('users', () => FeishuIdentitySyncService.syncUsersFromFeishuToLocal());
  }

  public static syncCommentsToLocal() {
    return this.track('comments', () => FeishuCommentSyncService.syncCommentsToLocal());
  }

  public static syncAlbumsToLocal() {
    return this.track('albums', () => FeishuAlbumSyncService.syncAlbumsToLocal());
  }

  public static syncBlacklistFromFeishuToLocal() {
    return this.track('blacklist', () => FeishuSecuritySyncService.syncBlacklistFromFeishuToLocal());
  }

  public static queueConfigSyncToFeishu(key: string, value: string, isSecret: boolean) {
    return FeishuConfigSyncService.queueConfigSyncToFeishu(key, value, isSecret);
  }

  public static syncConfigFromFeishuToLocal() {
    return this.track('config', () => FeishuConfigSyncService.syncConfigFromFeishuToLocal());
  }

  public static syncI18nFromFeishuToLocal() {
    return this.track('i18n', () => FeishuI18nSyncService.syncI18nFromFeishuToLocal());
  }

  public static syncArticleAccessCodesToLocal() {
    return this.track('articleAccess', () => FeishuArticleAccessSyncService.syncToLocal());
  }

  public static syncCardCodesToLocal() {
    return this.track('cardCodes', () => FeishuCardCodeSyncService.syncToLocal());
  }
}
