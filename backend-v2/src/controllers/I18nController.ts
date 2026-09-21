import { Request, Response } from 'express';
import { prisma } from '../core/Database';
import { FeishuI18nSyncService } from '../services/feishu-sync/FeishuI18nSyncService';

export class I18nController {
  // 获取多语言字典
  static async getDict(req: Request, res: Response) {
    try {
      const records = await (prisma as any).i18nDict.findMany();

      const zh: Record<string, string> = {};
      const en: Record<string, string> = {};

      records.forEach((r: any) => {
        if (r.zh_CN) zh[r.key] = r.zh_CN;
        if (r.en_US) en[r.key] = r.en_US;
      });

      // 组装为前端 i18next 期望或能容易处理的格式
      res.json({
        success: true,
        data: {
          zh,
          en
        }
      });
    } catch (error) {
      console.error('[I18nController] getDict Error:', error);
      res.status(500).json({ success: false, message: '获取多语言字典失败' });
    }
  }

  // 前端上报缺失的词条
  static async reportMissing(req: Request, res: Response) {
    try {
      const { key } = req.body as { key?: unknown };
      if (typeof key !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(key)) {
        return res.status(400).json({ success: false, message: '缺失 key 参数' });
      }

      // 异步交给同步服务处理，不阻塞前端
      void FeishuI18nSyncService.addMissingKeyToFeishu(key)
        .catch(error => console.error('[I18nController] missing key sync failed:', error));

      res.json({ success: true });
    } catch (error) {
      console.error('[I18nController] reportMissing Error:', error);
      res.status(500).json({ success: false, message: '上报失败' });
    }
  }
}
