import type { ReactNode } from 'react';
import type { AdminStats, NodeStatus } from '../admin/adminTypes';
import type { DashboardHealthSnapshot } from './dashboardTypes';

interface OverviewPanelProps {
  health: DashboardHealthSnapshot;
  nodes: NodeStatus[];
  stats: AdminStats;
}

const statusClass = (status?: NodeStatus['status']) => status === 'online'
  ? 'text-xianxia-jade bg-xianxia-jade'
  : status === 'warning' || status === 'configured'
    ? 'text-yellow-600 bg-yellow-500'
    : 'text-xianxia-red bg-xianxia-red';

export const OverviewPanel = ({ health, nodes, stats }: OverviewPanelProps) => {
  const nodeStatus = (id: string) => nodes.find((node) => node.id === id);
  const probeDetail = (id: string) => {
    const node = nodeStatus(id);
    return node?.latency === null || node?.latency === undefined ? undefined : `${node.latency}ms`;
  };
  const statusDotClass = (id: string) => statusClass(nodeStatus(id)?.status).split(' ')[1];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">系统概览</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 border border-xianxia-border/60 bg-xianxia-bg shadow-sm rounded-sm">
          <p className="text-[11px] text-xianxia-text/60 tracking-widest mb-2">活跃 IP（当前实例）</p>
          <p className="text-3xl font-kai text-xianxia-jade">{stats.onlineCount || 0}</p>
          <p className="text-[10px] text-xianxia-text/40 mt-2 font-mono">最近 {Math.round((stats.onlineWindowSeconds || 300) / 60)} 分钟 · 非全站并发</p>
        </div>
        <div className="p-4 border border-xianxia-border/60 bg-xianxia-bg shadow-sm rounded-sm">
          <p className="text-[11px] text-xianxia-text/60 tracking-widest mb-2">系统总用户</p>
          <p className="text-3xl font-kai text-xianxia-text">{stats.userCount || 0}</p>
          <p className="text-[10px] text-xianxia-text/40 mt-2 font-mono">Registered users</p>
        </div>
        <div className="p-4 border border-xianxia-border/60 bg-xianxia-bg shadow-sm rounded-sm">
          <p className="text-[11px] text-xianxia-text/60 tracking-widest mb-2">全站访问量</p>
          <p className="text-3xl font-kai text-xianxia-text">{stats.views || 0}</p>
          <p className="text-[10px] text-xianxia-text/40 mt-2 font-mono">Total page views</p>
        </div>
        <div className="p-4 border border-xianxia-border/60 bg-xianxia-bg shadow-sm rounded-sm">
          <p className="text-[11px] text-xianxia-text/60 tracking-widest mb-2">留言与弹幕记录</p>
          <p className="text-3xl font-kai text-xianxia-text">{stats.interactionCount || 0}</p>
          <p className="text-[10px] text-xianxia-text/40 mt-2 font-mono">评论 {stats.commentCount || 0} · 弹幕 {stats.danmakuCount || 0}</p>
        </div>
      </div>

      <div className="mt-8 p-5 border border-xianxia-border/60 bg-xianxia-bg/80">
        <h3 className="text-sm font-bold tracking-widest mb-4 border-l-2 border-xianxia-jade pl-2">探针状态</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Metric label="主节点延迟" value={health.latency === null ? '未获取' : `${health.latency}ms`} indicatorClass="bg-xianxia-jade animate-pulse" />
          <Metric label="数据库状态" value={health.database.latencyMs === null ? '不可用' : `${health.database.latencyMs}ms`} indicatorClass="bg-xianxia-jade animate-pulse" />
          <Metric label="系统内存" value={health.system.memoryUsageMB === null ? '未获取' : `${health.system.memoryUsageMB}MB`} indicatorClass="bg-yellow-500" />
          <Metric label="CPU 负载" value={typeof health.system.cpuLoad[0] === 'number' ? health.system.cpuLoad[0].toFixed(2) : '未获取'} indicatorClass="bg-xianxia-jade" />
        </div>
      </div>

      <StatusGroup title="系统初始化状态">
        <StatusMetric label="敏感词词库" detail={nodeStatus('sensitive-words')?.message || '未获取初始化结果'} dotClass={statusDotClass('sensitive-words')} />
        <StatusMetric label="核心数据同步" detail={nodeStatus('feishu-sync')?.message || '未获取同步任务状态'} dotClass={statusDotClass('feishu-sync')} />
        <StatusMetric label="后端运行时" detail={nodeStatus('backend')?.details?.find((detail) => detail.label === '运行时长')?.value || '未获取运行时信息'} dotClass={statusDotClass('backend')} />
        <StatusMetric label="主数据库连接" detail={nodeStatus('database')?.latency === null || nodeStatus('database')?.latency === undefined ? '未获取连接耗时' : `本次查询 ${nodeStatus('database')?.latency}ms`} dotClass={statusDotClass('database')} />
      </StatusGroup>

      <StatusGroup title="外部服务真实探针">
        <StatusMetric label="飞书连接状态" detail={probeDetail('feishu')} dotClass={statusDotClass('feishu')} />
        <StatusMetric label="mTLS 代理" detail={probeDetail('proxy')} dotClass={statusDotClass('proxy')} />
        <StatusMetric label="香港动态站" detail={probeDetail('hk-dynamic')} dotClass={statusDotClass('hk-dynamic')} />
        <StatusMetric label="Cloudflare 边缘" detail={probeDetail('cf')} dotClass={statusDotClass('cf')} />
      </StatusGroup>
    </div>
  );
};

const Metric = ({ label, value, indicatorClass }: { label: string; value: string; indicatorClass: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] text-xianxia-text/60">{label}</span>
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${indicatorClass}`} />
      <span className="font-mono text-sm">{value}</span>
    </div>
  </div>
);

const StatusGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-6 p-5 border border-xianxia-border/60 bg-xianxia-bg/80">
    <h3 className="text-sm font-bold tracking-widest mb-4 border-l-2 border-xianxia-jade pl-2">{title}</h3>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">{children}</div>
  </div>
);

const StatusMetric = ({ label, detail, dotClass }: { label: string; detail?: string; dotClass: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] text-xianxia-text/60">{label}</span>
    <div className="flex items-start gap-2">
      <div className={`w-2 h-2 shrink-0 rounded-full mt-1 ${dotClass}`} aria-label={`${label}状态`} />
      {detail && <span className="text-[10px] text-xianxia-text/50 leading-relaxed">{detail}</span>}
    </div>
  </div>
);
