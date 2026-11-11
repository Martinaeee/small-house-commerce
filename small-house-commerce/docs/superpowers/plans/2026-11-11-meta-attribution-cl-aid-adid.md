# Meta 投放链接 CL + AID + 动态 AdID 归因闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后台创建「干净落地页 URL + CL + AID」，由优化师在 Meta 的 URL 参数里填 `cl=<CL>&aid=<AID>&adid={{ad.id}}`，并让访问、商品浏览、加购、结账、订单和后台报表完整继承同一份验签归因。

**Architecture:** 保留现有 CL 链接与 `campaign_link_visits`；在第一方 analytics 事件和订单归因快照上补齐「验签 claims → 优化师 / AdID / 来源」字段。链接创建/展示只改呈现层（新增 `cleanPath` 与按链接生成的 Meta 参数），不改旧 `path` 语义。触达服务增加 CL 失败回退 AID、冲突保留链接身份、AdID provenance。报表新增「按 AdID」「按 AID」两个只读维度，不改现有核算/漏斗口径。

**Tech Stack:** NestJS 12 + Prisma 7 + PostgreSQL 18；Next.js 16 + React 19 + Vitest；Docker Compose（staging `luwag-staging` / production `small-house-prod`）。

**Spec:** `docs/superpowers/specs/2026-11-11-meta-attribution-cl-aid-adid.md`

## Global Constraints

- 生产基线是 `prod/staging/luwag-shop-domain` 的 `1a3cbaf4`；本计划只在该基线的新 worktree 上执行。
- **同一个 Agent Native 顺序执行，不切换代理；每个 Task 测试通过后再提交，再进入下一项。**
- 旧链接的 `path`、短链目标、`campaign_link_visits` 写入规则保持兼容；历史订单/链接不重写。
- **FB_POST 的追踪 URL、短链、结果弹窗、复制按钮全部保持现状；只有 META_AD 使用 `cleanPath` / 三件套。**
- **AID 快照以链接创建时的 `aidSnapshot` 为准；Meta 参数只使用后端生成的 `metaUrlParameters`，前端不自行拼接。**
- 归因身份字段（优化师、链接、商品、落地页、AdID 来源）只能来自服务端验签 claims；客户端 body 只作原始事件字段。
- `{{ad.id}}` 复制到 Meta 时必须原样输出，禁止 URL 编码。
- 最终追踪参数固定为 `cl`、`aid`、`adid` 三个；`campaign_id`/`adset_id`/UTM 允许为空，**不得为了测试通过而增加追踪参数**。
- 所有新数据库列必须可空；迁移只加列/索引，不改既有数据。
- Staging 的 Pixel/CAPI 是关闭的（compose 显式置空），第 12 项验收用本地/预览 + Meta 测试事件，不碰生产。
- **Task 14 只部署 Staging；Task 15 不执行；Task 16 不实施；不修改生产代码或生产数据库。**
- 所有 Task 完成后先提交完整审核报告，等待用户确认后再讨论生产部署。

## Review Focus

- 复制出的 Meta 参数被 URL 编码成 `%7B%7Bad.id%7D%7D`，Meta 不替换 → AdID 永远缺失。测试：结果弹窗直接使用后端 `metaUrlParameters`，断言含原始 `{{ad.id}}`。
- 新广告仍使用旧 `?aid=` 链接或短链丢掉 `cl` → 「已登记链接访问」继续为 0。测试：短链 route 转发 `cl`；META_AD 列表复制的是 `cleanPath`，FB_POST 仍复制旧 `path`。
- 商品 URL 与链接落地页不一致（`/products/x` vs `/lp/x`）→ `touchLink` 路径校验失败，整次触达丢失。测试：路径不匹配时 CL 回退到 AID，而不是空凭据。
- 客户端伪造 `campaignId`/`adId` 被写进报表 → 口径污染。测试：analytics ingest 只用 claims，忽略 body 的 `campaignId`。
- 同一 CL 的多个 AdID 被合并成一行，或把 CL 访问与 AdID 访问相加 → 数字虚高。测试：`ADID` 分组按 `(link_id, ad_id, optimizer_id, aid_snapshot)` 分行，`visits` 列为 null，`adVisits` 独立去重；优化师取验签 claims，不取链接 owner。

---

## 0. 只读审查（2026-11-11）

### 0.1 生产 / 工作区状态

| 位置 | 状态 | 结论 |
|---|---|---|
| 生产服务器 `/opt/small-house-commerce` | `git log -1` = `1a3cbaf4`，与本地 `prod/staging/luwag-shop-domain` 一致 | 本计划以该 ref 为准 |
| 当前 worktree `homepage-builder` | 分支 `deploy/footer-20261023` @ `94b4c59e`；落后生产 **280** 个提交，只有 6 个本地 docs 提交不在生产 | **不要在本 worktree 改代码** |
| 当前 worktree 未提交改动 | `marketing-touch.service.ts/.spec.ts`、`orders.service.attribution.spec.ts`、`tracking.ts` 共 4 个文件 | 内容是生产已上线行为的旧版本（如 `adId` 覆盖、`ad_id` 读取），不是未部署新功能 |
| 生产容器 | `small-house-prod-backend-1` / `frontend-1` / `db-1` 健康 | 无紧急故障 |
| Staging | `/opt/luwag-staging`，DB `luwag_staging_test`，公开地址 `http://127.0.0.1:8088` | 可用于 12 项验收（Pixel/CAPI 除外） |

### 0.2 需求 vs 生产现状

| 需求 | 生产现状（1a3cbaf4） | 差距 |
|---|---|---|
| 创建后只显示干净 URL / CL / AID | `linkPath()` 自动拼 `?cl=` 或 `?aid=` + variant + UTM；`PostLinkResultDialog` 显示带参 URL；列表只把 CL/AID 当文本 | **要改**：新增 `cleanPath`、独立复制按钮、按链接的 Meta 参数 |
| Meta 参数 `cl=…&aid=…&adid={{ad.id}}` | 常量 `META_URL_PARAMETERS` 只有 `adid/campaign_id/adset_id/utm_*`，没有 `cl/aid`，且所有链接相同 | **要改** |
| 前端独立读取所有参数 | `marketingParams()` 已同时读 `cl/aid/adid/ad_id/campaign_id/adset_id/fbclid/fbc/fbp/utm_*`，并把 `cl+aid` 一起发送；`{{ad.id}}` 被 `META_ID` 正则丢弃；`tracking.touch.spec.ts` 已覆盖 cl+aid+adid 同读、`adid` 优先 `ad_id`、非法模板丢弃 | **无需改代码**；验收时复跑现有测试 |
| CL 定位链接/商品/落地页 | `touchLink()` 用 code 查链接并校验 path/product/landingPage | 已实现 |
| AID 识别优化师 | `touchLink()` 在 AID 有效且与链接不同时覆盖 owner；`signAid()` 支持 | 部分实现，但冲突时 `linkId` 被置空 |
| AdID 动态优先、静态回退 | `touchLink()`：`adId = dynamicAdId ?? link.adId`；订单 `attribution.adId = touch.adId` | 已实现（claims/orders 的 `ad_id` 列） |
| 记录 `adid_source` / `adid_missing_reason` | 订单表 `order_attributions` 已有 `adid`、`adid_source`、`adid_missing_reason`；**claims 和 analytics 事件没有** | **要改**：claims 补 provenance，events 补列 |
| CL 与 AID 冲突必须记录、不能静默错配 | 有效 AID 冲突 → `attributionConflict/conflictDetail`，但 `signAid` 把 `linkId` 置空；无效 AID 冲突不记录 | **要改** |
| 凭据含完整归因 | v2 claims 已有 owner/aid/link/product/page/source/adId/campaign/adset/fbclid/utm/paid/conflict | 缺 `adIdSource`、`adIdMissingReason`、`linkResolution` |
| 不信任客户端未验证字段 | 链接/优化师/商品均从 DB 校验；但 analytics 的 `campaignId` 直接取 body | **要改**：只取 claims |
| 订单固化完整快照 | `order_attributions` 已有 optimizerId/aidSnapshot/adId/adid/adidSource/adidMissingReason/linkId/productId/landingPageId/fbclid/UTM/firstTouch/lastPaidTouch | 字段齐全；动态 AdID 与链接编号不一致时 `adid` 仍取链接编号 |
| 报表按 AID/商品/AdID/CL | 现有 `LINK/PAGE/PRODUCT/OWNER` 分组；访问只数 `campaign_link_visits`；加购/发起购物按 `campaign_link_id`；无 `PRODUCT_VIEW` 列；AID 模式链接隐藏核算入口 | **要改**：新增 AdID/AID 维度与事件指标 |
| Staging 12 项验收 | 现有单测覆盖触达/订单/报表部分；无本闭环 E2E | **要加** |

### 0.3 数据库字段与历史数据（生产实测）

| 表 | 已有 | 缺口 |
|---|---|---|
| `campaign_links` | `attribution_mode`、`adid`、`ad_id`、`campaign_id`、`adset_id`、UTM | 无 |
| `campaign_link_visits` | 1,092 行；全部来自 CL 链接；2 条 AID 链接为 0 | 无 |
| `analytics_events` | `campaign_id`、`campaign_link_id`；无 `ad_id/optimizer_id/adset_id/adid_source/...` | **需要迁移** |
| `order_attributions` | `adid/adid_source/adid_missing_reason/ad_id/campaign_id/adset_id/fbclid/optimizer_id/aid_snapshot/link_id/landing_page_id/first_touch/last_paid_touch` 全部存在 | 索引缺 `(link_id, ad_id)`、`(ad_id, attributed_at)` |

历史数据：

- 链接 22 条：`FB_POST/CL` 12、`META_AD/CL` 8、`META_AD/AID` 2；全部有 `adid`，`ad_id` 全为 null。
- 事件 5,446 条：2,239 条 URL 含 `cl`、1,461 条含数字 `adid`、236 条含 `aid`、32 条含字面量 `{{ad.id}}`、957 条已解析 `campaign_link_id`。
- 订单 10 张（2026-11-04 至 11-07），全部早于 `adid_source` 迁移；`adid_source`/`adid_missing_reason` 为空、`ad_id` 为 0 是预期。
- 结论：历史 AdID 无法从数据库完整恢复；新报表标注「自上线起」，默认不回填（Task 16 为可选、需单独批准）。

### 0.4 影响面（用户点名：商品漏斗、核算）

| 模块 | 当前口径 | 本计划影响 |
|---|---|---|
| 商品漏斗 `marketing-funnel.sql.ts` | ADS = `campaign_link_id IS NOT NULL`；aid-only 流量算 ORGANIC | 不改代码。当前 P-000018 的 aid-only 广告访问（2026-11-11 实测 14 个会话）在漏斗里算 ORGANIC；广告改为 `cl+aid` 后自然转为 ADS。**这是预期变化，需在验收时说明** |
| 核算 `marketing-report.service.ts` | visits=`campaign_link_visits`；加购/发起购物=`analytics_events.campaign_link_id`；订单=`order_attributions.link_id` | 现有分组/列不变；新增 ADID/AID 分组独立查询。旧 AID 链接在收到 CL 访问后开始有数据；未收到前仍为 0（不再显示「报表待上线」） |
| 性能视图 `marketing-performance.sql.ts` | 落地页访问 `landing_page_visits` + 链接费用/订单 | 不改 |
| 仪表盘 `dashboard.service.ts` | 直接读 `analytics_events` 总量 | 加列不影响 |
| CAPI/Pixel | 用 `fbclid/fbc/fbp` + Purchase outbox 去重 | 不改；新增 claims 字段不影响 |
| 订单历史 | `order_attributions` 不可变 | 不改；新列可空 |

### 0.5 文件与迁移清单

**后端**

- 修改：`backend/prisma/schema/analytics.prisma`
- 新增：`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`
- 修改：`backend/src/modules/marketing/marketing-attribution.ts`（共享 provenance 类型/函数）
- 修改：`backend/src/modules/marketing/dto/marketing-touch.dto.ts`
- 修改：`backend/src/modules/marketing/marketing-touch.service.ts`
- 修改：`backend/src/modules/analytics/analytics.service.ts`
- 修改：`backend/src/modules/orders/orders.service.ts`
- 修改：`backend/src/modules/marketing/campaign-links.service.ts`
- 修改：`backend/src/modules/marketing/marketing-report-facts.ts`
- 修改：`backend/src/modules/marketing/marketing-report.service.ts`
- 修改：`backend/src/modules/marketing/dto/marketing-report.dto.ts`
- 修改：`backend/src/modules/marketing/marketing-report-metrics.ts`
- 修改：`backend/src/modules/marketing/marketing-report-sort.ts`
- 新增：`backend/src/modules/marketing/marketing-attribution-report.service.ts`
- 测试：`marketing-touch.service.spec.ts`、`analytics.service.spec.ts`、`orders.service.attribution.spec.ts`、`campaign-links.service.spec.ts`、`marketing-report*.spec.ts`
- 可选：`backend/scripts/backfill-analytics-attribution.ts`

**前端**

- 修改：`frontend/src/lib/marketing-api.ts`
- 修改：`frontend/src/components/admin/marketing/PostLinkResultDialog.tsx`
- 修改：`frontend/src/components/admin/marketing/CampaignLinksList.tsx`
- 修改：`frontend/src/components/admin/marketing/CreateCampaignLinkDialog.tsx`
- 修改：`frontend/src/app/s/[code]/route.ts`
- 新增：`frontend/src/components/admin/marketing/ReportAttributionTable.tsx`
- 修改：`frontend/src/components/admin/marketing/ReportTable.tsx`
- 修改：`frontend/src/i18n/zh.ts`、`frontend/src/i18n/en.ts`
- 测试：`CampaignLinksList.spec.tsx`、`CreateCampaignLinkDialog.spec.tsx`、`ReportTable.spec.tsx`、`ReportAttributionTable.spec.tsx`、`frontend/src/app/s/[code]/route.spec.ts`

**不改**

- `marketing-funnel.sql.ts`、`marketing-performance.sql.ts`、`dashboard.service.ts`、CAPI outbox、Qianyi、库存。

### 0.6 执行前提

1. 新建 worktree（Task 0），不要在当前 stale worktree 上改。
2. 生产变更必须先完成 staging 12 项验收，并得到用户逐项确认。
3. 任何生产迁移前先备份数据库（`pg_dump`）与回滚镜像标签。
4. 本计划不包含生产执行步骤；Task 15 只列发布清单，执行前需再次授权。

---

## 文件地图（执行期）

```
small-house-commerce/
  backend/
    prisma/schema/analytics.prisma                     ← Task 1
    prisma/migrations/20261111120000_add_analytics_attribution/migration.sql ← Task 1
    src/modules/marketing/marketing-attribution.ts     ← Task 2
    src/modules/marketing/dto/marketing-touch.dto.ts   ← Task 2
    src/modules/marketing/marketing-touch.service.ts   ← Task 3/4
    src/modules/analytics/analytics.service.ts         ← Task 5
    src/modules/orders/orders.service.ts               ← Task 6
    src/modules/marketing/campaign-links.service.ts    ← Task 7
    src/modules/marketing/marketing-report*.ts         ← Task 11
  frontend/
    src/components/admin/marketing/*.tsx               ← Task 8/9/10/12
    src/app/s/[code]/route.ts                          ← Task 10
    src/i18n/{zh,en}.ts                                ← Task 12
```

---

### Task 0: 从生产基线建立干净 worktree

**Files:** 无（环境准备）

**Interfaces:**
- Produces: 一个 HEAD = `1a3cbaf4` 的干净 worktree，后续所有 Task 在此执行。

- [ ] **Step 1: 确认生产 ref 与本地 remote**

Run:
```bash
git -C /Users/Admin1/Desktop/菲律宾家居/建站/codex建站 remote -v | grep prod
git -C /Users/Admin1/Desktop/菲律宾家居/建站/codex建站 rev-parse --short prod/staging/luwag-shop-domain
```
Expected: `prod` remote 存在；输出 `1a3cbaf4`。

- [ ] **Step 2: 新建隔离 worktree**

Run:
```bash
cd /Users/Admin1/Desktop/菲律宾家居/建站/codex建站
git worktree add .claude/worktrees/meta-attribution-20261111 -b deploy/meta-attribution-20261111 prod/staging/luwag-shop-domain
cd .claude/worktrees/meta-attribution-20261111
git log --oneline -1
```
Expected: HEAD 为 `1a3cbaf4`。

- [ ] **Step 3: 安装依赖并跑基线测试**

Run:
```bash
pnpm --dir small-house-commerce/backend install --frozen-lockfile
pnpm --dir small-house-commerce/frontend install --frozen-lockfile
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing src/modules/analytics src/modules/orders
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing src/app/s
```
Expected: 全部通过；记录基线用例数。

- [ ] **Step 4: 把本计划与 spec 复制进新 worktree**

Run:
```bash
mkdir -p small-house-commerce/docs/superpowers/{plans,specs}
cp "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/homepage-builder/small-house-commerce/docs/superpowers/plans/2026-11-11-meta-attribution-cl-aid-adid.md" small-house-commerce/docs/superpowers/plans/
cp "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/homepage-builder/small-house-commerce/docs/superpowers/specs/2026-11-11-meta-attribution-cl-aid-adid.md" small-house-commerce/docs/superpowers/specs/
git add small-house-commerce/docs/superpowers
git commit -m "docs(marketing): spec and plan for CL/AID/dynamic AdID attribution"
```
Expected: 提交成功。

---

### Task 1: analytics_events 归因列 + 订单索引迁移

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/analytics.prisma:45-70`
- Create: `small-house-commerce/backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`
- Test: `small-house-commerce/backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`（SQL 审查 + staging 应用）

**Interfaces:**
- Produces: `analytics_events` 新列 `optimizer_id`、`aid_snapshot`、`ad_id`、`ad_id_source`、`ad_id_missing_reason`、`adset_id`、`attribution_paid`、`link_resolution`、`attribution_conflict`、`conflict_detail`；索引 `(ad_id,event_name,event_day)`、`(optimizer_id,event_name,event_day)`、`(campaign_link_id,ad_id,event_day)`；`order_attributions` 索引 `(link_id,ad_id)`、`(ad_id,attributed_at)`。

- [ ] **Step 1: 在 Prisma schema 里加列**

`analytics.prisma` 的 `AnalyticsEvent` 内、`campaignLinkId` 之后加入：

```prisma
  /// Verified attribution copied from the signed marketing-touch credential.
  /// Never from the public event body; null means no verified touch.
  optimizerId      String?  @map("optimizer_id") @db.Uuid
  aidSnapshot      String?  @map("aid_snapshot") @db.VarChar(64)
  adId             String?  @map("ad_id") @db.VarChar(64)
  adIdSource       String?  @map("ad_id_source") @db.VarChar(24)
  adIdMissingReason String? @map("ad_id_missing_reason") @db.VarChar(48)
  adsetId          String?  @map("adset_id") @db.VarChar(64)
  attributionPaid  Boolean? @map("attribution_paid")
  linkResolution   String?  @map("link_resolution") @db.VarChar(16)
  attributionConflict Boolean? @map("attribution_conflict")
  conflictDetail   String?  @map("conflict_detail") @db.VarChar(240)
```

并在 `@@index` 列表追加：

```prisma
  @@index([adId, eventName, eventDay])
  @@index([optimizerId, eventName, eventDay])
  @@index([campaignLinkId, adId, eventDay])
```

- [ ] **Step 2: 写迁移 SQL**

`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`：

```sql
ALTER TABLE "analytics_events"
  ADD COLUMN "optimizer_id" UUID,
  ADD COLUMN "aid_snapshot" VARCHAR(64),
  ADD COLUMN "ad_id" VARCHAR(64),
  ADD COLUMN "ad_id_source" VARCHAR(24),
  ADD COLUMN "ad_id_missing_reason" VARCHAR(48),
  ADD COLUMN "adset_id" VARCHAR(64),
  ADD COLUMN "attribution_paid" BOOLEAN,
  ADD COLUMN "link_resolution" VARCHAR(16),
  ADD COLUMN "attribution_conflict" BOOLEAN,
  ADD COLUMN "conflict_detail" VARCHAR(240);

CREATE INDEX "analytics_events_ad_id_event_name_event_day_idx"
  ON "analytics_events"("ad_id", "event_name", "event_day");
CREATE INDEX "analytics_events_optimizer_id_event_name_event_day_idx"
  ON "analytics_events"("optimizer_id", "event_name", "event_day");
CREATE INDEX "analytics_events_campaign_link_id_ad_id_event_day_idx"
  ON "analytics_events"("campaign_link_id", "ad_id", "event_day");

CREATE INDEX "order_attributions_link_id_ad_id_idx"
  ON "order_attributions"("link_id", "ad_id");
CREATE INDEX "order_attributions_ad_id_attributed_at_idx"
  ON "order_attributions"("ad_id", "attributed_at");
```

- [ ] **Step 3: 在 staging 空库/副本上验证迁移**

Run:
```bash
# 在 staging 服务器
docker exec -i luwag-staging-db-1 psql -U luwag_staging -d luwag_staging_test -c '\d analytics_events'
```
Expected: 10 个新列出现；索引 5 个出现。

- [ ] **Step 4: 生成 Prisma client 并确认类型**

Run:
```bash
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend exec tsc --noEmit
```
Expected: 0 error。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/prisma
git commit -m "feat(analytics): attribution columns and indexes for CL/AID/AdID"
```

---

### Task 2: 共享 AdId provenance 类型与 claims 字段

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-attribution.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/dto/marketing-touch.dto.ts:1-55`
- Test: `small-house-commerce/backend/src/modules/marketing/marketing-touch.service.spec.ts`

**Interfaces:**
- Produces:
  - `type AdidSource = 'LINK' | 'META_DYNAMIC' | 'META_DYNAMIC_FALLBACK' | 'LEGACY' | 'NONE'`（唯一来源；claims/订单/analytics 共用，不引入 `LINK_STATIC` 等新值）
  - `type AdIdMissingReason = 'MISSING_META_AD_ID' | 'INVALID_META_AD_ID' | 'ORGANIC_TOUCH'`
  - `type LinkResolution = 'CL' | 'AID' | 'AID_FALLBACK' | 'PAGE'`
  - `adIdProvenance(rawAdId: string | null | undefined, staticAdId: string | null, paid: boolean): { adId: string | null; adIdSource: AdidSource; adIdMissingReason: AdIdMissingReason | null }`
  - claims v2 新增可选字段 `adIdSource`、`adIdMissingReason`、`linkResolution`。

- [ ] **Step 1: 写失败测试**

在 `marketing-touch.service.spec.ts` 的 `describe('server-signed marketing touch')` 内加：

```ts
it('records the dynamic Meta ad ID provenance', async () => {
  const { service, link } = setup();
  Object.assign(link, { adId: '120200000000001' });
  const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '120200000000002' });
  expect(await service.resolve(result.credential)).toMatchObject({
    adId: '120200000000002', adIdSource: 'META_DYNAMIC', adIdMissingReason: null,
  });
});

it('falls back to the link ad ID and marks it static', async () => {
  const { service, link } = setup();
  Object.assign(link, { adId: '120200000000001' });
  const result = await service.touch({ code: link.code, visitKey: 'tab-1' });
  expect(await service.resolve(result.credential)).toMatchObject({
    adId: '120200000000001', adIdSource: 'LINK', adIdMissingReason: null,
  });
});

it('records an invalid Meta template instead of treating it as an ad ID', async () => {
  const { service, link } = setup();
  Object.assign(link, { adId: null });
  const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '{{ad.id}}' });
  expect(await service.resolve(result.credential)).toMatchObject({
    adId: null, adIdSource: 'NONE', adIdMissingReason: 'INVALID_META_AD_ID',
  });
});

it('keeps the legacy AID-only link compatible with a dynamic ad ID', async () => {
  const { service } = setup();
  const result = await service.touch({ aid: 'OP-1', adId: '120200000000002', path: '/products/chair', visitKey: 'tab-1' });
  expect(await service.resolve(result.credential)).toMatchObject({
    linkId: null, ownerUserId: USER, aid: 'OP-1',
    adId: '120200000000002', adIdSource: 'META_DYNAMIC', linkResolution: 'AID',
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-touch.service.spec.ts
```
Expected: FAIL，claims 没有 `adIdSource`。

- [ ] **Step 3: 在 marketing-attribution.ts 加类型与函数**

```ts
// 唯一来源：订单 adid_source、claims.adIdSource、analytics.ad_id_source 共用。
// META_DYNAMIC_FALLBACK / LEGACY 已在生产 schema 与订单逻辑中存在，本次纳入类型。
export type AdidSource = 'LINK' | 'META_DYNAMIC' | 'META_DYNAMIC_FALLBACK' | 'LEGACY' | 'NONE';
export type AdIdMissingReason = 'MISSING_META_AD_ID' | 'INVALID_META_AD_ID' | 'ORGANIC_TOUCH';
export type LinkResolution = 'CL' | 'AID' | 'AID_FALLBACK' | 'PAGE';

const META_AD_ID = /^\d{6,20}$/;

export function adIdProvenance(
  rawAdId: string | null | undefined,
  staticAdId: string | null,
  paid: boolean,
): { adId: string | null; adIdSource: AdidSource; adIdMissingReason: AdIdMissingReason | null } {
  const raw = typeof rawAdId === 'string' ? rawAdId.trim() : null;
  if (raw && META_AD_ID.test(raw)) {
    return { adId: raw, adIdSource: 'META_DYNAMIC', adIdMissingReason: null };
  }
  const fallback = typeof staticAdId === 'string' ? staticAdId.trim() : '';
  if (fallback) return { adId: fallback, adIdSource: 'LINK', adIdMissingReason: null };
  return {
    adId: null,
    adIdSource: 'NONE',
    adIdMissingReason: raw ? 'INVALID_META_AD_ID' : paid ? 'MISSING_META_AD_ID' : 'ORGANIC_TOUCH',
  };
}
```

- [ ] **Step 4: DTO 加可选字段**

`marketing-touch.dto.ts` 的 `marketingTouchClaimsSchema` 内加：

```ts
  adIdSource: z.enum(['LINK', 'META_DYNAMIC', 'META_DYNAMIC_FALLBACK', 'LEGACY', 'NONE']).optional(),
  adIdMissingReason: z.enum(['MISSING_META_AD_ID', 'INVALID_META_AD_ID', 'ORGANIC_TOUCH']).nullable().optional(),
  linkResolution: z.enum(['CL', 'AID', 'AID_FALLBACK', 'PAGE']).optional(),
```

- [ ] **Step 5: touch service 计算并签字**

在 `touchLink` / `touchAid` 里：

```ts
// META_AD links get explicit provenance; other source types keep the
// existing behaviour (a URL ad ID wins, then the link's saved ad ID).
const provenance = link.sourceType === 'META_AD'
  ? adIdProvenance(input.adId, link.adId, paid)
  : {
      adId: metaAdId(input.adId) ?? metaAdId(link.adId),
      adIdSource: null,
      adIdMissingReason: null,
    };
```

`sign()` 的 payload 带上：

```ts
adId: provenance.adId,
adIdSource: provenance.adIdSource ?? undefined,
adIdMissingReason: provenance.adIdMissingReason,
linkResolution: 'CL', // touchAid 用 'AID' 或 'AID_FALLBACK'，touchPage 用 'PAGE'
```

（`sign` 参数类型同步加这三个可选字段。）

`touchAid` 与 Task 3 的 AID 冲突分支也必须走同一套 provenance：
`adIdProvenance(input.adId, link?.adId ?? null, paid)`，不能只更新正常链接分支
（仅当有效 `sourceType === 'META_AD'` 时计算；FB_POST/自然来源保持 null）。
`signAid()` 里原来的 `adId: metaAdId(input.input.adId)` 改为 `adId: provenance.adId`。

- [ ] **Step 6: 跑测试确认通过**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-touch.service.spec.ts
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/backend/src/modules/marketing
git commit -m "feat(marketing): record AdID provenance on signed touches"
```

---

### Task 3: 触达：CL 失败回退 AID、冲突保留链接身份

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-touch.service.ts:53-206`
- Test: `small-house-commerce/backend/src/modules/marketing/marketing-touch.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `AdIdSource`/`LinkResolution`/`adIdProvenance`。
- Produces: `touch()` 在 `code` 无效且 `aid` 有效时返回 AID 凭据（`linkId=null`，`linkResolution='AID_FALLBACK'`）；AID 冲突时 claims 保留 `linkId`。

- [ ] **Step 1: 写失败测试**

```ts
it('falls back to AID when the CL code is unknown', async () => {
  const { service } = setup();
  const result = await service.touch({ code: 'missing-code', aid: 'OP-1', visitKey: 'tab-1', path: '/products/chair' });
  expect(await service.resolve(result.credential)).toMatchObject({
    linkId: null, ownerUserId: USER, aid: 'OP-1', linkResolution: 'AID_FALLBACK',
    attributionConflict: true,
  });
});

it('keeps the link identity when a different valid AID wins the owner', async () => {
  const { service, link } = setup();
  const result = await service.touch({ code: link.code, aid: 'OP-2', visitKey: 'tab-1' });
  expect(await service.resolve(result.credential)).toMatchObject({
    linkId: LINK, ownerUserId: USER_TWO, aid: 'OP-2', attributionConflict: true,
  });
});

it('records a conflict when the supplied AID is not an active optimizer', async () => {
  const { service, link } = setup();
  const result = await service.touch({ code: link.code, aid: 'NOPE', visitKey: 'tab-1' });
  expect(await service.resolve(result.credential)).toMatchObject({
    linkId: LINK, ownerUserId: USER, aid: 'OP-1', attributionConflict: true,
  });
});
```

（`setup()` 需要能返回第二个优化师 `USER_TWO`/`OP-2`；在 `optimizerProfile.findUnique` 的 mock 里按 aid 返回。）

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-touch.service.spec.ts
```
Expected: 3 个新用例 FAIL。

- [ ] **Step 3: 修改 touch() 调度**

```ts
async touch(input: MarketingTouchInput): Promise<TouchResult> {
  const now = new Date();
  if (input.code !== undefined) {
    const result = await this.touchLink(input, now);
    if (result.credential || !input.aid) return result;
    return this.touchAid(
      input, now, 'AID_FALLBACK',
      `CL ${input.code} did not resolve; used AID ${input.aid}`,
    );
  }
  if (input.aid !== undefined) return this.touchAid(input, now, 'AID');
  return this.touchPage(input, now);
}
```

- [ ] **Step 4: touchAid 接收 resolution/conflict 并签字**

`touchAid(input, now, resolution: 'AID' | 'AID_FALLBACK' = 'AID', conflict?: string)`，
`signAid` 的 payload 加 `linkResolution: resolution`，并在 `conflict` 存在时加
`attributionConflict: true, conflictDetail: conflict`。

- [ ] **Step 5: touchLink 冲突分支保留链接身份**

在 `signAid` 的入参加：

```ts
link?: {
  id: string;
  product: ProductForTouch | null;
  landingPageId: string | null;
  publishedRevision: number | null;
  sourceType: SourceType;
  adId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}
```

签字时：

```ts
campaignId: input.input.campaignId ?? input.link?.campaignId ?? null,
adsetId: input.input.adsetId ?? input.link?.adsetId ?? null,
utmSource: input.input.utmSource ?? input.link?.utmSource ?? null,
utmMedium: input.input.utmMedium ?? input.link?.utmMedium ?? null,
utmCampaign: input.input.utmCampaign ?? input.link?.utmCampaign ?? null,
utmContent: input.input.utmContent ?? input.link?.utmContent ?? null,
utmTerm: input.input.utmTerm ?? input.link?.utmTerm ?? null,
linkId: input.link?.id ?? null,
productId: input.link?.product?.id ?? null,
productName: input.link?.product?.name ?? null,
productCode: input.link?.product?.productCode ?? null,
landingPageId: input.link?.landingPageId ?? null,
publishedRevision: input.link?.publishedRevision ?? null,
sourceType: input.link?.sourceType ?? (input.paid ? input.sourceType : 'ORGANIC'),
```

冲突调用把 `link` 传进去（包含链接的 campaign/adset/utm 作为回退）；AID-only / fallback 不传。

- [ ] **Step 6: 无效 AID 也记录冲突**

在 `touchLink` 的正常签字路径：

```ts
const rawAid = input.aid ? normaliseAid(input.aid) : null;
let conflict: string | undefined;
if (rawAid && rawAid !== link.aidSnapshot) {
  const profile = await this.optimizers.resolveByAid(rawAid);
  if (profile && profile.status === 'ACTIVE') { /* 现有覆盖分支 */ }
  else conflict = `AID ${rawAid} is not an active optimizer; kept link AID ${link.aidSnapshot}`;
}
return this.sign({
  ...,
  ...(conflict ? { attributionConflict: true, conflictDetail: conflict } : {}),
  linkResolution: 'CL',
}, now);
```

- [ ] **Step 7: 跑全部触达测试**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-touch.service.spec.ts src/modules/orders/orders.service.attribution.spec.ts
```
Expected: PASS；旧用例不回归。

- [ ] **Step 8: Commit**

```bash
git add small-house-commerce/backend/src/modules/marketing
git commit -m "fix(marketing): keep link identity on AID conflict and fall back to AID"
```

---

### Task 4: analytics ingest 只写验签 claims

**Files:**
- Modify: `small-house-commerce/backend/src/modules/analytics/analytics.service.ts:44-205`
- Test: `small-house-commerce/backend/src/modules/analytics/analytics.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 新列；Task 2 claims 字段。
- Produces: 事件行的 `campaignLinkId/optimizerId/aidSnapshot/adId/adIdSource/adIdMissingReason/adsetId/attributionPaid/linkResolution/campaignId` 全部来自 claims；body 的 `campaignId` 被忽略。

- [ ] **Step 1: 写失败测试**

在 `analytics.service.spec.ts` 的 `describe('campaign link attribution from the touch credential')` 加：

```ts
it('copies verified attribution and ignores a forged campaign id', async () => {
  const touch = { resolve: vi.fn(async () => ({
    linkId: LINK, ownerUserId: USER, aid: 'OP-1', adId: '120200000000002',
    adIdSource: 'META_DYNAMIC', adIdMissingReason: null, campaignId: 'campaign-A',
    adsetId: 'set-A', paid: true, linkResolution: 'CL',
    attributionConflict: true, conflictDetail: 'AID OP-2 != link AID OP-1',
  })) };
  const { prisma, service } = makeService(touch);
  await service.ingest([event({ campaignId: 'forged', marketingCredential: 'cred' })], 'client');
  const row = prisma.analyticsEvent.createMany.mock.calls[0][0].data[0];
  expect(row).toMatchObject({
    campaignLinkId: LINK, optimizerId: USER, aidSnapshot: 'OP-1',
    adId: '120200000000002', adIdSource: 'META_DYNAMIC', adIdMissingReason: null,
    campaignId: 'campaign-A', adsetId: 'set-A', attributionPaid: true, linkResolution: 'CL',
    attributionConflict: true, conflictDetail: 'AID OP-2 != link AID OP-1',
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/analytics/analytics.service.spec.ts
```
Expected: FAIL（新字段 undefined，campaignId 为 'forged'）。

- [ ] **Step 3: 把 resolveLinkId 改成 resolveClaims**

```ts
type ResolvedClaims = {
  linkId: string | null; ownerUserId: string; aid: string; adId: string | null;
  adIdSource?: AdidSource; adIdMissingReason?: string | null;
  campaignId: string | null; adsetId: string | null;
  paid?: boolean; linkResolution?: string;
  attributionConflict?: boolean; conflictDetail?: string | null;
} | null;
const claimsByCredential = new Map<string, ResolvedClaims>();
const resolveClaims = async (credential: string | undefined): Promise<ResolvedClaims> => {
  if (!credential) return null;
  if (claimsByCredential.has(credential)) return claimsByCredential.get(credential)!;
  let claims: ResolvedClaims = null;
  try { claims = (await this.marketingTouch.resolve(credential)) as ResolvedClaims; } catch { claims = null; }
  claimsByCredential.set(credential, claims);
  return claims;
};
```

在 `ingest` 循环里：

```ts
const claims = await resolveClaims(batchEvent.marketingCredential);
const row = this.toRow(batchEvent);
row.campaignLinkId = claims?.linkId ?? null;
row.optimizerId = claims?.ownerUserId ?? null;
row.aidSnapshot = claims?.aid ?? null;
row.adId = claims?.adId ?? null;
row.adIdSource = claims?.adIdSource ?? null;
row.adIdMissingReason = claims?.adIdMissingReason ?? null;
row.campaignId = claims?.campaignId ?? null;
row.adsetId = claims?.adsetId ?? null;
row.attributionPaid = claims?.paid ?? null;
row.linkResolution = claims?.linkResolution ?? null;
row.attributionConflict = claims?.attributionConflict ?? null;
row.conflictDetail = claims?.conflictDetail ?? null;
```

`toRow` 删除 `campaignId: event.campaignId ?? null`（避免 body 直写）。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/analytics/analytics.service.spec.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/analytics
git commit -m "feat(analytics): store verified touch attribution on events"
```

---

### Task 5: 订单 AdID 优先级与 provenance

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:574-640`
- Test: `small-house-commerce/backend/src/modules/orders/orders.service.attribution.spec.ts`

**Interfaces:**
- Consumes: Task 2 claims 字段。
- Produces: 订单 `attribution.adid` 在动态 AdID 与链接编号不一致时取动态值（`adid_source='META_DYNAMIC'`）；一致时 `LINK`；动态缺失时 `LINK`。

- [ ] **Step 1: 写失败测试**

```ts
it('uses the dynamic Meta ad ID as the order advertising number when it differs from the link number', async () => {
  const h = setup();
  Object.assign(h.link, { adid: 'AD-OP-1-261111-01', adId: null });
  const result = await h.touch.touch({ code: h.link.code, visitKey: 'tab-1', adId: '120200000000002' });
  await h.service.checkout(h.input(result.credential!));
  expect(h.writes[0]).toMatchObject({
    attribution: { create: {
      adid: '120200000000002', adidSource: 'META_DYNAMIC', adId: '120200000000002', linkId: LINK,
    } },
  });
});

it('keeps the link number when the dynamic ad ID is missing', async () => {
  const h = setup();
  Object.assign(h.link, { adid: 'AD-OP-1-261111-01', adId: null });
  await h.service.checkout(h.input(await h.credential()));
  expect(h.writes[0]).toMatchObject({
    attribution: { create: { adid: 'AD-OP-1-261111-01', adidSource: 'LINK' } },
  });
});

it('does not treat the link static ad ID as a dynamic Meta ID', async () => {
  const h = setup();
  Object.assign(h.link, { adid: 'AD-OP-1-261111-01', adId: '120200000000001' });
  await h.service.checkout(h.input(await h.credential()));
  expect(h.writes[0]).toMatchObject({
    attribution: { create: {
      adid: 'AD-OP-1-261111-01', adidSource: 'LINK', adId: '120200000000001',
    } },
  });
});

it('keeps legacy AID-only dynamic ad IDs attributable on orders', async () => {
  const h = setup();
  const result = await h.touch.touch({ aid: 'OP-1', adId: '120200000000002', path: '/products/chair', visitKey: 'tab-1' });
  await h.service.checkout(h.input(result.credential!));
  expect(h.writes[0]).toMatchObject({
    attribution: { create: {
      adId: '120200000000002', adid: '120200000000002', adidSource: 'META_DYNAMIC',
      linkId: null, optimizerId: USER, aidSnapshot: 'OP-1',
    } },
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/orders/orders.service.attribution.spec.ts
```
Expected: 第 1 个 FAIL（adid 仍是 `AD-...`）。

- [ ] **Step 3: 修改订单分支**

先把 `adidSource` 的联合类型替换为 Task 2 的共享类型：

```ts
let adidSource: AdidSource = 'NONE';
let adidMissingReason: AdIdMissingReason | 'LINK_MISMATCH' | 'MISSING_LINK' | 'NO_TOUCH' | 'TOKEN_INVALID' | null = null;
```

（`LINK_MISMATCH`/`MISSING_LINK`/`NO_TOUCH`/`TOKEN_INVALID` 是订单侧既有原因，保留；
`AdidSource`/`AdIdMissingReason` 从 `marketing-attribution.ts` 导入。）

再把 `dynamicAdId` 的定义改成只认真实动态值（旧凭据没有 `adIdSource`，沿用旧行为）：

```ts
const touchAdId = touch?.adId?.trim() || null;
const dynamicAdId = touchAdId && touch.adIdSource !== 'LINK' ? touchAdId : null;
```

再把原 `if (link.adid) { adid = link.adid; adidSource = 'LINK'; }` 处改为：

```ts
if (link.adid && (!dynamicAdId || link.adid === dynamicAdId)) {
  adid = link.adid; adidSource = 'LINK';
} else if (dynamicAdId) {
  adid = dynamicAdId; adidSource = link.adid ? 'META_DYNAMIC' : 'META_DYNAMIC_FALLBACK';
} else if (link.adid) {
  adid = link.adid; adidSource = 'LINK';
} else {
  adidMissingReason = 'MISSING_META_AD_ID';
}
```

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/orders/orders.service.attribution.spec.ts
```
Expected: PASS；旧 `adid: 'ad-A'` 用例仍通过（link.adid 与 dynamic 相同）。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/orders
git commit -m "feat(orders): prefer the dynamic Meta ad ID for the advertising number"
```

---

### Task 6: 链接 serializer 增加 cleanPath / cl / 按链接 Meta 参数

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/campaign-links.service.ts:29-46,338-356`
- Test: `small-house-commerce/backend/src/modules/marketing/campaign-links.service.spec.ts`

**Interfaces:**
- Produces:
  - `CampaignLinkRow.cleanPath: string | null`：**仅 `META_AD` 有值**；`FB_POST` 为 `null`，继续用 `path`。
  - `CampaignLinkRow.cl: string`（等于 `code`）。
  - `CampaignLinkRow.metaUrlParameters: string | null`：**仅 `META_AD` 按链接生成** `cl=<code>&aid=<aidSnapshot>&adid={{ad.id}}`；`FB_POST` 为 `null`。
  - `path` 保持旧语义（FB_POST 短链/追踪 URL 不变）。

- [ ] **Step 1: 写失败测试**

```ts
it('exposes a clean landing URL and per-link Meta parameters for META_AD', async () => {
  const link = await service.createLink({ ...base, sourceType: 'META_AD', attributionMode: 'CL' }, owner);
  expect(link.cleanPath).toBe('/products/chair');
  expect(link.cl).toBe(link.code);
  expect(link.metaUrlParameters).toBe(`cl=${link.code}&aid=OP-1&adid={{ad.id}}`);
  expect(link.path).toContain(`cl=${link.code}`);
});

it('keeps the variant on the clean URL but drops tracking parameters', async () => {
  const link = await service.createLink({ ...base, sourceType: 'META_AD', variantId: V1, attributionMode: 'CL' }, owner);
  expect(link.cleanPath).toBe(`/products/chair?variant=${V1}`);
});

it('keeps FB_POST on the legacy tracking path with no clean URL or Meta parameters', async () => {
  const link = await service.createLink({ ...base, sourceType: 'FB_POST', postDate: '2026-11-11', attributionMode: 'CL' }, owner);
  expect(link.cleanPath).toBeNull();
  expect(link.metaUrlParameters).toBeNull();
  expect(link.path).toContain(`cl=${link.code}`);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/campaign-links.service.spec.ts
```
Expected: FAIL（cleanPath/cl 不存在）。

- [ ] **Step 3: 实现**

在 `linkPath` 旁：

```ts
// META_AD only; FB_POST keeps the legacy tracking path and short link.
function cleanPath(row: LinkWithDetails): string | null {
  if (row.sourceType !== 'META_AD') return null;
  const path = row.landingPage
    ? `/lp/${encodeURIComponent(row.landingPage.slug)}`
    : `/products/${encodeURIComponent(row.product.slug)}`;
  return row.variantId ? `${path}?variant=${row.variantId}` : path;
}

function metaUrlParameters(row: LinkWithDetails): string | null {
  if (row.sourceType !== 'META_AD') return null;
  // AID is the snapshot taken when the link was created, never the caller's AID.
  return `cl=${row.code}&aid=${row.aidSnapshot}&adid={{ad.id}}`;
}
```

`serialize()` 返回：

```ts
cleanPath: cleanPath(row),
cl: row.code,
metaUrlParameters: metaUrlParameters(row),
```

保留 `path: linkPath(row)`。`META_URL_PARAMETERS` 常量删除；同步把
`campaign-links.service.spec.ts` 里旧的常量断言
（`adid={{ad.id}}&campaign_id=...`）替换为按链接断言
`cl=<code>&aid=OP-1&adid={{ad.id}}`，并检查 `campaign-links.controller.spec.ts`
是否有同一断言。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/campaign-links.service.spec.ts src/modules/marketing/admin/campaign-links.controller.spec.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/marketing
git commit -m "feat(marketing): expose clean URL, CL and per-link Meta parameters"
```

---

### Task 7: META_AD 创建表单去掉手工 AdID / Meta 字段，固定 CL；FB_POST 原样

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.tsx:15-110`
- Test: `small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx`

**Interfaces:**
- Produces: META_AD 创建请求固定 `attributionMode: 'CL'`；不再提交 `adId/campaignId/adsetId/utm*`；**FB_POST 保留原有全部 metadata 字段与提交行为**。

- [ ] **Step 1: 写失败测试**

```tsx
it('creates a Meta ad link with CL mode and no manual ad id', async () => {
  const createLink = vi.fn(async () => row);
  vi.mocked(marketingApi.createLink).mockImplementation(createLink);
  render(<CreateCampaignLinkDialog defaultSourceType="META_AD" lockProduct onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("投放目标")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "TB004" } });
  fireEvent.click(screen.getByRole("button", { name: "保存链接" }));
  await waitFor(() => expect(createLink).toHaveBeenCalled());
  const input = createLink.mock.calls[0][0];
  expect(input).toMatchObject({ attributionMode: "CL", sourceType: "META_AD" });
  expect(input.adId).toBeUndefined();
  expect(input.campaignId).toBeUndefined();
});

it('keeps the FB_POST create payload and metadata unchanged', async () => {
  // 以 FB_POST 默认来源打开，填写原有字段后保存
  const input = createLink.mock.calls[0][0];
  expect(input).toMatchObject({
    sourceType: "FB_POST", attributionMode: "CL",
    campaignId: "campaign-A", adsetId: "set-A", adId: "120200000000001",
    utmSource: "facebook",
  });
});
```

（按现有 spec 的 mock/render helper 调整；断言 payload 是核心。）

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx
```
Expected: FAIL（仍提交 AID 与 adId）。

- [ ] **Step 3: 改表单**

- 删除 `attributionMode` state 与选择器；`save()` 里：
  ```ts
  attributionMode: "CL",
  ```
- 对 META_AD 隐藏全部 `metadata` 输入；**FB_POST 保持原有输入**（campaignId/adsetId/adId/utm 全部照旧），不做简化。
- `save()` 里按来源过滤 payload，确保 META_AD 不会带上复制来的旧字段；FB_POST 仍提交原有 metadata：

```ts
const manualMetadata = sourceType === 'FB_POST'
  ? Object.fromEntries(metadata.map(([key]) => [key, fields[key]?.trim() || null]))
  : {};
const input = {
  productId, landingPageId: landingPageId || null, variantId: variantId || null,
  ...(name.trim() ? { name: name.trim() } : {}),
  sourceType,
  attributionMode: "CL" as const,
  ...(sourceType === 'FB_POST' ? { postDate, postUrl: postUrl.trim() || null } : {}),
  ...manualMetadata,
};
```

- META_AD 移除 `adId` 相关字段与提示文案；FB_POST 保持原样；保留 `link_builder_aid` 展示。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.tsx \
        small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx
git commit -m "feat(marketing): create Meta links as CL with no manual ad id"
```

---

### Task 8: META_AD 创建结果弹窗只显示干净 URL / CL / AID + 后端 Meta 参数；FB_POST 原样

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/PostLinkResultDialog.tsx`
- Modify: `small-house-commerce/frontend/src/lib/marketing-api.ts`（`CampaignLinkRow` 加 `cleanPath: string | null`、`cl: string`，`metaUrlParameters` 允许 `null`）
- Test: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx`

**Interfaces:**
- Consumes: Task 6 的 `cleanPath`、`cl`、`metaUrlParameters`（AID 为链接创建时的快照）。
- Produces: **META_AD** 结果弹窗三个独立字段 + 后端生成的 Meta 参数复制；**FB_POST 结果弹窗保持现状**（完整追踪 URL、短链、广告编号）。

- [ ] **Step 1: 写失败测试**

在 `CampaignLinksList.spec.tsx` 的结果弹窗用例中加：

```tsx
it('shows clean URL, CL and AID separately with the backend Meta template', async () => {
  // META_AD row with backend-provided fields
  expect(screen.getByLabelText("Landing Page URL")).toHaveValue("https://luwag.shop/products/chair");
  expect(screen.getByLabelText("CL")).toHaveValue("code1");
  expect(screen.getByLabelText("AID")).toHaveValue("OP-1");
  const params = screen.getByLabelText("Meta 网址参数") as HTMLTextAreaElement;
  expect(params.value).toBe("cl=code1&aid=OP-1&adid={{ad.id}}");
  expect(params.value).not.toContain("%7B");
});

it('keeps the FB_POST result dialog on its legacy tracking link and short link', async () => {
  // FB_POST row: no clean URL, no Meta parameters, short link still requested
  expect(screen.queryByLabelText("Landing Page URL")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Meta 网址参数")).not.toBeInTheDocument();
  expect(screen.getByLabelText("该帖专属短链")).toBeInTheDocument();
  expect(screen.getByLabelText("完整投放链接")).toHaveValue("https://luwag.shop/products/chair?cl=code1");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```
Expected: FAIL。

- [ ] **Step 3: 实现弹窗**

```tsx
const isMetaAd = link.sourceType === 'META_AD';
const cl = link.cl ?? link.code;
const cleanUrl = isMetaAd && link.cleanPath
  ? (origin ? new URL(link.cleanPath, origin).href : link.cleanPath)
  : null;
// Backend-generated; never re-assemble from CL/AID in the browser.
const metaParameters = isMetaAd ? link.metaUrlParameters : null;
```

短链生成副作用只对 `FB_POST` 执行：

```tsx
useEffect(() => {
  if (link.sourceType !== 'FB_POST' || link.attributionMode !== 'CL') { setBusy(false); return; }
  // ...原有 createShortLink 逻辑
}, [link.sourceType, link.attributionMode, link.path, attempt]);
```

i18n 新增（zh/en 同步）：

```ts
link_result_landing_url: "Landing Page URL",
link_result_cl: "CL",
link_result_aid: "AID",
link_result_meta_params: "Meta 网址参数",
link_result_meta_params_hint: "粘贴到 Meta 的 Tracking → URL Parameters，不要加问号；{{ad.id}} 必须原样保留。",
```

渲染顺序：

- **META_AD**：
  1. `Landing Page URL`（readOnly input + 复制；`cleanUrl`）
  2. `CL`（readOnly input + 复制；`cl`）
  3. `AID`（readOnly input + 复制；`link.aid`，即链接创建时的 `aidSnapshot`）
  4. `Meta 网址参数`（readOnly textarea + 复制；`metaParameters` 原样来自后端）
- **FB_POST**：保持现有渲染（`完整投放链接` = `link.path`、`该帖专属短链`、广告编号），不显示干净 URL / CL / AID / Meta 参数。

删除 META_AD 的 `adid` 字段展示（业务编号仍在列表里）。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/marketing/PostLinkResultDialog.tsx \
        small-house-commerce/frontend/src/lib/marketing-api.ts \
        small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx
git commit -m "feat(marketing): show clean URL, CL and AID in the link result"
```

---

### Task 9: META_AD 链接列表显示干净 URL 与独立复制；FB_POST 保持旧 path

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx:118-166`
- Test: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx`

**Interfaces:**
- Produces:
  - **META_AD**：列表显示 `cleanPath`，复制干净 URL；新增「复制 CL」「复制 AID」「复制 Meta 参数」；显示核算入口（含原 AID 模式）。
  - **FB_POST**：保持现状——显示并复制旧 `path`（短链目标），保留广告编号复制；不显示干净 URL / CL / AID 复制 / Meta 参数。

- [ ] **Step 1: 写失败测试**

```tsx
it('uses the clean URL and exposes CL/AID copy buttons for META_AD', async () => {
  renderListWithRow({ ...row, sourceType: "META_AD", cleanPath: "/products/chair", cl: "code1" });
  await user.click(screen.getByRole("button", { name: "复制网址" }));
  expect(copyText).toHaveBeenCalledWith(new URL("/products/chair", window.location.origin).href);
  expect(screen.getByRole("button", { name: "复制 CL" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制 AID" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制 Meta 参数" })).toBeInTheDocument();
  expect(screen.queryByText("AID 链接按订单归因；链接报表随归因报表升级一起上线。")).not.toBeInTheDocument();
});

it('keeps the FB_POST row on the legacy tracking path', async () => {
  renderListWithRow({ ...row, sourceType: "FB_POST", cleanPath: null, metaUrlParameters: null });
  await user.click(screen.getByRole("button", { name: "复制网址" }));
  expect(copyText).toHaveBeenCalledWith(new URL(row.path, window.location.origin).href);
  expect(screen.queryByRole("button", { name: "复制 CL" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "复制 Meta 参数" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```
Expected: FAIL。

- [ ] **Step 3: 实现**

- `copy(row)` 分流：
  ```tsx
  const url = row.sourceType === "META_AD" && row.cleanPath ? row.cleanPath : row.path;
  ```
- 行内 URL 展示同样分流（META_AD 用 `cleanPath`；FB_POST 用 `path`）。
- 仅 `row.sourceType === "META_AD"` 时显示：
  ```tsx
  <button ... onClick={() => void copyValue(row.cl ?? row.code)}>复制 CL</button>
  <button ... onClick={() => void copyValue(row.aid)}>复制 AID</button>
  <button ... onClick={() => void copyValue(row.metaUrlParameters!)}>复制 Meta 参数</button>
  ```
- 删除 `row.attributionMode === "AID" ? 报表待上线 : ...` 分支，META_AD 统一显示核算/费用链接；FB_POST 维持现有按钮集。
- `metaUrlParameters` 直接复制后端值，不前端拼接。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx \
        small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx
git commit -m "feat(marketing): show clean link URLs and CL/AID copy actions"
```

---

### Task 10: 短链转发 cl（保留 aid/adid/fbclid）

**Files:**
- Modify: `small-house-commerce/frontend/src/app/s/[code]/route.ts:21-34`
- Test: `small-house-commerce/frontend/src/app/s/[code]/route.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `/s/<code>?cl=...&aid=...&adid=...&fbclid=...` 302 后目标带全部参数；目标已有的参数优先。

- [ ] **Step 1: 写失败测试**

```ts
it('forwards cl and the Meta click parameters without overriding the saved target', async () => {
  const request = new NextRequest('https://luwag.shop/s/abc?cl=code1&aid=OP-1&adid=120200000000002&fbclid=abcdefgh');
  const response = await GET(request, { params: Promise.resolve({ code: 'abc' }) });
  const location = new URL(response.headers.get('location')!);
  expect(location.searchParams.get('cl')).toBe('code1');
  expect(location.searchParams.get('aid')).toBe('OP-1');
  expect(location.searchParams.get('adid')).toBe('120200000000002');
  expect(location.searchParams.get('fbclid')).toBe('abcdefgh');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/s/[code]/route.spec.ts'
```
Expected: FAIL（cl 为 null）。

- [ ] **Step 3: 加转发规则**

```ts
const FORWARDED_PARAMS: ReadonlyArray<[key: string, pattern: RegExp]> = [
  ["cl", /^[A-Za-z0-9_-]{1,64}$/],
  ["aid", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/],
  // ...其余保持不变
];
```

并把注释改为：目标已有 `cl` 时仍以目标为准；外部只能补空位，不能替换。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/s/[code]/route.spec.ts'
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add 'small-house-commerce/frontend/src/app/s/[code]/route.ts' 'small-house-commerce/frontend/src/app/s/[code]/route.spec.ts'
git commit -m "feat(short-link): forward the CL code through the redirect"
```

---

### Task 11: 报表后端新增 ADID / AID 维度

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/dto/marketing-report.dto.ts:10-20`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report-facts.ts:17-45`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report-metrics.ts:8-30`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report-sort.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report.service.ts`（委托 ADID/AID）
- Create: `small-house-commerce/backend/src/modules/marketing/marketing-attribution-report.service.ts`
- Test: `small-house-commerce/backend/src/modules/marketing/marketing-report.integration.spec.ts`

**Interfaces:**
- Produces:
  - `groupBy` 新增 `'ADID' | 'AID'`。
  - 新报表行字段：`adId`、`adVisits`、`productViews`、`linkCount`、`adCount`、`adIdSource`、`adIdMissingReason`。
  - `marketingOrderFactsSql()` 选择 `a.ad_id`、`a.adid`、`a.adid_source`、`a.adid_missing_reason`。
  - **ADID** 行按 `(link_id, ad_id, optimizer_id, aid_snapshot)` 分组，优化师取验签 claims；缺失时才回退链接 owner。
  - **AID** 行按 `(optimizer_id, aid_snapshot)` 分组（含无 link 的验签流量）；`linkCount`/`adCount` 由 `aid_events` 同口径的 `aid_link_keys`/`aid_ad_keys`（去重事件 + 订单）计算，不在聚合后重复 join 原始事件。

- [ ] **Step 1: 写失败测试（DTO）**

`marketing-report.dto.spec.ts`：

```ts
it('accepts the AdID and AID grouping levels', () => {
  expect(marketingReportQuerySchema.safeParse({ groupBy: 'ADID' }).success).toBe(true);
  expect(marketingReportQuerySchema.safeParse({ groupBy: 'AID' }).success).toBe(true);
});
```

- [ ] **Step 2: 写失败集成测试**

`marketing-report.integration.spec.ts`（沿用现有测试库 helper）：

```ts
it('splits two ad IDs on one CL into two rows and keeps CL visits unsplit', async () => {
  // 用一个 link + 两个 ad_id 各写 PAGE_VIEW/ADD_TO_CART 事件
  const result = await service.report({ ...base, groupBy: 'ADID' }, admin);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.map(r => r.adId).sort()).toEqual(['120200000000001', '120200000000002']);
  expect(result.rows.every(r => r.visits === null)).toBe(true);
  expect(result.rows.map(r => r.adVisits)).toEqual([1, 1]);
});

it('takes the ADID row owner from verified claims, not the link owner', async () => {
  // link.ownerUserId = OP-1，但事件/订单 claims 的 optimizer_id/aid = OP-2
  const result = await service.report({ ...base, groupBy: 'ADID' }, admin);
  expect(result.rows[0]).toMatchObject({ ownerName: 'Optimizer Two', aid: 'OP-2' });
});

it('counts distinct links and ad IDs for the AID view without double counting', async () => {
  // 同一 AID：2 条链接、3 个 AdID；事件与订单有重叠
  const result = await service.report({ ...base, groupBy: 'AID' }, admin);
  expect(result.rows[0]).toMatchObject({ aid: 'OP-1', linkCount: 2, adCount: 3 });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run:
```bash
MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-report.dto.spec.ts src/modules/marketing/marketing-report.integration.spec.ts
```
Expected: FAIL（DTO 拒绝 ADID）。

- [ ] **Step 4: 扩展 DTO 与 order facts**

- DTO `groupBy` 改为 `z.enum(['LINK','PAGE','PRODUCT','OWNER','ADID','AID'])`。
- `marketingOrderFactsSql` SELECT 加：
  ```sql
  a.ad_id, a.adid, a.adid_source, a.adid_missing_reason, a.optimizer_id
  ```
  （`optimizer_id` 已选；补其余 4 个。）
- `MarketingReportRawRow`、`MarketingReportSerializedRow` 与
  `serializeMarketingReportRow` 增加可选字段 `adId`、`adVisits`、
  `productViews`、`linkCount`、`adCount`，默认 `null`/`0`；既有
  `LINK/PAGE/PRODUCT/OWNER` 行的序列化结果不变。

- [ ] **Step 5: 新建 attribution report service**

`marketing-attribution-report.service.ts` 提供：

```ts
export interface AttributionReportRow {
  kind: 'REGISTERED';
  id: string;
  label: string;
  adId: string | null;
  adIdMissingReason: string | null;
  linkId: string | null;
  linkName: string | null;
  productId: string | null;
  productName: string | null;
  productCode: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  aid: string | null;
  adid: string | null;
  adIdSource: AdidSource | null;
  linkCount: number | null;
  adCount: number | null;
  visits: null;
  adVisits: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  submittedOrders: number;
  validOrders: number;
  confirmedOrders: number;
  signedOrders: number;
  validOrderValuePhp: string;
  signedGrossPhp: string;
}
```

核心 SQL（ADID）：

```ts
// orderWhere 与 marketing-report.service.ts:27-32 同口径（verified touch 用
// touched_at，否则用订单创建时间；owner/product/landingPage/linkIds 过滤相同）。
const orderWhere = Prisma.sql`(((${verifiedAttributionSql}) AND a.touched_at >= ${from}::timestamptz AND a.touched_at < ${end}::timestamptz)
      OR (NOT COALESCE((${verifiedAttributionSql}), false) AND o.created_at >= ${from}::timestamptz AND o.created_at < ${end}::timestamptz))
      ${owner ? Prisma.sql`AND COALESCE(a.optimizer_id, o.optimizer_id) = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND COALESCE(a.product_id, p.product_id) = ${query.productId}::uuid` : Prisma.empty}
      ${linkIds ? Prisma.sql`AND a.link_id IN (${Prisma.join(linkIds)})` : Prisma.empty}`;

const rows = await this.prisma.$queryRaw<AttributionReportRawRow[]>(Prisma.sql`
  WITH scoped_links AS (
    SELECT l.id, l.name AS link_name, l.product_id, l.owner_user_id, l.aid_snapshot, l.adid
    FROM campaign_links l
    WHERE l.created_at < ${end}::timestamptz
      ${owner ? Prisma.sql`AND l.owner_user_id = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND l.product_id = ${query.productId}::uuid` : Prisma.empty}
      ${query.landingPageId ? Prisma.sql`AND l.landing_page_id = ${query.landingPageId}::uuid` : Prisma.empty}
      ${linkIds ? Prisma.sql`AND l.id IN (${Prisma.join(linkIds)})` : Prisma.empty}
  ), ad_events AS (
    SELECT e.campaign_link_id AS link_id, e.ad_id,
      COALESCE(e.optimizer_id, s.owner_user_id) AS optimizer_id,
      COALESCE(e.aid_snapshot, s.aid_snapshot) AS aid_snapshot,
      COUNT(DISTINCT (e.session_id, e.event_day)) FILTER (WHERE e.event_name IN ('PAGE_VIEW','PRODUCT_VIEW')) AS ad_visits,
      COUNT(*) FILTER (WHERE e.event_name = 'PRODUCT_VIEW') AS product_views,
      COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS add_to_carts,
      COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS checkouts,
      MAX(e.ad_id_source) AS ad_id_source,
      MAX(e.ad_id_missing_reason) AS ad_id_missing_reason
    FROM analytics_events e JOIN scoped_links s ON s.id = e.campaign_link_id
    WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
    GROUP BY 1, 2, 3, 4
  ), order_facts AS (
    ${marketingOrderFactsSql(orderWhere)}
  ), ad_orders AS (
    SELECT f.link_id, f.ad_id,
      COALESCE(f.optimizer_id, s.owner_user_id) AS optimizer_id,
      COALESCE(f.aid_snapshot, s.aid_snapshot) AS aid_snapshot,
      MAX(f.adid) AS adid, MAX(f.adid_source) AS adid_source,
      MAX(f.adid_missing_reason) AS adid_missing_reason,
      ${marketingOrderTotalsSql}
    FROM order_facts f JOIN scoped_links s ON s.id = f.link_id
    WHERE f.kind = 'REGISTERED'
    GROUP BY f.link_id, f.ad_id,
      COALESCE(f.optimizer_id, s.owner_user_id),
      COALESCE(f.aid_snapshot, s.aid_snapshot)
  ), ad_keys AS (
    SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_events
    UNION
    SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_orders
  )
  SELECT s.id AS "linkId", s.link_name AS "linkName",
    COALESCE(o.adid, s.adid) AS adid,
    -- Attribution owner comes from the verified claims, not the link owner.
    COALESCE(k.optimizer_id, s.owner_user_id) AS "ownerUserId",
    COALESCE(k.aid_snapshot, s.aid_snapshot) AS aid,
    COALESCE(op.display_name, u.name) AS "ownerName",
    s.product_id AS "productId", product.name AS "productName", product.product_code AS "productCode",
    k.ad_id AS "adId",
    e.ad_id_source AS "adIdSource",
    COALESCE(e.ad_id_missing_reason, o.adid_missing_reason) AS "adIdMissingReason",
    COALESCE(e.ad_visits, 0) AS "adVisits", COALESCE(e.product_views, 0) AS "productViews",
    COALESCE(e.add_to_carts, 0) AS "addToCarts", COALESCE(e.checkouts, 0) AS "checkouts",
    COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders",
    COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
    COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
    COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders",
    COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders"
  FROM ad_keys k
  JOIN scoped_links s ON s.id = k.link_id
  LEFT JOIN ad_events e ON e.link_id = k.link_id AND e.ad_id IS NOT DISTINCT FROM k.ad_id
    AND e.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND e.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  LEFT JOIN ad_orders o ON o.link_id = k.link_id AND o.ad_id IS NOT DISTINCT FROM k.ad_id
    AND o.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND o.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  JOIN products product ON product.id = s.product_id
  JOIN users u ON u.id = COALESCE(k.optimizer_id, s.owner_user_id)
  LEFT JOIN optimizer_profiles op ON op.user_id = u.id
  ORDER BY s.link_name, k.ad_id NULLS LAST
`);
```

AID 版（同一 service 的第二个方法）：

**AID SQL 的关键修正：** 最终查询只关联已聚合的 `aid_events` / `aid_orders`
（以及 `aid_links` / `aid_ads` 去重计数），**不得再 join 原始
`analytics_events` 做 `COUNT(DISTINCT ...)`**——旧草案会忽略日期/付费过滤并
重复计数（同一事件被多行订单 join 放大）。

```ts
const rows = await this.prisma.$queryRaw<AttributionReportRawRow[]>(Prisma.sql`
  WITH order_facts AS (
    ${marketingOrderFactsSql(orderWhere)}
  ), aid_events AS (
    SELECT e.optimizer_id, e.aid_snapshot,
      COUNT(DISTINCT (e.session_id, e.event_day)) FILTER (WHERE e.event_name IN ('PAGE_VIEW','PRODUCT_VIEW')) AS ad_visits,
      COUNT(*) FILTER (WHERE e.event_name = 'PRODUCT_VIEW') AS product_views,
      COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS add_to_carts,
      COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS checkouts
    FROM analytics_events e
    WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
      AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true
      ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
    GROUP BY 1, 2
  ), aid_orders AS (
    SELECT f.optimizer_id, f.aid_snapshot, ${marketingOrderTotalsSql}
    FROM order_facts f WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL
    GROUP BY f.optimizer_id, f.aid_snapshot
  ), aid_keys AS (
    SELECT optimizer_id, aid_snapshot FROM aid_events
    UNION
    SELECT optimizer_id, aid_snapshot FROM aid_orders
  ), aid_link_keys AS (
    SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.campaign_link_id AS link_id
    FROM analytics_events e
    WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
      AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true AND e.campaign_link_id IS NOT NULL
      ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
    UNION
    SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.link_id
    FROM order_facts f
    WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL AND f.link_id IS NOT NULL
  ), aid_ad_keys AS (
    SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.ad_id
    FROM analytics_events e
    WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
      AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true AND e.ad_id IS NOT NULL
      ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
    UNION
    SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.ad_id
    FROM order_facts f
    WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL AND f.ad_id IS NOT NULL
  ), aid_links AS (
    SELECT optimizer_id, aid_snapshot, COUNT(*) AS link_count
    FROM aid_link_keys GROUP BY 1, 2
  ), aid_ads AS (
    SELECT optimizer_id, aid_snapshot, COUNT(*) AS ad_count
    FROM aid_ad_keys GROUP BY 1, 2
  )
  SELECT k.optimizer_id AS "ownerUserId", COALESCE(op.display_name, u.name) AS "ownerName",
    k.aid_snapshot AS aid, NULL::text AS "adId",
    COALESCE(l.link_count, 0) AS "linkCount", COALESCE(a.ad_count, 0) AS "adCount",
    COALESCE(e.ad_visits, 0) AS "adVisits", COALESCE(e.product_views, 0) AS "productViews",
    COALESCE(e.add_to_carts, 0) AS "addToCarts", COALESCE(e.checkouts, 0) AS "checkouts",
    COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders",
    COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
    COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp"
  FROM aid_keys k
  LEFT JOIN aid_events e ON e.optimizer_id = k.optimizer_id AND e.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  LEFT JOIN aid_links l ON l.optimizer_id = k.optimizer_id AND l.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  LEFT JOIN aid_ads a ON a.optimizer_id = k.optimizer_id AND a.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  LEFT JOIN aid_orders o ON o.optimizer_id = k.optimizer_id AND o.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
  JOIN users u ON u.id = k.optimizer_id
  LEFT JOIN optimizer_profiles op ON op.user_id = u.id
  ORDER BY "ownerName", k.aid_snapshot NULLS LAST
`);
```

- [ ] **Step 6: 在现有 report 入口委托**

`MarketingReportService.report()` 开头：

```ts
if (query.groupBy === 'ADID' || query.groupBy === 'AID') {
  return this.attributionReport.report(query, account);
}
```

构造函数注入 `MarketingAttributionReportService`。控制器不需要改；返回值保持同一顶层结构（`rows`、`total`、`from`、`to`、`groupBy`、`mode`），金额序列化为字符串。

- [ ] **Step 7: 跑测试**

Run:
```bash
MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-report.dto.spec.ts src/modules/marketing/marketing-report.integration.spec.ts src/modules/marketing/marketing-report.service.spec.ts
```
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add small-house-commerce/backend/src/modules/marketing
git commit -m "feat(marketing): add AdID and AID attribution report dimensions"
```

---

### Task 12: 报表前端新增「按 AdID / 按 AID」视图

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/marketing-api.ts`（report row 类型 + groupBy）
- Create: `small-house-commerce/frontend/src/components/admin/marketing/ReportAttributionTable.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/ReportTable.tsx:12-30,145-170`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`、`en.ts`
- Test: `small-house-commerce/frontend/src/components/admin/marketing/ReportAttributionTable.spec.tsx`、`ReportTable.spec.tsx`

**Interfaces:**
- Consumes: Task 11 API。
- Produces: 核算页统计层级新增 `ADID`、`AID`；选择后渲染独立表，列包含 AdID/链接/商品/优化师、广告访问、商品浏览、加购、发起购物、订单与金额。

- [ ] **Step 1: 写失败测试**

```tsx
it('renders one row per ad ID with attribution visits and no CL visits column value', async () => {
  render(<ReportAttributionTable rows={[rowA, rowB]} />);
  expect(screen.getByText('120200000000001')).toBeInTheDocument();
  expect(screen.getByText('120200000000002')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2); // CL 登记访问不可拆
  expect(screen.getByText('广告访问（AdID 归因）')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/ReportAttributionTable.spec.tsx
```
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 实现新表**

`ReportAttributionTable.tsx` 的列：

| 列 | 来源 |
|---|---|
| AdID / 优化师 | `row.adId ?? "未识别 AdID"`（缺失时附带 `row.adIdMissingReason`）、`row.linkName`、`row.productName`、`row.ownerName · row.aid` |
| 已登记链接访问 | 固定 `—`（不能拆） |
| 广告访问（AdID 归因） | `row.adVisits` |
| 商品浏览 | `row.productViews` |
| 加购 | `row.addToCarts` |
| 发起购物 | `row.checkouts` |
| 提交/有效/确认/签收订单 | `row.submittedOrders` 等 |
| 有效下单金额 / 签收毛额 | `row.validOrderValuePhp` / `signedGrossPhp` |

AID 视图把第一列换为「优化师 / AID」，不显示 AdID 列；增加「链接数」`linkCount` 与「广告数」`adCount` 两列。两表都只显示验签归因的访问/事件，不显示可拆的 CL 登记访问。

- [ ] **Step 4: 接入 ReportTable**

`levels = ["LINK","PAGE","PRODUCT","OWNER","ADID","AID"]`；当 `inputs.groupBy` 为 `ADID`/`AID` 时隐藏 `mode` 切换并渲染 `ReportAttributionTable`，其余分组保持现有表格/树。

- [ ] **Step 5: i18n**

`zh.ts` 增加：

```ts
marketing_report_ADID: "按 AdID",
marketing_report_AID: "按优化师 AID",
marketing_report_ad_visits: "广告访问（AdID 归因）",
marketing_report_product_views: "商品浏览",
marketing_report_adid_unidentified: "未识别 AdID",
marketing_report_adid_note: "AdID 访问按浏览器会话去重，不能与已登记链接访问相加；历史数据自上线起累计。",
```

`en.ts` 对应英文。

- [ ] **Step 6: 跑测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/ReportAttributionTable.spec.tsx src/components/admin/marketing/ReportTable.spec.tsx
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/marketing \
        small-house-commerce/frontend/src/lib/marketing-api.ts \
        small-house-commerce/frontend/src/i18n
git commit -m "feat(marketing): add AdID and AID report views"
```

---

### Task 13: 全量回归与类型检查

**Files:** 无新增

- [ ] **Step 1: 后端全量测试**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run
```
Expected: 全部通过；记录文件数/用例数。

- [ ] **Step 2: 前端全量测试**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run
```
Expected: 全部通过。

- [ ] **Step 3: 类型/构建**

Run:
```bash
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend run build
pnpm --dir small-house-commerce/frontend run build
```
Expected: 0 error；构建成功（前端 build 需要 `API_TARGET`，按 staging compose 传 `http://backend:3000`）。

- [ ] **Step 4: Lint**

Run:
```bash
pnpm --dir small-house-commerce/backend run lint
pnpm --dir small-house-commerce/frontend run lint
```
Expected: 0 error。

- [ ] **Step 5: Commit（如 lint 自动修复）**

```bash
git add -A small-house-commerce
git commit -m "chore(marketing): regression fixes for CL/AID/AdID attribution"
```

---

### Task 14: Staging 部署与 12 项验收（仅 Staging，不部署生产）

> ⚠️ 只在 `/opt/luwag-staging` 执行；不得触碰 `small-house-prod-*` 容器、生产数据库或生产 compose。

**Files:** 无（部署/验收）

**Interfaces:**
- Consumes: Tasks 1-12 的代码与迁移。
- Produces: Staging 验收记录（命令、截图、SQL 输出）。

- [ ] **Step 1: 复制代码到 staging source**

Run（在 staging 服务器）：
```bash
rsync -a --delete --exclude node_modules --exclude .next \
  /Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/meta-attribution-20261111/small-house-commerce/ \
  ubuntu@43.160.229.107:/opt/luwag-staging/source/small-house-commerce/
```
Expected: source 目录 HEAD 与本地一致。

- [ ] **Step 2: 应用迁移并重建后端/前端**

Run:
```bash
cd /opt/luwag-staging
docker compose --env-file .env build backend frontend
docker compose --env-file .env up -d db
docker compose --env-file .env run --rm backend npx prisma migrate deploy
docker compose --env-file .env up -d backend frontend
```
Expected: 迁移成功；健康检查通过。

- [ ] **Step 3: 执行 12 项验收**

逐项记录：

1. 创建 META_AD 链接 → `cleanPath` 不含 `?cl`/`?aid`；创建 FB_POST 链接 → `path`/短链保持原样。
2. 打开 `http://127.0.0.1:8088/products/<slug>` 正常。
3. 打开 `...?cl=<CL>&aid=<AID>&adid=120200000000001` → 后台出现一条 `campaign_link_visits`；`analytics_events` 行 `campaign_link_id/optimizer_id/ad_id` 均有值。
4. 同一 CL 换三个 `adid` 访问 → `ADID` 报表三行，`adVisits` 各 1，owner/aid 取验签 claims。
5. 换两个 AID → 两条链接的 owner/aid 正确；冲突时 `conflictDetail` 有值。
6. 浏览→加购→结账 → `PRODUCT_VIEW/ADD_TO_CART/BEGIN_CHECKOUT` 的 `ad_id` 不变。
7. 创建测试订单 → `order_attributions` 的 `optimizer_id/aid_snapshot/adid/ad_id/adid_source/link_id/product_id/landing_page_id` 完整；
   `fbclid` 在点击 URL 带有时应存在；`campaign_id`、`adset_id`、UTM **允许为空**，不得为了通过测试而增加追踪参数。
8. 后台按商品/优化师/AdID/CL 筛选 → 结果与 SQL 手查一致；AID 视图 `linkCount/adCount` 与去重集合一致。
9. 旧 AID-only 链接 `?aid=OP-...&adid=...` → 仍能签凭据、订单归因正确，并记录动态 AdID。
10. 短链 `/s/<code>?cl=...&aid=...&adid=...&fbclid=...` → 302 后参数齐全。
11. 未知 CL + 有效 AID → 凭据 `linkId=null`、`linkResolution='AID_FALLBACK'`、冲突有记录。
12. Pixel/CAPI：staging 关闭；用本地预览 + Meta 测试事件验证 Purchase `event_id` 去重；生产不测试。

- [ ] **Step 4: 记录验收证据**

把每项的命令输出/截图/SQL 结果保存到
`docs/superpowers/plans/2026-11-11-meta-attribution-staging-evidence.md`，提交。

---

### Task 15: 生产发布清单（冻结，不执行）

> ⚠️ 用户 2026-11-11 决定：**本次不执行 Task 15；不修改生产代码或生产数据库。**
> 以下内容仅保留为未来发布参考，任何一步都不得在本次实施中运行。

**Files:** 无

- [ ] **Step 1: 确认生产基线未前进**

Run:
```bash
ssh luwag-new 'cd /opt/small-house-commerce && git log --oneline -1'
```
Expected: 与本地 `prod/staging/luwag-shop-domain` 一致；若已前进，先 rebase/合并。

- [ ] **Step 2: 备份**

```bash
ssh luwag-new 'mkdir -p /opt/backups/meta-attribution-$(date +%Y%m%d) && docker exec small-house-prod-db-1 pg_dump -U smallhouse small_house | gzip > /opt/backups/meta-attribution-$(date +%Y%m%d)/db.sql.gz'
```
并记录回滚镜像标签。

- [ ] **Step 3: 迁移**

```bash
docker exec small-house-prod-backend-1 npx prisma migrate deploy
```
Expected: 只应用新迁移；列全部可空。生产后端镜像已确认包含
`node_modules/.bin/prisma` 与 `prisma/migrations`（2026-11-11 核对）。

- [ ] **Step 4: 先后端、后前端**

- 后端重建 → 验证 `/api/v1` 健康、触达/订单旧链路正常。
- 前端重建 → 验证链接创建/结果弹窗/短链/报表。

- [ ] **Step 5: 生产非下单冒烟**

- 打开商品页带 `?cl=<测试链接>&aid=<测试AID>&adid=120200000000001`（使用真实链接但不下单），确认 `campaign_link_visits` + `analytics_events` 写入。
- 不制造测试订单；不触发 Purchase。

- [ ] **Step 6: 回滚条件**

出现以下任一情况立即回滚镜像 + 保留新列（可空，不影响旧代码）：
- 触达接口 5xx 或凭据无法解析；
- 订单创建失败或归因字段错乱；
- 报表/链接列表渲染异常。

---

### Task 16: 历史事件 page_url 回填（不实施）

> ⚠️ 用户 2026-11-11 决定：**Task 16 不实施。** 以下只是历史草案，供未来单独评审；
> 不要在本次实施中创建脚本、跑 dry-run 或执行 `--apply`。

**Files:**
- Create: `small-house-commerce/backend/scripts/backfill-analytics-attribution.ts`
- Test: `small-house-commerce/backend/scripts/backfill-analytics-attribution.spec.ts`

**Interfaces:**
- 默认 dry-run；只填空值，不覆盖已有值；输出将要修改的行数与样本。
- 从 `page_url` 解析 `cl/aid/adid`；`adid` 必须匹配 `^\d{6,20}$`；`{{ad.id}}` 跳过。
- `cl` 解析到 `campaign_links`；`aid` 解析到 `optimizer_profiles`；`ad_id` 只写数字值。
- 回填行在 `metadata` 加 `{"backfilled": true}`，报表可按需排除。

- [ ] **Step 1: 写解析失败测试**

```ts
import { parseAttributionFromUrl } from './backfill-analytics-attribution';

it('parses real Meta parameters and refuses the template literal', () => {
  expect(parseAttributionFromUrl('https://luwag.shop/products/chair?cl=abc&aid=OP-1&adid=120200000000001'))
    .toEqual({ cl: 'abc', aid: 'OP-1', adId: '120200000000001' });
  expect(parseAttributionFromUrl('https://luwag.shop/products/chair?adid=%7B%7Bad.id%7D%7D'))
    .toEqual({ cl: null, aid: null, adId: null });
});
```

- [ ] **Step 2: 实现解析函数与 dry-run 脚本**

```ts
export function parseAttributionFromUrl(raw: string): { cl: string | null; aid: string | null; adId: string | null } {
  let url: URL;
  try { url = new URL(raw); } catch { return { cl: null, aid: null, adId: null }; }
  const cl = url.searchParams.get('cl')?.match(/^[A-Za-z0-9_-]{1,64}$/)?.[0] ?? null;
  const aid = url.searchParams.get('aid')?.match(/^[A-Za-z0-9._-]{1,64}$/)?.[0] ?? null;
  const adId = url.searchParams.get('adid')?.match(/^\d{6,20}$/)?.[0] ?? null;
  return { cl, aid, adId };
}
```

脚本默认 `--dry-run`：只统计可回填行数并打印前 20 条；`--apply` 才执行 `UPDATE`：

```sql
UPDATE analytics_events e
SET ad_id = $1, ad_id_source = 'META_DYNAMIC',
    metadata = COALESCE(e.metadata, '{}'::jsonb) || '{"backfilled":true}'::jsonb
WHERE e.id = $2 AND e.ad_id IS NULL AND e.ad_id_source IS NULL;
```

`cl` 回填同时把 `campaign_link_id` 写成对应链接（仅当为空），`aid` 回填
`optimizer_id/aid_snapshot/attribution_paid=true`（仅当为空且 AID 能解析到 ACTIVE
优化师）。

- [ ] **Step 3: staging dry-run 并核对样本**

Run:
```bash
docker exec -it luwag-staging-backend-1 node dist/scripts/backfill-analytics-attribution.js --dry-run
```
Expected: 输出 `parseable_cl=... parseable_aid=... parseable_adid=...`；样本与
0.3 节统计同量级。

- [ ] **Step 4: 经用户批准后执行生产**

只有在用户明确批准后才运行 `--apply`；执行前再次 `pg_dump`。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/scripts
git commit -m "chore(analytics): dry-run backfill for historical page_url attribution"
```

---

### Task 17: 完整审核报告（不部署）

**Files:**
- Create: `small-house-commerce/docs/superpowers/plans/2026-11-11-meta-attribution-audit-report.md`

**Interfaces:**
- Consumes: Task 1-14 的提交、测试输出、Staging 验收记录。
- Produces: 一份供用户审核的报告；**报告提交后停止，不讨论生产部署，除非用户确认**。

- [ ] **Step 1: 收集证据**

Run:
```bash
git log --oneline 1a3cbaf4..HEAD
git diff --stat 1a3cbaf4..HEAD
git show --stat --oneline HEAD
```
记录每个 Task 的提交号、改动文件数。

- [ ] **Step 2: 复跑全量验证**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run
pnpm --dir small-house-commerce/frontend exec vitest run
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend run lint
pnpm --dir small-house-commerce/frontend run lint
```
Expected: 全部通过；报告记录文件数、用例数、0 error。

- [ ] **Step 3: 写审核报告**

报告至少包含：

1. 需求逐条覆盖表（R1-R10 → Task/测试/证据）。
2. 提交清单与改动文件清单（后端/前端/迁移）。
3. 迁移文件与 staging 应用结果（列名、索引、无数据改写）。
4. Staging 12 项验收逐项结果（通过/不适用/失败原因）。
5. 未执行项：Task 15（生产发布）、Task 16（历史回填）明确标注。
6. 风险与已知边界：
   - 历史 AdID 报表自上线起累计；
   - `campaign_id/adset_id/UTM` 在 3 参数口径下为空；
   - 动态 AdID 与链接编号不一致时订单 `adid` 取动态值；
   - FB_POST 行为未变；
   - Pixel/CAPI 在 staging 关闭。
7. 回滚建议（仅讨论，不执行）。
8. 生产变更清单（仅列出，不执行）。

- [ ] **Step 4: 提交报告并停止**

```bash
git add small-house-commerce/docs/superpowers/plans/2026-11-11-meta-attribution-audit-report.md
git commit -m "docs(marketing): CL/AID/AdID attribution implementation audit report"
```

向用户提交报告摘要，等待确认；**不执行 Task 15，不改生产代码/数据库**。

---

## 回归测试矩阵

| # | 场景 | 层 | 测试位置 |
|---|---|---|---|
| 1 | META_AD 干净 URL 不含 cl/aid；FB_POST 仍用旧 path | 前端/后端 | `CampaignLinksList.spec.tsx`、`campaign-links.service.spec.ts` |
| 2 | Meta 参数含原始 `{{ad.id}}` 且由后端生成 | 前端 | `CampaignLinksList.spec.tsx` |
| 3 | cl+aid+adid 同时读取 | 前端/后端 | `tracking.touch.spec.ts`（现有）+ `marketing-touch.service.spec.ts` |
| 4 | 同 CL 三 AdID 分行，优化师取 claims | 后端报表 | `marketing-report.integration.spec.ts` |
| 5 | 不同 AID 归属 | 后端触达 | `marketing-touch.service.spec.ts` |
| 6 | 浏览/加购/结账继承 | 后端 ingest | `analytics.service.spec.ts` |
| 7 | 订单快照完整（campaign/adset/UTM 允许空） | 后端订单 | `orders.service.attribution.spec.ts` |
| 8 | 按优化师/商品/AdID/CL 筛选，linkCount/adCount 正确 | 后端报表 | `marketing-report.integration.spec.ts` |
| 9 | 旧 AID-only 兼容 + 动态 AdID | 后端触达/订单 | `marketing-touch.service.spec.ts`、`orders.service.attribution.spec.ts` |
| 10 | 短链转发 cl/aid/adid/fbclid | 前端 route | `route.spec.ts` |
| 11 | 未知 CL 回退 AID + 冲突 | 后端触达 | `marketing-touch.service.spec.ts` |
| 12 | Pixel/CAPI 去重 | 单元/预览 | 现有 CAPI 测试（staging Pixel 关闭） |

## 发布与回滚（本次不执行）

- **本次只到 Staging**；Task 15 冻结，Task 16 不实施；生产代码/数据库不改。
- **未来迁移顺序**：先迁移（可空列/索引），再后端，再前端。
- **未来回滚**：回滚镜像即可；新列可空，旧代码不读它们；迁移不回滚（Postgres 删除列会丢数据，保留更安全）。
- **凭据兼容**：新 claims 增加可选字段；旧凭据（v1/v2）仍可解析。滚动重启期间新凭据可能被旧实例拒绝（`.strict()`），单实例部署窗口很短；选择低峰发布。
- **数据边界**：历史订单不改写；历史 AdID 报表从上线日起算，**不回填**。

## Self-Review

- [x] 修正 1（FB_POST 不变）：Task 6/8/9 都按 `sourceType` 分支，FB_POST 保留 `path`/短链。
- [x] 修正 2（AID SQL）：Task 11 使用 `aid_events` + `aid_orders` 的 `DISTINCT` 集合计算 `linkCount/adCount`，不再重复 join 原始事件。
- [x] 修正 3（ADID 优化师）：Task 11 ADID 按 `(link_id, ad_id, optimizer_id, aid_snapshot)` 分组，owner/aid 取验签 claims，缺失才回退链接。
- [x] 修正 4（验收口径）：Task 14 第 7 项允许 campaign/adset/UTM 为空，禁止加参数。
- [x] 修正 5（类型统一）：Task 2 定义唯一 `AdidSource`（LINK/META_DYNAMIC/META_DYNAMIC_FALLBACK/LEGACY/NONE），不再出现 `LINK_STATIC`。
- [x] 修正 6（AID 快照/后端 meta 参数）：Task 6 用 `aidSnapshot` 生成 `metaUrlParameters`；Task 8/9 前端只复制，不拼接。
- [x] 修正 7（旧 AID-only 动态 AdID）：Task 2 claims + Task 5 订单各有一条测试。
- [x] 需求 1-3（三件套 / 干净 URL / Meta 参数）：Task 6-10（META_AD）。
- [x] 需求 4（前端参数读取）：生产已实现，复跑 `tracking.touch.spec.ts`。
- [x] 需求 5（后端归因）：Task 2-5。
- [x] 需求 6（订单快照）：Task 5 + 现有字段；测试覆盖。
- [x] 需求 7（报表）：Task 11-12。
- [x] 需求 8（12 项验收）：Task 14（仅 Staging）。
- [x] 需求 9（只读审查/不部署）：第 0 节 + Task 15 冻结 + Task 16 不实施。
- [x] 执行边界：Task 17 产出审核报告后停止，不讨论生产部署。
- [x] 影响面（漏斗/核算）：第 0.4 节明确说明，不改代码。
