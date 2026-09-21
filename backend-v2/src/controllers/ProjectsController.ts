import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { cacheService } from '../services/CacheService';
import { FeishuMarkdownParser } from '../services/FeishuMarkdownParser';
import { FeishuBaseSyncService } from '../services/feishu-sync/FeishuBaseSyncService';
import { filterFeishuRecordsForCurrentEnvironment } from '../utils/FeishuEnvironment';
import { prisma } from '../core/Database';
import { detectSupportedImageType } from '../utils/ImageFileUtils';

const PROJECT_COVER_MAX_BYTES = 5 * 1024 * 1024;
const PROJECT_COVER_CACHE_TTL_MS = 5 * 60 * 1000;
const PROJECT_COVER_CACHE_MAX_ITEMS = 24;

type CachedProjectCover = {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
};

const readLimitedStream = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.length;
    if (total > PROJECT_COVER_MAX_BYTES) {
      if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
      throw new Error('项目封面附件超过 5 MiB');
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new Error('项目封面附件为空');
  return Buffer.concat(chunks, total);
};

export class ProjectsController {
  private static coverFieldId: string | null | undefined;
  private static coverFieldLookup: Promise<string | null> | null = null;
  private static coverCache = new Map<string, CachedProjectCover>();

  private static async getCoverFieldId(): Promise<string | null> {
    if (this.coverFieldId !== undefined) return this.coverFieldId;
    if (this.coverFieldLookup) return this.coverFieldLookup;

    this.coverFieldLookup = (async () => {
      try {
        const response = await feishuClient!.bitable.appTableField.list({
          path: {
            app_token: config.feishu.baseToken,
            table_id: config.feishu.tables.projects,
          },
          params: { page_size: 100 },
        });
        if (response.code !== 0) {
          throw new Error(`${response.code}: ${response.msg}`);
        }
        const coverField = (response.data?.items || []).find(field => field.field_name === 'Cover');
        this.coverFieldId = coverField?.ui_type === 'Attachment' && coverField.field_id
          ? coverField.field_id
          : null;
      } catch (error) {
        console.error('[Feishu] 读取项目封面字段失败:', error);
        this.coverFieldId = null;
      } finally {
        this.coverFieldLookup = null;
      }
      return this.coverFieldId;
    })();

    return this.coverFieldLookup;
  }

  private static projectCoverUrl(recordId: string, cover: unknown, coverFieldId: string | null): string {
    const attachmentToken = FeishuBaseSyncService.attachmentToken(cover);
    if (attachmentToken && coverFieldId) {
      return `/api/v1/projects/covers/${encodeURIComponent(recordId)}/${encodeURIComponent(attachmentToken)}`;
    }

    // Compatibility for existing Hyperlink-type Cover fields.
    if (typeof cover === 'string') return /^https?:\/\//i.test(cover) ? cover : '';
    if (cover && typeof cover === 'object' && !Array.isArray(cover)) {
      const link = (cover as Record<string, unknown>).link;
      return typeof link === 'string' && /^https?:\/\//i.test(link) ? link : '';
    }
    return '';
  }

  private static async getProjectCover(recordId: string, fileToken: string): Promise<CachedProjectCover> {
    const cacheKey = `${recordId}:${fileToken}`;
    const cached = this.coverCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const coverFieldId = await this.getCoverFieldId();
    if (!coverFieldId || !feishuClient || !config.feishu.baseToken || !config.feishu.tables.projects) {
      throw new Error('项目封面附件字段未配置');
    }

    const extra = JSON.stringify({
      bitablePerm: {
        tableId: config.feishu.tables.projects,
        attachments: { [coverFieldId]: { [recordId]: [fileToken] } },
      },
    });
    const download = await feishuClient.drive.media.download({
      path: { file_token: fileToken },
      params: { extra },
    });
    const buffer = await readLimitedStream(download.getReadableStream());
    const image = detectSupportedImageType(buffer);
    if (!image) throw new Error('项目封面附件不是受支持的图片');

    const result = { buffer, mimeType: image.mimeType, expiresAt: Date.now() + PROJECT_COVER_CACHE_TTL_MS };
    this.coverCache.delete(cacheKey);
    this.coverCache.set(cacheKey, result);
    while (this.coverCache.size > PROJECT_COVER_CACHE_MAX_ITEMS) {
      const oldestKey = this.coverCache.keys().next().value;
      if (!oldestKey) break;
      this.coverCache.delete(oldestKey);
    }
    return result;
  }

  private static async checkIsHidden(res: Response): Promise<boolean> {
    const navLinksConfig = await prisma.systemConfig.findUnique({
      where: { key: 'navLinks' }
    });
    const navLinksStr = navLinksConfig?.value || '';
    const hiddenLinks = navLinksStr.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    if (hiddenLinks.some(link => ['站外工具', 'External Tools', '项目', 'Projects'].includes(link))) {
      res.status(404).json({ success: false, message: '此功能已关闭或隐藏' });
      return true;
    }
    return false;
  }

  private static async loadProjects(forceRefresh = false): Promise<any[]> {
    if (!forceRefresh && Array.isArray(cacheService.projectsCache)) {
      return cacheService.projectsCache;
    }
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.projects) {
      if (config.feishu.dataEnvironment === 'Test' && !config.feishu.appId && !config.feishu.appSecret) {
        return [];
      }
      throw new Error('未配置项目集 Feishu Table ID');
    }

    if (forceRefresh) {
      cacheService.projectsCache = null;
      cacheService.lastProjectsCacheTime = 0;
    }

    if (!cacheService.projectsCache) {
      // 1. 初次全量拉取
      console.log('[Feishu] 正在全量拉取项目集 Table...');
      const coverFieldId = await this.getCoverFieldId();
      const response = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.projects
        }
      });

      const parsedProjectsPromises = filterFeishuRecordsForCurrentEnvironment(response.data?.items || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((record: any) => record.fields && Object.keys(record.fields).length > 0) // 过滤掉飞书默认的空行
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map(async (record: any) => {
          const fields = record.fields;

          // 解析文档链接 (兼容 Docs 或 Doc_Link)
          let docLink = '';
          if (fields['Docs']) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              docLink = typeof fields['Docs'] === 'object' ? (fields['Docs'] as any).link : fields['Docs'];
          } else if (fields['Doc_Link']) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              docLink = typeof fields['Doc_Link'] === 'object' ? (fields['Doc_Link'] as any).link : fields['Doc_Link'];
          }

          let content = '';
          if (docLink) {
              let docId = '';
              let isWiki = false;
              const matchDocx = docLink.match(/docx\/([a-zA-Z0-9]+)/);
              if (matchDocx && matchDocx[1]) {
                  docId = matchDocx[1];
              } else {
                  const matchWiki = docLink.match(/wiki\/([a-zA-Z0-9]+)/);
                  if (matchWiki && matchWiki[1]) {
                      docId = matchWiki[1];
                      isWiki = true;
                  }
              }
              if (docId) {
                  try {
                      // 动态抓取该项目的飞书文档正文
                      const md = await FeishuMarkdownParser.fetchDocContent(docId, record.record_id, isWiki);
                      if (md) {
                          content = md;
                      }
                  } catch (err) {
                      console.error(`获取项目(${record.record_id})文档正文失败:`, err);
                  }
              }
          }

          return {
            id: record.record_id,
            name: fields['Name'] ? String(fields['Name']) : '未命名项目',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            link: fields['Link'] ? String((fields['Link'] as any)?.link || fields['Link']) : '',
            cover: ProjectsController.projectCoverUrl(record.record_id, fields['Cover'], coverFieldId),
            description: fields['Description'] ? String(fields['Description']) : '',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tags: Array.isArray(fields['Tags']) ? fields['Tags'].map((t: any) => typeof t === 'string' ? t : t.name || String(t)) : [],
            status: fields['Status'] ? String(fields['Status']) : '',
            isPublished: fields['Published'] !== false, // 默认发布
            content
          };
        });

      const parsedProjects = await Promise.all(parsedProjectsPromises);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      cacheService.projectsCache = parsedProjects.filter(p => p.isPublished).map(({ isPublished, ...rest }) => rest);
      cacheService.lastProjectsCacheTime = Date.now();
      console.log(`[Feishu] 项目集全量拉取成功，共 ${cacheService.projectsCache.length} 条`);
    }

    return cacheService.projectsCache;
  }

  /** 供控制面同步按钮使用：强制读取飞书项目集并刷新动态站缓存。 */
  public static async refreshProjectsCache(): Promise<any[]> {
    return ProjectsController.loadProjects(true);
  }

  /**
   * Produces a static-site-safe project snapshot. Attachment covers are copied
   * into the immutable snapshot instead of leaving Beijing to request the
   * intentionally unavailable dynamic `/api` endpoint.
   */
  public static async prepareStaticProjects(imageFiles: Map<string, Buffer>): Promise<any[]> {
    const projects = await ProjectsController.loadProjects();
    return Promise.all(projects.map(async project => {
      const sourceCover = typeof project.cover === 'string' ? project.cover : '';
      const attachmentPath = sourceCover.match(/^\/api\/v1\/projects\/covers\/(rec[A-Za-z0-9]+)\/([A-Za-z0-9_-]{1,256})$/);
      if (!attachmentPath) {
        // An external HTTPS cover remains usable when it is already public.
        // No internal API URL may enter the Beijing static package.
        return sourceCover.startsWith('/api/') ? { ...project, cover: '' } : project;
      }

      try {
        const image = await ProjectsController.getProjectCover(attachmentPath[1], attachmentPath[2]);
        const extension = detectSupportedImageType(image.buffer)?.extension;
        if (!extension) throw new Error('项目封面格式无效');
        const hash = createHash('sha256').update(image.buffer).digest('hex');
        const relativeName = `images/${hash}.${extension}`;
        imageFiles.set(relativeName, image.buffer);
        return { ...project, cover: `/data/live/${relativeName}` };
      } catch (error) {
        console.warn(`[StaticSnapshot] 项目 ${project.id} 的附件封面无法打包，已忽略:`, error instanceof Error ? error.message : error);
        return { ...project, cover: '' };
      }
    }));
  }

  public static async handleGet0(req: Request, res: Response) {
    if (await ProjectsController.checkIsHidden(res)) return;

    try {
      const projects = await ProjectsController.loadProjects();
      return res.json({ success: true, data: projects });
    } catch (error) {
      console.error('❌ 获取 Feishu 项目集数据失败:', error);
      return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '从 Feishu 获取项目集数据失败' });
    }
  }

  /** 公开项目封面的受控读取。飞书附件 URL 会过期且不可直接暴露给浏览器。 */
  public static async handleGetCover(req: Request, res: Response) {
    const recordId = String(req.params.recordId || '');
    const fileToken = String(req.params.fileToken || '');
    if (!/^rec[A-Za-z0-9]+$/.test(recordId) || !/^[A-Za-z0-9_-]{1,256}$/.test(fileToken)) {
      return res.status(404).send('Image not found');
    }

    try {
      const image = await ProjectsController.getProjectCover(recordId, fileToken);
      res.set({
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=300',
        'Content-Type': image.mimeType,
        'Content-Length': image.buffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(image.buffer);
    } catch (error) {
      console.error('[Projects] 读取项目封面失败:', error instanceof Error ? error.message : error);
      return res.status(404).send('Image not found');
    }
  }

}
