import rateLimit from 'express-rate-limit';
import LRUCache from 'lru-cache';
import { Request, Response, NextFunction } from 'express';
import { IpUtils } from '../utils/IpUtils';
import { feishuClient } from '../core/FeishuClient';
import { config } from '../config';
import PQueue from 'p-queue';
import {
  filterFeishuRecordsForCurrentEnvironment,
  withCurrentFeishuEnvironment,
} from '../utils/FeishuEnvironment';

// 恶意 IP 黑名单
export const blacklistedIPs = new LRUCache<string, boolean>({
  max: 10000,
  ttl: 1000 * 60 * 60 * 24 // 封禁 24 小时
});

// 恶意灌水检测记录
export const recentCommentsCache = new LRUCache<string, { time: number, content: string }>({
  max: 10000,
});

export const writeQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 2
});

type BlacklistQueueItem = {
  clientIp: string;
  reason: string;
};

type BanContext = {
  maxRequests: number;
  source: string;
  url: string;
};

const feishuBlacklistQueue: BlacklistQueueItem[] = [];
let isProcessingFeishuBlacklist = false;

const processFeishuBlacklistQueue = async () => {
  if (isProcessingFeishuBlacklist || feishuBlacklistQueue.length === 0) return;
  isProcessingFeishuBlacklist = true;

  while (feishuBlacklistQueue.length > 0) {
    const item = feishuBlacklistQueue.shift();
    if (!item || !feishuClient || !config.feishu.baseToken || !config.feishu.tables.blacklist) continue;
    const { clientIp, reason } = item;

    try {
      const existingRes = await feishuClient.bitable.appTableRecord.list({
        path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.blacklist },
        params: { filter: `CurrentValue.[IP]="${clientIp}"` }
      });

      const existingRecords = filterFeishuRecordsForCurrentEnvironment(existingRes.data?.items || []);
      if (existingRecords.length > 0) {
        const record = existingRecords[0];
        const currentCount = Number(record.fields['Count']) || 1;
        await feishuClient.bitable.appTableRecord.update({
          path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.blacklist, record_id: record.record_id as string },
          data: {
            fields: withCurrentFeishuEnvironment({
              'Count': currentCount + 1,
              'BannedAt': Date.now(),
              'Status': true,
              'Reason': reason,
            })
          }
        });
      } else {
        await feishuClient.bitable.appTableRecord.create({
          path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.blacklist },
          data: {
            fields: withCurrentFeishuEnvironment({
              'IP': clientIp,
              'Reason': reason,
              'Count': 1,
              'BannedAt': Date.now(),
              'Status': true
            })
          }
        });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.error(`[Security] 将恶意 IP(${clientIp}) 写入飞书失败:`, e.message || e);
    }
  }

  isProcessingFeishuBlacklist = false;
};

export const banClientIp = (clientIp: string, context: BanContext): boolean => {
  const normalizedIp = IpUtils.normalize(clientIp);
  if (!IpUtils.isValid(normalizedIp) || IpUtils.isLAN(normalizedIp) || config.blacklistExemptIps.includes(normalizedIp)) {
    console.warn(`[Security] 拒绝封禁无效或内网目标 IP: ${clientIp}`);
    return false;
  }

  if (blacklistedIPs.has(normalizedIp)) return false;

  const reason = `自动触发防刷机制 (>${context.maxRequests}次/分，来源: ${context.source})`;
  console.warn(`[Security] 🚨 触发安全防御：IP ${normalizedIp} 请求频率异常，已被自动封禁 24 小时！`);
  blacklistedIPs.set(normalizedIp, true);

  import('../core/Database').then(({ prisma }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).auditLog.create({
      data: {
        ip: normalizedIp,
        action: 'AUTO_BAN',
        details: `${reason}，自动封禁IP。URL: ${context.url}`
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).catch((e: any) => console.error('[AuditLog] 写入审计日志失败', e));
  });

  if (!feishuBlacklistQueue.some(item => item.clientIp === normalizedIp)) {
    feishuBlacklistQueue.push({ clientIp: normalizedIp, reason });
    void processFeishuBlacklistQueue();
  }

  return true;
};

export const ipBlacklistCheckMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = IpUtils.getClientIp(req);
  if (config.blacklistExemptIps.includes(clientIp)) return next();
  if (blacklistedIPs.has(clientIp)) {
    return res.status(403).json({ success: false, error_code: 'IP_BANNED', message: '您的 IP 已被服务器永久封禁，禁止访问。' });
  }
  next();
};

export const globalAutoBanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  skip: (req) => IpUtils.isLAN(IpUtils.getClientIp(req)),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handler: async (req, res, next, options) => {
    const clientIp = IpUtils.getClientIp(req);
    if (!config.rateLimitAutoBan) {
      return res.status(429).json({ success: false, error_code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试。' });
    }
    const isBanned = banClientIp(clientIp, {
      maxRequests: Number(options.max),
      source: 'backend-api',
      url: req.url,
    });
    if (isBanned) {
      res.status(403).json({ success: false, error_code: 'IP_BANNED', message: '检测到恶意的高频请求，您的 IP 已被封禁。' });
    } else {
      res.status(429).json({ success: false, error_code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试。' });
    }
  }
});

export const beijingStaticAutoBanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 150,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.normalize(req.get('x-zhuiyi-client-ip') || 'unknown'),
  skip: (req) => IpUtils.isLAN(IpUtils.normalize(req.get('x-zhuiyi-client-ip') || 'unknown')),
  handler: (req, res) => {
    const clientIp = IpUtils.normalize(req.get('x-zhuiyi-client-ip') || 'unknown');
    const isBanned = banClientIp(clientIp, {
      maxRequests: 150,
      source: 'beijing-static',
      url: (req.get('x-zhuiyi-request-uri') || '/').slice(0, 2048),
    });
    if (isBanned) {
      res.status(403).json({ success: false, error_code: 'IP_BANNED', message: '检测到恶意的高频请求，您的 IP 已被封禁。' });
    } else {
      res.status(429).json({ success: false, error_code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁，请稍后再试。' });
    }
  },
});

export const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '请求过于频繁，请稍后再试' }
});

export const emailLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '发送邮件过于频繁，请1分钟后再试' }
});

export const emailDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24小时
  max: 30,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '您的 IP 今天发送登录链接的次数已达上限（30次），请明天再试' }
});

export const danmakuLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '发送弹幕过于频繁，请稍后再试' }
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '操作过于频繁，请稍候' }
});

// Missing translation keys are submitted by anonymous public clients. Keep the
// feature available while preventing it from becoming a Feishu write-spam path.
export const i18nMissingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => IpUtils.getClientIp(req),
  message: { success: false, message: '词条上报过于频繁，请稍后再试' },
});

export const fontReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: 'Too many font requests',
});

export const fontUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `admin:${req.user!.id}`,
  message: { success: false, message: '字体上传过于频繁，请稍后再试' },
});

let ipWhitelistCache: string[] | null = null;
let lastIpCacheTime = 0;
const IP_CACHE_TTL = 1000;

export const ipWhitelistMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const clientIp = IpUtils.getClientIp(req);
  console.log(`[Auth] 收到后台访问请求，来源 IP: ${clientIp}`);

  if (IpUtils.isLAN(clientIp)) {
    console.log(`[Auth] 局域网放行: ${clientIp}`);
    return next();
  }

  if (!config.enableIpBlocking) {
    console.log(`[Auth] IP 白名单校验未开启，放行: ${clientIp}`);
    return next();
  }

  let allowedIps: string[] = [];
  const now = Date.now();

  if (ipWhitelistCache && (now - lastIpCacheTime < IP_CACHE_TTL)) {
    allowedIps = ipWhitelistCache;
  } else if (feishuClient && config.feishu.baseToken && config.feishu.tables.ipWhitelist) {
    try {
      const response = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.ipWhitelist,
        },
        params: { page_size: 500 }
      });

      if (response.data && response.data.items) {
        allowedIps = filterFeishuRecordsForCurrentEnvironment(response.data.items)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((item: any) => item.fields && item.fields['Status'] === true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => {
            const ipField = item.fields['IP'];
            if (Array.isArray(ipField)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return ipField.map((f: any) => f.text).join('');
            }
            return ipField ? String(ipField) : '';
          })
          .map(ip => ip.trim())
          .filter(ip => ip);
      }

      ipWhitelistCache = allowedIps;
      lastIpCacheTime = now;
    } catch (error) {
      console.error("[Auth] 从飞书获取 IP 白名单失败:", error);
      // 采取 Fail-Closed（失败即封闭）策略：如果飞书接口报错，优先使用旧缓存。
      // 若连旧缓存也没有，为了安全起见拒绝所有非内网访问。
      allowedIps = ipWhitelistCache || [];
      if (allowedIps.length === 0) {
        return res.status(500).json({
          success: false,
          error_code: 'INTERNAL_ERROR',
          message: '安全服务暂时不可用，请稍后再试。'
        });
      }
    }
  }

  if (!config.feishu.tables.ipWhitelist) {
    return next();
  }

  // 修改了逻辑：只要启用了白名单功能（即配置了 table_id），就必须严格校验。
  // 如果 allowedIps 为空（比如飞书里没有配置任何启用的 IP），除了内网 IP 之外所有请求都会被拒绝。
  if (!allowedIps.includes(clientIp)) {
    console.warn(`[Auth] 拦截非法 IP: ${clientIp} (当前白名单: ${allowedIps.join(', ')})`);
    return res.status(403).json({
      success: false,
      error_code: 'NOT_IN_WHITELIST',
      message: '你的 IP 不在白名单中，已被拒绝访问。',
      ip: clientIp
    });
  }

  next();
};

export const activeSessions = new LRUCache<string, number>({
  max: 5000,
  ttl: 30 * 60 * 1000, // 30 分钟无访问即自动过期淘汰
});

export const sessionTrackerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const ip = IpUtils.getClientIp(req);
  activeSessions.set(ip, Date.now());
  next();
};

// 暴露缓存更新方法给 auth/ip 路由
export const getIpWhitelistCache = () => ipWhitelistCache;
export const setIpWhitelistCache = (ips: string[]) => {
  ipWhitelistCache = ips;
  lastIpCacheTime = Date.now();
};
export const getIpCacheTime = () => lastIpCacheTime;
export const getIpCacheTtl = () => IP_CACHE_TTL;
