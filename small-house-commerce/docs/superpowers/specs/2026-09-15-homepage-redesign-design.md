# 首页全量改版设计（LUWAG Homepage CMS）

Date: 2026-09-15
Branch: `feat/home-pdp`（线 A，worktree `.claude/worktrees/home-pdp`，前端端口 3002）
Status: 设计已逐节确认，待 spec 审阅
Spec 依据: `docs/frontend/HOMEPAGE_SPEC.md`（旧稿，部分条款与现行硬约束冲突，以本文为准）、`docs/frontend/home.jpeg`（仅版式参考）、`docs/BRAND_FOUNDATION_V1.md`

---

## 1. 目标与范围

把首页从"半硬编码的 6 区块页面"升级为 HOMEPAGE_SPEC §5 的全量区块页面，并提供首页专属的区块化 CMS（排序、开关、文案、媒体、选品全部后台可配），前台按配置渲染。

### 1.1 本期做

- 通用 `HomepageSection` CMS：两张表、一次 migration、NestJS 新 `cms` 模块、admin「首页装修」屏幕。
- 首页 17 个 IA 槽位的渲染组件（见 §3）。
- 图片/视频 Hero；移动端四项底部导航；Recently Viewed；SEO/JSON-LD；首页分析事件（Meta Pixel trackCustom）。
- 默认 seed：一套符合 spec §5 顺序的默认区块，无媒体时回退现有奶油色渐变文字 Hero。

### 1.2 本期不做（显式排除）

- **Wishlist / 心形图标**：硬约束禁止。spec §6/§9/§15 中所有 wishlist 条款不实现；移动底部导航为 Home/Categories/Search/Account 四项；商品卡不加收藏按钮。
- **假内容**：不伪造任何客户评价、UGC 照片、人名。UGC / Room Inspiration / Hero Product Story 三个区块在无真实内容时渲染中性占位卡（见 §4.4）。
- **Recommended Products 独立推荐模块**：无规则推荐后端，不做假模块；推荐位由 PRODUCT_GRID 区块承担。spec §21 的规则/AI 推荐以后单独立项。
- 账号系统新功能：login/register/account 页面已存在，只做链接。
- AI 推荐、容错/同义词搜索、搜索分析。
- USP TrustBar 文案保持现有四条不改（决策见 §7）。

---

## 2. 硬约束（沿用 PARALLEL_DEV_HANDOFF §硬约束）

- 零新 npm 依赖；样式只用 `globals.css` 既有 Tailwind token（`primary/primary-light/cta/cta-hover/ink/ink-secondary/ink-muted/sale/border/card/background`，外加既有例外 `text-sale/border-sale/bg-sale`），组件内禁止 hex。
- 价格只显示 PHP；COD 与配送既有文案一字不改（Metro Manila 3–5 days, provinces 5–7 days, Cash on Delivery）。
- Meta Pixel 标准事件（ViewContent/AddToCart/InitiateCheckout/Purchase）行为不变；新增事件只用 `trackCustom`。
- 后端 ESM `.js` specifier；Prisma split schema；`@map("snake_case")`、`@@map("plural_snake")`、`@db.Uuid`（`uuid(7)`）、`@db.Timestamptz(3)`，对齐既有 schema。
- 后端测试：纯函数/`new Service(prismaMock)` 风格 vitest。前端验证：`tsc --noEmit` + eslint + `next build` + 浏览器手动验收。
- 包管理 pnpm；后端命令在 `small-house-commerce/backend`，前端在 `small-house-commerce/frontend`。
- migration 串行：动手前查 `prisma migrate status` 并在线 B 会话确认无未提交 migration；禁止 reset；提示 drift 立即 STOP。
- 提交只在 feature 分支，`git add <显式路径>`，禁止 `git add -A`。
- 不留测试数据。

---

## 3. 信息架构与区块清单

按 HOMEPAGE_SPEC §5，槽位 1/2（Announcement、Header）与 17（Footer）由现有 layout 承担，不在 CMS 内。CMS 驱动槽位 3–16：

| # | IA 槽位 | section type | 默认内容来源 |
|---|---|---|---|
| 3 | Hero | `HERO` | 默认文案（§5.1），无媒体 → 渐变文字版 |
| 4 | USP Trust Bar | `USP` | 现有 TrustBar 四条（payload 留空即用默认） |
| 5 | Shop by Category | `CATEGORY_TILES` | seed 选前 6 个 ACTIVE 顶层 category |
| 6 | Small-Space Favorites | `PRODUCT_GRID` | 默认空选品（占位） |
| 7 | Made For Real Small Spaces | `PRODUCT_STORY` | 空 → 占位卡 |
| 8 | Shop by Solution | `SOLUTIONS` | 现有 6 个方案卡（迁入 payload） |
| 9 | Hero Product Story | `PRODUCT_STORY` | 空 → 占位卡 |
| 10 | Small Upgrades | `PRODUCT_GRID` | 默认空选品（占位） |
| 11 | Room Inspiration | `ROOM_INSPIRATION` | 空 → 占位卡 |
| 12 | Real Homes / UGC | `UGC` | 空 → 占位卡 |
| 13 | Recently Viewed | 非 CMS | 前端岛屿，localStorage；无记录不渲染 |
| 14 | Recommended Products | 非 CMS | 不做（§1.2） |
| 15 | Brand Story | `BRAND_STORY` | 现有品牌故事文案，按 BRAND_FOUNDATION §3.4 修订 |
| 16 | Purchase Confidence | `CONFIDENCE` | 现有购买保障文案 |

说明：同一 type 可出现多条（如 PRODUCT_STORY 占槽位 7 和 9），故 `type` 不加 unique，数量由应用层限额校验（admin 写接口 400）：

- 限 1 条：HERO / USP / CATEGORY_TILES / SOLUTIONS / ROOM_INSPIRATION / UGC / BRAND_STORY / CONFIDENCE
- 限 2 条：PRODUCT_STORY（槽位 7、9）
- 限 3 条：PRODUCT_GRID（槽位 6 Favorites、10 Small Upgrades，第 3 条留给运营自行新增，如 Best Sellers）

seed 默认建两条 PRODUCT_GRID（Small-Space Favorites、Small Upgrades，均空选品），不预置第三条。

---

## 4. 后端设计：`cms` 模块

### 4.1 Schema（新文件 `prisma/schema/homepage.prisma`）

```prisma
enum HomepageSectionType {
  HERO
  USP
  CATEGORY_TILES
  PRODUCT_GRID
  SOLUTIONS
  PRODUCT_STORY
  ROOM_INSPIRATION
  UGC
  BRAND_STORY
  CONFIDENCE
}

model HomepageSection {
  id        String              @id @default(uuid(7)) @db.Uuid
  type      HomepageSectionType
  title     String?
  subtitle  String?
  enabled   Boolean             @default(true)
  sortOrder Int                 @default(0) @map("sort_order")
  payload   Json?
  createdAt DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)

  products HomepageSectionProduct[]

  @@index([enabled, sortOrder])
  @@map("homepage_sections")
}

model HomepageSectionProduct {
  id        String @id @default(uuid(7)) @db.Uuid
  sectionId String @map("section_id") @db.Uuid
  productId String @map("product_id") @db.Uuid
  sortOrder Int    @default(0) @map("sort_order")
  badge     String?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  section HomepageSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  product Product         @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([sectionId, productId])
  @@index([productId])
  @@map("homepage_section_products")
}
```

`Product` 上增加反向关系 `homepageSections HomepageSectionProduct[]`（catalog.prisma，只加关系字段）。

一次 migration：`prisma migrate dev --name add_homepage_sections`。

### 4.2 payload zod schemas（`src/modules/cms/dto/homepage-section.dto.ts`）

所有 payload 为「全可选 + 留空回退默认」，按 type discriminate：

- `HERO`：`{ desktopImage?: string(url), mobileImage?: string(url), videoUrl?: string(url), posterImage?: string(url), ctaPrimaryText?, ctaPrimaryLink?, ctaSecondaryText?, ctaSecondaryLink? }`（文案 ≤120，链接以 `/` 开头的站内路径或 https URL）。title/subtitle 用列字段。
- `USP`：`{ items?: Array<{ icon?: "shield"|"home"|"lock"|"truck", label: string, sub?: string }> }`，≤4。
- `CATEGORY_TILES`：`{ categoryIds: string[] }`，≤6（UUID）。
- `SOLUTIONS`：`{ items: Array<{ title: string, blurb?: string, link: string }> }`，≤6。
- `PRODUCT_GRID`：payload 空（商品走关联表），预留 `{ columns?: 2|4 }`。
- `PRODUCT_STORY`：`{ imageUrl?, heading?, body?, ctaText?, ctaLink?, productId? }`。
- `ROOM_INSPIRATION`：`{ imageUrl?, heading?, body?, productIds?: string[] }`（productIds 仅用于 Shop this room 链接，展示商品仍受可售过滤；注：为避免与关联表语义重叠，ROOM 内商品也可直接复用关联表——实现时统一用关联表，payload 不放 productIds）。
- `UGC`：`{ entries: Array<{ imageUrl?, name: string, location?, comment: string, productId? }> }`，≤6。
- `BRAND_STORY` / `CONFIDENCE`：`{ heading?, body?, bullets?: string[] }`。

整列表保存 DTO：`Array<{ id?, type?, title?, subtitle?, enabled, sortOrder, payload? }>`；新建/单例数量规则在 service 校验（§3 表的限额），违例 400。

### 4.3 Service（`src/modules/cms/homepage.service.ts`）

- `storefrontGet()`：查 enabled/sortOrder；按 type 分别 hydrate：
  - PRODUCT_GRID：关联商品只保留 `status=ACTIVE` 且至少一个 SKU 可售（复用 ProductsService 的库存判定口径），附带 `ratingAverage/reviewCount`（复用 ReviewsService.summaryForProducts），按关联 sortOrder；过滤后为空的区块仍返回（前端显示占位/空态）。
  - CATEGORY_TILES：校验 category 存在且 ACTIVE，带 imageUrl；失效 id 跳过。
  - UGC/PRODUCT_STORY/ROOM_INSPIRATION 中的 productId：存在才附带商品摘要（slug/name/price/image），否则忽略该字段。
  - payload 原样透传（已在写入时校验）。
- admin：`listAll()`、`saveSections(input)`（事务内 upsert/reorder，受单例限额）、`setSectionProducts(sectionId, rows)`（事务内全量替换，校验商品存在）。
- storefront 响应 DTO 中绝不暴露内部字段；不返回 disabled 区块。

### 4.4 Controller / 模块 / revalidation

- 新模块 `src/modules/cms/cms.module.ts`；controller：
  - `GET /api/v1/storefront/homepage`（公开）
  - `GET /api/v1/admin/homepage/sections`
  - `PATCH /api/v1/admin/homepage/sections`
  - `PUT /api/v1/admin/homepage/sections/:id/products`
- Admin 路由复用现有 JWT + PermissionsGuard；permission 优先复用现有内容类权限（实现时查 `PermissionCode` 枚举；若仅有 PRODUCT_MANAGE 类，则复用最贴近的一个，不新增权限；在 plan 中记录实际选择）。
- 所有 admin 写操作成功后触发首页 revalidation：沿用 47d8eba 的内部 revalidate 路由（`frontend/src/app/api/internal/` + secret），由后端/管理端调用既有机制，不新造通道。

### 4.5 Seed（`prisma/seed.ts` 追加）

upsert 一套 §3 默认区块（按 sortOrder），全部 enabled：
- HERO：title "Small Space. Big Luwag."，subtitle "Furniture designed for condos, rentals and everyday small-space living."，CTAs "Shop Small-Space Picks"（链 `/collections` 或首个可售 collection）/"Explore Solutions"（链 `#solutions`），无媒体。
- USP：空 payload（前端默认四条）。
- CATEGORY_TILES：前 6 个 ACTIVE 顶层 category（动态取，不足则有几个算几个）。
- SOLUTIONS：现有 6 条（Small Bedroom/Home Office/Rental Friendly/Foldable Furniture/Narrow Space/Storage Solution），链接实现时核对线 B 的类目/collection 路由后落定。
- 两条 PRODUCT_GRID：Small-Space Favorites、Small Upgrades，均空选品。
- PRODUCT_STORY×2、ROOM_INSPIRATION、UGC：空 payload（占位卡）。
- BRAND_STORY / CONFIDENCE：迁移现有页面文案，品牌故事按 BRAND_FOUNDATION §3.4 措辞更新。

seed 可重复执行不产生重复区块（按 type+title 或固定业务键 upsert；实现上给 seed 用固定 sortOrder+type 查找）。

### 4.6 后端测试

- `homepage-payload.dto.spec.ts`：每 type 合法 payload 通过；非法 URL、超长、超数量、错误 icon 枚举被拒。
- `homepage.service.spec.ts`（prismaMock）：storefront 只返回 enabled 且按序；下架/不可售商品被过滤；category 失效跳过；空 payload 区块照常返回；单例限额在 saveSections 抛 400；setSectionProducts 全量替换。

---

## 5. 前端设计

### 5.1 数据与类型（`src/lib/api.ts`，共享文件只加不改）

新增：`HomepageSectionType`、`HomepageSection`、`HomepageSectionProduct`、hydrate 后的 `HomepageResponse` 类型；`getHomepage()`（服务端 fetch 封装，带 STOREFRONT_TAGS、revalidate 120）。

### 5.2 页面与组件

- `app/(storefront)/page.tsx` 改为瘦服务端组件：取 homepage → 失败回退内置 `DEFAULT_SECTIONS`（与 seed 同构的前端常量，保证永不白屏）→ 顺序渲染 registry。
- `components/home/sectionRegistry.ts`：type → 组件映射。
- 新组件（均在 `components/home/`）：
  - `HeroSection.tsx`（服务端组件；见 §5.3）
  - `UspSection.tsx`（包 `ui/TrustBar`，payload 有 items 时渲染配置，否则默认；默认四条保持现状，不改 TrustBar）
  - `CategoryTiles.tsx`：≤6 瓷砖，`category.imageUrl` 为空用 PlaceholderImage，标题叠加；链 `/categories/[slug]`；grid 2 列移动 / 3 平板 / 6 桌面。
  - `ProductGridSection.tsx`：标题/副标题 + ProductCard 网格；关联 badge 以角标渲染；空选品显示占位卡。
  - `SolutionsSection.tsx`：迁出现有 6 卡。
  - `ProductStorySection.tsx`：图+文横向交替；空内容占位。
  - `RoomInspirationSection.tsx`：大图 + Shop this room（关联商品缩略行）；空占位。
  - `UgcSection.tsx`：UGC 卡片墙；空占位，文案为中性 "Real home photos coming soon"，不出现任何人名/引语。
  - `BrandStorySection.tsx` / `ConfidenceSection.tsx`：迁出现有两段。
  - `SectionPlaceholder.tsx`：统一占位卡（虚线边框/中性灰图 + 一句英文 + 仅 admin 预览时可见的"此区块尚未配置内容"提示；线上普通访客看到的是克制的 coming-soon 卡）。
- `components/product/ProductCard.tsx`（A 拥有，共享关注）：新增**可选** `badge?: string` prop，默认不渲染角标；现有所有调用方不传即无变化。

### 5.3 Hero 媒体行为

- desktopImage/mobileImage：各端各取一张（`<img>` + 合理 alt，eslint-disable 同既有约定），支持 Tailwind 响应式切换；文字层加深色渐变遮罩保证对比度。
- videoUrl 存在：`<video controls={false} autoPlay muted loop playsInline poster={posterImage}>`，不引播放器依赖；移动端不自动播放流量大图时以 poster 展示（用 CSS 移动端显示 poster 图、桌面端 video 的简单策略，或统一 video——plan 中定为：有 video 时桌面播视频，移动用 poster+图，避免 iOS 低电量策略差异）。
- 所有媒体为空：渲染现有奶油色渐变居中文字版（home.jpeg 版式）。
- 区块可被后台禁用；禁用后首页第一屏直接是下一个启用区块。

### 5.4 Recently Viewed（非 CMS）

- 新岛屿 `components/home/RecentlyViewed.tsx`：读 localStorage key（新增 `sh:rv`，存 ≤12 个商品 id，最新在前，去重）。
- 写入点：PDP 客户端挂载时追加 id（线 A 独占文件 PdpClient，属本线改动）。
- 渲染：有 ≥1 条时，批量按 slug/id 拉商品（复用 storefront list 的 id/slug 过滤参数；若后端不支持按 id 批量，则拉最新列表后前端交集——plan 实现时核对，必要时用现有搜索接口），标题 "Recently Viewed"，横向滚动卡片；无记录整段不渲染（SSR 时不渲染，水合后出现，可接受）。

### 5.5 移动端底部导航

- 新 `components/layout/MobileTabBar.tsx`（客户端，`md:hidden fixed bottom-0 z-30`，safe-area padding）：Home `/`、Categories `/categories`（实现时核对线 B 类目首页路由；若无则 `/collections`）、Search（聚焦 Header 搜索或跳 `/search`，定为跳 `/search`）、Account `/account`。
- 挂载点：`app/(storefront)/layout.tsx`（共享文件，改前通报线 B，只加挂载不改既有结构）。
- 与 PDP `MobileStickyCta` 冲突处理：TabBar 在 PDP（`/products/`）与 checkout/cart 页不渲染（pathname 判断）；其余页面 body 底部加 `md:pb-16` 避让（layout 层加 class，不逐页改）。

### 5.6 SEO

- `page.tsx` 增 `generateMetadata`：title/description/OG/canonical，关键词沿用 spec §27（Small Space Furniture Philippines 等），品牌名 LUWAG。
- JSON-LD：Organization + WebSite（SearchAction 指向 `/search?q=`），写法对齐现有 `lib/product-jsonld.ts`；不引依赖。

### 5.7 分析事件

- `lib/tracking.ts`（共享，只加）：`trackCustom(event: string, props?: Record<string, unknown>)`，内部 `window.fbq?.('trackCustom', event, props)`，无 Pixel ID/no-op。
- 新岛屿 `components/home/HomeTracking.tsx`：挂载发 `HomepageView`；事件委托（一个根级 click listener，读 `data-section-id/data-section-name/data-position`）发出：
  - Hero CTA → `HeroClick`；类目瓷砖 → `CategoryClick`；方案卡 → `SolutionClick`；商品卡/图 → `ProductClick`。
  - props 统一 `{ section_id, section_name, position }`。
  - 标准事件不动；搜索事件归搜索页，不在本期。

---

## 6. Admin「首页装修」屏幕

路由：`src/app/admin/(shell)/homepage/page.tsx`；AdminShell 侧栏加「首页装修」（共享导航配置，改前通报线 B）。

一屏结构：

1. 区块列表：每行 = 拖拽手柄（或上/下按钮）+ 类型图标 + 标题 + 启用开关 + 商品数 + 编辑按钮。排序/开关随「保存排序」批量 PATCH。
2. 编辑器（页内抽屉，复用 admin/Dialog 风格）按 type 出表单：
   - HERO：标题/副标题、两个 CTA（文案+链接）、desktop/mobile/poster 图（ImageUrlInput，支持既有 R2 上传）、视频 URL。中文 label 与提示。
   - CATEGORY_TILES：品类树勾选（≤6，超出禁用并提示），按勾选顺序。
   - PRODUCT_GRID：商品选择器（名称/SKU 搜索，复用现有 admin 商品搜索接口），行排序、badge 文本（≤20 字符，提示"角标文字，如：新品"）。
   - SOLUTIONS：title/blurb/link 增删行。
   - PRODUCT_STORY：图/heading/body/CTA/关联商品。
   - ROOM_INSPIRATION：图/heading/body + 选品（Shop this room）。
   - UGC：条目增删（图/name/location/comment/关联商品）；顶部固定中文警示：「仅可录入已获授权的真实客户内容，禁止伪造评价」。
   - USP/BRAND_STORY/CONFIDENCE：文案表单；USP 留空提示"留空则显示默认四条"。
3. 保存：区块整体 PATCH；选品 PUT；成功后调用现有 revalidation 通道并 toast「已发布」。
4. 新建区块按类型限额（§3），超出隐藏"新增"或 400 提示；HERO 等单例不可删除，只能禁用。

---

## 7. 关键决策记录（2026-09-15 与用户确认）

1. 区块范围：对齐 spec 全量 17 槽位（含无素材区块的占位显示）。
2. 选品方式：新增首页专属选品后台（HomepageSection 关联表），不复用 Collection。
3. Hero：图片/视频版；无媒体回退渐变文字版。
4. USP TrustBar：保留现有四条文案，不改 BRAND_FOUNDATION §3.5 新版。
5. 无素材区块（UGC/Room/Product Story）：占位卡也显示，但占位必须中性，不伪造内容。
6. 移动底部导航：四项，去 Wishlist。
7. 分析事件：全部 Meta Pixel trackCustom，section_id/position 进 props。
8. CMS 模型：通用 HomepageSection + payload JSON（推荐方案）。

---

## 8. 风险与协调

- **migration 串行**：共享本地 5432 库。开工前与线 B 确认；本特性只有一次 migration（两张表），之后不再动 schema。
- **共享文件清单**（只加不改，逐一通报线 B）：`lib/api.ts`、`lib/tracking.ts`、`(storefront)/layout.tsx`、AdminShell 侧栏配置、`ProductCard.tsx`（加可选 prop，A 拥有组件本身）。
- **路由耦合**：SOLUTIONS 链接、TabBar 的 Categories 目标依赖线 B 的 `/categories/[slug]`；实现时以线 B 实际路由为准，未定则用现有 `/collections`，不阻塞。
- **Next 16 dev fetch 缓存粘连**：验收时硬刷新/`Cache-Control: no-cache`（既有教训）。
- **冷启动观感**：空选品 grid + 三个 coming-soon 占位卡同时出现在首页，可能显得店铺空。缓解：占位卡视觉克制；建议上线前至少给 Favorites 配 4–8 个真实商品（运营动作，非代码）。
- **视频素材体积/带宽**：仅接受外链 URL（R2 或托管视频），不做上传转码；不引入播放器。

---

## 9. 验收标准

- 后台可：排序、禁用/启用、编辑全部 type 的文案/媒体/链接、给商品网格选品排序打 badge、UGC 真实条目录入；保存后 120s 内（或即时 revalidate）前台生效。
- 前台 1280px 与 390px 两轮手动验收：
  - Hero 三态（渐变/图片/视频+poster）正确；CTA 跳转与事件正确。
  - 区块顺序与后台一致；禁用区块不出现；无内容区块显示中性占位。
  - 类目瓷砖链到类目页；商品网格只出现可售商品，badge 正确，点击进 PDP。
  - Recently Viewed：浏览 PDP 后回首页出现；无痕窗口无该区块。
  - TabBar：仅非 PDP/checkout/cart 的移动视图出现，不遮挡内容与 PDP sticky CTA。
- Pixel Helper/fbq mock：HomepageView 一次；HeroClick/CategoryClick/SolutionClick/ProductClick 带 section_id/section_name/position；标准事件仍正常。
- 后端 `pnpm lint && pnpm build && pnpm exec vitest run` 全绿；前端 `pnpm lint && pnpm build` 全绿。
- 无新依赖、无 hex、无 wishlist、无伪造内容、配送/COD 文案未改。

## 10. 实施顺序（写入 plan）

1. schema + migration + prisma client + Product 反向关系
2. payload DTO（zod）+ 单测
3. homepage service + controller/module + 单测
4. seed 默认区块
5. admin 首页装修屏幕
6. api.ts 类型 + 首页 registry 与全部区块组件 + Hero 媒体
7. ProductCard badge、Recently Viewed、TabBar、SEO/JSON-LD、分析事件
8. 浏览器双端验收 + 全量 gates + 清理测试数据
