# 订单备注、缺货说明与结账表单一致性设计

日期：2026-10-12
状态：方向已与用户确认（后台文案为「订单备注」）；本文件待用户审阅，尚未进入实施计划。

## 1. 目标

三件事一起做，都属于既有结账链路的局部修正，不新增购买步骤、不改金额与库存语义：

1. **商品卡缺货说明**：切换到缺货款式时，卡片要说明缺的是哪个组合，而不是只把按钮变成 `Save for Later`。
2. **邮编控件与表单一致性**：多 ZIP 城市不再用原生大下拉；PDP 内嵌 COD 表单的字段布局与结账页一致。
3. **订单备注（Order Notes, Optional）**：结账页与 PDP 内嵌 COD 表单都新增一个非必填备注，贯穿 Review → Confirm → Place → Success，持久化到订单并在后台可见。

## 2. 现状核对（只读结论）

| 事项 | 当前实现 | 结论 |
|---|---|---|
| 缺货 CTA | `ProductCard.tsx` 用 `primaryDerived.resolvedVariant?.sku?.availableInventory <= 0` 判定缺货，缺货显示 `Save for Later` | 行为符合已批准的商品卡规范；缺的是「为什么缺」 |
| 缺货成因 | `CardV2 sparse` 中 Blue 只存在 `Blue / Small` 且该组合库存为 0；紧凑改版后尺寸行收起，用户看不到 `Small` 仍在选中 | 需要在卡片上说明具体组合 |
| 邮编控件 | `CheckoutForm.tsx` 与 `PdpQuickCodOrder.tsx` 在多 ZIP 时渲染原生 `<select>`，选项文本为 `1422 — Novaliches North` | 原生下拉在桌面/移动都过大，需要换成紧凑控件 |
| PDP 表单网格 | `PdpQuickCodOrder.tsx` 用 `sm:col-span-2` 堆叠字段 | 与结账页 `grid-cols-1 gap-4 sm:grid-cols-2` 不一致 |
| 客户备注字段 | `Order` 无客户备注列；`OrderNote` 是客服内部 append-only 备注（§46）；`Order.confirmationNote` 是客服确认记录；`CustomerNote` 是客户级记录 | 均不适合复用，需要新增订单级可空列 |
| 结账契约 | `checkoutSchema.customer` 含 name/phone/province/city/barangay/postalCode/streetAddress/landmark；`preferredDeliveryDate` 在顶层 | 备注按订单级放在顶层，与日期字段同级 |
| 草稿 | `CheckoutDraft` = `customer` + `savedAt` + `preferredDeliveryDate?` + `selection?` | 新增顶层可选字段即可向后兼容 |
| 归因事件 | `commerce-events.ts` 各事件使用显式字段（`content_ids`/`value`/`currency` 等） | 备注不得进入任何事件；以测试固定 |

## 3. 商品卡缺货说明

- 当**解析出的真实组合缺货**时，在 CTA 上方显示一行说明：`<已选真实选项标签，按 / 拼接> is out of stock`，例如 `Blue / Small is out of stock`；单维度商品只显示该维度值。
- 该行**只在缺货时渲染**；正常款式不增加任何高度，不影响已完成的紧凑改版。
- 保留 `Save for Later` 按钮语义、`Out of Stock` 标记与各选项的 × 缺货标记；缺货款式仍可加入购物车。
- 不改 `isCompatibleValue`/`isOutOfStockOnly`/`isSelectableVariant` 判定，不改 SKU 选择、价格、库存或加购请求。
- 未选择完整组合时（`resolvedVariant === null`）不显示该说明，维持现有 `Choose your options` 提示与 More 焦点引导。

## 4. 邮编控件

- 多 ZIP 城市（`postalLookup.options.length > 1`）改用现有 `SearchableSelect`（`frontend/src/components/checkout/SearchableSelect.tsx`），不再渲染原生 `<select>`。两条表单（结账页与 PDP 内嵌 COD）同时替换。
- 现有契约：`options: string[]`、`value: string`，**选项字符串本身就是提交值**；提交值必须来自 `options`。因此邮编控件的选项传 `option.zip`，`value` 传当前 `postalCode`，与现有 `form.postalCode` 存储完全一致，不改 `lib/postalCodes`。
- 原生下拉此前显示 `1422 — Novaliches North`，只传 ZIP 会丢掉区域名，属可见回退。为此给 `SearchableSelect` 增加**可选**的 `optionLabel?: (value: string) => string`（默认恒等）：只影响展示文本与键入筛选文本，提交值不变。省份/城市/barangay 三个既有调用点不传该参数，行为完全不变。
- 文案：无值时 `Pick a postal code`，自动填充后 `Change postal code`（沿用现有 `postalLookup.auto` 判定），`searchPlaceholder` 用 `Search a ZIP code`。
- 键盘可达：Tab 进入、方向键移动、Enter 选择、Esc 关闭；提交值与筛选逻辑沿用组件既有实现，不新写 combobox。
- 保留现有 `postalAutoRef` 自动填充与「手动改过就不再覆盖」逻辑，以及 `Filled in from your address — you can change it.` 提示（`checkout-postal-code-hint`）。
- 不改邮编数据源（`lib/postalCodes`）与 PSGC 级联。

## 5. PDP 内嵌 COD 表单布局对齐结账页

- 字段网格改为与结账页一致：`grid grid-cols-1 gap-4 sm:grid-cols-2`。
- 字段顺序与占位：
  - Contact Information：Full Name、Mobile Number（各占一列）+ 手机号说明整行。
  - Delivery Address：Province、City、Barangay、Postal Code（两列成对）；Full Address、Landmark、Order Notes 整行。
- 增加与结账页相同的分区标题 `Contact Information` / `Delivery Address`，`Use my location` 保持在 Delivery Address 标题行右侧。
- 手机（≤640px）单列堆叠，不产生横向溢出；不改左侧商品清单区与数量控件。
- 不改校验规则、错误文案、地理定位填充与草稿写入时机。

## 6. 订单备注

### 6.1 数据模型

- `orders` 新增可空列 `customer_note TEXT NULL`（Prisma 字段 `customerNote String? @map("customer_note")`），随一次新迁移落地。该迁移是纯新增可空列，对共享 5432 库无破坏性；执行前与营销线的迁移串行协调。
- 旧订单该列为 `NULL`；读取侧一律按可空处理，不写默认值、不回填历史订单。
- 不复用 `OrderNote`（客服内部备注，保持 append-only 与 `noteType` 语义）与 `Order.confirmationNote`（客服确认记录）。
- 空字符串一律存 `NULL`，避免出现两种「空」；首尾空白在写入前 trim，内部换行保留。

### 6.2 接口

- `checkoutSchema` 顶层新增 `customerNote: z.string().trim().max(200).transform(v => (v === "" ? null : v)).nullable().optional()`；先 trim 再判长，按 Unicode 码点计不超过 200，空串归一为 `null`。
- `ordersService.checkout()` 在创建订单时写入；`null`/缺省写入 `NULL`。
- 后台订单详情响应返回 `customerNote`（该查询用 `include` 取整行标量，无需改 select 列表），供管理端展示。
- 请求体其余字段、幂等与重复单判定、风控、库存预留、COD 确认逻辑全部不变。

### 6.3 草稿

- `CheckoutDraft` 顶层新增可选 `customerNote?: string | null`；`readCheckoutDraft` 对缺失该字段的旧草稿保持兼容（视为 `null`）。
- 写入沿用现有 `writeCheckoutDraft` 调用点，两条表单各自传入当前备注值。

### 6.4 界面

- 两条表单都在 **Landmark 下方、Review Order / Place 按钮上方**，整行（`col-span-full`）渲染。
- 英文标签 `Order Notes (Optional)`；紧凑多行文本框，默认约 2 行高度，`maxLength=200`，非必填。
- Placeholder：`Any special delivery instructions? (e.g. Please call before delivery)`。
- 手机自适应，不产生横向溢出；不新增必填校验、不阻塞提交。

### 6.5 流程保留

- 提交链路是：表单 `writeCheckoutDraft` → `CheckoutConfirmView` 读草稿并显式拼装 POST body（现有 `customer` 对象与顶层 `preferredDeliveryDate` 同处）→ `POST /storefront/orders`。因此备注在 `CheckoutConfirmView` 的请求体里与 `preferredDeliveryDate` 并列透传，不需要表单直连接口。
- 确认页在现有配送信息区（`Landmark:` / `Preferred delivery date:` 附近）以只读文本显示备注，保留换行。
- 两个 Edit 入口返回表单时，备注与其它字段一并从草稿恢复，不丢失。

### 6.6 后台展示

- 管理端订单详情在配送信息区只读显示「订单备注」；与现有内部 `Order Notes` 卡片分开，不混入客服备注流。
- 空值显示为占位符（与现有 `textOrDash` 一致）。
- 后台不提供编辑该字段的入口（本轮范围外）。

### 6.7 追踪与隐私边界

- 备注**不得**进入 Meta Pixel 或任何归因事件（`purchase`/`initiate_checkout`/`add_to_cart` 等），也不写入营销归因快照。
- 以测试固定：提交含备注的订单后，事件负载中不出现备注文本。

## 7. 测试与验收

- **单元（前端）**：草稿新旧兼容读写；200 字上限与空值归一为 `null`；两条表单的字段渲染、标签与 `maxLength`；`CheckoutConfirmView` 的 POST body 含备注且确认页只读显示；卡片缺货说明只在缺货时出现；`SearchableSelect` 替换后的选择/键盘行为与 `optionLabel` 默认恒等（其它三个地址字段行为不变）。
- **后端**：`checkoutSchema` 接受合法备注、拒绝超长与非字符串；持久化与读回；旧订单 `NULL` 兼容；管理端详情返回该字段；事件负载不含备注。
- **浏览器（隔离环境）**：两条表单填写 → Review → Confirm（显示备注）→ Place → Success；返回编辑备注保留；390px 无横向溢出；邮编多 ZIP 城市使用新控件完成选择；缺货卡片说明显示正确且非缺货卡片无该行。
- **回归**：现有商品卡、结账、PDP 内嵌 COD、订单后台、归因相关测试保持通过。

## 8. 不做与发布边界

- 不改 SKU、库存、价格、运费、COD、下单确认、重复单判定与风控算法。
- 不把备注发送到像素/归因；不在后台提供备注编辑；不做订单备注的历史回填。
- 不顺手重构结账页或 PDP 的其它字段、校验与样式体系。
- 本轮只在本地隔离环境实施与验收：不 commit、不 push、不 merge、不 PR、不 deploy；不动生产数据、`backend/uploads/`、用户 3000/3001 服务与其他会话的端口。

## 9. 待确认

1. 缺货说明的英文措辞采用 `Blue / Small is out of stock`（真实选项值拼接）。
2. 后台标题使用「订单备注」，与内部 Order Notes 卡片并列而非合并。
3. 确认页以只读文本展示备注并保留换行。
