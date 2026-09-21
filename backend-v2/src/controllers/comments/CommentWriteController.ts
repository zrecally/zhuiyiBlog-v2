import * as RateLimitMiddleware from '../../middlewares/RateLimitMiddleware';
import { Request, Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { IpUtils } from '../../utils/IpUtils';
import { securityUtils } from '../../utils/SecurityUtils';
import { recentCommentsCache, writeQueue } from '../../middlewares/RateLimitMiddleware';
import { cacheService } from '../../services/CacheService';
import * as crypto from 'crypto';
import { SseService } from '../../services/SseService';
import {
  parseCommentReplyMetadata,
  stripCommentReplyMetadata,
} from '../../utils/CommentReplyMetadata';
import {
  isFeishuEnvironmentMatch,
  withCurrentFeishuEnvironment,
} from '../../utils/FeishuEnvironment';

export class CommentWriteController {
  public static async handlePost1(req: Request, res: Response) {
    if (!req.user || !('id' in req.user)) {
      return res.status(401).json({ success: false, message: '未授权' });
    }
  const { postId, content } = req.body;
  const clientIp = IpUtils.getClientIp(req);

  if (!postId || !content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, message: '文章 ID 和评论内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ success: false, message: '评论内容过长，请精简后再试' });
  }

  const replyMetadata = parseCommentReplyMetadata(content);
  const rawBody = stripCommentReplyMetadata(content);

  // 服务端白名单 HTML 深度净化，彻底杜绝存储型 XSS
  const sanitizedBody = sanitizeHtml(rawBody, {
    allowedTags: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'code', 'pre', 'blockquote'
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel'],
      'span': ['class'],
      'code': ['class'],
      'pre': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      }),
    },
    disallowedTagsMode: 'discard',
  }).trim();

  // 提取纯文本用于空内容与敏感词检测
  let cleanText = sanitizedBody.replace(/<[^>]*>/g, '');
  cleanText = cleanText.replace(/&nbsp;/g, ' ').trim();

  if (!cleanText) {
    return res.status(400).json({ success: false, message: '评论内容无效或包含非法标签' });
  }

  // 重新拼装净化后的安全内容（安全保留合法结构化元数据）
  const sanitizedContent = replyMetadata
    ? `${sanitizedBody}<!-- meta:${JSON.stringify({ parentId: replyMetadata.parentId, ...(replyMetadata.replyTo ? { replyTo: replyMetadata.replyTo } : {}) })} -->`
    : sanitizedBody;

  let replyParent = null;
  try {
    if (replyMetadata) {
      replyParent = /^\d+$/.test(replyMetadata.parentId)
        ? await prisma.comment.findUnique({
            where: { id: Number(replyMetadata.parentId) },
            include: { user: { select: { username: true } } },
          })
        : await prisma.comment.findUnique({
            where: { feishuRecordId: replyMetadata.parentId },
            include: { user: { select: { username: true } } },
          });
      if (!replyParent || replyParent.postId !== postId) {
        return res.status(400).json({ success: false, message: '回复的评论不存在或不属于当前文章' });
      }
    }
  } catch (error) {
    console.error('[Comments] 查询被回复评论失败:', error);
    return res.status(500).json({ success: false, message: '查询被回复评论失败' });
  }

  if (securityUtils.containsSensitiveWords(cleanText)) {
    console.warn(`[Security] 拦截到敏感评论. 原始: ${content}, 净化后: ${cleanText}`);
    return res.status(400).json({ success: false, message: '您的评论包含不当词汇，请修改后再试。' });
  }

  // ==========================================
  // 防灌水/刷屏检测 (Anti-Spam)
  // ==========================================
  const spamKey = req.user.id ? `user_${req.user.id}` : `ip_${clientIp}`;
  const lastComment = recentCommentsCache.get(spamKey);
  const now = Date.now();

  if (lastComment) {
    const timeDiff = now - lastComment.time;
    if (timeDiff < 10000) {
      return res.status(429).json({ success: false, message: '您的评论速度太快了，请喝口茶歇息片刻 (10秒内限1次)' });
    }
    if (lastComment.content === sanitizedContent) {
      return res.status(400).json({ success: false, message: '请勿重复提交相同的评论内容' });
    }
  }

  // 更新防灌水缓存
  recentCommentsCache.set(spamKey, { time: now, content: sanitizedContent });
  // ==========================================

  try {
      const result = await writeQueue.add(async () => {
        let userId = (req.user as any).id as number;
        const role = (req.user as any).role;

        if (role === 'admin') {
          let adminUser = await prisma.user.findFirst({ where: { username: 'admin' } });
        if (!adminUser) {
          adminUser = await prisma.user.create({
            data: {
              email: 'admin@system.local',
              username: 'admin',
              avatar: '/admin-modern.png',
              avatarDark: '/admin-xianxia.png'
            }
          });
        }
        userId = adminUser.id;
      }

      const newComment = await prisma.comment.create({
        data: {
          postId,
          content: sanitizedContent,
          userId,
          ip: clientIp,
          parentId: replyParent?.id,
        },
        include: {
          user: {
            select: { username: true, avatar: true, avatarDark: true }
          }
        }
      });

      // 广播新评论给当前文章页面的所有在线用户
      SseService.broadcastNewComment(postId, {
        type: 'new_comment',
        comment: {
          ...newComment,
          id: String(newComment.id),
          parentId: replyParent ? (replyParent.feishuRecordId || String(replyParent.id)) : undefined,
        }
      });

      // 触发站内信通知逻辑
      try {
        if (replyParent && Number(replyParent.userId) !== Number(userId)) {
              const notification = await prisma.notification.create({
                data: {
                  userId: replyParent.userId,
                  type: 'reply',
                  title: `${(req.user as any).username} 回复了你`,
                  content: stripCommentReplyMetadata(sanitizedContent),
                  link: `/posts/${postId}#comment-${newComment.id}`
                }
              });

              // 实时推送通知给被回复的用户
              SseService.notifyUser(Number(replyParent.userId), notification);
        }
      } catch (e) {
        console.error('[Notification] 创建评论回复通知失败:', e);
      }

      // === 修改这里：将评论写入飞书逻辑放入后台排队队列 ===
      if (feishuClient && config.feishu.baseToken && config.feishu.tables.comments) {
        RateLimitMiddleware.writeQueue.add(async () => {
            try {
              const res = await feishuClient!.bitable.appTableRecord.create({
                path: {
                  app_token: config.feishu.baseToken,
                  table_id: config.feishu.tables.comments
                },
                data: {
                  fields: withCurrentFeishuEnvironment({
                    'ArticleID': postId, // 适配用户飞书表格实际字段名
                    'Content': sanitizedContent,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'Author': (req.user as any)?.username || '匿名用户',
                    'Published': true, // 适配实际字段名
                    'Date': new Date().getTime()
                  })
                }
              });
              if (res.code === 0) {
                console.log(`[Comments] 评论同步至飞书多维表格成功`);
              } else {
                console.error(`[Comments] 评论同步至飞书失败: code=${res.code}, msg=${res.msg}`);
              }
            } catch (e) {
            console.error(`[Comments] 评论同步至飞书失败:`, e);
          }
        });

      } else {
        console.warn(`[Comments] ⚠️ 未配置 config.feishu.tables.comments，放弃推送。`);
      }

      // === 方案 3：通过飞书机器人 Webhook 发送评论通知 ===
      if (config.feishu.webhookUrl) {
        RateLimitMiddleware.writeQueue.add(async () => {
          try {
            // 获取文章标题用于通知展示（尽力而为，如果缓存里没有就用 ID）
            let postTitle = postId;
            if (cacheService.postsCache && cacheService.postsCache.posts) {
              const post = cacheService.postsCache.posts.find((p: any) => p.id === postId);
              if (post && post.title) postTitle = post.title;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const authorName = (req.user as any)?.username || '匿名用户';

            // 构造飞书卡片消息格式
            const cardMessage = {
              msg_type: "interactive",
              card: {
                config: {
                  wide_screen_mode: true
                },
                header: {
                  title: {
                    tag: "plain_text",
                    content: `博客收到新评论`
                  },
                  template: "blue"
                },
                elements: [
                  {
                    tag: "div",
                    fields: [
                      {
                        is_short: true,
                        text: {
                            tag: "lark_md",
                            content: `**访客：**\n${authorName}`
                        }
                      },
                      {
                        is_short: true,
                        text: {
                            tag: "lark_md",
                            content: `**文章：**\n${postTitle}`
                        }
                      }
                    ]
                  },
                  {
                    tag: "hr"
                  },
                  {
                    tag: "markdown",
                    content: `**评论内容：**\n${stripCommentReplyMetadata(sanitizedContent)}`
                  }
                ],
                action: {
                  actions: [
                    {
                      tag: "button",
                      text: {
                        tag: "plain_text",
                        content: "💬 快速回复"
                      },
                      type: "primary",
                      multi_url: {
                        url: `${config.frontendUrl}/posts/${postId}#comment-${newComment.id}`,
                        pc_url: `${config.frontendUrl}/posts/${postId}#comment-${newComment.id}`,
                        android_url: `${config.frontendUrl}/posts/${postId}#comment-${newComment.id}`,
                        ios_url: `${config.frontendUrl}/posts/${postId}#comment-${newComment.id}`
                      }
                    }
                  ]
                }
              }
            };

            const now_timestamp = Math.floor(Date.now() / 1000).toString();
            let sign = '';

            // 如果配置了 Webhook 签名校验，则计算签名
            if (config.feishu.webhookSecret) {
              const string_to_sign = `${now_timestamp}\n${config.feishu.webhookSecret}`;
              const hmac = crypto.createHmac('sha256', string_to_sign);
              hmac.update('');
              sign = hmac.digest('base64');
            }

            // 飞书机器人安全校验要求把 timestamp 和 sign 作为独立字段，跟 msg_type 同级
            // 不要放在 requestBody.card 里面
            const requestBody: any = {
              timestamp: now_timestamp,
              sign: sign,
              msg_type: "interactive",
              card: cardMessage.card
            };

            const res = await fetch(config.feishu.webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(requestBody)
            });
            const resData = await res.json();
            if (resData.code === 0 || resData.StatusCode === 0) {
              console.log(`[Comments] 飞书机器人通知发送成功`);
            } else {
              console.error(`[Comments] 飞书机器人通知发送失败:`, resData);
            }
          } catch (e) {
            console.error(`[Comments] 飞书机器人通知发送失败:`, e);
          }
        });
      }

      return newComment;
    });

    res.json({ success: true, data: result, message: '评论提交成功！' });
  } catch (error) {
    console.error("提交评论失败:", error);
    res.status(500).json({ success: false, message: '提交评论失败' });
  }
  }

  public static async handleDeleteComment(req: Request, res: Response) {
    if (!req.user || !('id' in req.user)) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const commentId = req.params.id as string;
    const userId = req.user.id as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = (req.user as any).role as string;

    try {
      // 1. 查找评论，以获取其真实 ID 或飞书 Record ID
      // 前端传过来的 commentId 可能是飞书的 record_id（字符串形式），也可能是本地数据库的 ID（字符串格式的数字）
      let localComment;
      if (typeof commentId === 'string' && (commentId.startsWith('tbl') || commentId.startsWith('rec'))) { // 简单的飞书ID特征判断
        localComment = await prisma.comment.findUnique({ where: { feishuRecordId: commentId } });
      } else {
        const idNum = parseInt(commentId, 10);
        if (!isNaN(idNum)) {
          localComment = await prisma.comment.findUnique({ where: { id: idNum } });
        }
      }

      if (!localComment) {
        return res.status(404).json({ success: false, message: '评论不存在' });
      }

      // 2. 权限校验：必须是评论的作者，或者是管理员
      if (localComment.userId !== userId && role !== 'admin') {
        return res.status(403).json({ success: false, message: '无权删除该评论' });
      }

      const feishuRecordId = localComment.feishuRecordId;

      // 3. 删除本地数据库记录
      await prisma.comment.delete({ where: { id: localComment.id } });

      // 4. 异步删除（或软删除）飞书中的记录
      if (feishuRecordId && feishuClient && config.feishu.baseToken && config.feishu.tables.comments) {
        RateLimitMiddleware.writeQueue.add(async () => {
          try {
            // 这里我们选择直接删除飞书中的记录，也可以选择 update status 为 Hidden
            const remoteRecord = await feishuClient!.bitable.appTableRecord.get({
              path: {
                app_token: config.feishu.baseToken,
                table_id: config.feishu.tables.comments,
                record_id: feishuRecordId,
              },
            });
            if (!remoteRecord.data?.record || !isFeishuEnvironmentMatch(remoteRecord.data.record.fields)) {
              console.warn('[Comments] 跳过删除不属于当前环境的飞书评论记录');
              return;
            }
            await feishuClient!.bitable.appTableRecord.delete({
              path: {
                app_token: config.feishu.baseToken,
                table_id: config.feishu.tables.comments,
                record_id: feishuRecordId
              }
            });
            console.log(`[Comments] 飞书评论记录 ${feishuRecordId} 已同步删除`);
          } catch (e) {
            console.error(`[Comments] 飞书评论记录 ${feishuRecordId} 删除失败:`, e);
          }
        });
      }

      res.json({ success: true, message: '评论已删除' });
    } catch (error) {
      console.error("删除评论失败:", error);
      res.status(500).json({ success: false, message: '删除评论失败' });
    }
  }

}
