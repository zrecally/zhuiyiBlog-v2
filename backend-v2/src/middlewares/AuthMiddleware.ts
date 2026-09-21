import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import LRUCache from 'lru-cache';
import { config } from '../config';
import { prisma } from '../core/Database';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: number;
      role: string;
      username: string;
      [key: string]: any;
    }
  }
}

// 缓存用户封禁状态（TTL 60秒），保证管理员或飞书封禁后快速生效，同时避免频繁查库
export const userActiveCache = new LRUCache<number, boolean>({
  max: 5000,
  ttl: 60 * 1000,
});

export class AuthMiddleware {
  public static async requireAuth(req: Request, res: Response, next: NextFunction) {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: '未登录，请先登录' });
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as Express.User;
      req.user = decoded;

      // 普通用户核验封禁状态，杜绝被封禁用户凭旧 JWT 逃逸
      if (decoded.role !== 'admin' && typeof decoded.id === 'number') {
        let isActive = userActiveCache.get(decoded.id);
        if (isActive === undefined) {
          try {
            const userRecord = await prisma.user.findUnique({
              where: { id: decoded.id },
              select: { isActive: true },
            });
            isActive = userRecord ? userRecord.isActive : true;
            userActiveCache.set(decoded.id, isActive);
          } catch {
            isActive = true; // 数据库偶发异常时不阻塞未封禁用户
          }
        }
        if (isActive === false) {
          return res.status(403).json({ success: false, message: '您的账号已被封禁或禁止登录' });
        }
      }

      next();
    } catch (error) {
      return res.status(401).json({ success: false, message: '登录无效或已过期，请重新登录' });
    }
  }

  public static requireAdmin(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未登录，请先登录' });
    }

    const token = authHeader.split(' ')[1];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decoded: any = jwt.verify(token, config.jwtSecret);
      if (decoded.role !== 'admin') {
        return res.status(403).json({ success: false, message: '权限不足，仅管理员可访问' });
      }
      req.user = decoded as Express.User;
      next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Token 无效或已过期，请重新登录' });
    }
  }

  public static getOptionalUser(req: Request) {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (token) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return jwt.verify(token, config.jwtSecret) as any;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}
