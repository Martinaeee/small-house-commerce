# 游客查单体系（C 批）设计

> 参考：2026-09-16 功能盘点审计 §11 批次 C「游客查单体系」；A 批 spec（site settings 通路）、B 批 spec（checkout 体验，已含 `OrderPreview`/`CheckoutTrustStrip` 共享组件与 Need-help 块模式）。分支：`feat/guest-order-tracking`（叠于 B 批 feat/checkout-experience @ 98f1068）。日期：2026-09-17。

## 1. 背景与目标

COD 家具买家下单后只能看到一次性成功页，无任何自查入口（后台客服靠电话人工确认）。本批提供「订单号 + 手机号」游客查询：前端 `/track-order` 页 + 后端免鉴权查询端点。

**用户拍板的决策**：
- 查询返回**含收货地址全量**（状态时间线 + 商品清单 + 金额 + 地址）。
- 入口 = **页脚 Contact 列表 + 订单成功页交叉链接**（不做头部图标）。
- 弱验证已知并接受：订单号 + 手机号精确双匹配即返回全量。

## 2. 全局约束

- 零新 npm 依赖（前后端）。
- `frontend/src/lib/api.ts` **禁止修改** → 新增独立模块 `frontend/src/lib/guestOrder.ts`（同 `api.ts` 的错误处理风格，自带 fetch 封装）。
- 冻结 COD 文案不受影响；本批新文案一律英文。
- 线 A 共享文件：`frontend/src/components/layout/Footer.tsx`（页脚 Contact 列表加链接）——执行前通知线 A（home-pdp-5a），改动为新增一个 `<li>`。
- `order-success/[orderNumber]/page.tsx` 为线 A 消费的页面（A 批列表含 PDP 文件，order-success 属 storefront 公共页）——改动为新增一个 Link，先通知。
- Meta Pixel：查询页**不触发任何 track()**；成功页现有 `PurchaseTracking` 不动。
- 后端：NestJS ESM、`/api/v1`、ZodValidationPipe；新端点**不挂 guard**（游客端点）；不引入限流/验证码（现状无限流设施，spec 注明留待上线安全评审）。
- 弱验证提示（隐私小字）必须出现在查询表单下方。

## 3. 功能规格

### 3.1 后端查询端点

**POST `/api/v1/storefront/orders/lookup`**（无鉴权）

请求体（Zod，`orders/dto/order.dto.ts` 新增 `lookupSchema`）：
```ts
{ orderNumber: z.string().regex(/^PH\d+$/), phone: z.string().min(1).max(32) }
```

**OrdersService 新增 `lookup(orderNumber, phone)`**（复用现有 `normalizePhone` L333 与 `ORDER_DETAIL_INCLUDE` L13-21）：
1. `findUnique({ where: { orderNumber } })`（无结果 → 统一 404）。
2. 手机比对：`normalizePhone(phone)` 必须等于 `order.customer.normalizedPhone` **或** 订单快照 `shippingAddress.phone` 的规范化值；否则 → **同一 404**（不泄露「订单存在但手机不符」的差异）。
3. 命中 → 返回 `get` 同款详情（customer 名、shippingAddress 全量、items 含单价/变体/数量、statusHistory 时间线、confirmationStatus、paymentStatus、createdAt/updatedAt）。

**控制器**：`storefront/orders.controller.ts` 新增 `@Post('lookup')`（注意路由顺序：`lookup` 在 `@Post()` 之外注册无冲突）；无 guard；失败统一 `NotFoundException('Order not found. Check your order number and mobile number.')`。

### 3.2 前端查询页

- 新路由 `frontend/src/app/(storefront)/track-order/page.tsx`（`metadata.title = "Track Your Order"`）→ 客户端组件 `frontend/src/components/track-order/TrackOrderForm.tsx`。
- **表单**：Order Number（`data-testid="track-order-number"`，placeholder `PH100012`）、Mobile Number（`data-testid="track-phone"`，placeholder `0917 123 4567`，`inputMode="tel"`）；提交按钮 `TRACK ORDER`（`data-testid="track-submit"`，submitting 时 `Tracking…`）。
  - 校验：订单号 `^PH\d+$`（大小写不敏感，小写自动转大写）；手机号规则与 checkout 一致——**从 `frontend/src/lib/checkoutValidation.ts` 提取 `validatePhone(value)` 导出**，两处共用（DRY；checkoutValidation 非冻结文件）。
  - 支持 `?order=PH…` 预填订单号（成功页跳转带参）；`readonly` 预填时用户仍可改。
- **提交**：`api.lookupOrder(orderNumber, phone)` → 成功渲染结果卡；失败渲染统一错误 `Order not found. Check your order number and mobile number.`（`role="alert"`）。
- **结果卡**（`data-testid="track-result"`）：
  1. 标题 `Order {orderNumber}` + `Placed on {日期}`。
  2. **状态时间线**：`OrderStatusHistory` 按 createdAt 升序渲染，每项 = 状态文案 + 日期；当前状态高亮。状态文案映射（与成功页/后台一致的英文）：
     NEW=`Order Received`、PENDING=`Awaiting confirmation`、QUESTION=`Questioning`、CONFIRMED=`Confirmed`、ABNORMAL=`Delivery issue`、SHIPPING=`Out for delivery`、SIGNED=`Delivered`、CANCELLED=`Cancelled`、DENIED=`Denied`、AFTER_SALES=`After-sales`。附当前 Confirmation 与 Payment 状态行：Confirmation `Not yet confirmed`/`Confirmed`/`Needs review`/`Rejected`；Payment `Cash on Delivery · Awaiting payment`/`Collected`/`Settled`/`Paid`。
  3. **商品清单**：复用 B 批 `OrderPreview` 组件（`lines` 由 items 映射：key=itemId、slug、name、variant、quantity、unitPrice）。
  4. **金额**：Subtotal + Total (COD)（沿用 formatPrice；`COD — calculated at checkout` 仅当后端金额语义与 checkout 一致时显示——实际后端有 shippingTotal/grandTotal：显示 `Shipping`（有值时）+ `Total`，不写死文案，按数据渲染）。
  5. **收货地址全量**：Name/Phone/Street/Barangay/City/Province/Postal/Landmark（逐行，跳过空值）。
  6. **Need help 块**：复用现有模式（messengerUrl 条件 + mailto supportEmail + supportHours，`data-testid="checkout-need-help"` 或同款新 testid `track-need-help`）。
- **隐私小字**（表单下方，`data-testid="track-privacy-note"`）：`Your order details are shown only to the person with the order number and mobile number used at checkout.`

### 3.3 入口

- **成功页**：`order-success/[orderNumber]/page.tsx` 卡片内加一行 `<Link href={/track-order?order=${orderNumber}}>` `Track your order`（`data-testid="success-track-link"`）。
- **页脚**：`Footer.tsx` Contact `<ul>`（L49-53）加 `<li><Link href="/track-order">Track Order</Link></li>`。

## 4. 数据流

```
成功页 Track your order / 页脚 Track Order
   └─ /track-order?order=PH…
        └─ TrackOrderForm（校验 → api.lookupOrder）
             └─ POST /api/v1/storefront/orders/lookup {orderNumber, phone}
                  └─ OrdersService.lookup（精确匹配 → 全量详情）
             ├─ 200 → 结果卡（时间线/商品/金额/地址/Need help）
             └─ 404/400 → 统一错误文案
```

## 5. 验收

### 5.1 门禁

- 后端：`cd backend && pnpm build`（或 tsc）通过；前端：`cd frontend && npx tsc --noEmit` 0 错、`npx eslint src` 0/0、`npm run build` 通过。

### 5.2 浏览器/接口验收（Playwright + curl，dev 环境 :3003/:3004）

1. 后端：合法订单号（用 B 批保留的 PH100012，手机号以 0917 开头）+ 正确手机 → 200 全量（地址/商品/时间线/确认/支付）；错误手机 → 404 统一文案；不存在订单号 → 404 同一文案（响应体逐字一致）；非法 body（`{}`、`PHxxx`、超长手机）→ 400 Zod；`lookup` 在 `storefront/orders` 下与 `POST /storefront/orders` 共存无路由冲突。
2. 前端表单：空提交 → 字段错误不请求；小写订单号自动大写；坏手机号 → 内联错误。
3. 成功查询：结果卡完整（时间线按序、商品行、金额、地址逐行、Need help、隐私小字）；`?order=` 预填生效。
4. 失败查询：统一错误文案呈现，无异常堆栈。
5. 入口：页脚 Contact 列表含 Track Order；成功页含链接且跳转带 `?order=`。
6. 回归：正常下单链路（REVIEW ORDER → 确认页 → 下单成功）不受影响；成功页 PurchaseTracking 仍触发（Pixel 事件不新增、不删除）；冻结文案 grep 无新增漂移。
7. 全流程 console 0 errors/warnings。
8. 无测试数据残留（查询不写库；如验收中下单需记录订单号交控制器清理，先例：测试订单保留策略由用户定）。

### 5.3 边界情况

- 订单号大小写/空格：输入 trim + 大写规范化后匹配；后端 `^PH\d+$` 拒绝非法格式。
- 手机号格式差异（0917 vs +63917 vs 917）：`normalizePhone` 双向规范化后比对（复用现有逻辑）。
- 订单无 statusHistory（老数据）：时间线仅显示当前状态单行。
- 查询期间订单状态变化：每次查询实时读库，无缓存。
- 隐私模式/离线：查询失败按统一错误呈现（不区分原因）。

## 6. 非目标

- 限流、图形验证码、短信/邮件通知、订单号模糊搜索、与登录账号绑定（`GET storefront/customers/me/orders` 维持现状）。
- 后台查单页改动（后台已有检索）。
- 查询历史本地缓存。

## 7. 交付物清单

- 分支 `feat/guest-order-tracking`（不合并）；spec/plan/实现提交全部落此分支。
- 执行前通知线 A（Footer + order-success 页新增链接）；若线 A 有未提交改动则协商。
