import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isProduction = process.env.NODE_ENV === 'production';
const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const feishuDataEnvironment = process.env.FEISHU_DATA_ENV?.trim() || (isProduction ? 'Production' : 'Test');
if (!['Production', 'Test'].includes(feishuDataEnvironment)) {
  throw new Error('FEISHU_DATA_ENV 只能是 Production 或 Test');
}

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || '',
  frontendUrl: normalizeBaseUrl(
    process.env.FRONTEND_URL || (isProduction ? 'https://www.hizhuiyi.cn' : 'http://localhost:5173')
  ),
  backendUrl: normalizeBaseUrl(
    process.env.BACKEND_URL || (isProduction ? 'https://www.hizhuiyi.cn' : 'http://localhost:3001')
  ),
  enableIpBlocking: true,
  // A rate-limit response is not proof of malicious intent. Keep automatic
  // persistence to the blacklist opt-in so a shared proxy cannot ban every
  // visitor routed through it.
  rateLimitAutoBan: process.env.RATE_LIMIT_AUTO_BAN === 'true',
  blacklistExemptIps: (process.env.IP_BLACKLIST_EXEMPT_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean),

  admin: {
    // Production defaults to the Feishu account-status precheck. Isolated local
    // environments may explicitly disable it so they never consult live tables.
    feishuPrecheckEnabled: process.env.ADMIN_FEISHU_PRECHECK_ENABLED !== 'false',
  },

  // Public, static feature demos may be embedded by the voting page. Keep this
  // list explicit: administrators can choose a path below one of these hosts,
  // but cannot turn the voting configuration into an arbitrary external link.
  preview: {
    allowedHosts: (process.env.PREVIEW_ALLOWED_HOSTS || 'preview.hizhuiyi.cn')
      .split(',')
      .map(host => host.trim().toLocaleLowerCase())
      .filter(Boolean),
  },

  // Only reverse proxies may supply X-Forwarded-For. Local Docker and the
  // production frontend communicate over RFC1918 addresses; explicit hosts
  // can be added for a stricter topology.
  trustedProxyIps: (process.env.TRUST_PROXY_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean),

  // Private control plane used by the Beijing read-only frontend. Both the
  // source address and the shared secret must match before an internal
  // blacklist request is accepted.
  internalSecurity: {
    sharedSecret: process.env.INTERNAL_SECURITY_SHARED_SECRET || '',
    allowedProxyIps: (process.env.INTERNAL_SECURITY_PROXY_IPS || '')
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean),
  },

  // Anonymous one-time article access. The public browser talks only to a
  // same-origin frontend gateway; this backend listener remains private.
  articleAccess: {
    enabled: process.env.ARTICLE_ACCESS_ENABLED === 'true',
    pepper: process.env.ARTICLE_ACCESS_PEPPER || '',
    gatewaySecret: process.env.ARTICLE_ACCESS_GATEWAY_SECRET || '',
    gatewayProxyIps: (process.env.ARTICLE_ACCESS_GATEWAY_PROXY_IPS || '')
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean),
    allowLanGateway: !isProduction && process.env.ARTICLE_ACCESS_ALLOW_LAN_GATEWAY === 'true',
    cookieName: process.env.ARTICLE_ACCESS_COOKIE_NAME || 'zhuiyi_article_access',
    cookieDomain: process.env.ARTICLE_ACCESS_COOKIE_DOMAIN || '',
    maxGrantHours: Math.max(1, positiveInteger(process.env.ARTICLE_ACCESS_MAX_GRANT_HOURS, 168)),
  },

  // Local card redemption. The database is authoritative; Feishu is an
  // CardDeck 专用域名的主机名作用域：该域名只暴露发卡工作台 API（空 = 不启用）。
  // 编排模式插件授权（AgentDeck Pro）
  license: {
    // 授权码与插件载荷使用独立 HMAC 密钥，禁止复用发卡业务密钥。
    keySecret: process.env.LICENSE_KEY_SECRET || '',
    // 插件包文件路径（/api/license/download 提供下载，旧版客户端兼容）
    pluginFile: process.env.LICENSE_PLUGIN_FILE || '',
    // 插件包版本注册表根目录（/api/license/plugin/* 独立分发与自动迭代）
    pluginPackagesDir: process.env.LICENSE_PLUGIN_PACKAGES_DIR
      || path.join(process.cwd(), 'plugin-packages'),
    // 管理端发布插件新版本时的 payload 暂存目录（scp 落位后调用 publish 接管）
    pluginStagingDir: process.env.LICENSE_PLUGIN_STAGING_DIR
      || path.join(process.cwd(), 'plugin-staging'),
  },
  cardApiHost: (process.env.CARD_API_HOST || '').trim(),

  // 管理控制面（Admin UI & API / CardDeck 发卡工作台）监听端口。
  // 生产 compose 将容器内 8443 映射到宿主机 ADMIN_PORT，容器内保持 8443 不变；
  // 本地开发可设 8453 以避开 docker 占用的 127.0.0.1:8443（CardDeck 默认地址）。
  // 控制面是否托管 Web 管理前端（false = 只保留 API，界面由 CardDeck 软件承担）
  adminFrontendEnabled: process.env.ADMIN_FRONTEND_ENABLED !== 'false',
  adminPort: Math.max(1, positiveInteger(process.env.ADMIN_PORT, 8443)),

  // explicitly enabled optional ledger.
  cardRedeem: {
    enabled: process.env.CARD_REDEEM_ENABLED === 'true',
    secret: process.env.CARD_REDEEM_SECRET || '',
    // Comma-separated retired keys. Keep them until every card/receipt created
    // with that key has expired; new cards always use CARD_REDEEM_SECRET.
    previousSecrets: [...new Set((process.env.CARD_REDEEM_PREVIOUS_SECRETS || '')
      .split(',')
      .map(secret => secret.trim())
      .filter(Boolean))]
      .filter(secret => secret !== (process.env.CARD_REDEEM_SECRET || '')),
    // 核销请求幂等恢复窗口：只有同 requestId + 同 IP 可重放。
    // 它与暴露在 URL 中的内部下载票据分开，避免网络丢包后卡密无法恢复。
    replayMinutes: Math.min(120, Math.max(1, positiveInteger(process.env.CARD_REDEEM_REPLAY_MINUTES, 30))),
    downloadTicketMinutes: Math.min(10, Math.max(1, positiveInteger(process.env.CARD_REDEEM_DOWNLOAD_TICKET_MINUTES, 5))),
    fileDir: path.resolve(process.cwd(), process.env.CARD_REDEEM_FILE_DIR || 'cache_data/card-files'),
    maxFileBytes: Math.max(1, positiveInteger(process.env.CARD_REDEEM_MAX_FILE_BYTES, 512 * 1024 * 1024)),
    // 显式设为 true 才启用飞书台账；本地 MySQL/数据库状态不依赖飞书。
    feishuSyncEnabled: process.env.CARD_REDEEM_FEISHU_SYNC === 'true',
    // 发卡回执密文（codesCiphertext）保留时长（小时），过期由 GC 清除
    issueReplayHours: Math.min(168, Math.max(1, positiveInteger(process.env.CARD_ISSUE_RECEIPT_HOURS, 24))),
    // 全站每日授权字节熔断。首次下载授权在串行化事务中预留整份文件；
    // 同一授权的重试复用同一 OSS 签名，不会重复占用额度。0 = 关闭。
    dailyDownloadBytesLimit: Math.max(0, positiveInteger(process.env.CARD_REDEEM_DAILY_BYTES_LIMIT, 50 * 1024 * 1024 * 1024)),
    // 私有对象存储后端（S3 兼容协议：雨云 ROS / MinIO / 阿里云 S3 兼容端点）。
    // 未启用时回退本地目录。
    oss: {
      enabled: process.env.CARD_REDEEM_OSS_ENABLED === 'true',
      endpoint: process.env.CARD_REDEEM_OSS_ENDPOINT || '',
      accessKeyId: process.env.CARD_REDEEM_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.CARD_REDEEM_OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.CARD_REDEEM_OSS_BUCKET || '',
      keyPrefix: (process.env.CARD_REDEEM_OSS_KEY_PREFIX || 'card-files/').replace(/[^/\\]$/, '$&/'),
      // 预签名 URL 对外呈现的主机（源站与公网访问域名不同时使用）；
      // SigV4 签名覆盖主机名，因此会用该主机重新签名。留空表示与 endpoint 相同。
      publicEndpoint: process.env.CARD_REDEEM_OSS_PUBLIC_ENDPOINT || '',
      // OSS URL 是可转发的 bearer 凭据，因此默认 30 分钟、最长 1 小时。
      // 已开始的流式下载通常不会因 URL 到期被中断；重连必须在有效期内发起。
      presignTtlSeconds: Math.min(3600, Math.max(60, positiveInteger(process.env.CARD_REDEEM_OSS_PRESIGN_TTL_SECONDS, 1800))),
      // SigV4 区域；雨云 ROS 等 S3 兼容服务通常填 us-east-1 即可
      region: process.env.CARD_REDEEM_OSS_REGION || 'us-east-1',
      // true = endpoint/bucket/key（第三方 S3 兼容服务默认用这个）
      pathStyle: process.env.CARD_REDEEM_OSS_PATH_STYLE !== 'false',
    },
  },

  // Beijing read-only site snapshot export (disabled unless explicitly enabled)
  staticSnapshot: {
    enabled: process.env.STATIC_SNAPSHOT_ENABLED === 'true',
    outputDir: path.resolve(process.cwd(), process.env.STATIC_SNAPSHOT_OUTPUT_DIR || 'exports/static-site'),
    contentRefreshMinutes: positiveInteger(process.env.STATIC_SNAPSHOT_CONTENT_REFRESH_MINUTES, 360),
    retainReleases: Math.max(2, positiveInteger(process.env.STATIC_SNAPSHOT_RETAIN_RELEASES, 3)),
    remoteImageHosts: (process.env.STATIC_SNAPSHOT_REMOTE_IMAGE_HOSTS || '')
      .split(',')
      .map(host => host.trim().toLocaleLowerCase())
      .filter(Boolean),
  },

  // Unprivileged hand-off between the backend container and the host-only
  // static publisher. The container may request a publish and read sanitized
  // status, but it never receives the SSH key used by the host service.
  staticPublishControl: {
    requestDir: process.env.STATIC_PUBLISH_REQUEST_DIR
      ? path.resolve(process.cwd(), process.env.STATIC_PUBLISH_REQUEST_DIR)
      : '',
    statusFile: process.env.STATIC_PUBLISH_STATUS_FILE
      ? path.resolve(process.cwd(), process.env.STATIC_PUBLISH_STATUS_FILE)
      : '',
  },

  // LLM Config
  openaiApiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',

  // Feishu Config
  feishu: {
    dataEnvironment: feishuDataEnvironment as 'Production' | 'Test',
    allowLegacyBlankEnvironment:
      feishuDataEnvironment === 'Production' && process.env.FEISHU_ALLOW_LEGACY_BLANK_ENV === 'true',
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    baseToken: process.env.FEISHU_BASE_TOKEN || '',
    chatId: process.env.FEISHU_CHAT_ID || '',
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
    webhookSecret: process.env.FEISHU_WEBHOOK_SECRET || '', // 新增签名校验密钥
    errorWebhookUrl: process.env.FEISHU_ERROR_WEBHOOK_URL || '',
    errorWebhookSecret: process.env.FEISHU_ERROR_WEBHOOK_SECRET || '', // 错误日志机器人
    tables: {
      posts: process.env.FEISHU_POSTS_TABLE_ID || '',
      admins: process.env.FEISHU_ADMINS_TABLE_ID || '',
      ipWhitelist: process.env.FEISHU_IP_WHITELIST_TABLE_ID || '',
      users: process.env.FEISHU_USERS_TABLE_ID || '',
      comments: process.env.FEISHU_COMMENTS_TABLE_ID || '',
      friends: process.env.FEISHU_FRIENDS_TABLE_ID || '',
      requests: process.env.FEISHU_REQUESTS_TABLE_ID || '',
      articleAccessCodes: process.env.FEISHU_ARTICLE_ACCESS_CODES_TABLE_ID || '',
      cardCodes: process.env.FEISHU_CARD_CODES_TABLE_ID || '',
      feedback: process.env.FEISHU_FEEDBACK_TABLE_ID || '',
      projects: process.env.FEISHU_PROJECTS_TABLE_ID || '',
      config: process.env.FEISHU_CONFIG_TABLE_ID || '',
      timeline: process.env.FEISHU_TIMELINE_TABLE_ID || '',
      album: process.env.FEISHU_ALBUM_TABLE_ID || '',
      blacklist: process.env.FEISHU_BLACKLIST_TABLE_ID || '',
      i18nDict: process.env.FEISHU_I18N_DICT_TABLE_ID || '',
    }
  },

  // SMTP Config
  smtp: {
    enabled: process.env.SMTP_ENABLED !== 'false',
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"ZuiYi Blog" <noreply@zuiyi.com>',
  },

  // Aliyun OSS Config
  oss: {
    // Keep object storage opt-in. Merely leaving old credentials in an
    // environment file must not silently re-enable uploads.
    enabled: process.env.OSS_ENABLED === 'true',
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.OSS_BUCKET || '',
    cdnDomain: process.env.OSS_CDN_DOMAIN || '',
  }
};

if (!config.jwtSecret) {
  console.error('[Fatal Error] 🚨 严重安全警告：未配置 JWT_SECRET 环境变量！系统已强制终止启动。');
  process.exit(1);
}
