export type AdminTab = 'overview' | 'users' | 'requests' | 'friends' | 'poll' | 'config' | 'sync' | 'static-site' | 'danmaku' | 'comments' | 'audit';

export type ProductPollPreview = 'pigeon' | 'fax' | null;

export interface ProductPollOptionDefinition {
  id: string;
  title: string;
  description: string;
  preview: ProductPollPreview;
  previewEnabled: boolean;
  previewUrl: string;
}

export interface ProductPollCategoryDefinition {
  id: 'feedback-ui' | 'next-module';
  title: string;
  description: string;
  options: ProductPollOptionDefinition[];
}

export interface ProductPollDefinition {
  enabled: boolean;
  title: string;
  description: string;
  categories: ProductPollCategoryDefinition[];
}

export interface ProductPollResults {
  totalVotes: number;
  categories: Record<string, Record<string, number>>;
}

export interface AdminHealth {
  status: string;
  latency: number;
  database: { status: string; latencyMs: number };
  system: { memoryUsageMB: string; memoryTotalMB: string; cpuLoad: number[] };
  staticSite?: { status: string; latencyMs: number };
}

export interface AdminUser {
  id: number | string;
  username: string;
  email: string;
  avatar?: string | null;
  loginProvider?: string;
}

export interface AccessRequest {
  id: number | string;
  userId: number | string;
  postId: string;
  postTitle?: string;
  status: string;
  user?: { username?: string };
}

export interface Friend {
  id: number | string;
  name: string;
  link?: string;
  avatar?: string | null;
}

export interface Danmaku {
  id: number;
  text: string;
  ip?: string;
  createdAt: string;
}

export interface AdminComment {
  id: number;
  content: string;
  ip?: string;
  createdAt: string;
  user?: { username?: string };
  parent?: { content: string; user?: { username?: string } };
}

export interface AuditLog {
  id: number;
  action: string;
  ip: string;
  details: string;
  createdAt: string;
}

export interface AdminStats {
  success: boolean;
  views: number;
  userCount?: number;
  onlineCount?: number;
  commentCount?: number;
  danmakuCount?: number;
  interactionCount?: number;
  onlineWindowSeconds?: number;
  onlineScope?: 'current_instance';
  isTotpSetup?: boolean;
}

export interface NodeStatus {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'warning' | 'offline' | 'not_configured' | 'configured';
  latency: number | null;
  checkedAt: string;
  isThirdParty: boolean;
  details?: { label: string; value: string }[];
  message?: string;
}

export interface StaticSiteNode {
  id: string;
  name: string;
  description: string;
  state: string;
  version: string | null;
  checkedAt: string | null;
  publishedAt: string | null;
  destination: string;
  message?: string;
  configured: boolean;
  isPublishing: boolean;
  loading: boolean;
}

export interface SyncStatus {
  lastSyncTime: string;
  status: string;
  syncLogs: { id: string; file: string; status: string; time: string }[];
}

export interface StaticPublishStatus {
  syncStatus: SyncStatus;
  sites: StaticSiteNode[];
}

export interface ApiResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface StaticPublishRequestResult {
  version: string;
  changed: boolean;
  postCount: number;
  skippedCount: number;
}
