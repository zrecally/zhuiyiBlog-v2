import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const [outputDir, buildKind] = process.argv.slice(2);
if (!outputDir || !['dynamic', 'static', 'card'].includes(buildKind)) {
  throw new Error('usage: check-production-boundaries.mjs <output-dir> <dynamic|static|card>');
}

const files = [];
const collect = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (/\.(?:html|js|css|json|svg)$/.test(entry.name)) files.push(target);
  }
};
await collect(outputDir);

const searchable = (await Promise.all(files.map(async file => `${file}\n${await readFile(file, 'utf8')}`))).join('\n');
// 非卡密构建禁止出现兑换流程与签名密钥；卡密构建必须包含兑换流程且不得含密钥
const forbiddenCardPatterns = [/cards\/redeem/i, /CARD_REDEEM_SECRET/i];
if (buildKind === 'card') {
  // 卡密专属构建：兑换代码必须存在，密钥必须不存在
  if (!/cards\/redeem/i.test(searchable)) throw new Error('card build is missing the redemption flow');
  if (/CARD_REDEEM_SECRET/i.test(searchable)) throw new Error('card build contains the signing secret');
} else {
  for (const pattern of forbiddenCardPatterns) {
    if (pattern.test(searchable)) throw new Error(`${buildKind} build contains disabled card-delivery code: ${pattern}`);
  }
}

const compliancePatterns = [/site-compliance\.json/i, /beian\.miit\.gov\.cn/i, /beian\.mps\.gov\.cn/i];
if (buildKind === 'card') {
  console.log('card build boundary check: ok');
} else if (buildKind === 'dynamic') {
  for (const pattern of compliancePatterns) {
    if (pattern.test(searchable)) throw new Error(`dynamic build contains static-only compliance data flow: ${pattern}`);
  }
  try {
    await access(path.join(outputDir, 'police-beian.svg'));
    throw new Error('dynamic build contains the static-only police filing icon');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
} else {
  for (const pattern of compliancePatterns) {
    if (!pattern.test(searchable)) throw new Error(`static build is missing compliance integration: ${pattern}`);
  }
  await access(path.join(outputDir, 'police-beian.svg'));
}

console.log(`Production boundary check passed: ${buildKind}`);
