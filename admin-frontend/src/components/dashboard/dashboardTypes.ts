export type DashboardTab =
  | 'overview'
  | 'users'
  | 'requests'
  | 'friends'
  | 'danmaku'
  | 'comments'
  | 'audit'
  | 'sync'
  | 'poll'
  | 'node-management'
  | 'static-site'
  | 'settings';

export interface DashboardNavigationItem {
  id: DashboardTab;
  label: string;
  icon: string;
}

export interface DashboardHealthSnapshot {
  status: string;
  latency: number | null;
  database: {
    status: string;
    latencyMs: number | null;
  };
  system: {
    memoryUsageMB: number | string | null;
    cpuLoad: number[];
  };
}
