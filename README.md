# ZhuiYi 博客系统

ZhuiYi 是一个基于 React、Vite、Node.js、Express、Prisma 和 MySQL 的前后端分离博客系统。生产数据库为香港业务节点上的本地 MySQL 8.4；仓库根目录是唯一开发主线。PolarDB-X 与 PostgreSQL 只保留为迁移历史，见 [`mysql-version/MIGRATION_STATUS.md`](mysql-version/MIGRATION_STATUS.md)。

> 生产基线（2026-09-20）：香港承载动态前端、后端、本地 MySQL 8.4 主库、后台任务、发卡/兑换/私有文件交付和随机二级域名 mTLS 控制面；北京永久只承载 `cn` 与 `start` 纯静态站。东京动态分流尚未完成，在线付款保持关闭。

- 正式站点：<https://www.hizhuiyi.cn>
- 正式 API：<https://www.hizhuiyi.cn/api/v1>

## 生产架构

正式环境采用香港交互业务节点与北京纯静态节点；不使用 Redis，阿里云数据库仅作为冻结恢复源，不参与生产写入：

| 层级 | 部署方式 | 职责 |
| --- | --- | --- |
| 香港业务节点 | Nginx + Docker | 提供动态前端，将 API/SSE 转发到本机回环后端，并运行后台任务与快照生成 |
| 北京静态节点 | 原生 Nginx + 不可变发布包 | 只展示公开快照和起始页，不运行应用后端、业务数据库或交互式网站 |
| 后端 | 香港 `zhuiyi_backend` | 处理 REST API、评论、通知、弹幕 SSE、飞书同步与静态快照 |
| 数据库 | 香港 MySQL 8.4 | 生产写主库，仅位于 Docker 私有网络，不发布宿主机数据库端口 |
| 外部服务 | 阿里云邮件推送、飞书 | 发信和 CMS/配置同步；备案信息只进入静态构建，动态站不读取 |

香港站使用 `https://www.hizhuiyi.cn`，Nginx 将 `/api/*` 转发到仅监听 `127.0.0.1:3001` 的后端。北京站使用 `https://cn.hizhuiyi.cn`，`/api/*`、`/card`、`/admin` 和未知路径固定返回 `404`，写方法返回 `405`，不存在任何上游。控制面使用原随机二级域名和 `47108` 端口，并强制 mTLS；其 DNS 记录不得开启 Cloudflare 代理。北京站见 [`deploy/BEIJING_STATIC.md`](deploy/BEIJING_STATIC.md)。

当前独立起始页仍作为生产站的单独子域名运行；发卡、兑换与私有文件提取模块已部署到香港业务节点，在线付款入口仍关闭。计划中的个人单服务器发行版会删除发卡模块和起始页，并把多地域组件收敛到一台服务器，详见 [`doc/个人单服务器发行版实施计划.md`](doc/个人单服务器发行版实施计划.md)。

## 本地 Docker 架构（MySQL）

根目录本地 Docker 环境使用 MySQL 8.4 模拟 PolarDB-X 协议，并继续提供多地域链路模拟；它不连接生产数据库，也不是计划出售的个人单服务器版。

| 服务 | 容器 | 本地入口 | 职责 |
| --- | --- | --- | --- |
| 公共前端网关 | `zhuiyi_frontend` | `http://localhost` | 提供动态站静态文件，并转发 REST API 与 SSE |
| 统一后端 | `zhuiyi_backend` | `http://localhost:3002` | 承载 REST API、SSE、飞书同步和快照生成 |
| MySQL 8.4 | `zhuiyi_mysql` | `localhost:3337` | 保存用户、评论、通知、访问记录和发卡数据 |
| 北京静态站 | `zhuiyi_static_frontend` | `http://localhost:8081` | 只提供已发布的公开快照 |
| 静态发布器 | `zhuiyi_static_publisher` | 无公网入口 | 模拟宿主机原子发布，不具备网络权限 |
| Cloudflare 模拟网关 | `zhuiyi_cloudflare_mock` | `http://localhost:8088` | 验证代理真实 IP 传递 |

浏览器通常只访问 `http://localhost`：

- `/api/*` 由 Nginx 转发至统一后端。
- SSE 与普通 API 使用同一个后端实例。
- 前端路由和静态文件由 Nginx 直接提供。

独立管理端不经公共网站网关暴露：后端容器在 `8443` 提供 mTLS 控制面，香港宿主机以 `47108` 映射到该容器端口。只有安装受信客户端证书且通过 JWT/TOTP 校验的管理员才能访问。当前云防火墙临时允许全部来源访问 `47108`，完成浏览器证书验收后必须收紧到管理员固定公网 IP；宿主机 `8443` 不对外放行。其前端源码位于 `admin-frontend/`。

## 核心能力

- React + Vite 前端和 Express API。
- 根目录与生产均使用 MySQL 协议；`mysql-version/` 仅保留迁移完成记录和隔离验证副本。
- 动态站提供登录用户匿名去重的产品投票和功能预览；管理员可在后台编辑文案、预览开关与开放状态，结果仅在提交后展示，北京静态站不加载投票入口、预览资源或接口。
- “相册”作为动态站和北京静态站共同的一级导航；生活照片由飞书多维表格管理，后端压缩并移除 EXIF/GPS 后保存到持久卷，北京站只读取随快照发布的图片副本。
- 飞书文档、文章、评论、配置和身份数据同步。
- 评论、弹幕和站内通知 SSE 实时推送。
- JWT、Magic Link、OAuth 和管理员 TOTP。
- IP 白名单、黑名单、限流、敏感词过滤和审计日志。
- 飞书图片代理、管理员图片本地持久化上传，以及正文图片随静态快照发布。
- RSS、Atom、JSON Feed、站点地图和全文搜索。
- Docker Compose 本地集群环境。

## 研发与架构规范

本项目严格遵循“资深软硬件研发测试架构专家系统”基线要求：

- **目录与产物归档**：所有文档强制归档于 `/doc`；测试脚本与报告强制归档于 `/tests`；所有运行日志、容器日志与测试日志强制挂载并归档于 `/logs`。
- **日志优先排查 (Log-First)**：开发、测试或运行阶段遇到任何异常与报错，必须优先查阅 `/logs` 目录下的相关日志定位根因，严禁凭空臆测与盲目修补。
- **测试与环境隔离**：所有的测试、性能压测均在本地 Docker 容器内执行；自动化测试完成后，系统将自动彻底清理 `/tests` 下的临时脚本与数据库脏数据。
- **模块化与契约驱动**：后端提供 OpenAPI 规范接口文档进行契约校验，前端严格依契约开发；复杂模块强制要求使用规范的中文注释，数据库表与字段结构变更必须伴随标准带 `COMMENT` 注释的 Migration 脚本。

## 目录结构

```text
.
├── frontend-v2/
│   └── src/
│       ├── components/
│       │   ├── Comments/       # 评论组件、评论树、API 与状态 hook
│       │   ├── feedback/       # 反馈菜单、弹窗与通知状态
│       │   └── markdown/       # Markdown 正文、目录与解析工具
│       └── App.tsx             # 应用外壳、全局状态与页面装配
├── backend-v2/
│   └── src/
│       ├── controllers/
│       │   └── comments/       # 评论查询、写入和互动控制器
│       ├── services/
│       │   └── feishu-sync/    # 按领域拆分的飞书同步服务
│       ├── routes/
│       └── middlewares/
├── deploy/
│   ├── README.md               # 生产更新、验证与回滚手册
│   └── nginx/                  # 前端服务器 Nginx 配置
├── admin-frontend/             # 仅由 mTLS 控制面托管的管理端
├── cache_data/                 # 本地文章缓存与图片持久卷
├── doc/                        # 【规范】当前运维、架构、接口与功能设计文档
├── tests/                      # 【规范】自动化测试、性能压测及安全测试脚本归档目录
├── logs/                       # 【规范】运行日志、容器日志及测试基准日志统一挂载目录
└── docker-compose.yml
```

公共站、管理端和后端分别独立构建；复杂状态、视图和领域逻辑按职责拆分。

## 配置

复制环境变量模板：

```bash
cp backend-v2/.env.example backend-v2/.env
cp frontend-v2/.env.example frontend-v2/.env
```

在 `backend-v2/.env` 中统一配置数据库、安全密钥、飞书、OAuth 和阿里云邮件推送。默认 `OSS_ENABLED=false`，管理员上传保存在 `cache_data/uploads`，飞书正文图片缓存在 `cache_data/static-images`。该文件只保存在部署主机，不应提交到 Git。

根目录配置与本地 Compose 均使用 MySQL；生产连接值仍只能保存在受限环境文件中。

### 自定义站点字体

在独立管理端“配置 → 站点字体”上传 TTF、WOFF 或 WOFF2（最大 10 MiB）。后端会校验文件签名、原子保存到 `cache_data/fonts`，并将受控本地 URL 写入公开配置；动态站刷新后加载该字体。北京静态站发布快照时会把字体复制为内容寻址资源，因此不会回源后端，也不依赖 OSS/CDN。上传新字体会自动清理上一份受控字体文件。

飞书各表使用 `Environment` 单选字段隔离数据。线上强制设置 `FEISHU_DATA_ENV=Production`，本地 Docker 强制设置为 `Test`；所有飞书读取、查重、更新和新增记录都会限定当前环境，新记录会自动写入该字段。两套环境均拒绝读取 `Environment` 为空的记录（`FEISHU_ALLOW_LEGACY_BLANK_ENV=false`）；只有一次性迁移尚未完成时，才可临时将生产环境设为 `true`。文章正文和图片磁盘缓存也使用独立目录。

`Users` 表按规范化邮箱保持一条最新记录。登录会更新原记录而不是重复新增；用户同步按 `LastLogin` 保留最新状态、删除当前环境内同邮箱的旧记录，并在 Production 兼容期自动为保留的空环境旧记录补上 `Production`。这一自动补标仅用于用户表，不会批量改写评论表。

### 飞书国际化词典

中英文切换依赖飞书多维表格中的国际化词典。生产和测试环境都必须在后端环境文件配置对应表 ID，缺少该项时同步服务会安全跳过，前端会回退到中文：

```env
FEISHU_I18N_DICT_TABLE_ID=your-feishu-i18n-table-id
```

词典表字段名必须精确为 `Key`、`zh-CN`、`en-US`、`Environment`；线上词条的 `Environment` 必须为 `Production`，本地测试词条必须为 `Test`。后端通过 `GET /api/v1/i18n/dict` 向动态站提供词典；北京静态站在发布快照时将相同数据写入 `data/live/i18n.json`。修改词典后，先在管理端执行“系统配置与国际化同步”，再发布北京静态站快照。若动态站接口返回空的 `zh` 和 `en` 对象，应优先检查表 ID、字段名和环境标记，而不是重新创建数据表。

至少需要替换以下安全项：

```env
DATABASE_URL=mysql://user:password@database.example.com:3306/zhuiyi_blog?connection_limit=5&pool_timeout=20&sslaccept=strict
JWT_SECRET=replace-with-a-long-random-string
BACKEND_BIND_IP=127.0.0.1
```

生产服务器应将 `BACKEND_BIND_IP` 改为后端 ECS 私网 IP。`backend-v2/.env`、`frontend-v2/.env` 和 `frontend-v2/.env.production` 均被 Git 忽略；仓库只提交不含真实凭据的 `.env.example`。

根目录本地 Docker Compose 会在容器内将数据库地址覆盖为 `db:3306`。生产连接值不得写入仓库或文档。

OAuth 服务商需要登记对应的正式回调地址，例如 GitHub：

```text
https://www.hizhuiyi.cn/api/v1/auth/github/callback
```

其他 OAuth 提供商使用相同路径规则，将 `github` 替换为对应提供商名称。

## 本地 Docker 部署

先构建前端静态文件，再启动集群：

```bash
cd frontend-v2
npm ci
npm run build
cd ..

docker compose up -d --build
```

首次启动会创建新的 `mysql_data` 数据卷。Compose 不会自动删除任何历史数据卷；如需清理必须另行人工确认。

更新代码后同步到现有容器：

```bash
cd frontend-v2
npm run build
cd ..

docker compose up -d --build
```

如果本机暂时无法拉取 Docker Hub 基础镜像，但后端依赖未变化，可先编译后端，再用离线覆盖文件重建本地服务：

```bash
cd backend-v2
npm run build
cd ..
docker compose -f docker-compose.yml -f docker-compose.local-backend.yml up -d --force-recreate --no-deps backend
```

该覆盖仅把本机 `backend-v2/dist` 只读挂载到已有 backend 镜像，适用于本地验证；恢复网络后仍应执行完整 `--build` 重建镜像。

前端使用 `frontend-v2/dist` 绑定挂载，因此完成前端构建后，Nginx 会直接提供新的资源。后端与管理端改动后，需要重新构建对应产物并替换统一后端容器。

查看状态和日志：

```bash
docker compose ps
docker compose logs --tail=100 db backend frontend static_frontend static_publisher
```

健康检查：

```bash
curl http://localhost/api/v1/health
curl http://localhost:3002/api/v1/health
curl http://localhost:8081/healthz
```

停止服务时保留数据库卷：

```bash
docker compose down
```

除非明确希望删除本地数据库，否则不要执行 `docker compose down -v`。

## 数据库变更

数据库结构仅通过 `backend-v2/prisma/migrations/` 内的 MySQL migration 管理。禁止使用 `prisma db push` 替代正式 migration；本地首次启动由 `db_setup` 自动执行 `prisma migrate deploy`。

## 本地开发

前端：

```bash
cd frontend-v2
npm ci
npm run dev
```

后端：

```bash
cd backend-v2
npm ci
npx prisma generate
npm run dev
```

构建与检查：

```bash
cd frontend-v2
npm run build
npm run lint

cd ../backend-v2
npm run build
```

## 图片上传

管理员图片上传接口：

```text
POST /api/v1/image/upload
Authorization: Bearer <管理员 JWT>
Content-Type: multipart/form-data
文件字段名: file
```

限制如下：

- 单次仅允许一个文件，最大 5 MiB。
- 支持 JPEG、PNG、GIF 和 WebP。
- 服务端会校验真实文件签名，不信任文件名或客户端 MIME。
- `OSS_ENABLED=false` 时原子写入后端持久卷 `cache_data/uploads`，并通过严格文件名、大小和真实签名校验的读取路由提供。
- 只有显式设置 `OSS_ENABLED=true` 且凭据完整时才会启用可选 OSS；默认部署不使用 OSS/CDN。
- 生产集群 Compose 强制关闭 OSS；本地上传默认最多 2000 个文件、总计 2 GiB，并预留至少 2 GiB 磁盘空间。

PicGo 或 Typora 应将返回 JSON 中的 `url` 字段作为图片地址。

## 飞书生活相册

在飞书多维表格中建立相册表并把表 ID 写入 `FEISHU_ALBUM_TABLE_ID`。字段名称和类型必须为：`Name`（文本）、`Photo`（附件）、`Caption`（文本）、`Status`（单选：`Draft` / `Published` / `Hidden`）、`Order`（数字）、`TakenAt`（日期）、`Featured`（复选框）、`Tags`（多选）。每条记录只使用 `Photo` 中的第一张附件。

将 `Status` 改为 `Published` 后，动态站会在下一次飞书同步时更新一级入口 `/album`；旧地址 `/tools/album` 仍兼容。管理员手动调用相册同步接口时，会同时生成快照并请求本地/北京静态发布控制面。静态站不连接数据库或业务 API，只读取 `album.json` 和内容哈希图片。原图最多 15 MiB，服务端生成 WebP 展示图及缩略图；隐藏或删除满 7 天的本地副本由 GC 分批清理。

## 文档

统一文档入口见 [文档索引](doc/文档索引.md)。当前生产部署边界见 [生产部署与版本更新](deploy/README.md)，数据库切换事实见 [数据库迁移执行状态](mysql-version/MIGRATION_STATUS.md)，个人交付方向见 [个人单服务器发行版实施计划](doc/个人单服务器发行版实施计划.md)。

## 安全说明

- 不要提交 `backend-v2/.env`、数据库备份、访问令牌或私钥。
- 示例配置只能使用占位值。
- 生产环境必须使用随机生成的 `JWT_SECRET`。
- 管理接口和图片上传接口必须使用管理员 JWT。
- 管理员 IP 白名单值需要使用纯 IP 文本；服务端会清理字段前后的空白字符，但不会自动放行新的公网 IP。
- 定期检查审计日志、限流记录及失效的 OAuth 凭据。
- 提交前使用 `git status --ignored` 确认 `.env`、日志、缓存、备份和私钥仍处于忽略状态。

## 授权状态

仓库当前没有可供核验的 `LICENSE` 文件，因此不得仅凭旧 README 的文字对外宣称 MIT，也不得在个人版销售页承诺未确定的再分发权。个人单服务器版发布前必须完成自有代码、字体、图片和第三方依赖的许可证清点，并提供明确的个人使用许可条款。
