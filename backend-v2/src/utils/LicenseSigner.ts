import crypto from 'node:crypto';

/**
 * AgentDeck 编排模式 Pro 统一非对称签名引擎（Ed25519）
 * 严格遵循 RFC 8032 标准，与 macOS 客户端 CryptoKit.Curve25519 字节级互通。
 */

export interface SignedLicensePayload {
  key: string;
  deviceId: string;
  licensedTo?: string | null;
  issuedAt: number;      // Unix 秒
  expiresAt?: number | null; // Unix 秒；null 或 0 表示永久
  features?: string[];
}

export interface SignedLicenseFile {
  version: number;
  payload: SignedLicensePayload;
  signature: string; // 64 字节 Ed25519 签名的 Hex 字符串
}

// 旧客户端仍可用该公钥验证历史许可证；私钥绝不能进入源码或镜像。
// 新部署必须通过 LICENSE_ED25519_PRIVATE_KEY[_KID] 注入私钥。
export const DEFAULT_ED25519_PUB_HEX = 'c545ccc94c5fe7ff353709121dade95093a007d32be080a825781d670ca84f5a';

export class LicenseSigner {
  // MARK: - 密钥环与密钥迭代（key rotation）
  //
  // k1 = 初始主钥；k2/k3… 通过专用 env 配置。
  // activeKid 指向当前签名密钥；客户端内置公钥环可同时验证所有历史 kid。
  // 生成新钥并启用：设置 LICENSE_ED25519_ACTIVE_KID=k2 + LICENSE_ED25519_PRIVATE_KEY_K2。
  // 客户端密钥环中没有的 kid 无法验签——轮换前必须先随 App 分发新公钥。

  private static keyConfig(kid: string): { priv?: string; pub?: string } {
    const env = (name: string): string => (process.env[name] || '').trim();
    if (kid === 'k1') {
      const priv = env('LICENSE_ED25519_PRIVATE_KEY');
      return {
        priv,
        // When a new private key is configured without an explicit public key,
        // keyFor derives the matching public key instead of silently pairing it
        // with the legacy public key.
        pub: env('LICENSE_ED25519_PUBLIC_KEY') || (priv ? undefined : DEFAULT_ED25519_PUB_HEX),
      };
    }
    const upper = kid.toUpperCase();
    return {
      priv: env(`LICENSE_ED25519_PRIVATE_KEY_${upper}`),
      pub: env(`LICENSE_ED25519_PUBLIC_KEY_${upper}`),
    };
  }

  private static keyObjects = new Map<string, { priv?: crypto.KeyObject; pub: crypto.KeyObject }>();

  private static keyFor(kid: string): { priv?: crypto.KeyObject; pub: crypto.KeyObject } {
    let cached = LicenseSigner.keyObjects.get(kid);
    if (!cached) {
      const cfg = LicenseSigner.keyConfig(kid);
      const privateKey = cfg.priv ? LicenseSigner.privateKeyFromHex(cfg.priv) : undefined;
      const publicKey = cfg.pub
        ? LicenseSigner.publicKeyFromHex(cfg.pub)
        : privateKey
          ? crypto.createPublicKey(privateKey)
          : undefined;
      if (!publicKey) throw new Error(`签名密钥 ${kid} 未配置公钥`);
      if (privateKey) {
        const derived = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
        const configured = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
        if (!crypto.timingSafeEqual(derived, configured)) {
          throw new Error(`签名密钥 ${kid} 的公钥与私钥不匹配`);
        }
      }
      cached = { pub: publicKey, priv: privateKey };
      LicenseSigner.keyObjects.set(kid, cached);
    }
    return cached;
  }

  private static privateKeyFromHex(privHex: string): crypto.KeyObject {
    if (!/^[0-9a-f]{64}$/i.test(privHex)) {
      throw new Error('Ed25519 私钥必须是 32 字节十六进制字符串');
    }
    const pkcs8Der = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(privHex, 'hex'),
    ]);
    return crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  }

  private static publicKeyFromHex(pubHex: string): crypto.KeyObject {
    if (!/^[0-9a-f]{64}$/i.test(pubHex)) {
      throw new Error('Ed25519 公钥必须是 32 字节十六进制字符串');
    }
    const spkiDer = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(pubHex, 'hex'),
    ]);
    return crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  }

  /** 当前签名密钥版本（密钥迭代） */
  public static get activeKid(): string {
    const kid = (process.env.LICENSE_ED25519_ACTIVE_KID || 'k1').trim();
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(kid)) throw new Error('LICENSE_ED25519_ACTIVE_KID 格式无效');
    return kid;
  }

  public static assertSigningReady(): void {
    LicenseSigner.getPrivateKey();
  }

  private static getPrivateKey(): crypto.KeyObject {
    const key = LicenseSigner.keyFor(LicenseSigner.activeKid);
    if (!key.priv) {
      throw new Error(`签名密钥 ${LicenseSigner.activeKid} 未配置私钥`);
    }
    return key.priv;
  }

  private static getPublicKey(): crypto.KeyObject {
    return LicenseSigner.keyFor(LicenseSigner.activeKid).pub;
  }

  public static getPublicKeyHex(): string {
    const der = LicenseSigner.getPublicKey().export({ format: 'der', type: 'spki' }) as Buffer;
    return der.subarray(-32).toString('hex');
  }

  /**
   * 构造跨语言严格一致的待签规范串（Canonical String）
   * 格式: AGENTDECK_LIC_V1|{key}|{deviceId}|{expiresAt}|{issuedAt}|{features}
   */
  public static canonicalString(payload: SignedLicensePayload): string {
    const features = (payload.features && payload.features.length > 0)
      ? payload.features
      : ['orchestration-pro'];
    const featuresStr = [...features].sort().join(',');
    const exp = payload.expiresAt || 0;
    const issued = payload.issuedAt || Math.floor(Date.now() / 1000);
    return `AGENTDECK_LIC_V1|${payload.key}|${payload.deviceId}|${exp}|${issued}|${featuresStr}`;
  }

  /**
   * 为指定载荷生成完整的数字签名凭证（SignedLicenseFile）
   */
  public static signLicense(params: {
    key: string;
    deviceId: string;
    licensedTo?: string | null;
    expiresAt?: number | null;
    issuedAt?: number;
    features?: string[];
  }): SignedLicenseFile {
    const issuedAt = params.issuedAt ?? Math.floor(Date.now() / 1000);
    const expiresAt = params.expiresAt ?? null;
    const features = params.features && params.features.length > 0
      ? params.features
      : ['orchestration-pro'];

    const payload: SignedLicensePayload = {
      key: params.key,
      deviceId: params.deviceId,
      licensedTo: params.licensedTo || '',
      issuedAt,
      expiresAt,
      features,
    };

    const canonical = LicenseSigner.canonicalString(payload);
    const privateKey = LicenseSigner.getPrivateKey();
    const sigBuffer = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);

    return {
      version: 1,
      payload,
      signature: sigBuffer.toString('hex'),
    };
  }

  /**
   * 验证凭证的数字签名是否合法
   */
  public static verifyLicense(signedFile: SignedLicenseFile): boolean {
    try {
      if (!signedFile || signedFile.version !== 1 || !signedFile.payload || !signedFile.signature) {
        return false;
      }
      const canonical = LicenseSigner.canonicalString(signedFile.payload);
      const publicKey = LicenseSigner.getPublicKey();
      const sigBuffer = Buffer.from(signedFile.signature, 'hex');
      return crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, sigBuffer);
    } catch {
      return false;
    }
  }

  // MARK: - 插件包清单签名（独立分发 + 设备指纹绑定 + 密钥迭代）

  /**
   * 插件包清单规范串（与 macOS 客户端 / tools/license_server.py 严格一致）：
   * AGENTDECK_PLUGIN_V3|{kid}|{id}|{pluginVersion}|{deviceId}|{issuedAt}|{expiresAt|0}|{payloadSHA256}|{features}|{iteration}
   * V3：kid（签名密钥迭代）+ iteration（指纹迭代参数）均进入签名串。
   */
  public static canonicalPluginString(manifest: PluginManifestPayload): string {
    const featuresStr = [...(manifest.features && manifest.features.length > 0 ? manifest.features : ['orchestration-pro'])].sort().join(',');
    const exp = manifest.expiresAt || 0;
    return `AGENTDECK_PLUGIN_V3|${manifest.kid || 'k1'}|${manifest.id}|${manifest.pluginVersion}|${manifest.deviceId}|${manifest.issuedAt || 0}|${exp}|${manifest.payloadSHA256}|${featuresStr}|${manifest.iteration ?? 1}`;
  }

  /**
   * 指纹密钥（迭代派生）：清单不存裸指纹，只存第 iteration 次迭代的派生密钥。
   * 客户端用本机指纹 + 清单中的迭代参数重算比对；换设备/换迭代参数都对不上。
   */
  public static fingerprintBindingToken(device: string, iteration: number): string {
    return crypto.createHash('sha256').update(`AGENTDECK_BIND_V1|${device}|${Math.max(1, Math.floor(iteration))}`, 'utf8').digest('hex');
  }

  /**
   * 为插件清单签名。deviceId 进入签名串实现设备指纹绑定：
   * 清单即便被复制到其他设备，签名仍可验证，但指纹比对失败、插件拒绝加载。
   */
  public static signPluginManifest(manifest: Omit<PluginManifestFile, 'signature'>): PluginManifestFile {
    const canonical = LicenseSigner.canonicalPluginString(manifest);
    const privateKey = LicenseSigner.getPrivateKey();
    const sigBuffer = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
    return { ...manifest, signature: sigBuffer.toString('hex') };
  }
}

export interface PluginManifestPayload {
  manifestVersion: number;
  kid: string;               // 签名密钥版本（密钥迭代）
  iteration?: number;        // 指纹迭代参数（每轮下发自动 +1）
  id: string;
  name: string;
  pluginVersion: string;
  minHostVersion?: string;
  description?: string;
  changelog?: string;
  deviceId: string;          // 绑定设备指纹；'*' = 种子/通用包
  licenseKey?: string;       // 绑定授权码（可选）
  issuedAt: number;          // Unix 秒
  expiresAt?: number | null; // Unix 秒；null/0 = 跟随授权或永久
  features: string[];
  payloadSHA256: string;
}

export type PluginManifestFile = PluginManifestPayload & { signature: string };
