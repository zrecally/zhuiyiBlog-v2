import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { cacheService } from '../CacheService';
import { FeishuMarkdownParser } from '../FeishuMarkdownParser';
import { StaticSnapshotService } from '../static-snapshot/StaticSnapshotService';
import { filterFeishuRecordsForCurrentEnvironment } from '../../utils/FeishuEnvironment';
import { resolveArticleAccessMode } from '../../utils/ArticleAccess';
import { FeishuCommentSyncService } from './FeishuCommentSyncService';
import { FeishuBaseSyncService } from './FeishuBaseSyncService';

export class FeishuContentSyncService {
public static async syncPostsInBackground() {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.posts) return;

    const now = Date.now();
    if (now - cacheService.lastCacheTime < 30 * 1000) return; // 30s throttle

    try {
      let pageToken: string | undefined = undefined;
      let hasMore = true;
      let allItems: any[] = [];

      // 循环拉取所有文章（支持千级数据分页）
      while (hasMore) {
        const res = await feishuClient.bitable.appTableRecord.list({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.posts,
          },
          params: {
            page_size: 100,
            page_token: pageToken
          },
        });

        if (typeof res.code === 'number' && res.code !== 0) {
          throw new Error(`飞书文章列表返回错误码 ${res.code}`);
        }
        if (!res.data) throw new Error('飞书文章列表响应缺少 data');

        if (Array.isArray(res.data.items)) allItems = allItems.concat(res.data.items);

        hasMore = res.data.has_more === true;
        pageToken = res.data.page_token;
        if (hasMore && !pageToken) throw new Error('飞书文章列表分页响应缺少 page_token');
      }

      // 只将“此前已成功同步且存在飞书文档”的文章视为飞书文章，避免本地演示或
      // 手工缓存条目被误判为已删除。与未过滤的全量记录比较，防止 Test / Production
      // 共用一张文章表时误删另一环境的评论。
      const previousFeishuPostIds = (cacheService.postsCache?.posts || [])
        .filter((post: any) => typeof post?.id === 'string' && Boolean(post.docId))
        .map((post: any) => post.id as string);
      const allSourcePostIds = new Set(
        allItems.map(record => record.record_id).filter((recordId): recordId is string => Boolean(recordId)),
      );
      const deletedPostIds = previousFeishuPostIds.filter((postId: string) => !allSourcePostIds.has(postId));
      if (deletedPostIds.length > 0) {
        await FeishuCommentSyncService.deleteCommentsForDeletedPosts(deletedPostIds);
      }

      const validPosts = filterFeishuRecordsForCurrentEnvironment(allItems)
        .map(this.parseFeishuPost)
        .filter(p => p !== null && p.isPublished);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validPosts.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // 剥离老缓存的正文逻辑，因为已经由 postContents 单独维护了
      // 我们只需要更新 list 即可。

      cacheService.postsCache = {
        posts: validPosts,
        config: cacheService.postsCache?.config || { title: '未配置标题', subtitle: '未配置副标题', description: '请在 Feishu 配置表中添加相关信息。', avatar: '' },
        lastCacheTime: Date.now()
      };
      cacheService.lastCacheTime = cacheService.postsCache.lastCacheTime;

      await cacheService.savePostsCache();
      console.log(`[Sync] 飞书文章列表拉取完成，已缓存 ${validPosts.length} 篇文章。`);

      for (const p of validPosts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const post: any = p;
        const hasContent = cacheService.postContents.has(post.id);
        if (post && !hasContent && post.docId) {
          try {
            console.log(`[Feishu] 后台正在预加载文章正文 ${post.docId}...`);
            const finalContent = await FeishuMarkdownParser.fetchDocContent(post.docId, post.id, post.isWiki);
            if (finalContent) {
                cacheService.postContents.set(post.id, finalContent);
                StaticSnapshotService.noteContentRefreshed(post.id);
                await cacheService.savePostsCache();
            }
          } catch (e) {
            console.error(`[Sync] 预加载飞书文章正文失败 (${post.id}):`, e);
          }
        }
      }

      try {
        await StaticSnapshotService.publishAfterFeishuSync();
      } catch (snapshotError) {
        console.error('[StaticSnapshot] 生成静态快照失败，继续保留上一版本:', snapshotError);
      }
    } catch (error) {
      console.error('[Sync] 飞书文章拉取失败:', error);
      throw error;
    }
  }

private static parseFeishuPost(record: any) {
    try {
      const fields = record.fields;

      let category = '未分类';
      if (fields.Category) {
        if (Array.isArray(fields.Category)) {
          category = fields.Category.join(', ');
        } else if (typeof fields.Category === 'string') {
          category = fields.Category;
        }
      }

      let title = '无标题';
      if (fields.Name) {
        if (Array.isArray(fields.Name)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          title = fields.Name.map((item: any) => item.text || item).join('');
        } else if (typeof fields.Name === 'string') {
          title = fields.Name;
        }
      }

      let date = '未知日期';
      if (fields.Date) {
        const d = new Date(fields.Date);
        date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }

      const summary = fields.Summary || '';
      // 飞书「文本」列会以富文本数组返回；缓存和静态站均要求纯字符串。
      // 未转换时静态快照的安全序列化会把数组降级为空字符串。
      const slug = FeishuBaseSyncService.textValue(fields.Slug);

      let image = '';
      if (fields.Cover) {
        if (Array.isArray(fields.Cover) && fields.Cover.length > 0) {
          const coverObj = fields.Cover[0];
          image = coverObj.link || coverObj.text || '';
        } else if (typeof fields.Cover === 'object') {
          image = fields.Cover.link || fields.Cover.text || '';
        } else if (typeof fields.Cover === 'string') {
          image = fields.Cover;
        }
      }

      if (image && !image.startsWith('http')) {
          image = '';
      }

      let docLink = '';
      if (fields.Doc_Link) {
        docLink = typeof fields.Doc_Link === 'object' ? fields.Doc_Link.link : fields.Doc_Link;
      }

      let docId = '';
      let isWiki = false;
      if (docLink) {
        const matchDocx = docLink.match(/docx\/([a-zA-Z0-9]+)/);
        if (matchDocx && matchDocx[1]) {
          docId = matchDocx[1];
        } else {
          const matchWiki = docLink.match(/wiki\/([a-zA-Z0-9]+)/);
          if (matchWiki && matchWiki[1]) {
            docId = matchWiki[1];
            isWiki = true;
          }
        }
      }

      let tags: string[] = [];
      if (fields.Tags && Array.isArray(fields.Tags)) {
        tags = fields.Tags;
      }

      const isPrivate = fields.Private === true || fields.private === true;
      const accessMode = resolveArticleAccessMode(fields.AccessMode, isPrivate);
      const showLockedMetadata = fields.ShowLockedMetadata === true;
      const isPublished = fields.Status === 'Published';
      const views = typeof fields.Views === 'number' ? fields.Views : 0;

      return {
        id: record.record_id,
        title,
        summary,
        image,
        date,
        slug,
        category,
        tags,
        isPrivate: accessMode !== 'public',
        accessMode,
        showLockedMetadata,
        isPublished,
        views,
        docId,
        isWiki,
        content: ''
      };
    } catch (error) {
      console.error('Error parsing Feishu record:', error);
      return null;
    }
  }
}
