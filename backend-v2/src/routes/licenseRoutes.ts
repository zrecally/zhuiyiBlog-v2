import fs from 'node:fs';
import { Router, Request, Response } from 'express';
import { config } from '../config';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { LicenseService, LicenseError } from '../services/LicenseService';
import { PluginPackageService } from '../services/PluginPackageService';
import { LicenseSigner } from '../utils/LicenseSigner';
import { IpUtils } from '../utils/IpUtils';

/**
 * 编排模式插件授权（公网数据面）：
 *   POST /api/license/activate {key, deviceId, machineName?}
 *   POST /api/license/verify   {key, deviceId}
 *   POST /api/license/plugin/check   {id?, currentVersion, deviceId, key?}   自动迭代版本检查
 *   GET  /api/license/plugin/download?id&deviceId&key   按设备指纹现签插件包下载
 * 买家（AgentDeck）无客户端证书，此面走普通 HTTPS + 限流 + 模糊错误。
 */

const router = Router();

// 交付票据：一次激活 = 一张 10 分钟有效的一次性下载凭证（防链接扩散）
const deliveryTickets = new Map<string, { ossKey: string; version: string; expiresAt: number; used: boolean }>();

const ipKey = (req: Request) => IpUtils.getClientIp(req);

const activateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: '尝试过于频繁，请稍后再试' },
});

const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: '校验过于频繁，请稍后再试' },
});

const pluginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: '请求过于频繁，请稍后再试' },
});

const trialLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: '尝试过于频繁，请稍后再试' },
});

const fail = (res: Response, err: unknown) => {
  const status = (err as { status?: number }).status ?? 500;
  const exposed = (err as { exposed?: boolean }).exposed === true;
  const message = exposed && err instanceof Error ? err.message : '服务暂时不可用，请稍后再试';
  return res.status(status).json({ error: message });
};

router.post('/activate', activateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await LicenseService.activate(
      req.body?.key,
      req.body?.deviceId,
      req.body?.machineName,
      ipKey(req),
    );

    // 卡密激活成功 → 立即现签设备专属包并上传 OSS，签发一次性交付票据（10 分钟有效）
    if (PluginPackageService.pluginOssReady()) {
      try {
        const latest = PluginPackageService.latest('orchestration-pro');
        if (latest) {
          const prevIteration = Math.max(0, Math.floor(Number(req.body?.installedIteration) || 0));
          const up = await PluginPackageService.mintUploadAndPresign({
            info: latest,
            deviceId: String(req.body?.deviceId || ''),
            licenseKey: LicenseService.normalize(req.body?.key),
            expiresAt: result.expiresAt,
            iteration: prevIteration + 1,
          });
          const ticket = crypto.randomBytes(16).toString('hex');
          deliveryTickets.set(ticket, {
            ossKey: up.ossKey,
            version: up.version,
            expiresAt: Date.now() + 10 * 60 * 1000,
            used: false,
          });
          result.downloadUrl = `/api/v1/license/plugin/deliver?ticket=${ticket}`;
          (result as any).pluginVersion = up.version;
        }
      } catch (err) {
        console.error('[License] 激活后自动上传专属包失败（保留直连下载通道）:', err);
      }
    }

    return res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '激活失败，请稍后再试';
    return res.status(status).json({ error: message });
  }
});

router.post('/verify', verifyLimiter, async (req: Request, res: Response) => {
  try {
    const result = await LicenseService.verify(req.body?.key, req.body?.deviceId, ipKey(req));
    if (!result.valid) {
      return res.status(403).json({ error: '授权码已过期，请续费', valid: false, expiresAt: result.expiresAt });
    }
    return res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '校验失败，请稍后再试';
    return res.status(status).json({ error: message });
  }
});

// 服务器计时试用：一台设备一次（TRIAL_DAYS，默认 3 天），倒计时只在服务器侧
router.post('/trial', trialLimiter, async (req: Request, res: Response) => {
  try {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
    const machineName = typeof req.body?.machineName === 'string' ? req.body.machineName.trim().slice(0, 120) : '';
    if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: '设备指纹无效' });
    }
    const result = await LicenseService.startTrial(deviceId, machineName, ipKey(req));
    return res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '试用请求失败，请稍后再试';
    return res.status(status).json({ error: message });
  }
});

// 自动迭代：客户端上报当前安装版本与本机指纹，询问是否有更新
router.post('/plugin/check', pluginLimiter, async (req: Request, res: Response) => {
  try {
    const pluginId = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : 'orchestration-pro';
    const currentVersion = typeof req.body?.currentVersion === 'string' ? req.body.currentVersion.trim() : '';
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!deviceId) {
      return res.status(400).json({ error: '缺少设备指纹' });
    }

    // 纯元数据查询；授权校验在 /plugin/download（硬门禁）处执行
    const latest = PluginPackageService.latest(pluginId);
    if (!latest) {
      return res.json({ updateAvailable: false, pluginId, currentVersion });
    }

    const versionLess = (a: string, b: string): boolean => {
      const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
      const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < 3; i += 1) {
        const av = pa[i] ?? 0;
        const bv = pb[i] ?? 0;
        if (av !== bv) return av < bv;
      }
      return false;
    };
    const hasUpdate = !currentVersion || versionLess(currentVersion, latest.version);

    return res.json({
      updateAvailable: hasUpdate,
      pluginId,
      currentVersion,
      latestVersion: latest.version,
      changelog: latest.changelog,
      minHostVersion: latest.minHostVersion,
      publishedAt: latest.publishedAt,
      activeKid: LicenseSigner.activeKid,
      downloadUrl: `/api/v1/license/plugin/download?id=${encodeURIComponent(pluginId)}&deviceId=${encodeURIComponent(deviceId)}&key=${encodeURIComponent(key)}`,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '检查更新失败，请稍后再试';
    return res.status(status).json({ error: message, updateAvailable: false });
  }
});

// 独立分发：按请求设备指纹「现签」插件包（deviceId 写入 Ed25519 签名串，包体换机即失效）
router.get('/plugin/download', pluginLimiter, async (req: Request, res: Response) => {
  try {
    const pluginId = typeof req.query?.id === 'string' && req.query.id.trim() ? req.query.id.trim() : 'orchestration-pro';
    const deviceId = typeof req.query?.deviceId === 'string' ? req.query.deviceId.trim() : '';
    const key = typeof req.query?.key === 'string' ? req.query.key.trim() : '';
    if (!deviceId || deviceId.length < 8) {
      return res.status(400).json({ error: '缺少设备指纹，拒绝分发' });
    }

    // 授权通道二选一：
    //   携带授权码 → 核验绑定，包有效期跟随授权；
    //   无授权码   → 试用通道，包有效期绑定试用到期；试用已结束直接拒绝下载。
    let expiresAt: number | null = null;
    let licenseKey = '*';
    if (key) {
      const result = await LicenseService.verify(key, deviceId, ipKey(req));
      if (!result.valid) {
        return res.status(403).json({ error: '授权校验未通过，禁止下载插件包' });
      }
      licenseKey = LicenseService.normalize(key);
      expiresAt = result.expiresAt;
    } else {
      // 冻结设备：名下有已吊销卡密 → 拒绝（防“吊销后再领试用”绕过）
      if (await LicenseService.isDeviceFrozen(deviceId)) {
        return res.status(403).json({ error: '该设备已被冻结，请联系管理员解冻后再试' });
      }
      const trial = await LicenseService.getTrialState(deviceId);
      if (!trial) {
        return res.status(403).json({ error: '该设备尚未获取试用或激活授权，请先在客户端联网获取试用' });
      }
      if (trial.expired) {
        return res.status(403).json({ error: '试用已结束，插件包已停用；请激活授权后重新获取插件包' });
      }
      licenseKey = 'TRIAL';
      expiresAt = trial.expiresAt;
    }

    const latest = PluginPackageService.latest(pluginId);
    if (!latest) {
      return res.status(404).json({ error: '插件包暂未提供' });
    }

    // 指纹迭代：客户端携带当前已装清单的迭代参数，服务端自动 +1 签发
    const prevIteration = Math.max(0, Math.floor(Number(req.query?.iteration) || 0));
    const iteration = prevIteration + 1;

    // OSS 分发模式（可选）：配置 LICENSE_PLUGIN_OSS_* 后，现签 → 推送 OSS → 302 直链
    if (PluginPackageService.pluginOssReady()) {
      const up = await PluginPackageService.mintUploadAndPresign({
        info: latest, deviceId, licenseKey, expiresAt, iteration,
      });
      res.setHeader('X-Plugin-Version', up.version ?? latest.version);
      res.setHeader('X-Plugin-Delivery', 'oss-redirect');
      return res.redirect(302, up.url);
    }

    // OSS 未配置时的兜底：直接下发
    const zip = PluginPackageService.buildDeviceBoundZip({
      info: latest, deviceId, licenseKey, expiresAt, iteration,
    });
    res.setHeader('X-Plugin-Version', latest.version);
    res.setHeader('X-Plugin-Payload-SHA256', latest.payloadSHA256);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pluginId}-${latest.version}.zip"`);
    return res.send(zip);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '插件包分发失败，请稍后再试';
    return res.status(status).json({ error: message });
  }
});

// 一次性交付：凭票据 302 到 OSS 直链（票据 10 分钟有效、只能用一次）
router.get('/plugin/deliver', pluginLimiter, async (req: Request, res: Response) => {
  const ticket = typeof req.query?.ticket === 'string' ? req.query.ticket.trim() : '';
  const t = deliveryTickets.get(ticket);
  if (!t || t.used) {
    return res.status(403).json({ error: '下载凭证已失效或已被使用，请重新激活获取新链接' });
  }
  if (t.expiresAt < Date.now()) {
    deliveryTickets.delete(ticket);
    return res.status(403).json({ error: '下载凭证已过期（10 分钟有效），请重新激活获取新链接' });
  }
  t.used = true;
  deliveryTickets.delete(ticket);
  const presigned = await PluginPackageService.presignPluginObject(t.ossKey, `orchestration-pro-${t.version}.zip`);
  return res.redirect(302, presigned.url);
});

// 解密密钥分发：仅对授权/试用有效的设备发放当次包的载荷解密密钥（K 不落盘、不进包）
router.post('/plugin/key', pluginLimiter, async (req: Request, res: Response) => {
  try {
    const pluginId = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : 'orchestration-pro';
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const iteration = Math.max(1, Math.floor(Number(req.body?.iteration) || 1));
    if (!deviceId || deviceId.length < 8) {
      return res.status(400).json({ error: '缺少设备指纹' });
    }
    const latest = PluginPackageService.latest(pluginId);
    if (!latest) {
      return res.status(404).json({ error: '插件包暂未提供' });
    }

    let expiresAt: number | null = null;
    if (key) {
      const result = await LicenseService.verify(key, deviceId, ipKey(req));
      if (!result.valid) {
        return res.status(403).json({ error: '授权校验未通过，服务器拒绝解锁插件载荷' });
      }
      expiresAt = result.expiresAt;
    } else {
      // 冻结设备：名下有已吊销卡密 → 拒绝（防“吊销后再领试用”绕过）
      if (await LicenseService.isDeviceFrozen(deviceId)) {
        return res.status(403).json({ error: '该设备已被冻结，禁止分发解密密钥' });
      }
      const trial = await LicenseService.getTrialState(deviceId);
      if (!trial) {
        return res.status(403).json({ error: '该设备尚未获取试用或激活授权' });
      }
      if (trial.expired) {
        return res.status(403).json({ error: '试用已结束，插件包已停用；请激活授权后重新获取插件包' });
      }
      expiresAt = trial.expiresAt;
    }

    const payloadKey = PluginPackageService.payloadKey(deviceId, iteration);
    return res.json({
      key: payloadKey.toString('hex'),
      iteration,
      version: latest.version,
      expiresAt,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '密钥分发失败，请稍后再试';
    return res.status(status).json({ error: message });
  }
});

// 插件包元数据清单（旧版客户端兼容）：供客户端拉取版本、下载链接与 SHA256 校验和
router.get('/manifest', async (_req: Request, res: Response) => {
  try {
    const latest = PluginPackageService.latest('orchestration-pro');
    if (latest) {
      return res.json({
        id: 'orchestration-pro',
        name: latest.name,
        version: latest.version,
        minHostVersion: latest.minHostVersion || '1.0.0',
        description: latest.description || 'AgentDeck 编排模式 Pro 插件包',
        downloadUrl: '/api/v1/license/plugin/download',
        sha256: latest.payloadSHA256,
        size: null,
      });
    }

    let sha256: string | null = null;
    let size: number | null = null;
    const file = config.license.pluginFile;
    if (file && fs.existsSync(file)) {
      const stats = fs.statSync(file);
      size = stats.size;
      const data = fs.readFileSync(file);
      sha256 = require('node:crypto').createHash('sha256').update(data).digest('hex');
    }
    return res.json({
      id: 'orchestration-pro',
      name: '编排模式 Pro',
      version: '1.0.0',
      minHostVersion: '1.0.0',
      description: 'AgentDeck 编排模式 Pro 插件包',
      downloadUrl: '/api/v1/license/download',
      sha256,
      size,
    });
  } catch (err) {
    return res.status(500).json({ error: '无法读取插件清单' });
  }
});

// 插件包下载：校验 key↔设备绑定后，回源到配置的插件包文件
router.get('/download', verifyLimiter, async (req: Request, res: Response) => {
  try {
    if (req.query?.key && req.query?.deviceId) {
      await LicenseService.verify(req.query.key, req.query.deviceId, ipKey(req));
    }
    const file = config.license.pluginFile;
    if (!file || !fs.existsSync(file)) {
      return res.status(404).json({ error: '插件包暂未提供' });
    }
    // 计算并附加 SHA256 头部，供客户端防篡改比对
    try {
      const fileData = fs.readFileSync(file);
      const sha256 = require('node:crypto').createHash('sha256').update(fileData).digest('hex');
      res.setHeader('X-Plugin-SHA256', sha256);
    } catch {}

    // dotfiles: 'allow' —— 允许路径中包含点开头目录（如本地 ~/.carddeck）
    return res.download(file, 'orchestration-pro.zip', { dotfiles: 'allow' });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 403;
    const exposed = (err as { exposed?: boolean }).exposed === true;
    const message = exposed && err instanceof Error ? err.message : '下载授权校验失败';
    return res.status(status).json({ error: message });
  }
});

export default router;
