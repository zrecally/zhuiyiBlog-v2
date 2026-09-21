import { Router } from 'express';
import { TimelineController } from '../controllers/TimelineController';

const router = Router();

router.get('/', TimelineController.handleGet0);

export default router;
