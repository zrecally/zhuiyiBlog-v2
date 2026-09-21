import { Request, Response } from 'express';
import { prisma } from '../../core/Database';
import { SseService } from '../../services/SseService';

export class CommentReadController {
  public static async handleGet0(req: Request, res: Response) {
  const { postId } = req.params;
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: String(postId) },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { username: true, avatar: true, avatarDark: true }
        }
      }
    });
    const publicIdByLocalId = new Map(comments.map(comment => [
      comment.id,
      comment.feishuRecordId || String(comment.id),
    ]));
    const data = comments.map(comment => ({
      id: comment.feishuRecordId || String(comment.id),
      postId: comment.postId,
      content: comment.content,
      user: comment.user,
      createdAt: comment.createdAt.toISOString(),
      parentId: comment.parentId
        ? (publicIdByLocalId.get(comment.parentId) || String(comment.parentId))
        : undefined,
      likes: comment.likes,
      dislikes: comment.dislikes,
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error("获取评论失败:", error);
    res.status(500).json({ success: false, message: '获取评论失败' });
  }
  }

  public static handleStreamComments(req: Request, res: Response) {
    const postId = req.params.postId as string;

    // 设置 SSE 请求头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 发送一个初始消息确认连接
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    SseService.addArticleCommentClient(postId, res);
  }

  public static async handleGet2(req: Request, res: Response) {
    const articleId = req.params.articleId as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 50); // 默认单页 50 条父评论
    const skip = (page - 1) * limit;

    try {
      // 1. 先查出总父评论数，用于前端分页
      const totalParents = await prisma.comment.count({
        where: { postId: articleId, parentId: null }
      });

      // 2. 分页获取父评论
      const parentComments = await prisma.comment.findMany({
        where: { postId: articleId, parentId: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { username: true, avatar: true, avatarDark: true } }
        }
      });

      const parentIds = parentComments.map(c => c.id);

      // 3. 获取这些父评论下的所有子评论（这里假设最多两级结构，如果有多级，可以 fetch 该文章下所有的子评论，但在万级数据下，为防止炸内存，我们仅 fetch 关联的子评论）
      // 如果前端是任意层级的树，稳妥起见，我们查出当前 postId 下所有的子评论（因为子评论通常较少，或者可以加层级限制）
      // 为了防止子评论也达到万级，我们只拉取父评论是本次分页里的，以及递归下去的。
      // 简单起见，如果文章评论总数极大，我们将获取该文章的所有非顶级评论，但只在前端构建属于这些 parent 的树。
      // 为了严格控制 payload，我们只获取属于这些 parentIds 的子评论（单层嵌套）

      const childComments = await prisma.comment.findMany({
        where: {
          postId: articleId,
          parentId: { not: null }
        },
        orderBy: { createdAt: 'asc' }, // 子评论一般按时间正序
        include: {
          user: { select: { username: true, avatar: true, avatarDark: true } }
        }
      });

      const allComments = [...parentComments, ...childComments];
      const publicIdByLocalId = new Map(allComments.map(comment => [
        comment.id,
        comment.feishuRecordId || String(comment.id),
      ]));

      const parsedComments = allComments.map(c => ({
        id: c.feishuRecordId || String(c.id), // 前端期望 string 类型的 id
        postId: c.postId,
        content: c.content, // 限制或直接返回
        user: {
          username: c.user.username,
          avatar: c.user.avatar || '/avatars/default.svg'
        },
        createdAt: c.createdAt.toISOString(),
        parentId: c.parentId ? (publicIdByLocalId.get(c.parentId) || String(c.parentId)) : undefined,
        likes: c.likes,
        dislikes: c.dislikes
      }));

      res.json({
        success: true,
        data: parsedComments,
        pagination: {
          total: totalParents,
          page,
          limit,
          hasMore: totalParents > skip + limit
        }
      });
    } catch (error) {
      console.error(`[Comments] 从数据库拉取评论失败:`, error);
      res.status(500).json({ success: false, data: [] });
    }
  }

}
