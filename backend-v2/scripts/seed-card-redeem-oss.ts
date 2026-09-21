import bcrypt from 'bcryptjs';
import { config } from '../src/config';
import { prisma } from '../src/core/Database';
import { cardOssHead, cardOssReady } from '../src/core/CardOssClient';
import {
  cardCodeDigest,
  normalizeCardCode,
  validateCardCode,
} from '../src/utils/CardRedeem';
import { cardFileMediaType, isSafeOssKey } from '../src/utils/CardFileStorage';
import { generateCardCode } from '../src/utils/CardCodeRule';

/**
 * 给已存在于卡密对象存储中的对象发一张本地测试卡（端到端联调用）。
 * 用法: node --import tsx scripts/seed-card-redeem-oss.ts --key <对象key> --name <产品名> [--code <卡密>]
 * 需要 CARD_REDEEM_OSS_ENABLED=true 及完整 OSS 配置；仅限本地测试环境。
 */

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--key' || argv[i] === '--name' || argv[i] === '--code') {
      args[argv[i].slice(2)] = argv[i + 1] || '';
      i += 1;
    }
  }
  return args;
};

const main = async () => {
  if (process.env.NODE_ENV === 'production' || config.feishu.dataEnvironment !== 'Test') {
    throw new Error('本地发卡只能在 NODE_ENV 非 production 且 FEISHU_DATA_ENV=Test 时使用');
  }
  if (!config.cardRedeem.enabled || config.cardRedeem.secret.length < 32) {
    throw new Error('请先启用 CARD_REDEEM_ENABLED 并配置至少 32 字符的 CARD_REDEEM_SECRET');
  }
  if (!cardOssReady()) throw new Error('请先启用 CARD_REDEEM_OSS_ENABLED 并配置完整 OSS 信息');

  const { key, name, code: codeArg } = parseArgs(process.argv.slice(2));
  if (!key) throw new Error('缺少 --key 参数（OSS 对象 key，如 card-files/xxx.zip）');
  if (!isSafeOssKey(key)) throw new Error('对象 key 不合法');

  const meta = await cardOssHead(key);
  const fileName = name || key.split('/').pop() || key;

  const code = normalizeCardCode(codeArg || generateCardCode().code);
  const codeError = validateCardCode(code);
  if (codeError) throw new Error(codeError);

  const environment = config.feishu.dataEnvironment;
  const codeDigest = cardCodeDigest(config.cardRedeem.secret, environment, code);
  const codeHash = await bcrypt.hash(code, 10);

  await prisma.cardCode.upsert({
    where: { environment_codeDigest: { environment, codeDigest } },
    update: {
      productName: fileName,
      codeHash,
      codeHint: code.slice(-4),
      contentCiphertext: null,
      fileKey: key,
      fileName,
      fileMediaType: cardFileMediaType(key),
      fileSize: meta.size,
      fileChecksum: null,
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
      productName: fileName,
      codeDigest,
      codeHash,
      codeHint: code.slice(-4),
      fileKey: key,
      fileName,
      fileMediaType: cardFileMediaType(key),
      fileSize: meta.size,
      salesChannel: 'local-test',
      status: 'active',
    },
  });

  console.log(`发卡完成（OSS 对象）：${code} -> ${key} (${meta.size} bytes)`);
};

void main()
  .catch(error => {
    console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
