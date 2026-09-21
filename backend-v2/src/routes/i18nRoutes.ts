import { Router } from 'express';
import { I18nController } from '../controllers/I18nController';
import { i18nMissingLimiter } from '../middlewares/RateLimitMiddleware';

const router = Router();

router.get('/dict', I18nController.getDict);
router.post('/missing', i18nMissingLimiter, I18nController.reportMissing);

export default router;
