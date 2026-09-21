import { NextFunction, Request, Response, Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { AdminController } from '../controllers/AdminController';
import { AdminSyncController } from '../controllers/AdminSyncController';
import { CardIssueController } from '../controllers/CardIssueController';
import { CardOssConfigController, ossUploadMiddleware, uploadObject, deleteObject, uploadProgress } from '../controllers/CardOssConfigController';
import { StaticSiteAdminController } from '../controllers/StaticSiteAdminController';
import { FriendsController } from '../controllers/FriendsController';
import { LicenseAdminController } from '../controllers/LicenseAdminController';
import multer from 'multer';
import { FontController } from '../controllers/FontController';
import { ipWhitelistMiddleware, strictLimiter, apiLimiter, fontUploadLimiter } from '../middlewares/RateLimitMiddleware';
import { config } from '../config';

const router = Router();
const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
});
const parseFontUpload = (req: Request, res: Response, next: NextFunction) => {
  fontUpload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: '字体文件不能超过 10 MiB' });
    }
    return res.status(400).json({ success: false, message: '字体上传请求格式无效' });
  });
};

router.get('/stats', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.handleGet0);
router.get('/health', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getHealth);
router.get('/audit-logs', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getAuditLogs);
router.get('/comments', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getComments);
router.delete('/comments/:id', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.deleteComment);
router.post('/cache/clear', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.clearCache);
router.post('/login', strictLimiter, ipWhitelistMiddleware, AdminController.handlePost1);
router.post('/totp/setup', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.handlePost2);
router.post('/totp/verify', strictLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.handlePost3);
router.get('/access-requests', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.handleGet4);
router.put('/access-requests/:id', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.handlePut5);
router.post('/sync/:module', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminSyncController.syncModule);
if (config.cardRedeem.enabled) {
router.get('/card-issue/pools', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.getPools);
router.get('/card-issue/traffic', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.getTraffic);
router.post('/card-issue/issue', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.issue);
router.get('/card-issue/cards', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.lookupCard);
router.post('/card-issue/cards/reset', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.resetCard);
router.post('/card-issue/cards/revoke', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardIssueController.revokeCard);
router.get('/card-oss/config', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardOssConfigController.get);
router.post('/card-oss/config', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardOssConfigController.save);
router.post('/card-oss/test', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, CardOssConfigController.test);
router.post('/card-oss/upload', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, ossUploadMiddleware, uploadObject);
router.get('/card-oss/upload-progress', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, uploadProgress);
router.delete('/card-oss/objects', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, deleteObject);
}

// 编排模式授权卡密管理（AgentDeck Pro）
router.get('/license/list', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.list);
router.post('/license/issue', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.issue);
router.post('/license/issue-offline', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.issueOffline);
router.post('/license/bind', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.bind);
router.post('/license/revoke', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.revoke);
router.post('/license/unbind', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.unbind);

// 插件包版本发布与查询（独立分发 + 自动迭代）
router.post('/license/plugin/publish', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.publishPlugin);
router.get('/license/plugin/versions', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.pluginVersions);
// 按设备指纹现签专属包并推送 OSS（CardDeck 工作台一键交付）
router.post('/license/plugin/issue-oss', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, LicenseAdminController.issuePluginPackageOss);

router.get('/static-site/status', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, StaticSiteAdminController.getStaticSitesStatus);
router.post('/static-site/publish', apiLimiter, ipWhitelistMiddleware, AuthMiddleware.requireAdmin, StaticSiteAdminController.publish);
router.get('/danmaku', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getDanmakus);
router.delete('/danmaku/:id', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.deleteDanmaku);

// 新增控制台 V2 真实数据接口
router.get('/nodes/status', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getNodesStatus);
router.get('/system/config', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getSystemConfig);
router.put('/system/config', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.updateSystemConfig);
router.post('/system/font', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, fontUploadLimiter, parseFontUpload, FontController.uploadFont);
router.get('/poll', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getProductPoll);
router.put('/poll', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.updateProductPoll);
router.get('/users', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AdminController.getUsers);
router.get('/friends', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, FriendsController.handleGet0);

export default router;
