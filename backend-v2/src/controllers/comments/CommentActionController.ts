import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { IpUtils } from '../../utils/IpUtils';
import { Prisma } from '@prisma/client';
import { cacheService } from '../../services/CacheService';
import { SseService } from '../../services/SseService';
import {
  isFeishuEnvironmentMatch,
  withCurrentFeishuEnvironment,
} from '../../utils/FeishuEnvironment';

export class CommentActionController {
  public static async handlePost3(req: Request, res: Response) {
    const commentId = req.params.commentId as string;
    const { action, articleId } = req.body; // action: 'like' | 'dislike'
  const clientIp = IpUtils.getClientIp(req);

  if (!['like', 'dislike'].includes(action)) {
    return res.status(400).json({ success: false, message: '无效的操作' });
  }

  // 前端持有的 id 可能是本地自增 id，也可能是飞书 record_id，统一解析成本地记录
  const numericId = Number(commentId);
  const commentWhere = Number.isInteger(numericId) && numericId > 0
    ? { id: numericId }
    : { feishuRecordId: commentId };

  const existing = await prisma.comment.findUnique({
    where: commentWhere,
    select: { id: true }
  });
  if (!existing) {
    return res.status(404).json({ success: false, message: '评论不存在' });
  }

  // 1. 持久化 IP 去重记录（sha256 后存储，避免明文 IP），唯一键冲突即已操作过
  const ipHash = createHash('sha256').update(clientIp).digest('hex');
  try {
    await prisma.commentAction.create({
      data: { commentId: existing.id, action, ipHash }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return res.status(400).json({ success: false, message: '你已经操作过了' });
    }
    throw e;
  }

  // 2. 数据库原子自增并持久化，返回真实计数
  let newCount = 1;
  let commentOwner: { userId: number | null; content: string } | null = null;
  try {
    const updated = await prisma.comment.update({
      where: { id: existing.id },
      data: action === 'like'
        ? { likes: { increment: 1 } }
        : { dislikes: { increment: 1 } },
      select: { likes: true, dislikes: true, userId: true, content: true }
    });
    newCount = action === 'like' ? updated.likes : updated.dislikes;
    commentOwner = updated;
  } catch (e) {
    console.error(`[Comments] 持久化${action === 'like' ? '点赞' : '踩'}失败:`, e);
    return res.status(500).json({ success: false, message: '操作失败，请稍后再试' });
  }

  // 3. 同步刷新内存缓存（仅用于其他读路径的兜底展示）
  if (articleId && cacheService.commentsCache[articleId]) {
    const comment = cacheService.commentsCache[articleId].find(c => c.id === commentId);
    if (comment) {
      if (action === 'like') {
        comment.likes = newCount;
      } else {
        comment.dislikes = newCount;
      }
    }
  }

  // 4. 返回成功给前端
  res.json({ success: true, count: newCount });

  // 异步的点赞通知 (仅当有明确的评论拥有者时)
  try {
    if (action === 'like') {
      // 只有当评论有真实用户 (非飞书匿名)，且不是自己给自己点赞时，才发通知
      const operatorUserId = Number((req as any).user?.id);
      if (commentOwner && commentOwner.userId && commentOwner.userId !== operatorUserId) {
        const notification = await prisma.notification.create({
          data: {
            userId: commentOwner.userId,
            type: 'like',
            title: '有人赞了你的评论',
            content: commentOwner.content.substring(0, 50),
            link: `/posts/${articleId}#comment-${commentId}`
          }
        });
        SseService.notifyUser(Number(commentOwner.userId), notification);
      }
    }
  } catch (e) {
    console.error('点赞通知发送失败', e);
  }

  // 5. 异步更新 Feishu (无需强并发控制，但为了稳妥直接调)
  if (feishuClient && config.feishu.baseToken && config.feishu.tables.comments) {
    try {
      // 先获取当前的数量
      const recordRes = await feishuClient.bitable.appTableRecord.get({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.comments,
          record_id: commentId
        }
      });
      if (recordRes.data?.record && isFeishuEnvironmentMatch(recordRes.data.record.fields)) {
        // 由于用户的表格里可能没有 Likes/Dislikes 字段，这里我们使用 try-catch 包裹
        const propName = action === 'like' ? 'Likes' : 'Dislikes';
        const currentCount = Number(recordRes.data.record.fields[propName] || 0);

        try {
          await feishuClient.bitable.appTableRecord.update({
            path: {
              app_token: config.feishu.baseToken,
              table_id: config.feishu.tables.comments,
              record_id: commentId
            },
            data: {
              fields: withCurrentFeishuEnvironment({
                [propName]: currentCount + 1
              })
            }
          });
        } catch(e) {
          console.warn(`[Comments] 飞书表格更新 ${propName} 失败，可能缺少该字段:`, e);
        }
      }
    } catch (error) {
      console.error(`[Comments] 异步更新 Feishu 点赞/踩失败:`, error);
    }
  }
  }

}
