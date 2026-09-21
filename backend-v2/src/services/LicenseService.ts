import crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../core/Database';
import { LicenseSigner, SignedLicenseFile } from '../utils/LicenseSigner';

/**
 * 编排模式插件授权服务（AgentDeck Pro）。
 *
 * 模型：双模授权（在线激活 + Ed25519 离线认证凭据导出）
 * 客户端定期 /verify 续期（离线宽限由客户端本地 Ed25519 签名与防倒流窗口控制）。
 * 数据库是授权状态的唯一真相源；激活码以 HMAC-SHA256 摘要入库，明文不落库。
 */

export type LicenseActivateResult = {
  token: string;
  licensedTo: string;
  expiresAt: number | null; // Unix 秒；null = 永久
  packageName: string;
  signedLicense?: SignedLicenseFile;
  downloadUrl?: string;
};

export type LicenseVerifyResult = {
  valid: boolean;
  expiresAt: number | null;
  signedLicense?: SignedLicenseFile;
};

export type LicenseKeyView = {
  id: number;
  keyHint: string;
  productName: string;
  status: string;
  boundDevice: string | null;
  machineName: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  lastVerifyAt: string | null;
  verifyCount: number;
  createdAt: string;
};

export class LicenseError extends Error {
  status: number;
  exposed = true; // 业务校验信息可安全透出给客户端
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export class LicenseService {
  static assertReady() {
    if (!config.license.keySecret) throw new Error('授权密钥未配置（LICENSE_KEY_SECRET）');
    LicenseSigner.assertSigningReady();
  }

  /** 与客户端一致：大写、去空格与连字符 */
  static normalize(codeInput: unknown): string {
    if (typeof codeInput !== 'string') return '';
    return codeInput.toUpperCase().replace(/[\s-]/g, '');
  }

  static digestFor(normalized: string): string {
    return crypto.createHmac('sha256', config.license.keySecret).update(`license\0${normalized}`).digest('hex');
  }

  static ipHashFor(ip: string): string {
    return crypto.createHmac('sha256', config.license.keySecret).update(`license-ip\0${ip}`).digest('hex');
  }

  static toEpochSeconds(date: Date | null): number | null {
    return date ? Math.floor(date.getTime() / 1000) : null;
  }

  /** 激活：核销激活码并绑定设备（1 码 1 设备，原子抢占防并发） */
  static async activate(keyInput: unknown, deviceId: unknown, machineName: unknown, ip: string): Promise<LicenseActivateResult> {
    LicenseService.assertReady();
    const code = LicenseService.normalize(keyInput);
    if (code.length < 8 || code.length > 64) {
      throw new LicenseError('授权码无效', 403);
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      throw new LicenseError('设备信息无效', 400);
    }

    const digest = LicenseService.digestFor(code);
    const key = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
    if (!key || key.status === 'revoked') {
      throw new LicenseError('授权码无效或已被使用', 403);
    }
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      throw new LicenseError('授权码已过期', 403);
    }

    if (key.boundDevice && key.boundDevice !== deviceId) {
      throw new LicenseError('授权码已绑定其他设备，如需换机请联系管理员解绑', 403);
    }
    if (!key.boundDevice) {
      // 首次激活：原子抢占绑定（并发下只有一个请求能绑定成功）
      const claimed = await prisma.licenseKey.updateMany({
        where: { id: key.id, boundDevice: null },
        data: {
          boundDevice: deviceId,
          machineName: (machineName || '').toString().slice(0, 120),
          activatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new LicenseError('授权码已绑定其他设备', 403);
      }
    }

    const fresh = await prisma.licenseKey.update({
      where: { id: key.id },
      data: {
        status: 'used',
        activatedAt: key.activatedAt ?? new Date(),
        lastVerifyAt: new Date(),
        verifyCount: { increment: 1 },
      },
    });

    await prisma.licenseActivation.create({
      data: { keyId: key.id, deviceId, action: 'activate', ok: true, ipHash: LicenseService.ipHashFor(ip) },
    });

    const expiresAtEpoch = LicenseService.toEpochSeconds(fresh.expiresAt);
    const licensedTo = fresh.licensedTo || `${fresh.productName} · ${fresh.machineName || deviceId.slice(0, 8)}`;

    // 签发基于 Ed25519 的离线数字签名授权凭证（SignedLicenseFile）
    const signedLicense = LicenseSigner.signLicense({
      key: code,
      deviceId,
      licensedTo,
      expiresAt: expiresAtEpoch,
      features: ['orchestration-pro'],
    });

    return {
      token: crypto.randomUUID(),
      licensedTo,
      expiresAt: expiresAtEpoch,
      packageName: fresh.packageName,
      signedLicense,
      downloadUrl: `/api/v1/license/plugin/download?id=orchestration-pro&deviceId=${encodeURIComponent(deviceId)}&key=${encodeURIComponent(code)}`,
    };
  }

  /** 联网校验：绑定匹配且未吊销/未过期才有效 */
  static async verify(keyInput: unknown, deviceId: unknown, ip: string): Promise<LicenseVerifyResult> {
    LicenseService.assertReady();
    const code = LicenseService.normalize(keyInput);
    if (code.length < 8 || code.length > 64) {
      throw new LicenseError('授权码无效', 403);
    }
    const digest = LicenseService.digestFor(code);
    const key = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
    if (!key) {
      throw new LicenseError('授权码无效', 403);
    }
    if (key.status === 'revoked') {
      throw new LicenseError('授权码已作废', 403);
    }
    if (key.boundDevice && key.boundDevice !== deviceId) {
      throw new LicenseError('授权码已绑定其他设备', 403);
    }
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      return { valid: false, expiresAt: LicenseService.toEpochSeconds(key.expiresAt) };
    }

    const device = deviceId as string;
    await prisma.licenseKey.update({
      where: { id: key.id },
      data: { lastVerifyAt: new Date(), verifyCount: { increment: 1 } },
    });
    await prisma.licenseActivation.create({
      data: { keyId: key.id, deviceId: device, action: 'verify', ok: true, ipHash: LicenseService.ipHashFor(ip) },
    });

    const expiresAtEpoch = LicenseService.toEpochSeconds(key.expiresAt);
    const signedLicense = LicenseSigner.signLicense({
      key: code,
      deviceId: device,
      licensedTo: key.licensedTo || key.productName,
      expiresAt: expiresAtEpoch,
      features: ['orchestration-pro'],
    });

    return { valid: true, expiresAt: expiresAtEpoch, signedLicense };
  }

  /** 管理端/CLI：为指定设备签发离线授权文件（SignedLicenseFile，100% 离线可用） */
  static async generateOfflineLicense(params: {
    deviceId: string;
    productName?: string;
    days?: number | null;
    licensedTo?: string;
    features?: string[];
    keyPrefix?: string;
  }): Promise<{ code: string; signedLicense: SignedLicenseFile }> {
    LicenseService.assertReady();
    const { deviceId, productName = '编排模式 Pro (离线授权)', days = null, licensedTo = '', features = ['orchestration-pro'] } = params;
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      throw new LicenseError('设备指纹无效', 400);
    }
    LicenseService.validateFormat(params.keyPrefix ? { keyPrefix: params.keyPrefix } : undefined);
    const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
    const expiresAtEpoch = LicenseService.toEpochSeconds(expiresAt);

    // 生成授权码并预先绑定该设备（支持自定义前缀格式，与在线发卡一致）
    const { display, normalized } = params.keyPrefix
      ? LicenseService.buildCode({ keyPrefix: params.keyPrefix })
      : (() => {
          const normalized = crypto.randomBytes(10).toString('hex').toUpperCase();
          return { display: normalized.replace(/(.{5})(?=.)/g, '$1-'), normalized };
        })();

    await prisma.licenseKey.create({
      data: {
        keyDigest: LicenseService.digestFor(normalized),
        keyHint: normalized.slice(-4),
        productName,
        status: 'used',
        boundDevice: deviceId,
        licensedTo: licensedTo || `${productName} · 离线认证`,
        packageName: 'orchestration-pro',
        expiresAt,
        activatedAt: new Date(),
      },
    });

    const signedLicense = LicenseSigner.signLicense({
      key: normalized,
      deviceId,
      licensedTo: licensedTo || `${productName} · 离线认证`,
      expiresAt: expiresAtEpoch,
      features,
    });

    return { code: display, signedLicense };
  }

  /** 管理端：生成授权码（明文仅在本次响应中出现一次）
   *  支持自定义码格式（CardDeck 等发卡工作台对接）：
   *  format.keyPrefix 如 "ZHUIYI-ORCH"，生成 ZHUIYI-ORCH-XXXX-XXXX-XXXX；
   *  码的规范形（大写、去连字符/空格）参与 HMAC 摘要，客户端 normalize 规则一致。
   */
  static async generateKeys(
    count: number,
    productName: string,
    days: number | null,
    format?: { keyPrefix?: string; segments?: number; segmentLength?: number },
  ): Promise<string[]> {
    LicenseService.assertReady();
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
      throw new Error('数量必须是 1-200 之间的整数');
    }
    LicenseService.validateFormat(format);
    const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const { display, normalized } = LicenseService.buildCode(format);
      await prisma.licenseKey.create({
        data: {
          keyDigest: LicenseService.digestFor(normalized),
          keyHint: normalized.slice(-4),
          productName,
          status: 'active',
          packageName: 'orchestration-pro',
          expiresAt,
        },
      });
      codes.push(display);
    }
    return codes;
  }

  // MARK: 码格式（自定义前缀）

  /** 去除易混淆字符（I/L/O/0/1）的随机段字符集 */
  private static readonly SEGMENT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  private static validateFormat(format?: { keyPrefix?: string; segments?: number; segmentLength?: number }): void {
    if (!format?.keyPrefix) return;
    const prefix = format.keyPrefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12})*$/.test(prefix)) {
      throw new LicenseError('码前缀格式无效（仅允许大写字母/数字，短横线分段，如 ZHUIYI-ORCH）', 400);
    }
    const segments = format.segments ?? 3;
    const segmentLength = format.segmentLength ?? 4;
    const normalizedLength = prefix.replace(/-/g, '').length + segments * segmentLength;
    if (normalizedLength < 8 || normalizedLength > 64) {
      throw new LicenseError('码格式无效：规范形长度必须在 8-64 之间', 400);
    }
  }

  /** 生成一条授权码：返回展示形（含连字符）与规范形（去连字符，参与摘要） */
  static buildCode(format?: { keyPrefix?: string; segments?: number; segmentLength?: number }): { display: string; normalized: string } {
    if (!format?.keyPrefix) {
      // 兼容旧格式：20 位随机 hex → 5 段 4 字
      const normalized = crypto.randomBytes(10).toString('hex').toUpperCase();
      return { display: normalized.replace(/(.{5})(?=.)/g, '$1-'), normalized };
    }
    const prefix = format.keyPrefix.trim().toUpperCase();
    const segments = Math.min(6, Math.max(2, format.segments ?? 3));
    const segmentLength = Math.min(8, Math.max(3, format.segmentLength ?? 4));
    const parts = [prefix];
    for (let index = 0; index < segments; index += 1) {
      const bytes = crypto.randomBytes(segmentLength);
      let segment = '';
      for (let i = 0; i < segmentLength; i += 1) {
        segment += LicenseService.SEGMENT_ALPHABET[bytes[i] % LicenseService.SEGMENT_ALPHABET.length];
      }
      parts.push(segment);
    }
    const display = parts.join('-');
    return { display, normalized: LicenseService.normalize(display) };
  }

  /** 管理端：绑定并激活（CardDeck「设备心跳」页表单：既有卡密 + 机器码 + 设备名称）。
   * 与客户端 activate 同一套抢占绑定逻辑，由管理员在控制台代客完成绑定。 */
  static async bindKeyToDevice(
    keyInput: unknown,
    deviceId: unknown,
    machineName: unknown,
    ip: string,
  ): Promise<{ expiresAt: number | null; licensedTo: string; signedLicense: SignedLicenseFile }> {
    LicenseService.assertReady();
    const code = LicenseService.normalize(keyInput);
    if (code.length < 8 || code.length > 64) {
      throw new LicenseError('授权码无效', 403);
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      throw new LicenseError('设备信息无效', 400);
    }

    const digest = LicenseService.digestFor(code);
    const key = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
    if (!key || key.status === 'revoked') {
      throw new LicenseError('授权码无效', 403);
    }
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      throw new LicenseError('授权码已过期', 403);
    }
    if (key.boundDevice && key.boundDevice !== deviceId) {
      throw new LicenseError('授权码已绑定其他设备，请先解绑再换机', 403);
    }

    if (!key.boundDevice) {
      const claimed = await prisma.licenseKey.updateMany({
        where: { id: key.id, boundDevice: null },
        data: {
          boundDevice: deviceId,
          machineName: (machineName || '').toString().slice(0, 120),
          status: 'used',
          activatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new LicenseError('授权码已绑定其他设备', 403);
      }
    }

    const fresh = await prisma.licenseKey.update({
      where: { id: key.id },
      data: { lastVerifyAt: new Date(), verifyCount: { increment: 1 } },
    });
    await prisma.licenseActivation.create({
      data: { keyId: key.id, deviceId, action: 'activate', ok: true, ipHash: LicenseService.ipHashFor(ip) },
    });

    const expiresAtEpoch = LicenseService.toEpochSeconds(fresh.expiresAt);
    const licensedTo = fresh.licensedTo || `${fresh.productName} · ${fresh.machineName || deviceId.slice(0, 8)}`;
    const signedLicense = LicenseSigner.signLicense({
      key: code,
      deviceId,
      licensedTo,
      expiresAt: expiresAtEpoch,
      features: ['orchestration-pro'],
    });

    return { expiresAt: expiresAtEpoch, licensedTo, signedLicense };
  }

  /** 设备冻结判定：名下存在已吊销卡密 → 冻结（禁止试用/下载，直到解绑或换发新卡） */
  static async isDeviceFrozen(deviceId: string): Promise<boolean> {
    const revoked = await prisma.licenseKey.findFirst({
      where: { boundDevice: deviceId, status: 'revoked' },
      select: { id: true },
    });
    return revoked !== null;
  }

  /** 试用（服务器计时）：一台设备一次，3 天（TRIAL_DAYS 可调）。
   *  试用记录落在 LicenseKey 表（keyDigest = HMAC(secret, 'license-trial\0' + deviceId)），
   *  删除本地配置 / 重装软件都不会重置——倒计时只在服务器侧。 */
  static trialDigestFor(deviceId: string): string {
    return crypto.createHmac('sha256', config.license.keySecret).update(`license-trial\0${deviceId}`).digest('hex');
  }

  static async startTrial(deviceId: string, machineName: string, ip: string): Promise<{
    trial: boolean; expired: boolean; startedAt: string | null; expiresAt: number | null;
    trialDays: number; signedLicense: SignedLicenseFile;
  }> {
    LicenseService.assertReady();
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      throw new LicenseError('设备指纹无效', 400);
    }
    const trialDays = Math.max(1, parseInt(process.env.TRIAL_DAYS || '3', 10) || 3);
    if (await LicenseService.isDeviceFrozen(deviceId)) {
      throw new LicenseError('该设备已被冻结，请联系管理员解冻后再试', 403);
    }
    const digest = LicenseService.trialDigestFor(deviceId);

    let row = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
    if (!row) {
      try {
        row = await prisma.licenseKey.create({
          data: {
            keyDigest: digest,
            keyHint: 'TRIAL',
            productName: '编排模式 Pro (试用)',
            status: 'used',
            boundDevice: deviceId,
            machineName: machineName.slice(0, 120),
            licensedTo: '试用用户',
            packageName: 'orchestration-pro',
            expiresAt: new Date(Date.now() + trialDays * 86400000),
            activatedAt: new Date(),
          },
        });
      } catch {
        // 并发下首次创建撞唯一约束：回读既有记录
        row = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
      }
    }
    if (!row) throw new LicenseError('试用状态创建失败', 500);

    await prisma.licenseActivation.create({
      data: { keyId: row.id, deviceId, action: 'trial', ok: true, ipHash: LicenseService.ipHashFor(ip) },
    }).catch(() => { /* 审计失败不影响试用 */ });

    const expired = row.expiresAt ? row.expiresAt.getTime() < Date.now() : false;
    const expiresAtEpoch = LicenseService.toEpochSeconds(row.expiresAt);
    const signedLicense = LicenseSigner.signLicense({
      key: `TRIAL-${deviceId}`,
      deviceId,
      licensedTo: '试用用户',
      expiresAt: expiresAtEpoch,
      features: ['orchestration-pro'],
    });

    return {
      trial: true,
      expired,
      startedAt: row.activatedAt?.toISOString() ?? null,
      expiresAt: expiresAtEpoch,
      trialDays,
      signedLicense,
    };
  }

  /** 查询设备试用状态（插件包下发绑定试用到期时间用）；无记录返回 null */
  static async getTrialState(deviceId: string): Promise<{ expired: boolean; expiresAt: number | null } | null> {
    const digest = LicenseService.trialDigestFor(deviceId);
    const row = await prisma.licenseKey.findUnique({ where: { keyDigest: digest } });
    if (!row) return null;
    const expired = row.expiresAt ? row.expiresAt.getTime() < Date.now() : false;
    return { expired, expiresAt: LicenseService.toEpochSeconds(row.expiresAt) };
  }

  /** 管理端：列出全部授权码（最近 200 条） */
  static async listKeys() {
    const rows = await prisma.licenseKey.findMany({ orderBy: { id: 'desc' }, take: 200 });
    return rows.map((row) => ({
      id: row.id,
      keyHint: row.keyHint,
      productName: row.productName,
      status: row.status,
      boundDevice: row.boundDevice,
      machineName: row.machineName,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      lastVerifyAt: row.lastVerifyAt?.toISOString() ?? null,
      verifyCount: row.verifyCount,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** 管理端：按完整卡密撤销（作废，不可逆） */
  static async revoke(codeInput: unknown): Promise<boolean> {
    LicenseService.assertReady();
    const code = LicenseService.normalize(codeInput);
    if (code.length < 8 || code.length > 64) throw new LicenseError('授权码无效', 404);
    const digest = LicenseService.digestFor(code);
    const updated = await prisma.licenseKey.updateMany({
      where: { keyDigest: digest, status: { in: ['active', 'used'] } },
      data: { status: 'revoked' },
    });
    return updated.count === 1;
  }

  /** 管理端：解绑设备（清除绑定，买家可在新设备重新激活） */
  static async unbind(codeInput: unknown): Promise<boolean> {
    LicenseService.assertReady();
    const code = LicenseService.normalize(codeInput);
    if (code.length < 8 || code.length > 64) throw new LicenseError('授权码无效', 404);
    const updated = await prisma.licenseKey.updateMany({
      where: { keyDigest: LicenseService.digestFor(code), status: 'used' },
      data: { status: 'active', boundDevice: null, machineName: null, activatedAt: null },
    });
    return updated.count === 1;
  }
}
