import { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { LicenseService, LicenseError } from '../services/LicenseService';
import { PluginPackageService } from '../services/PluginPackageService';
import { cardOssPresignGet, cardOssPut, cardOssReady } from '../core/CardOssClient';
import { IpUtils } from '../utils/IpUtils';
import { config } from '../config';
import { auditTrail } from '../utils/AuditTrail';

/**
 * 编排模式卡密管理端控制器（管理员接口）
 * 提供卡密批量生成、列表查询、按卡密作废与解绑等功能，
 * 以及插件包版本发布（独立分发 + 自动迭代）。
 */
export class LicenseAdminController {
  /**
   * 批量签发编排卡密
   * POST /api/admin/license/issue
   * Body: { count: number, productName?: string, expiresInDays?: number,
   *         keyPrefix?: string, segments?: number, segmentLength?: number }
   * keyPrefix 示例 "ZHUIYI-ORCH" → 生成 ZHUIYI-ORCH-XXXX-XXXX-XXXX（CardDeck 发卡工作台对接）
   */
  public static async issue(req: Request, res: Response) {
    try {
      const count = Number(req.body?.count);
      const requestedProductName = typeof req.body?.productName === 'string'
        ? req.body.productName.trim().slice(0, 80)
        : '';
      const productName = requestedProductName || '编排模式 Pro';
      const expiresInDaysRaw = req.body?.expiresInDays;

      if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
        return res.status(400).json({ success: false, message: '数量必须是 1-200 之间的整数' });
      }

      let expiresInDays: number | null = null;
      if (expiresInDaysRaw !== undefined && expiresInDaysRaw !== null && expiresInDaysRaw !== '') {
        expiresInDays = Number(expiresInDaysRaw);
        if (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          return res.status(400).json({ success: false, message: '有效期必须是 1-3650 之间的整数天' });
        }
      }

      const format = {
        keyPrefix: typeof req.body?.keyPrefix === 'string' ? req.body.keyPrefix.trim().toUpperCase() : '',
        segments: Number(req.body?.segments) || undefined,
        segmentLength: Number(req.body?.segmentLength) || undefined,
      };

      const codes = await LicenseService.generateKeys(count, productName, expiresInDays, format);
      auditTrail(req, 'LICENSE_ISSUE', `管理员签发授权卡密 ${codes.length} 张（${productName}，${expiresInDays ? `有效期 ${expiresInDays} 天` : '永久有效'}，明文不落审计）`);
      return res.json({
        success: true,
        issued: codes.length,
        productName,
        expiresInDays,
        keyPrefix: format.keyPrefix || undefined,
        codes,
        message: '卡密签发成功，明文仅展示一次，请妥善保管',
      });
    } catch (error) {
      console.error('[LicenseAdmin] 签发卡密失败:', error);
      const message = error instanceof Error ? error.message : '签发卡密失败';
      return res.status(500).json({ success: false, message });
    }
  }

  /**
   * 查看编排卡密列表（最近 200 条）
   * GET /api/admin/license/list
   */
  public static async list(_req: Request, res: Response) {
    try {
      const keys = await LicenseService.listKeys();
      return res.json({ success: true, keys });
    } catch (error) {
      console.error('[LicenseAdmin] 读取卡密列表失败:', error);
      return res.status(500).json({ success: false, message: '读取卡密列表失败' });
    }
  }

  /**
   * 作废/吊销编排卡密
   * POST /api/admin/license/revoke
   * Body: { key: string }
   */
  public static async revoke(req: Request, res: Response) {
    try {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!key) {
        return res.status(400).json({ success: false, message: '请提供待作废的授权卡密' });
      }
      const success = await LicenseService.revoke(key);
      if (!success) {
        return res.status(404).json({ success: false, message: '卡密不存在或已处于作废状态' });
      }
      auditTrail(req, 'LICENSE_REVOKE', `管理员作废授权卡密 ****${key.slice(-4)}`);
      return res.json({ success: true, message: '卡密已成功作废' });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 作废卡密失败:', error);
      return res.status(500).json({ success: false, message: '作废卡密失败' });
    }
  }

  /**
   * 解绑设备（清除 boundDevice，买家可在新设备重新激活）
   * POST /api/admin/license/unbind
   * Body: { key: string }
   */
  public static async unbind(req: Request, res: Response) {
    try {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!key) {
        return res.status(400).json({ success: false, message: '请提供待解绑的授权卡密' });
      }
      const success = await LicenseService.unbind(key);
      if (!success) {
        return res.status(404).json({ success: false, message: '卡密不存在或未绑定设备' });
      }
      auditTrail(req, 'LICENSE_UNBIND', `管理员解除授权卡密 ****${key.slice(-4)} 的设备绑定`);
      return res.json({ success: true, message: '设备绑定已清除，该卡密可在新设备重新激活' });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 解绑卡密失败:', error);
      return res.status(500).json({ success: false, message: '解绑失败' });
    }
  }

  /**
   * 为指定设备直接签发离线授权凭证（SignedLicenseFile，生成 .lic）
   * POST /api/admin/license/issue-offline
   * Body: { deviceId: string, days?: number, productName?: string, licensedTo?: string, features?: string[] }
   */
  public static async issueOffline(req: Request, res: Response) {
    try {
      const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
      if (!deviceId) {
        return res.status(400).json({ success: false, message: '请提供目标设备指纹（Device ID）' });
      }
      const productName = typeof req.body?.productName === 'string'
        ? req.body.productName.trim().slice(0, 80)
        : '编排模式 Pro (离线授权)';
      const licensedTo = typeof req.body?.licensedTo === 'string'
        ? req.body.licensedTo.trim().slice(0, 120)
        : '';
      const daysRaw = req.body?.days ?? req.body?.expiresInDays;
      let days: number | null = null;
      if (daysRaw !== undefined && daysRaw !== null && daysRaw !== '') {
        days = Number(daysRaw);
        if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
          return res.status(400).json({ success: false, message: '有效天数必须是 1-3650 之间的整数' });
        }
      }
      const features = Array.isArray(req.body?.features) ? req.body.features : ['orchestration-pro'];
      const keyPrefix = typeof req.body?.keyPrefix === 'string' ? req.body.keyPrefix.trim().toUpperCase() : '';
      const existingKey = typeof req.body?.key === 'string' ? req.body.key.trim() : '';

      // 提供已有卡密时：先把该卡绑定到目标设备（1 码 1 设备校验），有效期跟随卡密
      if (existingKey) {
        const result = await LicenseService.bindKeyToDevice(existingKey, deviceId, licensedTo || '离线凭证', req.ip || '');
        auditTrail(req, 'LICENSE_ISSUE_OFFLINE', `管理员将授权卡密 ****${existingKey.slice(-4)} 离线化绑定至设备 ${deviceId.slice(0, 12)}…`);
        return res.json({
          success: true,
          code: existingKey,
          licensedTo: result.licensedTo,
          expiresAt: result.expiresAt,
          signedLicense: result.signedLicense,
          licContent: JSON.stringify(result.signedLicense, null, 2),
          message: '已将卡密离线化绑定至目标设备',
        });
      }

      const result = await LicenseService.generateOfflineLicense({
        deviceId,
        productName,
        days,
        licensedTo,
        features,
        keyPrefix: keyPrefix || undefined,
      });

      auditTrail(req, 'LICENSE_ISSUE_OFFLINE', `管理员为设备 ${deviceId.slice(0, 12)}… 签发离线授权（${productName}，${days ? `${days} 天` : '永久'}）`);
      return res.json({
        success: true,
        code: result.code,
        signedLicense: result.signedLicense,
        licContent: JSON.stringify(result.signedLicense, null, 2),
        message: '离线授权文件签发成功',
      });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 签发离线卡密失败:', error);
      return res.status(500).json({ success: false, message: '签发离线卡密失败' });
    }
  }

  /**
   * 发布插件新版本（自动迭代）：把暂存目录中的 payload 接管进版本注册表。
   * 运维流程：scp 新 payload 到 LICENSE_PLUGIN_STAGING_DIR（或服务器本地目录）→ 调用本接口。
   * POST /api/admin/license/plugin/publish
   * Body: { pluginId?: string, version: string, changelog?: string, minHostVersion?: string, stagingDir?: string }
   */
  public static async publishPlugin(req: Request, res: Response) {
    try {
      const pluginId = typeof req.body?.pluginId === 'string' && req.body.pluginId.trim()
        ? req.body.pluginId.trim() : 'orchestration-pro';
      const version = typeof req.body?.version === 'string' ? req.body.version.trim() : '';
      if (!version) {
        return res.status(400).json({ success: false, message: '请提供插件版本号（version）' });
      }
      // stagingDir 仅允许暂存根目录下的相对子目录，防止任意路径读取
      const stagingRel = typeof req.body?.stagingDir === 'string' && req.body.stagingDir.trim()
        ? req.body.stagingDir.trim()
        : path.join(pluginId, version);
      const stagingRoot = path.resolve(config.license.pluginStagingDir);
      const stagingDir = path.resolve(stagingRoot, stagingRel);
      if (path.dirname(stagingDir) === stagingDir || !stagingDir.startsWith(`${stagingRoot}${path.sep}`)) {
        return res.status(400).json({ success: false, message: 'stagingDir 必须位于插件暂存根目录内' });
      }
      if (!fs.existsSync(stagingDir)) {
        return res.status(400).json({
          success: false,
          message: `暂存目录不存在：${stagingDir}。请先将新版本 payload 上传到该目录再发布。`,
        });
      }

      const info = PluginPackageService.publish({
        pluginId,
        version,
        changelog: typeof req.body?.changelog === 'string' ? req.body.changelog : '',
        minHostVersion: typeof req.body?.minHostVersion === 'string' ? req.body.minHostVersion : '',
        name: typeof req.body?.name === 'string' ? req.body.name : '',
        stagingDir,
      });

      console.log(`[LicenseAdmin] 插件版本已发布: ${pluginId} v${info.version} (payload ${info.payloadSHA256.slice(0, 12)}…)`);

      // 清理暂存目录（payload 已被 rename 接管，目录壳可移除）
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }

      auditTrail(req, 'LICENSE_PLUGIN_PUBLISH', `管理员发布插件 ${pluginId} v${version}（payload sha256 ${info.payloadSHA256.slice(0, 12)}…）`);

      return res.json({
        success: true,
        plugin: { id: info.pluginId, version: info.version, changelog: info.changelog, payloadSHA256: info.payloadSHA256 },
        message: `插件 ${pluginId} v${version} 发布成功，客户端将自动迭代`,
      });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 发布插件版本失败:', error);
      return res.status(500).json({ success: false, message: '发布插件版本失败' });
    }
  }

  /**
   * 查看插件已发布版本（最近版本在前）
   * GET /api/admin/license/plugin/versions?pluginId=orchestration-pro
   */
  public static async pluginVersions(req: Request, res: Response) {
    try {
      const pluginId = typeof req.query?.pluginId === 'string' && req.query.pluginId.trim()
        ? req.query.pluginId.trim() : 'orchestration-pro';
      const versions = PluginPackageService.listVersions(pluginId).map((v) => ({
        version: v.version,
        name: v.name,
        changelog: v.changelog,
        minHostVersion: v.minHostVersion,
        payloadSHA256: v.payloadSHA256,
        publishedAt: v.publishedAt,
      }));
      return res.json({ success: true, pluginId, versions });
    } catch (error) {
      console.error('[LicenseAdmin] 读取插件版本失败:', error);
      return res.status(500).json({ success: false, message: '读取插件版本失败' });
    }
  }

  /**
   * 绑定并激活（CardDeck「设备心跳」页表单：卡密 + 机器码 + 设备名称）
   * 把尚未激活的卡密绑定到买家机器码，等价于由管理员代客完成首次激活。
   * POST /api/admin/license/bind
   * Body: { key: string, deviceId: string, machineName?: string }
   */
  public static async bind(req: Request, res: Response) {
    try {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
      const machineName = typeof req.body?.machineName === 'string' ? req.body.machineName.trim().slice(0, 120) : '';
      if (!key) return res.status(400).json({ success: false, message: '请提供编排授权卡密' });
      if (!deviceId) return res.status(400).json({ success: false, message: '请提供硬件机器码（指纹）' });

      const result = await LicenseService.bindKeyToDevice(key, deviceId, machineName, req.ip || '');

      // 绑定成功后自动现签设备专属包并推送 OSS（离线交付直链一步到位）
      let oss: { url: string; version: string; iteration: number; urlExpiresInSeconds: number } | null = null;
      let ossWarning: string | null = null;
      if (PluginPackageService.pluginOssReady()) {
        try {
          const latest = PluginPackageService.latest('orchestration-pro');
          if (latest) {
            const up = await PluginPackageService.mintUploadAndPresign({
              info: latest,
              deviceId,
              licenseKey: LicenseService.normalize(key),
              expiresAt: result.expiresAt,
              iteration: 1,
            });
            oss = { url: up.url, version: up.version, iteration: up.iteration, urlExpiresInSeconds: up.urlExpiresInSeconds };
          }
        } catch (err) {
          ossWarning = err instanceof Error ? err.message : '专属包上传 OSS 失败';
          console.error('[LicenseAdmin] 绑定后自动上传 OSS 失败:', ossWarning);
        }
      }

      return res.json({
        success: true,
        keyHint: LicenseService.normalize(key).slice(-4),
        deviceId,
        machineName,
        expiresAt: result.expiresAt,
        licensedTo: result.licensedTo,
        signedLicense: result.signedLicense,
        oss: oss,
        ossWarning: ossWarning,
        message: oss
          ? `绑定并激活成功；专属插件包 v${oss.version} 已上传 OSS，直链有效期 ${oss.urlExpiresInSeconds} 秒`
          : '绑定并激活成功',
      });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 绑定并激活失败:', error);
      return res.status(500).json({ success: false, message: '绑定并激活失败' });
    }
  }

  /**
   * 按设备指纹现签插件专属包并推送 OSS，返回签名直链。
   * CardDeck「离线凭证/卡密签发」页直接调用：买家提供机器码 → 一键得到 OSS 交付直链。
   * 签名在服务端完成（私钥不出服务端），包内 deviceId 为按迭代参数派生的指纹密钥，
   * 指纹绑定与自动迭代语义与在线分发完全一致。
   *
   * POST /api/admin/license/plugin/issue-oss
   * Body: { deviceId: string, key?: string, version?: string, iteration?: number, pluginId?: string }
   *   key        授权码（可选）：提供时核销绑定关系，包有效期跟随授权；
   *              对 issue-offline 预绑定的码同样适用
   *   iteration  买家客户端当前清单的指纹迭代参数（可选，默认 0 → 本包为第 1 次迭代）
   */
  public static async issuePluginPackageOss(req: Request, res: Response) {
    try {
      const pluginId = typeof req.body?.pluginId === 'string' && req.body.pluginId.trim()
        ? req.body.pluginId.trim() : 'orchestration-pro';
      const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
      if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
        return res.status(400).json({ success: false, message: '设备指纹（机器码）无效' });
      }
      if (!cardOssReady()) {
        return res.status(400).json({ success: false, message: '插件 OSS 未配置（CARD_REDEEM_OSS_*）' });
      }

      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      let licenseKey = '*';
      let expiresAt: number | null = null;
      if (key) {
        // 核销绑定关系：授权码必须已绑定该设备（在线激活或 issue-offline 预绑定）
        const result = await LicenseService.verify(key, deviceId, IpUtils.getClientIp(req));
        if (!result.valid) {
          return res.status(403).json({ success: false, message: '授权校验未通过，禁止生成专属包' });
        }
        licenseKey = LicenseService.normalize(key);
        expiresAt = result.expiresAt;
      }

      const version = typeof req.body?.version === 'string' && req.body.version.trim()
        ? req.body.version.trim() : '';
      const info = version
        ? PluginPackageService.get(pluginId, version)
        : PluginPackageService.latest(pluginId);
      if (!info) {
        return res.status(404).json({ success: false, message: '插件版本不存在或尚未发布' });
      }

      const prevIteration = Math.max(0, Math.floor(Number(req.body?.iteration) || 0));
      const iteration = prevIteration + 1;
      const zip = PluginPackageService.buildDeviceBoundZip({
        info, deviceId, licenseKey, expiresAt, iteration,
      });

      const ossKey = `plugin-packages/${pluginId}/${info.version}/${deviceId}.iter${iteration}.zip`;
      await cardOssPut(ossKey, zip, 'application/zip');
      const presigned = await cardOssPresignGet(ossKey, `${pluginId}-${info.version}-iter${iteration}.zip`);

      console.log(`[LicenseAdmin] 插件专属包已推送 OSS: ${pluginId} v${info.version} iter${iteration} → ${ossKey}`);

      return res.json({
        success: true,
        pluginId,
        version: info.version,
        iteration,
        payloadSHA256: info.payloadSHA256,
        deviceIdHint: deviceId.slice(0, 8),
        ossUrl: presigned.url,
        urlExpiresInSeconds: presigned.expiresInSeconds,
        message: `专属包 v${info.version}（指纹迭代 ${iteration}）已上传，直链有效期 ${presigned.expiresInSeconds} 秒`,
      });
    } catch (error) {
      if (error instanceof LicenseError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      console.error('[LicenseAdmin] 生成插件专属包失败:', error);
      return res.status(500).json({ success: false, message: '生成插件专属包失败' });
    }
  }
}
