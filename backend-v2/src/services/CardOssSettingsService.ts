import fs from 'node:fs/promises';
import path from 'node:path';
import {
  cardOssApplySettings,
  cardOssList,
  cardOssSettings,
  type CardOssRuntimeConfig,
} from '../core/CardOssClient';

/**
 * 卡密对象存储连接的运行时配置：持久化在 cache_data/card-oss-config.json，
 * 启动时加载覆盖环境变量默认值；管理 API 保存后立即生效（重建客户端），无需重启。
 * 仅限本地/可信环境使用：accessKeySecret 以明文存放于该文件。
 */

const settingsPath = path.resolve(process.cwd(), 'cache_data', 'card-oss-config.json');

export type CardOssSettings = CardOssRuntimeConfig;

export class CardOssSettingsService {
  /** 启动时调用：文件配置覆盖环境变量默认值。 */
  static async load(): Promise<void> {
    try {
      const raw = await fs.readFile(settingsPath, 'utf8');
      // Repair permissions on files created by older releases before parsing
      // the plaintext access secret.
      await fs.chmod(settingsPath, 0o600);
      const parsed = JSON.parse(raw) as Partial<CardOssSettings>;
      cardOssApplySettings(parsed);
      console.log('[CardOss] 已加载对象存储连接配置:', parsed.endpoint || '(空)');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // 尚无文件，使用环境变量默认
      console.error('[CardOss] 加载对象存储配置失败，沿用环境变量默认值:', error);
    }
  }

  static get(): CardOssSettings {
    return cardOssSettings();
  }

  static async save(patch: Partial<CardOssSettings>): Promise<CardOssSettings> {
    cardOssApplySettings(patch); // 不合法会抛错，不落盘
    const settings = cardOssSettings();
    await fs.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    return settings;
  }

  /** 测试连接：列举桶内对象（最多 5 个）。 */
  static async test(): Promise<{ ok: true; bucket: string; objectCount: number }> {
    const objects = await cardOssList('');
    return { ok: true, bucket: cardOssSettings().bucket, objectCount: objects.length };
  }
}
