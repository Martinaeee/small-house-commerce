# Storefront Intelligence P1 验收报告（2026-11-10）

- 授权范围：P1（Overview + Attribution Quality & Ad-Level Orders）本地开发；**未执行生产迁移、未修改生产数据、未部署、未操作 Meta、未启动 Synthetic/RUM**；未 push
- 工作树：`.claude/worktrees/observability-p1-20261110`（分支 `feat/observability-p1-20261110`，基线生产 `18016227`）
- 提交（本地，未推送；单次聚焦提交，26 个文件）：**`4f37230c` feat(observability): storefront intelligence P1 — overview, attribution quality & ANALYTICS_VIEW**
  - 原审阅 SHA `83b79afc` 已通过 **amend** 并入最终验收修正（OPTIMIZER 数据隔离 + 重复 H1 去重）；仍为**同一单一提交**，父提交仍为 `18016227`，未产生新提交、未推送。
- 交付报告本身保留为工作树根目录未跟踪文件（不进入代码提交）。

---

## 1. 代码变更清单

### 后端（backend）
| 文件 | 变更 |
|---|---|
| `prisma/schema/identity.prisma` | `PermissionCode` 新增 `ANALYTICS_VIEW`（additive 枚举值） |
| `prisma/rbac.ts` | 权限描述 + 授予 SUPER_ADMIN / ADMIN / OPTIMIZER（OPTIMIZER 在服务层 owner-scoped） |
| `prisma/migrations/20261110150000_add_analytics_view_permission/migration.sql` | `ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'ANALYTICS_VIEW';`（唯一一条，纯加法） |
| `prisma/reconcile-analytics-view-permissions.ts` / `-runner.ts` / `.spec.ts` | 权限行 + 角色授予的 reconcile（沿用既有 order/marketing 模式） |
| `docker-entrypoint.sh` | 容器启动时在 `exec node dist/main` 前运行 `pnpm run rbac:reconcile-analytics-view`（部署时才生效，本轮未执行） |
| `package.json` | 新增 `rbac:reconcile-analytics-view` 脚本并加入 lint 文件清单 |
| `src/modules/observability/observability.module.ts` | 模块注册（AuthModule） |
| `src/modules/observability/admin/observability.controller.ts` | `@Controller('admin/observability')` + `@Permissions('ANALYTICS_VIEW')`；`GET overview`、`GET attribution`，`Cache-Control: private, no-store` |
| `src/modules/observability/observability.service.ts` | 两枚只读聚合：Overview（会话/订单分状态/提交尝试/失败原因）、Attribution（adid_source 矩阵、缺失原因、fbclid 覆盖、四层交付、广告级订单）；owner-scope；无法验证的值返回 `UNKNOWN`；CAPI outbox 只读统计 |
| `src/modules/observability/observability-window.ts` | Manila 日历窗口解析（默认近 7 天，最大 90 天） |
| `src/modules/observability/dto/observability.dto.ts` | Zod 查询校验（from/to） |
| `src/modules/observability/observability.service.spec.ts` | 7 项：窗口口径/越界拒绝、owner-scope、UNKNOWN 不置零、矩阵映射、Meta dedup Unknown、覆盖率降级、SQL 范围过滤 |
| `src/modules/observability/admin/observability.controller.spec.ts` | 3 项反向测试：控制器必须挂 `ANALYTICS_VIEW`、无写端点、只读表面 |
| `prisma/rbac.spec.ts` | 唯一既有测试更新：OPTIMIZER 精确授权数组加入 `ANALYTICS_VIEW`（有 ledger ruling） |

### 前端（frontend）
| 文件 | 变更 |
|---|---|
| `src/lib/admin-api.ts` | 新增 `observabilityOverview` / `observabilityAttribution` 只读调用与类型（含 metricMeta 四要素） |
| `src/components/admin/AdminShell.tsx` | 新增「Storefront Intelligence」导航组（Overview / Attribution Quality），仅 `ANALYTICS_VIEW` 可见 |
| `src/i18n/en.ts` / `zh.ts` | 新增观测相关文案键（标题/卡片/表头/UNKNOWN 提示/刷新等） |
| `src/components/admin/observability/OverviewView.tsx` | Overview 展示：会话/订单/尝试/失败 Top/状态分组/Pixel 派发（UNKNOWN 原样）+ metricMeta |
| `src/components/admin/observability/AttributionView.tsx` | 归因质量页：adid_source 矩阵/缺失原因/fbclid 覆盖/四层交付/广告级订单表 + metricMeta |
| `src/components/admin/observability/ObservabilityViews.spec.tsx` | 4 项组件测试（含 scope 标注、UNKNOWN 展示、无数据不置零） |
| `src/app/admin/(shell)/observability/page.tsx` | Overview 路由（403 提示 + 手动刷新） |
| `src/app/admin/(shell)/observability/attribution/page.tsx` | Attribution 路由 |

## 2. Prisma migration 检查结果

| 检查 | 结果 |
|---|---|
| `prisma validate`（仓库真实 schema 目录 `prisma/schema`，Prisma 7.10.0） | **exit 0**（"Prisma schema loaded" 无错误） |
| `prisma generate`（本地） | 成功（客户端已含 `ANALYTICS_VIEW`） |
| 迁移文件内容 | 仅 `ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'ANALYTICS_VIEW'`（additive；无表/列/数据改动；不可回滚枚举值但无行为副作用） |
| 迁移执行状态 | **未执行任何数据库迁移**（本地与生产均未 apply） |
| 权限行/授权写入 | 仅在部署时的 entrypoint `rbac:reconcile-analytics-view` 执行（本轮未运行、无 DB 写入） |

## 3. 权限矩阵与反向测试结果

| 角色 | ANALYTICS_VIEW | 说明 |
|---|---|---|
| SUPER_ADMIN | ✅ | ALL_PERMISSIONS 自动包含 |
| ADMIN | ✅ | 显式加入 |
| OPTIMIZER | ✅（owner-scoped） | 服务层 scope：仅本人订单与归因数据 |
| CONFIRMOR / WAREHOUSE / FINANCE | ❌ | 反向断言验证 |

反向测试证据：
- `reconcile-analytics-view-permissions.spec.ts` 5/5：正确授予 3 个角色；**明确断言 CONFIRMOR/WAREHOUSE/FINANCE 不授予**；entrypoint 顺序在 `exec node dist/main` 之前；缺角色时报告 missingRoleCodes。
- `observability.controller.spec.ts` 3/3：控制器反射元数据 = `ANALYTICS_VIEW`（无权限 -> 403 于查询之前）；只暴露 overview/attribution 两个只读方法。
- 数据范围：service spec 断言无 `MARKETING_VIEW_ALL` 时 order groupBy 携带 `optimizerId = 用户`，广告级 SQL 含 `optimizer_id` 过滤；有权限时 `scope={all:true}`。

## 4. Overview 与现有 Dashboard / ProductFunnel 对账证据（生产只读 SQL）

固定窗口：**2026-11-04 00:00 → 2026-11-10 24:00（Asia/Manila = 2026-11-03T16:00Z → 2026-11-10T16:00Z）**；`BEGIN READ ONLY` + `statement_timeout=20s` + `ROLLBACK`，无写入。

| 指标 | 口径 | 生产实测 |
|---|---|---|
| Sessions（Overview） | `COUNT(DISTINCT session_id) WHERE event_name='PAGE_VIEW'` | **1207** |
| Sessions（Dashboard 分母） | 同一 SQL 定义（dashboard.service.ts L796） | **1207**（同一定义，一致） |
| Orders（Overview，全部状态） | `orders.created_at` 窗口内，按状态分组 | **10**（CONFIRMED 7 + NEW 3） |
| Orders（Dashboard 有效销售） | 排除 CANCELLED/DENIED/RETURNED/PARTIALLY_RETURNED | **10**（本窗口无排除项） |
| Orders（ProductFunnel ORDER facts） | `orders JOIN order_items ON product_id IS NOT NULL`（无状态过滤） | **10** |
| Attribution 行 | 窗口内订单的 `order_attributions` | **10**（`adid_source` 全为 NULL；`adid_missing_reason` 0 条；fbclid 0/10） |
| CAPI（近 7 天） | `meta_conversion_events.status` | SENT **201**，无 FAILED/PENDING 行 |
| First-party PURCHASE 覆盖 | 窗口内订单中在 `analytics_events` 有 `PURCHASE(entity_id=orderNumber)` | **6 / 10** |

结论：
- Overview 的 sessions/orders 与 Dashboard、ProductFunnel **同窗口数值一致（1207 / 10 / 10）**；差异仅存在于「Dashboard 有效销售排除取消/退货」这一既定口径（本窗口无差异），报告在页面上以定义文案明示。
- 归因矩阵将如实显示 `adid_source=NULL ×10`（R4 之前/无归因订单），不伪造来源；`Meta dedup` 恒为 UNKNOWN。
- 以上均为只读查询；未写入任何数据。

## 5. pnpm test / build / tsc 结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 后端全量测试 | `backend: pnpm test`（最终树同版） | **208 files passed / 27 skipped；2742 passed / 277 skipped / 0 failed**；提交后定向复跑 36/36 |
| 前端全量测试 | `frontend: pnpm test` | **345 files passed；3818 passed / 0 failed** |
| 后端构建 | `backend: pnpm build` | **exit 0** |
| 前端构建 | `frontend: pnpm build` | **exit 0**（Compiled successfully；59/59 pages） |
| 后端 lint（本轮文件） | `oxlint src/modules/observability prisma/reconcile-analytics-* prisma/rbac.*` | **exit 0，0 warning / 0 error** |
| 前端 eslint（本轮文件） | `eslint observability/ admin-api.ts AdminShell.tsx` | **exit 0** |
| 后端 tsc（本轮文件） | `tsc -p . --noEmit` 过滤 observability/reconcile-analytics | **0 错误** |
| 前端 tsc（本轮文件） | `tsc -p . --noEmit` 过滤 observability/admin-api/AdminShell | **0 错误** |
| 仓库级 `tsc -p .`（含既有 spec） | — | 存在**既有**的 spec 类型错误（与本轮无关；`pnpm build` 使用的构建配置通过） |

## 6. 生产影响评估与回滚

### 影响评估（当前状态：未部署）
- **生产代码/数据库/Meta/DNS/外部服务均未变更**；迁移未 apply；reconcile 未执行；无任何写入。
- 若未来批准发布：新增内容仅为 1 个枚举值 + 权限/授权行 + 2 个只读 GET 端点 + 2 个后台页面 + 导航组（受权限门禁）。
- 性能：端点只读聚合，使用 `event_day/created_at` 等既有索引；服务层时间窗最大 90 天，查询覆盖 `analytics_events/orders/order_attributions/meta_conversion_events` 的轻量 groupBy/$queryRaw；不改变任何写路径。
- 权限：未授予者看不到导航组；控制器 `@Permissions('ANALYTICS_VIEW')` 先于查询拒绝。

### 回滚
1. 代码：`git revert 4f37230c`（单一 P1 提交；或直接把分支 reset 到 `18016227`）——无数据依赖。
2. 部署后回滚：撤销 entrypoint 行与迁移声明即可；`ALTER TYPE ... ADD VALUE` 无法移除但无行为副作用（枚举值闲置）。
3. 数据：无数据写入由本阶段产生；reconcile 仅新增权限/授权行，删除该权限行即可恢复原矩阵。

## 7. 最终验收（v2，2026-11-10）

### 7.1 Git 核查（最终 SHA `4f37230c`）
- `git rev-parse HEAD^` == `18016227`：**true**
- `git log --oneline --decorate`：
  ```
  4f37230c (HEAD -> feat/observability-p1-20261110) feat(observability): storefront intelligence P1 — overview, attribution quality & ANALYTICS_VIEW
  18016227 (prod/deploy/remediation-20261110, fix/audit-remediation-20261109-r2) perf(storefront): scope the route loading fallback away from product pages
  7fba9880 fix(storefront): harden checkout reliability, receipts, attribution and layout
  ```
- `git status --short`：仅 `?? .superpowers/`、`?? p1-preview-shots/`、`?? storefront-intelligence-p1-acceptance-report-20261110.md`（内部目录 / 截图 / 报告均未跟踪）
- `git show --stat HEAD`：**26 files changed, 1488 insertions(+), 2 deletions(-)**
- `git diff --check 18016227...HEAD`：**exit 0**（无空白错误）
- 验收报告是否被纳入提交：**否**（name-only 扫描 0 命中）
- 回滚命令（最终）：`git revert 4f37230c`（或 reset 到 `18016227`）

### 7.2 OPTIMIZER 数据隔离（owner-scope）

| 指标 | owner-scope 行为 | 查询范围 | 测试证据 |
|---|---|---|---|
| Sessions | **UNKNOWN（null）**，且不查询事件表 | 仅 `scope.ownerUserId === null` 时才执行 `analyticsEvent.groupBy(sessionId, PAGE_VIEW)` | service spec：owner 断言 sessions=null 且 groupBy **未被调用** |
| Checkout Attempts | **UNKNOWN（null）** | 仅全平台 scope 执行 count | service spec：count 未被调用 |
| Failure Reasons | **UNKNOWN（null）** + withheld 文案 | 仅全平台 scope 执行 `$queryRaw(metadata->>'reason')` | service spec：failures=null |
| Orders | owner-scoped | `order.groupBy(where { createdAt, optimizerId })` | spec：断言 groupBy 参数含 `optimizerId` |
| Attribution（adid_source / missing / fbclid） | owner-scoped | `orderAttribution.groupBy(where { order: { createdAt, optimizerId } })` | spec 映射断言 + 全量套件 |
| Ad-Level Orders | owner-scoped | `$queryRaw ... AND o.optimizer_id = $owner` | spec：SQL 字符串含 `optimizer_id` |
| CAPI Delivery | **UNKNOWN**（平台 outbox 无法可靠归属） | 仅全平台 scope 查询 `meta_conversion_events` | spec：owner 断言 `capiDelivery.status === 'UNKNOWN'` |
| First-party Purchase Coverage | owner-scoped | `$queryRaw ... AND o.optimizer_id = $owner` | 同上 SQL 范围断言 |

原则：**无法可靠关联 owner 的事件（Sessions / Attempts / Failure Reasons / CAPI outbox）在 owner-scope 下不返回全平台汇总，统一 UNKNOWN + 说明；可关联指标全部带 owner 过滤。**

### 7.3 本地预览与四张截图（全 Mock，无真实客户数据）
- 预览地址：`http://localhost:3311/admin/observability` 与 `http://localhost:3311/admin/observability/attribution`（本地 `next start` 生产构建；auth 与 observability API 均由 Playwright 路由 Mock，**未连接生产 API**）
- 截图（`p1-preview-shots/`）：
  - `overview-desktop.png`（1440×900）
  - `attribution-desktop.png`（1440×900）
  - `overview-mobile.png`（390×844）
  - `attribution-mobile.png`（390×844）
- 备注：普通浏览器直接打开会因无真实登录会话跳转登录页；截图会话由 Mock 鉴权驱动。

### 7.4 页面功能检查结果
| 检查 | 结果 |
|---|---|
| 刷新 | 点击「刷新」：overview 请求 1→2 ✅ |
| 加载状态 | 2.5s 延迟 Mock 下「加载中…」可见 ✅ |
| 空数据 | 全零/空数组 Mock 显示「本窗口无数据。」✅ |
| UNKNOWN | 归因页显示 `UNKNOWN (not verifiable from this backend)` ✅ |
| 权限拒绝（API 403） | 显示「无权访问本页。」✅ |
| 移动端布局 | 390×844 两页横向溢出 = **0px** ✅ |
| 时间筛选 | **未实现**（无日期控件）→ 见剩余问题 |

### 7.5 剩余问题清单
1. **时间筛选未实现**：后端已支持 `from/to`（≤90 天），前端未放置日期选择器；建议在 P2 前补齐（不属于本轮新增功能）。
2. 生产窗口 `order_attributions.adid_source` 全 NULL（窗口内订单无 R4 溯源），页面如实显示 NULL，属数据现状。
3. owner-scope 下 Sessions/Attempts/Failure/CAPI 按设计为 UNKNOWN；若需 owner 级访问量，复用 ProductFunnel 的 owner-scoped 指标。
4. `next start` 对 `output: standalone` 有 warning（仅本地预览方式；发布走容器 entrypoint）。
5. 全仓 `tsc -p .`（含既有 spec）仍有历史类型错误（非本轮文件）；`pnpm build` 通过。

## 8. 阶段控制

- P1 开发完成并**立即暂停**；等待明确确认后，才可能进入 P1 生产迁移/部署或 P1.5。
- 未启动 Synthetic Runner；未加入 RUM/Client Error/API Metrics 采集；未触碰 P2–P5。

*（附：工作 ledger 保存在仓库外的 `/tmp/si-p1-ledger/progress.md`；测试/构建原始输出见本报告与提交历史。）*
