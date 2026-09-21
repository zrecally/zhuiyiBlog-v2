import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AlbumController } from '../controllers/AlbumController';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { apiLimiter } from '../middlewares/RateLimitMiddleware';
import { IpUtils } from '../utils/IpUtils';

const router = Router();

const albumImageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: 'Too many image requests',
});

router.get('/', AlbumController.listPublished);
router.get('/images/:variant/:fileName', albumImageLimiter, AlbumController.getImage);
router.post('/sync', apiLimiter, AuthMiddleware.requireAdmin, AlbumController.syncFromFeishu);

export default router;
