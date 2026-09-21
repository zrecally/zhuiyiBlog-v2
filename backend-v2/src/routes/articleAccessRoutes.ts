import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ArticlePasswordAccessController } from '../controllers/ArticlePasswordAccessController';
import { requireArticleAccessGateway } from '../middlewares/ArticleAccessGatewayMiddleware';
import { IpUtils } from '../utils/IpUtils';

const router = Router();
router.use(requireArticleAccessGateway);

const redeemLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: { success: false, message: '密码尝试过于频繁，请稍后再试' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: { success: false, message: '读取过于频繁，请稍后再试' },
});

router.post('/posts/:id/redeem', redeemLimiter, ArticlePasswordAccessController.redeem);
router.get('/posts/:id/content', readLimiter, ArticlePasswordAccessController.content);
router.get('/posts/:id/images/:imageToken', readLimiter, ArticlePasswordAccessController.image);

export default router;
