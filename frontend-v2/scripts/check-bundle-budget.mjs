import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const [outputArg = 'dist', jsBudgetArg = '160000', cssBudgetArg = '90000'] = process.argv.slice(2);
const outputDir = resolve(outputArg);
const jsBudget = Number(jsBudgetArg);
const cssBudget = Number(cssBudgetArg);
const html = await readFile(resolve(outputDir, 'index.html'), 'utf8');

const entryPath = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
const stylePaths = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
if (!entryPath) throw new Error(`Cannot find module entry in ${outputDir}/index.html`);

const gzipBytes = async (webPath) => gzipSync(await readFile(resolve(outputDir, webPath.replace(/^\//, '')))).byteLength;
const entryGzip = await gzipBytes(entryPath);
const cssGzip = (await Promise.all(stylePaths.map(gzipBytes))).reduce((sum, size) => sum + size, 0);

const oversizedImages = [];
const imageDir = resolve(outputDir, 'images');
try {
  for (const file of await readdir(imageDir)) {
    if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)) continue;
    const size = (await stat(resolve(imageDir, file))).size;
    if (size > 512 * 1024) oversizedImages.push(`${file} (${Math.ceil(size / 1024)} KiB)`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log(`Bundle budget: entry ${entryGzip} / ${jsBudget} gzip bytes; CSS ${cssGzip} / ${cssBudget} gzip bytes`);
const failures = [];
if (entryGzip > jsBudget) failures.push(`entry JavaScript exceeds budget by ${entryGzip - jsBudget} bytes`);
if (cssGzip > cssBudget) failures.push(`entry CSS exceeds budget by ${cssGzip - cssBudget} bytes`);
if (oversizedImages.length) failures.push(`oversized public images: ${oversizedImages.join(', ')}`);
if (failures.length) throw new Error(failures.join('; '));
