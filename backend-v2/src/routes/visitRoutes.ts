import { Router } from 'express';
import { VisitController } from '../controllers/VisitController';

const router = Router();

router.post('/', VisitController.handlePost0);

export default router;
