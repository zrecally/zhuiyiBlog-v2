import { Request, Response } from 'express';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import crypto from 'crypto';
import { cacheService } from '../services/CacheService';
import { FeishuPublicDataService } from '../services/FeishuPublicDataService';
import {
  filterFeishuRecordsForCurrentEnvironment,
  withCurrentFeishuEnvironment,
} from '../utils/FeishuEnvironment';

export class FriendsController {
  public static async handleGet0(req: Request, res: Response) {
    try {
      // 控制台、动态站和北京静态站统一使用当前环境的飞书友邻表，
      // 避免后台继续展示已经停用的本地 Friend 表。
      const friends = await FeishuPublicDataService.fetchFriends(true);
      res.json({ success: true, data: friends });
    } catch (error) {
      console.error('获取飞书友邻列表失败:', error);
      res.status(500).json({ success: false, message: '从飞书获取友邻数据失败' });
    }
  }

  public static async handleGet1(req: Request, res: Response) {
  try {
    const friends = await FeishuPublicDataService.fetchFriends();
    res.json({ success: true, data: friends });
  } catch (error) {
    console.error("❌ 获取 Feishu 友邻数据失败:", error);
    res.status(500).json({ success: false, message: '从 Feishu 获取友邻数据失败' });
  }
  }

  // 处理友链申请
  public static async handleApply(req: Request, res: Response) {
    const { name, link, avatar, description } = req.body;

    if (!name || !link) {
      return res.status(400).json({ success: false, message: '网站名称与链接不能为空' });
    }

    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.friends) {
      return res.status(500).json({ success: false, message: '未配置飞书 CMS' });
    }

    try {
      // 1. 域名查重机制：提取主域名
      let domain = '';
      try {
        const urlObj = new URL(link);
        domain = urlObj.hostname.replace(/^www\./i, ''); // 移除 www. 前缀
      } catch (e) {
        return res.status(400).json({ success: false, message: '无效的 URL 格式' });
      }

      // 获取当前所有的友链记录 (避免缓存未更新的情况，直接拉取飞书)
      const existingRes = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.friends,
        }
      });

      if (existingRes.data && existingRes.data.items) {
        for (const record of filterFeishuRecordsForCurrentEnvironment(existingRes.data.items)) {
          const lField: any = record.fields['Link'];
          const existLink = typeof lField === 'object' && lField !== null ? (lField.link || lField.text) : String(lField || '');

          if (existLink) {
            try {
              const existUrlObj = new URL(existLink);
              const existDomain = existUrlObj.hostname.replace(/^www\./i, '');
              if (existDomain === domain) {
                return res.status(400).json({ success: false, message: '该网站链接已存在，请勿重复申请' });
              }
            } catch (e) {
              // 忽略解析失败的旧数据
            }
          }
        }
      }

      // 2. 写入飞书表格，状态为 Pending，Published 默认为 false (字符串兼容单选框)
      const createRes = await feishuClient.bitable.appTableRecord.create({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.friends,
        },
        data: {
          fields: withCurrentFeishuEnvironment({
            Name: name,
            Link: { link, text: link },
            ...(avatar ? { Avatar: { link: avatar, text: 'avatar' } } : {}),
            Description: description || '暂无简介',
            Status: 'Pending',
            Published: 'false',
            Order: 999, // 默认排序放最后
          })
        }
      });

      const recordId = createRes.data?.record?.record_id;

      // 3. 异步发送飞书交互式卡片 (不阻塞接口响应)
      // 使用配置中的 FEISHU_WEBHOOK_URL 来发送通知，避免只依赖 errorWebhookUrl
      const webhookUrl = config.feishu.errorWebhookUrl || config.feishu.webhookUrl;
      const webhookSecret = config.feishu.errorWebhookSecret || config.feishu.webhookSecret;

      if (recordId && webhookUrl) {
        const cardMsg = {
          msg_type: "interactive",
          card: {
            elements: [
              {
                tag: "div",
                text: {
                  content: `**新的友链申请**\n**网站名称**：${name}\n**网站链接**：${link}\n**简介**：${description || '无'}\n\n请审批是否通过？`,
                  tag: "lark_md"
                }
              },
              {
                tag: "action",
                actions: [
                  {
                    tag: "button",
                    text: {
                      content: "通过 (Approve)",
                      tag: "lark_md"
                    },
                    type: "primary",
                    value: {
                      action: "approve_friend",
                      record_id: recordId
                    }
                  },
                  {
                    tag: "button",
                    text: {
                      content: "拒绝 (Reject)",
                      tag: "lark_md"
                    },
                    type: "danger",
                    value: {
                      action: "reject_friend",
                      record_id: recordId
                    }
                  }
                ]
              }
            ],
            header: {
              title: {
                content: "🔗 友链申请通知",
                tag: "plain_text"
              },
              template: "blue"
            }
          }
        };

        // 处理飞书机器人签名
        const timestamp = Math.floor(Date.now() / 1000).toString();
        let sign = '';
        if (webhookSecret) {
          const stringToSign = `${timestamp}\n${webhookSecret}`;
          const hmac = crypto.createHmac('sha256', stringToSign);
          sign = hmac.digest('base64');
        }

        const finalPayload = webhookSecret ? {
          timestamp,
          sign,
          ...cardMsg
        } : cardMsg;

        // 通过 Webhook 发送卡片
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalPayload)
        })
        .then(async res => {
          const data = await res.json();
          if (data.code !== 0) {
            console.error('发送友链审批卡片失败, 飞书返回:', data);
          }
        })
        .catch(e => console.error('发送友链审批卡片网络异常:', e));
      }

      res.json({ success: true, message: '申请成功' });

    } catch (error) {
      console.error("处理友链申请失败:", error);
      res.status(500).json({ success: false, message: '申请处理失败，请稍后重试' });
    }
  }
}
