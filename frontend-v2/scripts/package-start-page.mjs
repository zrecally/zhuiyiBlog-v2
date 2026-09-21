import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';

const output = new URL('../dist-start/', import.meta.url);
await rename(new URL('start.html', output), new URL('index.html', output));
await mkdir(new URL('images/', output), { recursive: true });
await copyFile(new URL('../public/images/start-page-landscape-background-v1.webp', import.meta.url), new URL('images/start-page-landscape-background-v1.webp', output));
await copyFile(new URL('../public/LXGW-WENKAI-LICENSES.txt', import.meta.url), new URL('LXGW-WENKAI-LICENSES.txt', output));
await copyFile(new URL('../public/police-beian.svg', import.meta.url), new URL('police-beian.svg', output));
await writeFile(new URL('robots.txt', output), 'User-agent: *\nDisallow: /\n');
await writeFile(new URL('favicon.svg', output), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#1e1e1e"/><text x="50" y="70" text-anchor="middle" font-family="Georgia,serif" font-size="68" font-style="italic" fill="white">Z</text></svg>\n');
