# 商品漏斗监控与结账失败埋点设计

日期：2026-11-06

状态：三节设计已经对话确认，待用户审阅本文件后进入实现计划；尚未写代码。

审阅对象：店铺负责人、后续开发与验收人员。

## 1. 目标

1. 后台能按**商品**看到从落地页访问到下单的全链路：访问 → 商品浏览 → 加购 → 发起结账 → 提交尝试 → 提交失败（带原因）→ 下单。
2. 补上现有盲区：结账提交失败（前端校验、库存、网络、服务端）目前不留任何记录，只能靠「停在确认页却没下单」推断。
3. 对运营透明：一次异常（某商品某一步转化率明显下滑）在页面上自动标红，能下钻到失败原因分布，再下钻到单个会话的时间线。
4. 不改变现有核算页与页面列表的口径。

非目标：广告花费/ROI 核算、自动修复、对外推送告警（本期只做「报表页自动标红」，用户已确认）。

## 2. 现状与约束（实现前核对）

- 第一方事件表 `analytics_events`（`backend/prisma/schema/analytics.prisma`）已有 `PAGE_VIEW / PRODUCT_VIEW / ADD_TO_CART / BEGIN_CHECKOUT / PURCHASE / HOMEPAGE_SECTION_IMPRESSION / HOMEPAGE_SECTION_CLICK / SEARCH`，字段含 `session_id`、`campaign_link_id`（服务端从签名凭证解析）、`page_path`、`device_type`、`referrer`、`utm_*`、`metadata`、`event_day`（Asia/Manila）。
- `BEGIN_CHECKOUT` 的 `product_id` 为空，`entity_id` 是逗号连接的 SKU 列表；`ADD_TO_CART`/`PRODUCT_VIEW` 带 `product_id`。
- 商品可用 SKU 反查：`skus.sku_code`/`id → product_id`。
- 落地页 `/lp/<slug>` 一页一商品（`ProductLandingPage.product_id`），访问量由服务端去重表 `landing_page_visits` 记录。
- 提交失败发生在浏览器：`CheckoutForm.goToReview()` 校验不过直接返回；`CheckoutConfirmView.placeOrder()` 的失败全在 `catch (e)`，只有 `e.message`。
- `analytics_events` 无清理任务，数据量小，可长期保留。

## 3. 数据与埋点（第 1 节，已确认）

### 3.1 新增事件

迁移 `AnalyticsEventName` 增加两个值：`CHECKOUT_SUBMIT_ATTEMPT`、`CHECKOUT_SUBMIT_FAILED`。无新表、无新列。

| 事件 | 触发点 | 归属字段 | metadata |
| --- | --- | --- | --- |
| `CHECKOUT_SUBMIT_ATTEMPT` | 结账页点「继续到确认」且校验通过；确认页点「提交订单」 | `entity_id` = 逗号连接的 SKU 列表；`session_id`、`campaign_link_id` 等由现有上报链路填 | `step: "form" \| "confirm"`、`attemptId`、`retry`、`skuIds`、`quantities` |
| `CHECKOUT_SUBMIT_FAILED` | 上述两个动作失败 | 同上 | 上面全部 + `reason`、`field?`、`httpStatus?`、`message?`（≤200 字）、`variantNames?`、`customer`、`idempotencyKey` |

### 3.2 原因码

`VALIDATION`（结账表单前端校验、后端 400 校验类，记 `field`）、`STOCK`（后端库存不足、商品不可用）、`NETWORK`（fetch 抛错、超时、断网）、`SERVER`（HTTP 5xx）、`UNKNOWN`（其余 4xx 或无法归类）。

分类依据是 `ApiError.status` / `ApiError.code`，不靠错误文案匹配。`createOrder` 的抛错改为带 `status` 与 `code` 的类型（与现有 `admin-api` 的抛错方式保持一致）。

### 3.3 客户信息（用户明确要求记录）

`customer` 字段：`{ name, phone, province, city, barangay, postalCode, streetAddress, landmark, note }`，长度上限：address 各段 ≤ 300，note ≤ 200，`message` ≤ 200；`idempotencyKey` 记完整值。

约束（收紧访问面）：
- 客户信息**只写入 `CHECKOUT_SUBMIT_FAILED`**，不写入任何高频事件。
- **只有会话时间线接口**返回客户信息；漏斗主表与明细接口一律不返回。
- 页面默认打码（电话露后 4 位，地址露省/市），点「显示完整信息」后展开明文，需要投放工作台权限。
- 服务端日志不打印客户信息与幂等键。
- 写入前清洗 `message`：去掉疑似电话/邮箱样式的片段（正则替换为 `***`）。

### 3.4 重试口径

`attemptId` 在结账流程开始时生成，存 `sessionStorage`（同一次结账刷新不变，进入新的结账流程重新生成）。同一 `attemptId` 内的提交次数递增写进 `retry`，报表按 `attemptId` 去重统计「提交尝试会话数」，避免重试被算成多个人。

### 3.5 按商品归属

两个新事件的 `entity_id` 同样写 SKU 列表；报表层统一 `unnest(string_to_array(entity_id, ','))` join `skus` 得到商品。'下单'一律取订单表（`order_items`），不用 `PURCHASE` 事件计数。

## 4. 后台页面（第 2 节，已确认）

新页签：「商品漏斗」，路由 `/admin/marketing/funnel`，位置在投放工作台现有页签内。

### 4.1 主表

每个商品一行，列：商品（缩略图+名称+SKU）｜访问｜商品浏览｜加购｜发起结账｜提交尝试｜失败（率）｜下单｜转化率。

- 每步人数口径为「区间内做过该步骤的不同 `session_id` 数」；下单单列按订单数计。
- 「访问」= 该商品的落地页 `/lp/<slug>` 或商品详情页 `/products/<slug>` 上产生过 `PAGE_VIEW` 的去重会话数；用 `campaign_link_id` 是否存在区分投放/自然。服务端去重表 `landing_page_visits` 只作交叉核对，不作为漏斗口径（它按访客每天去重，和会话口径不一致）。
- 「失败」列 = 失败会话数 / 提交尝试会话数，悬停给出五类原因占比。
- 默认按「转化率最低」排序，可切换排序字段（下单数、访问数、某个步骤转化率）。

### 4.2 筛选

日期区间（复用 `DateRangePicker`，马尼拉日期）、流量口径（全部 / 只看投放 / 只看自然）、负责人、商品搜索、`只看异常` 开关。

### 4.3 异常标红

- 基线：该商品在各步骤上，**区间开始前 7 个自然日**的转化率中位数。
- 标红条件：当前值 < 基线 × 50%，且该步基数 ≥ 20 个会话。
- 基数 < 20 或基线缺失：显示灰色「样本少」，不标红。
- 标红悬停写明当前值与基线，例如「加购→结账 2.1%，近 7 天中位 8.4%」。

### 4.4 下钻抽屉

点商品行打开，三个页签：
1. 步骤明细：每步会话数、区间内每日走势、与基线对照。
2. 失败原因分布：五类数量与占比、常见错误消息 top3、按设备/来源拆分。
3. 会话时间线：可按原因/设备/来源筛选、勾「只看失败会话」；每会话一行（会话短码、设备、来源：FB 帖子 / Meta 广告 / 自然、进入页面、步骤时间线带时间戳），展开看购物车与客户信息（默认打码）。

空状态：区间内无事件显示「这个区间没有访问记录」。

移动端：主表横向滚动、商品列固定，抽屉全屏。

## 5. 接口与实现（第 3 节，已确认）

### 5.1 接口（均需投放工作台权限）

- `GET /api/v1/admin/marketing/funnel?from&to&traffic=ALL|ADS|ORGANIC&owner&q&onlyAnomaly&sort&page` —— 主表。不返回 PII。
- `GET /api/v1/admin/marketing/funnel/:productId/detail?from&to&traffic` —— 步骤明细、失败原因分布、错误消息 top3。不返回 PII。
- `GET /api/v1/admin/marketing/funnel/sessions?productId&from&to&reason&device&source&onlyFailures&cursor` —— 会话时间线，50/页，游标分页。唯一返回客户信息的接口。

### 5.2 查询口径

- 聚合按 `event_day` 过滤，走现有索引。
- 访问量 = `PAGE_VIEW` 按 `page_path` 归位（`/lp/<slug>` join `product_landing_pages.slug`，`/products/<slug>` join 商品 slug），`campaign_link_id` 区分投放/自然。
- 商品浏览 = `PRODUCT_VIEW` by `product_id`；加购 = `ADD_TO_CART` by `product_id`。
- 发起结账 / 提交尝试 / 失败 = 对应事件按 `entity_id` 拆分 SKU 后 join `skus.product_id`。
- 下单 = `order_items` by `product_id`，投放/自然过滤用 `order_attributions.link_id`。
- 会话与商品的关联：该会话在该区间内出现过任一与该商品相关的事件。

### 5.3 前端埋点位置

- `CheckoutForm.goToReview()`：校验失败 → `CHECKOUT_SUBMIT_FAILED{step:"form", reason:"VALIDATION", field}` 并保持现有交互（聚焦第一个错误字段）；校验通过 → `CHECKOUT_SUBMIT_ATTEMPT{step:"form"}`。
- `CheckoutConfirmView.placeOrder()`：进入 → `CHECKOUT_SUBMIT_ATTEMPT{step:"confirm"}`；`unresolvedSelection` → `FAILED{reason:"STOCK"}`；`No items` → `FAILED{reason:"VALIDATION"}`；`catch` 按 `ApiError` 分类 → `FAILED{reason, httpStatus, message}`。
- `analytics.ts` 的 `FirstPartyEventName` 增加两个事件名；上报沿用现有批量链路与签名凭证。

### 5.4 性能

单页聚合按 `event_day` 走索引；会话时间线按 `(session_id, created_at)` 游标分页；商品行超过 200 时分页返回。当前数据量下目标数百毫秒内。

## 6. 测试

- 前端：校验失败、库存不可用、网络错误、5xx 各发一次对应原因；同一 `attemptId` 重试递增 `retry`；非失败事件不含客户信息。
- 后端：SKU→商品反查、会话去重、流量口径（全部/投放/自然）、异常阈值边界（基数 19 不红、20 红、基线缺失不红）、PII 只出现在 sessions 接口、错误消息清洗。
- 集成：种入事件数据验证主表数字与下钻一致。

## 7. 上线顺序

1. 先发后端（迁移 + 枚举 + 接口；前端未发时接口返回空，无副作用）。
2. 再发前端（埋点开始积累、页面可用）。
3. 历史四步（访问/浏览/加购/结账/下单）立即有数；失败两列从前端上线时刻开始积累，之前不可回溯。
4. 验收需要在生产真实产生一次失败（用测试下单流程、不产生真实订单、不碰生产订单数据），或等待自然出现——执行前将单独征求确认。

## 8. 风险

- PII 多一份长期留存（已用「只存失败事件 + 只走会话接口 + 默认打码 + 日志不打印」收紧）；如需可加保留期清理，本期不做。
- 小样本误报用基数 20 门槛挡住；阈值先按 50%/7 天中位数，上线后按实际数据校准。
- 错误消息可能夹带用户输入，落库前做清洗。
- 事件量增加：每个结账流程最多增加 2–5 条事件，可忽略。
