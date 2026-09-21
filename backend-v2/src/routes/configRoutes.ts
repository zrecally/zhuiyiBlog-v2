import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { ConfigController } from '../controllers/ConfigController';

const router = Router();

// 公开接口，获取非敏感配置
router.get('/public', ConfigController.getPublicConfigs);

// 管理员接口，获取所有配置（带脱敏）和更新配置
router.get('/', AuthMiddleware.requireAdmin, ConfigController.getAllConfigs);
router.post('/', AuthMiddleware.requireAdmin, ConfigController.updateConfig);

export default router;
