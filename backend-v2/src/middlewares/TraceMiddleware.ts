import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import fetch from 'node-fetch';
import { IpUtils } from '../utils/IpUtils';

/** Signed download tickets are bearer-like credentials and must never be sent
 * to application logs or alert webhooks. */
export const requestTargetForLogs = (req: Pick<Request, 'originalUrl'>): string => (
  req.originalUrl.replace(
    /(\/api\/v1\/cards\/download\/)[^/?#]+/,
    '$1[redacted]',
  )
);

export const traceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startHrTime = process.hrtime();

  // 监听 response 结束
  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const elapsedTimeInMs = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;

    // 1. 慢查询检测 (阈值 800ms)
    if (elapsedTimeInMs > 800) {
      const target = requestTargetForLogs(req);
      console.warn(`[Slow Query] ${req.method} ${target} took ${elapsedTimeInMs.toFixed(2)}ms`);

      // 可以推送到飞书报警
      if (config.feishu.errorWebhookUrl) {
        sendAlertToFeishu('⚠️ 接口慢查询告警', `**接口：** ${req.method} ${target}\n**耗时：** ${elapsedTimeInMs.toFixed(2)}ms\n**IP：** ${IpUtils.getClientIp(req)}`);
      }
    }

    // 2. 500 级别错误检测
    if (res.statusCode >= 500) {
      const target = requestTargetForLogs(req);
      console.error(`[Error Trace] ${req.method} ${target} failed with status ${res.statusCode}`);

      if (config.feishu.errorWebhookUrl) {
        sendAlertToFeishu('❌ 接口 500 异常告警', `**接口：** ${req.method} ${target}\n**状态码：** ${res.statusCode}\n**IP：** ${IpUtils.getClientIp(req)}`);
      }
    }
  });

  next();
};

function sendAlertToFeishu(title: string, content: string) {
  if (!config.feishu.errorWebhookUrl) return;

  const card = {
    msg_type: "interactive",
    card: {
      header: {
        title: { content: title, tag: "plain_text" },
        template: title.includes('500') ? "red" : "orange"
      },
      elements: [
        {
          tag: "markdown",
          content: content
        }
      ]
    }
  };

  fetch(config.feishu.errorWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card)
  }).catch(e => console.error('[TraceMiddleware] 发送报警失败:', e));
}
