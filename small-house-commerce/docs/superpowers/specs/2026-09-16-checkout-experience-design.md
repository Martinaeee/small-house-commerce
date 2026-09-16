# Checkout 体验补强（B 批）设计

> 参考：2026-09-16 功能盘点审计 §11 批次 B「checkout 体验补强（真实 ETA 日期、保障图标条、隐私提醒、Confirm my order 复核页、隐藏假 Discount 行）——纯前端」；A 批 spec `2026-09-16-site-contact-settings-design.md`（已上线，提供 site settings 通路与 checkout「Need help?」块）。分支：`feat/checkout-experience`（叠于 feat/site-contact-settings @ 90261ff）。日期：2026-09-16。

## 1. 背景与目标

竞品审计确认 checkout 存在信任缺口：COD 卡内配送承诺是写死文字、无日期；无保障展示；无隐私提醒；下单前无复核步骤。本批补齐以上四项，全部**纯前端**（后端零改动）。

**目标**：把「Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days.」升级为按所选省份计算的真实日期区间（跳过周日）；新增四项保障图标条；新增隐私一行字；新增独立 `/checkout/confirm` 复核路由页；确认 Discount 行在无折扣时永不显示（现状已满足，记为验证项）。

## 2. 全局约束

- **纯前端**：不新建/修改任何后端文件、无迁移。
- **零新 npm 依赖**（前端不引入日期库；纯手写业务日算法，菲律宾无夏令时）。
- **冻结 COD 文案**：除本 spec §3.2 明确授权的「配送预计句」替换外，以下字符串必须逐字保留：
  - `PLACE COD ORDER`（从表单页迁移到确认页，作为确认页主按钮，逐字保留）
  - `COD — calculated at checkout`、`Total (COD)`
  - `Cash on Delivery · No payment needed now`
  - `Cash on Delivery`（COD 卡标题）、`Pay in cash when your order arrives.`（COD 卡正文第一句）
  - CartDrawer 中的 `COD — calculated at checkout`（本批不动）
- 前台文案统一英文（与现站一致）。
- Meta Pixel 调用点不变，本批 UI 不新增任何事件。
- 无 wishlist/heart 图标；仅用现有 Tailwind design tokens；图标沿用现有内联 SVG 风格（PdpClient 货车 glyph 同款：`<svg>` + `stroke="currentColor"` 或 fill，尺寸 h-4/h-5）。
- `frontend/src/lib/api.ts` **禁止修改**（`createOrder` 现成可用）。
- 共享文件协议：`frontend/src/lib/deliveryWindow.ts` 为 PDP 页面（线 A 区域）消费的值模块——改动前通知线 A（home-pdp-6e 会话）；改动为纯数值语义（日期算法），组件签名与 `DeliveryWindows` 类型形状**不变**，PdpClient/PdpView/产品页/lp 页**零改动**。
- 购物车行、下单、成功页（`/order-success/[orderNumber]`）、sessionStorage 金额暂存逻辑全部沿用现状。

## 3. 功能规格

### 3.1 真实 ETA 日期（共享规则升级 + checkout 接入）

**算法**（`frontend/src/lib/deliveryWindow.ts` 内升级）：
- 新增 `addBusinessDays(date: Date, n: number): Date`：从 `date` 起逐日推进 n 天，**跳过周日**（`getDay() === 0` 不计数）。
- 保留 `formatDeliveryRange(now, minDays, maxDays)` 与 Asia/Manila 渲染（`Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" })`；月内 `Sep 16–18`，跨月 `Sep 28 – Oct 2`）。
- `deliveryWindows()`（PDP 信任条消费）改用 `addBusinessDays`：metro = `formatDeliveryRange(now, 3, 5)`、provincial = `formatDeliveryRange(now, 5, 7)`。**PDP 信任条日期自动随新规则变化，文案结构（`Metro Manila: {range}` / `Provinces: {range}`）不变。**
- 新增 `isMetroManila(province: string): boolean`：规范化（trim、折叠连续空白、转小写）后匹配静态集合 `{"metro manila", "ncr", "national capital region"}`。
- 新增 `deliveryWindowFor(province: string, now?: Date): string`：`isMetroManila(province) ? formatDeliveryRange(now, 3, 5) : formatDeliveryRange(now, 5, 7)`。模块内复用 `DeliveryWindows` 的现有导出结构，类型形状不变。

**checkout 接入**（`frontend/src/components/checkout/CheckoutForm.tsx` COD 卡，现约 :574-580）：
- 省份输入合法（有值且通过现有校验）时，COD 卡第二句替换为 `Estimated delivery: {deliveryWindowFor(form.province)}`（如 `Estimated delivery: Sep 19–22`），随输入实时更新。
- 省份为空时**回退原冻结句** `Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days.`（此句仅作为未选省时的兜底保留；有省时本 spec 授权用日期句替换）。
- 卡标题 `Cash on Delivery` 与第一句 `Pay in cash when your order arrives.` 逐字不动。

### 3.2 保障图标条（新组件 `CheckoutTrustStrip`）

- 新建 `frontend/src/components/checkout/CheckoutTrustStrip.tsx`（client 组件），两页共用（表单页 + 确认页）。
- 四项，图标（内联 SVG，h-4/h-5，`aria-hidden="true"`）+ 文案：
  1. **COD & Free Shipping**（图标：纸币/手）
  2. **Estimated delivery {range}**（图标：日历；`range` = `deliveryWindowFor(province)`，由 props 传入；无省份时传兜底文案 `Metro Manila 3-5 days · provinces 5-7 days`）
  3. **Support {supportHours}**（图标：对话气泡；`supportHours` 来自 `useSiteSettings()`，A 批通路现成）
  4. **Inspect at delivery · 48h exchange for defects**（图标：盾/对勾）
- 布局：横向 flex（移动端可折行/纵向），`text-ink-secondary` 小字，与设计体系一致。
- 表单页位置：COD 卡上方；确认页位置：商品摘要上方。
- 测试点：`data-testid="checkout-trust-strip"`，每项文本为唯一可断言文本（不另加 testid）。

### 3.3 隐私提醒

- 表单页：送达地址卡内底部（streetAddress/landmark 字段之后）一行小字：**Your information is used only to process and deliver your order.**（`text-ink-secondary text-xs`；`data-testid="checkout-privacy-note"`）。
- 确认页：地址块下方同文案同组件级渲染（同一行字，可复用同文件内的常量）。

### 3.4 Confirm my order 复核路由页

**路由**：新建 `frontend/src/app/(storefront)/checkout/confirm/page.tsx`（client 页面壳，`metadata` 标题 `Confirm Your Order`），渲染新组件 `frontend/src/components/checkout/CheckoutConfirmView.tsx`。

**数据流（sessionStorage 草稿）**：
- 草稿键：`luwag_checkout_draft`；值 `{ customer: { name, phone, province, city, barangay?, postalCode?, streetAddress, landmark? }, savedAt: string }`。读写全部 try/catch（A 批 `readNudgeDismissed` 同款容错，sessionStorage 不可用时静默降级）。
- **写入**：表单页主按钮改为 **REVIEW ORDER**（`data-testid="review-order"`；上移现提交逻辑中的表单校验：校验通过 → 写草稿 → `router.push(/checkout/confirm?<原 items 查询串>)`；校验失败 → 显示现有字段错误，不写草稿不跳转）。
- **读取/回填**：表单页 mount 时若草稿存在，无条件将 `draft.customer` 回填 `form`（确认页 Edit 返回即此路径；全新访问时表单为空、回填即恢复，确定性无歧义）。
- **确认页读取**：mount 时读草稿；**无草稿 → `router.replace(/checkout?<items 查询串>)` 重定向回表单页**（items 查询串与 /checkout 接收的完全一致；Buy Now 场景为 skuId/qty/slug）。
- **清理**：下单成功（现成功处理函数内）→ `sessionStorage.removeItem("luwag_checkout_draft")`，同时保留现有的金额暂存与购物车行删除逻辑。

**确认页内容（自上而下）**：
1. 标题 `Confirm your order`
2. 保障条（§3.2）
3. 商品清单：与购物车/CheckoutForm 相同的数据源与金额格式（小图/名称/单价 × 数量/行小计）；`data-testid="confirm-items"`；标题旁「Edit」链接 → `/cart`
4. 配送地址块：`Name / Phone / streetAddress, barangay, city, province, postalCode / landmark`（按现有展示顺序）；`data-testid="confirm-address"`；「Edit」链接 → `/checkout?<items 查询串>`（表单页从草稿回填）
5. 支付与合计：`Cash on Delivery · No payment needed now`、`COD — calculated at checkout`、`Total (COD)` + 金额（沿用现有金额格式，PHP）；「Need help?」块（复用 A 批实现）
6. 隐私行（§3.3）
7. 主按钮 `PLACE COD ORDER`（`data-testid="confirm-place-order"`；submitting 时 `Placing order…`——与现表单页逐字一致）→ 调 `api.createOrder`（payload 与现 CheckoutForm 完全一致：attribution 默认 ORGANIC + customer + items），成功后清草稿、删已购购物车行、暂存总额、跳 `/order-success/{orderNumber}`

**商品解析复用**：把 CheckoutForm 现用的 searchParams 解析（`items` / `skuId`/`qty`/`slug` 两种形态）提取为共享 helper（如 `frontend/src/components/checkout/checkoutItems.ts` 纯函数），表单页与确认页同用；**行为零变化**，重构风险由计划/测试兜底。

### 3.5 隐藏 Discount 行

现状 `totals.discount` 恒 0、折扣行仅在 `> 0` 时渲染（CheckoutForm :557-561）——已天然隐藏。本批**不改代码**，验收中回归验证即可（§5.2 场景 10）。未来促销码（CHECKOUT_SPEC §14）不属于本批。

## 4. 架构与数据流

```
/cart 或 PDP Buy Now
   └─ /checkout?items=…（表单页 CheckoutForm）
        ├─ 保障条（3.2）+ COD 卡动态 ETA（3.1）+ 隐私行（3.3）
        └─ REVIEW ORDER（校验 → 写 draft → push）
             └─ /checkout/confirm?items=…（CheckoutConfirmView）
                  ├─ 无 draft → replace 回 /checkout?items=…
                  ├─ 保障条 + 商品清单 + 地址块(Edit→/checkout) + 合计 + Need help? + 隐私行
                  └─ PLACE COD ORDER → createOrder → 清 draft/购物车行 → /order-success/{orderNumber}
```

- 新文件：`CheckoutTrustStrip.tsx`、`CheckoutConfirmView.tsx`、`(storefront)/checkout/confirm/page.tsx`、`components/checkout/checkoutItems.ts`（解析 helper）
- 修改文件：`frontend/src/lib/deliveryWindow.ts`、`frontend/src/components/checkout/CheckoutForm.tsx`
- 未动：后端全部、`lib/api.ts`、PdpClient/PdpView/产品页/lp 页、CartDrawer、购物车页

## 5. 验收

### 5.1 门禁（与仓库现行一致）

- `cd frontend && npx tsc --noEmit` 0 错；`npx eslint src` 0/0；`npm run build` 通过（22+ 页）。

### 5.2 浏览器验收场景（Playwright，:3003 线 B dev；后端 :3004 起测试实例）

1. **ETA 规则（工作日）**：选省 `Metro Manila` → COD 卡显示 `Estimated delivery: {X}–{Y}`，其中 X = 今日+3 个工作日（跳过周日）、Y = 今日+5 个工作日，与日历手工核对（Asia/Manila）；改省 `Cebu` → 5–7 工作日窗口；清空省 → 回退原冻结句。
2. **NCR 匹配**：`metro manila`、`  Metro Manila  `（大小写/空格）均命中 NCR；`National Capital Region` 命中；`Metro Cebu`、`Cebu` 走省区窗口。
3. **保障条（表单页）**：四项文案齐全（`COD & Free Shipping` / `Estimated delivery …` / `Support Mon–Sat, 9am–6pm (PHT)` / `Inspect at delivery · 48h exchange for defects`）；管理员改 supportHours 后（硬刷新）保障条第 3 项随之更新。
4. **REVIEW ORDER**：空表单点击 → 字段错误、不跳转、sessionStorage 无 `luwag_checkout_draft`；填合法表单点击 → 跳 `/checkout/confirm`（items 查询串保留）、draft 已写、值正确。
5. **确认页**：商品清单行项/数量/价格与购物车一致；地址块与表单一致；合计 = 行小计之和（无折扣时与 subtotal 相等）；ETA 区间正确；保障条/隐私行/Need help? 均在；`PLACE COD ORDER` 正常下单 → `/order-success/{orderNumber}`、购物车行已删、draft 已清（sessionStorage 验证）。
6. **Edit 回链**：确认页地址 Edit → 回 `/checkout` 且表单从 draft 回填；改省后再 REVIEW ORDER → 确认页 ETA 与地址更新。
7. **无 draft 直访**：新标签直接开 `/checkout/confirm?items=…` → 立即重定向回 `/checkout?items=…`。
8. **Buy Now 链路**：PDP Buy Now → `/checkout?skuId&qty` → REVIEW ORDER → 确认页正确（同 sku、数量 1）→ 下单成功。
9. **返回不丢数据**：确认页按浏览器返回 → 表单页数据仍在；再 REVIEW ORDER 正常。
10. **Discount 行回归**：多组不同金额下确认页/表单页均无 `Discount` 行渲染。
11. **PDP 信任条回归**：产品页与落地页仍渲染 `Estimated delivery` 卡，日期按新工作日规则（与同页手算一致）；文案结构未变。
12. **冻结文案回归**：除 §3.1 授权句外，§2 冻结清单各串逐字存在于 DOM（表单页+确认页合计位置核对）。
13. 全程 console 0 errors/warnings；无订单残留（测试订单在下单场景后记录并交由控制器清理）。

### 5.3 边界情况

- sessionStorage 不可用（隐私模式）：REVIEW ORDER 后确认页读不到 draft → 按 §3.4 重定向回表单页；功能降级为原单步（不破坏下单）。容错与 A 批同款 try/catch。
- StrictMode 双调用：解析/算法均为纯函数，draft 读写只在事件处理器与 mount 后执行一次。
- 两个步骤之间购物车被改动：确认页重新派生当前购物车行/价格（非快照）；库存/价格最终以后端下单校验为准（现状不变）。
- 午夜 SSR/客户端日期偏差：PDP 为 SSR + ISR 300s，checkout 为客户端实时——同一时刻前后误差 ≤1 天，接受（与现状一致）。

## 6. 非目标（明确不做）

- 后端配送模块/接口、`Order.preferredDeliveryDate` 迁移（属 D 批，已有 2026-09-15 spec §5 雏形）。
- 促销码/真实折扣（CHECKOUT_SPEC §14，未来批次）。
- PSGC 搜索式省市区下拉（E 批；届时 NCR 判定迁移到 PSGC region 维度，本批的静态 NCR 集合仅服务当前自由文本输入）。
- 隐私政策独立页面（上线前法务阶段）。

## 7. 交付物清单

- 提交：spec 1 次；实现按计划分任务提交，全部落在 `feat/checkout-experience`（不合并，沿用批次惯例）。
- 上线前通知线 A 关于 `deliveryWindow.ts` 数值语义变更；若线 A 同期改动该文件则协商合并。
