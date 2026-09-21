import { Request, Response } from 'express';
import { cacheService } from '../services/CacheService';
import { ArticlePasswordAccessService } from '../services/ArticlePasswordAccessService';
import { FeishuMarkdownParser } from '../services/FeishuMarkdownParser';
import { resolveArticleAccessMode } from '../utils/ArticleAccess';
import { ImageController } from './ImageController';

const SAFE_POST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_IMAGE_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

const passwordPost = (postId: string) => {
  if (!SAFE_POST_ID.test(postId)) return null;
  const post = cacheService.postsCache?.posts?.find((item: any) => item.id === postId);
  if (!post || post.isPublished !== true) return null;
  return resolveArticleAccessMode(post.accessMode, post.isPrivate === true) === 'password' ? post : null;
};

const privateImageUrl = (postId: string, token: string) => (
  `/_access/posts/${encodeURIComponent(postId)}/images/${encodeURIComponent(token)}`
);

const rewritePrivateImages = (content: string, postId: string): string => (
  content.replace(
    /\/api\/v1\/image\/(?:[A-Za-z0-9_-]+\/)?([A-Za-z0-9_-]{1,256})/g,
    (_match, token: string) => privateImageUrl(postId, token),
  )
);

export class ArticlePasswordAccessController {
  public static async redeem(req: Request, res: Response) {
    const postId = req.params.id as string;
    if (!passwordPost(postId)) return res.status(404).end();

    try {
      const result = await ArticlePasswordAccessService.redeem(req, res, postId, req.body?.password);
      res.set('Cache-Control', 'no-store');
      if (!result.success) {
        return res.status(result.status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: '密码验证成功', expiresAt: result.expiresAt });
    } catch (error) {
      console.error('[ArticleAccess] 一次性密码核销失败:', error);
      return res.status(503).json({ success: false, message: '验证服务暂不可用，请稍后重试' });
    }
  }

  public static async content(req: Request, res: Response) {
    const postId = req.params.id as string;
    const post = passwordPost(postId);
    if (!post) return res.status(404).end();
    res.set('Cache-Control', 'private, no-store, max-age=0');

    if (!(await ArticlePasswordAccessService.hasGrant(req, postId))) {
      return res.status(401).json({
        success: false,
        isPrivate: true,
        accessMode: 'password',
        accessStatus: 'locked',
        message: '请输入一次性访问密码',
      });
    }

    let content = cacheService.postContents.get(postId) || '';
    if (!content && post.docId) {
      content = await FeishuMarkdownParser.fetchDocContent(post.docId, postId, post.isWiki === true) || '';
      if (content) cacheService.postContents.set(postId, content);
    }
    if (!content) return res.status(503).json({ success: false, message: '文章正文暂不可用' });

    return res.json({
      success: true,
      content: rewritePrivateImages(content, postId),
      isPrivate: true,
      accessMode: 'password',
      accessStatus: 'approved',
    });
  }

  public static async image(req: Request, res: Response) {
    const postId = req.params.id as string;
    const imageToken = req.params.imageToken as string;
    if (!passwordPost(postId) || !SAFE_IMAGE_TOKEN.test(imageToken)) return res.status(404).end();
    if (!(await ArticlePasswordAccessService.hasGrant(req, postId))) return res.status(404).end();
    res.locals.privateArticleAsset = true;
    res.set('Cache-Control', 'private, no-store, max-age=0');
    return ImageController.handleGet0(req, res);
  }
}
