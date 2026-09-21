import { Request, Response } from 'express';
import { prisma } from '../core/Database';

export class UserController {
  public static async handleGet0(req: Request, res: Response) {
  try {
    let user;
    if (req.user!.role === 'admin') {
      // 优先从 User 表里找名为 admin 的映射（保证展示的头像是一致的）
      user = await prisma.user.findFirst({ where: { username: 'admin' } });
      if (!user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user = { username: 'admin', avatar: '/admin-modern.png', avatarDark: '/admin-xianxia.png' } as any;
      }
    } else {
      user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    }

    if (user) {
      res.json({
        success: true,
        user: {
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          avatarDark: user.avatarDark,
          role: req.user!.role
        }
      });
    } else {
      res.status(404).json({ success: false, message: '用户不存在' });
    }
  } catch (error) {
    console.error("获取当前用户信息失败:", error);
    res.status(500).json({ success: false });
  }
  }

  public static async handlePut1(req: Request, res: Response) {
  const { username, avatar: customAvatar } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }

  // 严禁普通用户将用户名修改为系统保留字 admin（防止管理员权限被劫持）
  if (req.user!.role !== 'admin' && username.trim().toLowerCase() === 'admin') {
    return res.status(403).json({ success: false, message: '该用户名已被系统保留，无法使用' });
  }

  // 优先使用前端传来的头像字段，否则由后端生成
  const avatar = customAvatar || '/avatars/default.svg';
  const avatarDark = customAvatar || '/avatars/default.svg';

  try {
    if (req.user!.role === 'admin') {
      // 管理员更新个人资料（同步更新到 User 表中的 admin 用户）
      const user = await prisma.user.findFirst({ where: { username: 'admin' } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { username, avatar, avatarDark }
        });
      } else {
        await prisma.user.create({
          data: { email: 'admin@local', username, avatar, avatarDark }
        });
      }
      return res.json({ success: true, user: { username, avatar, avatarDark } });
    } else {
      // 普通用户更新资料
      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { username, avatar, avatarDark }
      });

      // 签发新 Token 刷新 username
      const jwt = require('jsonwebtoken');
      const { config } = require('../config');
      const jwtToken = jwt.sign(
        { id: user.id, username: user.username, role: 'user' },
        config.jwtSecret,
        { expiresIn: '60m' }
      );

      return res.json({ success: true, token: jwtToken, user: { username: user.username, avatar: user.avatar, avatarDark: user.avatarDark } });
    }
  } catch (error) {
    console.error("更新用户资料失败:", error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
  }

  public static async getCollections(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);
      const likes = await prisma.articleLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      // 因为数据库中只存了 postId，没有标题和图片等文章信息，前端渲染需要 `post` 嵌套对象
      // 我们通过一个伪造的 post 对象来适配前端渲染
      const formattedLikes = likes.map(like => ({
        id: like.id,
        userId: like.userId,
        createdAt: like.createdAt,
        post: {
          id: like.postId,
          title: `已收藏文章 ${like.postId}`, // 无法获取实时标题，暂用默认替代
          image: null
        }
      }));

      res.json({ success: true, data: formattedLikes });
    } catch (error) {
      console.error('获取收藏失败', error);
      res.status(500).json({ success: false, message: '获取收藏失败' });
    }
  }

  public static async addHistory(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { postId, postTitle } = req.body;
      if (!postId || !postTitle) {
        return res.status(400).json({ success: false, message: '参数缺失' });
      }

      await prisma.viewHistory.upsert({
        where: { userId_postId: { userId, postId } },
        update: { viewedAt: new Date(), postTitle },
        create: { userId, postId, postTitle }
      });

      // 限制每个用户最多保留 100 条记录
      const histories = await prisma.viewHistory.findMany({
        where: { userId },
        orderBy: { viewedAt: 'desc' },
        skip: 100,
        take: 100 // 删除多余的
      });

      if (histories.length > 0) {
        const idsToDelete = histories.map(h => h.id);
        await prisma.viewHistory.deleteMany({
          where: { id: { in: idsToDelete } }
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('添加历史记录失败', error);
      res.status(500).json({ success: false, message: '添加失败' });
    }
  }

  public static async getHistory(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);
      const histories = await prisma.viewHistory.findMany({
        where: { userId },
        orderBy: { viewedAt: 'desc' },
        take: 50
      });

      // 为了兼容前端渲染逻辑，需要模拟返回带有 post 对象的数据结构
      // 但我们并不希望每次都去 Feishu 查完整的文章，这里我们可以构造一个带有标题的伪 Post 对象
      const formattedHistories = histories.map(h => ({
        id: h.id,
        userId: h.userId,
        viewedAt: h.viewedAt,
        post: {
          id: h.postId,
          title: h.postTitle,
          image: null // 历史记录表没有存封面图，暂返回 null
        }
      }));

      res.json({ success: true, data: formattedHistories });
    } catch (error) {
      console.error('获取历史记录失败', error);
      res.status(500).json({ success: false, message: '获取历史记录失败' });
    }
  }

  public static async deleteHistory(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);
      const historyId = Number(req.params.id);
      await prisma.viewHistory.deleteMany({
        where: {
          id: historyId,
          userId
        }
      });
      res.json({ success: true });
    } catch (error) {
      console.error('删除单条历史记录失败', error);
      res.status(500).json({ success: false, message: '删除失败' });
    }
  }

  public static async clearHistory(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);
      await prisma.viewHistory.deleteMany({
        where: { userId }
      });
      res.json({ success: true });
    } catch (error) {
      console.error('清空历史记录失败', error);
      res.status(500).json({ success: false, message: '清空失败' });
    }
  }

}
