import fs from 'node:fs/promises';
import path from 'node:path';
import { generateCardCodes } from '../src/utils/CardCodeRule';

const parseArgs = (argv: string[]): { count: number; out: string | null } => {
  let count = 10;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--count' && argv[i + 1]) {
      count = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[i + 1];
      i += 1;
    }
  }
  return { count, out };
};

const main = async () => {
  const { count, out } = parseArgs(process.argv.slice(2));
  const codes = generateCardCodes(count);
  const lines = codes.map(item => item.display);

  for (const line of lines) console.log(line);
  console.error(`\n共 ${codes.length} 个卡密。归一形态（同步/核销实际比对值）：`);
  for (const item of codes) console.error(item.code);

  if (out) {
    const filePath = path.resolve(out);
    const content = [
      '# 卡密展示形态（可按分组读给买家）',
      ...lines,
      '',
      '# 归一形态（填入飞书 CodeInput，两种形态等价）',
      ...codes.map(item => item.code),
      '',
    ].join('\n');
    await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
    console.error(`已写入 ${filePath}`);
  }
};

void main().catch(error => {
  console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
