import { Router } from 'express';
import { FeishuBotController } from '../controllers/FeishuBotController';

const router = Router();

// 飞书事件订阅的 Webhook 接口
router.post('/events', FeishuBotController.handleEvent);

// 飞书卡片交互的回调接口
router.post('/card-callback', FeishuBotController.handleCardCallback);

export default router;
