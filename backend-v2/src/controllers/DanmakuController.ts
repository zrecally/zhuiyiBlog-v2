import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { IpUtils } from '../utils/IpUtils';
import { logger } from '../utils/logger';
import { securityUtils } from '../utils/SecurityUtils';
import { SseService } from '../services/SseService';

export class DanmakuController {
  /**
   * SSE 弹幕流
   */
  static stream(req: Request, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 发送一个心跳/空注释防止超时
    res.write(':\n\n');

    SseService.addDanmakuClient(res);
  }

  /**
   * 获取最新弹幕列表
   */
  static async getDanmaku(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit) || 100;

      const danmakus = await prisma.danmaku.findMany({
        orderBy: {
          createdAt: 'desc'
        },
        take: limit,
        include: {
          user: {
            select: { username: true, avatar: true, avatarDark: true }
          }
        }
      });

      res.json({
        success: true,
        data: danmakus.reverse() // 返回正序以便前端按时间播放
      });
    } catch (error) {
      logger.error('Failed to fetch danmaku', error);
      res.status(500).json({ success: false, message: '获取弹幕失败' });
    }
  }

  /**
   * 发送弹幕
   */
  static async postDanmaku(req: Request, res: Response) {
    try {
      const { text, color } = req.body;
      const ip = IpUtils.getClientIp(req);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user ? (req as any).user.id : null;

      if (!text || text.trim().length === 0) {
        return res.status(400).json({ success: false, message: '弹幕内容不能为空' });
      }

      if (text.length > 100) {
        return res.status(400).json({ success: false, message: '弹幕内容过长' });
      }

      // 网址和链接检测拦截
      const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9\-\.]+\.(com|cn|net|org|xyz|top|io|cc|me|vip|club|co|tw|hk|app|shop|site|info|tv|pro))\b/i;
      const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

      if (urlRegex.test(text) || ipRegex.test(text)) {
        logger.warn(`[Danmaku] 拦截到包含网址或链接的弹幕，IP: ${ip}，内容: ${text}`);
        return res.status(400).json({ success: false, message: '为了净化环境，弹幕中禁止发送网址或IP链接' });
      }

      // 敏感词检测拦截
      if (securityUtils.containsSensitiveWords(text)) {
        logger.warn(`[Danmaku] 拦截到敏感词弹幕，IP: ${ip}，内容: ${text}`);
        return res.status(400).json({ success: false, message: '弹幕包含敏感词汇，请修改后重试' });
      }

      const validColor = color || '#FFFFFF';

      const newDanmaku = await prisma.danmaku.create({
        data: {
          text: text.trim(),
          color: validColor,
          ip: ip,
          userId
        },
        include: {
          user: {
            select: { username: true, avatar: true, avatarDark: true }
          }
        }
      });

      // 广播新弹幕给所有连接的客户端
      SseService.broadcastDanmaku(newDanmaku);

      res.json({
        success: true,
        data: newDanmaku
      });
    } catch (error) {
      logger.error('Failed to post danmaku', error);
      res.status(500).json({ success: false, message: '发送弹幕失败' });
    }
  }
}
