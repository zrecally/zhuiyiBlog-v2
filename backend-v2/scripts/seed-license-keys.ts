import fs from 'node:fs';
import path from 'node:path';
import { LicenseService } from '../src/services/LicenseService';

/**
 * 本地向数据库直接签发编排授权卡密（支持在线激活码与离线 .lic 签名凭据）
 * 用法:
 *  1. 在线激活码: npx tsx scripts/seed-license-keys.ts [--count 2] [--name "编排模式 Pro"] [--days 30]
 *  2. 离线凭据:   npx tsx scripts/seed-license-keys.ts --offline --device <DEVICE_ID> [--days 365] [--to "张三"] [--out license.lic]
 */

const parseArgs = (argv: string[]) => {
  let offline = false;
  let device: string | null = null;
  let out: string | null = null;
  let to: string | null = null;
  let count = 1;
  let name = '编排模式 Pro';
  let days: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--offline') {
      offline = true;
    } else if (argv[i] === '--device' && argv[i + 1]) {
      device = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--to' && argv[i + 1]) {
      to = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--count' && argv[i + 1]) {
      count = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (argv[i] === '--name' && argv[i + 1]) {
      name = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--days' && argv[i + 1]) {
      days = Number.parseInt(argv[i + 1], 10);
      i += 1;
    }
  }
  return { offline, device, out, to, count, name, days };
};

const main = async () => {
  const { offline, device, out, to, count, name, days } = parseArgs(process.argv.slice(2));

  if (offline) {
    if (!device) {
      console.error('❌ 错误: 离线授权模式必须指定设备指纹 --device <DEVICE_ID>');
      process.exit(1);
    }
    console.log(`[SeedLicense] 正在为设备 [${device}] 签发离线 Ed25519 授权凭据 (有效期: ${days ? days + ' 天' : '永久'})...`);
    const result = await LicenseService.generateOfflineLicense({
      deviceId: device,
      productName: name,
      days,
      licensedTo: to || undefined,
      features: ['orchestration-pro'],
    });

    console.log('\n--- 成功生成离线 Ed25519 授权文件凭据：---');
    console.log(`授权卡密:   ${result.code}`);
    console.log(`绑定设备:   ${result.signedLicense.payload.deviceId}`);
    console.log(`授权对象:   ${result.signedLicense.payload.licensedTo}`);
    console.log(`到期时间:   ${result.signedLicense.payload.expiresAt ? new Date(result.signedLicense.payload.expiresAt * 1000).toLocaleString() : '永久'}`);
    console.log(`数字签名:   ${result.signedLicense.signature}`);
    console.log('\n完整 License JSON:');
    const jsonStr = JSON.stringify(result.signedLicense, null, 2);
    console.log(jsonStr);

    if (out) {
      const resolvedOut = path.resolve(process.cwd(), out);
      fs.writeFileSync(resolvedOut, jsonStr, 'utf8');
      console.log(`\n💾 离线授权文件已保存至: ${resolvedOut}`);
    }
    console.log('-----------------------------------------\n');
    return;
  }

  console.log(`[SeedLicense] 正在为 [${name}] 生成 ${count} 张卡密 (有效期: ${days ? days + ' 天' : '永久'})...`);
  const codes = await LicenseService.generateKeys(count, name, days);
  console.log('\n--- 成功生成编排卡密明文（请保存）：---');
  for (const code of codes) {
    console.log(code);
  }
  console.log('-----------------------------------------\n');
};

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAILED]', err);
    process.exit(1);
  });
