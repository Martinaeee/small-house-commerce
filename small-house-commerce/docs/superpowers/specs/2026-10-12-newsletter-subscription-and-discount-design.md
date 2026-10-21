# 订阅与订阅优惠设计（A 块）

> 本文是拆分后的 **A 块**：邮件订阅 + 订阅优惠（真实减价）。
> **B 块**（有货通知 + 客服渠道）见 `2026-10-12-back-in-stock-and-contact-channels-design.md`。
> A 先做；B 复用 A 建好的 `email` 邮件网关。

## 1. 目标

1. **邮件订阅**：收集顾客邮箱，两个入口——进站弹窗（首次访问一次）与 footer 上方通栏订阅条（全站）。
2. **订阅优惠（真实减价）**：以**带稳定 ID 的优惠活动**为单位配置（类型、数值、最低消费、有效期、总使用次数上限、每人限用次数、优惠码）；订阅成功后展示当前活动码；结算页与 PDP 内嵌 COD 表单输入码即**真实减价**，订单保存折扣快照与所用码，COD 应收随之变化。
3. **未配置优惠时不展示优惠承诺**：无生效中的优惠活动时，弹窗不弹、通栏不写优惠文案。

邮件发送走**薄网关**：配置了 `EMAIL_API_KEY`（Resend）时真发；未配置时写结构化日志占位（dev 可全流程演示，上线只需填密钥）。

## 2. 现状核对（只读结论）

| 事项 | 当前实现 | 结论 |
|---|---|---|
| 订阅/名单 | 全仓无 newsletter / subscriber 表与端点（grep 命中的 `subscribe` 均为无关用途） | 全新建模 |
| 邮件发送 | 无 nodemailer / Resend / SMTP 依赖，无任何发送通道 | 需新建薄网关 + 可选密钥 |
| **订单折扣链路** | `Order.discountTotal`（`order.prisma:177`）与 `OrderItem.unitDiscount`（:324）**已存在**；`orders.service.ts:138` 为 `const discount = 0;`，注释明写「discountTotal 留给订单级促销（优惠券），但目前不存在」；`:140` 公式 `grandTotal = subtotal - discount + shippingTotal`；`:238` `Payment.amount = grandTotal` | **金额链路已为优惠券预留**：只需把 `discount` 由 0 换成按活动计算，无需改公式与支付金额链路 |
| 折扣快照列 | `Order` 无「用了哪个码」的列 | 需加 `promoCode`（金额已有 `discountTotal`） |
| 并发控制先例 | `inventory.service.ts:98-100` 用 `$executeRaw UPDATE inventory SET reserved = reserved + q WHERE ... AND on_hand - reserved >= q`，判 `changed !== 1` 即拒绝 | 名额占用用同思路（事务级咨询锁 + 事务内计数 → 插入） |
| 订单取消路径 | `orders.service.ts:374` 注释：§22.2 cancel 允许到发货前，释放预留（§31） | 兑换名额释放挂同一处，且仅限「发货前取消且状态确认终止」 |
| 站点设置 | `SiteSetting` 单例：`messengerUrl` / `supportEmail` / `supportHours`；`SettingsService` 有 `getRow`/`getPublic`/`update`；后台 `admin/settings`（`SYSTEM_SETTINGS_EDIT`，仅 SUPER_ADMIN），前台 `storefront/settings` | 扩展列即可，不新建表 |
| 结账 totals 展示 | `CheckoutConfirmView.tsx` 有 Subtotal / You save（compare-at 划线）/ Total (COD) | 需增加「Promo discount」行，与 compare-at 的 `savings` 区分 |
| PDP 布局 | `PdpClient.tsx:613` `grid grid-cols-1 gap-8 lg:grid-cols-2`（左图集 / 右购买区） | **无右栏**；订阅条只能通栏 |
| 列表页布局 | `CategoryPlpClient.tsx:236` `lg:grid-cols-[210px_minmax(0,1fr)]`，`<aside>` 在**左侧**且是筛选器 | 不适合放订阅框 |
| 首页布局 | 通栏堆叠 section，无侧栏 | 同上 |
| 环境变量 | `env.validation.ts`：`JWT_SECRET` 必填（≥32）；`R2_*` / `HOMEPAGE_PREVIEW_SECRET` / `REVALIDATE_*` 均 `.optional()` | 邮件密钥按 optional 模式加 |
| 归因事件 | `commerce-events.ts` 各事件字段显式（`content_ids`/`value`/`currency`） | 订阅数据不得进入任何事件，以测试固定 |

## 3. 数据模型

### 3.1 `newsletter_subscribers`（订阅者，一邮箱一行）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | |
| `email` | text | 存**归一化**值（trim + 小写）；UNIQUE |
| `status` | enum `SubscriberStatus` | `SUBSCRIBED` / `UNSUBSCRIBED` |
| `source` | enum `SubscribeSource` | `POPUP` / `FOOTER`；记**首次**来源，重复订阅不覆盖 |
| `createdAt` / `updatedAt` | timestamptz | |
| `unsubscribedAt` | timestamptz? | |

- 同一邮箱重复订阅 = upsert：`status` 回到 `SUBSCRIBED`、清 `unsubscribedAt`，`source` 保持首次值。

### 3.2 `newsletter_promotions`（优惠活动，**稳定 ID 的配置实体**）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | **稳定活动 ID**；计数与核销都挂它，改码不影响 |
| `code` | text | 兑换码，**存大写归一化**；UNIQUE |
| `discountType` | enum `NewsletterDiscountType` | `PERCENT` / `FIXED` |
| `discountValue` | Decimal(10,2) | 百分比数值或固定金额（PHP） |
| `minSpend` | Decimal(10,2) | 最低消费（按 subtotal），0 = 无门槛 |
| `maxUses` | int? | 总使用次数上限；null = 不限 |
| `perCustomerLimit` | int? | 每人限用次数；null = 不限 |
| `validFrom` | timestamptz? | 生效开始；null = 立即 |
| `validUntil` | timestamptz? | 生效结束；null = 不过期 |
| `status` | enum `PromotionStatus` | `ACTIVE` / `ARCHIVED` |
| `archivedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

- **同一时刻至多一个 `ACTIVE`**，由数据库部分唯一索引强制：
  `CREATE UNIQUE INDEX newsletter_promotions_single_active ON newsletter_promotions (status) WHERE status = 'ACTIVE';`
- **改码不清零**：管理员修改 `code` 或数值，**同一行、同一 `id`**，计数与核销全部延续。
- **新一轮 = 新活动**：需要重置使用次数时，**显式创建新活动行**（新 `id`、新计数），旧活动置 `ARCHIVED` 并**保留全部历史与核销数据**。
- **防绕过**：因为核销挂 `promotionId`（非码字符串），仅修改字符串**无法**绕过次数上限。
- 校验（后台 DTO）：`code` 匹配 `^[A-Z0-9-]{3,32}$`；`discountValue > 0`；`PERCENT` 时 `≤ 100`；`minSpend ≥ 0`；`maxUses` / `perCustomerLimit` 若填则 `≥ 1`；`validUntil > validFrom`（两者都填时）。

### 3.3 `promo_code_redemptions`（核销记录，限额的唯一事实源）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | |
| `promotionId` | uuid | FK `newsletter_promotions`，**计数挂它** |
| `orderId` | uuid | FK `orders`，**UNIQUE**（一单一核销） |
| `codeSnapshot` | text | 核销时所用码（展示用，不参与计数） |
| `normalizedPhone` | text | 订单顾客归一化手机号快照（每人限用判定） |
| `discountAmount` | Decimal(10,2) | 该单实际折扣金额 |
| `releasedAt` | timestamptz? | 取消订单时置位 → 名额释放 |
| `createdAt` | timestamptz | |

索引：`@@index([promotionId, releasedAt])`、`@@index([promotionId, normalizedPhone, releasedAt])`。

- **有效核销**定义 = `releasedAt IS NULL`。
- 总使用次数 = 该活动有效核销数；每人已用 = 该活动 + 该手机号的有效核销数。

### 3.4 `SiteSetting` 扩展列（**仅展示配置**，优惠机制不在此）

| 列 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `newsletterBandEnabled` | boolean | `true` | footer 上方通栏订阅条开关（**默认开启**） |
| `newsletterPopupEnabled` | boolean | `false` | 进站弹窗开关 |
| `newsletterPopupDelaySeconds` | int | `5` | 弹窗延迟秒数 |
| `newsletterOfferTitle` | text | `""` | 优惠标题（弹窗与通栏共用） |
| `newsletterOfferBody` | text | `""` | 优惠正文（共用） |

- **优惠展示规则**：仅当活动为 `ACTIVE`、`code` 非空、当前位于有效期内，且 `maxUses` 为 null 或有效核销数仍小于 `maxUses` 时，视为「当前可用优惠」。否则弹窗不弹、通栏不写优惠文案（§5.2 / §5.3）。

### 3.5 `Order` 扩展列

| 列 | 类型 | 说明 |
|---|---|---|
| `promoCode` | text? | 本单实际应用的优惠码（大写）；未用码为 NULL |

- 折扣**金额**复用既有 `Order.discountTotal`，不新增金额列。
- 订单行级 `OrderItem.unitDiscount` 保持 0（本设计为**订单级**优惠，不做行级分摊）。

## 4. 后端

### 4.1 新模块 `newsletter`

- `POST /storefront/newsletter/subscribe` — body `{ email, source: POPUP | FOOTER }`。
  - 归一化 → upsert 订阅者 → **best-effort** 发欢迎邮件（失败不影响响应）→ 返回 `{ ok: true, promoCode: string | null, offerTitle, offerBody }`。
  - `promoCode` 只取当前「可用优惠」（§3.4）的码；活动未开始、已过期或总名额已耗尽时均为 `null`。**只在此响应返回**（未订阅者拿不到）。
- `GET /storefront/newsletter/unsubscribe?token=…` — 只返回带确认按钮的极简 HTML，**不改变订阅状态**，避免邮件安全扫描器预取链接造成误退订。
- `POST /storefront/newsletter/unsubscribe?token=…` — 校验无状态签名 token → 置 `UNSUBSCRIBED` + `unsubscribedAt` → 返回极简 HTML 结果页（成功 / 已失效两种文案）。
- `POST /storefront/checkout/promo-code/preview` — body `{ code, subtotal }`。
  - 返回 `{ valid: boolean, discountAmount: number, message: string }`；用于**结算前展示**，不创建订单、**不占用名额**。**仅展示**：权威校验与占用在创建订单时服务端完成（§4.3）。
- 端点均挂既有 throttle guard。

**退订 token**：`base64url(HMAC-SHA256("newsletter-unsubscribe:" + normalizedEmail, JWT_SECRET))`。**不新增必填环境变量**（从既有 `JWT_SECRET` 派生 + 域分隔前缀）。

### 4.2 新模块 `email`（薄网关，B 块复用）

接口 `EmailGateway`：

- `sendWelcome(to, { offerTitle?, offerBody?, promoCode?, unsubscribeUrl })`
- `sendBackInStock(to, { productName, productUrl, unsubscribeUrl })`（B 块使用）

实现二选一，模块初始化时按配置选择：

- `ResendEmailGateway`（`EMAIL_API_KEY` 存在时）：HTTP 调 Resend API，`EMAIL_FROM` 为发件人；每次请求使用 **5 秒超时信号**，超时与 provider 错误同样交给订阅服务的 best-effort 边界吞掉，不阻塞订阅结果。
- `LogEmailGateway`（默认）：`logger.log` 结构化输出收件人 / 主题 / 正文，**不报错**。

`env.validation.ts` 新增 **optional**：`EMAIL_API_KEY`、`EMAIL_FROM`（`.email()` 可选）、`STOREFRONT_BASE_URL`（拼链接用，可选）。

### 4.3 优惠码校验与减价（结账链路，**并发安全**）

在 `orders.service.checkout()` 的**同一事务**内，把 `const discount = 0;`（:138）替换为：

1. `input.promoCode` 为空/NULL → `discount = 0`、`order.promoCode = null`（**既有行为完全不变**）。
2. 非空 → 解析当前 `ACTIVE` 活动，依次校验，任一失败抛可读 `BadRequestException`：
   - **a. 码有效**：存在 `ACTIVE` 活动且归一化后 `code` 匹配 → 否则 `That promo code isn't valid.`
   - **b. 有效期**：`validFrom ≤ now` 且 `now ≤ validUntil`（null 不限制）→ 未开始 / 已结束给不同文案
   - **c. 最低消费**：`subtotal ≥ minSpend` → 否则 `This code needs a minimum order of ₱X.`
   - **d. 总次数上限**：该活动有效核销数 `< maxUses`（null 不限制）→ 否则 `This promo code has reached its usage limit.`
   - **e. 每人限用次数**：该 `normalizedPhone` 在该活动的有效核销数 `< perCustomerLimit`（null 不限制）→ 否则 `You've already used this promo code.`
3. **并发安全（关键）**：在做 d/e 的计数前，对该**活动 ID**取事务级咨询锁
   `SELECT pg_advisory_xact_lock(hashtext('promo:' || promotionId))`
   使同一活动的并发结账**串行化**；随后「计数 → 插入核销行」在同一事务内原子完成。两个并发订单争抢最后一个名额时，后者会等待并在计数后失败，**不会双占**。锁在事务提交时自动释放。
   （锁键用**活动 ID**而非码字符串——改码不改变锁域。）
4. 通过 → 计算 `discount`：
   - `PERCENT`：`round(subtotal × value / 100, 2)`
   - `FIXED`：`min(value, subtotal)`
   - **下限保护**：`discount ≤ subtotal`，保证 `grandTotal ≥ 0`。
5. 写入：插入 `promo_code_redemptions`（`promotionId` / `orderId` / `codeSnapshot` / `normalizedPhone` / `discountAmount`）；`Order.promoCode = code`、`discountTotal = discount`。
6. `grandTotal` / `Payment.amount` 沿用既有公式（:140 / :238），**不改公式**。

**订单创建失败不占名额**：核销行在**订单创建同一事务内**插入；事务回滚则核销行一并消失，不会残留占用。

**安全**：客户端只传**码字符串**，折扣金额一律服务端计算；**绝不接受**客户端传入的折扣金额或总价。预览端点（§4.1）只用于展示、不占用名额。

### 4.4 取消订单释放名额（**有条件**）

**释放条件（全部满足才释放）**：
- 订单处于**发货前**阶段；
- 取消流程**已确认订单终止**（不是发起取消的中间态）；
- 该订单存在核销行且尚未释放。

**释放入口**：上述规则必须覆盖专用取消动作、通用状态更新到 `CANCELLED`，以及合并订单时被终止的 dropped order；不能只在某一个 controller 路径释放。

**不释放**：**已发货**、**COD 拒收**、**RTO** —— 这些路径**不自动释放**，后续单独定义规则（本期不实现）。

**幂等**：释放用条件更新
`UPDATE promo_code_redemptions SET released_at = now() WHERE order_id = $1 AND released_at IS NULL`
——重复取消不会二次释放，也不会改动已释放行。

**并发安全**：释放只**减少**有效核销数，不会造成超发；条件更新本身原子。同一订单的并发取消由 `order_id` 唯一 + 条件更新保证只释放一次。

**同步处理总次数与每人次数**：两者都由 `releasedAt IS NULL` 计数推导，一次释放**同时**影响两者，无需分别维护计数器。

**创建失败不占名额**：见 §4.3（同事务回滚）。

### 4.5 权限

- **订阅名单**：新增 `NEWSLETTER_READ` / `NEWSLETTER_WRITE`，授予 **ADMIN + SUPER_ADMIN**。
- **优惠活动管理**（新建/编辑活动、改码、改金额与限额）：受既有 `SYSTEM_SETTINGS_EDIT`（**仅 SUPER_ADMIN**）保护——优惠涉及金额，与设置页同一门禁。
- **展示配置**（弹窗/通栏/文案）仍在设置页，同样 `SYSTEM_SETTINGS_EDIT`。
- B 块的有货通知名单复用 `NEWSLETTER_READ` / `NEWSLETTER_WRITE`。

### 4.6 公开设置端点扩展

`GET /storefront/settings` 增补：`newsletterBandEnabled`、`newsletterPopupEnabled`、`newsletterPopupDelaySeconds`、`newsletterOfferTitle`、`newsletterOfferBody`、`newsletterOfferAvailable`。其中 `newsletterOfferAvailable` 是服务端按 §3.4 的完整规则（`ACTIVE` + 当前有效期 + 剩余总名额）计算的布尔值，前端**不得用标题非空代替此判定**。响应仍**不含**优惠码与任何优惠**金额/限额配置**（客户端不需要）。

公开设置仍使用现有 `storefront` tag 与 300 秒上限缓存；会改变可用性的写路径必须在事务提交后 best-effort 触发该 tag 的 on-demand revalidation：设置保存、活动新建/编辑、最后一个总名额成功占用，以及取消/合并释放一个已耗尽活动的名额。失败订单事务不得触发名额占用或相应 revalidation。

### 4.7 后台端点

- `GET /admin/newsletter/subscribers` — 分页列表，可按 `status` / `source` 过滤。
- `PATCH /admin/newsletter/subscribers/:id` — 改 `status`（退订 / 恢复）。
- `GET /admin/newsletter/subscribers/export` — CSV 导出（邮箱、状态、来源、时间）。
- `GET /admin/newsletter/promotions` — 活动列表（含 `ACTIVE` 与历史 `ARCHIVED`）。**门禁 `SYSTEM_SETTINGS_EDIT`（仅 SUPER_ADMIN）**。
- `PATCH /admin/newsletter/promotions/:id` — 编辑活动字段（**同一 `id`，不清零计数**）。同上门禁。
- `POST /admin/newsletter/promotions` — **新建活动**（新一轮：新 `id`、新计数）；创建时把原 `ACTIVE` 置 `ARCHIVED`（同一事务，满足部分唯一索引）。同上门禁。
- `GET /admin/newsletter/promotions/:id/usage` — 用量：有效核销数 / 上限 / 每人限制 / 已释放数，以及明确的 `LIVE | SCHEDULED | EXPIRED | EXHAUSTED | ARCHIVED` 可用状态；后台对非 `LIVE` 的当前活动显示可读警告。同上门禁。

## 5. 前台

### 5.1 共享组件 `SubscribeEmailForm`

- props：`source: "POPUP" | "FOOTER"`、`variant?: "band" | "popup"`、`onSuccess?(promoCode)`。
- 行为：邮箱输入 + 提交 → `POST /storefront/newsletter/subscribe`；空/非法邮箱前端即拦（与后端 Zod 同规则），提交中禁用防重复提交。
- 生产入口都通过 `onSuccess` 打开同一个 `NewsletterSuccessDialog`：统一显示 `Thank You!`、订阅成功文案、真实优惠码与复制按钮；无优惠时只显示订阅成功。未传 `onSuccess` 的调用方保留内联成功态作为兼容 fallback。
- 共享成功弹层沿用同一无障碍契约（焦点陷阱、Esc / 背景 / 顶部 X / 底部 Close 关闭、滚动锁、焦点归位）并复用 HTTP/IP 可工作的 `copyText()`。

### 5.2 进站弹窗 `NewsletterPopup`

- 挂在 storefront 布局（客户端组件）。
- **显示条件**：`newsletterPopupEnabled` **且存在生效中的优惠活动**（§3.4 规则）**且** `localStorage["luwag_newsletter_popup_seen"]` 不存在。无活动则不弹（不承诺不存在的优惠）。
- `newsletterPopupDelaySeconds` 秒后出现；定时器触发时再次读取 seen key，避免用户先从 footer 订阅后弹窗仍延迟打开。关闭（X / 背景 / Esc）或**提交成功**都写入该 localStorage 键 → 同一浏览器**本期不再弹**。
- 视觉采用单张真实优惠票券的强促销方向：官方 wordmark、welcome eyebrow、后台配置标题/正文和邮箱表单；不伪造多档金额或不存在的权益。订阅成功后原优惠弹层切换为 §5.1 的共享成功弹层。
- 无障碍沿用既有前台弹层模式（`role="dialog"`、`aria-modal`、焦点陷阱、Esc、关闭后焦点归位），参照 `CartDrawer`。
- 后台/预览上下文不出现（storefront 布局不用于 admin；营销预览若复用前台渲染器需在计划中显式排除）。

### 5.3 footer 上方通栏订阅条 `SubscribeBand`

- `newsletterBandEnabled` 为真时渲染在 footer **上方**，全站每页可见（**默认开启**）。
- 有生效活动时展示 `offerTitle` / `offerBody`；无活动时只保留「Subscribe」邮箱框，**不写任何优惠承诺**。
- 桌面采用 Costway 式左右信息结构，配 Castlery 式暖棕色编辑感；邮箱为下划线输入 + 圆形箭头。空闲态 1440px 桌面高度必须不超过 190px，避免遮挡下方 footer。
- 从通栏提交成功同样打开 §5.1 的共享成功弹层，并写入 popup seen key，避免随后再弹首访优惠；关闭后通栏表单恢复为空。
- **不放在商品页右栏**：本站商品页是 `lg:grid-cols-2` 左右各半（右半为购买区），列表页侧栏在左侧且是筛选器，首页通栏——均无右栏可挂（见 §2）。

### 5.4 优惠码输入（结账页与 PDP 内嵌 COD 表单）

- 结账页（`CheckoutForm.tsx`）与 PDP 内嵌 COD 表单（`PdpQuickCodOrder.tsx`）各加一个**可选**优惠码输入（`Promo code` + `Apply`）。
- 点击 `Apply` → `POST /storefront/checkout/promo-code/preview` → 成功显示折扣金额；失败显示可读原因（无效 / 未开始 / 已过期 / 未达门槛 / 已达上限 / 已用过）。
- 码随草稿保存（`checkoutDraft` 增加可选字段，向后兼容旧草稿），并进入创建订单请求体（**`api.createOrder` 白名单必须同步加字段**——既有教训）。
- `CheckoutConfirmView` totals 增加 **`Promo discount`** 行（与 compare-at 的 `You save` 分开），Total (COD) 反映折后金额。
- 未输入码时不显示该行、不影响既有 totals 展示与测试。

### 5.5 后台 UI

- 新「订阅」页（admin 侧栏），两个 Tab：
  - **订阅者**：列表（邮箱/状态/来源/时间）+ 退订/恢复 + CSV 导出。（有货通知 Tab 由 B 块添加。）
  - **优惠活动**（**仅 SUPER_ADMIN 可见**，受 `SYSTEM_SETTINGS_EDIT`）：当前 `ACTIVE` 活动的字段编辑（码/类型/数值/最低消费/次数上限/每人限用/有效期）+ 用量概览 + **「开始新一轮」**（显式新建活动、归档旧活动，并提示「旧活动历史与核销数据保留」）；历史活动列表（只读，含核销数据）。
- 设置页（`admin/(shell)/settings`）：通栏开关、弹窗开关/延迟/标题/正文，带提示「未配置生效活动时前台不会展示优惠」。
- 后台订单详情：显示 `promoCode` 与折扣金额。
- 后台文案中文（默认），前台文案英文。

## 6. 安全与一致性

- 邮箱归一化（trim + 小写）；Zod 校验（`.email()` + 长度上限）。
- 订阅与优惠预览端点挂 throttle；upsert 幂等。
- **折扣一律服务端计算**，客户端只传码字符串；预览端点结果不具权威性、不占名额。
- **名额占用并发安全**：事务级咨询锁（按活动 ID）+ 事务内计数 → 插入核销（§4.3.3）。
- **名额释放幂等且并发安全**：条件更新 `WHERE released_at IS NULL`（§4.4）。
- **订阅数据绝不进入订单、归因快照或 Meta Pixel 事件**——以测试固定（与订单备注同纪律）。优惠码可进入订单快照（属订单事实），但**不得**进入 Pixel 事件字段。
- 退订走无状态 HMAC token（由 `JWT_SECRET` 派生 + 域分隔），不新增必填环境变量。
- 仓库不含密钥；`EMAIL_API_KEY` 仅从环境读取。

## 7. 测试

**订阅**：邮箱归一化；upsert 幂等与 `source` 保持首次值；退订 token 合法/篡改/失效；订阅数据不入归因（grep + 快照断言）；网关占位不报错。

**优惠（重点）**：
- 无码时 `discount=0` 且订单无 `promoCode`（**既有行为回归**）。
- 百分比与固定额计算正确；`FIXED` 超过 subtotal 被夹到 subtotal（`grandTotal ≥ 0`）。
- 逐条失败路径给可读错：无效码 / 未开始 / 已过期 / 未达最低消费 / 已达总上限 / 已用尽每人次数。
- **并发安全**：`maxUses = 1` 时两个并发结账，**恰好一个成功**（另一个收到「已达上限」）；用真实事务并发证明，而非仅单测桩。
- **每人限用**：同一归一化手机号第二次用码被拒；不同手机号可用。
- **活动 ID 语义（关键）**：
  - 改 `code` / 数值后，**计数延续**（不因改字符串而清零，也无法绕过上限）。
  - 新建活动 → 新计数从零；旧活动历史与核销数据**保留**且不计入新活动。
  - 同一时刻至多一个 `ACTIVE`（部分唯一索引生效）。
- **取消释放（有条件）**：发货前取消且订单终止 → 名额释放（总次数与每人次数同时释放）；**重复取消不二次释放**（幂等）；**已发货/拒收/RTO 不释放**；**创建失败不占名额**（事务回滚后有效核销数不变）。
- **客户端伪造无效**：请求体带折扣金额字段被忽略（服务端重算）。
- 订单持久化 `promoCode` + `discountTotal`；`Payment.amount` 跟随折后 `grandTotal`；改商品后折扣保留（沿用已存 `discountTotal`）。
- 设置校验：`PERCENT > 100` / 负值 / 非法码字符 / `validUntil ≤ validFrom` 被拒。

**前端**：`SubscribeEmailForm` 提交/外部成功回调/兼容内联成功/错误态与 HTTP/IP 剪贴板 fallback；弹窗门控（localStorage / 延迟 / 触发时二次 seen 检查 / 关闭标记 / **无生效活动不弹**）；通栏渲染与开关（**无活动时不写优惠文案**）；popup 与通栏共用成功弹层（同文案、真实码、复制、四种关闭方式、焦点与滚动恢复）；优惠码输入 + preview + 各类错误文案；编辑后立即清旧结果、拒绝乱序响应、subtotal 变化自动复核、preview pending 时锁定 Review/Place；React Strict Mode 下恢复 draft code 仍必须发起复核；`CheckoutConfirmView` 折扣行；后台订阅列表/活动编辑/新一轮/导出/设置校验。

**浏览器 e2e**（隔离端口 + 专用库）：首访弹窗出现 → 订阅 → 共享成功弹层拿到码 → 关闭 → 刷新不再弹；footer 通栏订阅后打开内容一致的共享成功弹层；**结算输入码 → 折扣生效 → 草稿保留并在 Strict Mode 确认页重新复核 → Total (COD) 减少 → 下单后后台订单显示码与折扣**；无效码/未达门槛/已用尽的错误提示；最后名额耗尽后用全新浏览器上下文确认不再出现弹窗/优惠承诺；后台「开始新一轮」后旧活动计数保留、新活动从零且前台重新可用；设置页经真实 UI 保存后前台立即生效；375 / 768 / 1440 三宽度无横向溢出、无 console error；1440px 通栏空闲态高度 ≤190px，共享成功弹层桌面边界 ≤500×360px。

## 8. 迁移

- 新迁移 `20261014190000_add_newsletter_subscriptions`（紧随 `20261014180000_add_order_customer_note`）。
- 内容：`newsletter_subscribers`、`newsletter_promotions`（含部分唯一索引）、`promo_code_redemptions` 三张表 + `SubscriberStatus` / `SubscribeSource` / `NewsletterDiscountType` / `PromotionStatus` 四个 enum + `site_settings` 加列（带默认值）+ `orders` 加 `promo_code`（可空），全部向后兼容。
- 沿用既有风格：`SET lock_timeout = '5s';` + `ALTER TABLE`。
- 共享 PostgreSQL 5432 迁移需与其他并行工作线串行（见约束）。

## 9. 不做的事（YAGNI）

- **多活动并存**：同一时刻仅一个 `ACTIVE` 活动（不做同时生效的多个码）。
- 行级折扣分摊（`OrderItem.unitDiscount` 保持 0）。
- 折扣叠加、免运费优惠、指定商品/类目范围。
- 已发货 / COD 拒收 / RTO 的释放规则（§4.4 明确不自动释放）。
- 短信 / WhatsApp 发送。
- 邮件模板多语言、A/B 弹窗、购买后弹窗。
- 订阅 → 下单转化追踪。

## 10. 已知限制与待确认

1. **每人限用按归一化手机号 = 基础防滥用，不是可靠身份验证**。菲律宾 COD 允许游客下单、手机号由顾客自行填写，同一人可用不同号码绕过，不同人也可能共号。**后台文案与本文档都不得把它描述为身份验证**；它只降低随手重复使用的概率。
2. **取消释放的边界**（§4.4，已按你的条件落地并确认）：发货前正常取消且订单确认终止后释放；**已发货 / COD 拒收 / RTO 不自动释放**，后续单独定义规则；订单创建失败不占名额。
3. **改单不重算折扣**：`updateOrderItems` 沿用已存 `discountTotal`（`:645`），若改商品后 subtotal 低于最低消费，本期不重新校验也不撤销折扣。
4. **通栏订阅条默认开启**（已确认）：`newsletterBandEnabled` 默认 `true`，无活动时仅为普通订阅框。
5. **优惠活动管理仅 SUPER_ADMIN**（已确认）：新建/编辑活动、改码、改金额与限额均受 `SYSTEM_SETTINGS_EDIT` 保护；ADMIN 只能看订阅名单。
6. **归档为单向终态**（已确认）：活动归档后**不可**重新启用；要重新使用需新建活动（新 `id`、新计数），旧活动永久留档。
7. **自然到期的展示缓存窗口**：活动/设置写入、最后名额占用与名额释放都会立即触发 tag revalidation；但若没有写事件，`validUntil` 自然跨过当前时刻时，已缓存或已打开页面的优惠文案最多可保留到 300 秒 revalidation 窗口结束。订阅响应会实时返回 `promoCode: null`，checkout 也会权威拒绝过期码，因此不会产生错误折扣或订单金额；若业务要求秒级下线，需后续增加到期调度或 client-side live probe，而不是把标题当可用性代理。
