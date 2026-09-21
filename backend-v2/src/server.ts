import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { publicApp, adminApp } from './app';
import { config } from './config';
import { prisma } from './core/Database';
import { FeishuSyncService } from './services/FeishuSyncService';
import { BackupService } from './services/BackupService';
import { GCService } from './services/GCService';
import { StaticSnapshotService } from './services/static-snapshot/StaticSnapshotService';
import { CardOssSettingsService } from './services/CardOssSettingsService';
import { securityUtils } from './utils/SecurityUtils';
import cron from 'node-cron';

const runsBackgroundJobs = process.env.VERCEL !== '1' && process.env.BACKGROUND_JOBS_ENABLED !== 'false';

void securityUtils.loadCustomSensitiveWordsFromDatabase()
  .then(count => console.log(`[Security] 已加载 ${count} 个控制台自定义敏感词。`))
  .catch(error => console.error('[Security] 加载控制台自定义敏感词失败:', error));

async function ensureLocalSetup(): Promise<void> {
  const username = process.env.LOCAL_CARD_ADMIN_USERNAME;
  const password = process.env.LOCAL_CARD_ADMIN_PASSWORD;
  if (!username || !password || !/^[A-Za-z0-9_-]{3,40}$/.test(username) || password.length < 6) {
    return;
  }
  try {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(password, 10);
    // 确保本地管理员及 admin 账号密码同步更新
    await prisma.admin.upsert({
      where: { username },
      create: { username, password: passwordHash, isActive: true },
      update: { password: passwordHash, isActive: true },
    });
    await prisma.admin.upsert({
      where: { username: 'admin' },
      create: { username: 'admin', password: passwordHash, isActive: true },
      update: { password: passwordHash, isActive: true },
    });
    console.log(`[LocalSetup] 本地测试管理员账号已就绪: ${username}, admin`);
    const compliance = {
      static_compliance_enabled: 'true',
      static_compliance_icp_number: '本地测试 ICP 备案号',
      static_compliance_police_number: '本地测试公安备案号',
      static_compliance_police_record_code: '11000000000001',
    };
    for (const [key, value] of Object.entries(compliance)) {
      await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value, isSecret: false } });
    }
  } catch (err) {
    console.warn('[LocalSetup] 本地环境初始化检查跳过或未完成:', err);
  }
}

// OSS runtime settings are database-backed and must load even when the local
// Compose environment deliberately disables scheduled jobs.
if (config.cardRedeem.enabled) {
  void CardOssSettingsService.load().catch(console.error);
  void ensureLocalSetup().catch(console.error);
}

if (runsBackgroundJobs) {
  // 每天凌晨 00:00 自动备份数据库
  cron.schedule('0 0 * * *', () => {
    BackupService.performBackup().catch(console.error);
  });

  // 每天凌晨 03:00 自动清理无效缓存和 Token
  cron.schedule('0 3 * * *', () => {
    GCService.performGC().catch(console.error);
  });
}

// ==========================================
// Docker 环境下的定时任务与服务启动
// ==========================================
if (runsBackgroundJobs && config.feishu.baseToken) {
  // 定时任务：每 5 分钟拉取飞书后台数据（错峰启动防雪崩）
  setTimeout(() => {
    FeishuSyncService.syncAdminsToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncAdminsToLocal().catch(console.error), 5 * 60 * 1000);
  }, 5000);

  setTimeout(() => {
    FeishuSyncService.syncPostsInBackground().catch(console.error);
    setInterval(() => FeishuSyncService.syncPostsInBackground().catch(console.error), 5 * 60 * 1000);
  }, 15000);

  setTimeout(() => {
    FeishuSyncService.syncCommentsToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncCommentsToLocal().catch(console.error), 5 * 60 * 1000);
  }, 25000);

  setTimeout(() => {
    FeishuSyncService.syncBlacklistFromFeishuToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncBlacklistFromFeishuToLocal().catch(console.error), 5 * 60 * 1000);
  }, 35000);

  setTimeout(() => {
    FeishuSyncService.syncConfigFromFeishuToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncConfigFromFeishuToLocal().catch(console.error), 5 * 60 * 1000);

    FeishuSyncService.syncI18nFromFeishuToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncI18nFromFeishuToLocal().catch(console.error), 5 * 60 * 1000);
  }, 45000);

  setTimeout(() => {
    FeishuSyncService.syncUsersFromFeishuToLocal().catch(console.error);
    setInterval(() => FeishuSyncService.syncUsersFromFeishuToLocal().catch(console.error), 5 * 60 * 1000);
  }, 55000);

  if (config.articleAccess.enabled && config.feishu.tables.articleAccessCodes) {
    setTimeout(() => {
      FeishuSyncService.syncArticleAccessCodesToLocal().catch(console.error);
      setInterval(() => FeishuSyncService.syncArticleAccessCodesToLocal().catch(console.error), 60 * 1000);
    }, 60000);
  }

  // 飞书卡密同步默认关闭（卡密数据不经过飞书以减少暴露面）；
  // 仅当显式设置 CARD_REDEEM_FEISHU_SYNC=true 时启用。
  if (config.cardRedeem.enabled && config.cardRedeem.feishuSyncEnabled && config.feishu.tables.cardCodes) {
    setTimeout(() => {
      FeishuSyncService.syncCardCodesToLocal().catch(console.error);
      setInterval(() => FeishuSyncService.syncCardCodesToLocal().catch(console.error), 60 * 1000);
    }, 70000);
  }

  if (config.feishu.tables.album) {
    setTimeout(() => {
      FeishuSyncService.syncAlbumsToLocal()
        .then(() => StaticSnapshotService.publishAfterFeishuSync())
        .catch(console.error);
      setInterval(() => {
        FeishuSyncService.syncAlbumsToLocal()
          .then(() => StaticSnapshotService.publishAfterFeishuSync())
          .catch(console.error);
      }, 5 * 60 * 1000);
    }, 65000);
  } else {
    // Albums are optional until the corresponding Feishu table is configured.
    // Do not turn an incomplete optional feature into a recurring error alert.
    console.warn('[AlbumSync] 已跳过：未配置 FEISHU_ALBUM_TABLE_ID');
  }
}

// ==========================================
// 启动数据面服务 (Public API) - 端口 3000
// ==========================================
const publicServer = http.createServer(publicApp).listen(config.port, config.host, () => {
  console.log(`[System] Public Server is running on http://${config.host}:${config.port}`);
  console.log(`[System] 当前环境 JWT_SECRET 已配置`);
  console.log(`[System] 飞书数据环境: ${config.feishu.dataEnvironment}${config.feishu.allowLegacyBlankEnvironment ? '(兼容空值旧记录)' : ''}`);
  console.log(`[System] IP 访问控制功能已${config.enableIpBlocking ? '开启' : '关闭'}`);
});

// ==========================================
// 启动控制面服务 (Admin UI & API) - 端口 8443。
// 生产默认强制 mTLS；本地 Docker 可显式设为 false，以便在 localhost 上查看界面。
// ==========================================
const adminMtlsEnabled = process.env.ADMIN_MTLS_ENABLED !== 'false';
let adminServer: http.Server | https.Server | null = null;

if (!adminMtlsEnabled) {
  adminServer = http.createServer(adminApp).listen(config.adminPort, config.host, () => {
    console.warn(`[Security] Admin Control Plane is running without mTLS on http://${config.host}:${config.adminPort} (local-only mode)`);
  });
} else try {
  // Use environment variable or default to process.cwd()/tests/certs
  const certPath = process.env.CERT_PATH || path.join(process.cwd(), 'tests/certs');
  console.log(`[Security] 尝试从路径加载证书: ${certPath}`);

  const httpsOptions = {
    key: fs.readFileSync(path.join(certPath, 'server.key')),
    cert: fs.readFileSync(path.join(certPath, 'server.crt')),
    ca: fs.readFileSync(path.join(certPath, 'ca.crt')),
    requestCert: true,          // 强制请求客户端证书
    rejectUnauthorized: true    // 拒绝未提供证书或证书不合法的连接
  };

  adminServer = https.createServer(httpsOptions, adminApp).listen(config.adminPort, config.host, () => {
    console.log(`[Security] Admin Control Plane (mTLS) is running on https://${config.host}:${config.adminPort}`);
  });
} catch (error) {
  console.error('[Security] 无法启动 Admin mTLS 控制面。请检查证书文件是否完整:', error);
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

// ==========================================
// 优雅关机与连接排空 (Graceful Shutdown)
// ==========================================
let isShuttingDown = false;

const gracefulShutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[System] 收到 ${signal} 信号，开始执行优雅关机流程...`);

  // 设置 10 秒硬性超时保护，防止挂起连接阻碍退出
  const forceExitTimer = setTimeout(() => {
    console.error('[System] 优雅关机超时 (10s)，强制退出进程。');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  const closePromises: Promise<void>[] = [];

  if (publicServer) {
    closePromises.push(new Promise((resolve) => {
      publicServer.close((err) => {
        if (err) console.error('[System] 关闭 Public Server 出错:', err);
        else console.log('[System] Public Server 已停止接收新请求并排空连接。');
        resolve();
      });
    }));
  }

  if (adminServer) {
    closePromises.push(new Promise((resolve) => {
      adminServer!.close((err) => {
        if (err) console.error('[System] 关闭 Admin Server 出错:', err);
        else console.log('[System] Admin Server 已停止接收新请求并排空连接。');
        resolve();
      });
    }));
  }

  Promise.all(closePromises)
    .then(async () => {
      try {
        await prisma.$disconnect();
        console.log('[Database] 数据库连接已安全断开。');
      } catch (err) {
        console.error('[Database] 断开数据库连接时出错:', err);
      }
      console.log('[System] 优雅关机完成，进程正常退出。');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[System] 优雅关机过程中发生异常:', err);
      process.exit(1);
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
