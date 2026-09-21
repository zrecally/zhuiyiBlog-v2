import { prisma } from '/Volumes/funk/Blog/zhuiyi/zhuiyi/backend-v2/src/core/Database';
import { LicenseService } from '/Volumes/funk/Blog/zhuiyi/zhuiyi/backend-v2/src/services/LicenseService';
async function main() {
  const dev = 'c6c234ab818825ceca8bb5739f450041';
  const digest = LicenseService.trialDigestFor(dev);
  await prisma.licenseKey.update({ where: { keyDigest: digest }, data: { expiresAt: new Date(Date.now() - 3600_000) } });
  console.log('试用已改为 1 小时前到期');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
