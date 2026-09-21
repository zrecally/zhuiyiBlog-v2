import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { ArticleController } from '../controllers/ArticleController';

const router = Router();

// 基础获取和搜索
router.get('/', ArticleController.getPosts);
router.get('/search', ArticleController.searchPosts);
router.get('/:id/content', ArticleController.getPostContent);

// 交互功能
router.post('/:id/visit', ArticleController.incrementViews);
router.post('/:id/request-access', AuthMiddleware.requireAuth, ArticleController.requestAccess);

// 点赞功能
router.get('/:id/likes', ArticleController.getLikes);
router.post('/:id/like', AuthMiddleware.requireAuth, ArticleController.toggleLike);

export default router;
