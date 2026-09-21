import * as RateLimitMiddleware from '../middlewares/RateLimitMiddleware';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { probeConfiguredHttpsEndpoint, probeMtlsProxy } from '../services/NodeMonitorService';
import { FeishuSyncService } from '../services/FeishuSyncService';
import { securityUtils } from '../utils/SecurityUtils';
import { Request, Response } from 'express';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { prisma } from '../core/Database';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import {
  filterFeishuRecordsForCurrentEnvironment,
  isFeishuEnvironmentMatch,
} from '../utils/FeishuEnvironment';
import { IpUtils } from '../utils/IpUtils';
import { AUDIT_CATEGORY_PREFIXES } from '../utils/AuditTrail';
import {
  getProductPollDefinition,
  saveProductPollDefinition,
  aggregateProductPollResults,
  PRODUCT_POLL_ID,
} from '../services/PollService';

function getSystemMetrics() {
  const memoryUsage = process.memoryUsage();
  let totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  let usedMemMB = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (totalMatch && availMatch) {
        const totalKb = parseInt(totalMatch[1], 10);
        const availKb = parseInt(availMatch[1], 10);
        totalMemMB = Math.round(totalKb / 1024);
        usedMemMB = Math.round((totalKb - availKb) / 1024);
      }
    }
  } catch {
    // fallback
  }

  const cpus = os.cpus();
  const cpuCores = cpus.length || 1;
  const loadAvg = os.loadavg();
  let cpuUsagePercent = Math.round((loadAvg[0] / cpuCores) * 10000) / 100;
  cpuUsagePercent = Math.max(0, Math.min(100, cpuUsagePercent));

  return {
    totalMemMB,
    usedMemMB,
    processMemoryMB: Math.round(memoryUsage.rss / 1024 / 1024),
    cpuLoad: loadAvg,
    cpuUsagePercent,
    cpuCores,
  };
}

// 节点监控明细辅助：ISO 时间缩短、运行时长人性化、探针目标主机名
function formatIsoShort(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function humanizeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时 ${mins % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

function hostOf(url: string | undefined): string {
  if (!url) return '未配置';
  try {
    return new URL(url).host;
  } catch {
    return '—';
  }
}

export class AdminController {
  public static async handleGet0(req: Request, res: Response) {
  try {
    const [stat, userCount, commentCount, danmakuCount] = await Promise.all([
      prisma.siteStat.findUnique({ where: { id: 1 } }),
      prisma.user.count(),
      prisma.comment.count(),
      prisma.danmaku.count(),
    ]);

    // 计算在线人数（5分钟内有活动的IP数）
    const now = Date.now();
    let onlineCount = 0;
    for (const [ip, time] of RateLimitMiddleware.activeSessions.entries()) {
      if (now - time < 5 * 60 * 1000) {
        onlineCount++;
      } else {
        RateLimitMiddleware.activeSessions.delete(ip); // 清理过期 session
      }
    }

    let isTotpSetup = false;
    if (req.user && req.user!.role === 'admin') {
      const admin = await prisma.admin.findUnique({ where: { id: req.user!.id } });
      isTotpSetup = admin?.isTotpSetup || false;
    }

    res.json({
      success: true,
      views: stat?.views || 0,
      userCount,
      commentCount,
      danmakuCount,
      interactionCount: commentCount + danmakuCount,
      // 这是当前 Node.js 实例在过去 5 分钟见到的去重 IP，不是跨实例并发数。
      onlineCount,
      onlineWindowSeconds: 5 * 60,
      onlineScope: 'current_instance',
      isTotpSetup,
    });
  } catch (error) {
    console.error("获取统计数据失败:", error);
    res.status(500).json({ success: false });
  }
  }

  public static async handlePost1(req: Request, res: Response) {
  // 空/非法 body 防御：缺失时返回 400 而不是解构崩溃 500
  const { username: rawUsername, password, totpCode } = req.body ?? {};
  if (typeof rawUsername !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: '无效的请求' });
  }
  // 用户名去除首尾空白：避免输入法误带空格导致飞书环境查询查不到记录
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : rawUsername;

  try {
    // 每次登录前，如果是通过飞书管理管理员的模式，先去飞书检查该账号是否被禁用 (Active 为 false)
    if (config.admin.feishuPrecheckEnabled && feishuClient && config.feishu.baseToken && config.feishu.tables.admins && config.feishu.tables.admins !== "在这里填入管理员表的_Table_ID") {
      try {
        const feishuRes = await feishuClient.bitable.appTableRecord.list({
          path: {
            app_token: config.feishu.baseToken as string,
            table_id: config.feishu.tables.admins,
          },
          params: {
            filter: `CurrentValue.[Username]="${username}"`,
          },
        });

        const environmentAdmins = filterFeishuRecordsForCurrentEnvironment(feishuRes.data?.items || []);
        console.log('[Auth][debug] 飞书管理员预检 username=%s 环境=%s 命中=%d', username, config.feishu.dataEnvironment, environmentAdmins.length);
        if (environmentAdmins.length === 0) {
          return res.status(403).json({ success: false, message: '当前数据环境未配置该管理员账号' });
        } else {
          const record = environmentAdmins[0];
          const isActive = record.fields.Active !== false; // 默认或者没填都算激活
          if (!isActive) {
            return res.status(403).json({ success: false, message: '该管理员账号已被禁用' });
          }
        }
      } catch (error) {
        console.error("[Auth] 检查飞书管理员状态失败:", error);
        // 为了不因为网络问题阻断正常登录，这里静默失败，继续走本地验证
      }
    }

    const admin = await prisma.admin.findUnique({
      where: { username }
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    if (!admin.isActive) {
      return res.status(403).json({ success: false, message: '该账号已被封禁' });
    }

    // 校验密码是否匹配 (兼容老明文密码，以及新哈希密码)
    let isPasswordMatch = false;
    if (admin.password.startsWith('$2a$') || admin.password.startsWith('$2b$')) {
      isPasswordMatch = await bcrypt.compare(password, admin.password);
    } else {
      // 旧的明文密码，验证通过后应当帮他升级为 bcrypt 哈希
      isPasswordMatch = (admin.password === password);
      if (isPasswordMatch) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        await prisma.admin.update({
          where: { id: admin.id },
          data: { password: hashedPassword }
        });
      }
    }

    if (!isPasswordMatch) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // 检查是否已经启用了 TOTP
    if (admin.isTotpSetup && admin.totpSecret) {
      // 启用了 TOTP，必须验证 6 位验证码
      if (!totpCode || typeof totpCode !== 'string') {
        return res.status(401).json({
          success: false,
          requireTotp: true, // 告诉前端，密码对了，现在需要弹框让输入 TOTP
          message: '需要输入两步验证动态码'
        });
      }

      // 清洗动态码（去除空格、连字符等常见 Authenticator 格式符号）并放宽容差 window = 2 (+/- 60s)
      const cleanTotp = String(totpCode).trim().replace(/\s+/g, '').replace(/-/g, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isValid = speakeasy.totp.verify({ token: cleanTotp, secret: admin.totpSecret, encoding: 'base32', window: 2 } as any);

      if (!isValid) {
        return res.status(401).json({ success: false, message: '动态验证码错误或已过期' });
      }
    }

    // 密码和 TOTP (如果有) 都验证通过，签发 JWT
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: 'admin' },
      config.jwtSecret,
      { expiresIn: '60m' }
    );

    res.json({
      success: true,
      message: '登录成功，欢迎回来，指挥官！',
      token,
      isTotpSetup: admin.isTotpSetup // 告诉前端是否已经绑定，方便前端展示“去绑定”的按钮
    });

  } catch (error) {
    console.error("管理员登录失败:", error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
  }

  public static async handlePost2(req: Request, res: Response) {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { id: req.user!.id } });
    if (!admin) return res.status(404).json({ success: false, message: '管理员不存在' });

    // 1. 生成新的 Secret
    const secretObj = speakeasy.generateSecret({ name: 'ZuiYi Blog Admin' });
    const secret = secretObj.base32;

    // 2. 生成 otpauth URL (明确指定 base32 格式，供 App 扫码)
    const otpauthUrl = speakeasy.otpauthURL({ secret: secret, label: admin.username, issuer: 'ZuiYi Blog Admin', encoding: 'base32' });

    // 3. 生成二维码的 Data URL (Base64)
    const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);

    // 4. 将 secret 暂时存入数据库（但还未激活）
    await prisma.admin.update({
      where: { id: admin.id },
      data: { totpSecret: secret }
    });

    res.json({
      success: true,
      qrCodeUrl,
      secret, // 也返回明文，方便无法扫码时手动输入
      message: '请使用 Google Authenticator 或 Microsoft Authenticator 扫描二维码'
    });
  } catch (error) {
    console.error("生成 TOTP 失败:", error);
    res.status(500).json({ success: false, message: '生成失败' });
  }
  }

  public static async handlePost3(req: Request, res: Response) {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }

  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: '请输入有效的动态验证码' });

  try {
    const admin = await prisma.admin.findUnique({ where: { id: req.user!.id } });
    if (!admin || !admin.totpSecret) {
      return res.status(400).json({ success: false, message: '未找到密钥信息，请先生成' });
    }

    // 清洗 token 并放宽容差 window = 2 (+/- 60s)
    const cleanToken = String(token).trim().replace(/\s+/g, '').replace(/-/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = speakeasy.totp.verify({ token: cleanToken, secret: admin.totpSecret, encoding: 'base32', window: 2 } as any);

    if (isValid) {
      // 验证成功，正式激活 TOTP
      await prisma.admin.update({
        where: { id: admin.id },
        data: { isTotpSetup: true }
      });
      res.json({ success: true, message: '两步验证绑定成功！以后登录将需要动态验证码。' });
    } else {
      res.status(400).json({ success: false, message: '验证码不正确，绑定失败' });
    }
  } catch (error) {
    console.error("激活 TOTP 失败:", error);
    res.status(500).json({ success: false, message: '激活失败' });
  }
  }

  public static async handleGet4(req: Request, res: Response) {
  if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });

  if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.requests) {
    return res.json({ success: true, data: [] });
  }

  try {
    const response = await feishuClient.bitable.appTableRecord.list({
      path: {
        app_token: config.feishu.baseToken,
        table_id: config.feishu.tables.requests,
      },
      params: {
        sort: `["Date DESC"]` // 使用创建时间排序
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let enrichedRequests: any[] = [];
    if (response.data && response.data.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enrichedRequests = filterFeishuRecordsForCurrentEnvironment(response.data.items).map((record: any) => {
        const fields = record.fields;
        return {
          id: record.record_id,
          userId: fields['UserID'] ? String(fields['UserID']) : '未知用户',
          user: { username: fields['Username'] ? String(fields['Username']) : '未知用户' },
          postId: fields['PostID'] ? String(fields['PostID']) : '',
          postTitle: fields['PostTitle'] ? String(fields['PostTitle']) : '未知文章',
          status: fields['Status'] ? String(fields['Status']) : 'pending',
          createdAt: record.last_modified_time || Date.now()
        };
      });
    }

    res.json({ success: true, data: enrichedRequests });
  } catch (error) {
    console.error("获取申请列表失败:", error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
  }

  public static async handlePut5(req: Request, res: Response) {
  res.status(403).json({ success: false, message: '请直接在 Feishu 中修改申请状态' });
  }

  public static async getHealth(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const databaseStartedAt = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const databaseLatencyMs = Date.now() - databaseStartedAt;

      const sysMetrics = getSystemMetrics();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: { status: 'connected', latencyMs: databaseLatencyMs },
        system: {
          memoryUsageMB: sysMetrics.usedMemMB,
          memoryTotalMB: sysMetrics.totalMemMB,
          processMemoryMB: sysMetrics.processMemoryMB,
          cpuLoad: sysMetrics.cpuLoad,
          cpuUsagePercent: sysMetrics.cpuUsagePercent,
          cpuCores: sysMetrics.cpuCores,
        },
      });
    } catch (error) {
      console.error("[Health] 健康检查失败:", error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: '数据库健康检查失败',
      });
    }
  }

  public static async getAuditLogs(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      // 游标分页（cursor 为上一页最后一条 id）+ 可选 category 前缀过滤；
      // 不带新参数时行为与旧版一致（默认 100 条），data 字段向后兼容。
      const limitRaw = Number(req.query.limit);
      const limit = Number.isSafeInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 100;
      const cursorRaw = Number(req.query.cursor);
      const cursor = Number.isSafeInteger(cursorRaw) && cursorRaw > 0 ? cursorRaw : null;
      const category = typeof req.query.category === 'string' ? req.query.category : '';
      const prefixes = AUDIT_CATEGORY_PREFIXES[category];
      const actionFilter = prefixes ? { OR: prefixes.map(p => ({ action: { startsWith: p } })) } : undefined;
      const where = {
        ...(cursor ? { id: { lt: cursor } } : {}),
        ...(actionFilter ? { AND: [actionFilter] } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [page, total] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).auditLog.count({ where: actionFilter ? { AND: [actionFilter] } : {} }),
      ]);
      const hasMore = page.length > limit;
      const logs = hasMore ? page.slice(0, limit) : page;
      const lastLog = logs[logs.length - 1];
      res.json({
        success: true,
        data: logs,
        total,
        hasMore,
        nextCursor: hasMore && lastLog ? lastLog.id : null,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: '获取审计日志失败' });
    }
  }

  public static async getComments(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const limit = Number(req.query.limit) || 200;
      const comments = await prisma.comment.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: {
              username: true,
              email: true,
              avatar: true
            }
          },
          // @ts-ignore
          parent: {
            select: {
              content: true,
              user: {
                select: {
                  username: true
                }
              }
            }
          }
        }
      });
      res.json({ success: true, data: comments });
    } catch (error) {
      res.status(500).json({ success: false, message: '获取评论失败' });
    }
  }

  public static async deleteComment(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const id = parseInt(req.params.id as string);

      // 先查询出该评论，看是否有关联的飞书 recordId
      const targetComment = await prisma.comment.findUnique({
        where: { id }
      });

      if (!targetComment) {
        return res.status(404).json({ success: false, message: '评论不存在' });
      }

      // 执行删除。由于 Prisma schema 中配置了 onDelete: Cascade，子孙评论会被数据库自动一并删除
      await prisma.comment.delete({ where: { id } });

      // 同步删除飞书多维表格中的记录
      if (targetComment.feishuRecordId) {
        import('../core/FeishuClient').then(async ({ feishuClient }) => {
          import('../config').then(async ({ config }) => {
            if (feishuClient && config.feishu.baseToken && config.feishu.tables.comments) {
              try {
                const remoteRecord = await feishuClient.bitable.appTableRecord.get({
                  path: {
                    app_token: config.feishu.baseToken,
                    table_id: config.feishu.tables.comments,
                    record_id: targetComment.feishuRecordId as string,
                  },
                });
                if (!remoteRecord.data?.record || !isFeishuEnvironmentMatch(remoteRecord.data.record.fields)) {
                  console.warn('[AdminController] 跳过删除不属于当前环境的飞书评论记录');
                  return;
                }
                await feishuClient.bitable.appTableRecord.delete({
                  path: {
                    app_token: config.feishu.baseToken,
                    table_id: config.feishu.tables.comments,
                    record_id: targetComment.feishuRecordId as string
                  }
                });
                console.log(`[AdminController] 飞书评论记录同步删除成功: ${targetComment.feishuRecordId}`);
              } catch (e) {
                console.error(`[AdminController] 飞书评论记录同步删除失败:`, e);
              }
            }
          });
        });
      }

      res.json({ success: true, message: '删除成功，级联子评论已清除' });
    } catch (error) {
      res.status(500).json({ success: false, message: '删除失败' });
    }
  }

  public static async clearCache(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const { cacheService } = await import('../services/CacheService');
      cacheService.postsCache = null;
      cacheService.lastCacheTime = 0;
      cacheService.configCache = null;
      cacheService.lastConfigCacheTime = 0;
      cacheService.friendsCache = null;
      cacheService.lastFriendsCacheTime = 0;
      cacheService.projectsCache = null;
      cacheService.lastProjectsCacheTime = 0;
      cacheService.timelineCache = null;
      cacheService.lastTimelineCacheTime = 0;
      cacheService.commentsCache = {};
      cacheService.commentsLastFetch = {};

      // 可以记录审计日志
      const clientIp = req.headers['x-forwarded-for'] ? (req.headers['x-forwarded-for'] as string).split(',')[0] : (req.ip || 'unknown');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).auditLog.create({
        data: {
          ip: clientIp,
          action: 'CLEAR_CACHE',
          details: `管理员手动强制清理了系统内存缓存`
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).catch((e: any) => console.error(e));

      res.json({ success: true, message: '缓存清理成功' });
    } catch (error) {
      res.status(500).json({ success: false, message: '缓存清理失败' });
    }
  }

  public static async deleteDanmaku(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const id = parseInt(req.params.id as string);
      await prisma.danmaku.delete({ where: { id } });
      res.json({ success: true, message: '删除成功' });
    } catch (error) {
      res.status(500).json({ success: false, message: '删除失败' });
    }
  }

  public static async getDanmakus(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const limit = Number(req.query.limit) || 200;
      const danmakus = await prisma.danmaku.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      res.json({ success: true, data: danmakus });
    } catch (error) {
      res.status(500).json({ success: false, message: '获取失败' });
    }
  }

  // --- 新增的控制台 V2 真实数据接口 ---

  /**
   * 聚合所有节点的真实运行状态与心跳信息
   */
  public static async getNodesStatus(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });

    try {
      // 1. 数据库状态测试：连通性 + 版本 + 活跃连接数
      const dbStart = Date.now();
      let dbStatus = 'offline';
      let dbVersion = '—';
      let dbThreads = '—';
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = 'online';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const versionRows = await prisma.$queryRaw<any[]>`SELECT VERSION() AS version`;
        dbVersion = String(versionRows?.[0]?.version ?? '—');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const threadRows = await prisma.$queryRaw<any[]>`SHOW STATUS LIKE 'Threads_connected'`;
        dbThreads = String(threadRows?.[0]?.Value ?? '—');
      } catch (e) {}
      const dbLatency = Date.now() - dbStart;

      // 2. Node.js 后端自身状态。没有“网络延迟”概念，使用本次检查时间表达状态。
      const sysMetrics = getSystemMetrics();

      // 3. 飞书使用真实 API 探针。缺少配置时必须明确显示为未配置。
      let feishuStatus: 'online' | 'warning' | 'not_configured' = 'not_configured';
      let feishuLatency: number | null = null;
      let feishuMessage = '未配置飞书探针所需凭据';
      if (feishuClient && config.feishu.baseToken) {
        const feishuStart = Date.now();
        try {
          await feishuClient.bitable.appTable.list({ path: { app_token: config.feishu.baseToken } });
          feishuStatus = 'online';
          feishuLatency = Date.now() - feishuStart;
          feishuMessage = '真实 API 探测成功';
        } catch (e) {
          feishuStatus = 'warning';
          feishuLatency = Date.now() - feishuStart;
          feishuMessage = 'API 探测失败';
        }
      }

      const [beijingStaticProbe, hkDynamicProbe, cloudflareProbe, proxyProbe] = await Promise.all([
        probeConfiguredHttpsEndpoint({
          url: process.env.MONITOR_BEIJING_STATIC_HEALTH_URL,
          expectedNode: 'beijing-static',
        }),
        probeConfiguredHttpsEndpoint({
          url: process.env.MONITOR_HK_DYNAMIC_HEALTH_URL,
          connectIp: process.env.MONITOR_HK_DYNAMIC_HEALTH_CONNECT_IP,
          expectedNode: 'hk-dynamic',
        }),
        probeConfiguredHttpsEndpoint({
          url: process.env.MONITOR_CLOUDFLARE_HEALTH_URL,
          requireCloudflare: true,
        }),
        probeMtlsProxy(),
      ]);
      const securityInitialization = securityUtils.getInitializationStatus();
      const syncRuntime = FeishuSyncService.getRuntimeStatus();
      const syncConfigured = Boolean(feishuClient && config.feishu.baseToken);
      const syncStatus = !syncConfigured
        ? 'not_configured'
        : syncRuntime.hasRecentFailure
          ? 'warning'
          : syncRuntime.latestSuccessAt
            ? 'online'
            : 'configured';
      const syncMessage = !syncConfigured
        ? '未配置飞书同步凭据'
        : syncRuntime.hasRecentFailure
          ? '最近一次同步任务失败，请查看后端日志'
          : syncRuntime.latestSuccessAt
            ? `最近一次同步成功：${syncRuntime.latestSuccessAt}`
            : '5 分钟周期任务已启用，等待首次完成';

      // 北京静态发布桥接状态（只读 status.json，读取失败不影响节点状态本身）
      let staticPublishDetails: { label: string; value: string }[] = [];
      try {
        const statusPath = process.env.STATIC_PUBLISH_STATUS_FILE || '/app/static-publish-status/status.json';
        if (fs.existsSync(statusPath)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const targets = Array.isArray(raw?.targets) ? raw.targets : [];
          staticPublishDetails = [
            { label: '最新版本', value: String(raw?.version ?? '—') },
            { label: '发布时间', value: formatIsoShort(raw?.publishedAt) },
            {
              label: '发布目标',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: targets.length
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? targets.map((t: any) => `${t?.name || t?.host || '?'}:${t?.state === 'published' ? 'OK' : 'FAIL'}`).join(' / ')
                : String(raw?.destination ?? '—'),
            },
          ];
        }
      } catch (e) {}

      // 敏感词规模从初始化消息提取（2099 词条 / 588 正则 / 60 拼音 / N 自定义）
      const sensitiveDetails: { label: string; value: string }[] = [];
      const countMatch = securityInitialization.message.match(/(\d+)\s*个词条、(\d+)\s*条正则、(\d+)\s*个拼音规则[；;]\s*控制台自定义\s*(\d+)\s*个词条/);
      if (countMatch) {
        sensitiveDetails.push(
          { label: '基础词条', value: `${countMatch[1]} 个` },
          { label: '正则规则', value: `${countMatch[2]} 条` },
          { label: '拼音规则', value: `${countMatch[3]} 个` },
          { label: '自定义词条', value: `${countMatch[4]} 个` },
        );
      }

      const nodes = [
        {
          id: 'beijing-static', name: '北京静态站 (Nginx)', type: '只读 Web 服务',
          status: beijingStaticProbe.status, latency: beijingStaticProbe.latency, checkedAt: new Date().toISOString(), isThirdParty: false,
          message: beijingStaticProbe.message,
          details: [
            { label: '探针目标', value: hostOf(process.env.MONITOR_BEIJING_STATIC_HEALTH_URL) },
            { label: '探针方式', value: 'HTTPS 健康探针' },
            ...staticPublishDetails,
          ],
        },
        {
          id: 'backend', name: '后端服务 (Node.js)', type: 'API 服务',
          status: 'online', latency: null, checkedAt: new Date().toISOString(), isThirdParty: false,
          details: [
            { label: '系统内存', value: `${sysMetrics.usedMemMB}MB / ${sysMetrics.totalMemMB}MB` },
            { label: '服务占用', value: `${sysMetrics.processMemoryMB}MB` },
            { label: '运行时长', value: humanizeDuration(process.uptime()) },
            { label: 'Node 版本', value: process.version },
            { label: '数据环境', value: config.feishu.dataEnvironment },
          ]
        },
        {
          id: 'database', name: '主数据库 (MySQL)', type: '持久层',
          status: dbStatus, latency: dbLatency, checkedAt: new Date().toISOString(), isThirdParty: false,
          details: [
            { label: '连接状态', value: dbStatus === 'online' ? '正常' : '异常' },
            { label: '数据库版本', value: dbVersion },
            { label: '活跃连接', value: dbThreads },
          ]
        },
        {
          id: 'sensitive-words', name: '敏感词词库', type: '运行时初始化',
          status: securityInitialization.status, latency: null, checkedAt: securityInitialization.loadedAt, isThirdParty: false,
          message: securityInitialization.message,
          details: sensitiveDetails,
        },
        {
          id: 'feishu-sync', name: '核心数据同步', type: '定时任务',
          status: syncStatus, latency: null, checkedAt: new Date().toISOString(), isThirdParty: false,
          message: syncMessage,
          details: [
            { label: '同步周期', value: '5 分钟' },
            { label: '受管任务', value: `${syncRuntime.trackedTaskCount} 项` },
            { label: '最近成功', value: formatIsoShort(syncRuntime.latestSuccessAt) },
            { label: '最近失败', value: formatIsoShort(syncRuntime.latestFailureAt) },
          ],
        },
        {
          id: 'hk-dynamic', name: '香港动态站 (Nginx)', type: '交互 Web 服务',
          status: hkDynamicProbe.status, latency: hkDynamicProbe.latency, checkedAt: new Date().toISOString(), isThirdParty: false,
          message: hkDynamicProbe.message,
          details: [
            { label: '探针目标', value: hostOf(process.env.MONITOR_HK_DYNAMIC_HEALTH_URL) },
            { label: '探针方式', value: 'HTTPS 健康探针' },
          ],
        },
        {
          id: 'feishu', name: '飞书开放平台', type: '三方服务',
          status: feishuStatus, latency: feishuLatency, checkedAt: new Date().toISOString(), isThirdParty: true,
          message: feishuMessage,
          details: [
            { label: '探针方式', value: '真实 API (bitable)' },
            { label: '数据环境', value: config.feishu.dataEnvironment },
          ],
        },
        ...(process.env.MTLS_PROXY_ENABLED === 'true' ? [{
          id: 'proxy', name: 'mTLS 第三方代理', type: '受控出站网关',
          status: proxyProbe.status, latency: proxyProbe.latency, checkedAt: new Date().toISOString(), isThirdParty: true,
          message: proxyProbe.message,
          details: [
            { label: '探针方式', value: 'mTLS 双向认证' },
          ],
        }] : []),
        {
          id: 'cf', name: 'Cloudflare WAF', type: '网关/CDN',
          status: cloudflareProbe.status, latency: cloudflareProbe.latency, checkedAt: new Date().toISOString(), isThirdParty: true,
          message: cloudflareProbe.message,
          details: [
            { label: '探针目标', value: hostOf(process.env.MONITOR_CLOUDFLARE_HEALTH_URL) },
            { label: '探针方式', value: 'HTTPS + CF 头校验' },
          ],
        }
      ];

      res.json({ success: true, data: nodes });
    } catch (error) {
      console.error('获取节点状态失败:', error);
      res.status(500).json({ success: false, message: '获取节点状态失败' });
    }
  }

  /**
   * 获取用户列表
   */
  public static async getUsers(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      // 用户管理以当前环境的飞书表为准：先拉取、按邮箱去重，再只展示该快照对应的本地记录。
      // 飞书不可达时不回退为全量本地表，避免将历史/测试账号误呈现为线上用户。
      const syncResult = await FeishuSyncService.syncUsersFromFeishuToLocal();
      if (!syncResult) {
        return res.status(503).json({ success: false, message: '飞书用户表未配置，无法加载权威用户快照' });
      }

      const users = await prisma.user.findMany({
        where: { email: { in: syncResult.emails } },
        orderBy: { createdAt: 'desc' }
      });
      const usersWithLoginProvider = users.map((user) => ({
        ...user,
        loginProvider: syncResult.providers[user.email.toLowerCase()] || '',
      }));
      res.json({ success: true, users: usersWithLoginProvider, source: 'feishu', count: syncResult.retained });
    } catch (error) {
      console.error("获取飞书用户快照失败:", error);
      res.status(502).json({ success: false, message: '飞书用户快照同步失败，请稍后重试' });
    }
  }

  /**
   * 获取系统配置
   */
  public static async getSystemConfig(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const configs = await prisma.systemConfig.findMany();
      const configMap = configs.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      // 获取当前管理员的 TOTP 状态
      const admin = await prisma.admin.findUnique({ where: { id: req.user!.id } });

      res.json({
        success: true,
        data: {
          totp_enabled: admin?.isTotpSetup || false,
          sensitive_words: configMap['sensitive_words'] || '',
          custom_font_url: configMap['custom_font_url'] || '',
        }
      });
    } catch (error) {
      console.error('获取系统配置失败:', error);
      res.status(500).json({ success: false, message: '获取系统配置失败' });
    }
  }

  /**
   * 更新系统配置
   */
  public static async updateSystemConfig(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const { configs } = req.body;
      if (!configs || typeof configs !== 'object') {
        return res.status(400).json({ success: false, message: '参数格式不正确' });
      }

      const keys = Object.keys(configs);
      if (keys.length !== 1 || keys[0] !== 'sensitive_words' || typeof configs.sensitive_words !== 'string') {
        return res.status(400).json({ success: false, message: '当前仅支持更新敏感词配置' });
      }

      const customWordCount = securityUtils.setCustomSensitiveWords(configs.sensitive_words);
      await prisma.systemConfig.upsert({
        where: { key: 'sensitive_words' },
        update: { value: configs.sensitive_words },
        create: { key: 'sensitive_words', value: configs.sensitive_words },
      });

      // 记录审计日志
      const clientIp = IpUtils.getClientIp(req);
      await prisma.auditLog.create({
        data: {
          ip: clientIp,
          action: 'SYSTEM_CONFIG_UPDATE',
          details: `管理员更新了敏感词配置：${customWordCount} 个自定义词条`
        }
      });

      res.json({ success: true, message: `敏感词配置已生效（${customWordCount} 个自定义词条）` });
    } catch (error) {
      console.error('更新系统配置失败:', error);
      res.status(500).json({ success: false, message: '更新系统配置失败' });
    }
  }

  /**
   * 获取投票配置与结果
   */
  public static async getProductPoll(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const definition = await getProductPollDefinition();
      const rows = await prisma.pollVote.findMany({
        where: { pollId: PRODUCT_POLL_ID },
        select: { selections: true },
      });
      const results = aggregateProductPollResults(rows);
      res.json({ success: true, data: { definition, results } });
    } catch (error) {
      console.error('获取投票配置失败:', error);
      res.status(500).json({ success: false, message: '获取投票配置失败' });
    }
  }

  /**
   * 更新投票配置
   */
  public static async updateProductPoll(req: Request, res: Response) {
    if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    try {
      const { definition } = req.body;
      if (!definition) return res.status(400).json({ success: false, message: '参数错误' });

      await saveProductPollDefinition(definition);

      const rows = await prisma.pollVote.findMany({
        where: { pollId: PRODUCT_POLL_ID },
        select: { selections: true },
      });
      const results = aggregateProductPollResults(rows);

      res.json({ success: true, data: { definition, results }, message: '投票配置已更新' });
    } catch (error) {
      console.error('更新投票配置失败:', error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : '更新投票配置失败' });
    }
  }
}
