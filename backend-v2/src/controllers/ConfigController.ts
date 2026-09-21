import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { FeishuSyncService } from '../services/FeishuSyncService';
import { cacheService } from '../services/CacheService';

export class ConfigController {
  // 获取公开的系统配置 (无敏感信息)
  public static async getPublicConfigs(req: Request, res: Response) {
    try {
      // 数据库定义哪些键可公开；内存缓存只可覆盖这些已验证的公开键。
      // 不能直接返回 configCache，因为它可能含有尚未脱敏的飞书配置。
      const configs = await prisma.systemConfig.findMany({
        where: {
          isSecret: false,
          NOT: [
            { key: { startsWith: 'static_compliance_' } },
            { key: { in: ['static_icp_number', 'static_police_number', 'static_police_record_code'] } },
          ],
        }
      });
      const cachedValues = cacheService.configCache && typeof cacheService.configCache === 'object'
        ? cacheService.configCache as Record<string, unknown>
        : {};
      const publicConfigs = configs.map(item => ({
        ...item,
        value: typeof cachedValues[item.key] === 'string' ? cachedValues[item.key] : item.value,
      }));
      res.json({ success: true, data: publicConfigs });
    } catch (error) {
      console.error('[Config] 获取公开配置失败', error);
      res.status(500).json({ success: false, message: '获取配置失败' });
    }
  }

  // 管理员获取所有配置（敏感数据脱敏）
  public static async getAllConfigs(req: Request, res: Response) {
    try {
      const configs = await prisma.systemConfig.findMany();
      // 敏感数据脱敏
      const maskedConfigs = configs.map(c => ({
        ...c,
        value: c.isSecret ? '********' : c.value
      }));
      res.json({ success: true, data: maskedConfigs });
    } catch (error) {
      console.error('[Config] 获取所有配置失败', error);
      res.status(500).json({ success: false, message: '获取配置失败' });
    }
  }

  // 局部更新配置
  public static async updateConfig(req: Request, res: Response) {
    try {
      const { key, value, isSecret } = req.body;
      if (!key) {
        return res.status(400).json({ success: false, message: 'Key is required' });
      }

      // 查找现存配置
      const existing = await prisma.systemConfig.findUnique({ where: { key } });

      // 如果传上来的是脱敏占位符，且本地已存在，则忽略本次值更新
      if (value === '********' && existing) {
        return res.json({ success: true, data: existing });
      }

      let updated;
      if (existing) {
        updated = await prisma.systemConfig.update({
          where: { key },
          data: {
            value: value !== undefined ? value : existing.value,
            isSecret: isSecret !== undefined ? isSecret : existing.isSecret
          }
        });
      } else {
        updated = await prisma.systemConfig.create({
          data: {
            key,
            value: value || '',
            isSecret: isSecret || false
          }
        });
      }

      // 放入飞书同步限流队列
      FeishuSyncService.queueConfigSyncToFeishu(updated.key, updated.value, updated.isSecret);

      res.json({ success: true, data: { ...updated, value: updated.isSecret ? '********' : updated.value } });
    } catch (error) {
      console.error('[Config] 更新配置失败', error);
      res.status(500).json({ success: false, message: '更新配置失败' });
    }
  }
}
