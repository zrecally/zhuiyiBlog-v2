import { Response } from 'express';
import { logger } from '../utils/logger';

export class SseService {
  private static danmakuClients: Set<Response> = new Set();
  private static userClients: Map<number, Set<Response>> = new Map();
  private static articleCommentClients: Map<string, Set<Response>> = new Map();

  /**
   * 添加一个文章评论页面的 SSE 客户端
   */
  public static addArticleCommentClient(articleId: string, res: Response) {
    if (!this.articleCommentClients.has(articleId)) {
      this.articleCommentClients.set(articleId, new Set());
    }
    this.articleCommentClients.get(articleId)!.add(res);

    res.on('close', () => {
      const clients = this.articleCommentClients.get(articleId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.articleCommentClients.delete(articleId);
        }
      }
    });
  }

  /**
   * 广播新评论给正在看该文章的所有在线客户端
   */
  public static broadcastNewComment(articleId: string, comment: any) {
    const clients = this.articleCommentClients.get(articleId);
    if (clients) {
      const data = `data: ${JSON.stringify(comment)}\n\n`;
      clients.forEach(client => {
        client.write(data);
      });
    }
  }

  /**
   * 添加一个弹幕 SSE 客户端
   */
  public static addDanmakuClient(res: Response) {
    this.danmakuClients.add(res);
    res.on('close', () => {
      this.danmakuClients.delete(res);
    });
  }

  /**
   * 广播新的弹幕给所有在线客户端
   */
  public static broadcastDanmaku(danmaku: any) {
    const data = `data: ${JSON.stringify(danmaku)}\n\n`;
    this.danmakuClients.forEach(client => {
      client.write(data);
    });
  }

  /**
   * 添加一个特定用户的通知 SSE 客户端
   */
  public static addUserClient(userId: number, res: Response) {
    if (!this.userClients.has(userId)) {
      this.userClients.set(userId, new Set());
    }
    this.userClients.get(userId)!.add(res);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 25_000);

    res.on('close', () => {
      clearInterval(heartbeat);
      const clients = this.userClients.get(userId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.userClients.delete(userId);
        }
      }
    });
  }

  /**
   * 发送通知给特定的在线用户
   */
  public static notifyUser(userId: number, notification: any) {
    const clients = this.userClients.get(userId);
    if (clients) {
      const data = `data: ${JSON.stringify(notification)}\n\n`;
      clients.forEach(client => {
        client.write(data);
      });
    }
  }

  /**
   * 获取当前在线指标，用于日志或监控
   */
  public static getStats() {
    return {
      danmakuClients: this.danmakuClients.size,
      onlineUsers: this.userClients.size
    };
  }
}
