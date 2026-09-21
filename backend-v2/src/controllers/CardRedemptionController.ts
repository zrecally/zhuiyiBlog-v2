import { Request, Response } from 'express';
import { CardRedemptionService } from '../services/CardRedemptionService';
import { IpUtils } from '../utils/IpUtils';

export class CardRedemptionController {
  public static async redeem(req: Request, res: Response) {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    try {
      const result = await CardRedemptionService.redeem(
        req.body?.code,
        req.body?.requestId,
        IpUtils.getClientIp(req),
      );
      if (!result.success) {
        return res.status(result.status).json({ success: false, message: result.message });
      }
      return res.json(result);
    } catch (error) {
      console.error('[CardRedeem] 卡密核销失败:', error);
      return res.status(503).json({ success: false, message: '提取服务暂不可用，请稍后重试' });
    }
  }

  public static async checkDownload(req: Request, res: Response) {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Referrer-Policy', 'no-referrer');
    try {
      const result = await CardRedemptionService.preflightDownload(
        req.params.ticket,
        IpUtils.getClientIp(req),
      );
      if (result === 'ready') return res.status(204).end();
      if (result === 'already_issued') return res.status(409).end();
      return res.status(410).end();
    } catch (error) {
      console.error('[CardRedeem] 下载状态检查失败:', error);
      return res.status(503).end();
    }
  }

  public static async download(req: Request, res: Response) {
    try {
      res.set('Referrer-Policy', 'no-referrer');
      const clientIp = IpUtils.getClientIp(req);
      const file = await CardRedemptionService.resolveDownload(
        req.params.ticket,
        clientIp,
      );
      if (!file) {
        // 410 + 文本提示：避免浏览器把空响应存成 0 字节同名文件覆盖已有下载。
        return res.status(410)
          .set('Content-Type', 'text/plain; charset=utf-8')
          .send('下载链接已失效，请回到提取页重新操作');
      }
      if (file.storage === 'blocked') {
        return res.status(409)
          .set('Cache-Control', 'private, no-store, max-age=0')
          .set('Content-Type', 'text/plain; charset=utf-8')
          .send('本次下载机会已使用，请从浏览器下载记录查看或续传');
      }
      if (file.storage === 'oss') {
        // The service has already committed the grant and its quota reservation
        // atomically. Never redirect first and attempt best-effort accounting later.
        res.set('Cache-Control', 'private, no-store, max-age=0');
        return res.redirect(302, file.redirectUrl);
      }
      res.set('Cache-Control', 'private, no-store, max-age=0');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', "default-src 'none'");
      res.type(file.mediaType);
      return res.download(file.filePath, file.fileName, {
        dotfiles: 'deny',
        acceptRanges: true,
        cacheControl: false,
        headers: { 'Content-Length': String(file.fileSize) },
      }, error => {
        if (!error) {
          void CardRedemptionService.markLocalDownloadCompleted(file.grantId)
            .catch(logError => console.error('[CardRedeem] 本地下载完成状态保存失败:', logError));
        }
        if (error) {
          console.error('[CardRedeem] 本地文件传输失败:', error);
          if (!res.headersSent) {
            res.status(410)
              .set('Content-Type', 'text/plain; charset=utf-8')
              .send('下载失败，请回到提取页重试');
          }
        }
      });
    } catch (error) {
      console.error('[CardRedeem] 文件下载失败:', error);
      if (!res.headersSent) {
        return res.status(410)
          .set('Content-Type', 'text/plain; charset=utf-8')
          .send('下载链接已失效，请回到提取页重新操作');
      }
    }
  }
}
