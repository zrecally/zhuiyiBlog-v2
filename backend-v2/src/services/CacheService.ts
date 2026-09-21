import fs from 'fs';
import path from 'path';
import { ossClient } from '../core/OssClient';
import { buildStaticSnapshotPayloads, SnapshotSourcePost } from './static-snapshot/StaticSnapshotWriter';
import { feishuEnvironmentCacheSegment } from '../utils/FeishuEnvironment';

const CACHE_DIR = path.resolve(process.cwd(), 'cache_data');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
const environmentSegment = feishuEnvironmentCacheSegment();
const ENV_CACHE_DIR = environmentSegment ? path.resolve(CACHE_DIR, environmentSegment) : CACHE_DIR;
if (!fs.existsSync(ENV_CACHE_DIR)) {
  fs.mkdirSync(ENV_CACHE_DIR, { recursive: true });
}
const CACHE_FILE_PATH = path.resolve(ENV_CACHE_DIR, 'posts_cache.json');

export class CacheService {
  private static instance: CacheService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public postsCache: any = null;
  public lastCacheTime: number = 0;

  // 独立保存文章正文，避免 postsCache 过大
  public postContents: Map<string, string> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public configCache: any = null;
  public lastConfigCacheTime: number = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public friendsCache: any[] | null = null;
  public lastFriendsCacheTime: number = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public projectsCache: any[] | null = null;
  public lastProjectsCacheTime: number = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public timelineCache: any[] | null = null;
  public lastTimelineCacheTime: number = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public commentsCache: Record<string, any[]> = {};
  public commentsLastFetch: Record<string, number> = {};

  private constructor() {
    this.initPostsCache();
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private initPostsCache() {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      try {
        const fileData = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
        const parsedData = JSON.parse(fileData);
        if (parsedData && parsedData.posts && parsedData.config) {
          this.postsCache = parsedData;
          this.lastCacheTime = parsedData.lastCacheTime || Date.now();
          console.log(`[Cache] 系统启动: 成功从本地加载文章缓存 (共 ${parsedData.posts.length} 篇)`);
        }
      } catch (err) {
        console.error('[Cache] 加载本地缓存文件失败:', err);
      }
    }

    const contentsDir = path.resolve(ENV_CACHE_DIR, 'posts');
    if (fs.existsSync(contentsDir)) {
      try {
        const files = fs.readdirSync(contentsDir);
        for (const file of files) {
          if (file.endsWith('.txt')) {
            const postId = file.replace('.txt', '');
            const content = fs.readFileSync(path.resolve(contentsDir, file), 'utf-8');
            this.postContents.set(postId, content);
          }
        }
        console.log(`[Cache] 系统启动: 成功加载 ${this.postContents.size} 篇文章正文缓存`);
      } catch (err) {
        console.error('[Cache] 加载本地正文缓存失败:', err);
      }
    }
  }

  public async savePostsCache() {
    try {
      // 剥离 content
      const lightweightData = {
        ...this.postsCache,
        posts: this.postsCache?.posts?.map((p: any) => {
          const { content, ...rest } = p;
          return rest;
        }) || []
      };

      // 异步写入列表文件
      await fs.promises.writeFile(CACHE_FILE_PATH, JSON.stringify(lightweightData));

      // 异步写入正文文件
      const contentsDir = path.resolve(ENV_CACHE_DIR, 'posts');
      if (!fs.existsSync(contentsDir)) {
        await fs.promises.mkdir(contentsDir, { recursive: true });
      }
      for (const [postId, content] of this.postContents.entries()) {
        await fs.promises.writeFile(path.resolve(contentsDir, `${postId}.txt`), content);
      }

      // 同步到 OSS，用于 CDN 边缘加速
      if (this.postsCache && this.postsCache.posts && ossClient.isConfigured) {
        this.syncToOss(); // 保持后台异步执行
      }
    } catch (e) {
      console.error("写入缓存到磁盘失败", e);
    }
  }

  private async syncToOss() {
    try {
      // OSS 与北京静态快照共用同一个公开数据边界：仅发布已到时间、
      // 明确非私密且正文存在的文章，并使用字段白名单移除 docId/内部配置。
      const payloads = buildStaticSnapshotPayloads(
        this.postsCache.posts as SnapshotSourcePost[],
        this.postContents,
        this.configCache || this.postsCache.config,
      );
      const listBuffer = Buffer.from(JSON.stringify(payloads.postsList), 'utf-8');
      await ossClient.uploadBuffer('cache/posts_list.json', listBuffer, 'application/json');

      // 2. 仅上传通过相同安全筛选的正文。
      for (const [postId, contentPayload] of payloads.postContents) {
        const contentBuffer = Buffer.from(JSON.stringify(contentPayload), 'utf-8');
        await ossClient.uploadBuffer(`cache/post_${postId}.json`, contentBuffer, 'application/json');
      }
      console.log(`[Cache] ✅ 成功将 ${payloads.postCount} 篇公开文章缓存同步到 OSS`);
    } catch (err) {
      console.error('[Cache] ❌ 同步缓存到 OSS 失败:', err);
    }
  }
}

export const cacheService = CacheService.getInstance();
