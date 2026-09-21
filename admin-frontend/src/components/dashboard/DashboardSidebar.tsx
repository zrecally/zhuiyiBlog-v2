import type { DashboardNavigationItem, DashboardTab } from './dashboardTypes';
import { CONTROL_PLANE_VERSION } from '../../version';

const navigationItems: DashboardNavigationItem[] = [
  { id: 'overview', label: '系统概览', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'users', label: '用户查看', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'requests', label: '审批请求', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'friends', label: '友邻管理', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'danmaku', label: '弹幕管理', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
  { id: 'comments', label: '评论管理', icon: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z' },
  { id: 'audit', label: '审计日志', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { id: 'sync', label: '数据同步', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
  { id: 'poll', label: '投票配置', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'node-management', label: '节点管理', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { id: 'static-site', label: '静态站点', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { id: 'settings', label: '系统配置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onSelect: (tab: DashboardTab) => void;
  onLogout: () => void;
}

export const DashboardSidebar = ({ activeTab, onSelect, onLogout }: DashboardSidebarProps) => (
  <aside className="w-56 border-r border-xianxia-border/50 bg-xianxia-bg/80 sticky top-0 h-screen flex flex-col overflow-hidden pt-7 pb-4 shadow-[2px_0_15px_rgba(0,0,0,0.03)] z-10">
    <div className="shrink-0 px-6 mb-6 flex flex-col items-center">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="ZhuiYi"
        className="w-12 h-12 mb-3 shadow-[0_6px_16px_rgba(0,0,0,0.14)] rounded-full"
      >
        <circle cx="50" cy="50" r="50" fill="#1A1A1A" />
        <text
          x="50"
          y="55"
          fill="white"
          fontFamily="serif"
          fontSize="60"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          Z
        </text>
      </svg>
      <h1 className="font-kai text-xl tracking-[0.3em] font-bold">控制台</h1>
      <span className="mt-1.5 text-[10px] font-mono tracking-[0.16em] text-xianxia-text/45">
        {CONTROL_PLANE_VERSION}
      </span>
    </div>

    <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-1 space-y-1 custom-scrollbar-thin">
      {navigationItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-sm transition-all text-[13px] tracking-widest ${
            activeTab === item.id
              ? 'bg-xianxia-text text-xianxia-bg font-bold shadow-md'
              : 'text-xianxia-text/70 hover:bg-xianxia-border/30 hover:text-xianxia-text'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
          </svg>
          {item.label}
        </button>
      ))}
    </nav>

    <div className="shrink-0 px-6 pt-3 mt-3 border-t border-xianxia-border/40">
      <button onClick={onLogout} className="w-full py-2 border border-xianxia-red/50 text-xianxia-red hover:bg-xianxia-red hover:text-xianxia-bg transition-colors text-[11px] tracking-widest rounded-sm">
        退出登录
      </button>
    </div>
  </aside>
);
