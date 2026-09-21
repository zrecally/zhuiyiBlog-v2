import { Router } from 'express';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { AuthController } from '../controllers/AuthController';
import { OAuthController } from '../controllers/OAuthController';
import { ipWhitelistMiddleware, emailLimiter, emailDailyLimiter, strictLimiter } from '../middlewares/RateLimitMiddleware';

const router = Router();

router.get('/ip', AuthController.handleGet0);
router.get('/admin/users', ipWhitelistMiddleware, AuthMiddleware.requireAdmin, AuthController.handleGet1);
router.post('/magic-link', emailDailyLimiter, emailLimiter, AuthController.handlePost2);
router.post('/magic-verify', strictLimiter, AuthController.handlePost3);
router.get('/verify', AuthMiddleware.requireAuth, AuthController.handleGet4);

// OAuth 第三方登录路由
router.get('/github', OAuthController.githubLogin);
router.get('/github/callback', OAuthController.githubCallback);

router.get('/google', OAuthController.googleLogin);
router.get('/google/callback', OAuthController.googleCallback);

router.get('/facebook', OAuthController.facebookLogin);
router.get('/facebook/callback', OAuthController.facebookCallback);


router.get('/discord', OAuthController.discordLogin);
router.get('/discord/callback', OAuthController.discordCallback);

router.get('/microsoft', OAuthController.microsoftLogin);
router.get('/microsoft/callback', OAuthController.microsoftCallback);

export default router;
