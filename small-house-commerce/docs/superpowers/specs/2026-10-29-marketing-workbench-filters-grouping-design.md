# 投放工作台：筛选、排序、商品分组与漏斗指标

- 日期：2026-10-29
- 状态：设计待评审
- 范围：后台 `/admin/marketing/links`（投放链接）与 `/admin/marketing/reports`（核算）
- 上游口径：[投放工作台与独立商品落地页设计](2026-10-09-marketing-workbench-design.md) §9、§11

## 1. 目标与已确认范围

运营在投放工作台里需要按投放师和商品快速筛选链接，按指标排序，并能把链接按「商品 → 来源类型」两级分组查看，而不是全部混在一张平表里；每个商品名前面显示商品缩略图；核算表新增「加购」「发起购物」两个漏斗指标。

已确认的决定：

1. 加购 / 发起购物采用**事件级归因**：浏览器第一方事件携带当前投放链接的触达凭据，服务端验签后落链接 ID。与订单归因使用同一张 last-touch 凭据（7 天窗口），口径一致。
2. 只统计上线之后的流量。历史事件没有凭据，无法回填，界面明确标注加购/发起购物「自上线日起累计」。
3. 核算表的「按商品分组」是**两级可折叠树**：商品 → 来源类型 → 链接。
4. 分组默认按商品名、来源类型、链接名排序；用户切换排序指标时，各级都用该指标排序。
5. 本次不接 Meta Insights，不显示 Facebook 平台侧的点量、覆盖与互动。

## 2. 现状

- `CampaignLinksList` 只有「搜索 + 状态」两个筛选。后端 `listLinks` 已支持 `ownerUserId`、`productId`，界面没有放出来；返回行没有商品缩略图。
- `ReportTable` 已有日期、分组维度（LINK/PAGE/PRODUCT/OWNER）和投放师筛选；没有商品筛选、没有排序、没有缩略图。
- 报表服务把全部登记链接聚合成行后在内存里切片分页，因此加排序不会改变查询成本。
- 第一方事件流只写了 `PAGE_VIEW`、`SEARCH`、首页曝光/点击。`ADD_TO_CART`、`BEGIN_CHECKOUT` 只存在于 Meta Pixel，`analytics_events` 里从来没有这两类行，也没有任何投放链接归属。

## 3. 数据链路：加购与发起结账

### 3.1 第一方事件发射

`frontend/src/lib/commerce-events.ts` 的 `emitCommerceEvent()` 是全部 Meta 商务事件的唯一出口。在这里同时补发第一方事件，保证站内漏斗与 Pixel 严格同源：

| Meta 事件 | 第一方事件 | 附带字段 |
| --- | --- | --- |
| `AddToCart` | `ADD_TO_CART` | `productId`、`entityId`（最终 SKU ID） |
| `InitiateCheckout` | `BEGIN_CHECKOUT` | `entityId`（结账条目 SKU 拼接，截断到 120 字符） |

- `CommerceEvent` 增加内部字段 `productId?: string`，只给第一方事件使用，不进入 Meta payload。
- 现有 `AddToCart` 发射点（PDP 加购成功、商品卡快捷加购）自动覆盖；购物车里的「换规格」是替换而非加购，本来就不发 `AddToCart`，因此也不会产生 `ADD_TO_CART`。
- `InitiateCheckout` 沿用现有「每个结账会话至多一次」的 `INITIATE_CHECKOUT_FIRED_KEY` 逻辑，不新增去重。
- 只有动作真实成功后才有商务事件，因此加购/发起结账不会在失败或取消时虚增。

### 3.2 浏览器附加归因凭据

- `frontend/src/lib/tracking.ts` 导出 `currentMarketingCredential()`，返回当前有效的 `sh:marketing-touch` 凭据字符串或 `null`。
- `frontend/src/lib/analytics.ts` 的 `FirstPartyEvent` 增加可选 `marketingCredential`；`baseEvent()` 统一附加。没有凭据时不带字段。
- 凭据只进请求体，不写进 URL、不写日志。

### 3.3 服务端验签与落库

- `analytics-event.dto.ts`：`marketingCredential` 为可选字符串，长度上限 8192；其余字段校验不变。
- `AnalyticsService.ingest()` 注入 `MarketingTouchService`（由 `CatalogModule` 导出），对同一批事件按凭据字符串记忆化验签，取 `claims.linkId`（可能为 `null`：DIRECT/legacy 触达没有链接 ID）。
- 验签失败或过期：事件照常入库，`campaignLinkId` 为 `null`，**不丢弃事件**，也不影响埋点端点的可用性。
- 只存链接 ID，不存凭据本身。
- `analytics.prisma`：

```prisma
model AnalyticsEvent {
  // ...
  campaignLinkId String? @map("campaign_link_id") @db.Uuid
  @@index([campaignLinkId, eventName, eventDay])
}
```

- 新迁移：`ADD COLUMN campaign_link_id uuid NULL` + `CREATE INDEX`。不回填，不加外键（与该表其余可空标识一致，避免给公开写入路径增加约束失败风险）。

### 3.4 口径与边界

- 加购、发起购物按**事件次数**统计，不是人数：同一会话多次加购算多次；发起结账因每个结账会话至多一次，近似会话数。
- 访问仍是「链接 + 会话 + 马尼拉日」去重（原 §9.3），与加购的事件口径不同，界面写明。
- 归因沿用 last touch：用户点了新广告后，新事件归新链接，旧事件不重算。
- 直接访问、无凭据访问、`linkId` 为空的 DIRECT/legacy 触达不计入任何链接行。
- 公开埋点端点可被伪造上报（已有速率限制）；该数据只作运营参考，不参与结算，订单金额仍以订单表为准。

## 4. 报表接口

`GET /api/v1/admin/marketing/reports` 扩展，不新增端点。

### 4.1 查询参数

新增：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `mode` | `FLAT` / `TREE` | `FLAT` |
| `sortBy` | `NAME` `PRODUCT` `OWNER` `VISITS` `ADD_TO_CARTS` `CHECKOUTS` `SUBMITTED` `VALID` `CONFIRMED` `SIGNED` `VALID_VALUE` `SIGNED_GROSS` `SPEND_USD` `ORDER_CPA` `SIGNED_CPA` `ORDER_ROAS` `SIGNED_ROAS` `CONVERSION` | `NAME` |
| `sortDirection` | `ASC` / `DESC` | `ASC` |

既有参数保持不变：`from`、`to`、`groupBy`、`linkIds`、`ownerUserId`、`productId`、`landingPageId`、`page`、`pageSize`。

商品筛选沿用既有的 `productId` 参数；界面下拉来自 `GET /api/v1/admin/landing-pages/product-options`，与页面下拉共用同一个数据源和缩略图规则。

### 4.2 新指标

每行增加：

- `addToCarts`：该分组范围内 `ADD_TO_CART` 事件数。
- `checkouts`：该分组范围内 `BEGIN_CHECKOUT` 事件数。
- `productThumbnailUrl`：商品首图，无图时为 `null`。

SQL 增加一个 CTE：

```sql
commerce_events AS (
  SELECT s.group_key,
         COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART')   AS "addToCarts",
         COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS "checkouts"
  FROM analytics_events e
  JOIN scoped_links s ON s.id = e.campaign_link_id
  WHERE e.event_day BETWEEN :from AND :to
    AND e.event_name IN ('ADD_TO_CART','BEGIN_CHECKOUT')
  GROUP BY s.group_key
)
```

`productThumbnailUrl` 在 JS 侧按行里的商品 ID 批量查询首图（`type = IMAGE`、`variantId IS NULL`、`optionValueId IS NULL`，按 `sortOrder`、`id` 取第一张），不改变主查询结构。

### 4.3 排序

- 服务端对**序列化后的全量登记行**排序，再按 `pageSize` 切片；现有实现本来就是全量计算后切片，排序不增加查询次数。
- 文本字段（名称、商品、投放师）按 `localeCompare('zh')` 升序/降序；数值字段按数值比较，`null`（如无费用时的 CPA/ROAS）无论升降序都排在最后。
- 同值时按 `id` 稳定排序，避免翻页时行序跳动。

### 4.4 树形聚合（`mode=TREE`）

结构固定为三层：商品 → 来源类型 → 链接。

聚合规则：

- 订单数、有效下单金额、签收毛额、广告费、覆盖天数、加购、发起购物：由链接行**求和**。一张订单只归一个链接，求和不会重复；费用按链接逐日记录，求和即为商品合计。
- **访问**：单独查询按组去重，避免同一会话同一天点了同商品的两个链接时被重复计数：

```sql
SELECT l.product_id::text AS product, l.source_type::text AS source,
       COUNT(DISTINCT (v.visit_key, v.visit_day)) AS visits
FROM campaign_link_visits v
JOIN scoped_links l ON l.id = v.link_id
WHERE v.visit_day BETWEEN :from AND :to
GROUP BY GROUPING SETS ((l.product_id), (l.product_id, l.source_type))
```

- CPA、ROAS、转化率、费用覆盖由 `serializeMarketingReportRow` 对合成行计算，和平铺使用同一个函数，保证口径一致。
- 分组排序：用同一 `sortBy` 指标比较各级合计；`NAME`/`PRODUCT`/`OWNER` 时按名称；同值按名称、来源类型顺序、链接名稳定排序。
- `mode=TREE` 不分页，返回筛选范围内全部链接。界面在链接数超过 500 时提示「先按商品或投放师筛选」。

### 4.5 响应

平铺响应在现有字段上增加 `mode`、`sortBy`、`sortDirection`、新指标与缩略图，结构不变。

树形响应：

```ts
interface MarketingReportTree {
  from: string; to: string; asOf: string;
  mode: "TREE"; sortBy: string; sortDirection: "ASC" | "DESC";
  linkCount: number;
  tree: Array<{
    product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
    totals: MarketingReportRow;
    sources: Array<{
      sourceType: MarketingSourceType;
      totals: MarketingReportRow;
      links: MarketingReportRow[];
    }>;
  }>;
  otherSources: MarketingReportRow[];
}
```

`otherSources`（DIRECT / LEGACY / UNVERIFIED）保持现有的独立小表，不参与树形。

## 5. 前端

### 5.1 核算表（`ReportTable`）

- 筛选条：开始/结束日期、**商品下拉**（新增）、投放师下拉（已有，仅 `MARKETING_VIEW_ALL` 可见）、**视图切换**（按商品分组 / 平铺）、**排序下拉 + 升降序**。
- 默认视图：**按商品分组**（树形）。
- 列顺序：内部名称 → 访问 → **加购** → **发起购物** → 提交订单 → 有效订单 → 确认订单 → 签收订单 → 有效下单金额 → 签收毛额 → USD 金额 → PHP 费用 → 下单 CPA → 签收 CPA → 下单 ROAS → 签收 ROAS → 转化率 → 费用覆盖。
- 表头可点击排序，当前排序列显示 ▲/▼；点击同一列切换方向。
- 第一列：链接行显示链接名 + 投放师/AID + 商品名/编码 + 标记行；商品行显示缩略图 + 商品名 + 编码；来源行显示来源类型标签。缩略图 40×40，无图时显示占位块。
- 树形默认展开到来源层，可收起；折叠状态在本次会话内保留（组件状态，不落库）。
- 加购/发起购物表头带提示：「事件次数，自上线日起累计」。
- 分页：平铺 20 条/页；树形不分页，底部显示链接总数。

### 5.2 投放链接表（`CampaignLinksList`）

- 筛选条：搜索（已有）、状态（已有）、**商品下拉**、**投放师下拉**（仅 `MARKETING_VIEW_ALL` 可见）。
- 商品列前增加 40×40 缩略图；后端 `CampaignLinkRow` 增加 `productThumbnailUrl`（`serialize` 时取商品首图）。
- 不加排序与分组：该表列少，保持创建时间倒序。

### 5.3 文案

中英文 i18n 同步新增：加购、发起购物、按商品分组、平铺、排序、升序/降序、缩略图占位、事件次数提示、树形链接总数、超过 500 条的筛选提示。

### 5.4 交互细节

- 切换商品/投放师筛选或排序时回到第 1 页。
- 加载中保持上一屏数据不闪空；请求失败显示错误行，不保留半旧数据。
- 树形折叠行不改变列宽；长商品名截断并保留 `title`。

## 6. 权限与安全

- 报表与链接列表继续沿用 `MarketingAccount` 作用域：只有 `MARKETING_VIEW_ALL` 能看到投放师下拉和跨投放师数据；仅本人权限的账号即使手工传 `ownerUserId` 也会被 `assertVisible` 拒绝。
- 商品筛选不改变作用域，只收窄结果。
- 埋点端点保持公开 + 速率限制；验签失败不报错、不丢事件；凭据不落日志、不回显。
- 报表数值不参与结算。

## 7. 测试

后端：

- DTO：`marketingCredential` 长度边界、`mode`/`sortBy`/`sortDirection` 非法值被拒。
- `AnalyticsService`：有效凭据写入 `campaignLinkId`；同一批多事件复用一次验签；无效/过期凭据落 `null` 且事件仍入库。
- 报表 SQL：`addToCarts`/`checkouts` 按链接、按日期正确计数；无事件行为 0；`otherSources` 不受影响。
- 排序：每种 `sortBy` 的升降序与 `null` 置底；稳定排序。
- 树形：产品/来源合计等于链接行之和（访问除外）；访问按组去重与平铺的链接访问之和在跨链接会话下不相等（用测试数据固定这个差异）；CPA/ROAS/转化率与平铺同函数结果一致。

前端：

- `emitCommerceEvent`：AddToCart → 恰好一条 `ADD_TO_CART`；InitiateCheckout → 一条 `BEGIN_CHECKOUT`；其它事件不产生第一方漏斗事件。
- `analytics.ts`：有/无凭据时 payload 形状正确。
- `ReportTable`：筛选、排序、树形展开/折叠、空状态、分页/不分页切换。
- `CampaignLinksList`：商品/投放师筛选与缩略图渲染。

## 8. 迁移与部署

- 迁移 `20261029120000_add_analytics_campaign_link`：加列 + 加索引；部署前执行，部署顺序为先迁移后启动后端。
- 后端部署必须执行 `prisma generate`（`pnpm build` 不会生成 client）。
- **后端必须先上或前后端同时上**：前端一旦开始发送 `marketingCredential`，旧后端的 `.strict()` 校验会拒绝整批事件，造成埋点空窗。
- 部署前比对服务器上的 `main` 与 GitHub，历史上服务器曾领先远端。
- 本设计不在当前 worktree 分支上实现：当前分支比 `origin/main` 落后 70 个提交、领先 4 个，实现从 `origin/main` 新开 worktree 与分支。

## 9. 明确不做

- 不接 Meta Insights，不显示 Facebook/Instagram 平台侧点击、覆盖、互动。
- 不回溯历史加购/发起结账，不做补数。
- 不改导航、Header、Footer、全局主题与既有表格之外的页面。
- 不做加购/发起结账的人数去重、加购率、加购转化率等衍生指标。
- 不把「访问」和「加购」合成同一个人数口径。
- 不做自动拉取广告费、批量导入或跨平台成本同步。
- 投放链接表不加排序和分组。

## 10. 验收条件

1. 核算页能按商品、投放师筛选；两个筛选项可组合，筛选后翻页与排序结果一致。
2. 任意数值列点击表头可升/降序，`—` 始终在最后。
3. 树形视图显示商品 → 来源 → 链接三层，可折叠；商品与来源行的订单、金额、费用、加购、发起购物等于所属链接之和；访问按下文口径去重。
4. 商品名（平铺与树形、商品选项下拉）前都有 40×40 缩略图，无图显示占位。
5. 投放链接页能按商品、投放师筛选，商品列前有缩略图。
6. 真实下单前：在投放链接落地页加购一次、进入结账一次，核算页对应链接的加购、发起购物各增 1；直接访问（不带 `cl`）不增加任何链接的这两个数。
7. 迁移后 `analytics_events.campaign_link_id` 对带有效凭据的新事件有值，历史行为 `null`。
8. 中英文界面均无缺失文案。
