import { rm } from 'node:fs/promises';

const outputDir = process.argv[2] || 'dist';
const artifacts = [
  'fax-modem.ogg',
  'fax.mp3',
  'printer.mp3',
  'admin-modern.png',
  'admin-xianxia.png',
  'pigeon',
];

// The police filing icon belongs only to static compliance releases. Vite copies
// public assets into every build, so remove it from the dynamic site explicitly.
if (outputDir === 'dist') artifacts.push('police-beian.svg');

await Promise.all(artifacts.map((path) => rm(`${outputDir}/${path}`, { force: true, recursive: true })));
