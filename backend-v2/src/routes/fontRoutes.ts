import { Router } from 'express';
import { FontController } from '../controllers/FontController';
import { fontReadLimiter } from '../middlewares/RateLimitMiddleware';

const router = Router();

router.get('/:fileName', fontReadLimiter, FontController.getFont);

export default router;
