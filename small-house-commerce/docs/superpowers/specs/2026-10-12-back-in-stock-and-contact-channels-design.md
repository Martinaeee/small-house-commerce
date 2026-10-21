# 有货通知与客服渠道设计（B 块）

> 本文是拆分后的 **B 块**：有货通知 + 客服渠道。**不碰结算金额、不碰订单总额**。
> **A 块**（订阅 + 订阅优惠）见 `2026-10-12-newsletter-subscription-and-discount-design.md`。
> 本块复用 A 块建好的 `email` 邮件网关与 `SiteSetting` 扩展模式。

## 1. 目标

1. **有货通知（back in stock）**：缺货商品的卡片与 PDP 提供「Notify me when back in stock」，按**变体（SKU）**收集邮箱；该 SKU 库存从 ≤0 变为 >0 时给订阅者发通知邮件。
2. **客服渠道**：后台可配置 Messenger / 邮箱 / 电话三种联系渠道；前台以悬浮客服球（多渠道展开）与 footer 联系栏展示。

## 2. 现状核对（只读结论）

| 事项 | 当前实现 | 结论 |
|---|---|---|
| 邮件发送 | A 块新建 `email` 模块（`EmailGateway`：有密钥真发 / 无密钥日志占位） | B 直接复用 `sendBackInStock`，不再自建 |
| 客服展示 | `MessengerChat.tsx` 浮动球：仅 Messenger；`messengerUrl` 为空则整块（含提示）不渲染；带拖拽、滚动隐藏、45s 一次性提示、sessionStorage 关闭标记 | 需扩为多渠道，并保留全部既有行为 |
| 客服设置 | `SiteSetting`：`messengerUrl`（空=隐藏）/ `supportEmail`（必填非空）/ `supportHours` | 加 `supportPhone`（空=隐藏） |
| footer | `Footer.tsx` Contact 栏：Track Order / Cash on Delivery / `supportHours` / `supportEmail` | 加电话行 |
| 库存写入入口 | `InventoryService.setOnHandBatch` / `setOnHand` / `adjust`（后台手工调整）；订单路径 `reserveWithin` / `releaseWithin` | 有货通知有**两个**触发点：后台调整 + 订单取消/终止释放 |
| 库存口径 | `available = on_hand - reserved`（`inventory.service.ts:11`），`stockBySku` 聚合返回 | 跃迁判定用 available |
| 商品卡缺货 | `ProductCard.tsx`：`outOfStock = (resolvedVariant?.sku?.availableInventory ?? 1) <= 0`，缺货按钮 `Save for Later`（**仍执行加购**） | 缺货可加购已成立；缺的是「有货通知」入口 |
| PDP 购买区 | `PdpClient.tsx` 购买区（含 `PdpQuickCodOrder`） | Notify 入口挂这里 |
| 归因事件 | `commerce-events.ts` 各事件字段显式 | 通知订阅数据不得进入任何事件，以测试固定 |

## 3. 数据模型

### 3.1 `back_in_stock_subscriptions`（有货通知，独立于订阅者）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | |
| `email` | text | 归一化（trim + 小写） |
| `skuId` | uuid | FK `skus`，onDelete Cascade |
| `status` | enum `BackInStockStatus` | `PENDING` / `SENT` / `CANCELLED` |
| `productName` | text | 订阅时快照（邮件正文用） |
| `productSlug` | text | 订阅时快照（拼邮件链接） |
| `lastError` | text? | 最近一次发送失败原因 |
| `notifiedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

- **UNIQUE (`email`, `skuId`)**：同款同邮箱不重复订阅；已 `SENT` 后再订阅 = 重置为 `PENDING`（顾客想再次被通知）。
- 商品页顾客**不必**是 newsletter 订阅者；两表独立，订阅有货通知**不**自动加入订阅名单。

### 3.2 `SiteSetting` 扩展列

| 列 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `supportPhone` | text | `""` | 空 = 电话渠道隐藏 |

- **渠道可见性规则（沿用既有模式）**：某渠道值为空即隐藏。`supportEmail` 既有校验为必填非空，故邮箱渠道恒显示；`messengerUrl` / `supportPhone` 空则隐藏。
- 设置校验（后台 DTO）：`supportPhone` 允许空；非空时限制字符集与长度（`+`、数字、空格、括号、连字符；`^[0-9+()\- ]{7,20}$`）。

## 4. 后端

### 4.1 端点

- `POST /storefront/back-in-stock` — body `{ email, skuId }`。
  - 校验 SKU 存在且**当前缺货**（有货则返回可读错误，不建订阅）→ upsert（unique(email,skuId)）→ `{ ok: true }`。
  - 挂既有 throttle guard。
- `GET /admin/newsletter/back-in-stock` — 列表（含 `PENDING` / `SENT` / `lastError`），可分页/过滤。
- `POST /admin/newsletter/back-in-stock/:id/resend` — 重发（仅 `PENDING` 或失败项）。

### 4.2 有货通知触发（**两个触发点**）

**触发点一：后台库存调整** —— `InventoryService.setOnHandBatch` / `setOnHand` / `adjust`。
**触发点二：订单取消/终止释放库存** —— `releaseWithin` 路径（订单取消/拒绝导致预留释放，`available` 回升）。**本期纳入**（已确认）。

两处共用同一套判定与发送流程：

1. 计算每个受影响 SKU 操作**前**与**后**的 `available`。
2. 只收集 **`before ≤ 0 && after > 0`** 的 SKU（真正的补货跃迁；每次改库存都发属误报）。
3. 与库存写入**同一事务**内，把这些 SKU 的 `PENDING` 订阅翻为 `SENT`（认领，原子且防重复认领）。
4. 事务提交后逐条尝试发送：成功 → 保留 `SENT` + 写 `notifiedAt`；失败 → 回退 `PENDING` + 写 `lastError`（后台可见、可重发）。

**硬约束**：
- 该触发**只读**库存前后值，**不得改变**任何库存写入语义（`on_hand` / `reserved` / 流水）。库存写入与订单取消的既有测试必须全绿。
- **发送在事务提交之后**，事务内只做「认领」这一步更新——不把网络发送放进订单取消事务，避免扩大事务范围与失败面。
- 触发点二只在**订单确认终止/预留确实释放**之后判定，不在发起取消的中间态判定。

### 4.3 权限

复用 A 块新增的 `NEWSLETTER_READ` / `NEWSLETTER_WRITE`（ADMIN + SUPER_ADMIN）保护有货通知名单与重发。客服渠道编辑仍为 `SYSTEM_SETTINGS_EDIT`（仅 SUPER_ADMIN）。

### 4.4 公开设置端点扩展

`GET /storefront/settings` 增补：`supportPhone`。

## 5. 前台

### 5.1 商品卡与 PDP 有货通知

- **商品卡**（`ProductCard.tsx`）：`outOfStock` 时主按钮（现 `Save for Later`，仍加购）**不变**，其下新增次要文字按钮 `Notify me when back in stock` → 打开小弹层输入邮箱，绑定**当前选中变体的 SKU**。
  - 未解析出变体时复用现有「先选款式」聚焦提示逻辑，不提交空 SKU。
- **PDP**：缺货状态在购买区提供同一入口，绑定当前选中变体的 SKU。
- 成功态 `We'll email you when it's back in stock.`；重复提交按 3.1 规则重置为 `PENDING`。

### 5.2 悬浮客服球（扩展 `MessengerChat`）

- 由「仅 Messenger」扩为**多渠道**：Messenger（`messengerUrl` 非空）、邮箱（`supportEmail` 恒有）、电话（`supportPhone` 非空）。
- 交互：点浮动球展开**竖向渠道按钮堆叠**（ofix 样式）；点某渠道执行对应动作（Messenger → 新标签；邮箱 → `mailto:`；电话 → `tel:`）；X 收起。
- **向后兼容**：仅配置一个渠道时保持现状（点球直接执行该渠道动作）；拖拽、滚动隐藏、45s 一次性提示、sessionStorage 关闭标记、未配置则不渲染等既有行为与测试**全部保留**。仅当 ≥2 渠道时启用展开堆叠。

### 5.3 footer 联系栏

- Contact 栏在 `supportHours` / `supportEmail` 之外，`supportPhone` 非空时增加电话行。

### 5.4 后台 UI

- 「订阅」页（A 块已建）新增**有货通知** Tab：列表（邮箱/SKU/产品/状态/错误/时间）+ 重发。
- 设置页（`admin/(shell)/settings`）新增**客服电话**字段。
- 后台文案中文（默认），前台文案英文。

## 6. 安全与一致性

- 邮箱归一化（trim + 小写）；Zod 校验（`.email()` + 长度上限）。
- 有货通知端点挂 throttle；upsert 幂等；unique(email, skuId)。
- **通知订阅数据绝不进入订单、归因快照或 Meta Pixel 事件**——以测试固定（与订单备注同纪律）。
- 仅允许对**当前缺货**的 SKU 建立订阅（防止对在售商品刷订阅）。

## 7. 测试

**后端**：邮箱归一化；upsert 幂等；unique(email, skuId) 与 SENT→再订阅重置；对**有货** SKU 订阅被拒；**仅 ≤0→>0 触发**（有货改库存不发、缺货改缺货不发、缺货→更缺不发）；**订单取消释放库存跨越 0→>0 也触发**，且**未确认终止的取消（中间态）不触发**；发送失败回退 `PENDING` + `lastError`；网关占位不报错；重发端点行为；通知数据不入归因（grep + 快照断言）；**库存写入与订单取消的既有测试全绿**。

**前端**：商品卡/PDP Notify（变体前置、SKU 绑定、成功/错误态）；客服球多渠道展开与**单渠道回退**（既有拖拽/提示行为不回归）；footer 电话行条件渲染。

**浏览器 e2e**（3220/3221，专用库）：缺货商品卡 Notify → 后台 `PENDING` → 后台调库存（0→>0）→ 状态变 `SENT`（占位网关）；客服球多渠道展开并可点击；设置页保存电话后前台生效；375 / 768 / 1440 三宽度无横向溢出、无 console error。

## 8. 迁移

- 新迁移 `20261014200000_add_back_in_stock_subscriptions`（紧随 A 块的 `20261014190000`）。
- 内容：`back_in_stock_subscriptions` 表 + `BackInStockStatus` enum + `site_settings` 加 `support_phone`（带默认值），全部向后兼容。
- 沿用既有风格：`SET lock_timeout = '5s';` + `ALTER TABLE`。
- 共享 PostgreSQL 5432 迁移需与其他并行工作线串行（见约束）。

## 9. 不做的事（YAGNI）

- 短信 / WhatsApp 发送（电话/WhatsApp 仅作客服展示渠道，不作订阅渠道）。
- Messenger 出站消息（渠道只是链接）。
- 有货通知的补偿扫描任务（§10.2）。
- 邮件模板多语言。

## 10. 已知限制与待确认

1. **订单取消回补库存本期纳入通知**（已确认，§4.2 触发点二）：取消订单释放的库存跨越 `0→>0` 时也发通知。发送在取消事务**提交后**执行，事务内只做认领更新；未确认终止的取消（中间态）不触发。
2. **崩溃窗口**：认领（`SENT`）与发送之间进程崩溃 → 该条保持 `SENT` 但未发出，后台可见；无补偿扫描任务（本期不做）。
3. **客服球组件演进**：若采用「改 `MessengerChat` 为多渠道」，其既有拖拽/提示等测试需同步更新——这是有意的行为扩展，不是回归。
4. **`supportPhone` 为纯展示**：不做点击统计、不做来电追踪；`tel:` 在桌面浏览器行为取决于系统。
