# CL/AID/动态 AdID 归因闭环 — 实施审核报告

日期：2026-11-11
分支：`deploy/meta-attribution-20261111`
基线：`1a3cbaf4`（`prod/staging/luwag-shop-domain`）
范围：Task 0-14 + Task 17；**Task 15 未执行，Task 16 未实施；生产代码/数据库未改动。**

## 1. 结论

- 需求 1-9 已实现并通过单元/集成/Staging 验收。
- 追踪参数固定为 `cl`、`aid`、`adid` 三个；访问、商品浏览、加购、结账、订单、
  优化师核算和 AdID 报表共用同一份验签 claims。
- Staging **11 项通过**；第 12 项 Pixel/CAPI 为 **N/A**（Staging 显式关闭
  Pixel/CAPI），由单元测试另行覆盖（见第 10.2 节）。
- 未做生产发布；等待用户确认后再讨论 Task 15。

## 2. 实现/证据提交清单（16 个提交）

```
7b4dffac docs(marketing): spec and plan for CL/AID/dynamic AdID attribution
3f455a3c feat(analytics): attribution columns and indexes for CL/AID/AdID
965e6244 feat(marketing): record AdID provenance on signed touches
99d8d0e5 fix(marketing): keep link identity on AID conflict and fall back to AID
4fad254b feat(analytics): store verified touch attribution on events
549cd4c6 feat(orders): prefer the dynamic Meta ad ID for the advertising number
d60d9772 feat(marketing): expose clean URL, CL and per-link Meta parameters
793db942 feat(marketing): create Meta links as CL with no manual ad id
3253f0bc feat(marketing): show clean URL, CL and AID in the link result
7e243179 feat(marketing): show clean link URLs and CL/AID copy actions
4d8923f2 feat(short-link): forward the CL code through the redirect
350947e6 feat(marketing): add AdID and AID attribution report dimensions
fc7c766f feat(marketing): add AdID and AID report views
061daf47 chore(marketing): fix result dialog busy state for lint
0aae52d3 feat(marketing): include link names in attribution report rows
f34b9e68 docs(marketing): staging acceptance evidence for CL/AID/AdID attribution
```

之后的审核提交：`4ecf81d6`（审核报告）、本轮审核修订（父 `4ecf81d6`）。

改动：37 个文件，+3276 / −94。生产代码只加可空列与只读字段，不做数据重写。

## 3. 需求覆盖

| 需求 | 实现 | 证据 |
|---|---|---|
| R1 创建后只显示干净 URL / CL / AID | `cleanPath`、`cl`、`metaUrlParameters` 由后端生成；META_AD 结果弹窗三字段 + 复制 | `campaign-links.service.spec.ts`、`CreateCampaignLinkDialog.spec.tsx` |
| R2 不自动拼 `?cl=`/`?aid=`，不填 adid | 仅 META_AD 使用 `cleanPath`；创建表单固定 CL、隐藏手工 meta 字段 | 同上；FB_POST 保持原追踪 URL/短链 |
| R3 Meta 参数 `cl&aid&adid` | 按链接生成，AID 取链接创建时 `aidSnapshot`；`{{ad.id}}` 原样 | Staging 返回 `cl=rdmiTMfdJOMh1IQV&aid=OP-F06ECB704CC3&adid={{ad.id}}` |
| R4 前端独立读所有参数 | 生产原有 `marketingParams` 已满足；复跑 `tracking.touch.spec.ts` | 全量前端 3830 测试通过 |
| R5.1 CL 不阻断 AID | 未知/停用 CL + 有效 AID → `AID_FALLBACK`，记录冲突 | Staging claims；`marketing-touch.service.spec.ts` |
| R5.2 CL 定位链接/商品/落地页 | 原有 `resolveTouch` + path 校验 | Staging touch claims |
| R5.3 AID 识别优化师 | 有效 AID 覆盖 owner，保留 `linkId` | Staging `OP-E2E-OPT` 冲突 claims；ADID 报表 owner 为 E2E Optimizer |
| R5.4 AdID 动态优先 | `adIdProvenance`：动态 > 链接静态 | `marketing-touch.service.spec.ts` |
| R5.5 静态仅回退 | `adIdSource=LINK` 仅在动态缺失时 | 同上 |
| R5.6 记录 source / missing reason | claims、`analytics_events`、`order_attributions` 三层 | 迁移列；Staging `PH100021` |
| R5.7 冲突记录 | `attributionConflict`/`conflictDetail`；冲突保留链接身份 | Staging 冲突 claims |
| R5.8 凭据完整归因 | claims v2 新增 `adIdSource`/`adIdMissingReason`/`linkResolution` | Staging claims |
| R5.9 不信任客户端字段 | ingest 只写 claims；客户端 `campaignId` 被忽略 | `analytics.service.spec.ts` |
| R6 跨页/订单快照 | 沿用 credential + 首触/末触 cookie；订单固化 | Staging `PH100021` |
| R7 报表维度 | 新增 `ADID`/`AID` 分组、`adVisits/productViews/linkCount/adCount` | Staging 报表；`marketing-report.integration.spec.ts` |
| R8 Staging 验收 | 11 项通过；第 12 项 N/A | `docs/superpowers/plans/2026-11-11-meta-attribution-staging-evidence.md` |
| R9 只读审查/不部署 | 第 0 节审计；Task 15 冻结、Task 16 不实施 | 本报告 |

## 4. 数据库迁移

`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`：

- `analytics_events` 新增可空列：
  `optimizer_id`、`aid_snapshot`、`ad_id`、`ad_id_source`、
  `ad_id_missing_reason`、`adset_id`、`attribution_paid`、`link_resolution`、
  `attribution_conflict`、`conflict_detail`。
- 索引：`(ad_id,event_name,event_day)`、`(optimizer_id,event_name,event_day)`、
  `(campaign_link_id,ad_id,event_day)`、`order_attributions(link_id,ad_id)`、
  `order_attributions(ad_id,attributed_at)`。
- 无数据回填、无列删除、无 NOT NULL；旧代码可继续运行。
- 迁移 SQL 现已显式 `BEGIN; ... COMMIT;`：Prisma 7.10.0 实测**不会**自动包事务
  （失败探针留下 `tx_probe` 表）；加显式事务后，同一探针失败时 0 个新列/
  0 个新索引残留。生产将应用带事务的版本。

Staging 已应用（`2026-11-11 04:31:49+00`，当时文件尚未加显式 `BEGIN/COMMIT`，
DDL 完全相同）；生产未应用，将应用显式事务版本。`migrate status` 在 Staging
仍显示 up to date，无 checksum 报错。

## 5. 验证结果

| 项目 | 结果 |
|---|---|
| backend `vitest run` | 205 文件通过 / 27 skipped；2746 测试通过 / 281 skipped |
| backend 报表集成（独立 DB） | 16/16 通过（含 4 个新 AdID/AID 用例） |
| frontend `vitest run` | 346 文件 / 3830 测试全部通过 |
| backend `nest build` | 通过 |
| frontend `next build` | 通过（`API_TARGET=http://backend:3000`） |
| frontend `tsc --noEmit` | 0 error |
| backend `tsc --noEmit` | 219 条错误均在 spec/e2e 文件（qianyi 既有类型问题、集成测试宽松 fixture 等）；**新增/修改的非 spec 文件无错误**，`nest build` 通过 |
| backend lint | 无 error（仅既有 warning） |
| frontend lint | 4 个 error 均为既有无关文件（orders/drafts、ChangePasswordDialog、ResetPasswordDialog、TeamMemberDialog）；本次新增/修改文件无 error |
| Staging | backend/frontend/db healthy；11 项通过 + 第 12 项 N/A |

## 6. Staging 关键证据

- 链接：`rdmiTMfdJOMh1IQV` / AID `OP-F06ECB704CC3`；
  `cleanPath=/products/e2e-legacy-style`；
  `metaUrlParameters=cl=...&aid=...&adid={{ad.id}}`。
- 3 个 AdID 的 touch/事件分别归属；ADID 报表 3 行，`adVisits=1`，
  `visits=null`。
- 冲突 AID：`owner=E2E Optimizer`、`linkId` 保留、冲突有值；
  ADID 报表该行 owner 取自 claims。
- AID-only：`linkId=null`、`linkResolution=AID`、动态 AdID 正常。
- 订单 `PH100021`：`optimizer_id`、`aid_snapshot`、`adid`、`ad_id`、
  `adid_source=META_DYNAMIC`、`link_id`、`product_id` 有值；
  `campaign_id/adset_id/UTM` 为空（允许）。
- 短链 302 完整转发 `cl/aid/adid/fbclid`。
- 未知 CL + 有效 AID：`AID_FALLBACK` + 冲突记录。

## 7. 未执行 / 边界

- **Task 15（生产发布）未执行**；生产 compose、容器、数据库未动。
- **Task 16（历史 page_url 回填）未实施**；历史 AdID 报表自上线起累计。
- 三参数口径下 `campaign_id`/`adset_id`/UTM 为空；需要时在 Meta 参数追加，
  代码已支持。
- 订单 `adid` 在动态 Meta AdID 与链接编号不一致时改为动态值；这是本次
  行为变化（符合“Meta 真实 ID 优先”）。
- FB_POST 的追踪 URL、短链、结果弹窗、复制按钮保持原样。
- 商品漏斗 ADS 口径未改；广告改为 `cl+aid` 后 aid-only 流量会从 ORGANIC
  转为 ADS，这是预期变化。
- Staging 的 Pixel/CAPI 关闭；第 12 项为 **N/A**，由单元测试另行覆盖，
  未发送真实 Pixel 事件。
- claims 仍为 version 2，只增加可选字段；旧凭据可解析。滚动重启期间新凭据
  可能被旧实例的 `.strict()` 拒绝，单实例低峰发布可规避。

## 8. 生产变更清单（仅列出，未执行）

1. 应用迁移 `20261111120000_add_analytics_attribution`（可空列/索引）。
2. 重建 backend → 重建 frontend（先后端后前端）。
3. 生产非下单冒烟：真实商品页带 `?cl=...&aid=...&adid=...`，确认
   `campaign_link_visits` 与 `analytics_events` 写入；不制造测试订单。
4. 回滚：回滚镜像，保留新列（可空，不影响旧代码）。

## 9. 建议

请先审阅本报告与 Staging 证据。确认后再决定是否进入 Task 15（生产发布）；
在得到明确授权前，不修改生产代码或数据库。

---

## 10. 第二轮审核补充（2026-11-11）

### 10.1 HEAD 与提交清单关系 / Staging 实际代码版本

- `f34b9e68` = Staging 证据提交；`4ecf81d6` = 审核报告提交（父
  `f34b9e68`）；本轮审核修订（父 `4ecf81d6`）。
  原提交清单列的是 16 个实现/证据提交（最后一个 `f34b9e68`）；
  `4ecf81d6` 与本轮修订是清单之后的审核文档提交，不在那 16 个之内。
- Staging 实际代码版本 = **`0aae52d3`**（`feat(marketing): include link names
  in attribution report rows`），即部署时 worktree 的最后一个运行时提交。
- 证据：`git archive 0aae52d3` 到临时目录后执行
  `rsync -a --checksum --delete --dry-run -i ...`（排除
  `node_modules/.next/.git/dist/*.tsbuildinfo/backend/uploads/backend/src/generated/frontend/next-env.d.ts`）
  → **0 行差异**。
- 当前 worktree 与 Staging source 的对照 → **6 行**：
  3 个测试文件、`marketing-report.service.ts`（仅 `MarketingReportResult`
  类型标注，运行时无变化）、2 个本轮新增文档。Staging 运行时行为仍等于
  `0aae52d3`。

### 10.2 Staging 11 项通过 + Pixel/CAPI N/A + 单元测试另行通过

- Staging：**11 项实测通过**；第 12 项 Pixel/CAPI **N/A**（compose 显式
  `NEXT_PUBLIC_META_PIXEL_ID=""`），不发送真实 Pixel 事件。
- Pixel/CAPI 单元测试（另行执行）：
  - 命令：`pnpm --dir small-house-commerce/backend exec vitest run src/modules/meta-capi`
  - 结果：**5 文件 / 34 测试通过**
  - 关键测试：`sends one deduplicated event with hashed user data`、
    `queues one row per event id, even when the browser retries the same POST`、
    `stores nothing when the shopper has not consented`、
    `keeps Purchase off the public bridge`。
  - 命令：`pnpm --dir small-house-commerce/frontend exec vitest run src/components/tracking/PurchaseTracking.spec.tsx src/lib/tracking.touch.spec.ts`
  - 结果：**2 文件 / 34 测试通过**
  - 关键测试：`fires the stashed payload Purchase once with the server value`、
    `a refresh after the payload load never re-fires the Purchase`、
    `a payload stashed without consent never reaches Meta...`。

### 10.3 ADID 完整分组维度与 AID CTE 聚合 SQL（无重复计算）

ADID 分组键：`(link_id, ad_id, optimizer_id, aid_snapshot)`；优化师和 AID 取
验签 claims（事件/订单），缺失时才回退链接 owner/aid_snapshot。AID 分组键：
`(optimizer_id, aid_snapshot)`。

关键 CTE（与 `marketing-attribution-report.service.ts` 一致）：

```sql
-- ADID
ad_events AS (
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
  WHERE e.event_day BETWEEN :from AND :to
  GROUP BY 1,2,3,4
), order_facts AS ( ... one row per order ... ),
ad_orders AS (
  SELECT f.link_id, f.ad_id,
    COALESCE(f.optimizer_id, s.owner_user_id) AS optimizer_id,
    COALESCE(f.aid_snapshot, s.aid_snapshot) AS aid_snapshot,
    MAX(f.adid) AS adid, MAX(f.adid_source) AS adid_source,
    MAX(f.adid_missing_reason) AS adid_missing_reason,
    COUNT(*) AS "submittedOrders", ... SUM(f.grand_total) FILTER (...) ...
  FROM order_facts f JOIN scoped_links s ON s.id = f.link_id
  WHERE f.kind = 'REGISTERED'
  GROUP BY f.link_id, f.ad_id, COALESCE(f.optimizer_id, s.owner_user_id), COALESCE(f.aid_snapshot, s.aid_snapshot)
), ad_keys AS (
  SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_events
  UNION
  SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_orders
)
SELECT ... FROM ad_keys k
LEFT JOIN ad_events e ON e.link_id = k.link_id AND e.ad_id IS NOT DISTINCT FROM k.ad_id
  AND e.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND e.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
LEFT JOIN ad_orders o ON o.link_id = k.link_id AND o.ad_id IS NOT DISTINCT FROM k.ad_id
  AND o.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND o.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot;

-- AID
aid_events AS (
  SELECT e.optimizer_id, e.aid_snapshot,
    COUNT(DISTINCT (e.session_id, e.event_day)) FILTER (WHERE e.event_name IN ('PAGE_VIEW','PRODUCT_VIEW')) AS ad_visits,
    COUNT(*) FILTER (WHERE e.event_name = 'PRODUCT_VIEW') AS product_views,
    COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS add_to_carts,
    COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS checkouts
  FROM analytics_events e
  WHERE e.event_day BETWEEN :from AND :to
    AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true
  GROUP BY 1,2
), aid_orders AS (
  SELECT f.optimizer_id, f.aid_snapshot, COUNT(*) AS "submittedOrders", ... SUM(f.grand_total) FILTER (...) ...
  FROM order_facts f WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL
  GROUP BY 1,2
), aid_link_keys AS (
  SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.campaign_link_id AS link_id
  FROM analytics_events e WHERE ... AND e.campaign_link_id IS NOT NULL
  UNION
  SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.link_id FROM order_facts f WHERE ... AND f.link_id IS NOT NULL
), aid_ad_keys AS (
  SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.ad_id
  FROM analytics_events e WHERE ... AND e.ad_id IS NOT NULL
  UNION
  SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.ad_id FROM order_facts f WHERE ... AND f.ad_id IS NOT NULL
), aid_links AS (SELECT optimizer_id, aid_snapshot, COUNT(*) AS link_count FROM aid_link_keys GROUP BY 1,2),
   aid_ads AS (SELECT optimizer_id, aid_snapshot, COUNT(*) AS ad_count FROM aid_ad_keys GROUP BY 1,2)
SELECT ... FROM aid_keys k
LEFT JOIN aid_events e ON ... LEFT JOIN aid_links l ON ... LEFT JOIN aid_ads a ON ... LEFT JOIN aid_orders o ON ...;
```

**无重复计算的理由**：事件在 `ad_events`/`aid_events` 先按分组键聚合；
订单在 `ad_orders`/`aid_orders` 先按同一键聚合；最终只 1:1 关联聚合结果，
不会把同一订单按事件行数放大。`linkCount`/`adCount` 用 `DISTINCT` 集合
（事件 + 订单）计算，不是 `COUNT(DISTINCT)` 原始事件 join。

新增回归测试：`does not multiply order amounts by event rows in ADID or AID
views`（2 条事件 + 1 张 1000 PHP 订单 → `adVisits=1`、`productViews=1`、
`submittedOrders=1`、`validOrderValuePhp=1000.00`）。集成测试 **16/16** 通过。

### 10.4 AdidSource 五种类型、两个数据库字段与 VARCHAR(24)

- 唯一类型（`marketing-attribution.ts:31`）：
  `LINK | META_DYNAMIC | META_DYNAMIC_FALLBACK | LEGACY | NONE`。
- claims DTO 的 `adIdSource` 枚举同样是这 5 个值。
- 数据库字段（Staging 实测）：
  - `analytics_events.ad_id_source`：`character varying(24)`
  - `order_attributions.adid_source`：`character varying(24)`
- 最长值 `META_DYNAMIC_FALLBACK` = 21 字符 ≤ 24。
- 说明：claims 的 `adIdSource` 目前只会产生 `LINK`/`META_DYNAMIC`/`NONE`；
  订单的 `adid_source` 还可产生 `META_DYNAMIC_FALLBACK` 和 `LEGACY`。两者共用
  同一联合类型与同一列宽，不存在第二套枚举。

### 10.5 无效动态 AdID + 有效静态 AdID 回退测试与诊断

新增测试：

- `marketing-touch.service.spec.ts`：
  `falls back to a static link ad ID when the dynamic value is invalid`
  （`{{ad.id}}`、`forged`、`12345` 三个用例）。
- `orders.service.attribution.spec.ts`：
  `falls back to the link static ad ID when the dynamic value is invalid`。

命令与结果：

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/marketing/marketing-touch.service.spec.ts \
  src/modules/orders/orders.service.attribution.spec.ts \
  -t "falls back to a static link ad ID|falls back to the link static ad ID"
# 2 files / 4 tests passed（3 个 it.each 用例 + 1 个订单用例）；85 skipped
```

诊断信息：claims 为 `adId=静态链接 AdID`、`adIdSource=LINK`、
`adIdMissingReason=null`；无效动态值被丢弃、不写入 claims/订单。订单快照为
`adid=链接广告编号`、`adId=静态 AdID`、`adidSource=LINK`、`linkId` 保留。
（静态回退成功时不把 `adIdMissingReason` 置为 INVALID，因为最终使用了有效
静态 ID；这是当前定义。）

### 10.6 FB_POST 独立回归

命令与结果：

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/marketing/campaign-links.service.spec.ts \
  src/modules/marketing/dto/campaign-link.dto.spec.ts
# 2 files / 34 tests passed

pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx \
  src/components/admin/marketing/CampaignLinksList.spec.tsx \
  src/components/admin/marketing/ProductPostsDrawer.spec.tsx
# 3 files / 41 tests passed（12 + 24 + 5）
```

关键测试名：

- `keeps FB_POST on the legacy tracking path with no clean URL or Meta parameters`
- `creates a dated Facebook post with a server-generated name and normalized date`
- `clones a post as a new identity without inheriting its date, post URL or archive state`
- `keeps FB_POST metadata in the payload`
- `keeps FB_POST on the legacy full link and short link`
- `shows CL/AID/Meta copy buttons for META_AD and keeps FB_POST on its old path`
- `copies an AID URL without shortening it and offers the Meta parameters`

### 10.7 rsync --delete dry-run 记录

实际部署命令（已执行，仅 Staging）：

```bash
rsync -a --delete -e ssh \
  --exclude node_modules --exclude .next --exclude .git \
  <worktree>/small-house-commerce/ \
  luwag-new:/opt/luwag-staging/source/small-house-commerce/
```

审计 dry-run（比较 `0aae52d3` 与 Staging source；排除构建/运行产物）：

```bash
git archive 0aae52d3 small-house-commerce | tar -x -C /tmp/meta-attr-0aae52d3
rsync -a --checksum --delete --dry-run -i -e ssh \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude dist --exclude '*.tsbuildinfo' \
  --exclude backend/uploads --exclude backend/src/generated \
  --exclude frontend/next-env.d.ts \
  /tmp/meta-attr-0aae52d3/small-house-commerce/ \
  luwag-new:/opt/luwag-staging/source/small-house-commerce/
# 输出：0 行（0 新增/修改/删除）
```

当前 worktree 对照同一 Staging source：6 行（3 个测试文件、
`marketing-report.service.ts` 类型标注、2 个文档）。没有运行时行为差异的
文件被删除或改写。

### 10.8 生产基线 1a3cbaf4 与当前分支 tsc/lint 对照

基线 worktree：`/private/tmp/cart-added-20261110`（HEAD `1a3cbaf4`，
已安装依赖并 `prisma generate`）。

| 检查 | 基线 `1a3cbaf4` | 当前分支 | 结论 |
|---|---|---|---|
| backend `tsc --noEmit` | 179 行错误 | 124 行错误 | 无新增文件/错误类别；`marketing-report.integration.spec.ts` 的 27 个 TS2345 消失，TS2532 10→9；本次改动的非 spec 源文件 0 error |
| frontend `tsc --noEmit` | 0 | 0 | 一致 |
| backend lint（oxlint） | exit 0，10 个 warning | exit 0，10 个 warning | 一致 |
| frontend lint（eslint） | 5 errors / 25 warnings | 4 errors / 25 warnings | 少了 `PostLinkResultDialog.tsx` 的既有 setState-in-effect error（本次修复）；剩余 4 个 error 与基线同文件同位置 |

命令：

```bash
# 基线
cd /private/tmp/cart-added-20261110/small-house-commerce/backend && pnpm exec tsc --noEmit
cd /private/tmp/cart-added-20261110/small-house-commerce/frontend && pnpm exec tsc --noEmit && pnpm run lint
# 当前
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend run lint
pnpm --dir small-house-commerce/frontend run lint
```

说明：前端 lint 仍以 exit 1 结束，只因 4 个**基线已存在**的无关 error；
本次新增/修改文件没有 error。后端 lint exit 0。

### 10.9 claims v2 混合版本解析风险

- `marketingTouchClaimsSchema` 是 `.strict()`，`version` 接受 1/2。
- 新后端签发的 v2 凭据新增可选字段 `adIdSource`、`adIdMissingReason`、
  `linkResolution`；旧凭据（无这些字段）在新后端可正常解析。
- **反向风险**：滚动发布期间，新后端签发的 v2 凭据若被仍在运行的旧后端解析，
  旧后端的 `.strict()` 会把新增字段视为未知字段并拒绝该凭据。后果是这次
  touch 解析为 null：事件不挂链接、订单暂时失去归因；不会静默错配到别人。
- 缓解：单实例/低峰发布、先后端后前端、凭据 TTL 7 天、失败按无归因处理
  （fail-closed）。没有自动重签或降级逻辑，需在发布窗口内规避。
- 覆盖测试：
  - `still accepts touches signed before the advertising number existed`
  - `signs version 2 claims with the paid fields and no stable ad number`
  - 命令：`pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-touch.service.spec.ts -t "still accepts touches signed before|signs version 2 claims"`
  - 结果：2 passed / 45 skipped。

**Staging 实测补充**：新建带静态 AdID 的测试链接
`-b4K-RQEbB_03rET`（`adid=120200000000123`），用 `adId="{{ad.id}}"`
触达后 claims 为 `adId=120200000000123`、`adIdSource=LINK`、
`adIdMissingReason=null`、`linkId` 保留；与单元测试一致。

## 11. 生产发布操作方案

已单独成文：`docs/superpowers/plans/2026-11-11-meta-attribution-production-release-plan.md`。

覆盖：Claims v2 部署/兼容/回滚、数据库备份与恢复、迁移安全/可重复性/
回滚影响、Backend→Frontend 顺序与健康检查、非下单冒烟、停止条件、回滚方案、
风险清单和 Go/No-Go 清单。

本阶段仍未修改生产代码/数据库、未重启生产容器、未执行迁移、未推送/部署。
