import fs from 'fs';
import path from 'path';
import Mint from 'mint-filter';
import { pinyin } from 'pinyin-pro';
import { t2s } from 'chinese-s2t';

interface FilterRule {
  check(text: string, normalizedText: string, pinyinText: string): boolean;
}

export interface SecurityInitializationStatus {
  status: 'online' | 'warning';
  message: string;
  loadedAt: string;
}

class RegexRule implements FilterRule {
  private patterns: RegExp[] = [];

  constructor(patterns: RegExp[]) {
    this.patterns = patterns;
  }

  check(text: string, normalizedText: string, pinyinText: string): boolean {
    for (const pattern of this.patterns) {
      if (pattern.test(text) || pattern.test(normalizedText)) {
        return true;
      }
    }
    return false;
  }
}

class PinyinRule implements FilterRule {
  private pinyinMint: Mint;

  constructor(pinyinWords: string[]) {
    this.pinyinMint = new Mint(pinyinWords);
  }

  check(text: string, normalizedText: string, pinyinText: string): boolean {
    if (!pinyinText) return false;
    return !this.pinyinMint.verify(pinyinText);
  }
}

class DFARule implements FilterRule {
  private mintFilter: Mint;

  constructor(words: string[]) {
    this.mintFilter = new Mint(words);
  }

  check(text: string, normalizedText: string, pinyinText: string): boolean {
    return !this.mintFilter.verify(text) || !this.mintFilter.verify(normalizedText);
  }
}

export class SecurityUtils {
  private static instance: SecurityUtils;
  private rules: FilterRule[] = [];
  private customRule: DFARule | null = null;
  private customWordCount = 0;
  private initializationStatus: SecurityInitializationStatus = {
    status: 'warning',
    message: '过滤链尚未初始化',
    loadedAt: new Date(0).toISOString(),
  };

  private constructor() {
    this.initFilterChain();
  }

  public static getInstance(): SecurityUtils {
    if (!SecurityUtils.instance) {
      SecurityUtils.instance = new SecurityUtils();
    }
    return SecurityUtils.instance;
  }

  /**
   * 只暴露加载结果，不暴露词库内容，供受保护的控制台展示真实初始化状态。
   */
  public getInitializationStatus(): SecurityInitializationStatus {
    return { ...this.initializationStatus };
  }

  /**
   * 控制台自定义词条仅支持纯文本词组；保存后立即替换内存规则。
   * 词条会由 SystemConfig 持久化，并在每次服务启动后重新加载。
   */
  public setCustomSensitiveWords(rawValue: string): number {
    const words = Array.from(new Set(
      rawValue
        .split(/[,，\n\r]/)
        .map(word => word.trim())
        .filter(Boolean),
    ));
    if (words.length > 500) throw new Error('自定义敏感词最多 500 个');
    if (words.some(word => word.length > 64)) throw new Error('单个敏感词不能超过 64 个字符');

    this.customRule = words.length > 0 ? new DFARule(words) : null;
    this.customWordCount = words.length;
    this.initializationStatus = {
      ...this.initializationStatus,
      message: `${this.initializationStatus.message.split('；控制台自定义')[0]}；控制台自定义 ${words.length} 个词条`,
      loadedAt: new Date().toISOString(),
    };
    return words.length;
  }

  public async loadCustomSensitiveWordsFromDatabase(): Promise<number> {
    const { prisma } = await import('../core/Database');
    const record = await prisma.systemConfig.findUnique({ where: { key: 'sensitive_words' } });
    return this.setCustomSensitiveWords(record?.value || '');
  }

  private initFilterChain() {
    let sensitiveWords: string[] = [];
    let regexPatterns: RegExp[] = [];
    let pinyinWords: string[] = [];

    let loadError = false;
    try {
        const dictDir = path.resolve(__dirname, '../../dict');

        // Load base dictionary
        const basePath = path.join(dictDir, 'base_words.txt');
        if (fs.existsSync(basePath)) {
          const fileContent = fs.readFileSync(basePath, 'utf-8');
          const baseWords = fileContent.split('\n').map(word => word.trim()).filter(Boolean);
          sensitiveWords = Array.from(new Set([...sensitiveWords, ...baseWords]));
        }

        // Load standard dictionary
      const dictPath = path.join(dictDir, 'all_sensitive_words.txt');
      if (fs.existsSync(dictPath)) {
        const fileContent = fs.readFileSync(dictPath, 'utf-8');
        const externalWords = fileContent.split('\n').map(word => word.replace(/,$/, '').trim()).filter(Boolean);
        sensitiveWords = Array.from(new Set([...sensitiveWords, ...externalWords]));
      }

      // Load slang dictionary
        const slangPath = path.join(dictDir, 'erotic_slang.txt');
        if (fs.existsSync(slangPath)) {
          const fileContent = fs.readFileSync(slangPath, 'utf-8');
          const slangWords = fileContent.split('\n').map(word => word.replace(/,$/, '').trim()).filter(Boolean);
          sensitiveWords = Array.from(new Set([...sensitiveWords, ...slangWords]));
        }

        // Load english dictionary
        const englishPath = path.join(dictDir, 'english_words.txt');
        if (fs.existsSync(englishPath)) {
          const fileContent = fs.readFileSync(englishPath, 'utf-8');
          const englishWords = fileContent.split('\n').map(word => word.trim()).filter(Boolean);
          sensitiveWords = Array.from(new Set([...sensitiveWords, ...englishWords]));
        }

        // Load regex rules
      const regexPath = path.join(dictDir, 'regex_rules.txt');
      if (fs.existsSync(regexPath)) {
        const fileContent = fs.readFileSync(regexPath, 'utf-8');
        const patterns = fileContent.split('\n')
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => new RegExp(p, 'i'));
        regexPatterns = [...regexPatterns, ...patterns];
      }

      // Load pinyin rules
      const pinyinPath = path.join(dictDir, 'pinyin_rules.txt');
      if (fs.existsSync(pinyinPath)) {
        const fileContent = fs.readFileSync(pinyinPath, 'utf-8');
        const pWords = fileContent.split('\n').map(word => word.trim()).filter(Boolean);
        pinyinWords = Array.from(new Set([...pinyinWords, ...pWords]));
      }

      console.log(`[Security] 成功初始化过滤链，加载了 ${sensitiveWords.length} 个DFA词条，${regexPatterns.length} 条正则规则，${pinyinWords.length} 个拼音规则。`);
    } catch (error) {
      loadError = true;
      console.error('[Security] ⚠️ 加载外部词库失败，使用内置规则作为降级方案。', error);
    }

    // Register chain
    this.rules.push(new RegexRule(regexPatterns));
    this.rules.push(new DFARule(sensitiveWords));
    this.rules.push(new PinyinRule(pinyinWords));
    const totalRules = sensitiveWords.length + regexPatterns.length + pinyinWords.length;
    this.initializationStatus = {
      status: !loadError && totalRules > 0 ? 'online' : 'warning',
      message: !loadError && totalRules > 0
        ? `已加载 ${sensitiveWords.length} 个词条、${regexPatterns.length} 条正则、${pinyinWords.length} 个拼音规则`
        : '词库加载异常，当前使用降级过滤链',
      loadedAt: new Date().toISOString(),
    };
  }

  /**
   * 文本归一化：繁转简，转小写，全角转半角，去特殊字符和空格
   */
  private normalize(text: string): string {
    const sText = t2s(text);
    const lowerText = sText.toLowerCase();
    // 全角转半角
    const halfText = lowerText.replace(/[\uff01-\uff5e]/g, (ch: string) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
    // 移除空白字符和常见特殊符号
    return halfText.replace(/[\s\p{P}\p{S}]/gu, '');
  }

  public containsSensitiveWords(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }

    const normalizedText = this.normalize(text);

    // 生成无声调拼音并去除空格（如 "sha bi" -> "shabi"）
    const pinyinArray = pinyin(normalizedText, { toneType: 'none', type: 'array' }) as string[];
    const pinyinText = pinyinArray.join('').replace(/\s+/g, '');

    for (const rule of this.rules) {
      if (rule.check(text, normalizedText, pinyinText)) {
        return true;
      }
    }

    return this.customRule?.check(text, normalizedText, pinyinText) || false;
  }
}

export const securityUtils = SecurityUtils.getInstance();
