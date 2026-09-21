import { Request, Response } from 'express';
import { prisma } from '../core/Database';

export class VisitController {
  public static async handlePost0(req: Request, res: Response) {
  try {
    const stat = await prisma.siteStat.upsert({
      where: { id: 1 },
      update: { views: { increment: 1 } },
      create: { id: 1, views: 1 }
    });
    res.json({ success: true, views: stat.views });
  } catch (error) {
    console.error("记录访问量失败:", error);
    res.status(500).json({ success: false });
  }
  }

}
