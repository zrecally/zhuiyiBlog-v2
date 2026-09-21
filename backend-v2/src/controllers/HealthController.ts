import { Request, Response } from 'express';
import { Agent, request as undiciRequest } from 'undici';
import { prisma } from '../core/Database';

// 探测走公网跨境链路（香港→北京），冷连接握手实测 2~4s，必须复用连接，
// 否则每次探测都重新握手。keepAliveTimeout 需大于 30s 的探测间隔。
const staticSiteDispatcher = new Agent({
  keepAliveTimeout: 65_000,
  keepAliveMaxTimeout: 120_000,
  // undici v6 的 abort signal 在 connect 阶段不生效（实测卡死时由默认
  // 10s 连接超时兜底报 ConnectTimeoutError），连接预算必须在这里显式收紧
  connectTimeout: 4_000,
});

export class HealthController {
  public static async check(req: Request, res: Response) {
    try {
      // 1. 检查数据库连通性
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const dbLatency = Date.now() - dbStart;

      // 2. 检查静态站连通性 (探针)
      let staticSiteStatus = 'error';
      let staticSiteLatency = 0;
      try {
        const staticStart = Date.now();
        // 如果是测试环境（Docker 运行），则请求同网络下的 static_frontend 容器，否则请求线上地址
        const isTestEnv = process.env.FEISHU_DATA_ENV === 'Test';
        const targetUrl = isTestEnv ? 'http://static_frontend/healthz' : 'https://cn.hizhuiyi.cn/healthz';

        const controller = new AbortController();
        // 整体预算必须小于 docker healthcheck 的 5s timeout，否则探测卡顿
        // 会连带把整个容器拖成 unhealthy
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        try {
          // 用 request 而非 fetch：Node 18 的 web stream 与 undici 消费体不兼容
          const response = await undiciRequest(targetUrl, {
            signal: controller.signal,
            dispatcher: staticSiteDispatcher,
          });
          if (response.statusCode >= 200 && response.statusCode < 300) {
            staticSiteStatus = 'ok';
            staticSiteLatency = Date.now() - staticStart;
          }
          // 不消费响应体连接不会归还连接池，keep-alive 会失效
          await response.body.dump();
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (e) {
        // 静态站跨公网探测是辅助信号：失败时接口整体仍返回 200，只降级
        // 记录一行原因，不刷异常堆栈（晚高峰冷连接抖动属常态）
        console.warn('[HealthCheck] Static site unreachable:', e instanceof Error ? e.message : e);
      }

      const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: {
          status: 'connected',
          latencyMs: dbLatency
        },
        staticSite: {
          status: staticSiteStatus,
          latencyMs: staticSiteLatency
        }
      };

      res.status(200).json(healthData);
    } catch (error) {
      console.error('[HealthCheck] Failed:', error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: 'Service Unavailable'
      });
    }
  }
}
