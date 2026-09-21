import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ProjectsController } from '../controllers/ProjectsController';
import { IpUtils } from '../utils/IpUtils';

const router = Router();

const projectCoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: 'Too many image requests',
});

router.get('/', ProjectsController.handleGet0);
router.get('/covers/:recordId/:fileToken', projectCoverLimiter, ProjectsController.handleGetCover);

export default router;
