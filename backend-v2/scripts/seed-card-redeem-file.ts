import bcrypt from 'bcryptjs';
import { config } from '../src/config';
import { prisma } from '../src/core/Database';
import {
  cardCodeDigest,
  normalizeCardCode,
  validateCardCode,
} from '../src/utils/CardRedeem';
import { SAFE_FILE_KEY_PATTERN, cardFileMediaType } from '../src/utils/CardFileStorage';
import { generateCardCode } from '../src/utils/CardCodeRule';

/**
 * 给 CARD_REDEEM_FILE_DIR 下已有的任意文件发一张本地测试卡。
 * 用法: node --import tsx scripts/seed-card-redeem-file.ts --file <uuid.zip> --name <产品名> [--code <卡密>]
 * 仅限本地测试环境；生产发卡走飞书同步。
 */

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file' || argv[i] === '--name' || argv[i] === '--code') {
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
  const { file, name, code: codeArg } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error('缺少 --file 参数（CARD_REDEEM_FILE_DIR 下的文件名，如 <uuid>.zip）');
  if (!SAFE_FILE_KEY_PATTERN.test(file)) throw new Error('文件名不符合 fileKey 格式（<uuid>.<ext>）');

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve(config.cardRedeem.fileDir, file);
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new Error('目标不是常规文件');

  const code = normalizeCardCode(codeArg || generateCardCode().code);
  const codeError = validateCardCode(code);
  if (codeError) throw new Error(codeError);

  const environment = config.feishu.dataEnvironment;
  const codeDigest = cardCodeDigest(config.cardRedeem.secret, environment, code);
  const codeHash = await bcrypt.hash(code, 10);
  const productName = name || path.basename(file);

  await prisma.cardCode.upsert({
    where: { environment_codeDigest: { environment, codeDigest } },
    update: {
      productName,
      codeHash,
      codeHint: code.slice(-4),
      contentCiphertext: null,
      fileKey: file,
      fileName: path.basename(file),
      fileMediaType: cardFileMediaType(file),
      fileSize: stat.size,
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
      productName,
      codeDigest,
      codeHash,
      codeHint: code.slice(-4),
      fileKey: file,
      fileName: path.basename(file),
      fileMediaType: cardFileMediaType(file),
      fileSize: stat.size,
      salesChannel: 'local-test',
      status: 'active',
    },
  });

  console.log(`发卡完成：${code} -> ${path.basename(file)} (${stat.size} bytes)`);
};

void main()
  .catch(error => {
    console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
