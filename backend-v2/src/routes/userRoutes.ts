import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { UserController } from '../controllers/UserController';

const router = Router();

router.get('/me', AuthMiddleware.requireAuth, UserController.handleGet0);
router.put('/me', AuthMiddleware.requireAuth, UserController.handlePut1);

router.get('/collections', AuthMiddleware.requireAuth, UserController.getCollections);
router.post('/history', AuthMiddleware.requireAuth, UserController.addHistory);
router.get('/history', AuthMiddleware.requireAuth, UserController.getHistory);
router.delete('/history', AuthMiddleware.requireAuth, UserController.clearHistory);
router.delete('/history/:id', AuthMiddleware.requireAuth, UserController.deleteHistory);

export default router;
