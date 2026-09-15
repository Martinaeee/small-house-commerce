# 线 B 设计：Checkout 修补 + 类目页增强 + 统一徽章 + 加购抽屉

Date: 2026-09-15
Branch/worktree: `feat/checkout-category` · `.claude/worktrees/checkout-category`（前端 3003，独立后端时 3010）
Status: 已与用户确认，待实现计划
规格依据：[CHECKOUT_SPEC.md](../../frontend/CHECKOUT_SPEC.md)、[COLLECTION_SPEC.md](../../frontend/COLLECTION_SPEC.md)、[TRACKING_SPEC.md](../../frontend/TRACKING_SPEC.md)、[BRAND_FOUNDATION_V1.md](../../BRAND_FOUNDATION_V1.md)、[PARALLEL_DEV_HANDOFF.md](../../PARALLEL_DEV_HANDOFF.md)

## 1. 背景与现状

线 B 负责 checkout、类目页（PLP）、购物车与追踪。现状盘点结论：

- **Checkout**（`components/checkout/CheckoutForm.tsx`，437 行）：游客 COD 主链路已完整——双入口（PDP Buy Now 的 `?skuId&qty&slug`；购物车 `?items=<id,id>` 只结算勾选行）、后端整单库存复核、前端缺货/空车/手改 URL 阻断、防连点、`InitiateCheckout`/`Purchase` Pixel + attribution 快照、成功页措辞 "Order Received"。
- **类目页**（`app/(storefront)/categories/[slug]/page.tsx` + `components/category/CategoryPlpClient.tsx` + `CategoryFilterSidebar.tsx` + `lib/plp.ts`）：SSR 第一页（48）+ 客户端拉全类目（≤240，5 页），纯前端排序/筛选，移动 drawer，bestseller/new 徽章来自真实集合成员，面包屑、root 子类 pill、hero 图、空态、metadata、on-demand revalidate 均已具备。
- **徽章**：`PlpProductCard` 左上角仅支持 `bestseller | new | null`，由 PLP 客户端读取 `best-sellers` / `new-arrivals` 两个集合成员生成。折扣通过价格栏划线价表达。
- **购物车基建**：`CartContext` 是游客购物车单一事实源，`addItem` 返回最新 `CartSummary`；`CartRecommendations` 已实现"畅销→跨类→同类、折扣优先、排除已购/缺货"的推荐算法，目前只用于购物车页。**加购抽屉不存在**；PDP 加购后只显示页内 "Added to cart"，类目卡加购后只显示卡片内 "Added"。
- **后台集合管理已存在**：`app/admin/(shell)/collections/page.tsx`（589 行）支持建集合、搜索添加成员、成员排序，前端常量 `NEW_BADGE_SLUG="new-arrivals"`、`BESTSELLER_BADGE_SLUG="best-sellers"` 标注了两个徽章来源集合。

## 2. 目标 / 非目标

### 目标

1. Checkout 对照 CHECKOUT_SPEC 补齐 P0 差距（手机校验、字段级错误、移动顺序、Buy Now 失败阻断）。
2. 类目页补 SEO 结构化数据、错误态、root 子类图卡、筛选状态进 URL。
3. 左上角徽章统一为"集合成员"单一机制：Best Seller / New / 活动文案三类，全部后台集合管理，**不显示 Save X%**（折扣只由划线价表达）。
4. 全站加购后弹出右侧购物车抽屉，含服务保障条、商品行、2–3 个推荐、小计与结账入口。
5. P1（需后端解冻）：订单留言 + 期望送达日期、类目介绍/SEO 字段、送达时效预估接口、后端手机错误文案对齐规格。

### 非目标（本轮明确不做）

- 后端重复单检测 / Double Check Workspace（CHECKOUT_SPEC §16 后半，另立项）。
- GPS 定位辅助（§9.1，规格本身可选）。
- 颜色圆点款式选择器（后台无颜色数据；保留现有文字 pill，未来加 Variant 颜色字段时另开）。
- 运费金额计算 / 免运费（业务规则未定；沿用 "COD — calculated at checkout"，不虚构免运费）。
- COLLECTION_SPEC 的 Scenario / Reviews / FAQ / 最终 CTA 等 CMS 重模块（landing page 系统已部分覆盖；需要时另开）。
- 任何生产环境部署或生产库 migration（届时单独请用户确认）。

## 3. 用户已确认的决策

| 决策点 | 结论 |
|---|---|
| 首页 `ProductCard`（线 A 独占） | 协商线 A 后改为快捷加购；线 A 不同意则首页维持 "Order Now" 跳详情，抽屉只在 PDP/类目弹 |
| 活动徽章配置方式 | 走集合机制：Collection 加 `badgeLabel` 可空字段，**不**给 Product 加字段 |
| 款式选择器形态 | 保留文字按钮（图片已随款式按位联动） |
| 抽屉 CHECKOUT 去向 | 先进 `/cart`（购物车页有勾选逻辑），不直达 /checkout |
| 左上角折扣徽章 | 不做 "Save X%"；折扣只由价格栏原价+划线价表达 |
| 服务保障条文案 | 只用真实承诺：COD 无需先付 / 全国配送 3–7 天 / 送达前电话确认 |

## 4. 阶段 1：纯前端 P0（无后端、无 migration）

### 4.1 Checkout 修补（全部在 `components/checkout/CheckoutForm.tsx`，可抽纯函数到 `lib/`）

- **C1 手机号前端校验**：新增 `lib/checkoutValidation.ts` 纯函数 `isValidPhilippineMobile(raw): boolean`，接受 `09XXXXXXXXX`（11 位）与 `+639XXXXXXXXX`（+63 + 10 位），规则与后端 `common/phone.util.ts` 的 `normalizePhilippinePhone` 对齐（动手前先读该 util 核对，避免两套正则漂移）。失焦或提交时校验；错误文案逐字使用 "Please enter a valid Philippine mobile number."。
- **C4 字段级错误**：name / phone / province / city / streetAddress 五个必填项内联红字提示（字段下方 `text-sale text-xs`，`role="alert"`），保留顶部错误条用于提交后错误（库存不足等）。必填空值文案沿用现有集合句的拆分版："Please enter your <field>."；手机非法用规格句。提交时一次性标出所有无效字段并滚动/聚焦第一个。
- **C2 移动模块顺序**：DOM 顺序按规格 §26：订单预览 → 联系信息 → 地址 → 订单摘要（含 COD 卡）→ PLACE ORDER。桌面端（lg）用 5 列 grid 保持"左 2 列预览+摘要、右 3 列表单"的现状视觉，CTA 桌面端仍在右下、移动端全宽贴底区域。实现方式：把现 `<aside>` 拆为 `OrderPreview` 与 `OrderSummary` 两个区块，用 Tailwind order/col-start 定位，不改卡片内部文案。
- **C3 Buy Now 健壮性**：`ready` 在 Buy Now 路径要求 `product !== null && productError === false && skuId 命中某 variant.sku`。解析失败显示独立错误态（图标 + "We couldn't load this item." + 返回该商品/继续购物两个链接），不再渲染可提交的空摘要表单。
- COD 卡片、配送时效原句、成功页与 Pixel 触发点**一字不动**。

### 4.2 类目页增强

- **P1 JSON-LD**：`categories/[slug]/page.tsx` 服务端注入三段 `<script type="application/ld+json">`，写法照 `components/product/PdpView.tsx` 既有先例：
  - `BreadcrumbList`（Home ›[parent] › node）；
  - `CollectionPage`（name、description 用现有派生文案、url）；
  - `ItemList`（首屏商品，numberOfItems；itemListElement 用 Product，含 image、offers(price/priceCurrency=PHP/availability)）。
- **P4 错误态区分**：`fetchFirstPage()` 返回 `null`（接口失败）与返回空页（真空类）分开。失败时客户端区域渲染错误卡："We couldn't load these products." + "Try again" 按钮（调用 `router.refresh()`）；真空类维持 "No products in this category yet."。`resolveCategory` 失败仍走 `notFound()` 不变。
- **P6 root 子类图卡**：node 有 children 时，children 中 `imageUrl` 非空的渲染响应式图片卡（grid-cols-2/3/4，图 4:3 + 名称叠加/下方），无图的 child 维持现有 pill；两形态可并存（有图的进卡片区，全无时退回纯 pill 行）。
- **P3 筛选状态进 URL**：`CategoryPlpClient` 以 URL query 为单一事实源：`sort`、`room`、`solutions`（逗号分隔）、`price`、`instock=1`。任何变更 `router.replace(`?…`, { scroll: false })`（替换历史栈，不污染后退）；初始 state 从 `useSearchParams()` 解析，非法值回退默认。组件用 `<Suspense>` 包裹（Next 16 对 useSearchParams 的 build 要求，动手前查 `node_modules/next/dist/docs/`）。`lib/plp.ts` 的纯函数签名不变。

### 4.3 统一徽章（前端部分；后端字段在阶段 2）

- `PlpProductCard` 的 `badge` prop 扩展为结构化值：`{ kind: "bestseller" | "new" | "promo"; label?: string } | Array<同> | null`（实现时定名，保持调用点可读）。渲染规则：
  - 左上角最多两枚徽章并排；优先级 promo > bestseller > new（有 promo 时展示 promo + 一枚身份徽章；参考图样式）。
  - promo 文案逐字取集合 `badgeLabel`；bestseller/new 文案固定 "Best Seller" / "New"。
  - 选中缺货款式 / 全无卖价 SKU 时，现有 "Out of Stock" 覆盖所有徽章，逻辑不变。
  - **不新增 Save% 徽章**；颜色沿用现有徽章底色体系（身份徽章 `bg-ink/85`、活动徽章用现有 `sale` 色 token，与全站例外一致）。
- `CategoryPlpClient` 的徽章集合成员获取，从"硬编码两个 slug"改为：
  1. 拉 `GET /storefront/collections?pageSize=50`，筛出 `badgeLabel` 非空的 ACTIVE 集合（取前 4 个，按 sortOrder）加上两个固定 slug 集合；
  2. 对每个集合并发拉成员 slug（每集合上限 3 页，复用现有 `fetchCollectionSlugs`，并发失败静默为空集）；
  3. 构建 slug → 徽章[] 映射。加载策略与现有 effect 一致（在拉剩余商品页同一轮并发完成）。
- 阶段 1 后端尚无 `badgeLabel` 字段时，前端先按"字段存在则用"写（API 类型里标可选）；阶段 2 上线前活动位无数据、行为与现状完全一致。

### 4.4 加购抽屉（新子系统，文件全部线 B 独占）

- **CartContext 扩展**（`components/cart/CartContext.tsx`）：context 增加 `isOpen: boolean`、`openCart()`、`closeCart()`。`addItem` 成功后自动 `openCart()`；跨标签 storage 同步触发的 reload 不开抽屉；提供 `addItemSilent` 或参数 `{ openDrawer?: boolean }` 供未来不需要弹窗的场景（默认开）。
- **新组件 `components/cart/CartDrawer.tsx`**（client）：
  - 右侧固定面板，宽 `max-w-[400px] w-full`，全高；左侧半透明遮罩点击关闭；`role="dialog" aria-modal="true" aria-label="Your cart"`。
  - 滚动锁、Escape 关闭、焦点陷阱与关闭后还焦，照 `components/layout/MainNav.tsx` 移动 drawer 既有模式实现。
  - 区块顺序：标题行 `YOUR CART (n)` + ×；服务保障条；可滚动商品区（含推荐）；底部固定结算区。
  - **服务保障条**（深色/浅色细条，三句，只用既有真实承诺）：`Cash on Delivery — no payment now` · `Nationwide delivery 3–7 days` · `Phone confirmation before delivery`。
  - 商品行：缩略图、名称（链 PDP）、款式名、数量步进（复用 `updateItem`，1 时减号触发删除并二次确认行内提示）、删除图标（`removeItem`）、行小计（PHP，`formatPrice`）。空车态：标题 "Your cart is empty" + Continue shopping。
  - **推荐 2–3 个**：把 `CartRecommendations.tsx` 里的数据池+排序纯逻辑抽为 `lib/useCartRecommendations.ts`（hook，输入 cart，输出 Product[]），购物车页原组件与抽屉共用；抽屉用纵向紧凑卡（图、名、折扣仅靠划线价、quick-add），与购物车页横向条是同 hook 的两个展示组件。推荐为空时整块不渲染（现有行为）。
  - 底部：Subtotal（PHP）、You save（购物车 summary 已有折扣字段则显示，否则不显示该行）、Shipping 文案沿用 checkout 现句 "COD — calculated at checkout"；主按钮 `CHECKOUT` → **`/cart`**；次按钮 "Continue shopping" 关闭抽屉。
  - 像素事件不新增：AddToCart 已在 PDP/卡片调用点触发，InitiateCheckout 仍由 /checkout 触发；抽屉本身不打事件。
- **挂载**：在共享 `app/(storefront)/layout.tsx` 加一行 `<CartDrawer />`（只加不改；按交接文档先在会话间通报线 A）。
- **触发覆盖**：PDP（`PdpClient.addToCart`，线 A 文件）和类目卡（`PlpProductCard.quickAdd`，线 A 拥有）成功后都走 context 的 `addItem`，抽屉自动开——两处只需（如尚未）确保调用的是 context 方法即可，零/最小改动；若需要任何改动，列入第 6 节协商项。

## 5. 阶段 2：后端解冻（共享库，串行 migration）

规则：每个 migration 动手前在会话间向线 A 打招呼确认无未提交 migration；只加可空列、不 reset；提示 drift 立即 STOP 报告。开发用本 worktree 独立后端：`PORT=3010 npm run start:dev`，前端 `API_TARGET=http://localhost:3010 PORT=3003 npm run dev`。后端先写 vitest（`new Service(prismaMock)` 风格）。

### 5.1 Migration 1 · orders：留言 + 期望送达日期

- Prisma：`Order.customerNote String?`（≤500，应用层校验）、`Order.preferredDeliveryDate DateTime? @db.Date`。
- `orders/dto/order.dto.ts`：`customerNote: z.string().max(500).nullable().optional()`；`preferredDeliveryDate: z.string().date()`（ISO yyyy-mm-dd），`.refine` 不早于明天、不晚于 30 天后，可空。service 落库（shippingAddress 同事务区域）；后台订单详情页展示两字段，中文标签与提示。
- 前端 checkout 在地址区下加可选 "Order note (optional)" textarea 与 "Preferred delivery date (optional)" date input（min=明天 max=+30 天，浏览器原生控件）；提交透传，不改变任何必填逻辑。
- CHECKOUT_SPEC §10 允许不带日期下单；字段全程可选。

### 5.2 送达时效预估（无 migration）

- 新 `backend/src/modules/shipping/`：`shipping.service.ts` 纯函数化规则——province/city 命中 Metro Manila（省名包含 "METRO MANILA" 或 NCR 市镇列表，代码内常量表并注释来源）→ 3–5 自然日；其余 → 5–7 自然日。返回 `{ estimated_delivery_start, estimated_delivery_end, available_dates: string[] }`（available_dates = 明天起 14 天内可选日期，跳过实现里注明的固定规则；不做物流日历）。
- `GET /api/v1/storefront/delivery/estimate?province=&city=`（参数缺失返回 400 或默认 5–7，实现时选 400 并在前端容忍失败）。
- vitest 覆盖：Metro Manila、外省、缺参、日期生成边界。
- 前端 checkout：province + city 非空后静默拉取（debounce/失焦触发），在地址区与摘要之间显示 "Estimated delivery: <date> – <date>"；失败静默不阻断下单。**COD 卡原有 "Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days." 原句一字不改**，新区块是增量信息。

### 5.3 Migration 2 · categories：介绍 + SEO 字段

- Prisma：`Category.description String?`、`Category.metaTitle String?`、`Category.metaDescription String?`。
- 后台类目表单加三个输入（多行描述 ≤1000；SEO 标题 ≤70、描述 ≤160 给字符计数），全部中文操作提示；admin/categories 接口与 DTO 放开。
- storefront categories 响应带出三字段（目前 storefront category mapper 选字段，需加入）；前端 `Category` 类型同步。
- PLP：hero 标题下渲染 description（prose 样式或纯段落）；`generateMetadata` 优先 metaTitle/metaDescription，空则回退现有派生逻辑。

### 5.4 Migration 3 · collections：活动角标字段

- Prisma：`Collection.badgeLabel String? @db.VarChar(20)`。
- DTO：`badgeLabel: z.string().max(20).nullable().optional()`；admin 集合新建/编辑表单加输入框，提示"填了角标文字后，该集合内商品在目录页显示此角标（例如 9.9 Sale）；留空则不显示角标，最多 20 个字符"。
- storefront 集合列表（`storefrontList` 的 select）带出 `badgeLabel`。
- 前端 `api.ts` 集合类型加可选 `badgeLabel`；配合 4.3 完成端到端。
- 运营流程：活动开始 → 新建/复用集合、填角标、加商品、ACTIVE；结束 → 清空角标或停用集合，全站角标消失。

### 5.5 后端手机错误文案对齐

- `orders.service.ts` 的 `BadRequestException` 文案改为规格句 "Please enter a valid Philippine mobile number."（更新对应 vitest）。归一化逻辑不变。

## 6. 跨线协商项（动之前在会话间通报）

| 文件 | 归属 | 改动 |
|---|---|---|
| `app/(storefront)/layout.tsx` | 共享 | +1 行 `<CartDrawer />`，只加不改 |
| `components/product/PlpProductCard.tsx` | 线 A 拥有 | badge prop 结构扩展；quickAdd 已用 context addItem，预期无需行为改动 |
| `components/product/PdpClient.tsx` | 线 A 独占 | addToCart 已调 context；抽屉自动弹，预期零改动 |
| `components/product/ProductCard.tsx`（首页"Order Now"） | 线 A 独占 | 协商改为客户端 quick-add + 弹抽屉；该卡是服务端组件，改造为独立小提交，线 A 拒绝则不做（首页维持跳详情） |
| `lib/api.ts`、`lib/tracking.ts` | 共享 | 只加类型/接口（delivery estimate、新字段），不改现有函数 |

合并：先 A 后 B（或先完成者先合），后合者 rebase 共享文件并跑前端 `tsc --noEmit && eslint`、后端 `vitest run`。

## 7. 数据流与接口

- 抽屉：`addItem → POST /storefront/carts/.../items`（现有）→ 返回 CartSummary → context setState + openCart；推荐 hook 依据新 cartKey 重新取 best-sellers + 目录首页（现有取数方式）。
- 徽章：PLP 挂载时 `GET /storefront/collections` → 取徽章集合 slug 列表 → 对每集合 `GET /storefront/collections/:slug/products?pageSize=24`（最多 3 页 × 最多 6 个集合）→ slug 映射。请求数在小目录规模可接受；全部并发、失败静默、结果只存 slug Set。
- 下单 payload 在现有 `{ customer, items, attribution }` 上增量加 `customerNote?`、`preferredDeliveryDate?`；旧后端忽略未知字段的兼容性需在实现时验证（NestJS zod 白名单默认拒绝未知字段——**因此 5.1 必须前后端同批部署，前端在 API 对接前不发送新字段**，用环境/能力判断或直接随阶段 2 一次发布）。

## 8. 错误处理

- Checkout：字段级（失焦+提交双重时机）、顶部条（提交后库存/网络错误，沿用现有 e.message 透传）、Buy Now 解析失败独立态。
- 抽屉：加购失败在触发处保留现有提示（PDP notice / 卡片静默可点 PDP）；数量更新失败回滚 context（reload）；推荐取数失败整块不渲染，不影响购物车主体。
- PLP：首屏接口失败错误卡可重试；成员/集合拉取全部失败 → 无徽章，商品网格正常；URL 参数非法静默回退默认。
- delivery estimate：失败静默，绝不可阻断 COD 下单。

## 9. 测试与验证

- 前端：`tsc --noEmit` + `eslint` + `next build`；纯函数（手机校验、URL 参数解析、徽章映射/优先级）放在 `lib/`，如有现成测试框架则补单测，否则至少保证 build 通过。
- 后端：shipping service、order DTO 新字段、phone 文案先写/改 vitest（`new Service(prismaMock)`）；`vitest run` 全绿。
- 浏览器手测（3003，对用户 3000 后端做阶段 1；阶段 2 切 3010）：
  - checkout：手机非法格式内联提示；移动窄屏模块顺序；Buy Now 坏 URL；留言/日期（阶段 2）；成功页 Purchase 仍触发；
  - PLP：筛选→URL→刷新恢复→后退；首屏失败错误态；root 子类图卡；JSON-LD 用 Rich Results 校验；
  - 徽章：集合成员变化后徽章随 revalidate 更新；活动徽章并排展示；缺货 OOS 覆盖；
  - 抽屉：三处加购弹出、步进/删除、推荐 quick-add、CHECKOUT 进 /cart、Esc/遮罩/焦点陷阱、滚动锁、空车态。
- 不在共享库留测试数据（测试集合/订单/留言验证完即清或停用）。

## 10. 约束

零新 npm 依赖；只用 Tailwind 设计 token（既有 `sale` 色例外沿用）；价格只显示 PHP；COD 与配送既有文案一字不改；Pixel 四个事件继续触发；不做 wishlist/心形；新后台字段配中文操作提示；提交只在 `feat/checkout-category`，`git add <显式路径>`，禁止 `-A`；Next 16 行为先查 `frontend/node_modules/next/dist/docs/`。

## 11. 落地顺序建议（实现计划再细化）

1. 阶段 1 checkout P0（C1/C4 → C2 → C3）。
2. 阶段 1 PLP（JSON-LD → 错误态 → 子类图卡 → URL 状态）。
3. CartContext 扩展 + CartDrawer + 推荐 hook 抽取 + layout 挂载通报。
4. 徽章前端结构改造（含 4.3，字段可选先行）。
5. 通报线 A 后协商 ProductCard。
6. 阶段 2 三条 migration（每条前打招呼，串行）→ shipping 模块 → 后端测试 → 前端对接。
7. 全量验证、清理测试数据、等用户确认后再谈部署。
