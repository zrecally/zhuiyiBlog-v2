import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import { config } from '../config';

/**
 * 卡密私有文件专用对象存储客户端（S3 兼容协议，生产对接雨云 ROS，
 * 本地对接 docker compose 的 MinIO；两者均为 AWS SigV4 签名）。
 * 与 core/OssClient（公开图片 + CDN，阿里云私有协议）语义不同：这里的桶必须私有读，
 * 下载一律走短时预签名 URL，由调用方负责 302 跳转。
 * 连接参数支持运行时更新（管理 API 保存后重建客户端，无需重启）。
 */

export type CardOssRuntimeConfig = {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  keyPrefix: string;
  publicEndpoint: string;
  presignTtlSeconds: number;
  region: string;      // SigV4 签名区域；S3 兼容服务一般填 us-east-1 即可
  pathStyle: boolean;  // true = endpoint/bucket/key；false = bucket.endpoint/key
};

export class CardOssNotConfiguredError extends Error {
  constructor(message = '卡密对象存储未启用或配置不完整') {
    super(message);
    this.name = 'CardOssNotConfiguredError';
  }
}

export type CardOssObjectMeta = {
  key: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  versionId: string | null;
};

export type CardOssObjectSummary = {
  key: string;
  size: number;
  lastModified: string;
};

// 初始值来自环境变量；管理 API 保存后运行时覆盖并持久化。
const runtime: CardOssRuntimeConfig = {
  enabled: config.cardRedeem.oss.enabled,
  endpoint: config.cardRedeem.oss.endpoint,
  accessKeyId: config.cardRedeem.oss.accessKeyId,
  accessKeySecret: config.cardRedeem.oss.accessKeySecret,
  bucket: config.cardRedeem.oss.bucket,
  keyPrefix: config.cardRedeem.oss.keyPrefix,
  publicEndpoint: config.cardRedeem.oss.publicEndpoint,
  presignTtlSeconds: config.cardRedeem.oss.presignTtlSeconds,
  region: config.cardRedeem.oss.region,
  pathStyle: config.cardRedeem.oss.pathStyle,
};

let cached: S3Client | null = null;

const isReady = (): boolean =>
  Boolean(runtime.enabled && runtime.endpoint && runtime.accessKeyId && runtime.accessKeySecret && runtime.bucket);

const buildClient = (endpoint: string): S3Client => new S3Client({
  region: runtime.region,
  endpoint,
  forcePathStyle: runtime.pathStyle,
  credentials: {
    accessKeyId: runtime.accessKeyId,
    secretAccessKey: runtime.accessKeySecret,
  },
});

const client = (): S3Client => {
  if (!isReady()) throw new CardOssNotConfiguredError();
  if (!cached) cached = buildClient(runtime.endpoint);
  return cached;
};

// SigV4 签名覆盖 Host 头，因此对外 host 与 API endpoint 不同时，
// 必须用对外 host 重新签名，而不能签完再替换主机名。
const presignClient = (): S3Client => {
  if (!isReady()) throw new CardOssNotConfiguredError();
  return runtime.publicEndpoint ? buildClient(runtime.publicEndpoint) : client();
};

/** 把 S3 SDK 错误归一化为带 .status 的 Error，保持调用方（404 判断等）的既有形状。 */
const normalizeError = (error: unknown): Error => {
  const anyError = error as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
  const status = anyError?.$metadata?.httpStatusCode;
  if (status) {
    const wrapped: Error & { status?: number } = new Error(anyError.message || `S3 请求失败 (${status})`);
    wrapped.status = status;
    return wrapped;
  }
  return error instanceof Error ? error : new Error(String(error));
};

export const cardOssReady = isReady;

/** 运行时配置快照（secret 原样返回，仅限管理员接口）。 */
export const cardOssSettings = (): CardOssRuntimeConfig => ({ ...runtime });

/** 应用新配置并重建客户端；参数不合法时抛错且不改变现有连接。 */
export const cardOssApplySettings = (s: Partial<CardOssRuntimeConfig>): void => {
  const keyPrefix = (s.keyPrefix ?? runtime.keyPrefix).replace(/[^/\\]$/, '$&/');
  const presignTtlSeconds = Math.min(Math.max(Number(s.presignTtlSeconds ?? runtime.presignTtlSeconds) || 1800, 60), 3600);
  const next: CardOssRuntimeConfig = {
    enabled: s.enabled ?? runtime.enabled,
    endpoint: (s.endpoint ?? runtime.endpoint).trim().replace(/\/+$/, ''),
    accessKeyId: (s.accessKeyId ?? runtime.accessKeyId).trim(),
    accessKeySecret: (s.accessKeySecret ?? runtime.accessKeySecret).trim(),
    bucket: (s.bucket ?? runtime.bucket).trim(),
    keyPrefix,
    publicEndpoint: (s.publicEndpoint ?? runtime.publicEndpoint).trim().replace(/\/+$/, ''),
    presignTtlSeconds,
    region: (s.region ?? runtime.region).trim() || 'us-east-1',
    pathStyle: s.pathStyle ?? runtime.pathStyle,
  };
  if (next.enabled && (!next.endpoint || !next.accessKeyId || !next.accessKeySecret || !next.bucket)) {
    throw new Error('启用对象存储需要完整的 endpoint / accessKeyId / accessKeySecret / bucket');
  }
  if (next.enabled && !/^https?:\/\//.test(next.endpoint)) {
    throw new Error('endpoint 必须以 http:// 或 https:// 开头');
  }
  if (next.publicEndpoint && !/^https?:\/\//.test(next.publicEndpoint)) {
    throw new Error('publicEndpoint 必须以 http:// 或 https:// 开头');
  }
  const browserEndpoint = next.publicEndpoint || next.endpoint;
  if (next.enabled && process.env.NODE_ENV === 'production' && !browserEndpoint.startsWith('https://')) {
    throw new Error('生产环境的 OSS 公网下载地址必须使用 HTTPS');
  }
  runtime.enabled = next.enabled;
  runtime.endpoint = next.endpoint;
  runtime.accessKeyId = next.accessKeyId;
  runtime.accessKeySecret = next.accessKeySecret;
  runtime.bucket = next.bucket;
  runtime.keyPrefix = next.keyPrefix;
  runtime.publicEndpoint = next.publicEndpoint;
  runtime.presignTtlSeconds = next.presignTtlSeconds;
  runtime.region = next.region;
  runtime.pathStyle = next.pathStyle;
  cached = null; // 重建客户端
};

export const cardOssPut = async (key: string, body: Buffer | NodeJS.ReadableStream, contentType: string): Promise<void> => {
  try {
    await client().send(new PutObjectCommand({
      Bucket: runtime.bucket,
      Key: key,
      Body: body as Buffer | Readable,
      ContentType: contentType,
    }));
  } catch (error) {
    throw normalizeError(error);
  }
};

export const cardOssHead = async (key: string, versionId?: string | null): Promise<CardOssObjectMeta> => {
  try {
    const head = await client().send(new HeadObjectCommand({
      Bucket: runtime.bucket,
      Key: key,
      ...(versionId ? { VersionId: versionId } : {}),
    }));
    return {
      key,
      size: Number(head.ContentLength ?? 0),
      contentType: typeof head.ContentType === 'string' ? head.ContentType : null,
      etag: typeof head.ETag === 'string' ? head.ETag : null,
      versionId: typeof head.VersionId === 'string' ? head.VersionId : null,
    };
  } catch (error) {
    throw normalizeError(error);
  }
};

export const cardOssDelete = async (key: string, versionId?: string | null): Promise<void> => {
  try {
    await client().send(new DeleteObjectCommand({
      Bucket: runtime.bucket,
      Key: key,
      ...(versionId ? { VersionId: versionId } : {}),
    }));
  } catch (error) {
    throw normalizeError(error);
  }
};

/** 分片上传本地文件到 S3 兼容桶（大文件低内存），onProgress 为 0..1 转存进度。 */
export const cardOssMultipartPut = async (
  key: string,
  filePath: string,
  onProgress: (fraction: number) => void,
): Promise<void> => {
  try {
    const { createReadStream } = await import('node:fs');
    const upload = new Upload({
      client: client(),
      params: {
        Bucket: runtime.bucket,
        Key: key,
        Body: createReadStream(filePath),
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });
    upload.on('httpUploadProgress', (progress) => {
      if (typeof progress.loaded === 'number' && typeof progress.total === 'number' && progress.total > 0) {
        onProgress(Math.min(1, progress.loaded / progress.total));
      }
    });
    await upload.done();
    onProgress(1);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const cardOssEnsureBucket = async (): Promise<void> => {
  if (!isReady()) return;
  try {
    await client().send(new HeadBucketCommand({ Bucket: runtime.bucket }));
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchBucket') {
      try {
        await client().send(new CreateBucketCommand({ Bucket: runtime.bucket }));
        console.log(`[CardOss] 自动就绪对象存储桶: ${runtime.bucket}`);
      } catch (createErr) {
        console.warn(`[CardOss] 创建存储桶提示:`, createErr);
      }
    }
  }
};

/** 列举桶内对象（排除卡密同步元数据/暂存文件）。 */
export const cardOssList = async (prefix = ''): Promise<CardOssObjectSummary[]> => {
  try {
    const result = await client().send(new ListObjectsV2Command({
      Bucket: runtime.bucket,
      Prefix: prefix,
      MaxKeys: 1000,
    }));
    return (result.Contents || [])
      .filter(item => !item.Key?.includes('.meta.') && !item.Key?.includes('.staging-'))
      .map(item => ({
        key: item.Key as string,
        size: Number(item.Size ?? 0),
        lastModified: item.LastModified?.toISOString?.() ?? String(item.LastModified ?? ''),
      }));
  } catch (error: any) {
    if (error?.name === 'NoSuchBucket' || error?.$metadata?.httpStatusCode === 404) {
      await cardOssEnsureBucket();
      return [];
    }
    throw normalizeError(error);
  }
};

export type CardOssPresignOptions = {
  signingDate?: Date;
  expiresInSeconds?: number;
  versionId?: string | null;
};

/** 生成短时预签名 GET URL（SigV4 覆盖 Host，publicEndpoint 时用其重新签名）。
 *  signingDate 可持久化：同一逻辑授权的重试会生成完全相同的 URL，而不是新的 bearer 凭据。 */
export const cardOssPresignGet = async (
  key: string,
  fileName: string,
  options: CardOssPresignOptions = {},
): Promise<{ url: string; expiresInSeconds: number }> => {
  const expiresInSeconds = Math.min(
    3600,
    Math.max(60, Math.floor(options.expiresInSeconds ?? runtime.presignTtlSeconds)),
  );
  // ASCII 回退名 + RFC 5987 UTF-8 名：中文名在浏览器下载时不再乱码
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const command = new GetObjectCommand({
    Bucket: runtime.bucket,
    Key: key,
    ...(options.versionId ? { VersionId: options.versionId } : {}),
    ResponseContentDisposition: disposition,
  });
  const url = await getSignedUrl(presignClient(), command, {
    expiresIn: expiresInSeconds,
    ...(options.signingDate ? { signingDate: options.signingDate } : {}),
  });
  return { url, expiresInSeconds };
};
