import Transport from 'winston-transport';
import crypto from 'crypto';
import { config } from '../config';

export class FeishuErrorTransport extends Transport {
  private errorCache = new Map<string, number>();
  private readonly COOLDOWN_MS = 4 * 60 * 60 * 1000; // 相同错误 4 小时内只发送一次告警

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    // 本地/测试环境的错误不推送到飞书群，避免开发噪音淹没真实生产告警
    if (config.feishu.dataEnvironment === 'Test') return callback();

    // 立即回调，不阻塞日志流程
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (info.level === 'error' && config.feishu.errorWebhookUrl) {
      const { message, stack } = info;
      const content = stack || message || 'Unknown error';
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

      // 过滤掉 Node 实验性特性警告 (例如 ExperimentalWarning: The Fetch API is an experimental feature)
      if (contentStr.includes('ExperimentalWarning')) {
        return callback();
      }

      // 提取错误的第一行作为 Hash 的特征值，忽略经常变动的堆栈行号或内存地址
      const errorTitle = contentStr.split('\n')[0].trim();

      // 根据错误标题生成 Hash
      const hash = crypto.createHash('md5').update(errorTitle).digest('hex');
      const now = Date.now();
      const lastSent = this.errorCache.get(hash);

      // 如果未发送过，或距离上次发送超过冷却时间，则发送告警
      if (!lastSent || now - lastSent > this.COOLDOWN_MS) {
        this.errorCache.set(hash, now);
        this.cleanCache(now);

        this.sendToFeishu(info).catch(err => {
          // 防止由于飞书发送失败导致循环报错，这里使用 process.stderr 直接输出
          process.stderr.write(`[FeishuErrorTransport] 发送报错日志至飞书失败: ${err}\n`);
        });
      }
    }

    callback();
  }

  private cleanCache(now: number) {
    // 超过一定数量时进行清理，防止内存泄漏
    if (this.errorCache.size > 500) {
      for (const [key, timestamp] of this.errorCache.entries()) {
        if (now - timestamp > this.COOLDOWN_MS) {
          this.errorCache.delete(key);
        }
      }
      // 如果清理后依然很大，强制清除最早存入的一半数据
      if (this.errorCache.size > 500) {
        let i = 0;
        for (const key of this.errorCache.keys()) {
          this.errorCache.delete(key);
          if (++i >= 250) break;
        }
      }
    }
  }

  private async sendToFeishu(info: any) {
    const { message, timestamp, stack } = info;
    const content = stack || message;

    const now_timestamp = Math.floor(Date.now() / 1000).toString();
    let sign = '';

    if (config.feishu.errorWebhookSecret) {
      const string_to_sign = `${now_timestamp}\n${config.feishu.errorWebhookSecret}`;
      const hmac = crypto.createHmac('sha256', string_to_sign);
      hmac.update('');
      sign = hmac.digest('base64');
    }

    const cardMessage = {
      msg_type: "interactive",
      card: {
        config: {
          wide_screen_mode: true
        },
        header: {
          title: {
            tag: "plain_text",
            content: `博客后端异常告警`
          },
          template: "red"
        },
        elements: [
          {
            tag: "div",
            fields: [
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**时间：**\n${timestamp || new Date().toISOString()}`
                }
              },
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**环境：**\n${process.env.NODE_ENV || 'development'}`
                }
              }
            ]
          },
          {
            tag: "hr"
          },
          {
            tag: "markdown",
            content: `**错误详情：**\n${content}`
          }
        ]
      }
    };

    const requestBody: any = {
      timestamp: now_timestamp,
      sign: sign,
      msg_type: "interactive",
      card: cardMessage.card
    };

    await fetch(config.feishu.errorWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
  }
}
