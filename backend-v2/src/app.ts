import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import passport from 'passport';
import path from 'path';
import { config } from './config';
import { overrideConsole } from './utils/logger';
import { ipWhitelistMiddleware, globalAutoBanLimiter, ipBlacklistCheckMiddleware, sessionTrackerMiddleware } from './middlewares/RateLimitMiddleware';
import { requestTargetForLogs, traceMiddleware } from './middlewares/TraceMiddleware';
import mainRoutes from './routes/index';
import adminRoutes from './routes/adminRoutes';
import internalSecurityRoutes from './routes/internalSecurityRoutes';
import articleAccessRoutes from './routes/articleAccessRoutes';
import { IpUtils } from './utils/IpUtils';

// 覆盖全局 console
overrideConsole();

const trustsReverseProxy = (ip: unknown) => IpUtils.isTrustedProxy(ip, config.trustedProxyIps);

// ==========================================
// 1. 公共数据面 (Public App - 运行于 3001)
// ==========================================
const publicApp = express();
const isProduction = process.env.NODE_ENV === 'production';
const adminMtlsEnabled = process.env.ADMIN_MTLS_ENABLED !== 'false';

publicApp.set('trust proxy', trustsReverseProxy);
publicApp.use(helmet({
  crossOriginResourcePolicy: false,
  ...(!isProduction ? {
    contentSecurityPolicy: false,
    hsts: false,
  } : {}),
}));

// 全局安全防御矩阵
publicApp.use(ipBlacklistCheckMiddleware); // 全局 IP 黑名单拦截
publicApp.use(traceMiddleware); // 全局慢查询与错误追踪
publicApp.use('/api', globalAutoBanLimiter); // 全局高频自动封禁

publicApp.use(sessionTrackerMiddleware);
publicApp.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [config.frontendUrl, 'https://www.hizhuiyi.cn', 'https://hizhuiyi.cn']
    : '*'
}));
publicApp.use(bodyParser.json({ limit: '50kb' }));
publicApp.use(bodyParser.urlencoded({ extended: true }));

publicApp.use(passport.initialize());

// The Beijing read-only frontend calls this small, shared-secret-protected
// bridge over the private network.  It must live on the data-plane listener:
// the static site's Nginx subrequest does not hold an administrator mTLS
// certificate and must never be sent to the control-plane listener.
publicApp.use('/internal/security', internalSecurityRoutes);
// This route is reachable only from explicitly authorized frontend proxies.
// Browsers use the frontend's same-origin /_access facade and never learn the
// backend address or gateway credential.
publicApp.use('/internal/article-access', articleAccessRoutes);

// 暴露静态资源
publicApp.use(express.static(path.join(__dirname, '../../public')));

// 挂载公网路由
publicApp.use('/api/v1', mainRoutes);

// 公共全局错误处理
publicApp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[Public Error] ${req.method} ${requestTargetForLogs(req)} - IP: ${IpUtils.getClientIp(req)}\n`, err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// ==========================================
// 2. 独立控制面 (Admin App - 运行于 8443)
// ==========================================
const adminApp = express();

adminApp.set('trust proxy', trustsReverseProxy);
adminApp.use(helmet({
  crossOriginResourcePolicy: false,
  ...(!adminMtlsEnabled ? {
    contentSecurityPolicy: false,
    hsts: false,
  } : {}),
}));

adminApp.use(cors({ origin: adminMtlsEnabled ? config.frontendUrl : true }));
adminApp.use(bodyParser.json({ limit: '50kb' }));
adminApp.use(bodyParser.urlencoded({ extended: true }));

// CardDeck 专用域名（cardapi）作用域隔离：该主机名只暴露发卡工作台 API
// （登录 + card-issue + card-oss），其余管理功能仅经由控制面域名访问。
// 必须挂在 adminRoutes 之前；未配置 CARD_API_HOST 时此防护不生效（本地开发不受影响）。
const cardApiHost = config.cardApiHost;
if (cardApiHost) {
  const cardApiAllowed = (p: string) =>
    p === '/api/admin/login' ||
    p.startsWith('/api/admin/card-issue') ||
    p.startsWith('/api/admin/card-oss') ||
    p.startsWith('/api/admin/license');
  adminApp.use((req, res, next) => {
    if ((req.hostname || '').toLowerCase() !== cardApiHost) return next();
    if (cardApiAllowed(req.path)) return next();
    return res.status(404).json({ success: false, message: 'Not Found' });
  });
}

// 挂载 Admin API 和 Security API
adminApp.use('/api/admin', adminRoutes);

// 静态托管 Admin 前端 (必须放在所有 API 路由最后)
// ADMIN_FRONTEND_ENABLED=false 时只保留 API（管理界面由 CardDeck 软件承担）
const adminFrontendPath = path.join(__dirname, '../../admin-frontend/dist');
if (config.adminFrontendEnabled) {
  adminApp.use(express.static(adminFrontendPath));

  // 支持前端 React Router (History Mode)
  adminApp.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/internal/')) {
      res.sendFile(path.join(adminFrontendPath, 'index.html'));
    } else {
      next();
    }
  });
}

// Admin 全局错误处理
adminApp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[Admin Error] ${req.method} ${requestTargetForLogs(req)} - IP: ${IpUtils.getClientIp(req)}\n`, err);
  res.status(500).json({ success: false, message: '管理端内部错误' });
});

// ==========================================
// 全局进程异常捕获
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception] Node.js 进程发生致命错误:', err);
  setImmediate(() => process.exit(1));
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] Promise 发生未捕获的异常:', reason);
  setImmediate(() => process.exit(1));
});

export { publicApp, adminApp };
