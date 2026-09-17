# 自选配送日期（D 批）设计

> 参考：2026-09-16 功能盘点审计 §11 批次 D「自选配送日期（Order.preferredDeliveryDate 可空 migration + 日历）」；2026-09-15 spec §5.1（migration 字段草案，本批取其 preferredDeliveryDate 部分，customerNote 不采纳——审计行未含，裁定 D 批只做配送日期）；B 批 spec（checkout 两步入口、草稿机制、确认页、`deliveryWindow` 工作日算法）。分支：`feat/preferred-delivery-date`（叠于 C 批 feat/guest-order-tracking）。日期：2026-09-17。

## 1. 背景与目标

买家在 checkout 可选「预约配送日期」（可选字段，纯偏好——最终以客服电话确认为准）。存储到订单（可空列），确认页/成功页/后台展示。

**用户拍板的决策**：
- 可选范围：**最快今天下单后第 3 个工作日（跳过周日）起，最远未来 30 天（自然日）**，周日不可选（与 B 批 ETA 工作日语义一致）。
- 展示面：**确认页 + 成功页 + 后台（列表列 + 详情卡）**。
- customerNote（订单留言）不纳入本批。

## 2. 全局约束

- 后端 migration：**additive-only、可空列**；共享 Postgres（localhost:5432/small_house）迁移串行（先通知线 A），`prisma migrate reset` 禁止。
- 零新 npm 依赖（无日期库；日历用原生 `<input type="date">` + 现有 `addBusinessDays` 纯函数）。
- `frontend/src/lib/api.ts`：**用户裁定（2026-09-17）解除冻结，允许 2 行纯新增**——`createOrder` 输入类型加 `preferredDeliveryDate?: string | null`、请求体序列化加 `preferredDeliveryDate: input.preferredDeliveryDate ?? null`（既有调用方行为零变化；后续同类需求仍须先问）。D-T3 初版采用的调用侧交叉类型断言**作废**（类型断言不上 wire——api.ts 显式枚举序列化会丢弃该字段），改回普通调用。
- 冻结 COD 文案不受影响；新文案英文。
- 后台列表/详情页为 AdminShell 区域（线 A 共享列表含 AdminShell——本批只改 `admin/(shell)/orders/*` 页面，仍先通知线 A）。
- 草稿机制（`luwag_checkout_draft`）：preferredDeliveryDate 属于**订单数据**（非 customer 数据）——放草稿顶层 `preferredDeliveryDate?: string | null`（ISO `yyyy-MM-dd`），与 `savedAt` 平级；确认页与表单页共用。
- 成功页为 server 组件（仅 URL 参数，不 fetch 订单）→ 日期经 sessionStorage 暂存（与 `lastOrderTotal` 同款机制，键 `lastPreferredDate`），成功页由新客户端小组件渲染。

## 3. 功能规格

### 3.1 数据库（迁移）

`Order` 新增可空列（`backend/prisma/schema/order.prisma`）：
```prisma
preferredDeliveryDate DateTime? @map("preferred_delivery_date") @db.Date
```
additive-only 迁移；无默认值。

### 3.2 后端 DTO 与校验

**日期约定（裁定 D-1，终审前修正）**：ISO 串 `"yyyy-MM-dd"` 视为 **Manila 日历日**；规范时刻 = **UTC 零点**（`new Date("${d}T00:00:00Z")`）——其 `getUTC*` 读出的日历日即 Manila 日历日；落库 `@db.Date`（UTC 会话）存同一日历日；读取后按 Asia/Manila 格式化仍为同日。**禁止** `T00:00:00+08:00` 写法（与 getUTC* 组合偏移一天：周日误判、范围 +4..+31、DATE 倒退一天——D-T1 实证）。

`orders/dto/order.dto.ts` 的 `checkoutSchema` 新增：
```ts
preferredDeliveryDate: z
  .string()
  .date()
  .refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, {
    message: "Delivery is not available on Sundays.",
  })
  .refine((d) => {
    // Manila 日历日（规范时刻 = UTC 零点）：d ∈ [Manila今天+3, Manila今天+30]（自然日界；
    // 前端可选集为工作日并跳过周日，合法选择必然满足）
    const date = new Date(`${d}T00:00:00Z`);
    // Manila「今天」须按 Asia/Manila 墙钟取（服务器可能跑 UTC）——用
    // Intl.DateTimeFormat(timeZone "Asia/Manila") 取 y/m/d（与 deliveryWindow.ts 同族惯用法）
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila", year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(new Date());
    const v = (t: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0");
    const today = new Date(Date.UTC(v("year"), v("month") - 1, v("day")));
    const min = new Date(today); min.setUTCDate(min.getUTCDate() + 3);
    const max = new Date(today); max.setUTCDate(max.getUTCDate() + 30);
    const dNum = (x: Date) =>
      x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
    return dNum(date) >= dNum(min) && dNum(date) <= dNum(max);
  }, { message: "Preferred delivery date must be within the next 30 days." })
  .nullable()
  .optional(),
```
- 解析后存入 `tx.order.create({ data: { preferredDeliveryDate: new Date(`${value}T00:00:00Z`) } })`（无值 → 写 null）。
- 服务端不重算工作日集（前端为唯一入口且后端上下界宽松覆盖——最小合法偏移 ≥3 天、最大 ≤30 天，见 B 批 `addBusinessDays` 性质：+3bd ≥ +3 自然日）。

### 3.3 前端 checkout 表单（表单页）

`CheckoutForm.tsx` Delivery Address 卡内、Landmark 之后（`col-span-full`）新增（可选字段）：
- 标签 `Preferred delivery date (optional)` + `<input type="date">`（`data-testid="checkout-preferred-date"`）。
- `min` = `addBusinessDays(new Date(), 3)` 的 `yyyy-MM-dd`（Manila 时区格式化，复用 `deliveryWindow.ts` 的 Asia/Manila 渲染思想，新增小工具 `toDateInputValue(date)`）；`max` = today+30 自然日。
- 周日选择防护：onChange 时若 `getUTCDay() === 0`（以值解析的 Manila 日期）→ 清空该值并显示行内提示 `Delivery is not available on Sundays. Please choose another date.`（`data-testid="checkout-preferred-date-error"`）。
- 提示小字（字段下）：`Estimated delivery: {deliveryWindowFor(form.province)} · Choose a preferred date (optional).`（无省时省略 ETA 部分）。
- 表单 state 新增 `preferredDeliveryDate: string`（"" = 未选）；校验：可选字段，非空时须为合法日期且非周日（复用上述规则，`checkoutValidation.ts` 或组件内——裁定放 `checkoutValidation.ts` 导出 `validatePreferredDate(value)` 便于复用）。
- **草稿**：`goToReview` 写草稿时顶层带 `preferredDeliveryDate: form.preferredDeliveryDate.trim() || null`；`CheckoutDraft` 类型加字段；表单 mount 回填时一并恢复。

### 3.4 确认页

- `CheckoutConfirmView.tsx`：地址块之后新增行（如有值）：`Preferred delivery date: {格式化为 "Oct 3, 2026"}`（`data-testid="confirm-preferred-date"`；复用 manilaDayParts 风格或 `Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })`）。
- `placeOrder` payload 加 `preferredDeliveryDate: draft.preferredDeliveryDate ?? null`（空转 null）。
- 下单成功后：`try { sessionStorage.setItem("lastPreferredDate", draft.preferredDeliveryDate ?? "") } catch {}`（与 lastOrderTotal 同款容错）。

### 3.5 成功页

- 新客户端小组件 `frontend/src/components/track-order`… 否——`frontend/src/components/checkout/PreferredDateLine.tsx`（`"use client"`）：mount 读 `sessionStorage.lastPreferredDate`，有值渲染 `<p>Preferred delivery date: {格式化}</p>`（`data-testid="success-preferred-date"`），无值返回 null；容错 try/catch。
- 挂在 `order-success/[orderNumber]/page.tsx` 卡片内（Payment/Status 行之后）。

### 3.6 后台

- **列表** `admin/(shell)/orders/page.tsx`：表头 `Created` 后加 `Preferred` 列（`data-testid` 按页面惯例），单元格渲染日期（无值 `—`；与 created 同款日期格式化——按页面现有格式）。
- **详情** `[id]/page.tsx`：`addressRows`（L330-354）后加行 `Preferred delivery date`（有值才显示），渲染在 Customer & address 卡内。
- `lib/admin-api.ts` 无需改（getOrder/listOrders 已返回全字段）。

## 4. 数据流

```
CheckoutForm（date input：min=+3bd、max=+30d、周日防护）
   → goToReview 写草稿（顶层 preferredDeliveryDate）
   → 确认页显示 + payload preferredDeliveryDate（null 可空）
   → 后端 Zod 校验 + 存储（@db.Date）
   → 成功页 sessionStorage.lastPreferredDate → PreferredDateLine
   → 后台列表 Preferred 列 + 详情卡行
```

## 5. 验收

### 5.1 门禁

后端 `cd backend && pnpm build`；前端 `cd frontend && npx tsc --noEmit` 0 错、`npx eslint src` 0/0、`npm run build`。

### 5.2 浏览器/接口验收（:3003/:3004，真实下单验证后按既有保留策略记录订单号）

1. 表单：date input min/max 正确（min=今天+3 个工作日、max=+30 天，Manila 时区）；选周日 → 清空+行内提示；选合法日期 → 无错误。
2. 草稿：REVIEW ORDER 写草稿含日期；Edit 返回回填；清除日期后草稿为 null。
3. 确认页：日期行显示（格式 Oct 3, 2026）；不选日期 → 无行。
4. 下单：payload 含 preferredDeliveryDate；数据库 `preferred_delivery_date` 正确落库（tsx 查证）；不选 → 列 null。
5. 成功页：日期行显示（刷新后仍显示——sessionStorage 持久）；无日期 → 不显示。
6. 后台：列表 Preferred 列显示日期/`—`；详情卡行显示。
7. 后端 Zod：周日日期 → 400（message 含 "Sundays"）；超 30 天 → 400；早于 +3 → 400；合法 → 200；不传 → 200（null）。
8. 回归：无日期时的下单链路与 B 批行为完全一致；冻结文案 grep 无漂移；console 0 错误。
9. 迁移：`prisma migrate dev` 在共享库 additive 应用（先通知线 A）；无 reset。

### 5.3 边界情况

- 午夜跨天：min/max 在表单 mount 时计算一次；跨午夜挂着的表单 min 偏差 ≤1 天，接受（B 批同款取舍）。
- 老订单（列 null）：确认/成功/后台均隐藏。
- 浏览器不支持 date input：退化为文本输入（min/max 不强制，周日防护仍按值校验）——接受。
- sessionStorage 不可用：成功页日期行不显示（下单不受影响，同 lastOrderTotal 容错）。

## 6. 非目标

- customerNote（订单留言）、配送时段选择、配送费按日期浮动、日期确认后的二次通知（短信/电话自动触达）、后台按日期筛选。

## 7. 交付物清单

- 分支 `feat/preferred-delivery-date`（不合并）。
- 迁移前通知线 A（共享库 migration 串行 + admin orders 页面改动）。
