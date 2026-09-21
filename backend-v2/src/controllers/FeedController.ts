import { Request, Response } from 'express';
import { Feed } from 'feed';
import { cacheService } from '../services/CacheService';
import { config } from '../config';
import { logger } from '../utils/logger';

export class FeedController {
  /**
   * The Feishu cache may contain display-oriented dates (for example a Chinese
   * formatted string) that `Date` cannot parse.  The feed package serializes
   * every item with `toISOString`, so always give it a valid Date instance.
   */
  private static toFeedDate(post: Record<string, unknown>): Date {
    const candidates = [post.date, post.updatedAt, post.createdAt];
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      if (typeof candidate === 'string' || typeof candidate === 'number') {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }
    return new Date();
  }

  private static generateFeed(): Feed | null {
    try {
      const postsCache = cacheService.postsCache;
      if (!postsCache || !postsCache.posts) {
        return null;
      }

      const siteConfig = postsCache.config;
      const baseUrl = (config.frontendUrl || 'https://www.hizhuiyi.cn').replace(/\/$/, '');

      const feed = new Feed({
        title: siteConfig.title || 'ZhuiYi Blog',
        description: siteConfig.description || 'Welcome to my blog',
        id: baseUrl,
        link: baseUrl,
        language: 'zh-CN',
        image: siteConfig.avatar || `${baseUrl}/favicon.ico`,
        favicon: `${baseUrl}/favicon.ico`,
        copyright: `All rights reserved ${new Date().getFullYear()}, ${siteConfig.title}`,
        updated: new Date(),
        generator: 'ZhuiYi Blog Feed Generator',
        feedLinks: {
          json: `${baseUrl}/api/v1/feed/json`,
          atom: `${baseUrl}/api/v1/feed/atom`,
          rss: `${baseUrl}/api/v1/feed/rss`
        },
        author: {
          name: siteConfig.title || 'Author',
          link: baseUrl
        }
      });

      // 只输出已发布、公开且已到发布日期的文章，防止订阅器提前看到定时内容。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const publishedPosts = postsCache.posts
        .filter((p: any) => {
          if (!p.isPublished || p.isPrivate) return false;
          const date = FeedController.toFeedDate(p);
          return date.getTime() <= Date.now();
        })
        .slice(0, 20);

      publishedPosts.forEach((post: any) => {
        const url = `${baseUrl}/posts/${post.id}`;

        feed.addItem({
          title: post.title || '无标题',
          id: url,
          link: url,
          description: post.summary || '',
          content: cacheService.postContents.get(post.id) || post.summary || '', // 从分离的 postContents 中读取正文
          author: [
            {
              name: siteConfig.title || 'Author',
              link: baseUrl
            }
          ],
          date: FeedController.toFeedDate(post),
          image: post.image || ''
        });
      });

      return feed;
    } catch (error) {
      logger.error('Generate Feed Error: ', error);
      return null;
    }
  }

  public static async getRss(req: Request, res: Response) {
    const feed = FeedController.generateFeed();
    if (!feed) {
      return res.status(500).send('Feed generation failed or no data available.');
    }
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600'); // 缓存 1 小时
    res.send(feed.rss2());
  }

  public static async getAtom(req: Request, res: Response) {
    const feed = FeedController.generateFeed();
    if (!feed) {
      return res.status(500).send('Feed generation failed or no data available.');
    }
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(feed.atom1());
  }

  public static async getJson(req: Request, res: Response) {
    const feed = FeedController.generateFeed();
    if (!feed) {
      return res.status(500).json({ error: 'Feed generation failed or no data available.' });
    }
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(feed.json1());
  }
}
