/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from './admin/adminApi';
import { NodeStatus, type AdminStats } from './admin/adminTypes';
import { PollManagementPanel } from './admin/PollManagementPanel';
import { DataSyncPanel } from './DataSyncPanel';
import { useToast } from './Toast';
import { DashboardSidebar } from './dashboard/DashboardSidebar';
import { NodeManagementPanel } from './dashboard/NodeManagementPanel';
import { OverviewPanel } from './dashboard/OverviewPanel';
import { StaticSitePanel } from './dashboard/StaticSitePanel';
import type { DashboardHealthSnapshot, DashboardTab } from './dashboard/dashboardTypes';

const loginProviderLabel = (provider?: string) => ({
  github: 'GitHub 登录',
  magic: '魔法链接登录',
  google: 'Google 登录',
  facebook: 'Facebook 登录',
  discord: 'Discord 登录',
  microsoft: 'Microsoft 登录',
}[provider?.trim().toLowerCase() || ''] || '未记录');

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const { showToast, showConfirm } = useToast();

  // 状态管理
  const [mockHealth, setMockHealth] = useState<DashboardHealthSnapshot>({
    status: 'checking', latency: null,
    database: { status: 'unknown', latencyMs: null },
    system: { memoryUsageMB: null, cpuLoad: [] }
  });

  const [mockNodesData, setMockNodesData] = useState<NodeStatus[]>([]);
  const [mockStaticSitesData, setMockStaticSitesData] = useState<any[]>([]);
  const [mockSyncStatus, setMockSyncStatus] = useState<any>({ lastSyncTime: '', status: 'success', syncLogs: [] });
  const [systemConfig, setSystemConfig] = useState<any>({});
  const [mockStats, setMockStats] = useState<AdminStats>({ success: false, views: 0, userCount: 0, onlineCount: 0, interactionCount: 0 });
  const [totpSetupModal, setTotpSetupModal] = useState<{ isOpen: boolean; secret: string; qrcode: string }>({ isOpen: false, secret: '', qrcode: '' });
  const [totpCode, setTotpCode] = useState('');
  const [isFontUploading, setIsFontUploading] = useState(false);

  const [mockUsers, setMockUsers] = useState<any[]>([]);
  const [mockAuditLogs, setMockAuditLogs] = useState<any[]>([]);
  const [mockRequests, setMockRequests] = useState<any[]>([]);
  const [mockFriends, setMockFriends] = useState<any[]>([]);
  const [mockDanmakus, setMockDanmakus] = useState<any[]>([]);
  const [mockComments, setMockComments] = useState<any[]>([]);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);

  const applyStaticSiteStatus = useCallback((result: any) => {
    if (!result?.success || !result.data) return false;
    setMockStaticSitesData(result.data.sites || []);
    setMockSyncStatus(result.data.syncStatus || { lastSyncTime: '', status: 'success', syncLogs: [] });
    return true;
  }, []);

  const refreshStaticSiteStatus = useCallback(async (notifySuccess = true) => {
    try {
      const result = await adminApi.getStaticSiteStatus();
      if (applyStaticSiteStatus(result)) {
        if (notifySuccess) {
          showToast({ message: '静态站状态已刷新', type: 'success' });
        }
      } else {
        showToast({ message: `刷新静态站状态失败：${result.message || '后端未返回状态'}`, type: 'error' });
      }
    } catch (error: any) {
      if (error?.status === 401) {
        localStorage.removeItem('admin_token');
        window.location.href = '/admin/login';
        return;
      }
      showToast({ message: `刷新静态站状态失败：${error?.message || '网络错误'}`, type: 'error' });
    }
  }, [applyStaticSiteStatus, showToast]);

  const loadData = useCallback(async () => {
    setIsOverviewLoading(true);
    try {
      const handleApiError = (err: any, fallback: any) => {
        if (err?.status === 401) {
          localStorage.removeItem('admin_token');
          window.location.href = '/admin/login';
        }
        return fallback;
      };

      // 获取各个维度的真实数据
      const [
        nodesRes,
        configRes,
        staticSiteRes,
        healthRes,
        auditLogsRes,
        commentsRes,
        requestsRes,
        danmakusRes,
        usersRes,
        friendsRes,
        statsRes
      ] = await Promise.all([
        adminApi.getNodesStatus().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getSystemConfig().catch((err) => handleApiError(err, { success: false, data: {} })),
        adminApi.getStaticSiteStatus().catch((err) => handleApiError(err, { success: false, data: null })),
        adminApi.getHealth().catch((err) => handleApiError(err, { ok: false, data: null })),
        adminApi.getAuditLogs().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getComments().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getAccessRequests().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getDanmakus().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getUsers().catch((err) => handleApiError(err, { success: false, users: [] })),
        adminApi.getFriends().catch((err) => handleApiError(err, { success: false, data: [] })),
        adminApi.getStats().catch((err) => handleApiError(err, { success: false, views: 0, userCount: 0, onlineCount: 0 }))
      ]);

      if (nodesRes.success) setMockNodesData(nodesRes.data || []);
      if (usersRes.success) setMockUsers(usersRes.users || []);
      else setMockUsers([]);
      if (friendsRes.success) setMockFriends(friendsRes.data || []);
      if (statsRes.success) setMockStats(statsRes);
      if (configRes.success) setSystemConfig(configRes.data || {});

      applyStaticSiteStatus(staticSiteRes);

      if (healthRes.ok && healthRes.data) {
        const dbStatus = healthRes.data.database?.status || 'unknown';
        const memRss = healthRes.data.system?.memoryUsageMB ?? null;
        setMockHealth({
          status: healthRes.data.status || 'ok',
          latency: healthRes.data.latency ?? null,
          database: { status: dbStatus, latencyMs: healthRes.data.database?.latencyMs ?? null },
          system: { memoryUsageMB: memRss, cpuLoad: healthRes.data.system?.cpuLoad || [] }
        });
      }

      // 处理真实的业务数据渲染
      if (auditLogsRes.success) setMockAuditLogs(auditLogsRes.data || []);
      if (commentsRes.success) setMockComments(commentsRes.data || []);
      if (requestsRes.success) setMockRequests(requestsRes.data || []);
      if (danmakusRes.success) setMockDanmakus(danmakusRes.data || []);

    } catch (error) {
      console.error('加载控制台真实数据失败:', error);
    } finally {
      // 概览使用同一份并行请求的完整快照，避免指标卡先显示默认值再逐项跳动。
      setIsOverviewLoading(false);
    }
  }, [applyStaticSiteStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleConfigChange = (key: string, value: any) => {
    setSystemConfig((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSaveSensitiveWords = async () => {
    try {
      const res = await adminApi.updateSystemConfig({ sensitive_words: systemConfig.sensitive_words || '' });
      if (res.success) {
        showToast({ message: res.message || '敏感词配置已生效', type: 'success' });
      } else {
        showToast({ message: '保存失败：' + (res.message || '未知错误'), type: 'error' });
      }
    } catch {
      showToast({ message: '保存敏感词配置时发生网络错误', type: 'error' });
    }
  };

  const handleFontUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(ttf|woff|woff2)$/i.test(file.name)) {
      showToast({ message: '仅支持 .ttf、.woff 和 .woff2 字体文件', type: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ message: '字体文件不能超过 10 MiB', type: 'error' });
      return;
    }
    setIsFontUploading(true);
    try {
      const result = await adminApi.uploadSiteFont(file);
      if (!result.success || !result.data) {
        showToast({ message: result.message || '字体上传失败', type: 'error' });
        return;
      }
      setSystemConfig((previous: any) => ({ ...previous, custom_font_url: result.data!.url }));
      showToast({ message: '字体已保存；北京静态站将在下一次发布时更新', type: 'success', duration: 4500 });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '字体上传失败', type: 'error' });
    } finally {
      setIsFontUploading(false);
    }
  };

  const handlePublishStaticSite = async () => {
    try {
      const res = await adminApi.publishStaticSite();
      if (res.success) {
        showToast({ message: '发布任务已提交，请查看下发日志', type: 'success' });
        await refreshStaticSiteStatus(false);
      } else {
        showToast({ message: '发布失败：' + (res.message || '未知错误'), type: 'error' });
      }
    } catch (e) {
      showToast({ message: '发布发生网络错误', type: 'error' });
    }
  };

  const handleDeleteDanmaku = (id: number) => {
    showConfirm({
      message: '确定要删除这条弹幕吗？此操作不可恢复。',
      onConfirm: async () => {
        try {
          const res = await adminApi.deleteDanmaku(id);
          if (res.success) {
            setMockDanmakus(prev => prev.filter(d => d.id !== id));
            showToast({ message: '弹幕已删除', type: 'success' });
          } else {
            showToast({ message: '删除失败：' + (res.message || '未知错误'), type: 'error' });
          }
        } catch {
          showToast({ message: '删除时发生网络错误', type: 'error' });
        }
      },
    });
  };

  const handleDeleteComment = (id: number) => {
    showConfirm({
      message: '确定要删除这条评论吗？此操作不可恢复。',
      onConfirm: async () => {
        try {
          const res = await adminApi.deleteComment(id);
          if (res.success) {
            setMockComments(prev => prev.filter(c => c.id !== id));
            showToast({ message: '评论已删除', type: 'success' });
          } else {
            showToast({ message: '删除失败：' + (res.message || '未知错误'), type: 'error' });
          }
        } catch {
          showToast({ message: '删除时发生网络错误', type: 'error' });
        }
      },
    });
  };

  return (
    <div className="min-h-screen bg-xianxia-bg flex font-song text-xianxia-text">
      <DashboardSidebar
        activeTab={activeTab}
        onSelect={setActiveTab}
        onLogout={() => {
          localStorage.removeItem('admin_token');
          window.location.href = '/login';
        }}
      />

      {/* 主内容区 */}
      <main className="flex-1 h-screen overflow-y-auto custom-scrollbar-thin bg-xianxia-bg/30 relative">
        {/* 顶部装饰线 */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-xianxia-jade/20 via-xianxia-jade/60 to-xianxia-jade/20"></div>

        <div className="p-8 max-w-5xl mx-auto space-y-8 mt-4">

          {/* 面包屑 */}
          <div className="flex items-center text-[11px] font-mono tracking-widest text-xianxia-text/50">
            <span>ADMIN</span>
            <span className="mx-2">/</span>
            <span className="text-xianxia-jade">{activeTab.toUpperCase()}</span>
          </div>

          {activeTab === 'overview' && (
            isOverviewLoading
              ? <OverviewLoading />
              : <OverviewPanel health={mockHealth} nodes={mockNodesData} stats={mockStats} />
          )}

          {activeTab === 'users' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex justify-between items-end border-b border-xianxia-border/50 pb-4">
                <div>
                  <h2 className="text-2xl font-kai tracking-widest">用户查看</h2>
                  <p className="mt-2 text-[10px] tracking-widest text-xianxia-text/50">数据源：飞书 Production 用户表（按邮箱保留最新记录）</p>
                </div>
                <div className="relative self-end">
                  <input type="text" placeholder="搜索用户..." className="bg-transparent border border-xianxia-border/60 text-[12px] px-3 py-1.5 focus:outline-none focus:border-xianxia-jade w-48 transition-colors" />
                </div>
              </div>

              <div className="border border-xianxia-border/60 bg-xianxia-bg rounded-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-xianxia-border/20 text-[11px] tracking-widest text-xianxia-text/60">
                      <th className="p-3 font-normal">用户名</th>
                      <th className="p-3 font-normal">Email</th>
                      <th className="p-3 font-normal">身份</th>
                      <th className="p-3 font-normal">登录方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-xianxia-text/50 font-song tracking-widest text-[12px]">
                          暂无用户数据
                        </td>
                      </tr>
                    )}
                    {mockUsers.map(user => (
                      <tr key={user.id} className="border-t border-xianxia-border/30 hover:bg-xianxia-border/10 transition-colors group">
                        <td className="p-3 text-[13px] tracking-wider font-bold">
                          {user.username}
                        </td>
                        <td className="p-3 text-[11px] font-mono text-xianxia-text/70">{user.email}</td>
                        <td className="p-3">
                          {user.role === 'admin'
                            ? <span className="px-2 py-0.5 border border-xianxia-red text-xianxia-red text-[10px] tracking-widest">管理员</span>
                            : <span className="px-2 py-0.5 border border-xianxia-jade text-xianxia-jade text-[10px] tracking-widest">普通用户</span>
                          }
                        </td>
                        <td className="p-3 text-[11px] text-xianxia-text/60 tracking-wider">
                          {loginProviderLabel(user.loginProvider)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}



          {activeTab === 'requests' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">审批请求</h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                {mockRequests.length === 0 && <div className="text-center py-10 text-xianxia-text/50 font-song tracking-widest text-[12px]">暂无审批请求</div>}
                {mockRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between p-4 border border-xianxia-border/50 bg-xianxia-bg hover:border-xianxia-border transition-colors">
                    <div className="flex flex-col">
                      <span className="font-song font-bold text-sm text-xianxia-text tracking-wider">用户: {req.user.username}</span>
                      <span className="text-[11px] font-song text-xianxia-text/60 mt-1">文章: {req.postTitle}</span>
                      <span className="text-[11px] font-song text-xianxia-text/60 mt-0.5">
                        状态: <span className={req.status === 'pending' ? 'text-yellow-600' : (req.status === 'approved' ? 'text-xianxia-jade' : 'text-xianxia-red')}>{req.status === 'pending' ? '待审批' : (req.status === 'approved' ? '已批准' : '已拒绝')}</span>
                      </span>
                    </div>
                    {req.status === 'pending' && (
                      <span className="px-2 py-1 text-xianxia-text/40 text-[10px] font-song tracking-widest border border-xianxia-border/50 bg-xianxia-bg/50">请在 CMS 中处理</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'friends' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">友邻管理</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                {mockFriends.length === 0 && <div className="col-span-full text-center py-10 text-xianxia-text/50 font-song tracking-widest text-[12px]">暂无友邻数据</div>}
                {mockFriends.map(friend => (
                  <div key={friend.id} className="flex items-center gap-4 p-4 border border-xianxia-border/50 bg-xianxia-bg hover:border-xianxia-jade/50 transition-colors group">
                    <div className="w-10 h-10 border border-xianxia-border text-xianxia-text/60 flex items-center justify-center font-song text-sm bg-xianxia-bg shrink-0">
                      {friend.name.charAt(0)}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-song font-bold text-[13px] text-xianxia-text tracking-wider truncate">{friend.name}</span>
                      <span className="text-[10px] text-xianxia-text/50 font-mono mt-1 truncate">{friend.link}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'danmaku' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">弹幕管理</h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                {mockDanmakus.length === 0 && <div className="text-center py-10 text-xianxia-text/50 font-song tracking-widest text-[12px]">暂无弹幕数据</div>}
                {mockDanmakus.map(danmaku => (
                  <div key={danmaku.id} className="flex items-center justify-between p-3 border border-xianxia-border/40 bg-xianxia-bg group hover:bg-xianxia-border/5 transition-colors">
                    <div className="flex flex-col">
                      <span className="font-song font-bold text-[13px] text-xianxia-text tracking-wider">{danmaku.text}</span>
                      <span className="text-[10px] text-xianxia-text/50 font-mono mt-1">IP: {danmaku.ip} • {new Date(danmaku.createdAt).toLocaleString()}</span>
                    </div>
                    <button onClick={() => handleDeleteDanmaku(danmaku.id)} className="px-3 py-1.5 border border-xianxia-red/50 text-xianxia-red hover:bg-xianxia-red hover:text-xianxia-bg text-[10px] font-song tracking-widest transition-colors rounded-sm opacity-0 group-hover:opacity-100">
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">评论管理</h2>
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                {mockComments.length === 0 && <div className="text-center py-10 text-xianxia-text/50 font-song tracking-widest text-[12px]">暂无评论数据</div>}
                {mockComments.map(comment => (
                  <div key={comment.id} className="flex flex-col p-4 border border-xianxia-border/50 bg-xianxia-bg group hover:border-xianxia-border transition-colors">
                    <div className="flex items-center justify-between mb-2 border-b border-xianxia-border/30 pb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[13px] font-song font-bold text-xianxia-text tracking-widest">{comment.user.username}</span>
                        <span className="text-[10px] font-mono text-xianxia-text/50 px-2 py-0.5 bg-xianxia-border/20 rounded-sm">{comment.ip}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] text-xianxia-text/40 font-mono">{new Date(comment.createdAt).toLocaleString()}</span>
                        <button onClick={() => handleDeleteComment(comment.id)} className="px-2 py-1 border border-xianxia-red/50 text-xianxia-red hover:bg-xianxia-red hover:text-xianxia-bg text-[10px] font-song tracking-widest transition-colors rounded-sm opacity-0 group-hover:opacity-100">
                          删除
                        </button>
                      </div>
                    </div>
                    {comment.parent && (
                      <div className="mb-3 mt-1 p-3 bg-xianxia-bg/50 border-l-2 border-xianxia-jade/50 text-[11px] text-xianxia-text/60 font-song italic">
                        回复 @{comment.parent.user.username}: {comment.parent.content}
                      </div>
                    )}
                    <p className="text-[13px] font-song text-xianxia-text/90 tracking-wide leading-relaxed">{comment.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">审计日志</h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                {mockAuditLogs.length === 0 && <div className="text-center py-10 text-xianxia-text/50 font-song tracking-widest text-[12px]">暂无审计日志</div>}
                {mockAuditLogs.map(log => (
                  <div key={log.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-xianxia-border/40 bg-xianxia-bg hover:border-xianxia-border transition-colors gap-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 text-[10px] tracking-widest border ${
                          log.action === 'USER_BAN' ? 'border-xianxia-red text-xianxia-red' : 'border-xianxia-jade text-xianxia-jade'
                        }`}>
                          {log.action}
                        </span>
                        <span className="font-song font-bold text-sm text-xianxia-text tracking-wider">{log.details}</span>
                      </div>
                      <span className="text-[11px] text-xianxia-text/50 font-mono mt-2">Trigger IP: {log.ip}</span>
                    </div>
                    <span className="text-[10px] text-xianxia-text/40 font-mono whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'poll' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex justify-between items-end border-b border-xianxia-border/50 pb-4">
                <h2 className="text-2xl font-kai tracking-widest">投票配置</h2>
              </div>
              <PollManagementPanel />
            </div>
          )}

          {activeTab === 'sync' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">数据同步</h2>
              <DataSyncPanel />
            </div>
          )}

          {activeTab === 'node-management' && <NodeManagementPanel nodes={mockNodesData} />}

          {activeTab === 'static-site' && <StaticSitePanel sites={mockStaticSitesData} syncStatus={mockSyncStatus} onPublish={handlePublishStaticSite} onRefresh={refreshStaticSiteStatus} />}

          {activeTab === 'settings' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">系统配置</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
                <div className="p-5 border border-xianxia-border/50 bg-xianxia-bg space-y-4">
                  <h3 className="font-bold tracking-widest text-[13px]">安全与身份认证</h3>
                  <div className={`p-3 border flex items-center justify-between ${systemConfig.totp_enabled ? 'border-xianxia-border/30 bg-xianxia-jade/5' : 'border-xianxia-red/30 bg-xianxia-red/5'}`}>
                    <div>
                      <p className={`text-[12px] tracking-widest font-bold ${systemConfig.totp_enabled ? 'text-xianxia-jade' : 'text-xianxia-red'}`}>两步验证 (TOTP)</p>
                      <p className={`text-[10px] mt-1 ${systemConfig.totp_enabled ? 'text-xianxia-text/50' : 'text-xianxia-red/70'}`}>
                        {systemConfig.totp_enabled ? '当前已绑定动态口令，系统处于保护中' : '尚未绑定，系统存在安全风险，请配置两步验证'}
                      </p>
                    </div>
                    <button onClick={async () => {
                      try {
                        const res = await adminApi.startTotpSetup();
                        if (res.success && res.secret && res.qrCodeUrl) {
                          setTotpSetupModal({ isOpen: true, secret: res.secret, qrcode: res.qrCodeUrl });
                        } else {
                          showToast({ message: '重新绑定失败：' + (res.message || '未知错误'), type: 'error' });
                        }
                      } catch {
                        showToast({ message: '加载两步验证信息时发生网络错误', type: 'error' });
                      }
                    }} className={`px-3 py-1.5 border text-[10px] tracking-widest transition-colors ${
                      systemConfig.totp_enabled
                        ? 'border-xianxia-jade text-xianxia-jade hover:bg-xianxia-jade hover:text-xianxia-bg'
                        : 'border-xianxia-red text-xianxia-red hover:bg-xianxia-red hover:text-xianxia-bg'
                    }`}>
                      {systemConfig.totp_enabled ? '重新绑定' : '立即绑定'}
                    </button>
                  </div>

                  {totpSetupModal.isOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                      <div className="bg-xianxia-bg border border-xianxia-jade/50 p-6 shadow-2xl max-w-sm w-full animate-in zoom-in-95">
                        <h3 className="text-lg font-kai tracking-widest text-xianxia-jade border-b border-xianxia-jade/30 pb-3 mb-4">配置两步验证</h3>
                        <p className="text-[12px] text-xianxia-text/80 font-song mb-4 leading-relaxed">
                          请使用 Google Authenticator 或其他支持 TOTP 的验证器 App 扫描下方二维码。
                        </p>

                        <div className="flex justify-center mb-6 p-2 rounded-sm border border-xianxia-border/30 bg-white">
                          <img src={totpSetupModal.qrcode} alt="TOTP QR Code" className="w-[180px] h-[180px]" />
                        </div>

                        <div className="mb-6">
                          <p className="text-[10px] text-xianxia-text/50 mb-1 font-song tracking-widest">无法扫描？请手动输入此密钥：</p>
                          <div className="p-2 bg-black/20 border border-xianxia-border/30 font-mono text-xs text-xianxia-text text-center select-all tracking-widest break-all break-words">
                            {totpSetupModal.secret}
                          </div>
                        </div>

                        <div className="mb-8">
                          <p className="text-[10px] text-xianxia-text/50 mb-3 font-song tracking-widest text-center">请输入验证器上的 6 位动态验证码：</p>
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="••••••"
                            className="w-full bg-transparent border-b border-xianxia-border/50 text-xianxia-jade font-mono text-2xl text-center tracking-[1em] focus:outline-none focus:border-xianxia-jade transition-colors py-2 placeholder:text-xianxia-text/20 placeholder:text-lg placeholder:tracking-[0.5em]"
                          />
                        </div>

                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => {
                              setTotpSetupModal({ isOpen: false, secret: '', qrcode: '' });
                              setTotpCode('');
                            }}
                            className="px-4 py-2 text-[12px] font-song tracking-widest border border-xianxia-border text-xianxia-text/70 hover:bg-xianxia-border/20 transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={async () => {
                              if (!totpCode || totpCode.length !== 6) {
                                showToast({ message: '请输入 6 位数字验证码', type: 'error' });
                                return;
                              }
                              try {
                                const res = await adminApi.verifyTotp(totpCode);
                                if (res.success) {
                                  showToast({ message: 'TOTP 两步验证绑定成功', type: 'success' });
                                  setSystemConfig({ ...systemConfig, totp_enabled: true });
                                  setTotpSetupModal({ isOpen: false, secret: '', qrcode: '' });
                                  setTotpCode('');
                                } else {
                                  showToast({ message: '验证失败：' + (res.message || '验证码错误'), type: 'error' });
                                }
                              } catch {
                                showToast({ message: '验证时发生网络错误', type: 'error' });
                              }
                            }}
                            className="px-4 py-2 text-[12px] font-song tracking-widest bg-xianxia-jade/10 border border-xianxia-jade text-xianxia-jade hover:bg-xianxia-jade hover:text-xianxia-bg transition-colors"
                          >
                            验证并绑定
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-5 border border-xianxia-border/50 bg-xianxia-bg space-y-4">
                  <h3 className="font-bold tracking-widest text-[13px]">敏感词库配置</h3>
                  <div className="space-y-3">
                    <label className="block text-[10px] font-song tracking-widest text-xianxia-text/60">
                      全局敏感词列表（使用逗号分隔）
                      <textarea
                        value={systemConfig.sensitive_words || ''}
                        onChange={(e) => handleConfigChange('sensitive_words', e.target.value)}
                        className="w-full h-24 px-3 py-2 mt-1.5 bg-xianxia-bg/50 border border-xianxia-border/50 focus:outline-none focus:border-xianxia-jade text-[11px] font-mono text-xianxia-text resize-none custom-scrollbar-thin"
                        placeholder="例如: 暴力,色情,违禁词..."
                      />
                    </label>
                    <div className="flex gap-2 pt-2">
                      <button onClick={handleSaveSensitiveWords} className="px-4 py-2 bg-xianxia-text text-xianxia-bg text-[11px] tracking-widest hover:bg-xianxia-jade transition-colors">
                        保存并立即生效
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-5 border border-xianxia-border/50 bg-xianxia-bg space-y-3">
                  <h3 className="font-bold tracking-widest text-[13px]">站点字体</h3>
                  <p className="text-[10px] leading-5 text-xianxia-text/60">上传后会安全保存到后端持久卷，并同时写入动态站与北京静态站快照；不使用 OSS 或第三方 CDN。</p>
                  <p className="text-[10px] font-mono break-all text-xianxia-text/50">{systemConfig.custom_font_url ? `当前字体：${systemConfig.custom_font_url}` : '当前使用内置霞鹜文楷'}</p>
                  <label className={`inline-flex items-center gap-2 px-4 py-2 border text-[11px] tracking-widest transition-colors ${isFontUploading ? 'cursor-wait border-xianxia-border text-xianxia-text/40' : 'cursor-pointer border-xianxia-text hover:bg-xianxia-text hover:text-xianxia-bg'}`}>
                    {isFontUploading ? '正在保存字体…' : '上传自定义字体'}
                    <input type="file" accept=".ttf,.woff,.woff2,font/ttf,font/woff,font/woff2" className="hidden" disabled={isFontUploading} onChange={handleFontUpload} />
                  </label>
                  <p className="text-[10px] text-xianxia-text/45">仅支持 TTF、WOFF、WOFF2，单文件最大 10 MiB。</p>
                </div>

                <div className="p-5 border border-xianxia-border/50 bg-xianxia-bg space-y-4">
                  <h3 className="font-bold tracking-widest text-[13px]">系统重置</h3>
                  <div className="p-4 border border-xianxia-red/20 bg-xianxia-red/5 flex flex-col gap-3">
                    <div>
                      <p className="text-[12px] text-xianxia-red font-bold tracking-widest">强制清空内存缓存</p>
                      <p className="text-[10px] text-xianxia-red/60 mt-1">立即销毁 Node.js 进程中的业务缓存，可能导致瞬时负载飙升</p>
                    </div>
                    <button onClick={() => {
                      showConfirm({
                        message: '确定要清空内存缓存吗？短时间内可能导致服务器负载升高。',
                        onConfirm: async () => {
                          try {
                            const result = await adminApi.clearCache();
                            showToast({ message: result.message || '缓存已清理', type: result.success ? 'success' : 'error' });
                          } catch {
                            showToast({ message: '清理缓存时发生网络错误', type: 'error' });
                          }
                        },
                      });
                    }} className="px-4 py-2 border border-xianxia-red text-xianxia-red text-[11px] tracking-widest hover:bg-xianxia-red hover:text-white transition-all self-start mt-2">
                      执行清理
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const OverviewLoading = () => (
  <div className="min-h-[420px] flex flex-col items-center justify-center gap-5 animate-in fade-in duration-500">
    <div className="relative flex h-20 w-20 items-center justify-center" aria-label="正在加载系统概览">
      <div className="absolute inset-1 rounded-full border border-xianxia-jade/30 animate-[spin_5s_linear_infinite]" />
      <div className="absolute inset-3 rounded-full border border-dashed border-xianxia-text/25 animate-[spin_3s_linear_infinite_reverse]" />
      <span className="absolute -top-px left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-xianxia-jade shadow-[0_0_12px_rgba(115,177,150,0.75)]" />
      <span className="h-3 w-3 rounded-full bg-xianxia-text/80 shadow-[0_0_18px_rgba(32,32,32,0.18)] animate-pulse" />
    </div>
    <div className="text-center space-y-2">
      <p className="text-sm font-song tracking-[0.22em] text-xianxia-text">正在获取系统概览</p>
      <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1 w-1 rounded-full bg-xianxia-jade/70 animate-bounce"
            style={{ animationDelay: `${index * 120}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
      <p className="text-[10px] font-mono tracking-[0.18em] text-xianxia-text/40">LOADING LIVE STATUS</p>
    </div>
  </div>
);
