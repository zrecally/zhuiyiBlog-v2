import { randomInt } from 'node:crypto';

/**
 * 卡密规则 v2（唯一权威）：
 * 归一化后为 20 位字母数字（区分大小写，62 字符表），熵约 119 bit，
 * 只接受由 generateCardCode 产出的形态。
 * 用户输入侧仅做分隔符归一（大小写保留、空格与连字符剔除）。
 */
export const CARD_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const CARD_CODE_LENGTH = 20;
export const CARD_CODE_PATTERN = new RegExp(`^[${CARD_CODE_ALPHABET}]{${CARD_CODE_LENGTH}}$`);
export const CARD_CODE_RULE_MESSAGE = '卡密不符合规则，应为 20 位区分大小写的字母数字，可含连字符或空格分组';

export const isValidCardCode = (code: string): boolean => (
  typeof code === 'string' && CARD_CODE_PATTERN.test(code)
);

export type GeneratedCardCode = {
  /** 归一形态，直接写入飞书 CodeInput 或用于 digest 计算 */
  code: string;
  /** 4×5 分组的展示形态，打印给发卡方/买家 */
  display: string;
};

const randomCode = (): string => {
  let out = '';
  for (let i = 0; i < CARD_CODE_LENGTH; i += 1) {
    out += CARD_CODE_ALPHABET[randomInt(CARD_CODE_ALPHABET.length)];
  }
  return out;
};

const toDisplay = (code: string): string => (
  code.replace(new RegExp(`(.{5})(?=.{5})`, 'g'), '$1-')
);

export const generateCardCode = (): GeneratedCardCode => {
  const code = randomCode();
  return { code, display: toDisplay(code) };
};

export const generateCardCodes = (count: number): GeneratedCardCode[] => {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) {
    throw new Error('生成数量必须是 1-10000 之间的整数');
  }
  const seen = new Set<string>();
  const result: GeneratedCardCode[] = [];
  while (result.length < count) {
    const generated = generateCardCode();
    if (seen.has(generated.code)) continue;
    seen.add(generated.code);
    result.push(generated);
  }
  return result;
};
