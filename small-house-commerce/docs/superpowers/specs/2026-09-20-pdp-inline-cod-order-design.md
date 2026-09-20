# PDP Inline COD Order 设计

日期：2026-09-20
状态：已确认，待统一实施计划
依赖：`2026-09-20-variant-options-media-design.md`
关联：`2026-09-20-viewport-autoplay-media-design.md`
范围：PDP/LP 内嵌订单行、顾客与地址表单、页内确认、订单幂等、追踪与成功页

## 1. 背景

当前 PDP 的 `ORDER NOW` 把一个 SKU 和数量带到 `/checkout`，Checkout 填写顾客/地址后再跳 `/checkout/confirm`，最终才调用现有 Storefront Orders API。流程正确但包含两次页面跳转，广告流量可能在跳转、重新确认商品或重新理解页面时流失。

参考站把商品选择、数量、总价、COD 地址和提交按钮放在同一商品页。LUWAG 采用同一转化原则，但不复制其密集表格和弱地址体验：继续复用现有 PSGC 搜索、邮编自动匹配、定位、配送日期、库存预留、客户风险、重复订单标记和订单工作台。

本设计依赖多维变体规格。Inline Order 不维护第二套颜色/尺寸逻辑，必须与 PDP 顶部共享同一购买状态和媒体映射。

## 2. 已确认决策

1. Quick COD Order Form 位于 Product Details、Specifications、Delivery & FAQs 之后。
2. Related Products 位于 Quick COD Order Form 之后、Reviews 之前。
3. 原独立 TrustBar 移入 Quick COD Order Form，在顾客字段之前显示精简保障条。
4. 表单允许同一商品的多个变体组合，每行有独立 SKU 和数量。
5. 第一行继承 PDP 顶部当前选择；额外组合通过 `Add another option` 添加。
6. 填写完成后使用页内 Modal；移动端使用 Bottom Sheet 二次确认，不跳 `/checkout/confirm`。
7. 确认后调用现有订单创建服务，成功进入现有 Order Success 页面。
8. 现有 `/checkout` 保留，继续服务购物车和传统 Buy Now 路径。
9. Inline Order 不删除或修改顾客购物车。
10. 服务端增加持久化幂等键，解决网络重试导致的重复订单。

## 3. 目标

### 3.1 顾客目标

- 在一个 PDP/LP 内完成变体选择、数量、地址和 COD 下单；
- 可购买同一商品的多个颜色×尺寸组合；
- 下单前在同页完整确认商品、金额和地址；
- 返回页面或误点 Related Product 后不丢失已填资料；
- 不会因为广告深链或默认展示变体而误买；
- 下单成功后继续获得订单号、状态入口和配送日期信息。

### 3.2 运营目标

- 降低 PDP → Checkout 跳转流失；
- 保留 fbclid/UTM/LP attribution；
- 分析 Inline Form 各阶段转化与错误；
- 不牺牲 COD 订单质量、库存准确性或客服审核规则；
- 可对传统 Checkout 和 Inline Order 的成功率、取消率、拒收率做对比。

### 3.3 工程目标

- Checkout 与 Inline Order 共用顾客字段、地址、验证和提交基础能力；
- Inline Order 复用现有 OrdersService，不创建旁路订单逻辑；
- PDP 顶部和底部表单共用同一个 variant resolver；
- 多行库存校验和预留保持现有事务语义；
- 请求重试幂等；
- 页面草稿按商品隔离；
- 传统 Checkout 行为保持可回归验证。

## 4. 非目标

本期不做：

- 把任意其他商品或跨商品套餐加入 PDP 表单；
- 替代购物车；
- 在线支付；
- 自动确认 COD 订单；
- 绕过 RPT/RECHECK 客服审核；
- 通过前端传入价格、折扣、风险或库存；
- 新增备注字段；参考站的 seller message 不属于现有 Checkout 必填信息；
- 在 Inline Form 内做 Related Product 加购；
- 将 Related Products 变成订单行推荐器。

## 5. 页面结构

PDP 与 LP 统一顺序：

```text
PDP First Screen
Sticky Product Section Navigation
Product Details
Specifications
Delivery & FAQs
Quick COD Order Form
Related Products
Reviews
```

Quick COD Order Form 内部顺序：

```text
Quick COD Order
Order items
Order summary
COD / Shipping / Delivery / Returns assurance row
Customer information
Delivery address
Preferred delivery date
Payment method: Cash on Delivery
REVIEW COD ORDER
```

导航与入口：

- PDP 顶部 `ORDER NOW` 平滑滚动并聚焦 `#quick-order`；
- 移动 Sticky CTA 的 ORDER NOW 执行相同行为；
- sticky section nav 增加 `Order Now`；
- 顶部评分继续链接 `#reviews`；
- Quick Order 顶部显示评分摘要和 `Read reviews` 链接；
- `/lp/[slug]` 使用相同表单和 attribution。

## 6. 共享 PDP 购买状态

### 6.1 Canonical first order line

新增统一 `PdpPurchaseProvider`，包住 PDP 顶部选择器和 Inline Form。**`orderLines[0]` 是购买选择、数量和确认的唯一可写真相**；顶部 PDP 只读写第一行，不再保存一份平行的 selectedValueIds/quantity。

每条 line 的 selection reducer 复用变体规格：

```text
selectedValueIds
explicitlyTouchedOptionIds
selectionSource
quantity
selectionRevision
confirmedCombinationKey
confirmedRevision
```

`resolvedVariant`、display media、price、inventory、URL 和 purchaseReady 均由纯 selectors 派生。第一行为空时，PDP 仅通过 `defaultDisplayVariant` 派生营销素材，不创建购买 SKU。

Provider 暴露明确 actions：

```text
selectOption(lineId, optionId, valueId)
confirmLine(lineId)
setQuantity(lineId, quantity)
addLine()
removeLine(lineId)
changeLineVariant(lineId)
```

不得用 effects 在 Provider 字段与 `primaryLine` 间双向同步。顶部改变选项/数量就是 dispatch 第一行 action；底部修改第一行使用同一个 action，因此不存在两份来源或反馈循环。

### 6.2 第一行继承规则

- 顾客在顶部手动完成选择：第一行使用 confirmed variant；
- 广告深链预选：第一行可显示预选，但标记 `needs confirmation`；
- 普通默认展示：只决定素材，不创建购买行；表单第一行显示 `Choose options`；
- 一个 selectable SKU：第一行可自动解析；
- 顶部 quantity 同步第一行；
- 第一行移除时，保留空的 `Choose options` 行，表单至少有一行编辑入口。

## 7. 多组合订单行

### 7.1 数据结构

Inline Form 本地订单行：

```text
InlineOrderLine
- clientLineId
- selectedValueIds
- explicitlyTouchedOptionIds
- selectionSource
- selectionRevision
- confirmedCombinationKey / confirmedRevision
- quantity (1..99)
```

variantId、skuId、labels、price、stock 与 media 全部从 Product payload 和 line selection 派生，不作为第二份可写 line state，也不复制价格或名称作为提交真相。

### 7.2 Add another option

点击后打开统一 Variant Picker：

- Color、Size 等 presentation 遵循变体规格；
- 不默认选择第一条 SKU；
- 完成所有选项后才能 Add line；
- 显示有效缩略图、价格、库存和售罄状态；
- 不存在组合禁用；
- 售罄组合可查看但不能添加；
- 取消不改变现有行。

### 7.3 重复 SKU

- 添加已存在 SKU 时不创建第二行；
- 合并数量并聚焦已有行；
- 合并后数量不得超过 99 或当前可用库存；
- 库存可能变化，最终仍由服务端校验；
- UI 提示 `Quantity updated`。

### 7.4 行操作

每行支持：

- Change options；
- quantity −/+；
- Remove；
- 查看 option labels、SKU、单价、compare-at、库存提示和缩略图；
- 第一行为空时不可移除最后编辑入口；
- 任一行变动使当前 confirmation modal 失效并关闭。

### 7.5 行数限制

订单创建 DTO 增加 `items.max(20)`。Inline Form 最多 20 个唯一 SKU；数量仍为每行 1–99。前后端同时限制，后端是权威边界。

## 8. 顾客与地址表单复用

### 8.1 提取共享组件

从现有 CheckoutForm 提取：

```text
useCheckoutCustomerForm
CheckoutCustomerFields
CheckoutAddressFields
CheckoutPreferredDateField
CheckoutAssuranceRow
```

共享内容包括：

- 初始值；
- 字段级验证与 blur revalidation；
- 菲律宾手机号格式；
- PSGC province/city/barangay 级联；
- 可搜索下拉；
- 下游地址重置；
- 邮编自动匹配与手动修改保护；
- Use my location；
- preferred date 默认值、范围和周日限制；
- COD payment 展示；
- 错误聚焦。

这些组件必须组合现有实现，而不是复制：`validateCheckoutForm`、`validatePreferredDate`、`CHECKOUT_FIELD_ORDER`、`PsgcAddressSelects`、`lookupPostalCode`、`reverseGeocode`、`defaultPreferredDeliveryDate` 和 `CheckoutTrustStrip` 继续是各自规则的唯一实现。新的 hook 只编排现有 helpers 与共享 state。

Checkout route 和 Inline Form 都使用这些组件，禁止复制 JSX 和 handlers 后各自演化。Quick Order 的完整地址岛在 `#quick-order` 接近视口或用户点 ORDER NOW 后才 hydrate/load；province 列表可内置，municipality/postal 数据按选择或 dynamic import 分片，不能让每个 PDP 浏览者都下载完整地址 JSON。

preferred-date bounds 不只在 mount 计算：打开 Review、`pageshow`/visibility 回前台及提交前重新按 Asia/Manila 当日计算；跨午夜后旧默认日期若失效，字段显示错误并要求重选，不能等后端 400。

### 8.2 字段

复用现有 Checkout 字段：

- Full name，必填；
- Phone，必填；
- Province，必填；
- City/Municipality，必填；
- Street address，必填；
- Barangay，沿用当前实际校验规则；
- Postal code，沿用当前实际校验规则；
- Landmark，可选；
- Preferred delivery date，可选但默认预填；
- Cash on Delivery，唯一支付方式。

规格和代码若对 barangay/postal 必填性描述不一致，以当前 DTO/验证实现为迁移基线；统一计划阶段必须明确最终规则并让 Checkout 与 Inline 保持一致，不能趁此功能单独改变地址业务规则。

## 9. 草稿持久化

### 9.1 顾客资料草稿

继续使用并版本化现有 `checkoutDraft.ts` 和 `luwag_checkout_draft` contract；不得另建第二个顾客地址 key。现有 key 已保存 customer、preferred date、savedAt，CheckoutConfirmView 依赖它。共享 hook 通过现有 `readCheckoutDraft/writeCheckoutDraft/clearCheckoutDraft` 访问，必要的 schema version 在同一模块内向后兼容读取。

规则：

- tab-scoped sessionStorage、fail-soft；
- 只在 client effect 中恢复，禁止 server render/useState initializer 读取；
- 超过 24 小时丢弃；
- 订单成功后沿用当前隐私规则清除完整顾客草稿，不在共享设备保留姓名、电话和地址；
- `lastOrderPhone` 只保留现有查单所需的最小、tab-scoped 值；
- Checkout/Confirm 与 Inline 部署期间读写同一 key，旧标签页不会丢地址。

### 9.2 商品草稿

Inline 商品行按 productId 隔离：

```text
luwag:inline-order:<productId>:v1
```

包含：

- line selection intents 与 quantities；
- confirmation state 不持久化；
- outcome-unknown submission 的 idempotency key、fingerprint 和 `SUBMITTING/UNKNOWN` 状态；
- savedAt。

恢复规则：

- 在 hydration 后的 effect 中读取，再通过同一个 reducer dispatch restore；
- 有效 `?variant=` 的显式 deep link 优先于旧商品草稿：它替换第一行选择并丢弃冲突的旧商品行；顾客地址草稿仍恢复；
- 无 deep link 时恢复 product draft；
- 重新验证每个 variant/SKU 是否仍存在且 active；
- 失效行保留可见错误，不静默替换；
- 库存和价格始终取当前 API 数据；
- 超过 24 小时且无 UNKNOWN submission 的商品草稿丢弃；
- UNKNOWN submission 必须保留原 idempotency key，刷新后只能用同 key 查询/重试，不能生成新 key；
- 进入其他商品时只读取对应 productId；
- 从 Related Product 返回时可恢复；
- 成功下单后清当前 product draft并清完整 checkout customer draft。

## 10. 订单摘要与页内确认

### 10.1 常驻摘要

表单中持续显示：

- 每行当前 price × quantity；
- compare-at 节省金额，仅展示不二次抵扣；
- subtotal；
- shipping fee；
- total；
- COD；
- 当前地址完整性。

前端金额只用于预览。提交 payload 不包含信任的单价、subtotal、discount 或 total。

### 10.2 REVIEW COD ORDER

按钮启用条件：

- 至少一条非占位订单行；
- 每条非占位行都必须有效、已确认且当前可购买；
- 所有非占位行 SKU 唯一；
- 所有数量有效；
- 空的 `Choose options` 占位行只能作为唯一编辑入口存在，此时 Review 保持禁用；不得让空/失效占位行与其他可购买行一起进入确认；
- 顾客与地址验证通过；
- preferred date 有效；
- 无正在定位、上传或其他 blocking state。

点击时：

1. 执行全部订单行和顾客表单验证；
2. 错误时滚动并聚焦第一处；
3. 用**全部且仅有**通过验证的非占位行生成确认快照，后续 payload 必须使用同一快照，不得静默漏行或另行重建；
4. 触发一次 InitiateCheckout；
5. 打开桌面 Modal / 移动 Bottom Sheet。

### 10.3 确认面板

显示：

- 每行缩略图；
- Color/Size 等结构化 options；
- SKU、quantity、price；
- subtotal、shipping、total；
- 姓名、手机；
- 完整地址与现有 lazy Google Maps preview；
- preferred delivery date；
- COD；
- `BACK TO EDIT`；
- `CONFIRM & PLACE COD ORDER`。

面板打开后底层滚动锁定、焦点陷阱、Esc/×/backdrop 关闭；关闭后焦点回 REVIEW 按钮。

确认内容必须抽成共享 `OrderReviewContent`：现有 `/checkout/confirm` 页面和 Inline Modal/Bottom Sheet 传入不同 shell、复用同一商品行、totals、地址格式、Google Maps、COD 文案、错误展示和最终提交 controller。不得在 `CheckoutConfirmView` 与 `InlineOrderConfirmDialog` 各复制一套确认 UI。

## 11. 下单提交与成功交接

### 11.1 Payload

确认后构造现有订单输入：

```text
customer
items[] = { skuId, quantity }
attribution
preferredDeliveryDate
```

不传：

- client price/total；
- risk；
- confirmation status；
- inventory；
- product/variant names；
- media URL。

### 11.2 现有服务不变量

Inline 必须继续经过同一个 Storefront OrdersController/OrdersService：

- canonical phone；
- customer upsert；
- Product ACTIVE；
- SKU ACTIVE、priced；
- 全行库存校验；
- server-side price/total；
- address snapshot；
- product/SKU/variant snapshots；
- attribution snapshot；
- COD_PENDING payment；
- NEW history；
- inventory reservation；
- NEW/AGAIN/RPT/RECHECK；
- POSSIBLE_DUPLICATE flags；
- NEEDS_REVIEW；
- order number generation。

Inline 不新增旁路 endpoint；如需 header idempotency，由现有 POST controller 读取并传给同一 checkout service。

### 11.3 成功

API 成功后：

- 写 `lastOrderTotal`；
- 写 `lastPreferredDate`；
- 写 `lastOrderPhone`；
- 清当前 inline product draft 和完整 checkout customer draft；
- 清本次 InitiateCheckout guard；
- 不删除 cart items；
- 跳 `/order-success/<orderNumber>`；
- Purchase 由 success 页面发送，但必须新增 `orderNumber` 级 sessionStorage/localStorage 去重标记或稳定 event_id；刷新、Back/Forward 和 React remount 不得重复上报同一订单；
- 成功文案继续是 Order received，不声称客服已确认。

### 11.4 失败

Orders boundary 先统一稳定错误 contract，Inline 和传统 Checkout 共用：

```text
{ code, message, details? }

VALIDATION_ERROR            400  fieldErrors
SKU_UNAVAILABLE             409  { skuId }
INSUFFICIENT_STOCK          409  { skuId, requested, available }
IDEMPOTENCY_CONFLICT        409
ORDER_SUBMISSION_UNKNOWN    client-only state
```

处理：

- VALIDATION_ERROR：关闭确认面板并定位字段；
- SKU_UNAVAILABLE/INSUFFICIENT_STOCK：保留表单，刷新并高亮具体订单行；
- IDEMPOTENCY_CONFLICT：禁止盲重试，提示刷新/联系客服；
- 网络明确失败：保留 modal 和 idempotency key，可重试；
- 网络结果不明确：持久化 UNKNOWN，使用相同 idempotency key 查询/重试；
- 传统 Checkout 也迁移到同一 error adapter，不能一边返回 statusless Error、一边依赖 HTTP status 分支；
- 不自动创建第二张订单，不清草稿、不跳成功页、不发 Purchase。

## 12. 服务端幂等

### 12.1 数据模型

Order 增加：

```text
idempotencyKey          String? @unique
idempotencyFingerprint  String?
```

旧订单允许 null。第一阶段 backend **可选接受** UUID key，兼容已打开的旧 Checkout bundle；所有 Storefront 调用迁移到共享 submission adapter 并验证后，后续发布才强制 key。后台人工 New Order 也由 adapter 生成 key，避免形成永久旁路。

### 12.2 共享传输适配器

扩展现有 `api.createOrder`，而不是 Inline 自己 fetch：

```text
createOrder(payload, { idempotencyKey })
```

底层 response error 必须保留 HTTP status、稳定 `code` 和 `details`。传统 CheckoutConfirmView 与 Inline confirmation 共用 `orderSubmission` controller；该 controller 负责 header、typed errors、success session handoff 和 UNKNOWN 状态。

### 12.3 客户端 key 生命周期

- 生成确认快照时生成 UUID，并在发请求前把 key、canonical fingerprint 和状态持久化到对应 draft；
- 只要 customer/items/date/attribution 语义未变化，关闭重开、retry、refresh 和浏览器恢复都复用；
- 任一语义字段变化，生成新 revision/key，但若旧请求处于 UNKNOWN，必须先解决旧 key，不能直接再提交新 key；
- POST 前状态 `SUBMITTING`，响应丢失/页面重载恢复为 `UNKNOWN`；
- 成功后清 key/draft；
- 提交中按钮锁定只是 UX，持久 key 才是正确性边界。

### 12.4 服务端 canonicalization

1. Zod 校验 1–20 行、单输入 quantity 1–99；
2. 规范化电话；
3. 按 skuId 合并重复行；
4. **合并后重新校验每个 quantity 仍为 1–99**，超过则 400；
5. 按 skuId 稳定排序；
6. 对规范化 customer/items/date/attribution 计算 SHA-256 fingerprint。

### 12.5 原子订单事务

当前 order/reservation 先提交、risk/NEEDS_REVIEW/duplicate 后处理的边界必须重构。新订单事务必须原子包含：

- customer upsert；
- bulk SKU/product/price lookup；
- 按稳定 skuId 顺序锁定/读取库存；
- 全行库存检查；
- order/address/items/attribution/payment/history；
- batched inventory guarded updates、reservations 和 movements；
- risk classification snapshot/log；
- NEEDS_REVIEW 状态；
- POSSIBLE_DUPLICATE flags；
- idempotency key/fingerprint。

20 行路径不得使用当前每行多次串行查询/四次 reserve statements；使用一次 findMany、确定顺序的锁/校验和 createMany/批量 SQL，减少持锁时间。任何必需 side effect 失败，整个事务回滚；commit 后 replay 才能安全直接返回原订单。

### 12.6 Replay 与并发

1. key 已存在且 fingerprint 相同：返回原订单，不重复预留/风险/单号；
2. key 已存在且 fingerprint 不同：409 IDEMPOTENCY_CONFLICT；
3. key 不存在：执行原子订单事务；
4. 并发唯一冲突必须让 interactive transaction 失败并退出；在事务外捕获 Prisma P2002，再用 root client 读取现有 order、比较 fingerprint并返回/409；不得在已 aborted transaction 中查询；
5. 因事务原子，数据库中不存在“Order 已提交但 risk 未完成”的成功状态；若未来改成 outbox，必须先新增显式 completion state 和可重放 finalizer，不能静默放宽本不变量。

幂等与 24 小时 POSSIBLE_DUPLICATE 不相互替代：前者表示同一次提交重放，后者表示顾客真实再次下单。

## 13. Attribution 与追踪

### 13.1 Attribution

提交时从当前 PDP/LP URL 和现有 first/last-touch 存储读取：

- landingPageId；
- utm_source / medium / campaign / content / term；
- fbclid 或对应现有字段；
- sourceType。

Inline 位于原始广告 URL，不能在滚动或打开 modal 时丢失 query attribution。

### 13.2 事件

```text
ViewContent                 页面原有，一次
inline_order_start          首次聚焦字段或点顶部 ORDER NOW
option_select               选择颜色/尺寸
inline_order_line_add       成功添加唯一 SKU 行
InitiateCheckout            打开有效确认面板时，一次/草稿版本
inline_order_submit         点击最终确认
Purchase                    API 成功并进入 success 后
```

约束：

- 页面渲染不触发 InitiateCheckout；
- 打开/关闭 picker 不触发 AddToCart；
- Inline Order 不触发 AddToCart，因为没有加入购物车；
- submit 失败不触发 Purchase；
- idempotent replay 与 success-page `orderNumber` event marker 共同保证 Purchase 不重复；必须先补 marker，不能假设现有组件已去重；
- 商品/变体 IDs 与 Meta Catalog 使用最终 SKU ID。

### 13.3 指标

运营报表至少区分 `checkout_route` 与 `pdp_inline`：

- form start rate；
- valid review rate；
- submit success rate；
- validation error by field；
- stock conflict；
- duplicate replay；
- POSSIBLE_DUPLICATE；
- NEEDS_REVIEW；
- confirmation、cancel、refusal rates；
- revenue/order 与广告 campaign。

提高订单数但显著恶化取消/拒收率不视为成功。

## 14. Related Products 与草稿安全

Related Products 位于表单后、评论前。风险是顾客点击其他商品后离开当前表单。

保护措施：

- 行与顾客资料变更后节流写入 sessionStorage；
- Related Product 使用正常软导航；
- 返回当前商品恢复草稿；
- 不弹阻断式 beforeunload；
- 不把当前商品行带到新商品；
- 顶部和表单保留 `Read reviews` 锚点；
- Related 卡片不直接修改当前 Inline Order；
- Related 多变体 Add to Cart 仍走 Quick Add picker，与当前表单隔离。

## 15. 组件边界

建议新增/提取：

```text
components/product/PdpPurchaseProvider.tsx
components/product/InlineCodOrderForm.tsx
components/product/InlineOrderLines.tsx
components/product/VariantPicker.tsx
components/checkout/OrderReviewContent.tsx
components/checkout/OrderConfirmationShell.tsx
components/checkout/useCheckoutCustomerForm.ts
components/checkout/CheckoutCustomerFields.tsx
components/checkout/CheckoutAddressFields.tsx
lib/inlineOrderDraft.ts
lib/orderSubmission.ts
```

职责：

- Provider：canonical `orderLines[0]` 与顶部 PDP；
- InlineOrderForm：行集合、表单编排、摘要；
- VariantPicker：从现有 QuickAddView 抽取并替换旧 picker，复用演进后的 `variantImages/sellableVariants`，全站只保留一个 resolver；
- shared checkout hook/components：组合现有 validation、PSGC、postal、geolocation、delivery helpers；
- `OrderPreview`/`totalsFor`/`CheckoutTotals` 扩展结构化 options 后由两条结账路径复用，禁止再写一套 subtotal/savings 算法；
- OrderReviewContent：传统 Confirm 页面与 Inline Modal/Bottom Sheet 共用确认内容；
- orderSubmission：扩展现有 `api.createOrder`，负责 idempotency header、typed error、UNKNOWN、成功 session handoff；
- API 与服务器仍为权威。

`PdpView` 作为 server component 可用一个 client provider 包裹 server-rendered children；实施计划必须遵循 Next 16 当前项目模式并阅读本地 Next docs，不把整页无必要地改成 client component。

## 16. 可访问性与移动端

- `#quick-order` 支持 sticky header scroll margin；
- ORDER NOW 滚动后焦点进入 Form heading 或首个缺失选项；
- 行列表使用语义化 list；
- picker 使用 fieldset/legend、aria-pressed 和错误说明；
- Modal/Bottom Sheet 有 dialog label、焦点陷阱、Esc、关闭焦点归还；
- 确认摘要可由屏幕阅读器按行读取；
- quantity buttons 有组合名称；
- 错误 live region 不重复播报；
- 375px 下单列布局，摘要和最终 CTA 清晰；
- 不用只靠颜色表示状态；
- reduced motion 下平滑滚动改为即时定位。

## 17. 校验与安全

前端校验提升体验，后端始终重验：

- items min 1/max 20；
- 每行 quantity 1–99；
- SKU UUID；
- duplicate SKU 规范化合并；
- customer string bounds；
- phone；
- preferred date；
- attribution bounds；
- active product/SKU；
- current server price；
- available inventory；
- idempotency key UUID；
- payload fingerprint。

Orders endpoint 是公开边界。现有或新增 throttle 应按真实客户端 IP、业务峰值和误伤风险设计；本期不默认加入 CAPTCHA。若上线后出现机器人订单，再以风险数据决定挑战策略。

## 18. 测试策略

### 18.1 订单服务

- 1/20/21 行 DTO 边界；
- quantity 1/99/100；
- 重复 SKU 合并后总量 99/100 边界；
- 多行使用 bulk SKU load/ordered inventory locks/batched reservation，任一库存不足整单回滚；
- server price 覆盖前端预览；
- order、reservation、structured snapshots、COD、history、risk、NEEDS_REVIEW、duplicate flags 与 idempotency 原子提交；
- 相同 key+相同 payload 返回同单；
- 相同 key+不同 payload 409；
- 并发同 key 只产生一个订单和一次全部 side effects；
- P2002 在事务外 root client replay；
- backend compatibility 阶段接受缺 key 旧客户端，强制阶段拒绝；
- refresh/outcome-unknown 复用持久 key；
- replay 不重复 side effects；
- 后台 New Order 回归。

### 18.2 共享表单

- Checkout 与 Inline 相同验证结果；
- PSGC reset；
- postal auto/manual；
- geolocation success/failure；
- preferred date 和跨 Asia/Manila 午夜重算；
- 旧 `luwag_checkout_draft` 与部署中旧标签恢复；
- 顾客 PII 成功后清理；
- draft restore/deep-link precedence/expiry/isolation；
- lazy address island 未访问时不下载全部 PSGC/postal payload；
- Related navigation round trip；
- 第一错误聚焦；
- Confirm 与 Inline 共用 OrderReviewContent/Google Maps。

### 18.3 购买状态

- 顶部与第一行双向同步；
- deep link 预选但需确认；
- Add another option；
- duplicate line merge；
- unavailable/OOS；
- 组合变动关闭旧 confirmation；
- 单 SKU；
- 多 SKU；
- 一行和多行提交。

### 18.4 追踪

- 页面加载不发 InitiateCheckout；
- 有效 modal 首开只发一次；
- 编辑后新快照可再发一次但无重复；
- submit failure 无 Purchase；
- success 恰好一次 Purchase，刷新/Back/Strict remount 不重复；
- attribution 保留；
- Inline 不发 AddToCart。

### 18.5 浏览器验收

- `/products/[slug]` 和 `/lp/[slug]`；
- 375/768/1280；
- ORDER NOW anchor；
- 表单→Related→Reviews 顺序；
- 多组合与缩略图；
- Modal/Bottom Sheet；
- 返回恢复；
- 网络断开后同 key retry；
- 成功页/查单；
- cart 未改变；
- 传统 `/checkout` 完整回归；
- 0 console/hydration errors。

## 19. 发布顺序

1. 生产备份并应用 additive Order idempotency migration，部署前 Prisma generate；
2. 部署 compatibility backend：key 可选、typed errors 可用、订单 side effects 原子化、旧客户端仍可下单；
3. 提取并回归现有 Checkout customer/address/order review primitives；
4. 扩展 shared `api.createOrder/orderSubmission`，迁移传统 Checkout 和后台 New Order 发送 key；
5. 部署变体/购买 Provider、Inline order lines 与 lazy form；
6. confirmation + success/Purchase dedupe；
7. 页面顺序、anchors、Related/Reviews 与 analytics；
8. 验证旧标签页和所有 callers 已迁移后，在后续发布强制 Storefront key；
9. 本地真实数据库/browser E2E；
10. 生产 backend/frontend 部署与小流量观察订单成功、重复、取消和拒收。

## 20. 成功标准

- PDP/LP 内可下同商品多个组合；
- 不跳 Checkout/Confirm 路由；
- 订单服务不变量全部保留；
- 同一提交重试不重复下单；
- 顶部和底部 SKU 永不分叉；
- Related 导航返回可恢复；
- Inline 与 Checkout 地址行为一致；
- 传统购物车 Checkout 无回归；
- attribution 和 Purchase 正确；
- 转化提升不以更高重复/拒收为代价。
