import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectSupportedImageType } from '../../utils/ImageFileUtils';

export interface StaticImageReport {
  referenced: number;
  resolved: number;
  omitted: number;
  affectedPosts: number;
}

export interface StaticizedImageContents {
  contents: Map<string, string>;
  imageFiles: Map<string, Buffer>;
  report: StaticImageReport;
}

export interface StaticImageResourceLimits {
  maxUniqueReferences: number;
  maxImageFiles: number;
  maxImageBytes: number;
  maxCacheEntries: number;
  maxCacheBytes: number;
}

export interface BundleStaticSnapshotImagesOptions {
  cacheDir: string;
  downloadImage: (token: string) => Promise<Buffer>;
  readLocalImage?: (fileName: string) => Promise<Buffer>;
  backendUrl?: string;
  concurrency?: number;
  /** Limits may only lower, never raise, the production hard limits. */
  limits?: Partial<StaticImageResourceLimits>;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 256;
const STATIC_IMAGE_PREFIX = '/data/live/images/';
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/**
 * These defaults leave headroom for Node, Feishu responses, JSON serialization
 * and Docker overhead in a 1-GiB backend container.
 */
export const STATIC_IMAGE_RESOURCE_LIMITS: Readonly<StaticImageResourceLimits> = Object.freeze({
  maxUniqueReferences: 512,
  maxImageFiles: 256,
  maxImageBytes: 64 * 1024 * 1024,
  maxCacheEntries: 256,
  maxCacheBytes: 128 * 1024 * 1024,
});

const URL_END_BOUNDARY = `(?=$|[\\s)\\]}>"'])`;
const OPTIONAL_URL_SUFFIX = `(?:[?#][^\\s)\\]}>"']*)?`;
// A relative proxy path is accepted only at the start of a value or after a
// Markdown/HTML delimiter. This prevents matching the path inside another
// host's absolute URL.
const START_OR_MARKUP_BOUNDARY = `(?<![^\\s(\\[{'"=<>])`;
// Only this strict subset is ever interpolated into a credentialed Feishu
// download URL. A broader legacy segment matcher below is removal-only.
const DOWNLOAD_TOKEN_CAPTURE = `([A-Za-z0-9_-]{1,${MAX_TOKEN_LENGTH}})`;
const LEGACY_SEGMENT_CAPTURE = `([A-Za-z0-9._~%+=-]{1,${MAX_TOKEN_LENGTH}})`;
const UNTRUSTED_INTERNAL_IMAGE_PATH = `[^\\s)\\]}>"']{1,768}`;
const LOCAL_UPLOAD_FILE = '([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|gif|webp))';
const REMOTE_MARKDOWN_IMAGE_PATTERN = /(!\[[^\]\r\n]*\]\(\s*<?)(https?:\/\/(?:[^\s()<>]+|\([^\s()<>]*\))+)(>?)(?=(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?\s*\))/gi;
const MARKDOWN_IMAGE_REFERENCE_PATTERN = /!\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/g;
const REMOTE_MARKDOWN_DEFINITION_PATTERN = /^(\s*\[([^\]\r\n]+)\]:\s*<?)(https?:\/\/[^\s>]+)(>?)/gim;
const HTML_IMAGE_TAG_PATTERN = /<(?:img|source)\b[^>]*>/gi;
const REMOTE_URL_IN_HTML_TAG_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const CACHE_FILE_PATTERN = /^[a-f0-9]{64}$/;
const CACHE_TEMP_PATTERN = /^\.[a-f0-9]{64}\.\d+\.[a-f0-9]{8}\.tmp$/;

interface ResolvedImageReference {
  relativePath: string;
}

interface BundleBudget {
  imageFiles: Map<string, Buffer>;
  totalBytes: number;
  limits: StaticImageResourceLimits;
}

interface CacheEntry {
  name: string;
  bytes: number;
  mtimeMs: number;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function limitedValue(value: unknown, hardLimit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return hardLimit;
  return Math.max(0, Math.min(hardLimit, Math.floor(value)));
}

function resourceLimits(options: BundleStaticSnapshotImagesOptions): StaticImageResourceLimits {
  return {
    maxUniqueReferences: limitedValue(
      options.limits?.maxUniqueReferences,
      STATIC_IMAGE_RESOURCE_LIMITS.maxUniqueReferences,
    ),
    maxImageFiles: limitedValue(
      options.limits?.maxImageFiles,
      STATIC_IMAGE_RESOURCE_LIMITS.maxImageFiles,
    ),
    maxImageBytes: limitedValue(
      options.limits?.maxImageBytes,
      STATIC_IMAGE_RESOURCE_LIMITS.maxImageBytes,
    ),
    maxCacheEntries: limitedValue(
      options.limits?.maxCacheEntries,
      STATIC_IMAGE_RESOURCE_LIMITS.maxCacheEntries,
    ),
    maxCacheBytes: limitedValue(
      options.limits?.maxCacheBytes,
      STATIC_IMAGE_RESOURCE_LIMITS.maxCacheBytes,
    ),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedBackendUrl(backendUrl?: string): string {
  if (typeof backendUrl !== 'string') return '';
  const normalized = backendUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    if (parsed.search || parsed.hash) return '';
    return normalized;
  } catch {
    return '';
  }
}

function scopedProxyPatterns(proxyPathPattern: string, backendUrl?: string): RegExp[] {
  const patterns: RegExp[] = [];
  const backend = normalizedBackendUrl(backendUrl);
  if (backend) {
    patterns.push(new RegExp(
      `${START_OR_MARKUP_BOUNDARY}${escapeRegExp(backend)}${proxyPathPattern}${OPTIONAL_URL_SUFFIX}${URL_END_BOUNDARY}`,
      'g',
    ));
  }
  patterns.push(new RegExp(
    `${START_OR_MARKUP_BOUNDARY}${proxyPathPattern}${OPTIONAL_URL_SUFFIX}${URL_END_BOUNDARY}`,
    'g',
  ));
  return patterns;
}

function privateImagePatterns(backendUrl?: string): RegExp[] {
  return scopedProxyPatterns(`/api/v1/image/${DOWNLOAD_TOKEN_CAPTURE}`, backendUrl);
}

function legacyPrivateImagePatterns(backendUrl?: string): RegExp[] {
  return scopedProxyPatterns(
    `/api/v1/image/${LEGACY_SEGMENT_CAPTURE}/${LEGACY_SEGMENT_CAPTURE}`,
    backendUrl,
  );
}

function localUploadPatterns(backendUrl?: string): RegExp[] {
  return scopedProxyPatterns(`/api/v1/image/uploads/${LOCAL_UPLOAD_FILE}`, backendUrl);
}

function untrustedInternalImagePatterns(backendUrl?: string): RegExp[] {
  return scopedProxyPatterns(`/api/v1/image/${UNTRUSTED_INTERNAL_IMAGE_PATH}`, backendUrl);
}

function collectPatternKeys(
  contents: ReadonlyMap<string, string>,
  patterns: RegExp[],
  maxKeys: number,
): Set<string> {
  const keys = new Set<string>();
  if (maxKeys <= 0) return keys;
  for (const content of contents.values()) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        keys.add(match[1]);
        if (keys.size >= maxKeys) return keys;
      }
    }
  }
  return keys;
}

export function collectPrivateImageTokens(
  contents: ReadonlyMap<string, string>,
  backendUrl?: string,
  maxTokens = STATIC_IMAGE_RESOURCE_LIMITS.maxUniqueReferences,
): Set<string> {
  return collectPatternKeys(
    contents,
    privateImagePatterns(backendUrl),
    limitedValue(maxTokens, STATIC_IMAGE_RESOURCE_LIMITS.maxUniqueReferences),
  );
}

function cacheFileForToken(cacheDir: string, token: string): string {
  // The private Feishu token must never become a filename or a snapshot entry.
  return path.join(cacheDir, sha256(token));
}

async function readValidCachedImage(cacheFile: string): Promise<Buffer | null> {
  try {
    const stats = await fs.promises.lstat(cacheFile);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
      await fs.promises.rm(cacheFile, { force: true }).catch(() => undefined);
      return null;
    }

    const buffer = await fs.promises.readFile(cacheFile);
    if (!detectSupportedImageType(buffer)) {
      await fs.promises.rm(cacheFile, { force: true }).catch(() => undefined);
      return null;
    }
    const now = new Date();
    await fs.promises.utimes(cacheFile, now, now).catch(() => undefined);
    return buffer;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function cacheDownloadedImage(cacheFile: string, buffer: Buffer): Promise<void> {
  const cacheDir = path.dirname(cacheFile);
  const tempFile = path.join(
    cacheDir,
    `.${path.basename(cacheFile)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  );

  try {
    await fs.promises.writeFile(tempFile, buffer, { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(tempFile, cacheFile);
    await fs.promises.chmod(cacheFile, 0o600);
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch(() => undefined);
  }
}

async function prunePrivateImageCache(
  cacheDir: string,
  maxEntries: number,
  maxBytes: number,
): Promise<void> {
  await fs.promises.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(cacheDir, 0o700);
  const directoryEntries = await fs.promises.readdir(cacheDir, { withFileTypes: true });
  const entries: CacheEntry[] = [];

  for (const entry of directoryEntries) {
    const entryPath = path.join(cacheDir, entry.name);
    if (CACHE_TEMP_PATTERN.test(entry.name)) {
      await fs.promises.rm(entryPath, { force: true }).catch(() => undefined);
      continue;
    }
    if (!CACHE_FILE_PATTERN.test(entry.name)) continue;
    try {
      const stats = await fs.promises.lstat(entryPath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
        await fs.promises.rm(entryPath, { force: true }).catch(() => undefined);
        continue;
      }
      entries.push({ name: entry.name, bytes: stats.size, mtimeMs: stats.mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  let retainedEntries = entries.length;
  let retainedBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  entries.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (retainedEntries <= maxEntries && retainedBytes <= maxBytes) break;
    await fs.promises.rm(path.join(cacheDir, entry.name), { force: true });
    retainedEntries -= 1;
    retainedBytes -= entry.bytes;
  }
}

class PrivateImageCache {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly cacheDir: string,
    private readonly limits: StaticImageResourceLimits,
  ) {}

  public async initialize(): Promise<void> {
    await prunePrivateImageCache(
      this.cacheDir,
      this.limits.maxCacheEntries,
      this.limits.maxCacheBytes,
    );
  }

  public read(token: string): Promise<Buffer | null> {
    return readValidCachedImage(cacheFileForToken(this.cacheDir, token));
  }

  public async store(token: string, buffer: Buffer): Promise<void> {
    if (this.limits.maxCacheEntries < 1 || buffer.length > this.limits.maxCacheBytes) return;

    const cacheFile = cacheFileForToken(this.cacheDir, token);
    const operation = this.writeQueue.then(async () => {
      // Make room before creating the temporary file so managed cache bytes stay
      // bounded even during writes. Writes are serialized; downloads are not.
      await prunePrivateImageCache(
        this.cacheDir,
        Math.max(0, this.limits.maxCacheEntries - 1),
        Math.max(0, this.limits.maxCacheBytes - buffer.length),
      );
      await cacheDownloadedImage(cacheFile, buffer);
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  public async finish(): Promise<void> {
    await this.writeQueue;
    await prunePrivateImageCache(
      this.cacheDir,
      this.limits.maxCacheEntries,
      this.limits.maxCacheBytes,
    );
  }
}

function commitImageBuffer(buffer: Buffer, budget: BundleBudget): ResolvedImageReference | null {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const detectedType = detectSupportedImageType(buffer);
  if (!detectedType) return null;

  const relativePath = `images/${sha256(buffer)}.${detectedType.extension}`;
  if (budget.imageFiles.has(relativePath)) return { relativePath };
  if (
    budget.imageFiles.size >= budget.limits.maxImageFiles
    || budget.totalBytes + buffer.length > budget.limits.maxImageBytes
  ) return null;

  budget.imageFiles.set(relativePath, buffer);
  budget.totalBytes += buffer.length;
  return { relativePath };
}

async function resolveReferences(
  keys: string[],
  concurrency: number,
  load: (key: string) => Promise<Buffer>,
  budget: BundleBudget,
): Promise<Map<string, ResolvedImageReference>> {
  const results = new Map<string, ResolvedImageReference>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor];
      cursor += 1;
      try {
        const buffer = await load(key);
        const resolved = commitImageBuffer(buffer, budget);
        if (resolved) results.set(key, resolved);
      } catch {
        // One failed or over-budget image becomes a placeholder; other public
        // articles remain independently publishable.
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()));
  return results;
}

function collectReferenceLabels(content: string): Set<string> {
  const labels = new Set<string>();
  MARKDOWN_IMAGE_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(MARKDOWN_IMAGE_REFERENCE_PATTERN)) {
    labels.add((match[2] || match[1]).trim().toLocaleLowerCase());
  }
  return labels;
}

function replaceRemoteImageDependencies(
  content: string,
  omit: (count?: number) => void,
): string {
  REMOTE_MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
  let rewritten = content.replace(
    REMOTE_MARKDOWN_IMAGE_PATTERN,
    (_reference, prefix: string, _url: string, closing: string) => {
      omit();
      return `${prefix}${PLACEHOLDER_IMAGE}${closing}`;
    },
  );

  const imageReferenceLabels = collectReferenceLabels(rewritten);
  if (imageReferenceLabels.size > 0) {
    REMOTE_MARKDOWN_DEFINITION_PATTERN.lastIndex = 0;
    rewritten = rewritten.replace(
      REMOTE_MARKDOWN_DEFINITION_PATTERN,
      (reference, prefix: string, label: string, _url: string, closing: string) => {
        if (!imageReferenceLabels.has(label.trim().toLocaleLowerCase())) return reference;
        omit();
        return `${prefix}${PLACEHOLDER_IMAGE}${closing}`;
      },
    );
  }

  HTML_IMAGE_TAG_PATTERN.lastIndex = 0;
  return rewritten.replace(HTML_IMAGE_TAG_PATTERN, tag => {
    REMOTE_URL_IN_HTML_TAG_PATTERN.lastIndex = 0;
    return tag.replace(REMOTE_URL_IN_HTML_TAG_PATTERN, () => {
      omit();
      return PLACEHOLDER_IMAGE;
    });
  });
}

/**
 * Resolves only image references already present in eligible public bodies.
 * Feishu tokens are cached under SHA-256 names, while snapshots contain only
 * content-addressed image files. No arbitrary remote URL is fetched.
 */
export async function bundleStaticSnapshotImages(
  contents: ReadonlyMap<string, string>,
  options: BundleStaticSnapshotImagesOptions,
): Promise<StaticizedImageContents> {
  const limits = resourceLimits(options);
  const concurrency = Math.max(1, Math.min(3, Math.floor(options.concurrency || 2)));
  let remainingUniqueReferences = limits.maxUniqueReferences;
  const tokens = [...collectPrivateImageTokens(contents, options.backendUrl, remainingUniqueReferences)];
  remainingUniqueReferences -= tokens.length;
  const localUploadFileNames = [...collectPatternKeys(
    contents,
    localUploadPatterns(options.backendUrl),
    remainingUniqueReferences,
  )];

  const budget: BundleBudget = { imageFiles: new Map(), totalBytes: 0, limits };
  const privateCache = new PrivateImageCache(path.resolve(options.cacheDir), limits);
  await privateCache.initialize();
  const resolvedTokens = await resolveReferences(
    tokens,
    concurrency,
    async token => {
      const cached = await privateCache.read(token);
      if (cached) return cached;
      const downloaded = await options.downloadImage(token);
      if (!Buffer.isBuffer(downloaded) || downloaded.length <= 0 || downloaded.length > MAX_IMAGE_BYTES) {
        throw new Error('INVALID_PRIVATE_IMAGE');
      }
      if (!detectSupportedImageType(downloaded)) throw new Error('INVALID_PRIVATE_IMAGE');
      await privateCache.store(token, downloaded).catch(() => undefined);
      return downloaded;
    },
    budget,
  );
  await privateCache.finish().catch(() => undefined);

  const resolvedLocalUploads = options.readLocalImage
    ? await resolveReferences(
      localUploadFileNames,
      concurrency,
      async fileName => {
        const buffer = await options.readLocalImage!(fileName);
        if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > MAX_IMAGE_BYTES) {
          throw new Error('INVALID_LOCAL_IMAGE');
        }
        const detectedType = detectSupportedImageType(buffer);
        if (!detectedType || detectedType.extension !== path.extname(fileName).slice(1)) {
          throw new Error('INVALID_LOCAL_IMAGE');
        }
        return buffer;
      },
      budget,
    )
    : new Map<string, ResolvedImageReference>();

  const staticContents = new Map<string, string>();
  let referenced = 0;
  let resolved = 0;
  let omitted = 0;
  let affectedPosts = 0;

  for (const [postId, content] of contents) {
    let postOmitted = 0;
    const omit = (count = 1) => {
      referenced += count;
      omitted += count;
      postOmitted += count;
    };
    const replaceReference = (
      _reference: string,
      key: string,
      resolvedImages: ReadonlyMap<string, ResolvedImageReference>,
    ) => {
      referenced += 1;
      const image = resolvedImages.get(key);
      if (!image) {
        omitted += 1;
        postOmitted += 1;
        return PLACEHOLDER_IMAGE;
      }
      resolved += 1;
      return `${STATIC_IMAGE_PREFIX}${path.posix.basename(image.relativePath)}`;
    };

    let rewritten = content;
    for (const localPattern of localUploadPatterns(options.backendUrl)) {
      localPattern.lastIndex = 0;
      rewritten = rewritten.replace(localPattern, (reference, fileName: string) =>
        replaceReference(reference, fileName, resolvedLocalUploads));
    }
    // Legacy /:docId/:token links are never downloaded: both opaque values are
    // removed from the public JSON and represented by the inert placeholder.
    for (const legacyPattern of legacyPrivateImagePatterns(options.backendUrl)) {
      legacyPattern.lastIndex = 0;
      rewritten = rewritten.replace(legacyPattern, () => {
        omit();
        return PLACEHOLDER_IMAGE;
      });
    }
    for (const privatePattern of privateImagePatterns(options.backendUrl)) {
      privatePattern.lastIndex = 0;
      rewritten = rewritten.replace(privatePattern, (reference, token: string) =>
        replaceReference(reference, token, resolvedTokens));
    }
    // Any malformed or unexpected internal image path is removal-only. In
    // particular, percent-encoded slashes must never reach a credentialed
    // Feishu request or remain exposed in the public JSON.
    for (const untrustedPattern of untrustedInternalImagePatterns(options.backendUrl)) {
      untrustedPattern.lastIndex = 0;
      rewritten = rewritten.replace(untrustedPattern, () => {
        omit();
        return PLACEHOLDER_IMAGE;
      });
    }
    rewritten = replaceRemoteImageDependencies(rewritten, omit);

    if (postOmitted > 0) {
      affectedPosts += 1;
      staticContents.set(postId, `${rewritten}\n\n> 部分图片同步失败，静态站暂不展示。`);
    } else {
      staticContents.set(postId, rewritten);
    }
  }

  return {
    contents: staticContents,
    imageFiles: budget.imageFiles,
    report: { referenced, resolved, omitted, affectedPosts },
  };
}
