import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { FeedbackController } from '../controllers/FeedbackController';
import { apiLimiter } from '../middlewares/RateLimitMiddleware';

const router = Router();

router.post('/', apiLimiter, AuthMiddleware.requireAuth, FeedbackController.handlePost0);

export default router;
