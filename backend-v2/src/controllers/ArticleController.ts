import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { feishuClient } from '../core/FeishuClient';
import { config } from '../config';
import { cacheService } from '../services/CacheService';
import {
  filterFeishuRecordsForCurrentEnvironment,
  withCurrentFeishuEnvironment,
} from '../utils/FeishuEnvironment';
import { openai } from '../core/LLMClient';
import { FeishuMarkdownParser } from '../services/FeishuMarkdownParser';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import jwt from 'jsonwebtoken';
import { ArticlePasswordAccessService } from '../services/ArticlePasswordAccessService';
import { resolveArticleAccessMode } from '../utils/ArticleAccess';

const LEGACY_STATIC_COMPLIANCE_KEYS = new Set([
  'static_icp_number',
  'static_police_number',
  'static_police_record_code',
]);

const isStaticComplianceKey = (key: string) => {
  const normalized = key.toLocaleLowerCase();
  return normalized.startsWith('static_compliance_') || LEGACY_STATIC_COMPLIANCE_KEYS.has(normalized);
};

export class ArticleController {

  private static async privateAccessState(req: Request, post: any, user: any, isAdmin: boolean) {
    if (!post.isPrivate || isAdmin) return { allowed: true, status: 'approved' };
    const accessMode = resolveArticleAccessMode(post.accessMode, post.isPrivate === true);
    if (accessMode === 'password') {
      const allowed = await ArticlePasswordAccessService.hasGrant(req, post.id);
      return {
        allowed,
        status: allowed ? 'approved' : 'locked',
        accessMode,
        message: allowed ? '' : '请输入一次性访问密码',
      };
    }
    if (!user) return { allowed: false, status: 'none', accessMode, message: '私密文章，请先登录' };
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.requests) {
      return { allowed: false, status: 'none', accessMode, message: '系统未配置权限库' };
    }
    const existing = await feishuClient.bitable.appTableRecord.list({
      path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.requests },
      params: { filter: `AND(CurrentValue.[UserID]="${user.id}", CurrentValue.[PostID]="${post.id}")` },
    });
    const currentRequests = filterFeishuRecordsForCurrentEnvironment(existing.data?.items || []);
    const status = currentRequests.length > 0 && currentRequests[0].fields.Status
      ? String(currentRequests[0].fields.Status)
      : 'none';
    return {
      allowed: status === 'approved',
      status,
      accessMode,
      message: status === 'approved' ? '' : '私密文章，需要申请访问权限',
    };
  }

  public static async getPosts(req: Request, res: Response) {
    const user = AuthMiddleware.getOptionalUser(req);
    const isAdmin = user && user.role === 'admin';
    const now = Date.now();

    if (!cacheService.postsCache || !cacheService.postsCache.posts) {
      return res.status(503).json({ success: false, message: '系统正在预加载数据，请稍后刷新...' });
    }

    let currentConfig = cacheService.postsCache.config || { title: '未配置标题', subtitle: '未配置副标题', description: '请在 Feishu 配置表中添加相关信息。', avatar: '' };

    if (cacheService.configCache && (now - cacheService.lastConfigCacheTime < 2 * 60 * 1000)) {
      currentConfig = cacheService.configCache;
    } else if (feishuClient && config.feishu.baseToken && config.feishu.tables.config) {
      feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.config,
        }
      }).then(configResponse => {
        if (configResponse.data && configResponse.data.items && configResponse.data.items.length > 0) {
          const tempConfig = { title: '未配置标题', subtitle: '未配置副标题', description: '请在 Feishu 配置表中添加相关信息。', avatar: '' };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filterFeishuRecordsForCurrentEnvironment(configResponse.data.items).forEach((record: any) => {
            const fields = record.fields;
            const rowKey = fields['Key'] ? String(fields['Key']) : '';
            const rowValue = fields['Value'] ? String(fields['Value']) : '';
            if (rowKey && rowValue && !isStaticComplianceKey(rowKey)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (tempConfig as any)[rowKey.toLowerCase()] = rowValue;
            }
          });
          cacheService.configCache = tempConfig;
          cacheService.lastConfigCacheTime = Date.now();
          cacheService.postsCache.config = tempConfig;
        }
      }).catch(e => console.error('[Config] 后台静默获取配置失败:', e));

      currentConfig = cacheService.configCache || currentConfig;
    }

    try {
      let responseData = await ArticleController.appendAccessStatus(req, cacheService.postsCache, user, Boolean(isAdmin));

      if (!isAdmin && responseData.posts) {
        const currentServerTime = Date.now();
        responseData.posts = responseData.posts.filter((p: any) => {
          if (!p.date) return true;
          const postTime = new Date(p.date.replace(/-/g, '/')).getTime();
          return isNaN(postTime) || postTime <= currentServerTime;
        });
      }

      const lightweightData = {
        ...responseData,
        posts: responseData.posts.map((p: any) => {
          const { docId, ...rest } = p;
          return rest;
        }),
        config: Object.fromEntries(Object.entries(currentConfig).filter(([key]) => !isStaticComplianceKey(key)))
      };

      return res.json({ success: true, data: lightweightData });
    } catch (error) {
      console.error("处理文章数据失败:", error);
      res.status(500).json({ success: false, message: '数据处理失败' });
    }
  }

  public static async searchPosts(req: Request, res: Response) {
    const query = req.query.q as string;
    if (!query || query.trim() === '') {
      return res.json({ success: true, data: [] });
    }

    const user = AuthMiddleware.getOptionalUser(req);
    const isAdmin = user && user.role === 'admin';
    const currentServerTime = Date.now();

    if (!cacheService.postsCache || !cacheService.postsCache.posts) {
      return res.status(503).json({ success: false, message: '系统缓存尚未就绪' });
    }

    try {
      let responseData = await ArticleController.appendAccessStatus(req, cacheService.postsCache, user, Boolean(isAdmin));
      let posts = responseData.posts || [];

      posts = posts.filter((p: any) => {
        if (!isAdmin && p.date) {
          const postTime = new Date(p.date.replace(/-/g, '/')).getTime();
          if (!isNaN(postTime) && postTime > currentServerTime) return false;
        }
        return true;
      });

      const searchTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

      const searchResults = posts.map((post: any) => {
        const titleMatch = (post.title || '').toLowerCase();
        const descMatch = (post.summary || '').toLowerCase();
        const tagsMatch = (post.tags || []).join(' ').toLowerCase();
        const catMatch = (post.category || '').toLowerCase();

        let contentMatch = '';
        let matchedSnippet = '';
        const isLocked = post.isPrivate && post.accessStatus !== 'approved' && !isAdmin;
        if (!isLocked) {
          const rawContent = cacheService.postContents.get(post.id) || '';
          contentMatch = rawContent.toLowerCase();
          const firstMatchIndex = searchTerms
            .map((term) => contentMatch.indexOf(term))
            .filter((index) => index >= 0)
            .sort((left, right) => left - right)[0];

          if (firstMatchIndex !== undefined) {
            const compactContent = rawContent.replace(/\s+/g, ' ').trim();
            const compactMatchIndex = compactContent.toLowerCase().indexOf(searchTerms.find((term) => contentMatch.indexOf(term) === firstMatchIndex) || '');
            const start = Math.max(0, compactMatchIndex - 48);
            const end = Math.min(compactContent.length, compactMatchIndex + 116);
            matchedSnippet = `${start > 0 ? '…' : ''}${compactContent.slice(start, end)}${end < compactContent.length ? '…' : ''}`;
          }
        }

        const contentToSearch = `${titleMatch} ${descMatch} ${tagsMatch} ${catMatch} ${contentMatch}`;
        return {
          post,
          matchedSnippet,
          matchedInContent: Boolean(matchedSnippet),
          matches: searchTerms.every(term => contentToSearch.includes(term)),
        };
      }).filter((result: any) => result.matches);

      const lightweightResults = searchResults.slice(0, 15).map(({ post, matchedSnippet, matchedInContent }: any) => {
        const p = post as any;
        const { docId, ...rest } = p;
        return { ...rest, matchedSnippet: matchedSnippet || undefined, matchedInContent };
      });

      return res.json({ success: true, data: lightweightResults });
    } catch (error) {
      console.error("全局搜索失败:", error);
      res.status(500).json({ success: false, message: '搜索服务异常' });
    }
  }

  public static async getPostContent(req: Request, res: Response) {
    const id = req.params.id as string;
    if (!feishuClient) {
      return res.status(500).json({ success: false, message: '后端未正确配置飞书环境变量' });
    }

    try {
      let cachedPost = null;
      if (cacheService.postsCache && cacheService.postsCache.posts) {
        cachedPost = cacheService.postsCache.posts.find((p: any) => p.id === id);
      }

      if (!cachedPost) {
         return res.status(404).json({ success: false, message: '文章不存在或未发布' });
      }

      const user = AuthMiddleware.getOptionalUser(req);
      const isAdmin = user && user.role === 'admin';

      if (!isAdmin && cachedPost.date) {
        const postTime = new Date(cachedPost.date.replace(/-/g, '/')).getTime();
        const currentServerTime = Date.now();
        if (!isNaN(postTime) && postTime > currentServerTime) {
          return res.status(404).json({ success: false, message: '文章不存在或未发布' });
        }
      }

      const cachedContent = cacheService.postContents.get(id);
      if (cachedContent && cachedContent.length > 0) {
        if (cachedPost.isPrivate) {
          const access = await ArticleController.privateAccessState(req, cachedPost, user, Boolean(isAdmin));
          if (!access.allowed) return res.json({ success: false, isPrivate: true, ...access });
        }
        return res.json({ success: true, content: cachedContent, isPrivate: cachedPost.isPrivate, accessMode: cachedPost.accessMode });
      }

      const isPrivate = cachedPost.isPrivate;
      let accessStatus = 'none';

      if (isPrivate) {
        const access = await ArticleController.privateAccessState(req, cachedPost, user, Boolean(isAdmin));
        accessStatus = access.status;
        if (!access.allowed) return res.json({ success: false, isPrivate: true, ...access });
      }

      if (!cachedPost.docId) {
         return res.status(404).json({ success: false, message: '该文章未关联飞书文档' });
      }

      let finalContent = await FeishuMarkdownParser.fetchDocContent(cachedPost.docId, id, cachedPost.isWiki);

      if (!finalContent) {
         return res.status(500).json({ success: false, message: '拉取或解析飞书文档内容为空' });
      }

      const targetLang = req.query.lang as string;
      if (targetLang === 'en' && openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
              {
                role: "system",
                content: "You are a professional translator. Translate the following Markdown content into English. Keep the original Markdown formatting (including code blocks, links, headings) intact."
              },
              {
                role: "user",
                content: finalContent
              }
            ]
          });

          if (completion.choices[0]?.message?.content) {
            finalContent = completion.choices[0].message.content;
          }
        } catch (translateError) {
          console.error(`[Translate] 翻译失败，降级回中文原文:`, translateError);
        }
      }

      if (cacheService.postsCache && cacheService.postsCache.posts) {
        const index = cacheService.postsCache.posts.findIndex((p: any) => p.id === id);
        if (index !== -1) {
          cacheService.postContents.set(id, finalContent);
          cacheService.savePostsCache();
        }
      }

      res.json({ success: true, content: finalContent, isPrivate, accessMode: cachedPost.accessMode });
    } catch (error) {
      console.error(`❌ 获取飞书文章(${id})内容失败:`, error);
      res.status(500).json({ success: false, message: '获取内容失败' });
    }
  }

  public static async incrementViews(req: Request, res: Response) {
    const id = req.params.id as string;

    try {
      let views = 0;
      if (cacheService.postsCache && cacheService.postsCache.posts) {
        const post = cacheService.postsCache.posts.find((p: any) => p.id === id);
        if (post) {
          post.views = (post.views || 0) + 1;
          views = post.views;
          cacheService.savePostsCache();
        }
      }

      if (feishuClient && config.feishu.baseToken && config.feishu.tables.posts) {
        setTimeout(async () => {
          try {
            const client = feishuClient;
            if (client) {
              await client.bitable.appTableRecord.update({
                path: {
                  app_token: config.feishu.baseToken,
                  table_id: config.feishu.tables.posts,
                  record_id: id
                },
                data: {
                  fields: withCurrentFeishuEnvironment({
                    'Views': views
                  })
                }
              });
            }
          } catch (syncError) {
            console.error(`[Feishu] 异步回写文章阅读量失败:`, syncError);
          }
        }, 0);
      }

      res.json({ success: true, views });
    } catch (error) {
      console.error("更新文章访问量失败:", error);
      res.status(500).json({ success: false });
    }
  }

  public static async requestAccess(req: Request, res: Response) {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;
      const username = req.user!.username || req.user!.id;
      const isAdmin = req.user!.role === 'admin';

      if (isAdmin) {
        return res.json({ success: true, message: '管理员无需申请即可查看私密文章' });
      }

      if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.requests) {
        return res.status(500).json({ success: false, message: '系统未配置 Feishu 申请表，请联系管理员' });
      }

      const existing = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.requests,
        },
        params: {
          filter: `AND(CurrentValue.[UserID]="${userId}", CurrentValue.[PostID]="${postId}")`
        }
      });

      const existingRequests = filterFeishuRecordsForCurrentEnvironment(existing.data?.items || []);
      if (existingRequests.length > 0) {
        const page = existingRequests[0];
        const status = page.fields['Status'] ? String(page.fields['Status']) : 'pending';
        if (status === 'pending') {
          return res.json({ success: true, message: '已经提交过申请，正在等待审批' });
        }
        await feishuClient.bitable.appTableRecord.update({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.requests,
            record_id: page.record_id as string
          },
          data: {
            fields: withCurrentFeishuEnvironment({
              'Status': 'pending'
            })
          }
        });
        return res.json({ success: true, message: '已重新提交申请' });
      }

      let postTitle = postId;
      const cachedData = cacheService.postsCache as any;
      if (cachedData && cachedData.posts) {
        const post = cachedData.posts.find((p: any) => p.id === postId);
        if (post) postTitle = post.title;
      }

      await feishuClient.bitable.appTableRecord.create({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.requests,
        },
        data: {
          fields: withCurrentFeishuEnvironment({
            "Name": String(`${username} 申请访问 ${postTitle}`),
            "UserID": String(userId),
            "Username": String(username),
            "PostID": String(postId),
            "PostTitle": String(postTitle),
            "Status": 'pending'
          })
        }
      });

      res.json({ success: true, message: '申请已提交至 Feishu，请等待审批' });
    } catch (error) {
      console.error("提交申请失败:", error);
      res.status(500).json({ success: false, message: '服务器错误' });
    }
  }

  public static async getLikes(req: Request, res: Response) {
    try {
      const postId = req.params.id as string;

      let userId: number | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const decoded = jwt.verify(token, config.jwtSecret) as any;
          const user = await prisma.user.findUnique({ where: { id: decoded.id } });
          if (user) userId = user.id;
        } catch (e) {
          // Ignore invalid token
        }
      }

      const likesCount = await prisma.articleLike.count({ where: { postId } });
      let hasLiked = false;

      if (userId) {
        const like = await prisma.articleLike.findUnique({
          where: { userId_postId: { userId, postId } }
        });
        hasLiked = !!like;
      }

      res.json({ success: true, count: likesCount, hasLiked });
    } catch (error) {
      console.error(`[Articles] 获取文章点赞失败:`, error);
      res.status(500).json({ success: false, message: '获取点赞信息失败' });
    }
  }

  public static async toggleLike(req: Request, res: Response) {
    try {
      const postId = req.params.id as string;
      const user = (req as any).user;

      if (!user || !user.id) {
        return res.status(401).json({ success: false, message: '请先登录' });
      }

      const existingLike = await prisma.articleLike.findUnique({
        where: { userId_postId: { userId: user.id, postId } }
      });

      let hasLiked = false;

      if (existingLike) {
        await prisma.articleLike.delete({ where: { id: existingLike.id } });
        hasLiked = false;
      } else {
        await prisma.articleLike.create({
          data: { userId: user.id, postId }
        });
        hasLiked = true;
      }

      const newCount = await prisma.articleLike.count({ where: { postId } });
      res.json({ success: true, count: newCount, hasLiked });
    } catch (error) {
      console.error(`[Articles] 文章点赞操作失败:`, error);
      res.status(500).json({ success: false, message: '操作失败' });
    }
  }

  private static async appendAccessStatus(req: Request, cacheData: any, user: any, isAdmin: boolean) {
    const clonedData = JSON.parse(JSON.stringify(cacheData));
    const requestMap = new Map();
    const passwordPostIds = (clonedData.posts || [])
      .filter((post: any) => post.isPrivate && resolveArticleAccessMode(post.accessMode, true) === 'password')
      .map((post: any) => post.id);
    const grantedPasswordPosts = isAdmin
      ? new Set<string>(passwordPostIds)
      : await ArticlePasswordAccessService.grantedPostIds(req, passwordPostIds);

    if (user && !isAdmin && feishuClient && config.feishu.baseToken && config.feishu.tables.requests) {
      try {
        const response = await feishuClient.bitable.appTableRecord.list({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.requests,
          },
          params: {
            filter: `CurrentValue.[UserID]="${user.id}"`
          }
        });
        if (response.data && response.data.items) {
          filterFeishuRecordsForCurrentEnvironment(response.data.items).forEach((record: any) => {
            const pid = record.fields['PostID'];
            const status = record.fields['Status'];
            if (pid && status) {
              requestMap.set(pid, status);
            }
          });
        }
      } catch (e) {
        console.error("从 Feishu 获取用户申请状态失败", e);
      }
    }

    clonedData.posts = clonedData.posts.map((post: any) => {
      if (post.isPrivate) {
        const mode = resolveArticleAccessMode(post.accessMode, true);
        post.accessStatus = mode === 'password'
          ? grantedPasswordPosts.has(post.id) ? 'approved' : 'locked'
          : isAdmin ? 'approved' : requestMap.get(post.id) || 'none';
      }
      return post;
    });
    return clonedData;
  }
}
