import * as RateLimitMiddleware from '../middlewares/RateLimitMiddleware';
import { Request, Response } from 'express';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { prisma } from '../core/Database';
import { transporter } from '../core/MailClient';
import { IpUtils } from '../utils/IpUtils';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  filterFeishuRecordsForCurrentEnvironment,
} from '../utils/FeishuEnvironment';
import { FeishuIdentitySyncService } from '../services/feishu-sync/FeishuIdentitySyncService';

export class AuthController {
  public static async handleGet0(req: Request, res: Response) {
  const clientIp = IpUtils.getClientIp(req);

  let allowedIps: string[] = [];
  const now = Date.now();

  if (RateLimitMiddleware.getIpWhitelistCache() && (now - RateLimitMiddleware.getIpCacheTime() < RateLimitMiddleware.getIpCacheTtl())) {
    allowedIps = RateLimitMiddleware.getIpWhitelistCache() || [];
  } else if (feishuClient && config.feishu.baseToken && config.feishu.tables.ipWhitelist) {
    try {
      const response = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.ipWhitelist,
        },
        params: {
          page_size: 500,
        }
      });
      if (response.data && response.data.items) {
        allowedIps = filterFeishuRecordsForCurrentEnvironment(response.data.items)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((item: any) => item.fields && item.fields['Status'] === true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => {
            const ipField = item.fields['IP'];
            if (Array.isArray(ipField)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return ipField.map((f: any) => f.text).join('');
            }
            return ipField ? String(ipField) : '';
          })
          .map(ip => ip.trim())
          .filter(ip => ip);
      }

      RateLimitMiddleware.setIpWhitelistCache(allowedIps);
      console.log(`[API /api/auth/ip] 拉取到白名单:`, allowedIps);
    } catch (error) {
      console.error(`[API /api/auth/ip] 拉取白名单失败:`, error);
      allowedIps = RateLimitMiddleware.getIpWhitelistCache() || [];
    }
  }

  // 判断是否为局域网 IP
  const isLAN = (ip: string) => {
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;
    return false;
  };

  const isAllowed = isLAN(clientIp) || allowedIps.includes(clientIp);
  console.log(`[API /api/auth/ip] 判断客户端 IP: clientIp=${clientIp}, isAllowed=${isAllowed}`);

  res.json({
    success: true,
    ip: clientIp,
    isAllowed
  });
  }

  public static async handleGet1(req: Request, res: Response) {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权访问' });

    // 在返回列表前，先从 Feishu 同步一下，解决新部署服务器本地数据库无数据的问题
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FeishuSyncService } = require('../services/FeishuSyncService');
    await FeishuSyncService.syncUsersFromFeishuToLocal().catch((error: unknown) => {
      console.warn('[Users] 飞书同步失败，继续返回本地用户列表:', error);
    });

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error("获取用户列表失败:", error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
  }

  public static async handlePost2(req: Request, res: Response) {
  const { email, returnUrl } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }

  try {
    // 1. 生成唯一 token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. 15分钟后过期
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 3. 存入数据库
    await prisma.magicToken.create({
      data: { email: normalizedEmail, token: tokenHash, expiresAt }
    });

    // 4. 拼装登录链接
    // 为了防止 QQ 邮箱安全拦截（xmsafejump Invalid url），确保前端 URL 没有多余的斜杠
    let frontendUrl = config.frontendUrl;
    // 去除结尾可能存在的斜杠
    if (frontendUrl.endsWith('/')) {
      frontendUrl = frontendUrl.slice(0, -1);
    }

    // 将用户当前所在页面作为参数拼接到魔法链接中
    // 注意这里不能直接 encodeURIComponent 整个带查询参数的 URL，否则在解析时会导致嵌套的 query 丢失
    const safeReturnUrl = typeof returnUrl === 'string' && returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.includes('\\')
      ? returnUrl.slice(0, 2048)
      : '/';
    const magicLink = `${frontendUrl}/?magic_token=${token}&return_url=${encodeURIComponent(safeReturnUrl)}`;
    const htmlMagicLink = magicLink.replace(/&/g, '&amp;');

    // 5. 发送事务型登录邮件。保持内容简洁并提供 text/html 两种 MIME，
    // 避免重复展示超长 Token URL 被邮件服务商误判为推广或钓鱼内容。
    const mailOptions = {
      from: config.smtp.from,
      to: normalizedEmail,
      subject: 'ZhuiYi 账号登录确认',
      text: [
        '你刚刚请求登录 ZhuiYi。',
        '',
        `请在 15 分钟内打开以下一次性链接：${magicLink}`,
        '',
        '如果这不是你的操作，请忽略本邮件。'
      ].join('\n'),
      html: `
        <!doctype html>
        <html lang="zh-CN">
          <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin:0;padding:24px;background:#f6f7f8;color:#222;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
            <div style="max-width:520px;margin:0 auto;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
              <h1 style="margin:0 0 20px;font-size:20px;">ZhuiYi 账号登录确认</h1>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.7;">你刚刚请求登录 ZhuiYi。请在 15 分钟内使用下面的一次性链接完成确认。</p>
              <p style="margin:24px 0;text-align:center;">
                <a href="${htmlMagicLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:11px 28px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:5px;">继续登录</a>
              </p>
              <p style="margin:20px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">该链接只能使用一次。如果这不是你的操作，请忽略本邮件。</p>
            </div>
          </body>
        </html>
      `,
    };

    // 如果没有配置 SMTP，在控制台打印链接方便本地测试
    if (!config.smtp.enabled || !config.smtp.user || !config.smtp.pass || config.smtp.user.endsWith('@example.com')) {
      if (process.env.NODE_ENV === 'production') throw new Error('SMTP 未配置');
      console.log('⚠️ 未配置真实 SMTP；本地开发登录链接已生成。');
      console.log(magicLink);
    } else {
      try {
        await transporter.sendMail(mailOptions);
      } catch (mailError) {
        await prisma.magicToken.deleteMany({ where: { token: tokenHash } });
        throw mailError;
      }
    }

    res.json({ success: true, message: '魔法链接已发送到你的邮箱，请查收！' });
  } catch (error) {
    console.error("发送魔法链接失败:", error);
    res.status(500).json({ success: false, message: '邮件发送失败，请稍后再试' });
  }
  }

  public static async handlePost3(req: Request, res: Response) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: '无效的请求' });

  try {
    // 1. 先取出 email（仅用于后续登录流程）
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const magicRecord = await prisma.magicToken.findUnique({ where: { token: tokenHash } });

    if (!magicRecord) {
      return res.status(401).json({ success: false, message: '登录链接无效或已被使用' });
    }

    // 原子核销：带过期条件的删除成功才视为有效，并发提交同一 Token 只有第一个能通过（防重放）
    const deleted = await prisma.magicToken.deleteMany({
      where: { token: tokenHash, expiresAt: { gt: new Date() } }
    });

    if (deleted.count === 0) {
      // 若记录已过期，异步清理残留脏数据以减轻库表负担
      void prisma.magicToken.deleteMany({ where: { token: tokenHash } }).catch(() => {});
      return res.status(401).json({ success: false, message: '该登录链接已过期，请重新获取' });
    }

    const email = magicRecord.email;

    // 2. 查找用户，如果没有则自动注册（静默注册）
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // 提取邮箱前缀作为初始用户名
      const username = email.split('@')[0] + '_' + Math.floor(Math.random() * 1000);
      user = await prisma.user.create({
          data: {
            email,
            username,
            avatar: '/avatars/default.svg',
            avatarDark: '/avatars/default.svg'
          }
        });
    }

    // 检查本地用户的封禁状态
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: '您的账号已被封禁或禁止登录' });
    }

    // 3. 签发 JWT
    const jwtToken = jwt.sign(
      { id: user.id, username: user.username, role: 'user' },
      config.jwtSecret,
      { expiresIn: '60m' }
    );

    // 4. 按邮箱更新飞书中的唯一用户记录，避免每次登录都新增一行。
    FeishuIdentitySyncService.queueUserUpsertToFeishu(user, 'magic')
      .catch(err => console.error(`[Users] 同步用户最新状态到飞书失败:`, err));

    // 5. Token 已在上方原子删除，无需再次清理

    res.json({
      success: true,
      message: '登录成功！',
      token: jwtToken,
      user: { username: user.username, email: user.email, avatar: user.avatar, avatarDark: user.avatarDark }
    });
  } catch (error) {
    console.error("验证魔法链接失败:", error);
    res.status(500).json({ success: false, message: '服务器验证失败' });
  }
  }

  public static handleGet4(req: Request, res: Response) {
  res.json({
    success: true,
    role: req.user!.role,
    user: req.user
  });
  }

}
