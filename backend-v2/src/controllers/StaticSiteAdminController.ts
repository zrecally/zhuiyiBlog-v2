import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { StaticPublishControlService } from '../services/StaticPublishControlService';
import { StaticSnapshotService } from '../services/static-snapshot/StaticSnapshotService';
import { IpUtils } from '../utils/IpUtils';

export class StaticSiteAdminController {
  public static async getStaticSitesStatus(_req: Request, res: Response) {
    try {
      const status = await StaticPublishControlService.getStatus();
      const isSynchronized = status.state === 'published' || status.state === 'up_to_date';
      const syncLogStatus = isSynchronized
        ? 'success'
        : status.state === 'failed' || status.state === 'not_configured'
          ? 'failed'
          : 'pending';

      // 这里必须直接使用发布器上报的状态。此前无论发布器返回什么，
      // 都伪造为“同步正常”，会把失败、未配置与等待上报误导成成功。
      const data = {
        syncStatus: {
          lastSyncTime: status.checkedAt || status.publishedAt || '',
          status: syncLogStatus,
          syncLogs: [
            {
              id: 'current',
              file: status.version ? `static_bundle_${status.version}.zip` : 'static_bundle.zip',
              status: syncLogStatus,
              time: status.checkedAt || status.publishedAt || new Date().toISOString(),
            }
          ]
        },
        // 发布器逐目标上报时，一个目标一张节点卡；旧版单目标 status.json 回退为单条。
        sites: status.targets?.length
          ? status.targets.map((target, index) => ({
              id: `node_beijing_${index}`,
              // 兼容未配置逐目标展示名(ZHUIYI_STATIC_DEST_NAMES)的部署：单条时用中性节点名，多条回落为主机地址。
              name: target.name || (status.targets!.length === 1 ? '北京静态站' : target.host),
              description: '快照由后端生成，发布器逐目标原子发布',
              state: target.state,
              version: target.version,
              checkedAt: status.checkedAt,
              publishedAt: target.publishedAt,
              destination: target.host,
              message: target.message
                || (target.state === 'up_to_date' || target.state === 'published'
                  ? '与当前快照一致'
                  : '发布状态尚未确认'),
              configured: status.configured,
              isPublishing: target.state === 'running',
              loading: false
            }))
          : [
              {
                id: 'node_beijing',
                name: '北京静态站',
                description: '快照由后端生成，发布器逐目标原子发布',
                state: status.state,
                version: status.version,
                checkedAt: status.checkedAt,
                publishedAt: status.publishedAt,
                destination: status.destination || '北京静态站',
                // 发布器会携带可读的失败原因（SSH、校验或切换失败等），不要覆盖它。
                message: status.message || (isSynchronized ? '静态站与当前快照一致' : '发布状态尚未确认'),
                configured: status.configured,
                isPublishing: status.state === 'running',
                loading: false
              }
            ]
      };

      return res.json({ success: true, data });
    } catch (error) {
      console.error('[StaticSiteAdmin] 读取发布状态失败:', error);
      return res.status(500).json({ success: false, message: '读取静态站状态失败' });
    }
  }

  public static async getStatus(_req: Request, res: Response) {
    try {
      const status = await StaticPublishControlService.getStatus();
      return res.json({ success: true, data: status });
    } catch (error) {
      console.error('[StaticSiteAdmin] 读取发布状态失败:', error);
      return res.status(500).json({ success: false, message: '读取北京站发布状态失败' });
    }
  }

  public static async publish(req: Request, res: Response) {
    try {
      const snapshot = await StaticSnapshotService.publishAfterFeishuSync();
      if (!snapshot) {
        return res.status(409).json({ success: false, message: '静态快照未启用或文章缓存尚未就绪' });
      }

      await StaticPublishControlService.requestPublish(snapshot, req.user?.username || 'admin');
      const clientIp = IpUtils.getClientIp(req);
      void prisma.auditLog.create({
        data: {
          ip: clientIp,
          action: 'BEIJING_STATIC_PUBLISH',
          details: `管理员请求发布北京静态站版本 ${snapshot.version}`,
        },
      }).catch(error => console.error('[StaticSiteAdmin] 写入审计日志失败:', error));

      return res.status(202).json({
        success: true,
        message: '快照已生成，宿主机正在通过私网发布',
        data: {
          version: snapshot.version,
          changed: snapshot.changed,
          postCount: snapshot.postCount,
          skippedCount: snapshot.skippedCount,
        },
      });
    } catch (error) {
      console.error('[StaticSiteAdmin] 请求发布失败:', error);
      return res.status(500).json({ success: false, message: '北京站发布请求失败' });
    }
  }
}
