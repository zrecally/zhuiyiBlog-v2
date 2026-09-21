import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { PollController } from '../controllers/PollController';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { apiLimiter } from '../middlewares/RateLimitMiddleware';
import { PRODUCT_POLL_ID } from '../services/PollService';

const router = Router();

const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  const user = AuthMiddleware.getOptionalUser(req);
  if (user) req.user = user;
  next();
};

router.get(`/${PRODUCT_POLL_ID}`, optionalAuth, PollController.getProductPoll);
router.post(`/${PRODUCT_POLL_ID}/votes`, apiLimiter, AuthMiddleware.requireAuth, PollController.submitProductPoll);
router.get(`/${PRODUCT_POLL_ID}/admin`, AuthMiddleware.requireAdmin, PollController.getProductPollAdmin);
router.put(`/${PRODUCT_POLL_ID}/admin`, apiLimiter, AuthMiddleware.requireAdmin, PollController.updateProductPollAdmin);

export default router;
