import { Router } from 'express';
import { cacheService } from '../services/CacheService';
import { config } from '../config';

const router = Router();

const escapeXml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  const parsed = new Date(String(value).replace(/-/g, '/'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

router.get('/', async (req, res) => {
  try {
    const posts = cacheService.postsCache?.posts || [];
    const domain = (config.frontendUrl || 'https://www.hizhuiyi.cn').replace(/\/$/, '');

    const addUrl = (path: string, changefreq: string, priority: string, lastmod?: string | null) => {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(`${domain}${path}`)}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${escapeXml(lastmod)}</lastmod>\n`;
      xml += `    <changefreq>${changefreq}</changefreq>\n`;
      xml += `    <priority>${priority}</priority>\n`;
      xml += `  </url>\n`;
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Add homepage
    addUrl('/', 'daily', '1.0');
    addUrl('/posts', 'daily', '0.9');
    addUrl('/projects', 'weekly', '0.7');
    addUrl('/timeline', 'weekly', '0.6');
    addUrl('/album', 'weekly', '0.6');
    addUrl('/friends', 'weekly', '0.5');
    addUrl('/about', 'monthly', '0.4');

    // Add posts
    posts.forEach((post: any) => {
      // 仅公开、已发布、且已经到发布日期的文章可以进入 Sitemap。
      if (post.isPrivate || post.isPublished === false) return;
      const publishedAt = toIsoDate(post.date);
      if (publishedAt && new Date(publishedAt).getTime() > Date.now()) return;
      const lastmod = toIsoDate(post.updatedAt) || publishedAt || toIsoDate(post.createdAt);
      addUrl(`/posts/${encodeURIComponent(String(post.id))}`, 'weekly', '0.8', lastmod);
    });

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

export default router;
