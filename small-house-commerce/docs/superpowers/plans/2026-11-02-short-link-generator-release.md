# 后台短链生成器（2026-11-02）

## 需求与边界

用户要求：

> “你帮我在后台写一个短链生成器吧”
>
> “不用这么复杂，只需要一个入口一个出口，能把我给你的链接缩短，基本都是我们独立站的链接”

批准的最小设计：

- **入口**：投放工作台新页签「短链」`/admin/marketing/short-links`，粘贴链接 → 生成 → 显示短链 + 复制。
- **出口**：`https://luwag.shop/s/<code>` 302 到原站内 path + query（保留 `variant`、`cl`、`utm_*`）。
- **只做站内链接**：`luwag.shop` / `www.luwag.shop` 或 `/` 开头路径；拒绝外站、协议相对、反斜杠伪装、脚本协议、`/admin`、`/api`、`/preview`、`/s`。
- **存储**：新表 `short_links`（`code` 唯一、`target`、`target_hash` 唯一、`created_at`）。同一规范化目标复用同一 code。
- **不做**：列表管理、点击统计、自定义短码、外链缩短、删除入口。

## 实现

| 文件 | 变更 |
|---|---|
| `backend/prisma/schema/short-link.prisma`（新增） | `ShortLink` 模型 |
| `backend/prisma/migrations/20261102120000_add_short_links/` | additive `CREATE TABLE short_links` + 两个唯一索引 |
| `backend/src/modules/short-links/short-links.service.ts` | 目标规范化、sha256 去重、8 位 base64url 随机码、并发 P2002 复用、公开解析 |
| `backend/src/modules/short-links/admin/short-links.controller.ts` | `POST /api/v1/admin/short-links`，`JwtAuthGuard + MarketingGuard`，`Cache-Control: private, no-store` |
| `backend/src/modules/short-links/storefront/short-links.controller.ts` | `GET /api/v1/storefront/short-links/:code`，未知 code 404，`no-store` |
| `backend/src/modules/short-links/short-links.module.ts`、`app.module.ts` | 模块注册；`MarketingGuard` 本模块提供 |
| `frontend/src/app/s/[code]/route.ts`（新增） | `force-dynamic` 302；目标在跳转前二次校验，杜绝开放重定向；优先用 `x-forwarded-host/proto` 还原公网 origin |
| `frontend/src/components/admin/marketing/ShortLinkTool.tsx`（新增） | 输入 → 生成 → 展示绝对短链 → 复制；400 提示只支持站内链接 |
| `frontend/src/components/admin/marketing/MarketingWorkbench.tsx` | 新增 `shortLinks` 视图与「短链」页签 |
| `frontend/src/app/admin/(shell)/marketing/short-links/page.tsx`（新增） | 页面入口 |
| `frontend/src/lib/marketing-api.ts` | `ShortLinkResult` 类型与 `createShortLink` |
| `frontend/src/i18n/zh.ts`、`en.ts` | 短链文案 |

## 测试（先红后绿）

- 后端 23 项：外部 host / 相似 host / `//evil.com` / `/\evil.com` / `javascript:` / 无前导斜杠 / `/admin`、`/api`、`/preview`、`/s` / 带凭据 / 空串 / 超长全部拒绝；fragment 丢弃；`www` 与相对路径接受；同目标去重；并发 P2002 复用；code 格式与哈希落库；未知/畸形 code 不查库。
- 前端 12 项（`/s/[code]`）：302 + Location、code 编码、404、6 种不安全目标拒绝、**转发头还原公网 origin**、伪造 `x-forwarded-host` 忽略。
- 后台组件 4 项：粘贴生成、复制完整短链、400 文案、非 400 失败不伪装成功；工作台页签断言 1 项。
- 全量前端 **313 文件 / 3509 用例全绿**；`tsc`、ESLint、`pnpm build` 通过（构建表含 `ƒ /s/[code]`）。
- 全量后端 **2720 用例**：唯一失败为既有的 `uploads.service.spec > stores the transcoded bytes for a large mp4`（并行下 ffmpeg `ENCODING_FAILED`），单跑该文件 12/12 通过，与本改动无关。
- 本地生产构建 + 桩后端浏览器链路：已知 code → 302 到目标、未知 → 404。

## 发布中发现并修复的两个真实缺陷

1. **Nest 无法注入 `PrismaService`**：service 里用了 `import type`，运行时被擦除，`design:paramtypes` 变成 `Function`，后端重启进入 unhealthy 循环。改为值导入（`82073be`）。
2. **302 指向容器内地址**：Caddy 反代后 `request.url` 是 `http://0.0.0.0:3000`，首次生产重定向落到不可达主机。改为优先读取 `x-forwarded-host` / `x-forwarded-proto` 并校验后再拼 Location，本地/测试回退到请求 origin（`d58d7f3`）。

两个缺陷均由生产烟测发现，均有对应回归测试；单元测试不经过 Nest DI 和真实反代，因此不能替代这一步。

## 发布记录

- 分支 `feat/short-links-20261102`，提交 `759c405`（功能）、`82073be`（DI 修复）、`d58d7f3`（origin 修复）。
- 生产分支 `staging/luwag-shop-domain` fast-forward 至 `d58d7f3`。
- 迁移前备份：`/home/ubuntu/deploy-backups/pre-short-links-20261102.sql.gz`（255K，`gzip -t` 通过）。
- 迁移 `20261102120000_add_short_links` 已应用（`_prisma_migrations` 有记录，`public.short_links` 存在）。
- 镜像：
  - backend `small-house-prod-backend:latest` → `f673b7c63d39`
  - frontend `small-house-prod-frontend:latest` → `42965d5ddb2f`
- 回滚标签：`small-house-prod-backend:rollback-pre-short-links-20261102` → `c29f43eba6ea`；`small-house-prod-frontend:rollback-pre-short-links-20261102` → `420133258e43`。回滚代码无需回滚表（additive，旧代码不读取 `short_links`）。
- 四个容器 `healthy`。

## 生产验收

- `POST /api/v1/admin/short-links`（容器内签管理员 JWT）：201，返回 `{code, path, target}`；同目标再次提交 code 相同。
- `GET /api/v1/storefront/short-links/:code`：200 `{target}`；未知 code 404。
- 拒绝路径实测 400：`https://evil.com/x`、`/\evil.com/x`、`/admin/orders`、`javascript:alert(1)`。
- `curl -I https://luwag.shop/s/<code>`：`302`，`location: https://luwag.shop/products/...?variant=smoke`（公网 origin 正确）。
- `curl -I https://luwag.shop/s/nope1234`：`404`，`no-store`、`X-Robots-Tag: noindex`。
- 首页、PDP、`/admin/login` 均 200。
- 验收产生的 `variant=smoke` 测试短链与容器内检查脚本已删除；`short_links` 当前 0 行。

## 无关附带改动

- 代码层面：**无**。仅新增短链模块、页面、路由、文案与测试；未改 Header/Footer/shell、商品、订单、结账、像素或 ERP。

## 已知限制

- 自动化浏览器没有后台登录态，因此生产后台页面只验证到 `/admin/marketing/short-links` 返回 200（未登录时跳登录页由客户端完成）；输入框/复制交互由 4 项组件测试覆盖，真实点击需管理员登录后复核。
- 短码永久有效，没有停用/删除入口；误建的短链需要走数据库清理。这是最小设计的取舍。
- 短链不参与投放归因本身：`cl`/`utm_*` 已在目标 query 中保留，点击后由既有 `MarketingTouchObserver` 接管。
