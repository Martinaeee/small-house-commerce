# 类目卡快捷加购 + 选款抽屉（Quick-Add Picker）设计

日期：2026-09-15
分支：`feat/plp-quick-add`（堆叠在线 B 阶段 1 `feat/checkout-category` 之上，合入顺序：先 B1 后本支）
参考：竞品（Temu 式）类目卡购物车按钮 → 右侧抽屉选款式 → Confirm；`2026-09-15-checkout-plp-cart-drawer-design.md`（阶段 1 购物车抽屉）

## 1. 目标与非目标

### 目标
1. 类目页（`/categories/[slug]`）网格卡片上的购物车按钮：
   - 商品**有 ≥2 个可售款式**时，打开右侧抽屉的**选款视图**，用户选款式（缩略图+名称）、看价格/库存、选数量后 Confirm 加购；
   - 商品**恰好 1 个可售款式**时，维持阶段 1 行为：直接加购 1 件并打开抽屉；
   - **0 个可售款式**时，维持现状：整宽 View Details，无购物车按钮。
2. Confirm 成功后，**同一个抽屉原地切换为购物车视图**（不开关第二个 overlay）。
3. 组件按可复用方式设计，供第二波接入首页/搜索/集合页的服务端 `ProductCard`。

### 非目标（本期不做）
- 不接入首页 `(storefront)/page.tsx`、搜索 `/search`、集合 `/collections/[slug]`（三者使用线 A 所属的服务端 `ProductCard`，第二波做 client wrapper 接入）。
- 不改 PDP（`PdpClient.tsx`，线 A 文件）及其页内款式选择器。
- 无后端/migration 改动：不建款式专属图字段、不建多维选项模型（见 §8）。
- 不新增任何 Meta Pixel 事件；不改冻结的 COD/配送文案；零新 npm 依赖。

## 2. 现状事实（盘点结论，实现者须知）

- 列表接口的每个商品**已带全部款式**：`Product.variants: ProductVariant[]`，`ProductVariant = { id, name, position, sku: Sku | null }`，`Sku = { id, skuCode, price, compareAtPrice, availableInventory, ... }`；`availableInventory` 由后端实时计算（onHand − reserved）。列表与详情共用同一 `Product` 类型与同一后端 `STOREFRONT_SELECT`。
- 款式是**扁平单维列表**（一个款式名 ↔ 一个 SKU），没有颜色×尺寸矩阵。
- **没有款式专属图片字段**（`ProductImage` 仅挂在 Product 上）。类目卡现状按位置约定映射：款式 index ↔ `product.images[index]`（见 `PlpProductCard.tsx` 现有注释与代码）。
- `PlpProductCard.tsx`（client，线 B 文件）：卡面现有一排款式 pills；quickAdd 取当前选中款式 SKU、数量固定 1、调 `addItem({ skuId, quantity: 1 })`（默认开抽屉），busy/added 态与徽章逻辑齐备。
- `CartContext.addItem(input, opts?)`：`opts.openDrawer !== false` 时成功后置 `isOpen=true`，并在 await 前同步捕获 `drawerOpenerRef`（阶段 1 焦点修复）。
- `CartDrawer.tsx`：无 portal，`fixed inset-0 z-50` + 遮罩 `button` + 右滑 `aside`（max-w-400px）；已有滚锁、Esc、焦点陷阱、`takeDrawerOpener()` 焦点归还、9 个关闭出口统一走稳定 `handleClose`。
- PDP 的选择逻辑（首个可售款式默认选中、OOS 判断、PriceBox）内联在 `PdpClient.tsx`，**不可直接复用**，选款视图按本 spec 重新实现卡片场景所需的最小子集。

## 3. 用户交互规格

### 3.1 入口判定（卡片层）
- `sellableVariants = variants.filter(v => v.sku !== null && v.sku.price !== null)`。
- `sellableVariants.length === 0`：整宽 View Details（现状）。
- `=== 1`：购物车按钮点击 = 现状直接加购（`addItem({skuId, quantity:1})`，打开抽屉购物车视图）。
- `>= 2`：购物车按钮点击 = `openPicker(product)`，**不发任何像素事件、不加购**。

### 3.2 选款视图内容（自上而下）
1. 头部：右上 ×（关闭，走统一 handleClose）。
2. 商品区：大图（`PlaceholderImage` 兜底）、商品名（两行截断）、款式名（如 "Walnut"）。
3. 款式选择区：标题 "Color/Style"；每个款式一个缩略图按钮（含 `sku === null` 的款式，显示但 `disabled`，与 PDP 选择器禁用语义一致；OOS 但有 sku 的款式可选中查看）：
   - 缩略图映射与 `PlpProductCard` 现有逻辑**逐字一致**：variants 数组下标 i → `[...product.images].sort(sortOrder)[i]`，越界回退首图，无图用 `PlaceholderImage`；
   - `sku === null` 的款式按钮 `disabled`；
   - 选中款描边（设计 token，如 ring-2 ring-cta），`aria-pressed`；
   - 缩略图下方款式名（超长 truncate）。
4. 价格与库存：`PriceBox`（仅 PHP）；库存文案规则与 PDP 一致：`availableInventory <= 0` → "Out of Stock"；`<= 5` → `Only N left`；否则不显示。
5. 数量步进器：默认 1，最小 1，最大 = 当前选中 SKU 的 `availableInventory`（到顶 + 置灰）；OOS 时步进器整体禁用。
6. Confirm 按钮：
   - 可选且有库存：可点击，点击后 busy 态（禁用+spinner，同阶段 1 加购按钮模式）；
   - OOS：按钮禁用并显示 "Out of Stock"；
   - 成功：切换为购物车视图（§4）；
   - 失败（网络/409 库存不足等）：按钮上方行内错误（沿用抽屉行错误样式），文案固定为 "Sorry, we couldn't add that right now. Please try again."（新增 UI 文案，非冻结句），停留在选款视图，可重试；不切视图、不丢选择。
7. 辅助链接：商品名/大图点击进 PDP（软导航并关闭抽屉，与购物车视图内商品链接一致）。

### 3.3 切换为购物车视图
- Confirm 成功 → context `view` 由 `'picker'` 切 `'cart'`；购物车视图就是阶段 1 的 CartDrawer 全部现有内容（行、步进、推荐、CHECKOUT、服务条），不改其行为与文案。
- 购物车视图内的关闭/Continue shopping/CHECKOUT/商品链接行为全部不变。
- 在购物车视图再次触发任何卡片 openPicker（理论上需先关抽屉，不存在该路径；防御：openPicker 总是以 picker 视图重开）。

### 3.4 可访问性与焦点
- 选款视图与购物车视图共用同一 `aside`（`role="dialog"` 保留），视图切换不重建外壳 → 滚锁/陷阱/Esc 不中断。
- 打开时焦点进入选款视图第一个可交互元素（× 或首个款式按钮，取与阶段 1 购物车视图一致的落点）；Tab 陷阱规则不变（含"active 在面板外则拉回"）。
- 关闭后焦点归还卡片购物车按钮（阶段 1 opener 机制；卡片在网格中不卸载，天然成立）。
- 视图内切换（picker→cart）时焦点移到购物车视图首个控件（如 Continue shopping 或关闭按钮），避免焦点留在已卸载的 Confirm 上。
- 375px 宽：抽屉全宽滑入，内容纵向滚动；缩略图行横向 wrap 或横向滚动（实现时取与 400px 桌面一致的 wrap，超出自然换行）。

## 4. 技术设计

### 4.1 CartContext 增量（`components/cart/CartContext.tsx`）
新增（纯追加，不改既有 addItem 语义）：

```ts
type DrawerView = "cart" | "picker";
interface PickerState { product: Product; }
// context 增项：
view: DrawerView;          // 默认 "cart"
pickerProduct: Product | null;
openPicker: (product: Product) => void;  // setPickerProduct + setView("picker") + setIsOpen(true)
// closeCart / handleClose 关闭时清 pickerProduct、view 复位 "cart"
```

- `openPicker` 同样在同步调用期捕获 opener（复用阶段 1 的 drawerOpenerRef 逻辑；与 openCart 合并为一个内部打开函数或同构代码，实现者择优，不重复捕获）。
- `addItem` 成功分支：当调用方需要"留在当前流程"时用既有 `{ openDrawer: false }`；**视图切换由调用方（QuickAddView）在 await 成功后 `setView("cart")`**，context 不耦合选择器。
- 拒绝分支清 opener ref 的既有逻辑不变。

### 4.2 CartDrawer 双视图（`components/cart/CartDrawer.tsx`）
- 外壳（overlay/backdrop/aside/滚锁/陷阱/handleClose）保持单实例；`aside` 内：
  - `view === "cart"`：现有全部 JSX（原样搬运，包裹一层条件渲染，不改其内部）；
  - `view === "picker"`：`<QuickAddView product={pickerProduct} onAdded={() => setView("cart")} />`。
- `handleClose` 增加 `setPickerProduct(null); setView("cart")`（与现有清 confirmId/lineError 同一稳定回调，不在 effect 里 setState——延续阶段 1 rework 结论）。
- open effect 仍零 setState；初始 view 恒由打开动作（openCart/openPicker）决定。

### 4.3 QuickAddView（新文件 `components/cart/QuickAddView.tsx`，client）
- Props：`{ product: Product; onAdded: () => void }`。
- 本地状态：`selectedVariantId`（默认首个可售款式）、`qty`（1）、`busy`、`error`。
- 派生：`selectedVariant`、`sku`、`outOfStock`、`maxQty`；切款式时 qty 夹回 `[1, maxQty]`。
- Confirm：`await addItem({ skuId: sku.id, quantity: qty }, { openDrawer: false })`；成功后发 AddToCart 像素（见 §5）再 `onAdded()`；失败设 error。
- 图片映射工具：复用/抽出 PlpProductCard 现有的位置映射小函数（抽到 `lib/` 或卡片内导出，二选一，实现者按最小变动；两处行为必须一致）。

### 4.4 PlpProductCard 改造（`components/product/PlpProductCard.tsx`）
- **移除卡面款式 pills 行**（其功能迁入选款抽屉）；卡片不再需要 selectedIndex/卡面切图状态：主图固定为首图（或现状的首图逻辑），徽章、价格（代表性 SKU 的 PriceBox）、库存、评分、购物车按钮布局不变。
- 购物车按钮：
  - 1 个可售款式：现有 quickAdd（直加 1 件 + 像素 + 开抽屉购物车视图）；
  - ≥2 个可售款式：`openPicker(product)`，无像素；
  - 0 个：不出按钮（View Details 现状）。
- 像素：AddToCart 仍在**真实加购成功后**触发一次——单款式路径在卡片 quickAdd 内（现状），多款式路径在 QuickAddView Confirm 内；payload 与现状一致（content_ids=[skuId] 等既有字段）。打开选款抽屉不产生事件。

## 5. Meta Pixel 约束
- 四个既有事件调用点（ViewContent/AddToCart/InitiateCheckout/Purchase）不动。
- AddToCart 触发次数语义不变：**每次成功加购恰好一次**（无论从卡片直加还是弹窗 Confirm；数量步进不触发）。
- 抽屉/选款视图的打开、切换、关闭零像素请求。
- 无 `NEXT_PUBLIC_META_PIXEL_ID` 时 tracking 完全 no-op（既有行为）。

## 6. 错误与边界
- 全部款式 OOS 但存在 sku（availableInventory=0）：卡片可开选款视图吗？——**可以打开**（允许查看款式与图），Confirm 禁用；与 PDP"OOS 款式可选中查看"一致。判定"可售款式"仍以 `sku !== null && price !== null` 为准（OOS 不等于无 SKU）。
- 加购时库存被抢光（后端 4xx）：显示 §3.2 固定行内错误文案，留在选款视图；不新增刷新接口，用户关闭重开即取最新列表数据（dev 缓存粘连是已知环境特性，非本特性范围）。
- 加购中途关抽屉：请求不可取消（无 AbortController，与现状一致）；迟到响应在组件卸载后不得 setState（guard 或 promise 链忽略，沿用仓库既有模式）。
- 软导航（抽屉内点商品名进 PDP）：opener 可能脱离 DOM 的阶段 1 已知行为不变。

## 7. 验收（浏览器手测 + 三道门禁）
门禁：`npx tsc --noEmit`、`npx eslint src`（0 problems，不新增 eslint-disable）、`npm run build`。
浏览器（端口 3003，真实数据；必要时用 T14b 同款 route-mock 造多款式/缺货数据，不写库）：
1. 多款式卡点按钮 → 选款抽屉：缩略图与款式一一对应、切换时大图/价格/库存联动；缺图商品有占位图不裂图。
2. qty 步进上限 = availableInventory；OOS 款式/Confirm 禁用正确；`Only N left` 文案。
3. Confirm 加的是选中 SKU（购物车行款式名/价格正确）、数量正确；成功后原地变购物车视图，无第二遮罩/闪烁；body.overflow 恢复规则在两视图一致。
4. AddToCart：一次 Confirm 恰好一条入队；打开抽屉/切款式/关抽屉 0 条；单款式卡直加 1 条。
5. Esc/×/遮罩关闭后焦点回到该卡片按钮；Tab/Shift+Tab 陷阱在选款视图内成立；视图切换后焦点在车视图控件内。
6. 单款式卡直加行为与阶段 1 完全一致；0 可售款 View Details 不变。
7. 375px 与 1280px 布局；0 app console 错误（忽略已知 fbevents 假 ID 噪音）。
8. 首页/搜索/集合页行为零变化（本期不接入，回归确认）。

## 8. 远期候选（明确不在本期）
- 后端加可空 `ProductImage.variantId`（阶段 2 migration 候选，需与并行线串行打招呼），款式缩略图改为真实关联，位置映射降级为回退。
- 多维选项（颜色×尺寸）：需新 schema（选项组/SKU 矩阵）+ 后台录入 UI，另行立项。
- 第二波：`ProductCardClientWrapper`（小 client 岛，包住服务端 ProductCard 的按钮区）接入首页/搜索/集合，复用同一 QuickAddView；待线 A 收尾后协调。
