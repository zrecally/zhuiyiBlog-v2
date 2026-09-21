import { useState } from 'react';
import type { StaticSiteNode, SyncStatus } from '../admin/adminTypes';

type StaticSitePanelProps = { sites: StaticSiteNode[]; syncStatus: SyncStatus; onPublish: () => Promise<void>; onRefresh: () => Promise<void> };

const labels: Record<string, string> = { not_configured: '未配置', waiting: '等待上报', running: '发布中', published: '已发布', up_to_date: '已是最新', failed: '发布失败' };
const colors: Record<string, string> = { not_configured: 'text-xianxia-red', waiting: 'text-yellow-600', running: 'text-yellow-600', published: 'text-xianxia-jade', up_to_date: 'text-xianxia-jade', failed: 'text-xianxia-red' };
// 日志只在失败或进行中时值得展示原因；“与当前快照一致”之类的成功默认文案是噪音。
const showMessage = (state: string) => state === 'failed' || state === 'running' || state === 'waiting' || state === 'not_configured';
const overallVisual = {
  success: { dot: 'bg-xianxia-jade', label: '已送达' },
  pending: { dot: 'bg-yellow-600 animate-pulse', label: '等待处理' },
  failed: { dot: 'bg-xianxia-red', label: '发布失败' },
} as const;
const logVisual = {
  success: { dot: 'bg-xianxia-jade', label: '快照已生成' },
  pending: { dot: 'bg-yellow-600 animate-pulse', label: '等待处理' },
  failed: { dot: 'bg-xianxia-red', label: '发布失败' },
} as const;

export const StaticSitePanel = ({ sites, syncStatus, onPublish, onRefresh }: StaticSitePanelProps) => {
  const overall = overallVisual[syncStatus.status as keyof typeof overallVisual] || overallVisual.pending;
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-xianxia-border/50 pb-4">
        <div>
          <h2 className="text-2xl font-kai tracking-widest">静态站点与边缘同步</h2>
          <p className="mt-1 text-[11px] font-song text-xianxia-text/50">北京静态站版本下发、快照同步状态与传输日志</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-[11px] font-song text-xianxia-text/60">
            <span className={`w-2 h-2 rounded-full ${overall.dot}`} />
            {overall.label} · 最后检查 {syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : '尚无记录'}
          </span>
          <button onClick={() => run(onRefresh)} disabled={busy} className="px-4 py-2 border border-xianxia-border text-[11px] font-song tracking-widest transition-colors hover:border-xianxia-jade hover:text-xianxia-jade disabled:opacity-50">刷新状态</button>
          <button onClick={() => run(onPublish)} disabled={busy} className="px-4 py-2 bg-xianxia-text text-xianxia-bg text-[11px] font-song tracking-widest transition-opacity hover:opacity-90 disabled:opacity-50">{busy ? '处理中...' : '一键发布'}</button>
        </div>
      </div>

      <section>
        <h3 className="mb-3 text-[13px] font-bold tracking-widest">边缘节点</h3>
        {sites.length === 0 && <p className="border border-dashed border-xianxia-border/50 p-6 text-center text-[11px] font-song text-xianxia-text/40">尚未配置发布目标；发布器首次上报后这里会出现节点卡片。</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sites.map((site) => (
            <article key={site.id} className="space-y-2 rounded-sm border border-xianxia-border/60 bg-xianxia-bg/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-song font-bold tracking-widest">{site.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-xianxia-text/40">{site.destination}</p>
                </div>
                <span className={`whitespace-nowrap text-[11px] font-song tracking-widest ${colors[site.state] || 'text-xianxia-text/60'}`}>{site.loading ? '读取中' : labels[site.state] || site.state}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-xianxia-border/30 pt-2">
                <span className="truncate font-mono text-[10px] text-xianxia-text/70" title={site.version || undefined}>{site.version || '尚无版本'}</span>
                <span className="whitespace-nowrap font-mono text-[10px] text-xianxia-text/40">{site.publishedAt ? new Date(site.publishedAt).toLocaleString() : '尚无发布'}</span>
              </div>
              {showMessage(site.state) && site.message && (
                <p className={`border-l-2 pl-2 font-song text-[10px] ${site.state === 'failed' ? 'border-xianxia-red text-xianxia-red' : 'border-xianxia-border text-xianxia-text/50'}`}>{site.message}</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="border border-xianxia-border/50 bg-xianxia-bg p-4">
        <h3 className="mb-2 text-[13px] font-bold tracking-widest">下发日志</h3>
        <div className="custom-scrollbar-thin max-h-56 divide-y divide-xianxia-border/20 overflow-y-auto">
          {syncStatus.syncLogs.length === 0 && <p className="py-4 text-center font-song text-[11px] text-xianxia-text/40">尚无下发记录</p>}
          {syncStatus.syncLogs.map((log) => {
            const visual = logVisual[log.status as keyof typeof logVisual] || logVisual.pending;
            return (
              <div key={log.id} className="flex items-center justify-between gap-3 py-2">
                <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${visual.dot}`} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-xianxia-text/80" title={log.file}>{log.file}</span>
                <span className="shrink-0 font-song text-[10px] text-xianxia-text/50">{visual.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-xianxia-text/40">{log.time ? new Date(log.time).toLocaleString() : ''}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
