import { Request, Response } from 'express';
import { FeishuPublicDataService } from '../services/FeishuPublicDataService';

export class TimelineController {
  public static async handleGet0(req: Request, res: Response) {
  try {
    const timeline = await FeishuPublicDataService.fetchTimeline();
    res.json({ success: true, data: timeline });
  } catch (error) {
    console.error("❌ 获取 Feishu 动态数据失败:", error);
    res.status(500).json({ success: false, message: '从 Feishu 获取动态数据失败' });
  }
  }

}
