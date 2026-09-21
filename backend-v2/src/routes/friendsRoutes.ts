import { Router } from 'express';
import { FriendsController } from '../controllers/FriendsController';
import rateLimit from 'express-rate-limit';

const router = Router();

// 友链申请专用限流：每个 IP 每天最多 1 次
const friendApplyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1, // limit each IP to 1 request per windowMs
  message: { success: false, message: '今日提交次数已达上限，请明日再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/local', FriendsController.handleGet0);
router.get('/', FriendsController.handleGet1);

router.post('/apply', friendApplyLimiter, FriendsController.handleApply);

export default router;
