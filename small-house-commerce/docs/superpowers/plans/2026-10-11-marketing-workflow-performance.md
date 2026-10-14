# 营销工作台步骤与效果分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 沿用 Native：主会话连续实施，不派逐任务实施者或审查者；只在本轮新增交付完成后做一次独立审查。

**Goal:** 把营销落地页组织成四步业务操作，提供同商品页面纵向比较、单个优化师全部页面总览，以及日／周趋势和上期比较。

**Architecture:** 复用现有页面编辑、认证、费用账本和订单归因；新增只读 performance 接口，以全部授权页面为目录，左关联已登记落地页链接的指标。数据库在同一读取快照中分别计算分页前汇总、页面指标和趋势，前端共享筛选／表格／图表，编辑器只改变信息架构，不重写 mutation 协议。

**Tech Stack:** Next.js 16.3.4、React 19.2.8、TypeScript 6、NestJS 12、Prisma 7.10.0、PostgreSQL、pnpm 12.3.4、Vitest、Playwright、Puck 0.23.0；图表选 Recharts 3.10.1。

**Spec:** [营销工作台业务设计](../specs/2026-10-11-marketing-workflow-performance-design.md)。基础口径继续来自 [原投放工作台设计](../specs/2026-10-09-marketing-workbench-design.md)。本计划于 2026-10-12 收口；文件名沿用已开始的 2026-10-11 工作项。

**Status:** 待用户审阅；尚未开始本轮产品代码实施、依赖安装或新服务启动。

## Global Constraints

- “编辑内容 → 预览发布 → 投放链接 → 费用与效果”；切步骤不自动保存、发布或创建链接，不重新加载文档，不丢输入。
- 全部当前可见页面保留，包括草稿、停用、未建链接、零访问、零订单；状态筛选指当前状态。
- 业务时区固定 Asia/Manila，周一开周；本周比较上周相同星期范围。
- 主投放指标只包含已登记且绑定落地页的 CampaignLink；直达母商品、没有 landingPageId 的链接不混入。
- DIRECT、LEGACY、UNVERIFIED 单列；无可验证触达时间的历史来源保持 ORDER_CREATED，不进入主触达趋势。
- 页面／商品／优化师访问按 visit_key 与 visit_day 独立去重，不能相加子级访问当去重汇总。
- 订单归因仍是订单级、整单金额；晚确认／晚签收归回原触达日期，不按签收日搬收入。
- 有效订单排除 CANCELLED／DENIED；真实全单签收要求 shipment 存在、每箱 SIGNED 且 signedAt 非空；其他订单标记继续沿用原实现。
- USD、历史 FX、保存的 PHP 费用使用 Decimal 快照；费用缺失不当零，显式零费用不制造免费 CPA／无穷 ROAS。
- 签收毛额包含整单运费、未扣退款、不等于 COD 回款或利润；不做佣金、净收入、自动胜负或显著性。
- own 不读他人；VIEW_ALL 不授 MANAGE_ALL。优化师停用历史只可读，不恢复账号或创建权限。
- 保留 CAS、request identity、actor/page/input scope、raw HTML 与服务器验证投影分离、上传锁、语言切换及 Disable 保留输入。
- 不改 Product／Variant／SKU／Inventory／Order 金额、库存、风险、重复单、履约、幂等语义；不接管 FAQ、商品卡 V2、Scene、Bundle。
- Header／Footer、首页外壳和公告富文本倒计时仍暂存；不做广告平台费用自动同步。
- 当前共享 worktree feature/homepage-builder 的 dirty 成果全部保留；不 reset、整树 restore、裸 stash/pop 或清理工作区。
- 唯一可写测试库 small_house_marketing_dev，host 必须 localhost 或 127.0.0.1；不操作生产、同伴 rehearsal 或 product-card 测试库。
- 本轮无 schema、migration、generate 需求；若确需变更，先说明并协调，不能偷偷执行。
- 当前用户预览 3210／3211 不重启；不动 3000／3001／3005 或其他会话服务，不覆盖主 frontend 的 .next。
- 新运行副本仅放本计划工作区，预选 backend 3220／frontend 3221；先检查监听者，占用则选择其他空闲端口，不杀占用者。
- 正常表单登录或 refresh，access token 只在内存；不伪造 JWT、不放 localStorage、不降低认证限流，不为清限流重启。
- 不在生产造费用、访问、评论或订单；本地演示明确标注不是真实投放结果。
- 无本轮 commit／push／SSH／生产部署授权；任务末尾记录证据而不是提交。保留工作区、日志和运行副本，不自动删除。
- 新最终审查只审本轮增量及其边界影响，不重启原 2026-10-09 已完成的审查。

## Review Focus

1. **页面与链接建立时间晚于所选期间：** 页面仍显示，但该期间没有投放基础，不能伪造零表现或上期增长；Task 3、6 钉住。
2. **同 session 同日跨链接／页面：** 行指标可以分别记录接触，商品／优化师总计必须重新去重，不能求行和；Task 3 钉住。
3. **今天、部分周、跨月及费用只录一部分：** 日期明确，周比率重新算，未知费用画断点，上期零基数不显示无限增长；Task 1、2、7 钉住。
4. **actor／权限或筛选在慢请求期间变化：** 旧人员、旧页面、旧摘要／趋势不得闪现或覆盖新范围；错误不得显示成零；Task 4、6 钉住。
5. **编辑上传中切步骤／停用／切语言：** 不丢 raw 输入，不释放仍在执行的锁，不把内部预览误当线上；Task 5、8 钉住。

---

## 文件结构与真实接线位置

以下路径均相对 small-house-commerce。不是重新实施原工作台。

| 文件 | 职责 |
| --- | --- |
| backend/src/modules/marketing/dto/marketing-performance.dto.ts | performance 与 options 的严格查询协议 |
| backend/src/modules/marketing/marketing-performance-period.ts | Manila 日期、上期、日／周 bucket 的纯函数 |
| backend/src/modules/marketing/marketing-report-metrics.ts | 从原 report 提取共享 Decimal 投影和变化计算 |
| backend/src/modules/marketing/marketing-report-facts.ts | 从原 report 提取订单事实 SQL，不改业务标记 |
| backend/src/modules/marketing/marketing-report.service.ts | 使用共享投影／事实；保留旧报告响应和范围 |
| backend/src/modules/marketing/marketing-performance.types.ts | 后端内部读取结果和公开响应类型 |
| backend/src/modules/marketing/marketing-performance.sql.ts | 参数化批量聚合；不读出逐访问明细给 JS |
| backend/src/modules/marketing/marketing-performance.service.ts | 权限、快照、目录左关联、摘要、趋势、稳定排序和分页 |
| backend/src/modules/marketing/admin/marketing-performance.controller.ts | 两个 private/no-store GET 入口 |
| backend/src/modules/catalog/catalog.module.ts | 最小注册新 controller/provider；不存在 marketing.module.ts |
| frontend/src/lib/marketing-api.ts | 公开类型及认证 API 方法 |
| frontend/src/components/admin/marketing/useMarketingPerformance.ts | 同 scope 的 options／report 请求及错误生命周期 |
| frontend/src/components/admin/marketing/MarketingWorkspaceNav.tsx | 三个业务主入口；旧链接／费用／通用报表作为辅助入口 |
| frontend/src/components/admin/marketing/PerformanceFilters.tsx | 日期、状态、商品／人员、上期、排序和分页条件 |
| frontend/src/components/admin/marketing/PerformanceSummary.tsx | 页面概况与期间效果，明确全筛选而非本页 |
| frontend/src/components/admin/marketing/PerformancePageTable.tsx | 桌面紧凑行、手机卡片、详情、按商品分组 |
| frontend/src/components/admin/marketing/MarketingPerformanceDashboard.tsx | PRODUCT／OPTIMIZER 与编辑器单页嵌入的组装 |
| frontend/src/components/admin/marketing/PerformanceTrend.tsx | 单指标选择、趋势表、异步加载图表 |
| frontend/src/components/admin/marketing/PerformanceTrendChart.tsx | Recharts 的 client-only 绘图，不算金融指标 |
| frontend/src/components/admin/marketing/MarketingPageEdit.tsx | 四步状态与既有 editing/mutation 集成 |
| frontend/src/components/admin/marketing/PublishBar.tsx | 三种版本状态和清楚的禁用原因，保持操作前置条件 |
| frontend/src/components/admin/marketing/MarketingCanvas.tsx | Puck 区域词汇与空选择指引，保持原验证和上传边界 |
| frontend/src/components/admin/marketing/MarketingWorkbench.tsx | 接入三入口，保留历史辅助路径 |
| frontend/src/components/admin/marketing/MarketingPagesList.tsx | 清单操作入口收敛到编辑／效果，不删除功能 |
| frontend/src/app/admin/(shell)/marketing/compare/page.tsx | 商品比较路由 |
| frontend/src/app/admin/(shell)/marketing/optimizers/page.tsx | 优化师总览路由 |
| frontend/src/i18n/zh.ts、en.ts | 完整中英业务文案，沿用平铺 marketing_* key |
| frontend/package.json、frontend/pnpm-lock.yaml | 只添加固定图表依赖，不顺带升级框架 |

测试跟随上述生产文件使用 .spec.ts／.spec.tsx。PostgreSQL 新增 marketing-performance.integration.spec.ts；浏览器、演示和证据仅在本计划 git-ignored workspace。不另造通用 BI 模块、状态框架或营销数据库。

## 实施前准备（批准后、Task 1 首次写源码前）

执行skill解析本计划自己的workspace，并立即保存baseline-manifest：HEAD、真实git status、本轮将修改文件的原bytes/hash、原未跟踪文件清单。现有营销代码也未提交，不能用HEAD或原2026-10-09的review diff代替本轮修改前基线。只创建本计划ledger和证据目录，不重建原环境、不启动或停止服务。后续每任务把RED/GREEN命令和偏离决定写入自己的ledger；Task 8复核这份基线，而不是届时才采集。

## 跨任务固定接口

### 查询与范围

```ts
type PerformanceView = 'PRODUCT' | 'OPTIMIZER';
type PerformancePreset = 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_WEEK' | 'LAST_WEEK' | 'CUSTOM';
type PerformanceInterval = 'DAY' | 'WEEK';
type PerformanceSort = 'name' | 'visits' | 'validOrders' | 'conversionRate' | 'spendUsd' | 'orderCpaUsd' | 'signedRoas';
type EffectivePageStatus = 'DRAFT' | 'LIVE' | 'SCHEDULED' | 'ENDED' | 'DISABLED';

interface MarketingPerformanceQuery {
  view: PerformanceView;
  productId?: string;
  ownerUserId?: string;
  landingPageId?: string;
  trendPageId?: string;
  effectiveStatus?: EffectivePageStatus;
  preset: PerformancePreset;
  from?: string;
  to?: string;
  interval: PerformanceInterval;
  compare: boolean;
  sortBy: PerformanceSort;
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
}
interface MarketingPerformanceOptionsQuery { ownerUserId?: string }
interface PerformanceDateRange { from: string; to: string }
interface PerformanceReadRange extends PerformanceDateRange { startAt: Date; endAt: Date }
interface PerformanceWindow {
  asOf: Date;
  current: PerformanceReadRange;
  previous: PerformanceReadRange | null;
}
interface PerformanceBucket extends PerformanceDateRange {
  key: string;
  partialWeek: boolean;
  includesToday: boolean;
}
```

- PRODUCT 必须有 productId；OPTIMIZER own 由服务器绑定本人，伪造其他 owner 返回 404，all 未选 owner 返回 400。
- PRODUCT all 的 owner 可选；不选则比较全部授权负责人。历史未分配页面只在允许的 PRODUCT／页面管理范围显示。
- landingPageId 是目录单页过滤，供第4步使用；trendPageId 只选择趋势，不改变目录、摘要或分页。
- 任一页面 ID 必须属于基础可见目录，并满足商品、人员、状态和单页条件，否则 404；无日期数据本身不构成 404。
- CUSTOM 才接受 from/to，必须合法且 from≤to≤Manila 今天；其他预设附带 from/to 返回 400，避免歧义。
- API compare 使用字符串 1／0；DTO 转 boolean，默认 true。默认 LAST_7_DAYS、DAY、name/asc、page=1、pageSize=20；pageSize 范围 1..100。
- options 返回授权范围内有页面的商品；VIEW_ALL 的人员选择包含现有优化师及有历史页面的人员，保留停用人员；own 不返回其他人员列表。
- 分析 picker 不替换原 productOptions／ownerOptions，不放宽创建或归属指定。

### 金额、空值、响应

```ts
interface PerformanceTotals {
  visits: number | null;
  pageTotalVisits: number | null;
  submittedOrders: number;
  validOrders: number;
  confirmedOrders: number;
  signedOrders: number;
  duplicateOrders: number;
  riskOrders: number;
  afterSalesOrders: number;
  refundStatusOrders: number;
  validOrderValuePhp: string;
  signedGrossPhp: string;
  spendUsd: string;
  spendPhp: string;
  expectedCostDays: number;
  recordedCostDays: number;
  costCoverageComplete: boolean;
  orderCpaUsd: string | null;
  signedCpaUsd: string | null;
  orderRoas: string | null;
  signedRoas: string | null;
  conversionRate: string | null;
  periodBasis: 'TOUCH' | 'ORDER_CREATED';
}
type PerformanceMetric = 'visits' | 'validOrders' | 'signedOrders' | 'spendUsd'
  | 'orderCpaUsd' | 'signedGrossPhp' | 'signedRoas' | 'conversionRate';
type TrendMetric = Exclude<PerformanceMetric, 'signedGrossPhp' | 'conversionRate'>;
interface PerformanceChange {
  state: 'COMPARABLE' | 'NEW' | 'UNCHANGED' | 'UNAVAILABLE';
  absolute: string | null;
  percent: string | null;
}
type PerformanceChanges = Record<PerformanceMetric, PerformanceChange>;
interface PerformancePeriodResult {
  range: PerformanceDateRange;
  registeredLinkCount: number;
  totals: PerformanceTotals | null;
}
interface PerformancePageInfo {
  id: string;
  name: string;
  slug: string;
  productId: string;
  productName: string;
  productCode: string;
  productStatus: string;
  ownerUserId: string | null;
  ownerName: string | null;
  aid: string | null;
  effectiveStatus: EffectivePageStatus;
  linkCount: number;
  createdAt: string;
}
interface PerformancePageRow extends PerformancePageInfo {
  pageTotalVisits: number;
  current: PerformancePeriodResult;
  previous: PerformancePeriodResult | null;
  changes: PerformanceChanges | null;
  notices: Array<'NO_LINKS' | 'NOT_STARTED' | 'NO_TRAFFIC' | 'COSTS_INCOMPLETE' | 'PARENT_INACTIVE'>;
}
interface PerformanceOverview {
  total: number;
  byStatus: Record<EffectivePageStatus, number>;
  byProduct: Array<{ productId: string; productName: string; productCode: string; pageCount: number }>;
}
interface PerformancePoint extends PerformanceBucket {
  registeredLinkCount: number;
  totals: PerformanceTotals | null;
}
interface MarketingPerformanceReport {
  asOf: string;
  scope: {
    view: PerformanceView;
    productId: string | null;
    ownerUserId: string | null;
    landingPageId: string | null;
    effectiveStatus: EffectivePageStatus | null;
    onlyOwn: boolean;
  };
  overview: PerformanceOverview;
  current: PerformancePeriodResult;
  previous: PerformancePeriodResult | null;
  changes: PerformanceChanges | null;
  page: number;
  pageSize: number;
  total: number;
  rows: PerformancePageRow[];
  trend: { pageId: string | null; interval: PerformanceInterval; points: PerformancePoint[] };
  otherSources: {
    current: Array<{ kind: 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; totals: PerformanceTotals }>;
    previous: Array<{ kind: 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; totals: PerformanceTotals }> | null;
  };
}
interface MarketingPerformanceOptions {
  onlyOwn: boolean;
  products: Array<{ id: string; name: string; productCode: string; status: string; pageCount: number }>;
  owners: Array<{ userId: string; name: string; aid: string | null; isActive: boolean; pageCount: number }>;
}
```

无该期间可用的落地页链接，totals=null，不用全零对象假扮表现。页面总访问仍可独立读取，不能填入投放访问。已有链接但没访问则已知计数为0；缺费用仍返回已录入合计，但标费用待补并隐藏成本／回报。有正费用而零签收时，signedRoas='0.00' 沿用原公式；不是把所有零订单场景的全部比率都变 null。

---

### Task 1: 严格查询与 Manila 时间／上期

**Files:**
- Create: backend/src/modules/marketing/dto/marketing-performance.dto.ts
- Create: backend/src/modules/marketing/dto/marketing-performance.dto.spec.ts
- Create: backend/src/modules/marketing/marketing-performance-period.ts
- Create: backend/src/modules/marketing/marketing-performance-period.spec.ts
- Create: backend/src/modules/marketing/marketing-performance.types.ts

**Interfaces:**
- Consumes: marketing-access.ts 的 MarketingAccount 类型；现有 manilaVisitDay(instant: Date): Date 可用于确定业务日。
- Produces: marketingPerformanceQuerySchema、marketingPerformanceOptionsQuerySchema；MarketingPerformanceQuery 为 schema 输出类型。
- Produces: resolvePerformanceWindow(query: MarketingPerformanceQuery, now: Date): PerformanceWindow。
- Produces: buildPerformanceBuckets(range: PerformanceDateRange, interval: PerformanceInterval, now: Date): PerformanceBucket[]。
- Produces: 上节后端类型；DTO 接收字符串 compare，前端 query 类型保持 boolean。

- [ ] **Step 1: 写日期与非法查询测试。** 使用 Date-only fake clock，不冻结 DB／网络计时器。新增文件尚不能导入时只补可加载的最小导出，不实现算法；加载错误不算 RED，必须继续到下面的行为断言失败。

```ts
const query = marketingPerformanceQuerySchema.parse({ view: 'PRODUCT', productId: '11111111-1111-4111-a111-111111111111', preset: 'THIS_WEEK' });
const window = resolvePerformanceWindow(query, new Date('2026-10-07T04:00:00Z'));
expect(window.current).toMatchObject({ from: '2026-10-05', to: '2026-10-07' });
expect(window.previous).toMatchObject({ from: '2026-09-28', to: '2026-09-30' });
expect(window.current.startAt.toISOString()).toBe('2026-10-04T16:00:00.000Z');
expect(window.current.endAt.toISOString()).toBe('2026-10-07T16:00:00.000Z');

expect(buildPerformanceBuckets({ from: '2026-09-30', to: '2026-10-07' }, 'WEEK', new Date('2026-10-07T04:00:00Z'))).toEqual([
  { key: '2026-09-28', from: '2026-09-30', to: '2026-10-04', partialWeek: true, includesToday: false },
  { key: '2026-10-05', from: '2026-10-05', to: '2026-10-07', partialWeek: true, includesToday: true },
]);
```

参数化测试另覆盖 LAST_7_DAYS、LAST_30_DAYS、LAST_WEEK、CUSTOM 等长上期，compare=0 的 previous=null、Manila 15:59:59Z／16:00:00Z、周一、闰年二月、跨年。对缺 productId、CUSTOM 缺日期、2月30日、倒序、未来、预设混入日期、非法 UUID、compare=yes、未知 sort、page=0、pageSize=101、未知字段断言 safeParse.success=false。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance-period.spec.ts src/modules/marketing/dto/marketing-performance.dto.spec.ts`

Expected: FAIL，实际范围／bucket 或 query 接受结果与上述断言不同；不得把语法或模块错误登记为 RED。

- [ ] **Step 3: 实现纯函数和 strict Zod DTO。** 字符串日期用 UTC 日算术，不用机器本地时区，不用 Intl 显示文本解析日期。

```ts
const DAY = 86_400_000;
const shift = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY).toISOString().slice(0, 10);
const monday = (day: string) => shift(day, -(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7);
const readRange = (from: string, to: string): PerformanceReadRange => ({
  from, to,
  startAt: new Date(`${from}T00:00:00+08:00`),
  endAt: new Date(`${shift(to, 1)}T00:00:00+08:00`),
});
```

resolvePerformanceWindow：Manila 今日取 now+8h 的 ISO 日；最近 N 日 from=today−(N−1)，本周 from=monday(today)，上周 from=monday(today)−7/to=monday(today)−1。CUSTOM 使用验证后的日期。本周上期直接 from/to 各减7；其他上期长度为 inclusive days，previous.to=current.from−1、previous.from=previous.to−(length−1)。bucket 周 key 为周一，实际 from/to 裁剪到请求范围；includesToday 单独标注，不把“7个日期齐全”误当今日已经结束。

DTO 导出所有固定 enum，compare 用 z.enum(['1','0']).default('1').transform(v=>v==='1')；用 superRefine 限制 PRODUCT／CUSTOM。日期验证使用真实日历往返校验；endAt 是 exclusive。

- [ ] **Step 4: 定向与后端裸 suite GREEN。**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance-period.spec.ts src/modules/marketing/dto/marketing-performance.dto.spec.ts`

Run: `pnpm --dir small-house-commerce/backend test`

Expected: 定向和裸 suite 退出0；默认 PostgreSQL skips 记录为 skips，不当通过。

- [ ] **Step 5: 记录本任务接口和 RED/GREEN 证据。** 不 commit。验收：所有范围在服务器可确定且周比较不拿3天比7天。

### Task 2: 共享原始指标与事实，保持旧报表不变

**Files:**
- Create: backend/src/modules/marketing/marketing-report-metrics.ts
- Create: backend/src/modules/marketing/marketing-report-metrics.spec.ts
- Create: backend/src/modules/marketing/marketing-report-facts.ts
- Modify: backend/src/modules/marketing/marketing-report.service.ts
- Modify: backend/src/modules/marketing/marketing-report.service.spec.ts
- Test: backend/src/modules/marketing/marketing-report.integration.spec.ts

**Interfaces:**
- Produces: MarketingReportRawRow（原 RawRow 全字段原样），serializeMarketingReportRow(row: MarketingReportRawRow): 原 report 行响应。
- Produces: serializeMarketingTotals(row: MarketingReportRawRow): PerformanceTotals；只从序列化结果挑固定指标字段，不带客户或目录 metadata。
- Produces: marketingOrderFactsSql(where: Prisma.Sql): Prisma.Sql，输出原 order_facts 字段并增加 cohortDay；verified source 用 touchedAt 的 Manila 日，UNVERIFIED 用 orderCreated 的 Manila 日。
- Produces: marketingOrderTotalsSql: Prisma.Sql，保持现有 f 别名和原计数／金额表达式。
- Produces: performanceChange(current: number|string|null, previous: number|string|null, precision: number): PerformanceChange。
- Consumes: Task 1 的 PerformanceTotals／PerformanceChange；旧 service.report(query, account) 签名不变。

- [ ] **Step 1: 钉住旧报告投影与新变化的测试。** 原报告测试先保持 GREEN：这是已有算法的提取，不为了凑 RED 改坏旧算法。新变化函数必须观察 RED。

```ts
expect(performanceChange('10.00', '0.00', 2)).toEqual({ state: 'NEW', absolute: '10.00', percent: null });
expect(performanceChange(0, 0, 0)).toEqual({ state: 'UNCHANGED', absolute: '0', percent: null });
expect(performanceChange('3.00', '2.00', 2)).toEqual({ state: 'COMPARABLE', absolute: '1.00', percent: '50.00' });
expect(performanceChange(null, '2.00', 2)).toEqual({ state: 'UNAVAILABLE', absolute: null, percent: null });
```

在原 service.spec 的 raw／setup 基础上保留以下完整行为断言：USD50、PHP2865、签收10000→CPA25.00／50.00、ROAS3.49；expected3/recorded2→四成本比率null但已录入金额保留；零费用→成本比率null；费用正且零签收→ROAS0.00；visits0→订单率null；UNVERIFIED→ORDER_CREATED；不泄漏 privatePhone。测试 shared totals 不返回 id/name/phone，原响应仍返回原 metadata。

- [ ] **Step 2: 运行基线与新函数 RED。**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-report.service.spec.ts src/modules/marketing/marketing-report-metrics.spec.ts`

Expected: 旧 report 行为 GREEN，新 change 断言 RED；导入错误先修成可运行断言，不冒称算法回归。

- [ ] **Step 3: 只提取，不重写。** 把原 countFields、ratio、serialize 移入共享文件；旧 service 改调用 serializeMarketingReportRow。把 order_facts SELECT 与 totals SQL 移入 facts 文件，WHERE 仍由调用方参数化传入，旧 service 的来源范围和 PAGE 的 PRODUCT fallback 保留。

```ts
export function performanceChange(current: number | string | null, previous: number | string | null, precision: number): PerformanceChange {
  if (current === null || previous === null) return { state: 'UNAVAILABLE', absolute: null, percent: null };
  const now = new Prisma.Decimal(current);
  const before = new Prisma.Decimal(previous);
  const absolute = now.minus(before).toFixed(precision, Prisma.Decimal.ROUND_HALF_UP);
  if (before.isZero()) return { state: now.isZero() ? 'UNCHANGED' : 'NEW', absolute, percent: null };
  return { state: 'COMPARABLE', absolute, percent: now.minus(before).div(before).mul(100).toFixed(2, Prisma.Decimal.ROUND_HALF_UP) };
}
```

新 SQL 不重新 join shipment 多行：复用原 EXISTS/NOT EXISTS 签收事实，避免箱数放大订单数。cohortDay 只供新聚合，不改变 attribution、订单或旧报告。

- [ ] **Step 4: 旧接口与真实 PG GREEN。**

Run: `pnpm --dir small-house-commerce/backend test`

Run: `MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-report.integration.spec.ts`

Expected: 全部退出0；旧字段、费用覆盖、其他来源、触达日期及签收事实不变。

- [ ] **Step 5: 记录纯提取范围和新 change RED/GREEN。** 不加入兼容 re-export 或通用公式引擎，不 commit。

### Task 3: 全页面只读 performance、批量趋势与权限

**Files:**
- Create: backend/src/modules/marketing/marketing-performance.sql.ts
- Create: backend/src/modules/marketing/marketing-performance.service.ts
- Create: backend/src/modules/marketing/marketing-performance.service.spec.ts
- Create: backend/src/modules/marketing/marketing-performance.integration.spec.ts
- Create: backend/src/modules/marketing/admin/marketing-performance.controller.ts
- Create: backend/src/modules/marketing/admin/marketing-performance.controller.spec.ts
- Modify: backend/src/modules/catalog/catalog.module.ts
- Modify: backend/src/modules/marketing/marketing-performance.types.ts（补内部 SQL 结果类型，不改公开协议）

**Interfaces:**
- Consumes: resolvePerformanceWindow、buildPerformanceBuckets、serializeMarketingReportRow、serializeMarketingTotals、marketingOrderFactsSql、marketingOrderTotalsSql、performanceChange。
- Consumes: scopeFor(account)、assertVisible(scope, ownerId)、effectiveStatus(page, now)。
- Produces: MarketingPerformanceService.performance(query: MarketingPerformanceQuery, account: MarketingAccount): Promise<MarketingPerformanceReport>。
- Produces: MarketingPerformanceService.options(query: MarketingPerformanceOptionsQuery, account: MarketingAccount): Promise<MarketingPerformanceOptions>。
- Produces: loadPerformanceAggregate(tx: Prisma.TransactionClient, scope: PerformanceSqlScope, range: PerformanceReadRange, level: 'PAGE'|'TOTAL'|'DAY'|'WEEK'): Promise<PerformanceAggregateRow[]>。
- Internal: PerformanceSqlScope={all:boolean;actorUserId:string;ownerUserId:string|null;productId:string|null;landingPageId:string|null;effectiveStatus:EffectivePageStatus|null;asOf:Date}。
- Internal: PerformanceAggregateRow={key:string;registeredLinkCount:bigint;from:string|null;to:string|null;raw:MarketingReportRawRow}；raw 是已聚合字段，不含逐访问/客户数据。
- Internal: loadPerformancePages(tx, scope): Promise<PerformancePageInfo[]>；loadPerformancePageVisits(tx, scope, range): Promise<Array<{pageId:string;visits:bigint}>>；loadPerformanceOtherSources(tx, scope, range): Promise<MarketingReportRawRow[]>。
- Produces: GET /api/v1/admin/marketing/performance、GET /api/v1/admin/marketing/performance/options；只有 GET，没有新写路由。

- [ ] **Step 1: 写真实专库 fixture 与语义测试。** 复用原 marketing-report.integration.spec.ts 的 PrismaService/ConfigService、UUID tag、专库硬闸和精确 teardown 模式，不共享其私有函数或把 helper 放入 production service。beforeAll 创建两个用户、一个 category、两个 product；第一页商品上放 own 两页、other 一页、own 未建链接草稿、own 停用页，第二商品放 own 一页。为有链接页各建 CampaignLink；多链接页建两条；另建 landingPageId=null 的直接商品链接。

```ts
const own = { id: ownerId, permissions: ['MARKETING_VIEW_OWN'] };
const allRead = { id: financeId, permissions: ['MARKETING_VIEW_ALL'] };
const request = marketingPerformanceQuerySchema.parse({ view: 'PRODUCT', productId, preset: 'CUSTOM', from: '2026-10-05', to: '2026-10-07', pageSize: '2' });
for (const linkId of [linkA1.id, linkA2.id, linkA3.id, linkB.id]) {
  await prisma.campaignLinkVisit.create({ data: { linkId, visitKey: `same-${tag}`, visitDay: new Date('2026-10-05T00:00:00Z') } });
}
const result = await service.performance(request, allRead);
expect(result.overview.total).toBe(5);
expect(result.rows).toHaveLength(2);
expect(result.current.totals?.visits).toBe(1);
expect(result.trend.points[0].totals?.visits).toBe(1);
const second = await service.performance({ ...request, page: 2 }, allRead);
expect(second.current).toEqual(result.current);
expect(second.trend).toEqual(result.trend);
const ownResult = await service.performance({ ...request, pageSize: 100 }, own);
expect(ownResult.rows.every(row => row.ownerUserId === ownerId)).toBe(true);
expect(ownResult.rows.find(row => row.id === noLinkPage.id)?.current.totals).toBeNull();
expect(ownResult.rows.find(row => row.id === noLinkPage.id)?.notices).toContain('NO_LINKS');
await expect(service.performance({ ...request, trendPageId: otherPage.id }, own)).rejects.toMatchObject({ status: 404 });
```

fixture 的 tag、ownerId/financeId/productId、pages 与 links 都在本 spec 的 beforeAll 创建并保存 ID；链接 createdAt 为2026-10-04T16:00Z，页面 createdAt 更早，Date-only clock 固定2026-10-13T01:00Z。没有 fee 的上述访问测试应显示 COSTS_INCOMPLETE，而不是可计算 ROI。

另写具体 fixture/断言矩阵：

| 输入 | 断言 |
| --- | --- |
| 每页同日多链接同 key，第二天同 key | 每页各日去重；总范围2次，不求页面行和 |
| direct product link 有大量 visit/cost/order | performance 总计与趋势不变；原 LINK report 仍可读 |
| 页面／链接都在 range.to 后创建 | 页面行保留、current.totals=null、NOT_STARTED；旧期间不伪造0 |
| 本期未建链接但有 landingPageVisit | paid totals=null；pageTotalVisits 为独立真实值 |
| 一页3链接仅2条费用 | 已录入总额保留、coverage=false、CPA/ROAS=null |
| 完整费用含显式0；另组金额0.10+0.20 | complete=true 与缺失区分，0费用成本比率null，Decimal总额0.30 |
| 一周100/1单与另一日10/10单 | 周CPA=110/11=10.00，不平均100与1 |
| 全单有两箱：SIGNED+无signedAt／另一箱未签 | signedOrders=0；全部真实签后=1，整单毛额只计一次 |
| 下单晚于触达、签收再晚于查询结束 | 仍归原触达bucket，观察截至时间存在 |
| DIRECT／LEGACY／UNVERIFIED | otherSources独立、主ROAS不变，UNVERIFIED basis=ORDER_CREATED |
| owner 伪造、同商品他人页面、别商品 trendPage、已排除状态页 | 404且不返回该页名称或数据 |
| VIEW_ALL 无 manage、OPTIMIZER 未选人员 | 可以读；缺选择400；原写接口仍403 |
| 历史停用优化师与下架商品 | options可选择历史；不恢复账户，不让创建picker接受它们 |
| 未分配页面 | all PRODUCT可见；own不可见；不猜进某人总览 |
| name相同、指标为2.00/10.00/null | Decimal排序正确，null永远最后，ID做稳定tie-break |

订单、费用和签收 fixture 使用当前 Prisma model 的真实 required 字段，沿用原 report integration 已有订单/费用构造；不用 SQL 猜字段名、不调用假 service。cleanup 只删除新 tag 对应的 audits→costs→visits→links、订单/attribution/shipments、页面访问→页面→新 product 等 FK 顺序，不依赖 visited-page Cascade，不清空表。

- [ ] **Step 2: 专库 RED与 controller测试。**

Run: `MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance.integration.spec.ts`

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance.service.spec.ts src/modules/marketing/admin/marketing-performance.controller.spec.ts`

Expected: 聚合/目录/权限行为断言 FAIL；controller 测试确认 guard、Zod pipe、CurrentMarketingAccount 和 private/no-store header，不是只测一个 mock 返回值。

- [ ] **Step 3: 实现基础 scope与两接口接线。**

```ts
@Controller('admin/marketing/performance')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class MarketingPerformanceController {
  constructor(@Inject(MarketingPerformanceService) private readonly performanceService: MarketingPerformanceService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  performance(@Query(new ZodValidationPipe(marketingPerformanceQuerySchema)) query: MarketingPerformanceQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.performanceService.performance(query, account);
  }

  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(@Query(new ZodValidationPipe(marketingPerformanceOptionsQuerySchema)) query: MarketingPerformanceOptionsQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.performanceService.options(query, account);
  }
}
```

在 CatalogModule 注册新类。scopeFor首先执行；传 owner 时 assertVisible；own 强制 account.id。all OPTIMIZER必须明确选人。验证人员存在，历史停用可读。页面验证先用actor基础范围，再用当前视角／过滤条件；不能用前端声明的owner。

- [ ] **Step 4: 实现批量 SQL。** scoped_pages 基础目录按当前权限／商品／人员过滤，effectiveStatus 使用与 effectiveStatus(page,asOf)一致的 DRAFT、DISABLED、未来start、过去end、LIVE语义；mother status另行显示 PARENT_INACTIVE，不把它混成数据库page.status。

```sql
WITH scoped_pages AS (
  SELECT p.id, p.product_id, p.owner_user_id
  FROM product_landing_pages p
  WHERE ($1::boolean OR p.owner_user_id = $2::uuid)
    AND ($3::uuid IS NULL OR p.owner_user_id = $3::uuid)
    AND ($4::uuid IS NULL OR p.product_id = $4::uuid)
    AND ($5::uuid IS NULL OR p.id = $5::uuid)
    AND ($6::text IS NULL OR CASE
      WHEN p.status = 'DRAFT' THEN 'DRAFT'
      WHEN p.status = 'DISABLED' THEN 'DISABLED'
      WHEN p.start_at > $7::timestamptz THEN 'SCHEDULED'
      WHEN p.end_at < $7::timestamptz THEN 'ENDED'
      ELSE 'LIVE' END = $6::text)
), scoped_links AS (
  SELECT l.id, l.product_id, l.landing_page_id, l.owner_user_id, l.created_at
  FROM campaign_links l
  JOIN scoped_pages p ON p.id = l.landing_page_id AND p.product_id = l.product_id
  WHERE l.landing_page_id IS NOT NULL
    AND ($1::boolean OR l.owner_user_id = $2::uuid)
    AND ($3::uuid IS NULL OR l.owner_user_id = $3::uuid)
    AND l.created_at < $10::timestamptz
)
SELECT COUNT(DISTINCT (v.visit_key, v.visit_day)) AS visits
FROM campaign_link_visits v JOIN scoped_links l ON l.id = v.link_id
WHERE v.visit_day BETWEEN $8::date AND $9::date;
```

参数依次为 all、actorUserId、已解析owner、productId、landingPageId、effectiveStatus、asOf、range.from、range.to、range.endAt；实际实现用Prisma.sql绑定，不拼接这些值。费用使用当前AdCostEntry的amount_usd/amount_php、cost_date、voided_at。完整聚合分开 visits、landing page visits、costs、coverage、order_facts，再 LEFT JOIN聚合结果，禁止把逐费用、访问、shipment直接大 join 导致乘法。

PAGE按稳定pageID分组；TOTAL按整个scoped_links重做DISTINCT；DAY按业务date；WEEK按周一key和实际from/to。费用覆盖沿旧规则：每link从 max(range.from, Manila createdAt日)到range.to，一日一条未void记录；不凭当前link/page状态删除历史费用。order_facts REGISTERED join有效scope链接，immutable owner过滤，不从page当前owner补猜历史。其他来源单独按product／已知page／历史owner范围查询，不能把无法确定页面的订单塞进单页；UNVERIFIED不进主趋势。

sql层只返回聚合行，结果量为页面数或bucket数，不把原始visit_key清单带到JS。TOTAL中的pageTotalVisits也独立从scoped_pages对应的landing_page_visits计算COUNT(DISTINCT(visit_key,visit_day))，不能求pageVisits数组的行和；它在界面只作为页面范围总访问，不冒充优化师历史归属。固定少量查询，页数变50不变成50次report调用。字符串日期、ID均参数绑定，group/sort只来自白名单。

- [ ] **Step 5: 同快照组装、排序和分页。**

```ts
return this.prisma.$transaction(async tx => {
  const pages = await loadPerformancePages(tx, sqlScope);
  const currentPages = await loadPerformanceAggregate(tx, sqlScope, window.current, 'PAGE');
  const currentTotal = await loadPerformanceAggregate(tx, sqlScope, window.current, 'TOTAL');
  const trendScope = query.trendPageId ? { ...sqlScope, landingPageId: query.trendPageId } : sqlScope;
  const trendRows = await loadPerformanceAggregate(tx, trendScope, window.current, query.interval);
  const previousPages = window.previous ? await loadPerformanceAggregate(tx, sqlScope, window.previous, 'PAGE') : [];
  const previousTotal = window.previous ? await loadPerformanceAggregate(tx, sqlScope, window.previous, 'TOTAL') : [];
  const pageVisits = await loadPerformancePageVisits(tx, sqlScope, window.current);
  const currentOther = await loadPerformanceOtherSources(tx, sqlScope, window.current);
  const previousOther = window.previous ? await loadPerformanceOtherSources(tx, sqlScope, window.previous) : [];
  return assemblePerformanceReport({ query, sqlScope, window, pages, currentPages, currentTotal, trendRows, previousPages, previousTotal, pageVisits, currentOther, previousOther });
}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
```

assemblePerformanceReport 是 service文件内纯函数，其单个参数的字段类型分别就是该步骤变量类型，返回 MarketingPerformanceReport；实现时导出给 service.spec 测试，不建通用builder。以 pages为目录 left map raw：无period links→totals=null；有links的缺日计数0、比率照共享公式。buildPerformanceBuckets补齐趋势日期；未开始投放的bucket totals=null。changes以总分子分母产生的指标为输入；spendUsd不完整时变化为UNAVAILABLE，但已录入USD仍显示。overview/byProduct、summary、trend、otherSources在分页前生成；只rows排序slice。null最后与sortDirection无关，相同值按id稳定排序；Decimal字段不能按字符串排序。

所有读取 await顺序执行，不能同一个pg transaction client Promise.all并发发query。asOf统一取请求开始的now，当前和上期使用相同snapshot。options同样只读、同scope，返回无客户资料的商品／人员。

- [ ] **Step 6: 完整后端与专库GREEN。**

Run: `pnpm --dir small-house-commerce/backend test`

Run: `MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance.integration.spec.ts src/modules/marketing/marketing-report.integration.spec.ts src/modules/marketing/marketing-touch.integration.spec.ts src/modules/marketing/ad-costs.integration.spec.ts src/modules/catalog/landing/landing-workbench.integration.spec.ts`

Run: `pnpm --dir small-house-commerce/backend exec tsc --noEmit`

Expected: 全部退出0；真实PG不skip；旧接口指标与业务仍通过，新增接口无写入。

- [ ] **Step 7: 记录scope、聚合查询次数、专库和JSON无客户字段证据。** 不 commit，不 migrate／generate。

### Task 4: 前端类型、认证请求与过期响应隔离

**Files:**
- Modify: frontend/src/lib/marketing-api.ts
- Modify: frontend/src/lib/marketing-api.spec.ts
- Create: frontend/src/components/admin/marketing/useMarketingPerformance.ts
- Create: frontend/src/components/admin/marketing/useMarketingPerformance.spec.tsx

**Interfaces:**
- Consumes: Task 3 的两个GET和固定响应；useAdminAuth(): 现有 admin/status；adminAuthedFetch、queryString。
- Produces: marketingApi.performance(query: MarketingPerformanceQuery): Promise<MarketingPerformanceReport>。
- Produces: marketingApi.performanceOptions(query?: MarketingPerformanceOptionsQuery): Promise<MarketingPerformanceOptions>。
- Produces: useMarketingPerformance(query: MarketingPerformanceQuery|null): { report: MarketingPerformanceReport|null; options: MarketingPerformanceOptions|null; loading:boolean; error:string|null; optionsError:string|null; reload:()=>void }。
- query=null仅禁用report，options仍按actor权限读取；all的OPTIMIZER未选owner时使用null，不猜第一位人员。

- [ ] **Step 1: 写真实API契约测试及 deferred response测试。** API测试复用现有adminAuthedFetch边界，只mock网络；Hook测试mock API外部边界，不能mock hook自身。

```ts
await marketingApi.performance({ view: 'PRODUCT', productId: 'product-1', preset: 'LAST_7_DAYS', interval: 'DAY', compare: true, sortBy: 'name', sortDirection: 'asc', page: 1, pageSize: 20 });
expect(vi.mocked(adminAuthedFetch).mock.calls[0][0]).toContain('/api/v1/admin/marketing/performance?');
expect(vi.mocked(adminAuthedFetch).mock.calls[0][0]).toContain('compare=1');
expect(vi.mocked(adminAuthedFetch).mock.calls[0][1]).toMatchObject({ cache: 'no-store', referrerPolicy: 'no-referrer' });
```

使用marketing-api.spec.ts已存在的adminAuthedFetch mock；不另造全局fetchMock或第二套fake认证。

```ts
const { result, rerender } = renderHook(({ query }) => useMarketingPerformance(query), { initialProps: { query: productAQuery } });
rerender({ query: productBQuery });
await act(async () => { resolveB(productBReport); });
expect(result.current.report?.scope.productId).toBe(productBQuery.productId);
await act(async () => { resolveA(productAReport); });
expect(result.current.report?.scope.productId).toBe(productBQuery.productId);
```

productAQuery/BQuery使用固定完整query；report为固定协议的A/B合法对象；resolveA/B为两个Promise的resolver。另测actor/permissions变化立即清旧report/options、语言变化不reset、失败显示error而非零对象、retry重取当前scope、同请求完成后旧finally不能清新loading。

- [ ] **Step 2: 运行RED。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/marketing-api.spec.ts src/components/admin/marketing/useMarketingPerformance.spec.tsx`

Expected: 缺API或过期结果覆盖／错误状态断言FAIL，不把测试工具报错算RED。

- [ ] **Step 3: 接入认证API与scope。**

```ts
performance: (query: MarketingPerformanceQuery) => adminAuthedFetch<MarketingPerformanceReport>(
  `/api/v1/admin/marketing/performance${queryString({ ...query, compare: query.compare ? '1' : '0' })}`,
  { cache: 'no-store', referrerPolicy: 'no-referrer' },
),
performanceOptions: (query: MarketingPerformanceOptionsQuery = {}) => adminAuthedFetch<MarketingPerformanceOptions>(
  `/api/v1/admin/marketing/performance/options${queryString(query)}`,
  { cache: 'no-store', referrerPolicy: 'no-referrer' },
),
```

hook key=JSON.stringify([admin.id,admin.permissions,query])；options另绑actor/permissions key。effect cleanup取消结果归属，不要求改变现有request helper以支持AbortSignal。render只暴露stored.key===current.key的结果；pending/error也绑key；ref保存request object identity，finally只有当前request可结束loading。locale不进请求scope，也不重置filters。API types从原MarketingReportRow挑totals字段，新增目录／趋势类型在同一文件声明，与后端协议逐字段核验。

- [ ] **Step 4: 前端定向与裸suite GREEN。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/marketing-api.spec.ts src/components/admin/marketing/useMarketingPerformance.spec.tsx`

Run: `pnpm --dir small-house-commerce/frontend test`

Expected: 全部退出0，旧上传／页面／链接／费用／report URL与认证测试仍通过。

- [ ] **Step 5: 记录API shape和race回归。** 不新增全局状态库，不把token存储协议改掉，不 commit。

### Task 5: 四步编辑器、版本提示与业务导航

**Files:**
- Create: frontend/src/components/admin/marketing/MarketingWorkspaceNav.tsx
- Create: frontend/src/components/admin/marketing/MarketingWorkspaceNav.spec.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPageEdit.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPageEdit.spec.tsx
- Modify: frontend/src/components/admin/marketing/PublishBar.tsx
- Modify: frontend/src/components/admin/marketing/MarketingCanvas.tsx
- Modify: frontend/src/components/admin/marketing/MarketingCanvas.spec.tsx
- Modify: frontend/src/components/admin/marketing/MarketingWorkbench.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPagesList.tsx
- Modify: frontend/src/components/admin/marketing/WorkbenchRoutes.spec.tsx
- Modify: frontend/src/i18n/zh.ts、frontend/src/i18n/en.ts

**Interfaces:**
- Consumes: 现有 Editing对象、scopeKey、operation request identity、mutate/save/publish/disable、onUploadingChange、SyncFromProductDialog。
- Consumes: PublishBar既有 page/canManage/busy/unsaved/canPublish/onSave/onPublish/onDisable；保持props语义。
- Produces: MarketingWorkspaceNav({ active:'pages'|'compare'|'optimizers', productId?:string, unsaved?:boolean }): React.JSX.Element。
- Produces: MarketingPageEdit内 step='CONTENT'|'PUBLISH'|'LINKS'|'PERFORMANCE'；状态只负责显示，不承载新的保存逻辑。
- Produces: 第4步的预留挂载位置；Task 6用完整Dashboard替换原该页ReportTable，不先发明第二套指标。

- [ ] **Step 1: 用现有完整editor fixture写四步语义RED。**

```tsx
mount();
await screen.findByText('LUW-001');
fireEvent.change(screen.getByLabelText('内部名称'), { target: { value: 'Space-saving chair campaign' } });
fireEvent.click(screen.getByRole('button', { name: 'Edit again' }));
fireEvent.click(screen.getByRole('button', { name: '2 预览发布' }));
expect(screen.getByText('本地有未保存修改')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '更新线上版本' })).toBeDisabled();
fireEvent.click(screen.getByRole('button', { name: '3 投放链接' }));
fireEvent.click(screen.getByRole('button', { name: '1 编辑内容' }));
expect(screen.getByLabelText('内部名称')).toHaveValue('Space-saving chair campaign');
expect(screen.getByTestId('editor-document')).toHaveTextContent('Second draft');
expect(marketingApi.saveDraft).not.toHaveBeenCalled();
expect(marketingApi.publish).not.toHaveBeenCalled();
expect(marketingApi.getPage).toHaveBeenCalledTimes(1);
```

RTL不使用Playwright的exact选项。现有settings()改为进入第1步后展开“更多设置”；所有旧CAS、HTML、scope、上传、Disable、locale测试继续保留原断言，只更新真实入口选择器。上传测试断言切步按钮disabled，并显示“上传中，请完成后切换”；complete后可切换。另断言saved preview不包含local输入、保存不改published、LIVE+pending draft文案不说整个页面未发布；只读能浏览，不能save/publish/create。

- [ ] **Step 2: 运行RED。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/MarketingPageEdit.spec.tsx src/components/admin/marketing/MarketingCanvas.spec.tsx src/components/admin/marketing/MarketingWorkspaceNav.spec.tsx src/components/admin/marketing/WorkbenchRoutes.spec.tsx`

Expected: 四步／业务提示不存在等用户行为断言FAIL；不删旧断言换绿。

- [ ] **Step 3: 改显示结构，保留协议。**

```tsx
const steps = [
  { id: 'CONTENT', label: t('marketing_step_content') },
  { id: 'PUBLISH', label: t('marketing_step_publish') },
  { id: 'LINKS', label: t('marketing_step_links') },
  { id: 'PERFORMANCE', label: t('marketing_step_performance') },
] as const;
<nav aria-label={t('marketing_steps')}>
  {steps.map((item, index) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined} disabled={locked} onClick={() => setStep(item.id)}>{index + 1} {item.label}</button>)}
</nav>
```

名称前置到第1步，SEO/start/end放原同一content的“更多设置”。第2步解释local／saved draft／published，分别提供已保存草稿和公开版本入口；发布仍受unsaved、upload、母商品和原预览准备条件约束。固定内部预览说明为“不计访问、不下单；顾客看到已发布版本”。第3步直接复用 CampaignLinksList的page/product绑定；没有link显示下一步，SCHEDULED显示生效时间，历史链接仍可读，Disable不假装停止平台广告。

切步只setStep；upload或mutation期间禁切步，避免unmount uploader后释放父锁；完成后回第1步直接用父Editing raw文档，不getPage重载。语言不属于scope，不重置step。Disable保持原仅更新page而保留name/content的分支。

Puck字典改为“添加模块／调整顺序／选中模块设置”，空选择指引放画布外的固定短说明；若用Puck override显示fields空态，先检查0.23安装版类型，只用真实slot，不猜API。保留390/1200、height=100%、raw fieldTransform、validatedProjection、inert和media hook。真实browser验证select、重排、手机最后字段。

三入口置于MarketingWorkbench和editor内；不增加全局provider。离开脏editor导航用现有discard confirm阻止误丢，内部切步不询问丢弃。旧links/costs/reports路由仍能直接访问，通过辅助入口进入，不重定向带linkId的报告到无法等价的新视图。列表主要动作“编辑页面／查看效果”，保留有权限的归属指定和原创建dialog。

- [ ] **Step 4: 前端suite与类型GREEN。**

Run: `pnpm --dir small-house-commerce/frontend test`

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Expected: 退出0；旧版本锁、raw验证、上传晚返回、Disable输入、scope和语言测试仍通过。

- [ ] **Step 5: 记录流程状态与所有保留回归。** 不改content schema，不 commit。

### Task 6: 商品比较与优化师全部页面总览

**Files:**
- Create: frontend/src/components/admin/marketing/PerformanceFilters.tsx
- Create: frontend/src/components/admin/marketing/PerformanceSummary.tsx
- Create: frontend/src/components/admin/marketing/PerformancePageTable.tsx
- Create: frontend/src/components/admin/marketing/MarketingPerformanceDashboard.tsx
- Create: frontend/src/components/admin/marketing/MarketingPerformanceDashboard.spec.tsx
- Create: frontend/src/components/admin/marketing/PerformancePageTable.spec.tsx
- Create: frontend/src/app/admin/(shell)/marketing/compare/page.tsx
- Create: frontend/src/app/admin/(shell)/marketing/optimizers/page.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPageEdit.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPageEdit.spec.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPagesList.tsx
- Modify: frontend/src/components/admin/marketing/WorkbenchRoutes.spec.tsx
- Modify: frontend/src/i18n/zh.ts、frontend/src/i18n/en.ts

**Interfaces:**
- Consumes: useMarketingPerformance、MarketingPerformanceQuery/Report/Options、MarketingWorkspaceNav。
- Produces: MarketingPerformanceDashboard({view:PerformanceView;productId?:string;ownerUserId?:string;landingPageId?:string;initialDates?:{preset:PerformancePreset;from?:string;to?:string};embedded?:boolean}): React.JSX.Element。
- Produces: PerformanceFilters({query,onChange,options,onlyOwn,loading}: {query:MarketingPerformanceQuery;onChange:(next:MarketingPerformanceQuery)=>void;options:MarketingPerformanceOptions;onlyOwn:boolean;loading:boolean}): React.JSX.Element。
- Produces: PerformanceSummary({report:MarketingPerformanceReport}): React.JSX.Element。
- Produces: PerformancePageTable({report:MarketingPerformanceReport;groupByProduct:boolean;onTrendPage:(id:string)=>void}): React.JSX.Element。
- Row详情链接明细复用CampaignLinksList，写按钮按assertManage等价前端canManage判断；后端仍是最终权限闸。

- [ ] **Step 1: 写真实组件用户测试。** API外部边界返回符合协议的报告；不mock Dashboard内部summary/table。

```tsx
render(<AdminI18nProvider><MarketingPerformanceDashboard view="PRODUCT" productId="product-1" /></AdminI18nProvider>);
await screen.findByRole('heading', { name: '商品页面对比' });
expect(await screen.findByText('省空间视频页')).toBeInTheDocument();
expect(screen.getByText('待制作草稿')).toBeInTheDocument();
expect(screen.getByText('未建立投放链接')).toBeInTheDocument();
expect(screen.getByLabelText('全部筛选的投放访问')).toHaveTextContent('100');
expect(screen.getByLabelText('全部筛选的投放访问')).not.toHaveTextContent('20');
fireEvent.click(screen.getByRole('button', { name: '下一页' }));
await waitFor(() => expect(marketingApi.performance).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
```

fixture报告总访问100、当前页行访问合计20，另页有草稿／停用／NOT_STARTED／费用待补；测试选择page2后汇总与趋势不因分页变动。own OPTIMIZER隐藏人员选择并请求本人；all未选时展示“选择优化师”，选停用历史人员后可读但无新建／编辑权限。不同商品同名页面用id关联，不合并；null owner显示“未分配”且不会出现在own总览。请求失败显示retry，不显示“0订单”。慢B/快A及降权不显示旧owner名。locale切换保留商品、日期、排序、page和展开状态。

- [ ] **Step 2: 运行RED。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/MarketingPerformanceDashboard.spec.tsx src/components/admin/marketing/PerformancePageTable.spec.tsx src/components/admin/marketing/WorkbenchRoutes.spec.tsx`

Expected: 视图／选择／全量摘要／空值／权限行为FAIL，而非fixture缺字段。

- [ ] **Step 3: 组装两个业务入口。** PRODUCT先选择options里的商品，默认最近7天；OPTIMIZER own本人/all明确选人。筛选只传query，日期和上期实际范围只显示server response；避免前端再算一套。actor或权限scope变化时清除旧owner、单页和趋势选择，再按新options校正商品；own请求不发送从旧all状态遗留的owner ID，也不显示其名称。filter变化page重置1，商品/owner/status/单页变化trendPageId清空；分页只改page，不清全量趋势。

```tsx
<PerformanceSummary report={report} />
<PerformancePageTable report={report} groupByProduct={query.view === 'OPTIMIZER'} onTrendPage={id => setQuery(current => ({ ...current, trendPageId: id }))} />
```

主要列为页面/负责人、访问、有效订单、订单率、已录入USD、每单USD、签收ROAS；状态和数据状态用文案，细项折叠。不返回无限比率、不按红绿自动宣判赢家。页组标题数量取overview.byProduct的pageCount，不取本页rows.length；分组跨分页明确“本页显示N／该商品共M”，不能把当前页假称全部。移动端卡片保留相同信息和详情、趋势按钮，不要求横向宽表。详情显示PHP和其他来源但不进入主ROI。

第4步使用 view=PRODUCT、productId=page.productId、landingPageId=page.id、embedded=true：summary只属于本页。费用展开复用AdCostsList；提供带product/owner/date范围的商品对比／优化师总览Link。未分配页面不编owner参数，all到总览显示chooser。当前名称与状态不能与其他页混淆。

新route保持metadata robots noindex/nofollow，await Next16 searchParams；只解析白名单product/owner/preset/from/to。语言文案完整zh/en：未投放／未开始／无访问／费用待补分开；readonly不给制造可操作按钮。

- [ ] **Step 4: 前端suite／typesGREEN。**

Run: `pnpm --dir small-house-commerce/frontend test`

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Expected: 退出0，旧独立links/costs/reports及legacy routes仍正常。

- [ ] **Step 5: 记录单页／商品／人员三个scope与分页证据。** 不算前端金融指标，不 commit。

### Task 7: 现成趋势图、等价表格与上期说明

**Files:**
- Create: frontend/src/components/admin/marketing/PerformanceTrend.tsx
- Create: frontend/src/components/admin/marketing/PerformanceTrendChart.tsx
- Create: frontend/src/components/admin/marketing/PerformanceTrend.spec.tsx
- Modify: frontend/src/components/admin/marketing/MarketingPerformanceDashboard.tsx
- Modify: frontend/src/components/admin/marketing/PerformanceSummary.tsx
- Modify: frontend/src/i18n/zh.ts、frontend/src/i18n/en.ts
- Modify: frontend/package.json、frontend/pnpm-lock.yaml

**Interfaces:**
- Consumes: report.trend.points、current/previous.range、changes、asOf，所有比率均由后台提供。
- Produces: PerformanceTrend({report:MarketingPerformanceReport;onInterval:(interval:PerformanceInterval)=>void;onClearPage:()=>void}): React.JSX.Element。
- Produces: PerformanceTrendChart({points:Array<{key:string;label:string;value:number|null}>;unit:string}): React.JSX.Element。
- Produces: trendValue(point:PerformancePoint, metric:TrendMetric): number|null，定义在PerformanceTrend.tsx并导出给测试；只选绘图数值，不计算CPA/ROAS。

- [ ] **Step 1: 写图表旁的真实表格测试与unknown expense RED。**

```ts
expect(trendValue(incompleteCostPoint, 'spendUsd')).toBeNull();
expect(trendValue(explicitZeroCostPoint, 'spendUsd')).toBe(0);
expect(trendValue(noLinkPoint, 'visits')).toBeNull();
expect(trendValue(knownEmptyDay, 'visits')).toBe(0);
expect(trendValue(knownEmptyDay, 'orderCpaUsd')).toBeNull();
```

fixtures用完整PerformancePoint：incomplete totals.spendUsd='10.00'/costCoverageComplete=false；zero同coverage=true/recorded>0/spend='0.00'；noLink totals=null；knownEmptyDay有link、visits0。渲染真实PerformanceTrend表格，断言周点日期2026-09-30～10-04、10-05～10-07，不完整周／今日提示、日期排序、null显示—／费用待补，已录入部分金额显示但图上unknown不画0。切指标不改变费用或请求范围；日周只改interval。上期0→“新增／无可比基数”，费用不完整变化→“不可比较”；只显示增减，不把成本上升标胜出。

- [ ] **Step 2: 运行RED后添加依赖。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/marketing/PerformanceTrend.spec.tsx`

Expected: 未实现value/table/比较提示的语义断言FAIL。

Run: `pnpm --dir small-house-commerce/frontend add --save-exact recharts@3.10.1 react-is@19.2.8`

Expected: 成功、peer匹配React19.2.8，框架与Puck版本不变。若pnpm安全等待或registry失败，诊断等待规则，不关闭安全配置；不可改装未经核验版本来绕过。

已核验：Recharts3.10.1支持React19、Node≥18；ResponsiveContainer依赖ResizeObserver和父容器尺寸；Line connectNulls默认false，isAnimationActive可false。实施仍检查安装后的types、peer与Next构建，不仅相信npm元数据。

- [ ] **Step 3: 实现client-only单指标图。**

```tsx
const Chart = dynamic(() => import('./PerformanceTrendChart'), { ssr: false });

function PerformanceTrendChart({ points, unit }: { points: Array<{ key: string; label: string; value: number | null }>; unit: string }) {
  return <div className="h-64 min-w-0" aria-label={unit}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={points} accessibilityLayer>
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Line type="linear" dataKey="value" connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
```

Chart文件顶部'use client'，default export；dynamic在PerformanceTrend client组件内，不能把ssr:false放Server Component。父容器固定实际height，无全局ResizeObserver修改。六指标分别为visits/validOrders/signedOrders/spendUsd/orderCpaUsd/signedRoas，不混量纲。Number只用于绘图投影，表格保留backend精确字符串；unknown fees points用null，已录入部分金额仍在表格说明。所有值null时给出无可绘制数据原因，仍保留日期表，不伪造折线。等价表格始终可键盘读取，不把图表hover当唯一入口。

比较cards用后端changes和实际current/previous范围。展示asOf、今日不完整、近期转化/签收仍可能发生；上期比较关闭时不残留旧变化。client bundle隔离图表，编辑页第1步和页面管理不必预加载Recharts。

- [ ] **Step 4: 前端suite、peer、类型GREEN。**

Run: `pnpm --dir small-house-commerce/frontend test`

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Run: `pnpm --dir small-house-commerce/frontend list react react-dom react-is recharts --depth 0`

Expected: 测试/类型退出0；React/DOM19.2.8、react-is19.2.8、Recharts3.10.1，不新增另一个图表库。

- [ ] **Step 5: 记录图表兼容性、null投影和表格可访问证据。** 实际ResizeObserver／手机／hydration放Task8运行验证，不声称只凭unit已完成UI，不 commit。

### Task 8: 清晰本地演示、真实浏览器、完整验收与新增量审查

**Files:**
- Create in own workspace: runtime/backend/marketing-performance-demo.mts
- Create in own workspace: runtime/frontend/marketing-performance-browser.mts
- Create in own workspace: runtime/frontend/marketing-workflow-browser.mts
- Create in own workspace: baseline-manifest.json、final-verification.json、screenshots/、完整log
- Update in own workspace: progress.md
- Only if a real defect is reproduced: its owning production file and RED regression test

**Interfaces:**
- Consumes: Tasks1–7完整协议、routes、四步和既有上传/归因行为；正常auth form，不假JWT。
- Produces: 本地演示入口、before/after截图、真实PG与UI证据、单次本轮增量审查结论。
- Runtime path: worktree根 .superpowers/sdd/2026-10-11-marketing-workflow-performance/；不是small-house-commerce/.superpowers。
- Existing preview3210/3211及原2026-10-09 workspace保持；新的backend3220/frontend3221只有确认无占用后才启动。

- [ ] **Step 1: 复核实施前baseline，建立自己的runtime，串行验证。** 使用Task 1前保存的原bytes/hash和当前状态生成本轮增量，不能到Task 8才采集修改前基线；git diff HEAD不足以区别上轮已验收但未提交的营销代码。复制项目源码到本计划owned runtime，node_modules沿原已验证方式链接；新frontend next.config保留private/no-store和API rewrite、turbopack.root指向当前worktree，不能覆盖primary配置／.next。读取安装版Next client、searchParams、Turbopack指南。

检查3220/3221 listener后才启动属于自己的新进程，绑定127.0.0.1，数据库URL硬闸。新backend的UPLOAD_DIR在自己的runtime；与frontend设置匹配的local REVALIDATE_SECRET和REVALIDATE_URL。旧fixture媒体若需要复用，复制自己旧runtime的已知文件到新uploads，不改旧服务或原商品数据。

- [ ] **Step 2: 演示数据和浏览器测试先定义，再填入本地fixture。** demo脚本第一条检查数据库host/path；无专库URL立刻退出，不能fallback主库。只新增自身tag数据，不修改旧订单历史。测试用fixture与可供用户看的演示分开：页面叫“省空间展示页／耐用结构展示页／待制作草稿／已停用历史页”，不使用Native browser或随机UUID作为运营名称。

图片优先用授权本地商品现有的正常家具图复制到本计划uploads；先实际查看图。不能把64px浏览器截图当商品图，也不能为图片上传商品到第三方或下载未知来源。若没有可用图片，将“真实图片缺口”明确记录，不假称演示完善。两个商品、两个优化师、多页、多链接、完整费用/费用待补/显式0/无链接等状态，数据命名带“本地演示”；历史曲线用全新演示fixture日期，不回填真实旧记录。不得制造Verified Purchase评论。

- [ ] **Step 3: 真实浏览器四步验收。**

```ts
await page.goto(`${origin}/admin/login`);
await page.getByLabel('Email', { exact: true }).fill(localEmail);
await page.getByLabel('Password', { exact: true }).fill(localPassword);
const login = page.waitForResponse(response => response.url().endsWith('/auth/login'));
await page.getByRole('button', { name: 'Log in', exact: true }).click();
assert.equal((await login).status(), 200);
await page.goto(`${origin}/admin/marketing/${pageId}/edit`);
await page.getByLabel('内部名称', { exact: true }).fill('省空间椅－视频广告');
await page.getByRole('button', { name: '2 预览发布', exact: true }).click();
await expect(page.getByText('本地有未保存修改', { exact: true })).toBeVisible();
await expect(page.getByRole('button', { name: '更新线上版本', exact: true })).toBeDisabled();
await page.getByRole('button', { name: '1 编辑内容', exact: true }).click();
await expect(page.getByLabel('内部名称', { exact: true })).toHaveValue('省空间椅－视频广告');
```

localEmail/password为隔离库正常角色凭据，origin为新owned frontend。追加实际iframe标题/正文/媒体编辑、原始HTML、locale切换、pointer重排、390/1200 viewport；raw输入切步后保留。真实上传期间Save/Publish/Sync和切步锁住，完成后恢复；save不publish；Disable不丢输入、后续save用返回version；409不会静默覆盖。private preview从DB核验visit delta0，浏览器记录admin commerce writes0。

- [ ] **Step 4: 真实浏览器两总览和图表验收。** 正常登录own优化师／all只读finance／可管理all角色；适量auth attempts，遇429读响应等正常桶恢复，不重启清桶。

```ts
await page.goto(`${origin}/admin/marketing/compare?productId=${productId}`);
await expect(page.getByRole('heading', { name: '商品页面对比', exact: true })).toBeVisible();
await expect(page.getByText('待制作草稿', { exact: true })).toBeVisible();
await page.getByRole('button', { name: '按周', exact: true }).click();
await expect(page.getByRole('table', { name: '趋势数据', exact: true })).toBeVisible();
await page.setViewportSize({ width: 390, height: 900 });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
```

实际检验SVG尺寸>0、ResizeObserver触发后缩放、无hydration/pageerror、null断点不接成0；表格数值与接口一致。最近7/30、本周/上周/custom，实际本期/上期日期；上期0、费用不完整、未开始投放；分页前后摘要与整体趋势不变，选单页后图表名称准确。OPTIMIZER跨商品分组、停用历史人员、未分配页、all读不授写；同product不同owner own不能看到他人名称。键盘Tab/Enter可切步骤、筛选、展开、趋势表，手机核心操作无宽表依赖。

截before/after内容区、发布、商品对比、优化师总览及手机；真正查看截图，手机Puck展开字段用viewport screenshot，不fullPage改变布局。读console和network，错误请求不是“成功0值”。

- [ ] **Step 5: 原关键回归仍跑，不重新研究原业务。** 将已验证旧browser脚本复制到新计划runtime，改自己origin/端口和四步业务选择器，不改断言：media/native/controls/attribution/final-fixes。检查LP→cart→checkout仍一次订单、不可变归因、无效target需明确Confirm，ordinary clean singleSKU仍原行为。对真实原母商品/SKU/inventory做before/after精确比较；隔离测试订单单独标记，不混演示。

- [ ] **Step 6: 裸suite、真实PG、types、lint及owned构建。**

Run: `pnpm --dir small-house-commerce/backend test`

Run: `pnpm --dir small-house-commerce/frontend test`

Run: `MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-performance.integration.spec.ts src/modules/marketing/marketing-report.integration.spec.ts src/modules/marketing/marketing-touch.integration.spec.ts src/modules/marketing/ad-costs.integration.spec.ts src/modules/catalog/landing/landing-workbench.integration.spec.ts`

Run: `pnpm --dir small-house-commerce/backend exec tsc --noEmit`

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Run: `pnpm --dir small-house-commerce/backend lint`

Run: `pnpm --dir small-house-commerce/frontend lint`

Run: `pnpm --dir .superpowers/sdd/2026-10-11-marketing-workflow-performance/runtime/backend build`

Run: `pnpm --dir .superpowers/sdd/2026-10-11-marketing-workflow-performance/runtime/frontend build`

Run: `git diff --check`

Expected: 各命令退出0；完整suite实际数重新记录，不拿旧1323/1757冒充新验收。既有warning按文件名称记录，新失败即使不属于本轮也必须报告，不隐去、不擅自修同伴功能。数据库suite必须真的执行，owned构建不修改main .next；新目录继承当前Next turbopack.root。构建包含.mts时保证脚本数组显式类型，不忽略type error。

浏览器脚本用已安装backend tsx：`DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public" .superpowers/sdd/2026-10-11-marketing-workflow-performance/runtime/backend/node_modules/.bin/tsx .superpowers/sdd/2026-10-11-marketing-workflow-performance/runtime/frontend/marketing-performance-browser.mts`；workflow脚本和复制的五组回归分别同样运行。

Expected: 每个脚本exit0、DB scope通过、截图已看、无pageerror/private commerce writes；发现缺陷先写对应RED回归再修。不通过不能称UI完成。

- [ ] **Step 7: 仅本轮一次最终独立审查。** 新review package以本轮baseline-manifest为增量基线，包含新增/改动/未跟踪文件、两份spec/plan、所有rulings、五条Review Focus和本轮测试证据；旧营销实现作为边界上下文，不重新审整轮2026-10-09。调用最强可用模型的一个fresh reviewer，只读，不开review workflow。主作者核验Critical/Important后一次RED→GREEN修复pass并重跑完整suite／受影响browser；Minor记录给用户。review工具API/stream失败不是代码失败，不新建多代理或重审；按已有失败处理规则收口。

- [ ] **Step 8: 交付本地检查入口与真实证据，保留发布边界。** 给用户新的前后台检查地址、清楚的本地演示说明、before/after图、实际测试数、未做／延期项；老3210/3211继续可用。保留dirty、workspace、日志及自己仍供检查的服务，不清理同伴目录。不commit/push/deploy；生产基线、迁移/回填/备份/rollback/整合其他工作线另行获得授权后再走原发布闸。

## 依赖顺序与计划自审

执行顺序：1日期/DTO → 2共享口径 → 3只读服务 → 4前端请求 → 5四步 → 6两视图 → 7趋势/比较 → 8实际运行与最终验收。没有逐任务代理，不中途停下来问“是否继续”；遇schema、破坏性操作、安全敏感写或生产发布才停。

| 设计章节 | 对应任务 |
| --- | --- |
| §1目标、§2三入口 | 5、6 |
| §3四步、版本区别、CAS/上传/raw scope | 5、6、8 |
| §4商品纵向、无链接、排序、整单口径 | 2、3、6 |
| §5优化师全部页面、停用历史、按商品分组 | 3、4、6 |
| §6日周、上期、部分周、晚签收 | 1、2、3、7、8 |
| §7来源隔离、去重、Decimal、签收事实 | 2、3、8 |
| §8接口、单页过滤、picker、同快照/过期响应 | 1、3、4、6 |
| §9正常演示、手机与键盘 | 5、6、7、8 |
| §10完整验证 | 各任务GREEN、8完整门禁 |
| §11排除、协作、发布边界 | Global Constraints、8 |

作者自审检查：每个消费函数在接口区有生产者；后端与前端字段一一对应；单页landingPageId与trendPageId不混；rows分页不截摘要；费用未知不当0；原创建picker未扩大；effectiveStatus的LIVE与DB ACTIVE不混；不把新计划批准当生产授权。若实施需改变接口，只作最小符合spec的ruling并写入本计划ledger，不能默改统计口径。
