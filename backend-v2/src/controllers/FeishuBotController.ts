import { Request, Response, NextFunction } from 'express';
import * as lark from '@larksuiteoapi/node-sdk';
import { feishuBotService } from '../services/FeishuBotService';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { cacheService } from '../services/CacheService';
import {
  isFeishuEnvironmentMatch,
  withCurrentFeishuEnvironment,
} from '../utils/FeishuEnvironment';
import { timingSafeEqual } from 'node:crypto';

function validCallbackToken(value: unknown): boolean {
  const expected = process.env.FEISHU_VERIFICATION_TOKEN || '';
  if (!expected || typeof value !== 'string') return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class FeishuBotController {
  /**
   * 接收飞书开放平台事件回调
   * 使用 lark.adaptExpress 处理路由，内部包含 Challenge 校验与事件分发
   */
  public static handleEvent(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('[Feishu Event] 收到已交由 SDK 验证的事件回调');

      const dispatcher = feishuBotService.getDispatcher();
      // autoChallenge: true 自动响应飞书服务器的 URL 验证请求
      const adapter = lark.adaptExpress(dispatcher, { autoChallenge: true });

      // 委托给飞书 SDK 适配器处理请求
      adapter(req, res);
    } catch (error) {
      console.error('[FeishuBotController] Failed to adapt express:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  /**
   * 处理飞书交互式卡片的回调 (例如点击同意/拒绝按钮)
   */
  public static async handleCardCallback(req: Request, res: Response) {
    try {
      const body = req.body;

      if (!validCallbackToken(body?.token)) {
        return res.status(403).json({ success: false, message: 'Invalid callback signature' });
      }

      // 飞书卡片验证 URL 阶段 (Challenge)
      if (body.type === 'url_verification') {
        return res.json({ challenge: body.challenge });
      }

      const actionInfo = body.action;
      if (!actionInfo || !actionInfo.value) {
        return res.json({ success: true }); // 非预期的卡片动作，忽略
      }

      const { action, record_id } = actionInfo.value;

      if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.friends) {
        return res.json({ success: false, message: 'CMS not configured' });
      }

      if (action === 'approve_friend' || action === 'reject_friend') {
        const isApproved = action === 'approve_friend';
        const currentRecord = await feishuClient.bitable.appTableRecord.get({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.friends,
            record_id,
          },
        });
        if (!currentRecord.data?.record || !isFeishuEnvironmentMatch(currentRecord.data.record.fields)) {
          return res.status(403).json({ success: false, message: '记录不属于当前数据环境' });
        }

        // 更新飞书多维表格中的 Status 字段
        await feishuClient.bitable.appTableRecord.update({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.friends,
            record_id: record_id,
          },
          data: {
            fields: withCurrentFeishuEnvironment({
              Status: isApproved ? 'Approved' : 'Pending', // 拒绝暂时保持 Pending 或你可以添加 Rejected
              Published: isApproved // 同时更新发布状态，兼容老逻辑
            })
          }
        });

        // 刷新本地友链缓存
        cacheService.friendsCache = null;
        cacheService.lastFriendsCacheTime = 0;

        // 返回更新后的卡片结构给飞书客户端 (实现按钮变为"已处理"状态)
        return res.json({
          toast: {
            type: isApproved ? "success" : "info",
            content: isApproved ? "已批准该仙缘申请" : "已婉拒该申请"
          },
          // 返回一个简单的新卡片，覆盖旧卡片
          card: {
            elements: [
              {
                tag: "div",
                text: {
                  content: isApproved ? "✅ **已通过该友链申请**" : "❌ **已婉拒该友链申请**",
                  tag: "lark_md"
                }
              }
            ]
          }
        });
      }

      res.json({ success: true });

    } catch (error) {
      console.error('[FeishuBotController] Card callback error:', error);
      res.status(500).json({ success: false });
    }
  }
}
