import { Router } from 'express';
import { FeedController } from '../controllers/FeedController';

const router = Router();

router.get('/rss', FeedController.getRss);
router.get('/atom', FeedController.getAtom);
router.get('/json', FeedController.getJson);

// 为了更好的兼容性，提供 .xml 后缀的路由别名
router.get('/rss.xml', FeedController.getRss);
router.get('/atom.xml', FeedController.getAtom);
router.get('/feed.json', FeedController.getJson);

export default router;