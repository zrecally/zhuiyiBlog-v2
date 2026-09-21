import * as lark from '@larksuiteoapi/node-sdk';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';

// SDK 默认的 axios 实例对非 2xx 响应直接抛 AxiosError，错误消息只有
// "Request failed with status code 400" 一句，飞书写在响应体里的
// code/msg（定位问题的唯一权威线索）会全部丢失。这里换成自定义实例：
// 成功路径复刻 SDK 默认实例的解包行为（返回 resp.data），失败路径把
// 飞书错误体拼进异常消息。注意：不解包的话 SDK 拿到的是完整
// AxiosResponse，response.code 的判断会整体错位。
export const feishuHttpInstance = axios.create();
feishuHttpInstance.interceptors.request.use((req) => {
  if (req.headers && !req.headers['User-Agent']) {
    req.headers['User-Agent'] = 'zhuiyi-backend';
  }
  return req;
}, undefined, { synchronous: true });

// 飞书位表偶发 1254607（Data not ready：表格数据服务端短暂不可读，官方
// 建议稍后重试）与 1254290（限频）。同步任务均为只读且分钟级调度，对
// GET 做有界重试即可吸收瞬态失败、避免误报告警。重试必须合并在下方唯一
// 的 rejection 拦截器内：若单独注册 rejection 拦截器返回再请求的 promise，
// 内层已解包的响应会再经过外层解包拦截器，造成双重解包。$feishuNoAutoRetry
// 防止重试请求再次进入重试循环；写操作永不自动重发。
const TRANSIENT_FEISHU_CODES = new Set([1254607, 1254290]);
const FEISHU_RETRY_DELAYS_MS = [2000, 4000];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const readFeishuErrorCode = (data: unknown): number =>
  typeof data === 'object' && data !== null && 'code' in data ? Number((data as { code?: unknown }).code) : NaN;

feishuHttpInstance.interceptors.response.use((resp) => {
  if ((resp.config as unknown as Record<string, unknown>)['$return_headers']) {
    return { data: resp.data, headers: resp.headers } as unknown as AxiosResponse;
  }
  return resp.data;
}, async (error: AxiosError) => {
  const config = error?.response?.config as
    | (InternalAxiosRequestConfig & { $feishuNoAutoRetry?: boolean })
    | undefined;
  if (config?.method?.toLowerCase() !== 'get' || config.$feishuNoAutoRetry) {
    return describeFeishuHttpError(error);
  }
  let lastError = error;
  for (let attempt = 0; attempt < FEISHU_RETRY_DELAYS_MS.length; attempt++) {
    if (!TRANSIENT_FEISHU_CODES.has(readFeishuErrorCode(lastError.response?.data))) break;
    await sleep(FEISHU_RETRY_DELAYS_MS[attempt]);
    config.$feishuNoAutoRetry = true;
    try {
      return await feishuHttpInstance.request(config);
    } catch (retryError) {
      lastError = retryError as AxiosError;
    }
  }
  return describeFeishuHttpError(lastError);
});

function describeFeishuHttpError(error: AxiosError): Promise<never> {
  const response = error?.response;
  // 无 response 说明是网络层错误（超时/DNS/连接失败），没有错误体可读
  if (!response) {
    return Promise.reject(error);
  }
  const parts = [`飞书接口 HTTP ${response.status}`];
  const body = response.data;
  if (typeof body === 'object' && body !== null) {
    const { code, msg } = body as { code?: unknown; msg?: unknown };
    if (code !== undefined) parts.push(`code=${code}`);
    if (msg) parts.push(`msg=${String(msg).slice(0, 120)}`);
  } else if (typeof body === 'string' && body.trim()) {
    parts.push(`body=${body.trim().slice(0, 120)}`);
  }
  const method = (response.config?.method || '').toUpperCase();
  const url = response.config?.url || '';
  parts.push(`[${method} ${url}]`);
  error.message = parts.join(' ');
  return Promise.reject(error);
}

// FEISHU_BASE_TOKEN 与各 table_id 会被直接拼进 API 路径，一旦粘贴成完整
// 链接（含 ?table=&view=）或混入空白，飞书会直接返回 HTTP 400。启动时
// 提前把可疑配置点名，避免线上只能看到一句 "status code 400"。
const SAFE_FEISHU_ID = /^[A-Za-z0-9]{8,}$/;
const warnSuspiciousFeishuIds = () => {
  const candidates: Array<[string, string]> = [
    ['feishu.baseToken', config.feishu.baseToken],
    ...Object.entries(config.feishu.tables).map(([key, value]): [string, string] => [`feishu.tables.${key}`, value]),
  ];
  for (const [name, value] of candidates) {
    if (value && !SAFE_FEISHU_ID.test(value)) {
      console.warn(`[System] 飞书配置 ${name} 的值疑似不合法（应为纯字母数字 ID，而不是链接或含空白），API 可能返回 400: "${value.slice(0, 80)}"`);
    }
  }
};

class FeishuClientManager {
  private client: lark.Client | null = null;

  constructor() {
    if (config.feishu.appId && config.feishu.appSecret) {
      // @larksuiteoapi/node-sdk 内部已自动处理 tenant_access_token 的获取与无感刷新
      this.client = new lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        // SDK 的 HttpInstance 在类型上声明了"已解包响应体"的泛型契约，axios
        // 的 AxiosInstance 类型表达不了这一点，运行时行为由上面的拦截器保证
        httpInstance: feishuHttpInstance as unknown as lark.HttpInstance,
      });
      console.log('[System] 飞书 API 客户端初始化成功');
      warnSuspiciousFeishuIds();
    }
  }

  public getClient(): lark.Client | null {
    return this.client;
  }
}

export const feishuClientManager = new FeishuClientManager();
export const feishuClient = feishuClientManager.getClient();
