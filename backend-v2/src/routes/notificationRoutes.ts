import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';

const router = Router();

// 注意：AuthMiddleware 的 verifyAdmin 验证管理员，我们需要增加一个验证普通用户的中间件
// 目前系统复用了 verifyAdmin 作为 token 验证，因为 jwt 逻辑都在那里，我们修改一下
const verifyToken = (req: any, res: any, next: any) => {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: '未提供身份令牌' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const { config } = require('../config');
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token 无效或已过期' });
  }
};

router.get('/', verifyToken, NotificationController.getNotifications);
router.get('/stream', verifyToken, NotificationController.stream);
router.post('/read', verifyToken, NotificationController.markAsRead);

export default router;
