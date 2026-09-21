import { Request, Response } from 'express';
import { SseService } from '../services/SseService';
import { prisma } from '../core/Database';

export class NotificationController {
  static stream(req: Request, res: Response) {
    // @ts-ignore
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: '未登录' });

    // 设置 SSE 必需的 Header
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 强制要求 Nginx 不缓冲该连接
    res.flushHeaders(); // 确保响应头立刻发送给客户端

    // 发送一个初始消息，防止某些代理/浏览器因为没有内容而断开
    res.write('data: {"type":"connected"}\n\n');

    SseService.addUserClient(userId, res);
  }

  static async getNotifications(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: '未登录' });

      const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      const unreadCount = await prisma.notification.count({
        where: { userId, isRead: false }
      });

      res.json({ success: true, data: notifications, unreadCount });
    } catch (error) {
      res.status(500).json({ success: false, message: '获取通知失败' });
    }
  }

  static async markAsRead(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: '未登录' });

      const { notificationIds } = req.body;

      if (notificationIds && Array.isArray(notificationIds)) {
        await prisma.notification.updateMany({
          where: { id: { in: notificationIds }, userId },
          data: { isRead: true }
        });
      } else {
        // 全部已读
        await prisma.notification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true }
        });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: '操作失败' });
    }
  }
}
