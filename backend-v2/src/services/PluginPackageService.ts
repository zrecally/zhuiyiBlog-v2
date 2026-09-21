import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { cardOssSettings } from '../core/CardOssClient';
import { LicenseSigner, PluginManifestFile } from '../utils/LicenseSigner';
import { LicenseError } from './LicenseService';

/**
 * 编排模式插件包注册表（独立分发 + 自动迭代）。
 *
 * 目录结构（LICENSE_PLUGIN_PACKAGES_DIR，默认 <backend-v2>/plugin-packages）：
 *   <pluginId>/<version>/payload/...   插件功能载荷（policy.json、prompts、strategies）
 *   <pluginId>/<version>/version.json  版本元数据（changelog、payloadSHA256 等）
 *
 * 分发模型：payload 是设备无关的；下载时按请求设备指纹「现签」manifest 并打包 zip，
 * 因此每一个下发出去的插件包都绑定唯一设备 —— 包体被复制到其他设备后指纹校验必然失败。
 */

// MARK: - 插件包专用 OSS（与卡密文件桶、线上桶彻底分离）
//
// 环境变量（均可选，缺省回退卡密 OSS 配置）：
//   LICENSE_PLUGIN_OSS_ENDPOINT / _BUCKET / _ACCESS_KEY_ID / _ACCESS_KEY_SECRET
//   LICENSE_PLUGIN_OSS_REGION（默认 us-east-1）/ _PATH_STYLE（默认 true）
//   LICENSE_PLUGIN_OSS_PREFIX（默认 plugin-packages/）
// 本地测试与线上生产各自指向自己的桶，即实现「线上 OSS 与本地不共用」。

type PluginOssCfg = {
  endpoint: string; bucket: string; accessKeyId: string; accessKeySecret: string;
  region: string; pathStyle: boolean; prefix: string; publicEndpoint: string;
};

const penv = (name: string): string => (process.env[name] || '').trim();

function pluginOssConfig(): PluginOssCfg | null {
  // 插件包 OSS 必须显式配置（LICENSE_PLUGIN_OSS_BUCKET），不回退卡密生产桶——
  // 未配置时 /plugin/download 由服务器直接下发，本地测试与线上 OSS 零交集。
  const bucket = penv('LICENSE_PLUGIN_OSS_BUCKET');
  if (!bucket) return null;
  const endpoint = penv('LICENSE_PLUGIN_OSS_ENDPOINT') || cardOssSettings().endpoint;
  const accessKeyId = penv('LICENSE_PLUGIN_OSS_ACCESS_KEY_ID') || cardOssSettings().accessKeyId;
  const accessKeySecret = penv('LICENSE_PLUGIN_OSS_ACCESS_KEY_SECRET') || cardOssSettings().accessKeySecret;
  if (!endpoint || !accessKeyId || !accessKeySecret) return null;
  let prefix = penv('LICENSE_PLUGIN_OSS_PREFIX') || 'plugin-packages/';
  if (!prefix.endsWith('/')) prefix += '/';
  return {
    endpoint,
    bucket,
    accessKeyId,
    accessKeySecret,
    region: penv('LICENSE_PLUGIN_OSS_REGION') || 'us-east-1',
    pathStyle: (penv('LICENSE_PLUGIN_OSS_PATH_STYLE') || 'true') !== 'false',
    prefix,
    publicEndpoint: penv('LICENSE_PLUGIN_OSS_PUBLIC_ENDPOINT'),
  };
}

let pluginS3: S3Client | null = null;
let pluginS3Cfg: PluginOssCfg | null = null;

function pluginS3Client(): { client: S3Client; cfg: PluginOssCfg } {
  const cfg = pluginOssConfig();
  if (!cfg) throw new LicenseError('插件 OSS 未配置（LICENSE_PLUGIN_OSS_*）', 500);
  if (!pluginS3 || pluginS3Cfg !== cfg) {
    pluginS3 = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.pathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.accessKeySecret },
    });
    pluginS3Cfg = cfg;
  }
  return { client: pluginS3!, cfg };
}

async function pluginS3Put(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, cfg } = pluginS3Client();
  const put = async () => client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  try {
    await put();
  } catch (err) {
    // 桶不存在时自动创建后重试一次
    if ((err as { name?: string }).name === 'NoSuchBucket') {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      await put();
    } else { throw err; }
  }
}

async function pluginS3Presign(key: string, fileName: string): Promise<{ url: string; urlExpiresInSeconds: number }> {
  const { client, cfg } = pluginS3Client();
  const target = cfg.publicEndpoint ? { ...cfg, endpoint: cfg.publicEndpoint } : cfg;
  const presigner = new S3Client({
    region: cfg.region,
    endpoint: target.endpoint,
    forcePathStyle: cfg.pathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.accessKeySecret },
  });
  const url = await getSignedUrl(presigner, new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${fileName}"` }), { expiresIn: 600 });
  return { url, urlExpiresInSeconds: 600 };
}

async function pluginS3Delete(key: string): Promise<void> {
  const { client, cfg } = pluginS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

async function pluginS3List(prefix: string): Promise<Array<{ key: string }>> {
  const { client, cfg } = pluginS3Client();
  const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix }));
  return (out.Contents ?? []).map(o => ({ key: o.Key! }));
}

export interface PluginVersionInfo {
  pluginId: string;
  version: string;
  name: string;
  description: string;
  changelog: string;
  minHostVersion: string;
  payloadSHA256: string;
  payloadDir: string;
  publishedAt: number;
}

export interface PublishParams {
  pluginId: string;
  version: string;
  changelog?: string;
  minHostVersion?: string;
  name?: string;
  description?: string;
  stagingDir: string; // 已就位的 payload 源目录（发布后被接管进注册表）
}

const versionKey = (version: string): number[] => {
  const parts = String(version).split('.').map((chunk) => {
    const digits = (chunk.match(/\d+/g) || []).join('');
    return digits ? parseInt(digits, 10) : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
};

export class PluginPackageService {
  static assertReady() {
    if (!config.license.pluginPackagesDir) {
      throw new LicenseError('插件包目录未配置（LICENSE_PLUGIN_PACKAGES_DIR）', 500);
    }
  }

  static pluginRoot(pluginId: string): string {
    const normalized = pluginId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized)) {
      throw new LicenseError('插件 ID 格式无效', 400);
    }
    const root = path.resolve(config.license.pluginPackagesDir);
    const candidate = path.resolve(root, normalized);
    if (path.dirname(candidate) !== root) throw new LicenseError('插件 ID 格式无效', 400);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new LicenseError('插件目录不允许使用符号链接', 400);
    }
    return candidate;
  }

  /** 与客户端 / tools/license_server.py 严格一致的 payload 目录整体哈希 */
  static computePayloadSHA256(payloadDir: string): string {
    if (fs.lstatSync(payloadDir).isSymbolicLink()) {
      throw new LicenseError('插件 payload 不允许包含符号链接', 400);
    }
    const digest = crypto.createHash('sha256');
    const entries: Array<{ rel: string; full: string }> = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
          throw new LicenseError('插件 payload 不允许包含符号链接', 400);
        }
        if (stat.isDirectory()) walk(full);
        else entries.push({ rel: path.relative(payloadDir, full).split(path.sep).join('/'), full });
      }
    };
    walk(payloadDir);
    entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    for (const entry of entries) {
      const fileDigest = crypto.createHash('sha256').update(fs.readFileSync(entry.full)).digest();
      digest.update(entry.rel, 'utf8');
      digest.update(Buffer.from([0x00]));
      digest.update(fileDigest);
      digest.update(Buffer.from([0x0a]));
    }
    return digest.digest('hex');
  }

  static listVersions(pluginId: string): PluginVersionInfo[] {
    PluginPackageService.assertReady();
    const root = PluginPackageService.pluginRoot(pluginId);
    if (!fs.existsSync(root)) return [];
    const versions: PluginVersionInfo[] = [];
    for (const name of fs.readdirSync(root)) {
      const versionDir = path.join(root, name);
      const metaFile = path.join(versionDir, 'version.json');
      if (fs.lstatSync(versionDir).isSymbolicLink() || !fs.existsSync(metaFile)
        || fs.lstatSync(metaFile).isSymbolicLink()) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        versions.push({
          pluginId,
          version: meta.version,
          name: meta.name || '编排模式 Pro',
          description: meta.description || '',
          changelog: meta.changelog || '',
          minHostVersion: meta.minHostVersion || '',
          payloadSHA256: meta.payloadSHA256 || '',
          payloadDir: path.join(versionDir, 'payload'),
          publishedAt: meta.publishedAt || 0,
        });
      } catch {
        // 跳过损坏的版本目录
      }
    }
    versions.sort((a, b) => {
      const ka = versionKey(a.version);
      const kb = versionKey(b.version);
      for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return b.publishedAt - a.publishedAt;
    });
    return versions;
  }

  static latest(pluginId: string): PluginVersionInfo | null {
    return PluginPackageService.listVersions(pluginId)[0] ?? null;
  }

  static get(pluginId: string, version: string): PluginVersionInfo | null {
    return PluginPackageService.listVersions(pluginId).find((v) => v.version === version) ?? null;
  }

  /** 发布：把 staging 目录接管进注册表（服务器本地目录或管理面上传后落位） */
  static publish(params: PublishParams): PluginVersionInfo {
    PluginPackageService.assertReady();
    const { pluginId, version, stagingDir } = params;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new LicenseError('版本号必须使用语义化版本格式，例如 1.2.0', 400);
    }
    if (!fs.existsSync(stagingDir)) {
      throw new LicenseError('插件 payload 源目录不存在', 400);
    }
    const stagingStat = fs.lstatSync(stagingDir);
    if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
      throw new LicenseError('插件 payload 源目录必须是普通目录且不能是符号链接', 400);
    }
    const pluginRoot = PluginPackageService.pluginRoot(pluginId);
    fs.mkdirSync(pluginRoot, { recursive: true });
    const versionDir = path.join(pluginRoot, version);
    const payloadDir = path.join(versionDir, 'payload');
    if (fs.existsSync(versionDir)) {
      throw new LicenseError('插件版本已存在；已发布版本不可覆盖，请提升版本号', 409);
    }
    const sourceSHA256 = PluginPackageService.computePayloadSHA256(stagingDir);
    const publishingDir = path.join(pluginRoot, `.publishing-${version}-${crypto.randomBytes(6).toString('hex')}`);
    const publishingPayloadDir = path.join(publishingDir, 'payload');
    fs.mkdirSync(publishingDir, { recursive: false });
    let stagingMoved = false;
    try {
      try {
        fs.renameSync(stagingDir, publishingPayloadDir);
        stagingMoved = true;
      } catch (err) {
        // 暂存目录与注册表可能不在同一卷（EXDEV）：回退为复制 + 清理
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        fs.cpSync(stagingDir, publishingPayloadDir, { recursive: true });
      }

      const installedSHA256 = PluginPackageService.computePayloadSHA256(publishingPayloadDir);
      if (installedSHA256 !== sourceSHA256) {
        throw new LicenseError('插件 payload 在发布期间发生变化，已中止发布', 409);
      }
      const info: PluginVersionInfo = {
        pluginId,
        version,
        name: params.name || '编排模式 Pro',
        description: params.description || '',
        changelog: params.changelog || '',
        minHostVersion: params.minHostVersion || '',
        payloadSHA256: installedSHA256,
        payloadDir,
        publishedAt: Math.floor(Date.now() / 1000),
      };
      // 元数据必须可跨主机搬运，不能把构建机绝对路径写进发布包。
      const metadata = {
        pluginId: info.pluginId,
        version: info.version,
        name: info.name,
        description: info.description,
        changelog: info.changelog,
        minHostVersion: info.minHostVersion,
        payloadSHA256: info.payloadSHA256,
        publishedAt: info.publishedAt,
      };
      fs.writeFileSync(path.join(publishingDir, 'version.json'), JSON.stringify(metadata, null, 2), 'utf8');
      fs.renameSync(publishingDir, versionDir);
      if (!stagingMoved) fs.rmSync(stagingDir, { recursive: true, force: true });
      return info;
    } catch (error) {
      // 同卷 rename 已接管暂存目录时尽力回滚，避免校验/写元数据失败后丢失原载荷。
      if (stagingMoved && fs.existsSync(publishingPayloadDir) && !fs.existsSync(stagingDir)) {
        try { fs.renameSync(publishingPayloadDir, stagingDir); } catch { /* leave publishing dir for operator recovery */ }
      }
      if (!stagingMoved || !fs.existsSync(publishingPayloadDir)) {
        fs.rmSync(publishingDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * 载荷加密密钥（信封加密）：K = HMAC-SHA256(密钥, "plugin-payload\0" + deviceId + "\0" + iteration)。
   * K 不写入包内——客户端凭 /plugin/key（授权/试用校验通过后）按需换取。
   * 服务器可对任意 (deviceId, iteration) 确定性重算 K，无需持久化。
   */
  static payloadKey(deviceId: string, iteration: number): Buffer {
    const secret = config.license.keySecret;
    if (!secret) throw new LicenseError('授权密钥未配置（LICENSE_KEY_SECRET），无法加密载荷', 500);
    return crypto.createHmac('sha256', secret)
      .update(`plugin-payload\0${deviceId}\0${Math.max(1, Math.floor(iteration))}`, 'utf8')
      .digest();
  }

  /**
   * 按设备指纹现签 manifest 并打包加密 zip（manifest.json + payload.enc）。
   * 采用零依赖的 store-only ZIP 构造，兼容 macOS 客户端 /usr/bin/unzip。
   * iteration = 指纹迭代参数：deviceId 字段存按迭代派生的指纹密钥，非裸指纹。
   * 载荷以 AES-256-GCM 加密（K = payloadKey(deviceId, iteration)），客户端联网换取 K 后解密。
   */
  static buildDeviceBoundZip(params: {
    info: PluginVersionInfo;
    deviceId: string;
    licenseKey?: string;
    expiresAt?: number | null;
    iteration?: number;
  }): Buffer {
    const { info, deviceId } = params;
    const iteration = Math.max(1, Math.floor(params.iteration ?? 1));
    const boundDevice = deviceId === '*'
      ? '*'
      : LicenseSigner.fingerprintBindingToken(deviceId, iteration);
    const unsigned = {
      manifestVersion: 3,
      kid: LicenseSigner.activeKid,
      iteration,
      id: info.pluginId,
      name: info.name,
      pluginVersion: info.version,
      minHostVersion: info.minHostVersion,
      description: info.description,
      changelog: info.changelog,
      deviceId: boundDevice,
      licenseKey: params.licenseKey || '*',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: params.expiresAt ?? null,
      features: ['orchestration-pro'],
      payloadSHA256: info.payloadSHA256,
      payloadEncrypted: true,
    };
    const manifest: PluginManifestFile = LicenseSigner.signPluginManifest(unsigned);

    // 载荷文件映射（文本资源）→ JSON → AES-256-GCM（payload.enc = iv(12) + tag(16) + ciphertext）
    const files: Record<string, string> = {};
    const collect = (dir: string, prefix: string) => {
      if (fs.lstatSync(dir).isSymbolicLink()) {
        throw new LicenseError('插件 payload 不允许包含符号链接', 400);
      }
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
          throw new LicenseError('插件 payload 不允许包含符号链接', 400);
        }
        if (stat.isDirectory()) collect(full, `${prefix}${name}/`);
        else files[`${prefix}${name}`] = fs.readFileSync(full, 'utf8');
      }
    };
    collect(info.payloadDir, '');
    const inner = Buffer.from(JSON.stringify({ files }), 'utf8');
    const key = PluginPackageService.payloadKey(deviceId, iteration);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(inner), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 布局 iv(12) + ciphertext + tag(16)，与 Swift AES.GCM.SealedBox(combined:) 一致
    const payloadEnc = Buffer.concat([iv, ciphertext, tag]);

    const entries: Array<{ name: string; data: Buffer }> = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'payload.enc', data: payloadEnc },
    ];
    return PluginPackageService.storeOnlyZip(entries);
  }

  /** 最小 ZIP（STORE 无压缩 + CRC32）构造器 */
  private static storeOnlyZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const crc32 = PluginPackageService.crc32(entry.data);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);      // local file header signature
      local.writeUInt16LE(20, 4);              // version needed (2.0 -> store)
      local.writeUInt16LE(0x0800, 6);          // flags: UTF-8 filenames
      local.writeUInt16LE(0, 8);               // method: store
      local.writeUInt16LE(0, 10);              // mod time
      local.writeUInt16LE(0x21, 12);           // mod date (1980-01-01)
      local.writeUInt32LE(crc32, 14);
      local.writeUInt32LE(entry.data.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);

      chunks.push(local, nameBuf, entry.data);

      const centralEntry = Buffer.alloc(46);
      centralEntry.writeUInt32LE(0x02014b50, 0);
      centralEntry.writeUInt16LE(20, 4);       // version made by
      centralEntry.writeUInt16LE(20, 6);       // version needed
      centralEntry.writeUInt16LE(0x0800, 8);   // flags: UTF-8
      centralEntry.writeUInt16LE(0, 10);       // method: store
      centralEntry.writeUInt16LE(0, 12);
      centralEntry.writeUInt16LE(0x21, 14);
      centralEntry.writeUInt32LE(crc32, 16);
      centralEntry.writeUInt32LE(entry.data.length, 20);
      centralEntry.writeUInt32LE(entry.data.length, 24);
      centralEntry.writeUInt16LE(nameBuf.length, 28);
      centralEntry.writeUInt32LE(offset, 42);
      central.push(centralEntry, nameBuf);

      offset += local.length + nameBuf.length + entry.data.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, centralBuf, end]);
  }

  private static crc32Table: number[] | null = null;

  private static crc32(data: Buffer): number {
    if (!PluginPackageService.crc32Table) {
      const table: number[] = [];
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
      PluginPackageService.crc32Table = table;
    }
    let crc = 0xffffffff;
    for (const byte of data) crc = PluginPackageService.crc32Table![(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * 现签设备专属包并推送 OSS，返回签名直链。
   * 服务器不落盘、不直接分发包体：现签 → 上传（同键幂等覆盖）→ 302/直链交给 OSS。
   * 上传后清理同设备旧迭代对象，OSS 不累积垃圾。
   */
  static async mintUploadAndPresign(params: {
    info: PluginVersionInfo;
    deviceId: string;
    licenseKey?: string;
    expiresAt?: number | null;
    iteration: number;
  }): Promise<{ ossKey: string; url: string; urlExpiresInSeconds: number; bytes: number; iteration: number; version: string }> {
    const iteration = Math.max(1, Math.floor(params.iteration));
    const zip = PluginPackageService.buildDeviceBoundZip({
      info: params.info,
      deviceId: params.deviceId,
      licenseKey: params.licenseKey,
      expiresAt: params.expiresAt,
      iteration,
    });
    const cfg = pluginOssConfig();
    const prefix = cfg ? cfg.prefix : 'plugin-packages/';
    const ossKey = `${prefix}${params.info.pluginId}/${params.info.version}/${params.deviceId}.iter${iteration}.zip`;
    await pluginS3Put(ossKey, zip, 'application/zip');
    const presigned = await pluginS3Presign(ossKey, `${params.info.pluginId}-${params.info.version}.zip`);

    // 清理同设备旧迭代对象（保留当前迭代）
    try {
      const oldPrefix = `${prefix}${params.info.pluginId}/${params.info.version}/${params.deviceId}.`;
      for (const obj of await pluginS3List(oldPrefix)) {
        const m = obj.key.match(/\.iter(\d+)\.zip$/);
        if (m && parseInt(m[1], 10) < iteration) {
          await pluginS3Delete(obj.key).catch(() => { /* 清理失败不影响交付 */ });
        }
      }
    } catch { /* 清理失败不影响交付 */ }

    return { ossKey, url: presigned.url, urlExpiresInSeconds: presigned.urlExpiresInSeconds, bytes: zip.length, iteration, version: params.info.version };
  }

  /** 插件专用 OSS 是否可用（LICENSE_PLUGIN_OSS_* 优先，缺省回退卡密测试桶） */
  static pluginOssReady(): boolean {
    return pluginOssConfig() !== null;
  }

  /** 对已上传到插件 OSS 的对象生成短时预签名直链 */
  static async presignPluginObject(ossKey: string, fileName: string): Promise<{ url: string; urlExpiresInSeconds: number }> {
    return pluginS3Presign(ossKey, fileName);
  }
}
