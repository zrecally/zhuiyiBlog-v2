import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { StaticImageReport } from './StaticSnapshotImages';
import { detectSupportedImageType } from '../../utils/ImageFileUtils';
import { detectSupportedFontType } from '../../utils/LocalFontStorage';

export interface SnapshotSourcePost {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  image?: unknown;
  date?: unknown;
  slug?: unknown;
  category?: unknown;
  tags?: unknown;
  isPrivate?: unknown;
  accessMode?: unknown;
  showLockedMetadata?: unknown;
  isPublished?: unknown;
  views?: unknown;
  [key: string]: unknown;
}

export interface StaticSnapshotInput {
  outputDir: string;
  posts: SnapshotSourcePost[];
  postContents: ReadonlyMap<string, string>;
  imageFiles?: ReadonlyMap<string, Buffer>;
  siteConfig?: unknown;
  siteCompliance?: {
    enabled: true;
    icpNumber: string;
    policeNumber: string;
    policeRecordCode: string;
  };
  timeline?: unknown[];
  friends?: unknown[];
  album?: unknown[];
  projects?: unknown[];
  i18n?: unknown;
  now?: Date;
  retainReleases?: number;
  imageReport?: StaticImageReport;
}

export interface StaticSnapshotResult {
  version: string;
  releaseDir: string;
  currentDir: string;
  postCount: number;
  skippedCount: number;
  changed: boolean;
}

export interface StaticSnapshotPayloads {
  postsList: {
    success: true;
    data: {
      posts: PublicSnapshotPost[];
      config: Record<string, string>;
      lastCacheTime: number;
    };
  };
  postContents: Map<string, { success: true; content: string; isPrivate: false }>;
  postCount: number;
  skippedCount: number;
}

export interface PublicSnapshotPost {
  id: string;
  title: string;
  summary: string;
  image: string;
  date: string;
  slug: string;
  category: string;
  tags: string[];
  isPrivate: boolean;
  accessMode: 'public' | 'password';
  views: number;
}

interface FileDigest {
  sha256: string;
  bytes: number;
}

const RELEASE_NAME_PATTERN = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const SAFE_POST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_IMAGE_FILE_PATTERN = /^images\/([a-f0-9]{64})\.(jpg|png|gif|webp)$/;
const SAFE_FONT_FILE_PATTERN = /^fonts\/([a-f0-9]{64})\.(ttf|woff|woff2)$/;
const SAFE_LOCAL_IMAGE_URL_PATTERN = /^\/data\/live\/images\/[a-f0-9]{64}\.(jpg|png|gif|webp)$/;
const MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 2000;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const STATIC_SITE_URL = 'https://cn.hizhuiyi.cn';
const DYNAMIC_SITE_URL = 'https://www.hizhuiyi.cn';
const SAFE_STATIC_SEO_FILE_PATTERN = /^seo\/(?:sitemap\.xml|[A-Za-z0-9_-]+\.html)$/;

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function digest(buffer: Buffer): FileDigest {
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.byteLength,
  };
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeViews(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

interface PublicSnapshotProject {
  id: string;
  name: string;
  link: string;
  cover: string;
  description: string;
  content: string;
  tags: string[];
  status: string;
}

function toPublicProject(value: unknown): PublicSnapshotProject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const project = value as Record<string, unknown>;
  const id = stringValue(project.id).trim();
  if (!/^rec[A-Za-z0-9]+$/.test(id)) return null;

  const link = stringValue(project.link).trim();
  const cover = stringValue(project.cover).trim();
  const safeHttpUrl = (candidate: string) => /^https:\/\//i.test(candidate) ? candidate : '';
  const safeStaticImage = /^\/data\/live\/images\/[a-f0-9]{64}\.(jpg|png|gif|webp)$/.test(cover) ? cover : '';

  return {
    id,
    name: stringValue(project.name, '未命名项目').trim().slice(0, 160) || '未命名项目',
    link: safeHttpUrl(link),
    cover: safeStaticImage || safeHttpUrl(cover),
    description: stringValue(project.description).slice(0, 4_000),
    content: stringValue(project.content).slice(0, 200_000),
    tags: Array.isArray(project.tags)
      ? project.tags.map(item => stringValue(item).trim().slice(0, 40)).filter(Boolean).slice(0, 24)
      : [],
    status: stringValue(project.status).trim().slice(0, 80),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function escapeXml(value: unknown): string {
  return escapeHtml(value);
}

function staticAbsoluteUrl(pathname: string): string {
  return new URL(pathname, `${STATIC_SITE_URL}/`).toString();
}

function safeSeoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed, STATIC_SITE_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function renderSeoInline(markdown: string): string {
  let rendered = escapeHtml(markdown);
  rendered = rendered.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (_match, alt: string, source: string) => {
    const imageUrl = safeSeoUrl(source);
    return imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" loading="lazy">` : escapeHtml(alt);
  });
  rendered = rendered.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (_match, label: string, source: string) => {
    const href = safeSeoUrl(source);
    return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>` : label;
  });
  rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>');
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  rendered = rendered.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  rendered = rendered.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return rendered;
}

/**
 * This small renderer deliberately handles only safe Markdown structure. It is
 * used for the no-JavaScript SEO copy served to crawlers; the interactive site
 * continues to use the richer client Markdown renderer. Raw HTML is escaped.
 */
function renderSeoMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) output.push(`<p>${paragraph.map(renderSeoInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listType && listItems.length > 0) output.push(`<${listType}>${listItems.map(item => `<li>${renderSeoInline(item)}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderSeoInline(heading[2])}</h${level}>`);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${renderSeoInline(quote[1])}</blockquote>`);
      continue;
    }
    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (list) {
      flushParagraph();
      const nextType: 'ul' | 'ol' = list[2] ? 'ol' : 'ul';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push(list[3]);
      continue;
    }

    const tableSeparator = lines[index + 1];
    if (line.includes('|') && tableSeparator && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(tableSeparator)) {
      flushParagraph();
      flushList();
      const columns = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = columns(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(columns(lines[index]));
        index += 1;
      }
      index -= 1;
      output.push(`<table><thead><tr>${headers.map(cell => `<th>${renderSeoInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_header, column) => `<td>${renderSeoInline(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    paragraph.push(line.trim());
  }

  if (inCodeBlock) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph();
  flushList();
  return output.join('\n');
}

function seoDate(value: string): string {
  const parsed = parseSnapshotPublishTime(value);
  return parsed === null ? '' : new Date(parsed).toISOString();
}

function localizedImageValue(value: unknown): string {
  return typeof value === 'string' && SAFE_LOCAL_IMAGE_URL_PATTERN.test(value) ? value : '';
}

function isAboutPost(post: SnapshotSourcePost): boolean {
  if (typeof post.title !== 'string') return false;
  const title = post.title.trim().toLocaleLowerCase();
  return title === '关于' || title === 'about';
}

/**
 * Feishu post dates are currently cached as Beijing-local `YYYY-MM-DD HH:mm`.
 * Invalid or missing dates are deliberately rejected so an ambiguous article can
 * never become public through the static channel.
 */
export function parseSnapshotPublishTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') return null;

  const localMatch = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (localMatch) {
    const year = Number(localMatch[1]);
    const month = Number(localMatch[2]);
    const day = Number(localMatch[3]);
    const hour = Number(localMatch[4] || '0');
    const minute = Number(localMatch[5] || '0');
    const second = Number(localMatch[6] || '0');

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }

    const utcTime = Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_UTC_OFFSET_MS;
    const localCheck = new Date(utcTime + BEIJING_UTC_OFFSET_MS);
    if (
      localCheck.getUTCFullYear() !== year
      || localCheck.getUTCMonth() !== month - 1
      || localCheck.getUTCDate() !== day
      || localCheck.getUTCHours() !== hour
      || localCheck.getUTCMinutes() !== minute
      || localCheck.getUTCSeconds() !== second
    ) {
      return null;
    }
    return utcTime;
  }

  // Accept an explicit ISO-8601 timezone, but never a timezone-less free-form date.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    const parsed = Date.parse(value.trim());
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function isSnapshotMetadataEligible(post: SnapshotSourcePost, nowMs: number): boolean {
  if (post.isPublished !== true) return false;
  // The domestic release is public static content only. Password/approval
  // metadata would require an interactive access flow and must stay overseas.
  if (post.isPrivate !== false || post.accessMode === 'password') return false;
  if (typeof post.id !== 'string' || !SAFE_POST_ID_PATTERN.test(post.id)) return false;
  const publishTime = parseSnapshotPublishTime(post.date);
  // “关于”是一个明确发布状态的 singleton page rather than a scheduled
  // article. It may omit the chronological Date field without weakening the
  // fail-closed date rule for normal posts.
  if (publishTime === null) return isAboutPost(post);
  return publishTime <= nowMs;
}

export function isSnapshotContentEligible(post: SnapshotSourcePost, nowMs: number): boolean {
  return isSnapshotMetadataEligible(post, nowMs)
    && post.isPrivate === false
    && post.accessMode !== 'password';
}

// 平台视频页与直链视频文件在静态站被合规边界完全禁用（无 iframe、无外部媒体、
// 无视频文件槽位），嵌进来也只会渲染成空转的播放器卡片。检测到视频引用的文章
// 整篇排除出快照；平台清单与前端 MarkdownContent.renderMediaEmbed 的视频子集对齐。
const VIDEO_MEDIA_PATTERN = new RegExp(
  [
    'youtube\\.com/watch',
    'youtu\\.be/',
    'bilibili\\.com/video',
    'vimeo\\.com/\\d',
    'https?://\\S+\\.(?:mp4|webm|m3u8|ogg)(?:[?#]\\S*)?(?=$|[\\s)\\]}>"\'])',
    '<video[\\s>]',
  ].join('|'),
  'i',
);

export function postContentHasVideoMedia(content: string): boolean {
  if (typeof content !== 'string' || content.length === 0) return false;
  // 飞书导出的 markdown 链接 href 是百分号编码形态，须解码后再匹配；
  // 畸形编码容忍为"不匹配"。
  const samples = [content];
  try {
    samples.push(decodeURIComponent(content));
  } catch {
    // keep raw sample only
  }
  return samples.some(sample => VIDEO_MEDIA_PATTERN.test(sample));
}

function toPublicPost(post: SnapshotSourcePost): PublicSnapshotPost {
  const id = stringValue(post.id);
  return {
    id,
    title: stringValue(post.title, '无标题'),
    summary: stringValue(post.summary),
    // A remote cover would silently reintroduce an OSS/CDN dependency on the
    // Beijing build. Only already bundled, content-addressed paths survive.
    image: localizedImageValue(post.image),
    date: stringValue(post.date),
    slug: stringValue(post.slug),
    category: stringValue(post.category, '未分类'),
    tags: Array.isArray(post.tags) ? post.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    isPrivate: false,
    accessMode: 'public',
    views: safeViews(post.views),
  };
}

function toPublicSiteConfig(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const publicConfig: Record<string, string> = {
    title: stringValue(source.title, 'ZhuiYi 博客'),
    subtitle: stringValue(source.subtitle),
    description: stringValue(source.description),
    avatar: localizedImageValue(source.avatar),
  };

  for (const key of [
    'github',
    'twitter',
    'telegram',
    'email',
    'navlinks',
    'custom_font_url',
    // This token is intentionally public: Baidu reads it from the HTML meta
    // tag to verify ownership of the Beijing static site.
    'baidu_site_verification',
  ] as const) {
    if (typeof source[key] === 'string') publicConfig[key] = source[key];
  }
  return publicConfig;
}

function publicHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function toPublicTimeline(value: unknown, nowMs: number): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = stringValue(item.id);
  const date = stringValue(item.date);
  const publishTime = parseSnapshotPublishTime(date);
  if (!SAFE_POST_ID_PATTERN.test(id) || publishTime === null || publishTime > nowMs) return null;
  return {
    id,
    title: stringValue(item.title, '无标题'),
    summary: stringValue(item.summary),
    date,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    category: 'Timeline',
    image: localizedImageValue(item.image),
  };
}

function toPublicFriend(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = stringValue(item.id);
  const name = stringValue(item.name);
  if (!SAFE_POST_ID_PATTERN.test(id) || !name) return null;
  return {
    id,
    name,
    link: publicHttpUrl(item.link),
    // Only images already localized by StaticSnapshotService may enter a
    // public snapshot. Unapproved or failed remote avatars become empty and
    // the frontend uses its bundled placeholder.
    avatar: localizedImageValue(item.avatar),
    description: stringValue(item.description),
    order: safeViews(item.order),
  };
}

function toPublicAlbumPhoto(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = stringValue(item.id);
  const imageUrl = localizedImageValue(item.imageUrl);
  const thumbnailUrl = localizedImageValue(item.thumbnailUrl);
  const width = Number(item.width);
  const height = Number(item.height);
  if (
    !SAFE_POST_ID_PATTERN.test(id)
    || !imageUrl
    || !thumbnailUrl
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) return null;

  return {
    id,
    title: stringValue(item.title, '生活随拍').slice(0, 120),
    caption: stringValue(item.caption).slice(0, 500),
    width,
    height,
    takenAt: typeof item.takenAt === 'string' ? item.takenAt : null,
    featured: item.featured === true,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12)
      : [],
    imageUrl,
    thumbnailUrl,
  };
}

/**
 * The single public-data boundary used by both filesystem snapshots and OSS.
 * New fields added to Feishu/cache objects remain private until explicitly
 * whitelisted here.
 */
export function buildStaticSnapshotPayloads(
  posts: SnapshotSourcePost[],
  postContents: ReadonlyMap<string, string>,
  siteConfig: unknown,
  now: Date = new Date(),
): StaticSnapshotPayloads {
  if (Number.isNaN(now.getTime())) throw new Error('静态快照生成时间无效');

  const nowMs = now.getTime();
  const publicPosts: PublicSnapshotPost[] = [];
  const publicContents = new Map<string, { success: true; content: string; isPrivate: false }>();
  let latestPublishTime = 0;

  for (const post of posts) {
    if (!isSnapshotMetadataEligible(post, nowMs)) continue;
    const id = stringValue(post.id);
    if (isSnapshotContentEligible(post, nowMs)) {
      const content = postContents.get(id);
      if (typeof content !== 'string' || content.trim().length === 0) continue;
      publicContents.set(id, { success: true, content, isPrivate: false });
    }
    publicPosts.push(toPublicPost(post));
    latestPublishTime = Math.max(latestPublishTime, parseSnapshotPublishTime(post.date) || 0);
  }

  return {
    postsList: {
      success: true,
      data: {
        posts: publicPosts,
        config: toPublicSiteConfig(siteConfig),
        // Keep the public payload byte-stable when a periodic Feishu poll finds no
        // content change. The newest included publish time changes only when the
        // visible article set changes and remains compatible with legacy clients.
        lastCacheTime: latestPublishTime,
      },
    },
    postContents: publicContents,
    postCount: publicPosts.length,
    skippedCount: posts.length - publicPosts.length,
  };
}

/**
 * Creates crawler-facing HTML copies of public article content. They live in
 * the private snapshot input until the Beijing release script validates and
 * installs them. Password and approval-only articles are intentionally absent.
 */
export function buildStaticSeoFiles(payloads: StaticSnapshotPayloads): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const config = payloads.postsList.data.config;
  const siteTitle = stringValue(config.title, 'ZhuiYi 博客');
  const siteDescription = stringValue(config.description || config.subtitle, '记录技术、项目与日常思考。');
  const verification = stringValue(config.baidu_site_verification).trim().slice(0, 256);
  const urls: Array<{ loc: string; lastmod?: string; changefreq: string; priority: string }> = [
    { loc: staticAbsoluteUrl('/'), changefreq: 'daily', priority: '1.0' },
    { loc: staticAbsoluteUrl('/posts'), changefreq: 'daily', priority: '0.9' },
    { loc: staticAbsoluteUrl('/projects'), changefreq: 'weekly', priority: '0.7' },
    { loc: staticAbsoluteUrl('/timeline'), changefreq: 'weekly', priority: '0.6' },
    { loc: staticAbsoluteUrl('/album'), changefreq: 'weekly', priority: '0.6' },
    { loc: staticAbsoluteUrl('/friends'), changefreq: 'monthly', priority: '0.4' },
    { loc: staticAbsoluteUrl('/about'), changefreq: 'monthly', priority: '0.5' },
  ];

  for (const post of payloads.postsList.data.posts) {
    const contentPayload = payloads.postContents.get(post.id);
    if (!contentPayload) continue;
    const canonicalUrl = staticAbsoluteUrl(`/posts/${encodeURIComponent(post.id)}`);
    const publishedTime = seoDate(post.date);
    const articleDescription = post.summary || siteDescription;
    const coverImage = post.image ? staticAbsoluteUrl(post.image) : '';
    const seoMarkup = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <title>${escapeHtml(post.title)} - ${escapeHtml(siteTitle)}</title>
  <meta name="description" content="${escapeHtml(articleDescription)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteTitle)} RSS" href="${DYNAMIC_SITE_URL}/api/v1/feed/rss">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escapeHtml(siteTitle)}">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(articleDescription)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  ${coverImage ? `<meta property="og:image" content="${escapeHtml(coverImage)}">` : ''}
  ${publishedTime ? `<meta property="article:published_time" content="${escapeHtml(publishedTime)}">` : ''}
  <meta name="twitter:card" content="${coverImage ? 'summary_large_image' : 'summary'}">
  ${verification ? `<meta name="baidu-site-verification" content="${escapeHtml(verification)}">` : ''}
  <style>
    :root { color-scheme: light; } body { margin: 0; color: #292724; background: #fcfaf6; font: 17px/1.85 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 56px 24px 80px; } a { color: #b85c4b; } header { margin-bottom: 42px; } h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.25; margin: 0 0 14px; } h2, h3 { line-height: 1.35; margin-top: 2.2em; } .meta { color: #7c746c; font-size: 14px; } .summary { color: #605950; font-size: 19px; } img { max-width: 100%; height: auto; border-radius: 8px; } pre { overflow: auto; padding: 16px; background: #f1eee7; border-radius: 8px; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; } blockquote { margin: 1.5em 0; padding: .5em 1em; border-left: 3px solid #b8d8c8; color: #5d655f; background: #f6f8f4; } table { width: 100%; border-collapse: collapse; margin: 1.5em 0; } th, td { border: 1px solid #ddd7cd; padding: 8px 10px; text-align: left; } th { background: #f3efe8; } footer { margin-top: 64px; color: #847d73; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <header>
      <p><a href="${STATIC_SITE_URL}/">${escapeHtml(siteTitle)}</a> · <a href="${STATIC_SITE_URL}/posts">文章</a></p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="meta">${escapeHtml(post.date)}${post.category ? ` · ${escapeHtml(post.category)}` : ''}</p>
      ${post.summary ? `<p class="summary">${escapeHtml(post.summary)}</p>` : ''}
    </header>
    <article>${renderSeoMarkdown(contentPayload.content)}</article>
    <footer><a href="${STATIC_SITE_URL}/posts">返回文章列表</a></footer>
  </main>
</body>
</html>
`;
    files.set(`seo/${post.id}.html`, Buffer.from(seoMarkup, 'utf8'));
    urls.push({
      loc: canonicalUrl,
      lastmod: publishedTime || undefined,
      changefreq: 'monthly',
      priority: '0.8',
    });
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `<lastmod>${escapeXml(url.lastmod)}</lastmod>` : ''}<changefreq>${url.changefreq}</changefreq><priority>${url.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  files.set('seo/sitemap.xml', Buffer.from(sitemap, 'utf8'));
  return files;
}

function makeVersion(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, '');
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

function assertSafeOutputDir(outputDir: string): string {
  const resolved = path.resolve(outputDir);
  if (resolved === path.parse(resolved).root) {
    throw new Error('静态快照输出目录不能是文件系统根目录');
  }
  return resolved;
}

function hasSameFileDigests(value: unknown, expected: Record<string, FileDigest>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const actualNames = Object.keys(actual).sort();
  const expectedNames = Object.keys(expected).sort();
  if (actualNames.length !== expectedNames.length) return false;

  return expectedNames.every((fileName, index) => {
    if (actualNames[index] !== fileName) return false;
    const digestValue = actual[fileName];
    if (!digestValue || typeof digestValue !== 'object' || Array.isArray(digestValue)) return false;
    const record = digestValue as Record<string, unknown>;
    return record.sha256 === expected[fileName].sha256 && record.bytes === expected[fileName].bytes;
  });
}

async function verifyCurrentReleaseFiles(
  releaseDir: string,
  expectedFiles: Record<string, FileDigest>,
): Promise<boolean> {
  const actualFiles: string[] = [];
  const pendingDirectories: Array<{ absolute: string; relative: string }> = [
    { absolute: releaseDir, relative: '' },
  ];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()!;
    const entries = await fs.promises.readdir(directory.absolute, { withFileTypes: true });
    for (const entry of entries) {
      const relativeName = directory.relative
        ? path.posix.join(directory.relative, entry.name)
        : entry.name;
      const absoluteName = path.join(directory.absolute, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push({ absolute: absoluteName, relative: relativeName });
      } else if (entry.isFile()) {
        actualFiles.push(relativeName);
        if (actualFiles.length > Object.keys(expectedFiles).length + 1) return false;
      } else {
        // Symlinks, sockets, devices and other special entries are never a valid
        // previously generated release.
        return false;
      }
    }
  }

  const expectedNames = [...Object.keys(expectedFiles), 'manifest.json'].sort();
  actualFiles.sort();
  if (
    actualFiles.length !== expectedNames.length
    || !expectedNames.every((fileName, index) => actualFiles[index] === fileName)
  ) return false;

  for (const [fileName, expected] of Object.entries(expectedFiles)) {
    const buffer = await fs.promises.readFile(path.join(releaseDir, ...fileName.split('/')));
    if (buffer.byteLength !== expected.bytes || digest(buffer).sha256 !== expected.sha256) return false;
  }
  return true;
}

async function findUnchangedCurrentRelease(
  releasesDir: string,
  currentDir: string,
  expectedFiles: Record<string, FileDigest>,
): Promise<{ version: string; releaseDir: string } | null> {
  try {
    const releaseDir = await fs.promises.realpath(currentDir);
    const relativeRelease = path.relative(releasesDir, releaseDir);
    if (
      !relativeRelease
      || path.isAbsolute(relativeRelease)
      || relativeRelease.startsWith(`..${path.sep}`)
      || relativeRelease.includes(path.sep)
      || !RELEASE_NAME_PATTERN.test(relativeRelease)
    ) {
      return null;
    }

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(releaseDir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (typeof manifest.version !== 'string' || manifest.version !== relativeRelease) return null;
    if (!hasSameFileDigests(manifest.files, expectedFiles)) return null;
    if (!await verifyCurrentReleaseFiles(releaseDir, expectedFiles)) return null;
    return { version: relativeRelease, releaseDir };
  } catch {
    return null;
  }
}

async function pruneOldReleases(releasesDir: string, retainReleases: number): Promise<void> {
  const entries = await fs.promises.readdir(releasesDir, { withFileTypes: true });
  const releases = entries
    .filter(entry => entry.isDirectory() && RELEASE_NAME_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();

  for (const oldRelease of releases.slice(Math.max(2, retainReleases))) {
    await fs.promises.rm(path.join(releasesDir, oldRelease), { recursive: true, force: true });
  }
}

export function assertStaticSnapshotResourceLimits(
  files: ReadonlyMap<string, Buffer>,
  manifestBytes = 0,
): void {
  // manifest.json is generated separately and is not listed inside .files.
  if (files.size + 1 > MAX_SNAPSHOT_FILES) {
    throw new Error(`静态快照文件数不能超过 ${MAX_SNAPSHOT_FILES}`);
  }

  let totalBytes = manifestBytes;
  if (manifestBytes > MAX_SNAPSHOT_FILE_BYTES) {
    throw new Error('静态快照单文件不能超过 10 MiB: manifest.json');
  }
  for (const [fileName, buffer] of files) {
    if (buffer.byteLength > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(`静态快照单文件不能超过 10 MiB: ${fileName}`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error('静态快照总大小不能超过 256 MiB');
    }
  }
}

/**
 * Creates a complete versioned release and switches `current` only after every
 * JSON file and digest has been written. Consumers can deploy `current/` without
 * ever observing a partially generated snapshot.
 */
export async function writeStaticSnapshot(input: StaticSnapshotInput): Promise<StaticSnapshotResult> {
  const now = input.now || new Date();
  if (Number.isNaN(now.getTime())) throw new Error('静态快照生成时间无效');

  const requestedOutputDir = assertSafeOutputDir(input.outputDir);
  await fs.promises.mkdir(requestedOutputDir, { recursive: true });
  const outputDir = assertSafeOutputDir(await fs.promises.realpath(requestedOutputDir));
  const releasesDir = path.join(outputDir, 'releases');
  const currentDir = path.join(outputDir, 'current');
  const payloads = buildStaticSnapshotPayloads(
    input.posts,
    input.postContents,
    input.siteConfig,
    now,
  );
  const publicAlbum = (input.album || [])
    .map(toPublicAlbumPhoto)
    .filter((item): item is Record<string, unknown> => item !== null);
  const publicProjects = (input.projects || [])
    .map(toPublicProject)
    .filter((item): item is PublicSnapshotProject => item !== null);
  const seoFiles = buildStaticSeoFiles(payloads);
  // manifest + posts list + the five always-present auxiliary snapshots +
  // sitemap plus one crawler-facing page for each public article body.
  const projectedFileCount = 7 + (input.siteCompliance ? 1 : 0) + payloads.postContents.size + seoFiles.size + (input.imageFiles?.size || 0);
  if (projectedFileCount > MAX_SNAPSHOT_FILES) {
    throw new Error(`静态快照文件数不能超过 ${MAX_SNAPSHOT_FILES}`);
  }
  const files = new Map<string, Buffer>([
    ['posts_list.json', jsonBuffer(payloads.postsList)],
    ['timeline.json', jsonBuffer((input.timeline || [])
      .map(item => toPublicTimeline(item, now.getTime()))
      .filter((item): item is Record<string, unknown> => item !== null))],
    ['friends.json', jsonBuffer((input.friends || [])
      .map(toPublicFriend)
      .filter((item): item is Record<string, unknown> => item !== null))],
    ['projects.json', jsonBuffer({ success: true, data: publicProjects })],
    ['i18n.json', jsonBuffer(input.i18n || { success: true, data: { zh: {}, en: {} } })],
    ['album.json', jsonBuffer({
      success: true,
      data: {
        items: publicAlbum,
        page: 1,
        limit: publicAlbum.length,
        total: publicAlbum.length,
        hasMore: false,
      },
    })],
  ]);
  if (input.siteCompliance) {
    files.set('site-compliance.json', jsonBuffer({ success: true, data: input.siteCompliance }));
  }
  for (const [postId, contentPayload] of payloads.postContents) {
    files.set(`post_${postId}.json`, jsonBuffer(contentPayload));
  }
  for (const [fileName, buffer] of seoFiles) {
    if (!SAFE_STATIC_SEO_FILE_PATTERN.test(fileName)) {
      throw new Error(`静态 SEO 文件路径无效: ${fileName}`);
    }
    files.set(fileName, buffer);
  }
  for (const [fileName, buffer] of input.imageFiles || []) {
    const imageMatch = fileName.match(SAFE_IMAGE_FILE_PATTERN);
    const fontMatch = fileName.match(SAFE_FONT_FILE_PATTERN);
    if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(`静态快照资源文件无效: ${fileName}`);
    }
    if (imageMatch) {
      const detectedType = detectSupportedImageType(buffer);
      if (!detectedType || detectedType.extension !== imageMatch[2]) {
        throw new Error(`静态快照图片格式与扩展名不匹配: ${fileName}`);
      }
      if (digest(buffer).sha256 !== imageMatch[1]) {
        throw new Error(`静态快照图片内容摘要不匹配: ${fileName}`);
      }
    } else if (fontMatch) {
      const detectedType = detectSupportedFontType(buffer);
      if (!detectedType || detectedType.extension !== fontMatch[2]) {
        throw new Error(`静态快照字体格式与扩展名不匹配: ${fileName}`);
      }
      if (digest(buffer).sha256 !== fontMatch[1]) {
        throw new Error(`静态快照字体内容摘要不匹配: ${fileName}`);
      }
    } else {
      throw new Error(`静态快照资源路径无效: ${fileName}`);
    }
    files.set(fileName, buffer);
  }
  assertStaticSnapshotResourceLimits(files);
  const fileDigests: Record<string, FileDigest> = {};
  for (const [fileName, buffer] of files) fileDigests[fileName] = digest(buffer);

  await fs.promises.mkdir(releasesDir, { recursive: true });
  const unchanged = await findUnchangedCurrentRelease(releasesDir, currentDir, fileDigests);
  if (unchanged) {
    return {
      ...unchanged,
      currentDir,
      postCount: payloads.postCount,
      skippedCount: payloads.skippedCount,
      changed: false,
    };
  }

  const version = makeVersion(now);
  const manifestBuffer = jsonBuffer({
    schemaVersion: 1,
    version,
    generatedAt: now.toISOString(),
    postCount: payloads.postCount,
    images: input.imageReport || { referenced: 0, resolved: 0, omitted: 0, affectedPosts: 0 },
    files: fileDigests,
  });
  assertStaticSnapshotResourceLimits(files, manifestBuffer.byteLength);
  const releaseDir = path.join(releasesDir, version);
  const stagingDir = path.join(releasesDir, `.staging-${version}`);
  const nextLink = path.join(outputDir, `.current-${version}`);
  await fs.promises.mkdir(stagingDir, { recursive: false });

  try {
    for (const [fileName, buffer] of files) {
      await fs.promises.mkdir(path.dirname(path.join(stagingDir, fileName)), { recursive: true });
      await fs.promises.writeFile(path.join(stagingDir, fileName), buffer, { flag: 'wx', mode: 0o644 });
    }

    await fs.promises.writeFile(path.join(stagingDir, 'manifest.json'), manifestBuffer, { flag: 'wx', mode: 0o644 });

    await fs.promises.rename(stagingDir, releaseDir);
    await fs.promises.symlink(path.relative(outputDir, releaseDir), nextLink, 'dir');
    await fs.promises.rename(nextLink, currentDir);
    await pruneOldReleases(releasesDir, input.retainReleases || 3).catch(error => {
      // The new current release is already valid at this point. Retention cleanup
      // must not turn a successful atomic switch into a reported publish failure.
      console.warn('[StaticSnapshot] 清理旧版本失败，将在下次发布时重试:', error);
    });

    return {
      version,
      releaseDir,
      currentDir,
      postCount: payloads.postCount,
      skippedCount: payloads.skippedCount,
      changed: true,
    };
  } catch (error) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(nextLink, { force: true }).catch(() => undefined);
    throw error;
  }
}
