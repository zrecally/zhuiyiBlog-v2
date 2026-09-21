import { Request, Response } from 'express';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { IpUtils } from '../utils/IpUtils';
import { securityUtils } from '../utils/SecurityUtils';
import { recentCommentsCache, writeQueue } from '../middlewares/RateLimitMiddleware';
import { withCurrentFeishuEnvironment } from '../utils/FeishuEnvironment';

export class FeedbackController {
  public static async handlePost0(req: Request, res: Response) {
  try {
    const { type, content } = req.body;
    const user = req.user;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '反馈内容不能为空' });
    }

    if (securityUtils.containsSensitiveWords(content)) {
      return res.status(400).json({ success: false, message: '您的反馈包含不当词汇，请修改后再试。' });
    }

    // ==========================================
  // 防灌水/刷屏检测 (Anti-Spam) - 12小时限制
  // ==========================================
  // 1. 检查同一个 IP 或同一个用户是否在 12 小时内提交过 Bug/建议
  const clientIp = IpUtils.getClientIp(req);
  const spamKey = req.user!.id ? `feedback_user_${req.user!.id}` : `feedback_ip_${clientIp}`;
  const lastFeedback = recentCommentsCache.get(spamKey);
  const now = Date.now();

  if (lastFeedback) {
    const timeDiff = now - lastFeedback.time;
    // 限制：12小时 (12 * 60 * 60 * 1000 毫秒) 内只允许提交一次反馈
    if (timeDiff < 12 * 60 * 60 * 1000) {
      return res.status(429).json({ success: false, message: '为了防止滥用，12 小时内只允许提交一次反馈，感谢您的理解。' });
    }
  }

  // 更新防灌水缓存
  recentCommentsCache.set(spamKey, { time: now, content });
  // ==========================================

    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.feedback) {
      console.warn('[Feedback] 未配置 Feishu 客户端或 FEISHU_FEEDBACK_TABLE_ID，放弃写入');
      // 未配置数据库时，依然给前端返回成功，避免报错
      return res.json({ success: true, message: '反馈已记录 (本地模拟)' });
    }

    const typeLabel = type === 'bug' ? 'bug' : 'suggestion';

    // 使用全局队列进行排队，防止并发过高
    await writeQueue.add(async () => {
      await feishuClient?.bitable.appTableRecord.create({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.feedback,
        },
        data: {
          fields: withCurrentFeishuEnvironment({
            'Title': `${user?.username || '匿名用户'} 的 ${typeLabel === 'bug' ? '提交Bug' : '需求建议'}`,
            'Type': typeLabel,
            'Content': content.substring(0, 2000), // 限制长度
            'Status': 'pending',
            'Date': Date.now() // Feishu DateTime field requires timestamp in milliseconds
          })
        }
      });
    });

    res.json({ success: true, message: '反馈提交成功' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Feedback] 写入 Feishu 失败:', error.message || error);
    if (error.body) {
      console.error('[Feedback] Feishu API 详细错误:', error.body);
    }
    res.status(500).json({ success: false, message: '服务器内部错误，反馈提交失败' });
  }
  }

}
