import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { cacheService } from '../CacheService';
import { FeishuMarkdownParser } from '../FeishuMarkdownParser';
import { readLocalImage } from '../../utils/LocalImageStorage';
import { readLocalFont } from '../../utils/LocalFontStorage';
import { detectSupportedImageType } from '../../utils/ImageFileUtils';
import { readAlbumImage } from '../../utils/AlbumImageStorage';
import { feishuEnvironmentCacheSegment } from '../../utils/FeishuEnvironment';
import { FeishuPublicDataService, PublicFriendItem, PublicTimelineItem } from '../FeishuPublicDataService';
import { ProjectsController } from '../../controllers/ProjectsController';
import {
  bundleStaticSnapshotImages,
} from './StaticSnapshotImages';
import {
  isSnapshotMetadataEligible,
  isSnapshotContentEligible,
  postContentHasVideoMedia,
  SnapshotSourcePost,
  StaticSnapshotResult,
  writeStaticSnapshot,
} from './StaticSnapshotWriter';

function toImageBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value && typeof value === 'object' && 'data' in value) {
    return toImageBuffer((value as { data: unknown }).data);
  }
  return null;
}

const MAX_PUBLIC_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_STATIC_ALBUM_PHOTOS = 96;
const MAX_STATIC_ALBUM_BYTES = 128 * 1024 * 1024;
const remoteImageCache = new Map<string, { expiresAt: number; buffer: Buffer }>();

async function readPreviousPublicList<T>(fileName: 'timeline.json' | 'friends.json' | 'projects.json'): Promise<T[]> {
  const currentFile = path.join(config.staticSnapshot.outputDir, 'current', fileName);
  try {
    const fileStat = await fs.promises.stat(currentFile);
    if (!fileStat.isFile() || fileStat.size > 10 * 1024 * 1024) return [];
    const parsed = JSON.parse(await fs.promises.readFile(currentFile, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[StaticSnapshot] 无法读取上一版 ${fileName}:`, (error as Error).message);
    }
    return [];
  }
}

async function loadPublicTimeline(): Promise<PublicTimelineItem[]> {
  const configured = Boolean(feishuClient && config.feishu.baseToken && config.feishu.tables.timeline);
  if (configured) return FeishuPublicDataService.fetchTimeline(true);
  if (Array.isArray(cacheService.timelineCache)) return cacheService.timelineCache as PublicTimelineItem[];
  console.warn('[StaticSnapshot] 飞书动态未配置，复用上一版公开快照。');
  return readPreviousPublicList<PublicTimelineItem>('timeline.json');
}

async function loadPublicFriends(): Promise<PublicFriendItem[]> {
  const configured = Boolean(feishuClient && config.feishu.baseToken && config.feishu.tables.friends);
  if (configured) return FeishuPublicDataService.fetchFriends(true);
  if (Array.isArray(cacheService.friendsCache)) return cacheService.friendsCache as PublicFriendItem[];
  console.warn('[StaticSnapshot] 飞书友邻未配置，复用上一版公开快照。');
  return readPreviousPublicList<PublicFriendItem>('friends.json');
}

async function loadPublicProjects(imageFiles: Map<string, Buffer>): Promise<Record<string, unknown>[]> {
  const configured = Boolean(feishuClient && config.feishu.baseToken && config.feishu.tables.projects);
  if (configured || Array.isArray(cacheService.projectsCache)) {
    return ProjectsController.prepareStaticProjects(imageFiles);
  }

  console.warn('[StaticSnapshot] 飞书项目集未配置，复用上一版公开快照。');
  const projects = await readPreviousPublicList<Record<string, unknown>>('projects.json');
  await Promise.all(projects.map(async project => {
    const cover = typeof project.cover === 'string' ? project.cover : '';
    const match = cover.match(/^\/data\/live\/(images\/[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp))$/i);
    if (!match) return;
    try {
      const image = await fs.promises.readFile(path.join(config.staticSnapshot.outputDir, 'current', match[1]));
      if (image.byteLength <= MAX_PUBLIC_AVATAR_BYTES && detectSupportedImageType(image)) {
        imageFiles.set(match[1], image);
      }
    } catch (error) {
      console.warn(`[StaticSnapshot] 无法复用项目 ${String(project.id || '')} 的封面:`, (error as Error).message);
      project.cover = '';
    }
  }));
  return projects;
}

async function prepareStaticCompliance() {
  const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'static_compliance_' }, isSecret: false } });
  const values = Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, unknown>;
  const plain = (key: string, max: number) => {
    const value = typeof values[key] === 'string' ? values[key].trim() : '';
    if (!value || value.length > max || /[<>]/.test(value)) throw new Error(`静态备案配置 ${key} 缺失或非法`);
    return value;
  };
  if (values.static_compliance_enabled !== 'true') throw new Error('静态备案配置未启用，拒绝生成新 release');
  const policeRecordCode = plain('static_compliance_police_record_code', 32);
  if (!/^\d{6,32}$/.test(policeRecordCode)) throw new Error('静态公安备案代码必须为 6-32 位数字');
  return {
    enabled: true as const,
    icpNumber: plain('static_compliance_icp_number', 80),
    policeNumber: plain('static_compliance_police_number', 80),
    policeRecordCode,
  };
}

function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  const parts = ipv4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

async function readBoundedResponse(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || '0');
  if (declaredLength > MAX_PUBLIC_AVATAR_BYTES) throw new Error('公开头像超过 5 MiB');
  if (!response.body) throw new Error('公开头像响应没有正文');

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PUBLIC_AVATAR_BYTES) {
      await reader.cancel();
      throw new Error('公开头像超过 5 MiB');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

async function downloadAllowlistedPublicImage(source: string): Promise<Buffer> {
  const cached = remoteImageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.buffer;
  }

  const url = new URL(source);
  const host = url.hostname.toLocaleLowerCase();
  if (
    url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443')
    || !config.staticSnapshot.remoteImageHosts.includes(host)
  ) {
    throw new Error(`公开图片主机不在静态打包白名单: ${host}`);
  }

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(result => isForbiddenAddress(result.address))) {
    throw new Error(`公开图片主机解析到禁止访问的地址: ${host}`);
  }

  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
  });
  if (!response.ok) throw new Error(`公开图片下载返回 HTTP ${response.status}`);
  const buffer = await readBoundedResponse(response);
  if (!detectSupportedImageType(buffer)) throw new Error('公开图片不是支持的图片格式');
  if (remoteImageCache.size >= 64) remoteImageCache.clear();
  remoteImageCache.set(source, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, buffer });
  return buffer;
}

async function localizeAllowlistedPublicImage(
  source: string,
  imageFiles: Map<string, Buffer>,
): Promise<string> {
  const buffer = await downloadAllowlistedPublicImage(source);
  const detectedType = detectSupportedImageType(buffer);
  if (!detectedType) throw new Error('公开图片不是支持的图片格式');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const relativeName = `images/${hash}.${detectedType.extension}`;
  imageFiles.set(relativeName, buffer);
  return `/data/live/${relativeName}`;
}

async function localizePublicSiteConfig(
  value: unknown,
  imageFiles: Map<string, Buffer>,
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const siteConfig = { ...(value as Record<string, unknown>) };
  const avatar = typeof siteConfig.avatar === 'string' ? siteConfig.avatar.trim() : '';
  if (avatar) {
    try {
      siteConfig.avatar = await localizeAllowlistedPublicImage(avatar, imageFiles);
    } catch (error) {
      console.warn('[StaticSnapshot] 无法打包站点头像，已使用前端占位图:', (error as Error).message);
      siteConfig.avatar = '';
    }
  }

  // 自定义字体是主机本地配置，不应被下一轮飞书配置缓存覆盖。
  const persistedFont = await prisma.systemConfig.findUnique({
    where: { key: 'custom_font_url' },
    select: { value: true, isSecret: true },
  });
  const fontUrl = !persistedFont?.isSecret && typeof persistedFont?.value === 'string'
    ? persistedFont.value
    : siteConfig.custom_font_url;
  const fontMatch = typeof fontUrl === 'string'
    ? fontUrl.match(/^\/api\/v1\/fonts\/([0-9a-f-]{36}\.(?:ttf|woff|woff2))$/)
    : null;
  if (fontMatch) {
    try {
      const font = await readLocalFont(fontMatch[1]);
      const hash = createHash('sha256').update(font.buffer).digest('hex');
      const relativeName = `fonts/${hash}.${font.type.extension}`;
      imageFiles.set(relativeName, font.buffer);
      siteConfig.custom_font_url = `/data/live/${relativeName}`;
    } catch (error) {
      console.warn('[StaticSnapshot] 忽略无法读取的自定义字体:', (error as Error).message);
      delete siteConfig.custom_font_url;
    }
  } else {
    delete siteConfig.custom_font_url;
  }
  return siteConfig;
}

async function localizePublicFriends(
  friends: PublicFriendItem[],
  imageFiles: Map<string, Buffer>,
): Promise<PublicFriendItem[]> {
  return Promise.all(friends.map(async friend => {
    const avatar = friend.avatar.trim();
    if (!avatar) return friend;

    try {
      return {
        ...friend,
        avatar: await localizeAllowlistedPublicImage(avatar, imageFiles),
      };
    } catch (error) {
      console.warn(`[StaticSnapshot] 无法打包友链「${friend.name}」头像，已使用前端占位图:`, (error as Error).message);
      return { ...friend, avatar: '' };
    }
  }));
}

export class StaticSnapshotService {
  private static publishInProgress: Promise<StaticSnapshotResult | null> | null = null;
  private static readonly contentRefreshAttemptedAt = new Map<string, number>();

  public static noteContentRefreshed(postId: string, refreshedAt = Date.now()): void {
    this.contentRefreshAttemptedAt.set(postId, refreshedAt);
  }

  public static publishAfterFeishuSync(): Promise<StaticSnapshotResult | null> {
    if (!config.staticSnapshot.enabled) return Promise.resolve(null);
    if (this.publishInProgress) return this.publishInProgress;

    this.publishInProgress = this.publishFromCurrentCache()
      .finally(() => {
        this.publishInProgress = null;
      });
    return this.publishInProgress;
  }

  private static async publishFromCurrentCache(): Promise<StaticSnapshotResult | null> {
    const cachedPosts = cacheService.postsCache?.posts;
    if (!Array.isArray(cachedPosts)) {
      console.warn('[StaticSnapshot] 文章缓存尚未完成可信同步，本次不切换静态快照。');
      return null;
    }
    // An empty array is a valid, successfully synchronized state. Publishing it
    // removes articles that were deleted or unpublished instead of keeping a
    // stale public release forever.
    const posts = cachedPosts as SnapshotSourcePost[];

    const now = new Date();
    await this.refreshEligibleContents(posts, now.getTime());
    const { publishablePosts, videoExcludedCount } = this.excludeVideoPosts(posts, now.getTime());
    if (videoExcludedCount > 0) {
      console.warn(`[StaticSnapshot] ${videoExcludedCount} 篇文章包含视频，已整篇排除出静态快照。`);
    }
    const staticImages = await this.prepareStaticImageContents(publishablePosts, now.getTime());
    const [timeline, remoteFriends, i18nDict] = await Promise.all([
      loadPublicTimeline(),
      loadPublicFriends(),
      this.prepareStaticI18n(),
    ]);
    const friends = await localizePublicFriends(remoteFriends, staticImages.imageFiles);
    const publicSiteConfig = await localizePublicSiteConfig(
      cacheService.configCache || cacheService.postsCache?.config,
      staticImages.imageFiles,
    );
    const siteCompliance = await prepareStaticCompliance();
    const [album, projects] = await Promise.all([
      this.prepareStaticAlbum(staticImages.imageFiles),
      loadPublicProjects(staticImages.imageFiles),
    ]);

    const result = await writeStaticSnapshot({
      outputDir: config.staticSnapshot.outputDir,
      posts: publishablePosts,
      postContents: staticImages.contents,
      siteConfig: publicSiteConfig,
      siteCompliance,
      timeline,
      friends,
      album,
      projects,
      i18n: i18nDict,
      now,
      retainReleases: config.staticSnapshot.retainReleases,
      imageReport: staticImages.report,
      imageFiles: staticImages.imageFiles,
    });

    if (!result.changed) {
      console.log(
        `[StaticSnapshot] 公开内容未变化，沿用版本 ${result.version}（${result.postCount} 篇，跳过 ${result.skippedCount} 篇）。`,
      );
      return result;
    }

    console.log(
      `[StaticSnapshot] ✅ 已生成版本 ${result.version}：${result.postCount} 篇公开文章，跳过 ${result.skippedCount} 篇。`,
    );
    if (staticImages.report.omitted > 0) {
      console.warn(
        `[StaticSnapshot] ${staticImages.report.omitted} 个图片引用无法随静态包发布，已在 ${staticImages.report.affectedPosts} 篇文章中替换为静态占位符。`,
      );
    }
    return result;
  }

  private static async prepareStaticI18n() {
    try {
      const records = await (prisma as any).i18nDict.findMany();
      const zh: Record<string, string> = {};
      const en: Record<string, string> = {};

      records.forEach((r: any) => {
        if (r.zh_CN) zh[r.key] = r.zh_CN;
        if (r.en_US) en[r.key] = r.en_US;
      });

      return {
        success: true,
        data: {
          zh,
          en
        }
      };
    } catch (error) {
      console.error('[StaticSnapshot] 获取静态 i18n 字典失败:', error);
      return { success: true, data: { zh: {}, en: {} } };
    }
  }

  private static async prepareStaticAlbum(imageFiles: Map<string, Buffer>) {
    const photos = await prisma.albumPhoto.findMany({
      where: { status: 'Published', deletedAt: null },
      orderBy: [
        { featured: 'desc' },
        { sortOrder: 'asc' },
        { takenAt: 'desc' },
        { id: 'desc' },
      ],
      take: MAX_STATIC_ALBUM_PHOTOS,
    });

    const publicPhotos: Array<Record<string, unknown>> = [];
    let albumBytes = 0;
    for (const photo of photos) {
      try {
        const [display, thumbnail] = await Promise.all([
          readAlbumImage('display', photo.displayFileName),
          readAlbumImage('thumbnail', photo.thumbnailFileName),
        ]);
        const incomingBytes = display.buffer.length + thumbnail.buffer.length;
        if (display.buffer.length > 10 * 1024 * 1024 || thumbnail.buffer.length > 10 * 1024 * 1024) {
          console.warn(`[StaticSnapshot] 相册照片 ${photo.id} 单图超过静态包限制，已跳过。`);
          continue;
        }
        if (albumBytes + incomingBytes > MAX_STATIC_ALBUM_BYTES) break;

        const displayHash = createHash('sha256').update(display.buffer).digest('hex');
        const thumbnailHash = createHash('sha256').update(thumbnail.buffer).digest('hex');
        const displayName = `images/${displayHash}.webp`;
        const thumbnailName = `images/${thumbnailHash}.webp`;
        imageFiles.set(displayName, display.buffer);
        imageFiles.set(thumbnailName, thumbnail.buffer);
        albumBytes += incomingBytes;
        publicPhotos.push({
          id: String(photo.id),
          title: photo.title,
          caption: photo.caption || '',
          width: photo.width,
          height: photo.height,
          takenAt: photo.takenAt?.toISOString() || null,
          featured: photo.featured,
          tags: photo.tags,
          imageUrl: `/data/live/${displayName}`,
          thumbnailUrl: `/data/live/${thumbnailName}`,
        });
      } catch (error) {
        console.warn(`[StaticSnapshot] 相册照片 ${photo.id} 无法打包，已跳过:`, (error as Error).message);
      }
    }
    return publicPhotos;
  }

  /** 含视频引用的文章整篇排除出静态快照（详见 postContentHasVideoMedia）。 */
  private static excludeVideoPosts(
    posts: SnapshotSourcePost[],
    nowMs: number,
  ): { publishablePosts: SnapshotSourcePost[]; videoExcludedCount: number } {
    const publishablePosts: SnapshotSourcePost[] = [];
    let videoExcludedCount = 0;
    for (const post of posts) {
      const content = typeof post.id === 'string' ? cacheService.postContents.get(post.id) : undefined;
      if (
        isSnapshotContentEligible(post, nowMs)
        && typeof content === 'string'
        && postContentHasVideoMedia(content)
      ) {
        videoExcludedCount += 1;
        continue;
      }
      publishablePosts.push(post);
    }
    return { publishablePosts, videoExcludedCount };
  }

  private static async prepareStaticImageContents(posts: SnapshotSourcePost[], nowMs: number) {
    const eligibleContents = new Map<string, string>();
    for (const post of posts) {
      if (!isSnapshotContentEligible(post, nowMs) || typeof post.id !== 'string') continue;
      const content = cacheService.postContents.get(post.id);
      if (typeof content === 'string' && content.trim().length > 0) eligibleContents.set(post.id, content);
    }

    return bundleStaticSnapshotImages(eligibleContents, {
      cacheDir: path.resolve(
        process.cwd(),
        'cache_data/static-images',
        feishuEnvironmentCacheSegment(),
      ),
      concurrency: 2,
      backendUrl: config.backendUrl,
      readLocalImage: async fileName => (await readLocalImage(fileName)).buffer,
      downloadImage: async token => {
        if (!feishuClient) throw new Error('飞书客户端未初始化');
        const response = await feishuClient.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/drive/v1/medias/${token}/download`,
          responseType: 'arraybuffer',
          timeout: 15_000,
        });
        const buffer = toImageBuffer(response);
        if (!buffer) throw new Error('飞书图片响应不是二进制内容');
        return buffer;
      },
    });
  }

  private static async refreshEligibleContents(posts: SnapshotSourcePost[], nowMs: number): Promise<void> {
    const refreshIntervalMs = config.staticSnapshot.contentRefreshMinutes * 60 * 1000;
    const missingContentRetryMs = 5 * 60 * 1000;
    let cacheChanged = false;

    for (const post of posts) {
      if (!isSnapshotContentEligible(post, nowMs) || typeof post.id !== 'string') continue;

      const currentContent = cacheService.postContents.get(post.id);
      const lastAttempt = this.contentRefreshAttemptedAt.get(post.id) || 0;
      const refreshDue = refreshIntervalMs > 0 && nowMs - lastAttempt >= refreshIntervalMs;
      if (currentContent && !refreshDue) continue;
      if (!currentContent && lastAttempt > 0 && nowMs - lastAttempt < missingContentRetryMs) continue;
      if (typeof post.docId !== 'string' || post.docId.length === 0) continue;

      this.contentRefreshAttemptedAt.set(post.id, nowMs);
      try {
        const refreshed = await FeishuMarkdownParser.fetchDocContent(post.docId, post.id, post.isWiki === true);
        if (refreshed === null) {
          // Null denotes a fetch/resolve failure. Allow an earlier retry without
          // making healthy documents ignore the configured low-frequency TTL.
          this.contentRefreshAttemptedAt.set(post.id, nowMs - Math.max(0, refreshIntervalMs - missingContentRetryMs));
          continue;
        }

        if (refreshed.trim().length === 0) {
          if (cacheService.postContents.delete(post.id)) cacheChanged = true;
        } else if (refreshed !== currentContent) {
          cacheService.postContents.set(post.id, refreshed);
          cacheChanged = true;
        }
      } catch (error) {
        this.contentRefreshAttemptedAt.set(post.id, nowMs - Math.max(0, refreshIntervalMs - missingContentRetryMs));
        console.error(`[StaticSnapshot] 刷新文章正文失败 (${post.id})，保留上次成功内容:`, error);
      }
    }

    if (cacheChanged) await cacheService.savePostsCache();
  }
}
