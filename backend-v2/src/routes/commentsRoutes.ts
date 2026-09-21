import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { CommentsController } from '../controllers/CommentsController';
import { apiLimiter } from '../middlewares/RateLimitMiddleware';

const router = Router();

router.get('/:postId', CommentsController.handleGet0);
router.get('/stream/:postId', CommentsController.handleStreamComments);
router.post('/', apiLimiter, AuthMiddleware.requireAuth, CommentsController.handlePost1);
router.delete('/:id', AuthMiddleware.requireAuth, CommentsController.handleDeleteComment);
router.get('/feishu/:articleId', CommentsController.handleGet2);
router.post('/:commentId/action', apiLimiter, AuthMiddleware.requireAuth, CommentsController.handlePost3);

export default router;
