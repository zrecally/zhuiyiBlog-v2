import { Request, Response } from 'express';
import { FeishuSyncService } from '../services/FeishuSyncService';
import { FeishuPublicDataService } from '../services/FeishuPublicDataService';
import { StaticPublishControlService } from '../services/StaticPublishControlService';
import { StaticSnapshotService } from '../services/static-snapshot/StaticSnapshotService';
import { ProjectsController } from './ProjectsController';

export class AdminSyncController {
  public static async syncModule(req: Request, res: Response) {
    const { module } = req.params;

    try {
      switch (module) {
        case 'posts':
          await FeishuSyncService.syncPostsInBackground();
          break;
        case 'comments':
          // 防止全量拉取导致请求超时，改为后台异步执行，直接响应成功
          FeishuSyncService.syncCommentsToLocal().catch(e => console.error('[Sync] 后台同步评论失败:', e));
          return res.json({ success: true, message: `comments 模块同步任务已提交至后台运行` });
        case 'albums':
          {
            const report = await FeishuSyncService.syncAlbumsToLocal();
            const snapshot = await StaticSnapshotService.publishAfterFeishuSync();
            const publishRequested = Boolean(snapshot && StaticPublishControlService.isConfigured());
            if (snapshot && publishRequested) {
              await StaticPublishControlService.requestPublish(snapshot, req.user?.username || 'admin');
            }
            return res.json({
              success: true,
              message: `相册同步完成：读取 ${report.remoteRecords} 条，公开 ${report.published} 张，下载 ${report.downloaded} 张，更新 ${report.updated} 张，失败 ${report.failed} 张${publishRequested ? '；已请求发布北京静态站快照' : ''}`,
            });
          }
        case 'friends':
          {
            // 友链本身以飞书表为权威数据源；强制刷新缓存后重新生成静态快照，
            // 确保动态站与北京静态站在一次操作后使用同一份友链列表。
            const friends = await FeishuPublicDataService.fetchFriends(true);
            const snapshot = await StaticSnapshotService.publishAfterFeishuSync();
            const publishRequested = Boolean(snapshot && StaticPublishControlService.isConfigured());
            if (snapshot && publishRequested) {
              await StaticPublishControlService.requestPublish(snapshot, req.user?.username || 'admin');
            }
            return res.json({
              success: true,
              message: `友链同步完成：公开 ${friends.length} 条${publishRequested ? '；已请求发布北京静态站快照' : ''}`,
            });
          }
        case 'users':
          {
            const result = await FeishuSyncService.syncUsersFromFeishuToLocal();
            return res.json({
              success: true,
              message: result
                ? `用户同步完成：保留 ${result.retained} 个最新状态，清理 ${result.duplicatesRemoved} 条重复记录，补标 ${result.environmentsBackfilled} 条环境记录`
                : '用户同步已跳过：飞书用户表未配置',
            });
          }
        case 'projects':
          {
            const projects = await ProjectsController.refreshProjectsCache();
            // 北京静态站不暴露业务 API；项目集刷新后必须同时生成并下发快照，
            // 使静态项目页读取同一批 projects.json 数据。
            const snapshot = await StaticSnapshotService.publishAfterFeishuSync();
            const publishRequested = Boolean(snapshot && StaticPublishControlService.isConfigured());
            if (snapshot && publishRequested) {
              await StaticPublishControlService.requestPublish(snapshot, req.user?.username || 'admin');
            }
            return res.json({
              success: true,
              message: `项目集同步完成：已从飞书读取并刷新 ${projects.length} 个已发布项目${publishRequested ? '；已请求发布北京静态站快照' : ''}`,
            });
          }
        case 'config':
          await FeishuSyncService.syncConfigFromFeishuToLocal();
          await FeishuSyncService.syncI18nFromFeishuToLocal();
          break;
        case 'blacklist':
          await FeishuSyncService.syncBlacklistFromFeishuToLocal();
          break;
        case 'article-access':
          {
            // The production control plane may intentionally omit the paused
            // article-access service. Keep this optional admin action safe
            // until that feature is formally released.
            const articleAccessService = FeishuSyncService as typeof FeishuSyncService & {
              syncArticleAccessCodesToLocal?: () => Promise<{
                skipped: boolean;
                imported: number;
                updated: number;
                revoked: number;
              }>;
            };
            if (!articleAccessService.syncArticleAccessCodesToLocal) {
              return res.json({ success: true, message: '一次性文章密码同步已跳过：功能尚未上线' });
            }
            const result = await articleAccessService.syncArticleAccessCodesToLocal();
            return res.json({
              success: true,
              message: result.skipped
                ? '一次性文章密码同步已跳过：功能或飞书数据表未配置'
                : `一次性文章密码同步完成：导入 ${result.imported} 条，更新 ${result.updated} 条，撤销 ${result.revoked} 条`,
            });
          }
        case 'card-codes':
          {
            const result = await FeishuSyncService.syncCardCodesToLocal();
            return res.json({
              success: true,
              message: result.skipped
                ? '卡密同步已跳过：功能或飞书数据表未配置'
                : `卡密同步完成：导入 ${result.imported} 条，更新 ${result.updated} 条，撤销 ${result.revoked} 条`,
            });
          }
        default:
          return res.status(400).json({ success: false, message: '无效的同步模块' });
      }

      return res.json({ success: true, message: `${module} 模块同步成功` });
    } catch (error: any) {
      console.error(`[AdminSync] 同步 ${module} 失败:`, error);
      return res.status(500).json({ success: false, message: `同步 ${module} 失败: ${error.message}` });
    }
  }
}
