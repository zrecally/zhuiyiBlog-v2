import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDir = process.argv[2] || 'dist-static';
const indexPath = resolve(outputDir, 'index.html');
const verificationMarker = '<!-- BAIDU_SITE_VERIFICATION -->';

let indexHtml = await readFile(indexPath, 'utf8');
indexHtml = indexHtml
  .replaceAll('https://www.hizhuiyi.cn/', 'https://cn.hizhuiyi.cn/')
  .replace('href="/api/v1/feed/rss"', 'href="https://www.hizhuiyi.cn/api/v1/feed/rss"')
  .replace('href="/api/v1/feed/atom"', 'href="https://www.hizhuiyi.cn/api/v1/feed/atom"');
if (!indexHtml.includes(verificationMarker)) {
  indexHtml = indexHtml.replace('</head>', `  ${verificationMarker}\n </head>`);
}

await writeFile(indexPath, indexHtml, 'utf8');
await writeFile(
  resolve(outputDir, 'robots.txt'),
  'User-agent: *\nAllow: /\n\nSitemap: https://cn.hizhuiyi.cn/sitemap.xml\n',
  'utf8',
);
