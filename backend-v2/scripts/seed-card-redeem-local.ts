import { ZipArchive } from 'archiver';
import bcrypt from 'bcryptjs';
import { config } from '../src/config';
import { prisma } from '../src/core/Database';
import {
  cardCodeDigest,
  normalizeCardCode,
  validateCardCode,
} from '../src/utils/CardRedeem';
import { deleteCardFile, storeCardFile } from '../src/utils/CardFileStorage';
import { generateCardCode } from '../src/utils/CardCodeRule';

const main = async () => {
  if (process.env.NODE_ENV === 'production' || config.feishu.dataEnvironment !== 'Test') {
    throw new Error('本地测试卡只能在 NODE_ENV 非 production 且 FEISHU_DATA_ENV=Test 时创建');
  }
  if (!config.cardRedeem.enabled || config.cardRedeem.secret.length < 32) {
    throw new Error('请先启用 CARD_REDEEM_ENABLED 并配置至少 32 字符的 CARD_REDEEM_SECRET');
  }

  // 未指定 CARD_SEED_CODE 时按规则随机生成，每次运行得到一张新测试卡。
  const code = normalizeCardCode(process.env.CARD_SEED_CODE || generateCardCode().code);
  const codeError = validateCardCode(code);
  if (codeError) throw new Error(codeError);
  const environment = config.feishu.dataEnvironment;
  const codeDigest = cardCodeDigest(config.cardRedeem.secret, environment, code);
  const existing = await prisma.cardCode.findUnique({
    where: { environment_codeDigest: { environment, codeDigest } },
  });
  if (existing && existing.source !== 'local-test') {
    throw new Error('测试卡密与非本地记录冲突，请通过 CARD_SEED_CODE 换一个卡密');
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const storedPromise = storeCardFile(archive, 'zhuiyi-local-test.zip');
  archive.append([
    'Hi, ZuiYi 发卡模块本地测试',
    '',
    '如果你能看到这个文件，说明卡密核销、短时凭证和私有文件下载均已正常工作。',
    '此压缩包仅用于本机测试。',
  ].join('\n'), { name: 'README.txt' });
  await archive.finalize();
  const stored = await storedPromise;

  try {
    const codeHash = await bcrypt.hash(code, 4);
    await prisma.cardCode.upsert({
      where: { environment_codeDigest: { environment, codeDigest } },
      update: {
        productName: '本地测试压缩包',
        codeHash,
        codeHint: code.slice(-4),
        contentCiphertext: null,
        fileKey: stored.fileKey,
        fileName: stored.fileName,
        fileMediaType: stored.mediaType,
        fileSize: stored.fileSize,
        fileChecksum: stored.checksum,
        feishuFileToken: null,
        status: 'active',
        usedAt: null,
        usedIpHash: null,
        replayTokenHash: null,
        replayExpiresAt: null,
      },
      create: {
        environment,
        source: 'local-test',
        productKey: 'local-test',
        productName: '本地测试压缩包',
        codeDigest,
        codeHash,
        codeHint: code.slice(-4),
        fileKey: stored.fileKey,
        fileName: stored.fileName,
        fileMediaType: stored.mediaType,
        fileSize: stored.fileSize,
        fileChecksum: stored.checksum,
        salesChannel: 'local-test',
        status: 'active',
      },
    });
  } catch (error) {
    await deleteCardFile(stored.fileKey);
    throw error;
  }
  if (existing?.fileKey && existing.fileKey !== stored.fileKey) await deleteCardFile(existing.fileKey);

  console.log(`本地测试卡已就绪：${code} -> ${stored.fileName} (${stored.fileSize} bytes)`);
};

void main()
  .catch(error => {
    console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
