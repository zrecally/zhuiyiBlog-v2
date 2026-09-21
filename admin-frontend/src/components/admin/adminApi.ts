import { apiRequest, type ApiOptions } from '../common/apiUtils';
import { reportOperationTrace } from '../common/operationTrace';
import {
  AccessRequest,
  AdminComment,
  AdminHealth,
  AdminStats,
  AdminUser,
  ApiResult,
  AuditLog,
  Danmaku,
  Friend,
  NodeStatus,
  ProductPollDefinition,
  ProductPollResults,
  StaticPublishRequestResult,
  StaticPublishStatus,
} from './adminTypes';

const getAdminToken = () => localStorage.getItem('admin_token') || '';

export type AdminLoginPayload = {
  success: boolean;
  message?: string;
  token?: string;
  isTotpSetup?: boolean;
  requireTotp?: boolean;
};

const adminRequest = async <T>(path: string, init: Omit<ApiOptions, 'token'> = {}) => {
  return apiRequest<T>(path, {
    ...init,
    token: getAdminToken(),
  });
};

export const adminApi = {
  async getHealth() {
    const startedAt = Date.now();
    const data = await adminRequest<AdminHealth>('/api/admin/health');
    return { ok: true, data: { ...data, latency: Date.now() - startedAt } };
  },

  // --- 节点管理、系统配置新接口 ---
  getNodesStatus: () => adminRequest<ApiResult<NodeStatus[]>>('/api/admin/nodes/status'),
  getSystemConfig: () => adminRequest<ApiResult<Record<string, string | boolean>>>('/api/admin/system/config'),
  updateSystemConfig: (configs: Record<string, string | boolean>) => adminRequest<ApiResult>('/api/admin/system/config', {
    method: 'PUT',
    body: { configs },
  }),
  async uploadSiteFont(file: File): Promise<ApiResult<{ url: string; format: string; version: string }>> {
    const formData = new FormData();
    formData.append('file', file);
    const startedAt = Date.now();
    const operationId = `font-${startedAt}-${Math.floor(Math.random() * 1000)}`;
    reportOperationTrace({
      level: 'info',
      source: '控制面',
      message: '上传站点字体',
      detail: `请求已发送 · ${file.name}，正在由控制面校验并保存`,
      operationId,
      phase: 'start',
    });
    try {
      const response = await fetch('/api/admin/system/font', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: formData,
      });
      const result = await response.json() as ApiResult<{ url: string; format: string; version: string }>;
      if (!response.ok) {
        reportOperationTrace({
          level: 'error',
          source: '控制面',
          message: '上传站点字体',
          detail: `执行失败：${result.message || '字体上传失败'} · ${Date.now() - startedAt}ms`,
          operationId,
          phase: 'response',
        });
        throw new Error(result.message || '字体上传失败');
      }
      reportOperationTrace({
        level: 'success',
        source: '控制面',
        message: '上传站点字体',
        detail: `执行成功：字体已保存到持久卷 · ${Date.now() - startedAt}ms`,
        operationId,
        phase: 'response',
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message !== 'Failed to fetch') throw error;
      reportOperationTrace({
        level: 'error',
        source: '控制面',
        message: '上传站点字体',
        detail: `执行失败：网络错误 · ${error instanceof Error ? error.message : '连接失败'} · ${Date.now() - startedAt}ms`,
        operationId,
        phase: 'response',
      });
      throw error;
    }
  },
  // 原有旧接口调整路径为直接访问 /api/admin/...
  clearCache: () => adminRequest<ApiResult>('/api/admin/cache/clear', { method: 'POST' }),
  getStaticSiteStatus: () => adminRequest<ApiResult<StaticPublishStatus>>('/api/admin/static-site/status'),
  publishStaticSite: () => adminRequest<ApiResult<StaticPublishRequestResult>>('/api/admin/static-site/publish', { method: 'POST' }),
  getDanmakus: () => adminRequest<ApiResult<Danmaku[]>>('/api/admin/danmaku'),
  deleteDanmaku: (id: number) => adminRequest<ApiResult>(`/api/admin/danmaku/${id}`, { method: 'DELETE' }),
  getComments: () => adminRequest<ApiResult<AdminComment[]>>('/api/admin/comments'),
  deleteComment: (id: number) => adminRequest<ApiResult>(`/api/admin/comments/${id}`, { method: 'DELETE' }),
  getAuditLogs: () => adminRequest<ApiResult<AuditLog[]>>('/api/admin/audit-logs?limit=50'),
  getAccessRequests: () => adminRequest<ApiResult<AccessRequest[]>>('/api/admin/access-requests'),
  getStats: () => adminRequest<AdminStats>('/api/admin/stats'),
  getProductPoll: () => adminRequest<ApiResult<{ definition: ProductPollDefinition; results: ProductPollResults }>>('/api/admin/poll'),
  updateProductPoll: (definition: ProductPollDefinition) => adminRequest<ApiResult<{ definition: ProductPollDefinition; results: ProductPollResults }>>('/api/admin/poll', {
    method: 'PUT',
    body: { definition },
  }),
  getUsers: () => adminRequest<{ success: boolean; users?: AdminUser[] }>('/api/admin/users'),
  getFriends: () => adminRequest<ApiResult<Friend[]>>('/api/admin/friends'),
  syncModule: (module: string) => adminRequest<ApiResult>(`/api/admin/sync/${module}`, { method: 'POST' }),
  startTotpSetup: () => adminRequest<ApiResult & { qrCodeUrl?: string; secret?: string }>('/api/admin/totp/setup', { method: 'POST' }),
  verifyTotp: (token: string) => adminRequest<ApiResult>('/api/admin/totp/verify', {
    method: 'POST',
    body: { token },
  }),
  async login(username: string, password: string, totpCode: string): Promise<{ ok: boolean; status: number; data: AdminLoginPayload }> {
    try {
      const data = await apiRequest<AdminLoginPayload>('/api/admin/login', {
        method: 'POST',
        body: { username, password, totpCode },
      });
      return { ok: true, status: 200, data };
    } catch (error: unknown) {
      const failure = error && typeof error === 'object'
        ? error as { status?: number; data?: { success?: boolean; message?: string; requireTotp?: boolean }; message?: string }
        : {};
      // 透传后端的错误对象，特别是 requireTotp 字段，保证 TOTP 流程正常工作
      if (failure.status === 401 && failure.data) {
        return {
          ok: false,
          status: 401,
          data: {
            success: false,
            message: failure.data.message || '登录失败',
            requireTotp: failure.data.requireTotp,
          },
        };
      }
      return { ok: false, status: 401, data: { success: false, message: failure.message || '登录失败' } };
    }
  },
};
