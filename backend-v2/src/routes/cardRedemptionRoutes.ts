import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CardRedemptionController } from '../controllers/CardRedemptionController';
import { IpUtils } from '../utils/IpUtils';

const router = Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
});
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: { success: false, message: '尝试次数过多，请稍后再试' },
});

const downloadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: { success: false, message: '下载次数过多，请稍后再试' },
});

router.post('/redeem', redeemLimiter, CardRedemptionController.redeem);
// Express otherwise automatically serves HEAD through the GET handler, which
// would consume the one-shot grant during the frontend preflight check.
router.head('/download/:ticket', downloadLimiter, CardRedemptionController.checkDownload);
router.get('/download/:ticket', downloadLimiter, CardRedemptionController.download);

export default router;
