import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { cacheService } from '../CacheService';
import { FeishuBaseSyncService } from './FeishuBaseSyncService';

export class FeishuCommentSyncService {
  /**
   * 清理已从文章表物理删除的文章所留下的评论。
   *
   * 评论与文章之间使用的是飞书文章 record_id，而不是 Prisma 外键；因此文章
   * 从飞书文章表删除时，数据库不会自动触发 Comment 的级联删除。这里同时
   * 清理飞书评论表和本地数据库，后者的 parent -> children 关系会继续级联
   * 清理回复。
   */
  public static async deleteCommentsForDeletedPosts(deletedPostIds: string[]): Promise<number> {
    const postIds = [...new Set(deletedPostIds.filter(Boolean))];
    if (postIds.length === 0) return 0;

    let remoteDeleted = 0;
    if (feishuClient && config.feishu.baseToken && config.feishu.tables.comments) {
      try {
        // 只读取当前环境的评论，绝不删除另一套环境的数据。
        const environmentRecords = await FeishuBaseSyncService.fetchAllRecords(config.feishu.tables.comments);
        const remoteCommentIds = environmentRecords
          .filter(record => {
            const fields = record.fields || {};
            const postId = String(fields.PostId || fields.PostID || fields.ArticleID || fields.ArticleId || '');
            return postIds.includes(postId);
          })
          .map(record => record.record_id)
          .filter((recordId): recordId is string => Boolean(recordId));

        for (const recordId of remoteCommentIds) {
          await feishuClient.bitable.appTableRecord.delete({
            path: {
              app_token: config.feishu.baseToken,
              table_id: config.feishu.tables.comments,
              record_id: recordId,
            },
          });
          remoteDeleted += 1;
        }
      } catch (error) {
        // 源文章已被确认删除，本地仍必须立即停止展示其评论；远端残留会在日志中
        // 留痕，避免因飞书暂时不可用而阻塞文章同步。
        console.error('[Sync] 删除已移除文章的飞书评论失败，将继续清理本地评论:', error);
      }
    }

    const localResult = await prisma.comment.deleteMany({
      where: { postId: { in: postIds } },
    });
    cacheService.commentsCache = {};
    cacheService.commentsLastFetch = {};
    console.log(`[Sync] 文章已删除：清理本地评论 ${localResult.count} 条、飞书评论 ${remoteDeleted} 条。`);
    return localResult.count;
  }

public static async syncCommentsToLocal() {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.comments) return;
    try {
      const seenFeishuRecordIds = new Set<string>();

      const environmentRecords = await FeishuBaseSyncService.fetchAllRecords(config.feishu.tables.comments);

      const feishuRecordIds = environmentRecords.map(r => r.record_id).filter((id): id is string => Boolean(id));
      feishuRecordIds.forEach(id => seenFeishuRecordIds.add(id));

      const localComments = await prisma.comment.findMany({
          where: { feishuRecordId: { in: feishuRecordIds } }
      });
      const localCommentsMap = new Map(localComments.map(c => [c.feishuRecordId as string, c]));

      for (const record of environmentRecords) {
          const fields = record.fields || {};
          const feishuRecordId = record.record_id;

          // 解析基本字段
          const postId = String(fields['PostId'] || fields['PostID'] || fields['ArticleID'] || fields['ArticleId'] || '');
          if (!postId) continue;

          let content = '';
          if (fields['Content']) {
            if (Array.isArray(fields['Content'])) content = fields['Content'].map((i: any) => i.text || '').join('');
            else content = String(fields['Content']);
          }

          let authorName = '匿名';
          if (fields['Author']) {
            if (Array.isArray(fields['Author'])) authorName = fields['Author'].map((i: any) => i.text || '').join('');
            else authorName = String(fields['Author']);
          }

          // 处理可能叫做 Status (Approved/Reject/Hidden) 或者 Published (true/false) 的状态
          let status = 'Approved';
          if (fields['Status']) {
            status = String(fields['Status']);
          } else if (fields['Published'] !== undefined) {
            status = fields['Published'] === true || fields['Published'] === 'true' ? 'Approved' : 'Hidden';
          }

          let createdAt = new Date();
          if (fields['Date']) {
            const dVal = fields['Date'];
            if (!isNaN(Number(dVal))) {
              createdAt = new Date(Number(dVal));
            } else {
              createdAt = new Date(String(dVal));
            }
          }

          // 如果状态是 Reject 或 Hidden，如果本地有这条记录，直接删掉
          if (status === 'Reject' || status === 'Hidden') {
            if (feishuRecordId) {
              await prisma.comment.deleteMany({ where: { feishuRecordId } });
              // 将其从已见列表中移除，避免后续被判断为“存在于飞书中”而跳过删除检查
              seenFeishuRecordIds.delete(feishuRecordId);
            }
            continue;
          }

          // 查找本地对应的记录（通过飞书ID，或者通过极短时间内的同作者同内容来模糊匹配以防飞书同步延迟造成重复）
          let localComment = feishuRecordId ? localCommentsMap.get(feishuRecordId) : undefined;

          // 兜底：如果本地不存在带飞书ID的记录，但在本地库刚创建过这条评论（可能飞书那边刚拉下来），则进行绑定
          if (!localComment) {
              const potentialComment = await prisma.comment.findFirst({
                  where: {
                      postId,
                      content,
                      feishuRecordId: null
                  },
                  orderBy: { createdAt: 'desc' }
              });
              if (potentialComment) {
                  localComment = potentialComment;
              }
          }

          if (localComment) {
            // 更新操作：目前飞书侧评论主要更新的是状态（已在上面处理），也可以支持飞书里修改评论正文
            if (localComment.content !== content || !localComment.feishuRecordId) {
              await prisma.comment.update({
                where: { id: localComment.id },
                data: { content, feishuRecordId }
              });
            }
          } else {
              // 新建操作：如果在飞书里直接回复或新增评论，则拉取到本地

              // 寻找关联的本地用户
              let user = await prisma.user.findFirst({ where: { username: authorName } });
              if (!user) {
                  // 如果飞书填了一个不存在的作者名，使用 admin 兜底或创建一个影子用户
                  user = await prisma.user.findFirst({ where: { username: 'admin' } });
                  if (!user) {
                      user = await prisma.user.create({
                          data: {
                              email: `admin_${Math.random()}@system.local`,
                              username: 'admin',
                              avatar: '/avatars/default.svg'
                          }
                      });
                  }
              }

              await prisma.comment.create({
                data: {
                  feishuRecordId,
                  postId,
                  content,
                  userId: user.id,
                  ip: 'feishu_sync',
                  createdAt
                }
              });
            }
          }

      // === 清理已在飞书中物理删除的记录 ===
      // 为防止在多环境（Test/Prod）共享数据库时误删其他环境的数据，
      // 我们必须确保只处理当前环境拉取到的记录集合。
      // 这里暂不执行跨环境的物理删除，因为无法确认缺失的 recordId 是否属于其他环境。
      // TODO: 若需要在多环境共享库中物理删除，需在 Comment 表增加 environment 字段。
      /*
      const localCommentsWithFeishuId = await prisma.comment.findMany({
        where: { feishuRecordId: { not: null } },
        select: { id: true, feishuRecordId: true }
      });

      const idsToDelete: number[] = [];
      for (const localComment of localCommentsWithFeishuId) {
        if (localComment.feishuRecordId && !seenFeishuRecordIds.has(localComment.feishuRecordId)) {
          idsToDelete.push(localComment.id);
        }
      }

      if (idsToDelete.length > 0) {
        await prisma.comment.deleteMany({
          where: { id: { in: idsToDelete } }
        });
        console.log(`[Sync] 发现飞书中已物理删除的评论，同步清理本地数据库，共清理 ${idsToDelete.length} 条。`);
      }
      */

      // 清理缓存，确保前端下次请求能获取到最新的评论数据
      cacheService.commentsCache = {};
      cacheService.commentsLastFetch = {};
      console.log(`[Sync] 评论同步完成，已清空评论缓存。`);

    } catch (error) {
      console.error("[Sync] 从飞书同步评论列表失败:", error);
      throw error;
    }
  }
}
