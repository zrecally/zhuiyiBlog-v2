import { Router } from 'express';
import { DanmakuController } from '../controllers/DanmakuController';
import { danmakuLimiter } from '../middlewares/RateLimitMiddleware';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';

const router = Router();

// 注意：AuthMiddleware 目前的 getOptionalUser 是直接返回值而不是标准的 middleware 格式
// 我们需要在路由层面将其包装为一个合法的 middleware
const optionalAuth = (req: any, res: any, next: any) => {
  const user = AuthMiddleware.getOptionalUser(req);
  if (user) req.user = user;
  next();
};

router.post('/', danmakuLimiter, optionalAuth, DanmakuController.postDanmaku);
router.get('/', DanmakuController.getDanmaku);
router.get('/stream', DanmakuController.stream);

export default router;
