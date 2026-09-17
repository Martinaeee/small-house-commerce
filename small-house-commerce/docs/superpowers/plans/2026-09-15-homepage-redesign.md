# 首页全量改版 + HomepageSection CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首页从 6 区块半硬编码页面升级为 HOMEPAGE_SPEC §5 的全量区块页面，新增通用 `HomepageSection` CMS（两张表、一个 NestJS `cms` 模块、一个 admin「首页装修」屏幕），前台按配置渲染，空内容显示中性占位。

**Architecture:** 后端新增独立 NestJS `cms` 模块（不动 catalog 领域代码，除两个 additive 变更：`ProductsService.storefrontByIds()` 公开导出、storefront products 查询新增 `ids` 参数）。商品可售性/评价聚合复用 catalog 既有管线（CatalogModule exports `ProductsService`），不复制库存判定逻辑。前端首页改为瘦 RSC：fetch `/storefront/homepage` → registry 顺序渲染，失败回退内置 `DEFAULT_SECTIONS` 常量，永不白屏。admin 权限复用 `PRODUCT_MANAGE`，不新增权限码。

**Tech Stack:** NestJS 12 + Prisma 7.10（split schema、`prisma7.config.ts`）+ PostgreSQL + zod 4.5 + vitest/oxlint（后端）；Next.js 16.3.4 App Router + React 19 + Tailwind v4 `@theme` token + eslint（前端）；pnpm；ESM `.js` import specifier；零新 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-15-homepage-redesign-design.md`（计划与 spec 冲突时以 spec 为准；本计划已逐节覆盖）。依据旧稿 `docs/frontend/HOMEPAGE_SPEC.md`、`docs/BRAND_FOUNDATION_V1.md`。

## Global Constraints

- 零新 npm 依赖；样式只用 `globals.css` 既有 Tailwind token（`primary/primary-dark/primary-light/background/card/ink/ink-secondary/ink-muted/cta/cta-hover/sale/border`，外加既有例外 `text-sale/border-sale/bg-sale`）；组件内禁止 hex；`text-white/bg-black` 等既有用法允许（ProductCard 已在用）。
- 价格只显示 PHP；COD 与配送既有文案一字不改（"Metro Manila 3-5 days, provinces 5-7"、"Cash on Delivery"、TrustBar 四条原文）。
- Meta Pixel 标准事件 ViewContent/AddToCart/InitiateCheckout/Purchase 行为不变；首页新事件只用 `trackCustom`。
- **不做 wishlist / 心形图标**；移动底部导航固定四项 Home/Categories/Search/Account。
- **禁止伪造评价/UGC/人名/引语**；UGC/Room/Product Story 无内容时渲染中性 coming-soon 占位；Verified Purchase 只认真实订单。
- 后端 ESM `.js` specifier；Prisma `@map("snake_case")`、`@@map("plural_snake")`、`@db.Uuid` + `@default(uuid(7))`、`@db.Timestamptz(3)`。
- 后端测试风格：纯 `new Service(prismaMock as never)` + vitest（参考 `reviews.service.spec.ts`）；先写失败测试再实现。
- 后端命令在 `small-house-commerce/backend`，前端在 `small-house-commerce/frontend`；包管理 pnpm。
- migration 串行：动手前先 `pnpm prisma migrate status` 并与线 B 会话确认无未提交 migration；禁止 `prisma migrate reset`；出现 drift 立即 STOP 等人。
- **绝不重启用户的后端 :3000 与前端 :3001**。验收用隔离实例：后端 `PORT=3010 pnpm start:dev`，前端 `API_TARGET=http://localhost:3010 PORT=3002 pnpm dev`（dotenv 不覆盖 shell 已有的 PORT）。
- 提交只在 `feat/home-pdp` 分支；`git add <显式路径>`，禁止 `git add -A`；每个任务末尾独立提交。
- 不留测试数据；admin 新字段一律中文 label/hint。
- 共享文件（`lib/api.ts`、`lib/tracking.ts`、`(storefront)/layout.tsx`、`AdminShell.tsx`、`ProductCard.tsx`）只做 additive 改动，动手前在主线会话通报线 B。
- 线 B（feat/checkout-category）2026-09-15 已通报、本线确认无冲突的并行改动（rebase 时可能已在主干出现，均为 additive）：①`components/product/PlpProductCard.tsx` 的 `badge` 改名为 `badges: CardBadge[]`——**本线不引用该组件**，无需适配；②`Collection` 接口可能多出可选 `badgeLabel?: string | null`——不消费即可；③`(storefront)/layout.tsx` 的 Footer 与 MessengerChat 之间可能多出一行 `<CartDrawer />`——与本线的 `<MobileTabBar />` 挂载点、`<main>` pb 改动位置不同，rebase 冲突时两处都保留。

---

## File Structure

**后端新建（`backend/`）**

- `prisma/schema/homepage.prisma` — `HomepageSection` + `HomepageSectionProduct` 模型与 `HomepageSectionType` enum。
- `src/modules/cms/dto/homepage-section.dto.ts` — 每 type 的 payload zod schema、整表保存/选品保存 DTO。
- `src/modules/cms/dto/homepage-section.dto.spec.ts` — payload DTO 单测。
- `src/modules/cms/homepage.service.ts` — storefront hydrate、admin 列表/保存/选品、限额校验、revalidation。
- `src/modules/cms/homepage.service.spec.ts` — service 单测（prismaMock）。
- `src/modules/cms/storefront/homepage.controller.ts` — `GET /storefront/homepage`（公开）。
- `src/modules/cms/admin/homepage.controller.ts` — admin GET/PATCH sections、PUT products。
- `src/modules/cms/cms.module.ts` — imports `[AuthModule, CatalogModule]`。

**后端修改（additive）**

- `prisma/schema/catalog.prisma` — Product 增加反向关系字段。
- `src/modules/catalog/products.service.ts` — 新增公开 `storefrontByIds()`；`catalog.module.ts` exports 加 `ProductsService`。
- `src/modules/catalog/dto/product.dto.ts` + `products.service.ts` — storefront 查询新增 `ids` 逗号参数（≤12，保序）。
- `src/app.module.ts` — 注册 `CmsModule`。
- `prisma/seed.ts` — 追加 `ensureHomepageSections()`。

**前端新建（`frontend/src/`）**

- `components/home/sectionRegistry.ts` — type → 组件映射。
- `components/home/default-sections.ts` — 与 seed 同构的 `DEFAULT_SECTIONS` 兜底常量。
- `components/home/tracking-attrs.ts` — data-* 分析属性小助手。
- `components/home/{SectionShell,SectionPlaceholder,HeroSection,UspSection,CategoryTiles,ProductGridSection,SolutionsSection,ProductStorySection,RoomInspirationSection,UgcSection,BrandStorySection,ConfidenceSection,RecentlyViewed,HomeTracking}.tsx` — 14 个区块/岛屿组件。
- `components/layout/MobileTabBar.tsx` — 移动底部四项导航。
- `lib/home-jsonld.ts` — Organization + WebSite JSON-LD。
- `app/admin/(shell)/homepage/page.tsx` — 「首页装修」屏幕。

**前端修改（全部 additive）**

- `lib/api.ts` — homepage 类型 + `getHomepage()` + `getProductsByIds()`。
- `lib/admin-api.ts` — 3 个 homepage admin 方法 + 类型。
- `lib/tracking.ts` — `trackCustom()`。
- `components/product/ProductCard.tsx` — 可选 `badge?: string`。
- `components/product/PdpClient.tsx` — 挂载写 `sh:rv`。
- `components/admin/AdminShell.tsx` — 侧栏「首页装修」。
- `app/(storefront)/page.tsx` — 瘦 RSC 重写 + `generateMetadata`。
- `app/(storefront)/layout.tsx` — 挂 `<MobileTabBar />` + `md:pb-16`。

---

### Task 1: Schema + migration + Prisma client

**Files:**
- Create: `backend/prisma/schema/homepage.prisma`
- Modify: `backend/prisma/schema/catalog.prisma`（Product 关系区，约 131 行 `collections` 后）
- Create (generated by CLI): `backend/prisma/migrations/<ts>_add_homepage_sections/migration.sql`

**Interfaces:**
- Produces: Prisma client 上的 `prisma.homepageSection` / `prisma.homepageSectionProduct` delegate、runtime enum `HomepageSectionType`（10 值）。

- [ ] **Step 1: 串行 migration 检查（硬门禁）**

在主线会话告诉线 B：「线 A 即将创建 `add_homepage_sections` migration（纯新增两张表）」，确认线 B 没有未提交 migration，然后：

```bash
cd backend
pnpm prisma migrate status
```

Expected: `Database schema is up to date!`（或仅列出线 B 已确认的内容）。若提示 drift / 本地有未提交 migration：**STOP，等人，禁止 reset**。

- [ ] **Step 2: 写 schema 文件**

Create `backend/prisma/schema/homepage.prisma`（逐字按 spec §4.1）:

```prisma
// Homepage CMS: one generic section table with a per-type JSON payload,
// plus its product join (homepage-only product selection, spec §4.1).
// Sources: docs/superpowers/specs/2026-09-15-homepage-redesign-design.md §4.

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

- [ ] **Step 3: 给 Product 加反向关系**

在 `backend/prisma/schema/catalog.prisma` 的 Product 模型中，`collections CollectionProduct[]` 一行之后加一行：

```prisma
  homepageSections HomepageSectionProduct[]
```

- [ ] **Step 4: 校验 + 创建 migration**

```bash
cd backend
pnpm prisma validate
pnpm prisma migrate dev --name add_homepage_sections
```

Expected: 新目录 `prisma/migrations/<timestamp>_add_homepage_sections/migration.sql`，含 CREATE TABLE `homepage_sections` / `homepage_section_products`、enum type `HomepageSectionType`、唯一索引与两个 `ON DELETE CASCADE` 外键；`migrate dev` 自动重新生成 client（可能顺带幂等执行 seed，无副作用）。

若 CLI 报 drift：**STOP**，不要 `reset`，找用户/线 B。

- [ ] **Step 5: 构建验证 client 生成**

```bash
cd backend
pnpm build
```

Expected: nest build 成功（新 enum/delegate 类型可用）。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema/homepage.prisma prisma/schema/catalog.prisma
git add prisma/migrations
git commit -m "feat(homepage): HomepageSection schema + migration"
```

---

### Task 2: Payload DTO（zod）+ 单测

**Files:**
- Create: `backend/src/modules/cms/dto/homepage-section.dto.ts`
- Test: `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`

**Interfaces:**
- Produces:
  - `homepagePayloadSchemas: Record<HomepageSectionType, z.ZodType>`（service 按 type 取 schema 校验）。
  - `saveHomepageSectionsSchema`（body 形如 `{ sections: SectionInput[] }`），infer 类型 `SaveHomepageSectionsInput`。
  - `setHomepageProductsSchema`（body `{ rows: {productId, sortOrder, badge?}[] }`），infer 类型 `SetHomepageProductsInput`。
- 规则（spec §4.2）：payload 全可选、留空回退默认；链接只允许 `/`、`#` 开头站内路径或 `https://` URL；数量上限 USP≤4、CATEGORY_TILES≤6、SOLUTIONS≤6、UGC≤6；badge≤20；整表 ≤20 行。

- [ ] **Step 1: 写失败测试**

Create `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HomepageSectionType } from '../../../generated/prisma/client.js';
import {
  homepagePayloadSchemas,
  saveHomepageSectionsSchema,
  setHomepageProductsSchema,
} from './homepage-section.dto.js';

describe('homepage payload schemas', () => {
  it('accepts a valid payload for every section type', () => {
    const cases: Array<[HomepageSectionType, unknown]> = [
      [
        HomepageSectionType.HERO,
        {
          desktopImage: 'https://cdn.example.com/a.jpg',
          ctaPrimaryText: 'Shop Small-Space Picks',
          ctaPrimaryLink: '/collections',
          ctaSecondaryLink: '#solutions',
        },
      ],
      [HomepageSectionType.USP, { items: [{ icon: 'truck', label: 'Fast', sub: 'PH wide' }] }],
      [HomepageSectionType.CATEGORY_TILES, { categoryIds: [] }],
      [HomepageSectionType.PRODUCT_GRID, { columns: 4 }],
      [
        HomepageSectionType.SOLUTIONS,
        { items: [{ title: 'Small Bedroom', blurb: 'Compact beds', link: '/collections/x' }] },
      ],
      [
        HomepageSectionType.PRODUCT_STORY,
        { heading: 'Made for rentals', ctaLink: 'https://luwag.ph/products/x' },
      ],
      [HomepageSectionType.ROOM_INSPIRATION, { imageUrl: 'https://cdn.example.com/r.jpg' }],
      [
        HomepageSectionType.UGC,
        { entries: [{ name: 'Maria', comment: 'Love it', location: 'Cebu' }] },
      ],
      [HomepageSectionType.BRAND_STORY, { heading: 'Our Story', bullets: ['a', 'b'] }],
      [HomepageSectionType.CONFIDENCE, { heading: 'Shop with confidence' }],
    ];

    for (const [type, payload] of cases) {
      expect(homepagePayloadSchemas[type].safeParse(payload).success).toBe(true);
    }
  });

  it('accepts an empty object for every payload (empty falls back to defaults)', () => {
    for (const schema of Object.values(homepagePayloadSchemas)) {
      expect(schema.safeParse({}).success).toBe(true);
    }
  });

  it('rejects non-https / javascript URLs, protocol-relative links, and bad media schemes', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    expect(hero.safeParse({ ctaPrimaryLink: 'javascript:alert(1)' }).success).toBe(false);
    expect(hero.safeParse({ ctaPrimaryLink: 'http://insecure.example.com' }).success).toBe(false);
    expect(hero.safeParse({ ctaPrimaryLink: '//evil.com/x' }).success).toBe(false);
    expect(hero.safeParse({ ctaPrimaryLink: '/collections/x' }).success).toBe(true);
    expect(hero.safeParse({ ctaPrimaryLink: '#solutions' }).success).toBe(true);
    expect(hero.safeParse({ ctaPrimaryLink: 'https://luwag.ph/x' }).success).toBe(true);
    expect(hero.safeParse({ desktopImage: 'not-a-url' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: 'http://example.com/a.jpg' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: 'javascript:alert(1)' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: 'https://cdn.example.com/a.jpg' }).success).toBe(true);
  });

  it('rejects over-length text', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    expect(hero.safeParse({ ctaPrimaryText: 'x'.repeat(121) }).success).toBe(false);
    const brand = homepagePayloadSchemas[HomepageSectionType.BRAND_STORY];
    expect(brand.safeParse({ body: 'x'.repeat(3001) }).success).toBe(false);
  });

  it('enforces item count limits', () => {
    expect(
      homepagePayloadSchemas[HomepageSectionType.USP]
        .safeParse({ items: Array.from({ length: 5 }, () => ({ label: 'x' })) }).success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.CATEGORY_TILES]
        .safeParse({ categoryIds: Array.from({ length: 7 }, () => crypto.randomUUID()) }).success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.SOLUTIONS]
        .safeParse({ items: Array.from({ length: 7 }, (_, i) => ({ title: `s${i}`, link: '/x' })) })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.UGC]
        .safeParse({ entries: Array.from({ length: 7 }, () => ({ name: 'n', comment: 'c' })) })
        .success,
    ).toBe(false);
  });

  it('rejects unknown USP icons and non-uuid category/product ids', () => {
    expect(
      homepagePayloadSchemas[HomepageSectionType.USP].safeParse({ items: [{ icon: 'star', label: 'x' }] })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.CATEGORY_TILES].safeParse({ categoryIds: ['nope'] })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.PRODUCT_STORY].safeParse({ productId: 'nope' })
        .success,
    ).toBe(false);
  });

  it('validates the whole-section save body', () => {
    const ok = saveHomepageSectionsSchema.safeParse({
      sections: [{ enabled: true, sortOrder: 0, type: HomepageSectionType.HERO }],
    });
    expect(ok.success).toBe(true);
    expect(
      saveHomepageSectionsSchema.safeParse({ sections: [{ enabled: true, sortOrder: -1 }] }).success,
    ).toBe(false);
    expect(
      saveHomepageSectionsSchema.safeParse({
        sections: Array.from({ length: 21 }, () => ({ enabled: true, sortOrder: 0 })),
      }).success,
    ).toBe(false);
  });

  it('validates the section products body (badge ≤ 20, max 24 rows)', () => {
    const id = crypto.randomUUID();
    expect(
      setHomepageProductsSchema.safeParse({ rows: [{ productId: id, sortOrder: 0, badge: '新品' }] })
        .success,
    ).toBe(true);
    expect(
      setHomepageProductsSchema.safeParse({ rows: [{ productId: id, sortOrder: 0, badge: 'x'.repeat(21) }] })
        .success,
    ).toBe(false);
    expect(
      setHomepageProductsSchema.safeParse({
        rows: Array.from({ length: 25 }, () => ({ productId: crypto.randomUUID(), sortOrder: 0 })),
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend
pnpm exec vitest run src/modules/cms/dto/homepage-section.dto.spec.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 DTO**

Create `backend/src/modules/cms/dto/homepage-section.dto.ts`:

```ts
import { z } from 'zod';
import { HomepageSectionType } from '../../../generated/prisma/client.js';

/** In-app path/hash ("/collections", "#solutions") or absolute https URL. Protocol-relative "//host" is rejected. */
const inAppOrHttps = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      (value.startsWith('/') && !value.startsWith('//')) ||
      value.startsWith('#') ||
      value.startsWith('https://'),
    { message: 'Link must start with / or # (but not //), or be an https URL' },
  );

/** Absolute https media URL only (CDN/R2 presigns); http/javascript schemes rejected. */
const mediaUrl = () =>
  z
    .string()
    .url()
    .max(2048)
    .refine((value) => value.startsWith('https://'), {
      message: 'Media URL must be an https:// URL',
    });

const heroPayloadSchema = z.object({
  desktopImage: mediaUrl().optional(),
  mobileImage: mediaUrl().optional(),
  videoUrl: mediaUrl().optional(),
  posterImage: mediaUrl().optional(),
  ctaPrimaryText: z.string().min(1).max(120).optional(),
  ctaPrimaryLink: inAppOrHttps.optional(),
  ctaSecondaryText: z.string().min(1).max(120).optional(),
  ctaSecondaryLink: inAppOrHttps.optional(),
});

const uspItemSchema = z.object({
  icon: z.enum(['shield', 'home', 'lock', 'truck']).optional(),
  label: z.string().min(1).max(120),
  sub: z.string().max(200).optional(),
});

const uspPayloadSchema = z.object({
  items: z.array(uspItemSchema).max(4).optional(),
});

const categoryTilesPayloadSchema = z.object({
  categoryIds: z.array(z.string().uuid()).max(6).optional(),
});

const solutionItemSchema = z.object({
  title: z.string().min(1).max(120),
  blurb: z.string().max(300).optional(),
  link: inAppOrHttps,
});

const solutionsPayloadSchema = z.object({
  items: z.array(solutionItemSchema).max(6).optional(),
});

const productGridPayloadSchema = z.object({
  columns: z.union([z.literal(2), z.literal(4)]).optional(),
});

const productStoryPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  ctaText: z.string().max(120).optional(),
  ctaLink: inAppOrHttps.optional(),
  productId: z.string().uuid().optional(),
});

const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
});

const ugcEntrySchema = z.object({
  imageUrl: mediaUrl().optional(),
  name: z.string().min(1).max(120),
  location: z.string().max(120).optional(),
  comment: z.string().min(1).max(1000),
  productId: z.string().uuid().optional(),
});

const ugcPayloadSchema = z.object({
  entries: z.array(ugcEntrySchema).max(6).optional(),
});

const textBlockPayloadSchema = z.object({
  heading: z.string().max(120).optional(),
  body: z.string().max(3000).optional(),
  bullets: z.array(z.string().min(1).max(200)).max(6).optional(),
});

/** Per-type payload validation; service picks the schema by section.type. */
export const homepagePayloadSchemas: Record<HomepageSectionType, z.ZodType> = {
  [HomepageSectionType.HERO]: heroPayloadSchema,
  [HomepageSectionType.USP]: uspPayloadSchema,
  [HomepageSectionType.CATEGORY_TILES]: categoryTilesPayloadSchema,
  [HomepageSectionType.PRODUCT_GRID]: productGridPayloadSchema,
  [HomepageSectionType.SOLUTIONS]: solutionsPayloadSchema,
  [HomepageSectionType.PRODUCT_STORY]: productStoryPayloadSchema,
  [HomepageSectionType.ROOM_INSPIRATION]: roomPayloadSchema,
  [HomepageSectionType.UGC]: ugcPayloadSchema,
  [HomepageSectionType.BRAND_STORY]: textBlockPayloadSchema,
  [HomepageSectionType.CONFIDENCE]: textBlockPayloadSchema,
};

const homepageSectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.nativeEnum(HomepageSectionType).optional(),
  title: z.string().max(200).nullable().optional(),
  subtitle: z.string().max(500).nullable().optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  // Validated per type inside HomepageService (it knows the row's type).
  payload: z.unknown().optional(),
});

export const saveHomepageSectionsSchema = z.object({
  sections: z.array(homepageSectionInputSchema).min(1).max(20),
});

export const setHomepageProductsSchema = z.object({
  rows: z
    .array(
      z.object({
        productId: z.string().uuid(),
        sortOrder: z.number().int().min(0).max(999),
        badge: z.string().max(20).nullable().optional(),
      }),
    )
    .max(24),
});

export type SaveHomepageSectionsInput = z.infer<typeof saveHomepageSectionsSchema>;
export type SetHomepageProductsInput = z.infer<typeof setHomepageProductsSchema>;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend
pnpm exec vitest run src/modules/cms/dto/homepage-section.dto.spec.ts
```

Expected: PASS（全部用例）。

- [ ] **Step 5: lint + Commit**

```bash
cd backend
pnpm lint
git add src/modules/cms/dto/homepage-section.dto.ts src/modules/cms/dto/homepage-section.dto.spec.ts
git commit -m "feat(homepage): section payload zod DTOs + tests"
```

---

### Task 3: CMS service + controllers + module（含 catalog additive 复用点）

**Files:**
- Modify: `backend/src/modules/catalog/dto/product.dto.ts`（storefront query 加 `ids`）
- Modify: `backend/src/modules/catalog/products.service.ts`（新增 public `storefrontByIds()`，list 支持 ids 分支）
- Modify: `backend/src/modules/catalog/catalog.module.ts`（exports 加 ProductsService）
- Create: `backend/src/modules/cms/homepage.service.ts`
- Create: `backend/src/modules/cms/storefront/homepage.controller.ts`
- Create: `backend/src/modules/cms/admin/homepage.controller.ts`
- Create: `backend/src/modules/cms/cms.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/modules/catalog/products.service.spec.ts`（新增）
- Test: `backend/src/modules/cms/homepage.service.spec.ts`（新增）

**Interfaces:**
- Consumes: Task 2 的 `homepagePayloadSchemas` / 两个保存 DTO；Task 1 的 Prisma delegate。
- Produces:
  - `ProductsService.storefrontByIds(ids: string[])`：ACTIVE 商品、按入参顺序、走完库存+评分 enrichment 的完整 storefront 商品行。
  - `GET /api/v1/storefront/homepage` → `{ sections: StorefrontSection[] }`（只含 enabled，按 sortOrder）。
  - `GET /api/v1/admin/homepage/sections` → 原始 section（含 products 关联与 product 摘要）。
  - `PATCH /api/v1/admin/homepage/sections` body `SaveHomepageSectionsInput`；`PUT /api/v1/admin/homepage/sections/:id/products` body `SetHomepageProductsInput`。
  - `GET /api/v1/storefront/products?ids=<uuid>,...`（≤12，保序，Recently Viewed 用）。

- [ ] **Step 1: 先写 catalog 复用点的失败测试**

Create `backend/src/modules/catalog/products.service.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

function createPrismaMock(rows: Array<{ id: string }>) {
  return {
    product: {
      // The query forces ACTIVE + id-in; echo rows in the (deliberately
      // shuffled) order the mock holds, so the service must re-sort itself.
      // presentStorefront enriches `variants`; an empty array keeps the
      // fixture minimal without crashing the inventory pipeline.
      findMany: vi.fn(async () => [...rows].reverse().map((row) => ({ ...row, variants: [] }))),
    },
    inventory: {
      groupBy: vi.fn(async () => []),
    },
  };
}

const reviewsStub = {
  summaryForProducts: vi.fn(async () => new Map()),
} as never;

describe('ProductsService.storefrontByIds', () => {
  it('queries ACTIVE products by id and returns them in the requested order', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }]);
    const service = new ProductsService(prisma as never, reviewsStub);

    const result = await service.storefrontByIds(['p1', 'p2']);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] }, status: 'ACTIVE' },
      }),
    );
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result[0]).toMatchObject({ reviewCount: 0, ratingAverage: null });
  });

  it('returns an empty list without querying when given no ids', async () => {
    const prisma = createPrismaMock([]);
    const service = new ProductsService(prisma as never, reviewsStub);

    const result = await service.storefrontByIds([]);

    expect(result).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend
pnpm exec vitest run src/modules/catalog/products.service.spec.ts
```

Expected: FAIL（`storefrontByIds is not a function`）。

- [ ] **Step 3: 实现 catalog additive 变更**

3a. `src/modules/catalog/dto/product.dto.ts` 的 `storefrontProductQuerySchema` 加一个 `ids` 字段（逗号分隔 UUID，≤12，保序查询；不影响既有参数）：

```ts
export const storefrontProductQuerySchema = z.object({
  search: z.string().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  room: z.nativeEnum(Room).optional(),
  solution: z.nativeEnum(Solution).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  // Homepage "Recently Viewed": ordered id batch lookup (max 12).
  ids: z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : value,
      z.array(z.string().uuid()).max(12),
    )
    .optional(),
});
```

3b. `src/modules/catalog/products.service.ts`：在 `storefrontList()` 方法体最前面（`const where ...` 之前）加 ids 短路分支：

```ts
    // Homepage Recently Viewed: ordered batch lookup, no pagination.
    if (query.ids && query.ids.length > 0) {
      const items = await this.storefrontByIds(query.ids);
      return { items, total: items.length, page: 1, pageSize: items.length };
    }
```

并在 `storefrontList()` 与 `presentStorefront()` 之间新增公开方法：

```ts
  /**
   * Storefront-shaped products by id, returned in the requested order.
   * ACTIVE only; every row goes through the same inventory + review
   * enrichment as list/PDP responses. Shared by the CMS homepage grids and
   * the storefront `ids=` query (Recently Viewed), so sellability/rating
   * logic is never duplicated outside this service.
   */
  async storefrontByIds(ids: string[]) {
    if (ids.length === 0) return [];

    const items = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: STOREFRONT_SELECT,
    });
    // findMany does not preserve the id order; re-apply it.
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((item): item is StorefrontProductRecord => item !== undefined);

    return this.presentStorefront(ordered);
  }
```

3c. `src/modules/catalog/catalog.module.ts` 的 `exports` 数组：

```ts
  exports: [ReviewsService, ProductsService],
```

- [ ] **Step 4: catalog 测试转绿**

```bash
cd backend
pnpm exec vitest run src/modules/catalog/products.service.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 写 HomepageService 的失败测试**

Create `backend/src/modules/cms/homepage.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomepageSectionType as T } from '../../generated/prisma/client.js';
import type { ProductsService } from '../catalog/products.service.js';
import { HomepageService } from './homepage.service.js';

interface JoinRow {
  id: string;
  sectionId: string;
  productId: string;
  sortOrder: number;
  badge: string | null;
}

interface SectionFixture {
  id: string;
  type: T;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: unknown;
  products: JoinRow[];
}

const join = (sectionId: string, productId: string, sortOrder: number, badge: string | null = null): JoinRow => ({
  id: `j-${sectionId}-${productId}`,
  sectionId,
  productId,
  sortOrder,
  badge,
});

const section = (over: Partial<SectionFixture> & Pick<SectionFixture, 'id' | 'type'>): SectionFixture => ({
  title: null,
  subtitle: null,
  enabled: true,
  sortOrder: 0,
  payload: {},
  products: [],
  ...over,
});

function skuProduct(id: string, availableInventory: number, price: number | null) {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    images: [],
    variants: [{ sku: { id: `${id}-sku`, price, availableInventory } }],
    reviewCount: 0,
    ratingAverage: null,
  };
}

function createContext(sections: SectionFixture[]) {
  const productsById = new Map<string, unknown>([
    ['p1', skuProduct('p1', 3, 100)],
    ['p2', skuProduct('p2', 0, 100)],
  ]);

  const products = {
    storefrontByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => productsById.get(id)).filter(Boolean),
    ),
  } as unknown as ProductsService;

  const tx = {
    homepageSection: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'new-id', ...(data as object) })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
        id: where.id,
        ...(data as object),
      })),
    },
    homepageSectionProduct: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const categoryRows = [
    { id: 'c1', name: 'Bedroom', slug: 'bedroom', imageUrl: 'https://cdn.example.com/c1.jpg' },
    { id: 'c2', name: 'No Image', slug: 'no-image', imageUrl: null },
    { id: 'c3', name: 'Disabled', slug: 'disabled', imageUrl: 'https://cdn.example.com/c3.jpg' },
  ];

  const prisma = {
    homepageSection: {
      findMany: vi.fn(async () => sections),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        sections.some((s) => s.id === where.id) ? { id: where.id } : null,
      ),
      deleteMany: tx.homepageSection.deleteMany,
      create: tx.homepageSection.create,
      update: tx.homepageSection.update,
    },
    homepageSectionProduct: {
      deleteMany: tx.homepageSectionProduct.deleteMany,
      createMany: tx.homepageSectionProduct.createMany,
    },
    category: {
      // Emulates: ACTIVE + non-null imageUrl + id-in.
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
        categoryRows.filter(
          (c) => c.imageUrl !== null && c.id !== 'c3' && where.id?.in.includes(c.id),
        ),
      ),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })),
      ),
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
  };

  return { prisma, products, tx };
}

describe('HomepageService.storefrontGet', () => {
  it('returns enabled sections in order, hides disabled, filters grids to sellable products with badges', async () => {
    const sections = [
      section({ id: 'hero', type: T.HERO, enabled: false, sortOrder: 0, title: 'H' }),
      section({
        id: 'grid',
        type: T.PRODUCT_GRID,
        sortOrder: 1,
        title: 'Favorites',
        products: [join('grid', 'p1', 0, '新品'), join('grid', 'p2', 1, null)],
      }),
      section({
        id: 'cats',
        type: T.CATEGORY_TILES,
        sortOrder: 2,
        payload: { categoryIds: ['c1', 'c2', 'c3', 'missing'] },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();

    expect(result.sections.map((s) => s.id)).toEqual(['grid', 'cats']);
    const grid = result.sections[0];
    expect(grid.products).toHaveLength(1);
    expect(grid.products?.[0]).toMatchObject({ id: 'p1', badge: '新品' });

    const cats = result.sections[1];
    expect(cats.categories?.map((c) => c.id)).toEqual(['c1']);
  });

  it('keeps out-of-stock products in ROOM_INSPIRATION (grid sellability filter is grid-only)', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        products: [join('room', 'p1', 0), join('room', 'p2', 1)],
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect(result.sections[0].products).toHaveLength(2);
  });

  it('returns empty-payload sections (USP defaults happen on the frontend)', async () => {
    const sections = [section({ id: 'usp', type: T.USP, payload: null })];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe(T.USP);
  });

  it('attaches existing products to story/ugc payloads and drops unresolved productIds', async () => {
    const sections = [
      section({ id: 'story', type: T.PRODUCT_STORY, payload: { heading: 'Hi', productId: 'p1' } }),
      section({
        id: 'story2',
        type: T.PRODUCT_STORY,
        payload: { heading: 'Ghost', productId: 'px' },
      }),
      section({
        id: 'ugc',
        type: T.UGC,
        payload: {
          entries: [
            { name: 'Maria', comment: 'Great', productId: 'p1' },
            { name: 'Jose', comment: 'Nice', productId: 'px' },
          ],
        },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    const payload1 = result.sections[0].payload as Record<string, unknown>;
    expect(payload1.product).toMatchObject({ id: 'p1' });
    expect('productId' in payload1).toBe(false);

    const payload2 = result.sections[1].payload as Record<string, unknown>;
    expect('product' in payload2).toBe(false);

    const ugcPayload = result.sections[2].payload as { entries: Array<Record<string, unknown>> };
    expect(ugcPayload.entries[0]).toMatchObject({ name: 'Maria', product: { id: 'p1' } });
    expect('productId' in ugcPayload.entries[0]).toBe(false);
    expect('product' in ugcPayload.entries[1]).toBe(false);
  });
});

describe('HomepageService.saveSections', () => {
  it('rejects creating a second singleton section with 400', async () => {
    const ctx = createContext([section({ id: 'h1', type: T.HERO, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({
        sections: [
          { id: 'h1', type: T.HERO, enabled: true, sortOrder: 0 },
          { type: T.HERO, enabled: true, sortOrder: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.tx.homepageSection.create).not.toHaveBeenCalled();
  });

  it('deletes omitted non-singletons but keeps omitted singleton sections', async () => {
    const ctx = createContext([
      section({ id: 'h1', type: T.HERO, sortOrder: 0 }),
      section({ id: 'g1', type: T.PRODUCT_GRID, sortOrder: 1 }),
    ]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await service.saveSections({
      sections: [{ id: 'h1', type: T.HERO, enabled: false, sortOrder: 2 }],
    });

    expect(ctx.tx.homepageSection.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['g1'] } },
    });
    expect(ctx.tx.homepageSection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1' }, data: expect.objectContaining({ enabled: false, sortOrder: 2 }) }),
    );
  });

  it('rejects payloads that fail per-type validation (UGC > 6 entries)', async () => {
    const ctx = createContext([section({ id: 'u1', type: T.UGC, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({
        sections: [
          {
            id: 'u1',
            type: T.UGC,
            enabled: true,
            sortOrder: 0,
            payload: { entries: Array.from({ length: 7 }, () => ({ name: 'n', comment: 'c' })) },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires type when creating and rejects changing an existing type', async () => {
    const ctx = createContext([section({ id: 'h1', type: T.HERO, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({ sections: [{ enabled: true, sortOrder: 0 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.saveSections({
        sections: [{ id: 'h1', type: T.USP, enabled: true, sortOrder: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HomepageService.setSectionProducts', () => {
  it('replaces the whole join list in one transaction', async () => {
    const ctx = createContext([section({ id: 'g1', type: T.PRODUCT_GRID })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.setSectionProducts('g1', {
      rows: [
        { productId: 'p1', sortOrder: 0, badge: '新品' },
        { productId: 'p2', sortOrder: 1 },
      ],
    });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(ctx.tx.homepageSectionProduct.deleteMany).toHaveBeenCalledWith({ sectionId: 'g1' });
    expect(ctx.tx.homepageSectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { sectionId: 'g1', productId: 'p1', sortOrder: 0, badge: '新品' },
        { sectionId: 'g1', productId: 'p2', sortOrder: 1, badge: null },
      ],
    });
  });

  it('404s an unknown section', async () => {
    const ctx = createContext([]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);
    await expect(
      service.setSectionProducts('nope', { rows: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects unknown products and duplicate product rows', async () => {
    const ctx = createContext([section({ id: 'g1', type: T.PRODUCT_GRID })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    // Mock only knows p1.
    ctx.prisma.product.findMany.mockResolvedValue([{ id: 'p1' }]);
    await expect(
      service.setSectionProducts('g1', {
        rows: [{ productId: 'p1', sortOrder: 0 }, { productId: 'p2', sortOrder: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.setSectionProducts('g1', {
        rows: [{ productId: 'p1', sortOrder: 0 }, { productId: 'p1', sortOrder: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 6: 运行确认失败**

```bash
cd backend
pnpm exec vitest run src/modules/cms/homepage.service.spec.ts
```

Expected: FAIL（模块/服务不存在）。

- [ ] **Step 7: 实现 HomepageService**

Create `backend/src/modules/cms/homepage.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HomepageSectionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { ProductsService } from '../catalog/products.service.js';
import {
  homepagePayloadSchemas,
  type SaveHomepageSectionsInput,
  type SetHomepageProductsInput,
} from './dto/homepage-section.dto.js';

/**
 * App-layer multiplicity rules (spec §3). type stays non-unique at the DB
 * level because PRODUCT_GRID/PRODUCT_STORY legitimately repeat.
 */
const SECTION_LIMITS: Record<HomepageSectionType, number> = {
  [HomepageSectionType.HERO]: 1,
  [HomepageSectionType.USP]: 1,
  [HomepageSectionType.CATEGORY_TILES]: 1,
  [HomepageSectionType.PRODUCT_GRID]: 3,
  [HomepageSectionType.SOLUTIONS]: 1,
  [HomepageSectionType.PRODUCT_STORY]: 2,
  [HomepageSectionType.ROOM_INSPIRATION]: 1,
  [HomepageSectionType.UGC]: 1,
  [HomepageSectionType.BRAND_STORY]: 1,
  [HomepageSectionType.CONFIDENCE]: 1,
};

type SectionWithProducts = Prisma.HomepageSectionGetPayload<{
  include: { products: true };
}>;

type HydratedProduct = Awaited<
  ReturnType<ProductsService['storefrontByIds']>
>[number];

@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // --- storefront ----------------------------------------------------------

  async storefrontGet() {
    const sections = await this.prisma.homepageSection.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { products: { orderBy: { sortOrder: 'asc' } } },
    });

    // One batched product lookup for join products and payload productIds.
    const productIds = new Set<string>();
    for (const section of sections) {
      for (const joinRow of section.products) productIds.add(joinRow.productId);
      const payload = this.payloadObject(section);
      if (
        section.type === HomepageSectionType.PRODUCT_STORY &&
        typeof payload.productId === 'string'
      ) {
        productIds.add(payload.productId);
      }
      if (section.type === HomepageSectionType.UGC && Array.isArray(payload.entries)) {
        for (const entry of payload.entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            'productId' in entry &&
            typeof entry.productId === 'string'
          ) {
            productIds.add(entry.productId);
          }
        }
      }
    }

    const hydrated = await this.products.storefrontByIds([...productIds]);
    const productById = new Map(hydrated.map((product) => [product.id, product]));

    return {
      sections: await Promise.all(
        sections.map((section) => this.presentSection(section, productById)),
      ),
    };
  }

  private async presentSection(
    section: SectionWithProducts,
    productById: Map<string, HydratedProduct>,
  ) {
    const payload = this.payloadObject(section);
    const base = {
      id: section.id,
      type: section.type,
      title: section.title,
      subtitle: section.subtitle,
      sortOrder: section.sortOrder,
    };

    if (section.type === HomepageSectionType.CATEGORY_TILES) {
      const ids = Array.isArray(payload.categoryIds)
        ? payload.categoryIds.filter((x): x is string => typeof x === 'string')
        : [];
      return { ...base, payload, categories: ids.length > 0 ? await this.categoriesByIds(ids) : [] };
    }

    if (section.type === HomepageSectionType.PRODUCT_GRID) {
      // Only ACTIVE products with a priced, in-stock SKU appear. Empty grids
      // still come back so the frontend can render its empty state.
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter((product): product is HydratedProduct => !!product && this.isSellable(product))
        .map((product) => ({
          ...product,
          badge: section.products.find((j) => j.productId === product.id)?.badge ?? null,
        }));
      return { ...base, payload, products };
    }

    if (section.type === HomepageSectionType.ROOM_INSPIRATION) {
      // Shop-this-room thumbs show every ACTIVE joined product (no stock gate).
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter((product): product is HydratedProduct => product !== undefined)
        .map((product) => ({
          ...product,
          badge: section.products.find((j) => j.productId === product.id)?.badge ?? null,
        }));
      return { ...base, payload, products };
    }

    if (section.type === HomepageSectionType.PRODUCT_STORY) {
      const nextPayload: Record<string, unknown> = { ...payload };
      if (typeof nextPayload.productId === 'string') {
        const product = productById.get(nextPayload.productId);
        delete nextPayload.productId;
        if (product) nextPayload.product = product;
      }
      return { ...base, payload: nextPayload };
    }

    if (section.type === HomepageSectionType.UGC) {
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const nextEntries = entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const { productId, ...rest } = entry as Record<string, unknown>;
        if (typeof productId !== 'string') return rest;
        const product = productById.get(productId);
        return product ? { ...rest, product } : rest;
      });
      return { ...base, payload: { ...payload, entries: nextEntries } };
    }

    return { ...base, payload };
  }

  /** A homepage grid product is sellable with one priced, in-stock SKU. */
  private isSellable(product: HydratedProduct): boolean {
    return product.variants.some(
      (variant) =>
        variant.sku !== null &&
        variant.sku.price !== null &&
        variant.sku.availableInventory > 0,
    );
  }

  private async categoriesByIds(ids: string[]) {
    const rows = await this.prisma.category.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', imageUrl: { not: null } },
      select: { id: true, name: true, slug: true, imageUrl: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => row !== undefined)
      .map((row) => ({ ...row, imageUrl: row.imageUrl as string }));
  }

  private payloadObject(section: { payload: Prisma.JsonValue | null }): Record<string, unknown> {
    return section.payload && typeof section.payload === 'object' && !Array.isArray(section.payload)
      ? (section.payload as Record<string, unknown>)
      : {};
  }

  // --- admin ---------------------------------------------------------------

  async adminList() {
    return this.prisma.homepageSection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        products: {
          orderBy: { sortOrder: 'asc' },
          include: {
            product: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    });
  }

  async saveSections(input: SaveHomepageSectionsInput) {
    const rows = input.sections;
    const existing = await this.prisma.homepageSection.findMany();
    const byId = new Map(existing.map((section) => [section.id, section]));

    for (const row of rows) {
      if (row.id && !byId.has(row.id)) {
        throw new NotFoundException(`Homepage section ${row.id} not found`);
      }
      if (!row.id && !row.type) {
        throw new BadRequestException('type is required when creating a section');
      }
      if (row.id && row.type && byId.get(row.id)?.type !== row.type) {
        throw new BadRequestException('Section type cannot be changed');
      }
    }

    // Multiplicity over the FINAL set: omitted singleton sections survive
    // (they can only be disabled, spec §6); omitted non-singletons are deleted.
    const incomingIds = new Set(rows.filter((row) => row.id).map((row) => row.id as string));
    const survivors = existing.filter(
      (section) => !incomingIds.has(section.id) && SECTION_LIMITS[section.type] === 1,
    );

    const counts = new Map<HomepageSectionType, number>();
    const bump = (type: HomepageSectionType) => counts.set(type, (counts.get(type) ?? 0) + 1);
    survivors.forEach((section) => bump(section.type));
    rows.forEach((row) => bump(row.id ? byId.get(row.id)!.type : row.type!));

    for (const [type, count] of counts) {
      if (count > SECTION_LIMITS[type]) {
        throw new BadRequestException(
          `At most ${SECTION_LIMITS[type]} section(s) of type ${type} allowed`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const deleteIds = existing
        .filter(
          (section) =>
            !incomingIds.has(section.id) && SECTION_LIMITS[section.type] !== 1,
        )
        .map((section) => section.id);
      if (deleteIds.length > 0) {
        await tx.homepageSection.deleteMany({ where: { id: { in: deleteIds } } });
      }

      for (const row of rows) {
        const type = row.id ? byId.get(row.id)!.type : row.type!;

        if (row.id) {
          const data: Prisma.HomepageSectionUpdateInput = {};
          if (row.title !== undefined) data.title = row.title;
          if (row.subtitle !== undefined) data.subtitle = row.subtitle;
          data.enabled = row.enabled;
          data.sortOrder = row.sortOrder;
          if (row.payload !== undefined) {
            data.payload = this.validatePayload(type, row.payload);
          }
          await tx.homepageSection.update({ where: { id: row.id }, data });
        } else {
          await tx.homepageSection.create({
            data: {
              type,
              title: row.title ?? null,
              subtitle: row.subtitle ?? null,
              enabled: row.enabled,
              sortOrder: row.sortOrder,
              payload:
                row.payload === undefined
                  ? Prisma.DbNull
                  : this.validatePayload(type, row.payload),
            },
          });
        }
      }
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.adminList();
  }

  async setSectionProducts(sectionId: string, input: SetHomepageProductsInput) {
    const section = await this.prisma.homepageSection.findUnique({
      where: { id: sectionId },
      select: { id: true },
    });
    if (!section) throw new NotFoundException('Homepage section not found');

    const rows = input.rows;
    const productIds = [...new Set(rows.map((row) => row.productId))];
    if (productIds.length !== rows.length) {
      throw new BadRequestException('A product can only appear once in a section');
    }

    if (productIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== productIds.length) {
        throw new BadRequestException('Some selected products do not exist');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.homepageSectionProduct.deleteMany({ where: { sectionId } });
      if (rows.length > 0) {
        await tx.homepageSectionProduct.createMany({
          data: rows.map((row) => ({
            sectionId,
            productId: row.productId,
            sortOrder: row.sortOrder,
            badge: row.badge ?? null,
          })),
        });
      }
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return { ok: true as const, count: rows.length };
  }

  private validatePayload(
    type: HomepageSectionType,
    payload: unknown,
  ): Prisma.InputJsonValue {
    const parsed = homepagePayloadSchemas[type].safeParse(payload ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        'Validation failed: ' +
          parsed.error.issues
            .map((issue) => `payload.${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; '),
      );
    }
    return parsed.data as Prisma.InputJsonValue;
  }
}
```

- [ ] **Step 8: 实现两个 controller 与 module**

Create `backend/src/modules/cms/storefront/homepage.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { HomepageService } from '../homepage.service.js';

/** Public homepage composition endpoint. Anonymous; data is whitelisted in the service. */
@Controller('storefront/homepage')
export class StorefrontHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  get() {
    return this.homepage.storefrontGet();
  }
}
```

Create `backend/src/modules/cms/admin/homepage.controller.ts`:

```ts
import { Body, Controller, Get, Param, Put, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  saveHomepageSectionsSchema,
  setHomepageProductsSchema,
  type SaveHomepageSectionsInput,
  type SetHomepageProductsInput,
} from '../dto/homepage-section.dto.js';
import { HomepageService } from '../homepage.service.js';

/**
 * Homepage CMS admin routes. Reuses PRODUCT_MANAGE: no dedicated content
 * permission exists in V1 (spec §4.4 decision).
 */
@Controller('admin/homepage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get('sections')
  list() {
    return this.homepage.adminList();
  }

  @Patch('sections')
  save(
    @Body(new ZodValidationPipe(saveHomepageSectionsSchema)) input: SaveHomepageSectionsInput,
  ) {
    return this.homepage.saveSections(input);
  }

  @Put('sections/:id/products')
  setProducts(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setHomepageProductsSchema)) input: SetHomepageProductsInput,
  ) {
    return this.homepage.setSectionProducts(id, input);
  }
}
```

Create `backend/src/modules/cms/cms.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminHomepageController } from './admin/homepage.controller.js';
import { HomepageService } from './homepage.service.js';
import { StorefrontHomepageController } from './storefront/homepage.controller.js';

@Module({
  // AuthModule for JWT guards; CatalogModule exports ProductsService (shared
  // sellability/rating pipeline).
  imports: [AuthModule, CatalogModule],
  controllers: [StorefrontHomepageController, AdminHomepageController],
  providers: [HomepageService],
})
export class CmsModule {}
```

Modify `backend/src/app.module.ts`：import 区按字母序在 CatalogModule 一行之后加：

```ts
import { CmsModule } from './modules/cms/cms.module.js';
```

imports 数组中 `CatalogModule,` 之后加一行 `CmsModule,`。

- [ ] **Step 9: 全部测试 + lint + build**

```bash
cd backend
pnpm exec vitest run
pnpm lint
pnpm build
```

Expected: 全部 PASS（含既有测试无回归），lint/build 干净。

- [ ] **Step 10: Commit**

```bash
git add src/modules/catalog/dto/product.dto.ts src/modules/catalog/products.service.ts src/modules/catalog/catalog.module.ts
git add src/modules/catalog/products.service.spec.ts
git add src/modules/cms
git add src/app.module.ts
git commit -m "feat(homepage): CMS module — storefront composition + admin section APIs"
```

---

### Task 4: Seed 默认首页区块（`ensureHomepageSections`）

**Files:**
- Modify: `backend/prisma/seed.ts`（import enum、main() 追加调用、文件末尾追加函数）

**Interfaces:**
- Consumes: Task 1 的 `HomepageSectionType` enum / `homepageSection` delegate；`categories` 表（`parentId/status/sortOrder`）。
- Produces: §3 IA 顺序的 12 条 enabled 默认区块（固定 sortOrder 0–110，步长 10）；可重复执行。

- [ ] **Step 1: 扩展 generated client 导入**

`prisma/seed.ts` 顶部从 `../src/generated/prisma/client.js` 的命名导入里加 `HomepageSectionType`：

```ts
import {
  PrismaClient,
  HomepageSectionType,
  PermissionCode,
  RoleCode,
  type PermissionCode as PermissionCodeType,
  type RoleCode as RoleCodeType,
} from '../src/generated/prisma/client.js';
```

- [ ] **Step 2: main() 追加调用**

`main()` 末尾（`await ensureCoreCollections();` 之后）加：

```ts
  await ensureHomepageSections();
```

- [ ] **Step 3: 追加 ensureHomepageSections()**

在 `ensureCoreCollections()` 函数之后、`main()` 调用之前插入（所有文案来自 spec §4.5；品牌故事正文来自 BRAND_FOUNDATION_V1.md §3.4，去掉 markdown 斜体记号；COD/配送既有文案不改）：

```ts
async function ensureHomepageSections(): Promise<void> {
  // Fixed business key: (type, sortOrder). Re-running the seed refreshes the
  // defaults but never duplicates a section. The two PRODUCT_STORY rows share
  // a type, so sortOrder is part of the key.
  const rootCategories = await prisma.category.findMany({
    where: { parentId: null, status: 'ACTIVE' },
    orderBy: { sortOrder: 'asc' },
    take: 6,
    select: { id: true },
  });

  const sections: Array<{
    type: HomepageSectionType;
    sortOrder: number;
    title: string | null;
    subtitle: string | null;
    payload: Record<string, unknown>;
  }> = [
    {
      type: HomepageSectionType.HERO,
      sortOrder: 0,
      title: 'Small Space. Big Luwag.',
      subtitle:
        'Furniture designed for condos, rentals and everyday small-space living.',
      payload: {
        ctaPrimaryText: 'Shop Small-Space Picks',
        ctaPrimaryLink: '/collections',
        ctaSecondaryText: 'Explore Solutions',
        ctaSecondaryLink: '#solutions',
      },
    },
    { type: HomepageSectionType.USP, sortOrder: 10, title: null, subtitle: null, payload: {} },
    {
      type: HomepageSectionType.CATEGORY_TILES,
      sortOrder: 20,
      title: 'Shop by Category',
      subtitle: null,
      payload: { categoryIds: rootCategories.map((c) => c.id) },
    },
    {
      type: HomepageSectionType.PRODUCT_GRID,
      sortOrder: 30,
      title: 'Small-Space Favorites',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.PRODUCT_STORY,
      sortOrder: 40,
      title: 'Made For Real Small Spaces',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.SOLUTIONS,
      sortOrder: 50,
      title: 'Shop by Solution',
      subtitle: 'Whatever your space problem, there is furniture built for it.',
      payload: {
        items: [
          { title: 'Small Bedroom', blurb: 'Compact beds, wardrobes and storage', link: '/collections/bedroom-essentials' },
          { title: 'Home Office', blurb: 'Foldable desks that disappear', link: '/collections/small-space-solutions' },
          { title: 'Rental Friendly', blurb: 'Portable, non-permanent furniture', link: '/collections/small-space-solutions' },
          { title: 'Foldable Furniture', blurb: 'Set up and stow in seconds', link: '/collections/small-space-solutions' },
          { title: 'Narrow Space', blurb: 'Slim profiles for tight corners', link: '/collections/small-space-solutions' },
          { title: 'Storage Solution', blurb: 'Make every corner useful', link: '/collections/storage-organization' },
        ],
      },
    },
    {
      type: HomepageSectionType.PRODUCT_STORY,
      sortOrder: 60,
      title: null,
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.PRODUCT_GRID,
      sortOrder: 70,
      title: 'Small Upgrades',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.ROOM_INSPIRATION,
      sortOrder: 80,
      title: 'Room Inspiration',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.UGC,
      sortOrder: 90,
      title: 'Real Homes',
      subtitle: null,
      payload: {},
    },
    {
      type: HomepageSectionType.BRAND_STORY,
      sortOrder: 100,
      title: null,
      subtitle: null,
      payload: {
        // BRAND_FOUNDATION_V1.md §3.4, verbatim wording (markdown italics removed).
        body: 'LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts. Our name comes from maluwag: spacious, easy-going, and maluwag sa budget. Pieces that fit, prices that don’t hurt, cash on delivery. Because a small space should feel maluwag.',
      },
    },
    {
      type: HomepageSectionType.CONFIDENCE,
      sortOrder: 110,
      title: null,
      subtitle: null,
      payload: {
        // Migrated unchanged from the previous homepage confidence bullets.
        bullets: [
          'Cash on Delivery — pay at your door',
          'Nationwide delivery',
          'Real-time order updates by phone',
        ],
      },
    },
  ];

  for (const section of sections) {
    const existing = await prisma.homepageSection.findFirst({
      where: { type: section.type, sortOrder: section.sortOrder },
      select: { id: true },
    });

    if (existing) {
      await prisma.homepageSection.update({
        where: { id: existing.id },
        data: {
          title: section.title,
          subtitle: section.subtitle,
          payload: section.payload,
          enabled: true,
        },
      });
    } else {
      await prisma.homepageSection.create({
        data: {
          type: section.type,
          sortOrder: section.sortOrder,
          title: section.title,
          subtitle: section.subtitle,
          payload: section.payload,
          enabled: true,
        },
      });
    }
  }

  console.log(`Ensured ${sections.length} homepage sections.`);
}
```

- [ ] **Step 4: 对隔离后端使用的共享库执行 seed（串行安全）**

seed 只对 homepage_sections 做 findFirst+update/create，并读 categories；与线 B 无写冲突。**不要重启用户的 :3000 后端**；直接在本 worktree 跑：

```bash
cd backend
pnpm exec prisma validate
pnpm exec tsx prisma/seed.ts
```

Expected: 输出含 `Ensured 12 homepage sections.`；其他 ensure* 日志保持幂等无报错。

- [ ] **Step 5: 验证幂等 + storefront 接口**

再跑一次 seed（行数不增加）：

```bash
pnpm exec tsx prisma/seed.ts
```

如隔离后端已在 :3010 运行（Task 8 会起；此步可选现在起），验证：

```bash
curl -s http://localhost:3010/api/v1/storefront/homepage | head -c 600
```

Expected: JSON `sections` 数组，按 sortOrder 0…110，空 grid 的 `products: []` 照常返回；USP payload 为 `{}`。

- [ ] **Step 6: lint + build + commit**

```bash
pnpm lint
pnpm build
git add prisma/seed.ts
git commit -m "feat(homepage): seed default IA sections, solutions, brand and confidence copy"
```

---

### Task 5: 首页装修后台（admin-api + 管理页 + 导航入口）

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`（末尾加类型 + 3 个方法，纯新增）
- Create: `frontend/src/app/admin/(shell)/homepage/page.tsx`
- Modify: `frontend/src/components/admin/AdminShell.tsx`（NAV_ITEMS 加一项）

**Interfaces:**
- Consumes: `GET /api/v1/admin/homepage/sections`、`PATCH .../sections`、`PUT .../sections/:id/products`（Task 3）；`adminApi.listProducts` / `listCategories` / `presignUpload`（已有）；admin primitives `Dialog/Field/TextInput/Select/Textarea/ImageUrlInput/Button/EmptyState/PageHeader/TableSkeleton`；`useAdminAuth().hasPermission`、`errorStatus`。
- Produces:
  - `adminApi.listHomepageSections(): Promise<AdminHomepageSection[]>`
  - `adminApi.saveHomepageSections(sections: SaveHomepageSectionInput[]): Promise<AdminHomepageSection[]>`
  - `adminApi.setHomepageSectionProducts(id, rows: SetHomepageProductsRow[]): Promise<{ok:boolean;count:number}>`
  - 管理页路由 `/admin/homepage`，权限 `PRODUCT_MANAGE`。

- [ ] **Step 1: admin-api.ts 加类型与方法（在 `presignUpload` 方法之后、对象闭合 `};` 之前插入）**

```ts
  // --- homepage CMS ---------------------------------------------------------

  listHomepageSections: (): Promise<AdminHomepageSection[]> =>
    adminAuthedFetch<AdminHomepageSection[]>("/api/v1/admin/homepage/sections"),

  saveHomepageSections: (
    sections: SaveHomepageSectionInput[],
  ): Promise<AdminHomepageSection[]> =>
    adminAuthedFetch<AdminHomepageSection[]>("/api/v1/admin/homepage/sections", {
      method: "PATCH",
      body: JSON.stringify({ sections }),
    }),

  setHomepageSectionProducts: (
    id: string,
    rows: SetHomepageProductsRow[],
  ): Promise<{ ok: boolean; count: number }> =>
    adminAuthedFetch<{ ok: boolean; count: number }>(
      `/api/v1/admin/homepage/sections/${encodeURIComponent(id)}/products`,
      { method: "PUT", body: JSON.stringify({ rows }) },
    ),
```

同文件类型区（放在 landing-pages 类型附近即可）追加：

```ts
// --- homepage CMS ------------------------------------------------------------

export type HomepageSectionType =
  | "HERO"
  | "USP"
  | "CATEGORY_TILES"
  | "PRODUCT_GRID"
  | "SOLUTIONS"
  | "PRODUCT_STORY"
  | "ROOM_INSPIRATION"
  | "UGC"
  | "BRAND_STORY"
  | "CONFIDENCE";

export interface AdminHomepageSectionProduct {
  id: string;
  productId: string;
  sortOrder: number;
  badge: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
  };
}

/** Raw admin row: payload is the unvalidated Json blob the per-type editors read/write. */
export interface AdminHomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: Record<string, unknown> | null;
  products: AdminHomepageSectionProduct[];
}

export interface SaveHomepageSectionInput {
  id?: string;
  type?: HomepageSectionType;
  title?: string | null;
  subtitle?: string | null;
  enabled: boolean;
  sortOrder: number;
  payload?: unknown;
}

export interface SetHomepageProductsRow {
  productId: string;
  sortOrder: number;
  badge?: string | null;
}
```

注：`ProductStatus` 已在该文件定义，直接引用。

- [ ] **Step 2: AdminShell 导航加入口**

`src/components/admin/AdminShell.tsx` 的 `NAV_ITEMS`，在 Collections 一行之后插入：

```ts
  { href: "/admin/homepage", label: "首页装修", permission: "PRODUCT_MANAGE" },
```

- [ ] **Step 3: 类型检查（页面尚未建，应通过）**

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 创建装修页**

Create `frontend/src/app/admin/(shell)/homepage/page.tsx`（整文件一次写入；所有操作提示中文；不引入新依赖）：

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput, Textarea } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCategoryNode,
  type AdminHomepageSection,
  type AdminProduct,
  type HomepageSectionType,
  type SaveHomepageSectionInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

const TYPE_LABELS: Record<HomepageSectionType, string> = {
  HERO: "主视觉 Hero",
  USP: "信任承诺条",
  CATEGORY_TILES: "分类瓷砖",
  PRODUCT_GRID: "商品网格",
  SOLUTIONS: "方案入口",
  PRODUCT_STORY: "商品故事",
  ROOM_INSPIRATION: "房间灵感",
  UGC: "真实买家秀",
  BRAND_STORY: "品牌故事",
  CONFIDENCE: "购买保障",
};

const SECTION_LIMITS: Record<HomepageSectionType, number> = {
  HERO: 1, USP: 1, CATEGORY_TILES: 1, SOLUTIONS: 1,
  ROOM_INSPIRATION: 1, UGC: 1, BRAND_STORY: 1, CONFIDENCE: 1,
  PRODUCT_STORY: 2, PRODUCT_GRID: 3,
};

const SINGLETON_TYPES = new Set<HomepageSectionType>(
  (Object.keys(SECTION_LIMITS) as HomepageSectionType[]).filter(
    (type) => SECTION_LIMITS[type] === 1,
  ),
);

const USP_ICONS = [
  { value: "shield", label: "盾牌" },
  { value: "home", label: "房子" },
  { value: "lock", label: "锁" },
  { value: "truck", label: "货车" },
];

interface JoinDraft {
  productId: string;
  sortOrder: number;
  badge: string;
}

interface SectionDraft {
  key: string;
  id?: string;
  type: HomepageSectionType;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  payload: Record<string, unknown>;
  products: JoinDraft[];
  joinsDirty: boolean;
}

type PickerState =
  | { key: string; mode: "multi" }
  | { key: string; mode: "single"; target: { kind: "story" } | { kind: "ugc"; index: number } }
  | null;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function flattenCategories(
  nodes: AdminCategoryNode[],
  depth = 0,
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const node of nodes) {
    out.push({ id: node.id, label: `${"　".repeat(depth)}${node.name}` });
    out.push(...flattenCategories(node.children ?? [], depth + 1));
  }
  return out;
}

/** Strip empty optional fields per type so payloads always pass backend zod. */
function sanitizePayload(
  type: HomepageSectionType,
  p: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const copy = (key: string) => {
    const value = str(p[key]).trim();
    if (value) out[key] = value;
  };

  switch (type) {
    case "HERO":
      [
        "desktopImage", "mobileImage", "videoUrl", "posterImage",
        "ctaPrimaryText", "ctaPrimaryLink", "ctaSecondaryText", "ctaSecondaryLink",
      ].forEach(copy);
      return out;
    case "USP": {
      const items = Array.isArray(p.items) ? p.items : [];
      out.items = items
        .filter((i) => i && str(i.label).trim())
        .map((i) => ({
          ...(i.icon ? { icon: i.icon } : {}),
          label: str(i.label).trim(),
          ...(str(i.sub).trim() ? { sub: str(i.sub).trim() } : {}),
        }));
      return out;
    }
    case "CATEGORY_TILES":
      out.categoryIds = Array.isArray(p.categoryIds)
        ? p.categoryIds.filter((x): x is string => typeof x === "string")
        : [];
      return out;
    case "PRODUCT_GRID":
      if (p.columns === 2 || p.columns === 4) out.columns = p.columns;
      return out;
    case "SOLUTIONS": {
      const items = Array.isArray(p.items) ? p.items : [];
      out.items = items
        .filter((i) => i && str(i.title).trim() && str(i.link).trim())
        .map((i) => ({
          title: str(i.title).trim(),
          ...(str(i.blurb).trim() ? { blurb: str(i.blurb).trim() } : {}),
          link: str(i.link).trim(),
        }));
      return out;
    }
    case "PRODUCT_STORY": {
      ["imageUrl", "heading", "body", "ctaText", "ctaLink"].forEach(copy);
      const productId = str(p.productId).trim();
      if (productId) out.productId = productId;
      return out;
    }
    case "ROOM_INSPIRATION":
      ["imageUrl", "heading", "body"].forEach(copy);
      return out;
    case "UGC": {
      const entries = Array.isArray(p.entries) ? p.entries : [];
      out.entries = entries
        .filter((e) => e && str(e.name).trim() && str(e.comment).trim())
        .map((e) => {
          const o: Record<string, unknown> = {
            name: str(e.name).trim(),
            comment: str(e.comment).trim(),
          };
          if (str(e.location).trim()) o.location = str(e.location).trim();
          if (str(e.imageUrl).trim()) o.imageUrl = str(e.imageUrl).trim();
          const productId = str(e.productId).trim();
          if (productId) o.productId = productId;
          return o;
        });
      return out;
    }
    case "BRAND_STORY":
    case "CONFIDENCE": {
      ["heading", "body"].forEach(copy);
      const bullets = Array.isArray(p.bullets) ? p.bullets : [];
      out.bullets = bullets.map((b) => str(b).trim()).filter(Boolean);
      return out;
    }
  }
}

function toDraft(row: AdminHomepageSection): SectionDraft {
  return {
    key: row.id,
    id: row.id,
    type: row.type,
    title: row.title ?? "",
    subtitle: row.subtitle ?? "",
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    payload: row.payload ?? {},
    products: row.products.map((j) => ({
      productId: j.productId,
      sortOrder: j.sortOrder,
      badge: j.badge ?? "",
    })),
    joinsDirty: false,
  };
}

// --- small field helpers -----------------------------------------------------

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      {children}
    </Field>
  );
}

function MediaField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <Labeled label={label} hint={hint}>
      <ImageUrlInput id={id} ariaLabel={label} value={value} onChange={onChange} placeholder="https://…" />
    </Labeled>
  );
}

// --- product picker dialog ---------------------------------------------------

function ProductPickerDialog({
  open,
  title,
  multi,
  initialSelected,
  onClose,
  onApply,
  onNames,
}: {
  open: boolean;
  title: string;
  multi: boolean;
  initialSelected: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
  onNames: (names: Record<string, string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const run = useCallback((query: string) => {
    setLoading(true);
    adminApi
      .listProducts({ search: query || undefined, page: 1, pageSize: 20 })
      .then((res) => {
        setItems(res.items);
        onNames(Object.fromEntries(res.items.map((p) => [p.id, p.name])));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [onNames]);

  useEffect(() => {
    if (open) {
      setPicked(new Set(initialSelected));
      setSearch("");
      run("");
    }
    // run is stable enough; dialog remounts per open via `key` from parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} width="lg">
      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(search);
          }}
        >
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按商品名搜索（每次显示前 20 条）"
          />
          <Button type="submit" variant="secondary">
            搜索
          </Button>
        </form>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <p className="p-4 text-sm text-ink-muted">加载中…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">没有匹配商品。</p>
          ) : (
            items.map((product) => (
              <label
                key={product.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-primary-light/30"
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  checked={picked.has(product.id)}
                  onChange={() => toggle(product.id)}
                />
                <span className="flex-1 text-sm text-ink">{product.name}</span>
                <span className="text-xs text-ink-muted">
                  {product.status === "ACTIVE" ? "在售" : "已下架"}
                </span>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-between gap-2">
          {!multi ? (
            <Button
              variant="text"
              onClick={() => {
                onApply([]);
              }}
            >
              清除关联
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => {
                onApply([...picked]);
              }}
            >
              确定（已选 {picked.size}）
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// --- per-type payload editors ------------------------------------------------

interface EditorProps {
  draft: SectionDraft;
  categories: Array<{ id: string; label: string }>;
  names: Record<string, string>;
  patch: (patch: Record<string, unknown>) => void;
  setProducts: (rows: JoinDraft[]) => void;
  openPicker: (state: Exclude<PickerState, null>) => void;
}

function JoinsEditor({ draft, names, setProducts, openPicker }: EditorProps) {
  const reindex = (rows: JoinDraft[]) => rows.map((r, i) => ({ ...r, sortOrder: i }));

  const move = (index: number, delta: number) => {
    const rows = [...draft.products];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    setProducts(reindex(rows));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        {draft.type === "ROOM_INSPIRATION"
          ? "房间灵感展示全部关联商品（不按库存过滤）；前台按下方顺序排列。"
          : "只展示在售且有可售库存的商品；无商品时前台显示占位卡。"}
      </p>
      {draft.products.map((row, index) => (
        <div
          key={row.productId}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {names[row.productId] ?? row.productId}
          </span>
          <input
            aria-label="角标文字"
            className="w-28 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-ink"
            value={row.badge}
            maxLength={20}
            placeholder="角标，如：新品"
            onChange={(e) => {
              const rows = [...draft.products];
              rows[index] = { ...rows[index], badge: e.target.value };
              setProducts(rows);
            }}
          />
          <Button variant="text" onClick={() => move(index, -1)} disabled={index === 0}>
            ↑
          </Button>
          <Button
            variant="text"
            onClick={() => move(index, 1)}
            disabled={index === draft.products.length - 1}
          >
            ↓
          </Button>
          <Button
            variant="text"
            onClick={() =>
              setProducts(reindex(draft.products.filter((_, i) => i !== index)))
            }
          >
            移除
          </Button>
        </div>
      ))}
      {!draft.id ? (
        <p className="text-xs text-ink-muted">新区块请先点页面底部「保存发布」，之后再选择商品。</p>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "multi" })}>
            选择商品
          </Button>
        </div>
      )}
    </div>
  );
}

function PayloadEditor(props: EditorProps) {
  const { draft, categories, patch, openPicker } = props;
  const p = draft.payload;

  const setField = (key: string, value: unknown) => patch({ [key]: value });

  switch (draft.type) {
    case "HERO":
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MediaField id="hero-desktop" label="桌面端图片 URL" value={str(p.desktopImage)} onChange={(v) => setField("desktopImage", v)} hint="建议宽 1600px 以上；不上传则显示奶油色渐变文字版。" />
          <MediaField id="hero-mobile" label="移动端图片 URL" value={str(p.mobileImage)} onChange={(v) => setField("mobileImage", v)} hint="建议竖图或方图；留空时移动端使用桌面图。" />
          <MediaField id="hero-video" label="桌面端视频 URL（可选）" value={str(p.videoUrl)} onChange={(v) => setField("videoUrl", v)} hint="MP4 直链；桌面端无声自动循环播放，不显示控制条。" />
          <MediaField id="hero-poster" label="视频海报 / 移动端封面 URL" value={str(p.posterImage)} onChange={(v) => setField("posterImage", v)} hint="视频加载前与手机端展示的封面图。" />
          <Labeled label="主按钮文字"><TextInput value={str(p.ctaPrimaryText)} maxLength={120} onChange={(e) => setField("ctaPrimaryText", e.target.value)} /></Labeled>
          <Labeled label="主按钮链接" hint="站内路径（/collections）或 https 链接"><TextInput value={str(p.ctaPrimaryLink)} placeholder="/collections" onChange={(e) => setField("ctaPrimaryLink", e.target.value)} /></Labeled>
          <Labeled label="次按钮文字"><TextInput value={str(p.ctaSecondaryText)} maxLength={120} onChange={(e) => setField("ctaSecondaryText", e.target.value)} /></Labeled>
          <Labeled label="次按钮链接" hint="可用锚点，如 #solutions"><TextInput value={str(p.ctaSecondaryLink)} placeholder="#solutions" onChange={(e) => setField("ctaSecondaryLink", e.target.value)} /></Labeled>
        </div>
      );

    case "USP": {
      const items = Array.isArray(p.items) ? p.items : [];
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">
            留空（不添加任何条目）则前台显示默认四条：货到付款 / 小空间适用 / 安全结账 / 菲律宾配送。最多 4 条。
          </p>
          {items.map((item, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-2">
              <Labeled label="图标">
                <Select
                  value={str(item.icon)}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, icon: e.target.value || undefined };
                    setField("items", next);
                  }}
                >
                  <option value="">默认</option>
                  {USP_ICONS.map((icon) => (
                    <option key={icon.value} value={icon.value}>{icon.label}</option>
                  ))}
                </Select>
              </Labeled>
              <div className="flex-1">
                <Labeled label="承诺标题"><TextInput value={str(item.label)} maxLength={120} onChange={(e) => { const next=[...items]; next[index]={...item,label:e.target.value}; setField("items",next); }} /></Labeled>
              </div>
              <div className="flex-1">
                <Labeled label="补充说明"><TextInput value={str(item.sub)} maxLength={200} onChange={(e) => { const next=[...items]; next[index]={...item,sub:e.target.value}; setField("items",next); }} /></Labeled>
              </div>
              <Button variant="text" onClick={() => setField("items", items.filter((_, i) => i !== index))}>移除</Button>
            </div>
          ))}
          {items.length < 4 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("items", [...items, { label: "", sub: "" }])}>
                添加一条
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "CATEGORY_TILES": {
      const selected = new Set(
        Array.isArray(p.categoryIds) ? p.categoryIds.filter((x): x is string => typeof x === "string") : [],
      );
      const toggleCat = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else if (next.size >= 6) return;
        else next.add(id);
        setField("categoryIds", [...next]);
      };
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">勾选最多 6 个分类，按勾选顺序展示；停用、无图或已删除的分类前台自动跳过。</p>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 md:grid-cols-2">
            {categories.length === 0 ? (
              <p className="text-sm text-ink-muted">暂无分类。</p>
            ) : (
              categories.map((cat) => (
                <label key={cat.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-ink">
                  <input type="checkbox" checked={selected.has(cat.id)} onChange={() => toggleCat(cat.id)} />
                  <span className="truncate">{cat.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      );
    }

    case "PRODUCT_GRID":
      return (
        <div className="flex flex-col gap-3">
          <Labeled label="每行商品数（桌面端）" hint="默认 4 列；小空间故事场景可用 2 列大图。">
            <Select
              value={p.columns === 2 ? "2" : "4"}
              onChange={(e) => setField("columns", Number(e.target.value))}
            >
              <option value="4">4 列</option>
              <option value="2">2 列</option>
            </Select>
          </Labeled>
          <JoinsEditor {...props} />
        </div>
      );

    case "SOLUTIONS": {
      const items = Array.isArray(p.items) ? p.items : [];
      return (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background p-2 md:grid-cols-4">
              <Labeled label="方案标题"><TextInput value={str(item.title)} maxLength={120} onChange={(e) => { const n=[...items]; n[index]={...item,title:e.target.value}; setField("items",n); }} /></Labeled>
              <Labeled label="一句话说明"><TextInput value={str(item.blurb)} maxLength={300} onChange={(e) => { const n=[...items]; n[index]={...item,blurb:e.target.value}; setField("items",n); }} /></Labeled>
              <Labeled label="链接" hint="/collections/… 或 #锚点"><TextInput value={str(item.link)} placeholder="/collections/small-space-solutions" onChange={(e) => { const n=[...items]; n[index]={...item,link:e.target.value}; setField("items",n); }} /></Labeled>
              <div className="flex items-end"><Button variant="text" onClick={() => setField("items", items.filter((_, i) => i !== index))}>移除</Button></div>
            </div>
          ))}
          {items.length < 6 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("items", [...items, { title: "", blurb: "", link: "" }])}>
                添加方案（最多 6 个）
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "PRODUCT_STORY":
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MediaField id={`story-img-${draft.key}`} label="故事图片 URL" value={str(p.imageUrl)} onChange={(v) => setField("imageUrl", v)} />
          <Labeled label="标题"><TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} /></Labeled>
          <div className="md:col-span-2">
            <Labeled label="正文"><Textarea rows={3} maxLength={2000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} /></Labeled>
          </div>
          <Labeled label="按钮文字"><TextInput value={str(p.ctaText)} maxLength={120} onChange={(e) => setField("ctaText", e.target.value)} /></Labeled>
          <Labeled label="按钮链接"><TextInput value={str(p.ctaLink)} placeholder="/products/…" onChange={(e) => setField("ctaLink", e.target.value)} /></Labeled>
          <div className="md:col-span-2">
            <Labeled label="关联商品（可选）" hint="前台会附上最新价格与库存；商品下架后自动不展示。">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink">
                  {p.productId ? props.names[str(p.productId)] ?? str(p.productId) : "未关联"}
                </span>
                <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "single", target: { kind: "story" } })}>
                  选择商品
                </Button>
              </div>
            </Labeled>
          </div>
        </div>
      );

    case "ROOM_INSPIRATION":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MediaField id={`room-img-${draft.key}`} label="房间大图 URL" value={str(p.imageUrl)} onChange={(v) => setField("imageUrl", v)} />
            <Labeled label="标题"><TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} /></Labeled>
            <div className="md:col-span-2">
              <Labeled label="正文"><Textarea rows={3} maxLength={2000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} /></Labeled>
            </div>
          </div>
          <JoinsEditor {...props} />
        </div>
      );

    case "UGC": {
      const entries = Array.isArray(p.entries) ? p.entries : [];
      return (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-sale bg-sale/10 p-3 text-sm text-ink">
            仅可录入已获授权的真实客户内容，禁止伪造评价。每条建议留存授权凭证；无授权素材时保持为空，前台会显示中性的即将上线占位卡。
          </div>
          {entries.map((entry, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <MediaField id={`ugc-img-${draft.key}-${index}`} label="买家照片 URL（可选）" value={str(entry.imageUrl)} onChange={(v) => { const n=[...entries]; n[index]={...entry,imageUrl:v}; setField("entries",n); }} />
                <Labeled label="买家称呼"><TextInput value={str(entry.name)} maxLength={120} onChange={(e) => { const n=[...entries]; n[index]={...entry,name:e.target.value}; setField("entries",n); }} /></Labeled>
                <Labeled label="地区（可选）"><TextInput value={str(entry.location)} maxLength={120} onChange={(e) => { const n=[...entries]; n[index]={...entry,location:e.target.value}; setField("entries",n); }} /></Labeled>
                <div className="flex items-end">
                  <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "single", target: { kind: "ugc", index } })}>
                    {entry.productId ? `关联商品：${props.names[str(entry.productId)] ?? "已选"}` : "关联商品（可选）"}
                  </Button>
                </div>
              </div>
              <Labeled label="买家原话"><Textarea rows={2} maxLength={1000} value={str(entry.comment)} onChange={(e) => { const n=[...entries]; n[index]={...entry,comment:e.target.value}; setField("entries",n); }} /></Labeled>
              <div><Button variant="text" onClick={() => setField("entries", entries.filter((_, i) => i !== index))}>移除这条</Button></div>
            </div>
          ))}
          {entries.length < 6 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("entries", [...entries, { name: "", location: "", comment: "" }])}>
                添加买家秀（最多 6 条）
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "BRAND_STORY":
    case "CONFIDENCE": {
      const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)) : [];
      return (
        <div className="flex flex-col gap-3">
          <Labeled label="标题（可选）"><TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} /></Labeled>
          <Labeled label="正文（可选）"><Textarea rows={4} maxLength={3000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} /></Labeled>
          <Labeled label="要点列表（每行一条，最多 6 条）">
            <Textarea
              rows={4}
              value={bullets.join("\n")}
              onChange={(e) => setField("bullets", e.target.value.split("\n"))}
            />
          </Labeled>
        </div>
      );
    }
  }
}

// --- page --------------------------------------------------------------------

function HomepageAdminContent() {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [drafts, setDrafts] = useState<SectionDraft[] | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [addType, setAddType] = useState<HomepageSectionType>("PRODUCT_GRID");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);

  const reload = useCallback(() => {
    setDrafts(null);
    setError(null);
    setPermissionDenied(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([adminApi.listHomepageSections(), adminApi.listCategories()])
      .then(([sections, tree]) => {
        if (!active) return;
        setDrafts(sections.map(toDraft));
        setCategories(flattenCategories(tree));
        setNames(
          Object.fromEntries(
            sections.flatMap((s) => s.products.map((j) => [j.productId, j.product.name] as const)),
          ),
        );
        setError(null);
        setPermissionDenied(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPermissionDenied(errorStatus(err) === 403);
        setError(err instanceof Error ? err.message : "加载失败。");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const sorted = useMemo(
    () => (drafts ? [...drafts].sort((a, b) => a.sortOrder - b.sortOrder) : null),
    [drafts],
  );

  const counts = useMemo(() => {
    const map = new Map<HomepageSectionType, number>();
    drafts?.forEach((d) => map.set(d.type, (map.get(d.type) ?? 0) + 1));
    return map;
  }, [drafts]);

  const patchDraft = (key: string, patch: Partial<SectionDraft>) =>
    setDrafts((prev) => prev!.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const patchPayload = (key: string, payloadPatch: Record<string, unknown>) =>
    setDrafts((prev) =>
      prev!.map((d) =>
        d.key === key ? { ...d, payload: { ...d.payload, ...payloadPatch } } : d,
      ),
    );

  const setJoinRows = (key: string, rows: JoinDraft[]) =>
    setDrafts((prev) =>
      prev!.map((d) => (d.key === key ? { ...d, products: rows, joinsDirty: true } : d)),
    );

  const addSection = () => {
    const maxSort = Math.max(-10, ...(drafts ?? []).map((d) => d.sortOrder));
    const draft: SectionDraft = {
      key: `new-${crypto.randomUUID()}`,
      type: addType,
      title: "",
      subtitle: "",
      enabled: true,
      sortOrder: maxSort + 10,
      payload: {},
      products: [],
      joinsDirty: false,
    };
    setDrafts((prev) => [...(prev ?? []), draft]);
  };

  const removeSection = (key: string) =>
    setDrafts((prev) => prev!.filter((d) => d.key !== key));

  const moveSection = (index: number, delta: number) => {
    if (!sorted) return;
    const target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[target];
    setDrafts((prev) =>
      prev!.map((d) => {
        if (d.key === a.key) return { ...d, sortOrder: b.sortOrder };
        if (d.key === b.key) return { ...d, sortOrder: a.sortOrder };
        return d;
      }),
    );
  };

  const saveAll = async () => {
    if (!sorted) return;
    setSaving(true);
    setSaveError(null);

    const body: SaveHomepageSectionInput[] = sorted.map((d) => ({
      ...(d.id ? { id: d.id } : { type: d.type }),
      title: d.title.trim() || null,
      subtitle: d.subtitle.trim() || null,
      enabled: d.enabled,
      sortOrder: d.sortOrder,
      payload: sanitizePayload(d.type, d.payload),
    }));

    try {
      const saved = await adminApi.saveHomepageSections(body);
      const savedSorted = [...saved].sort((a, b) => a.sortOrder - b.sortOrder);

      // Draft order and the persisted set are 1:1 (singletons are never
      // deletable, deleted non-singletons are gone on both sides).
      const dirty = sorted
        .map((draft, index) => ({ draft, saved: savedSorted[index] }))
        .filter(({ draft }) => draft.joinsDirty && draft.id);

      for (const { draft, saved: row } of dirty) {
        if (!row) continue;
        await adminApi.setHomepageSectionProducts(
          row.id,
          draft.products.map((r, i) => ({
            productId: r.productId,
            sortOrder: i,
            badge: r.badge.trim() || null,
          })),
        );
      }

      setSavedAt(new Date().toLocaleTimeString());
      reload();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const onPickerApply = (ids: string[]) => {
    if (!picker) return;
    const draft = drafts?.find((d) => d.key === picker.key);
    if (!draft) {
      setPicker(null);
      return;
    }

    if (picker.mode === "multi") {
      const existing = draft.products.filter((r) => ids.includes(r.productId));
      const known = new Set(existing.map((r) => r.productId));
      const added = ids
        .filter((id) => !known.has(id))
        .map((id) => ({ productId: id, sortOrder: 0, badge: "" }));
      const rows = [...existing, ...added].map((r, i) => ({ ...r, sortOrder: i }));
      setJoinRows(draft.key, rows);
    } else if (picker.target.kind === "story") {
      patchPayload(draft.key, { productId: ids[0] ?? "" });
    } else {
      const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
      const next = [...entries];
      next[picker.target.index] = {
        ...next[picker.target.index],
        productId: ids[0] ?? "",
      };
      patchPayload(draft.key, { entries: next });
    }
    setPicker(null);
  };

  const pickerInitial = useMemo<string[]>(() => {
    if (!picker) return [];
    const draft = drafts?.find((d) => d.key === picker.key);
    if (!draft) return [];
    if (picker.mode === "multi") return draft.products.map((r) => r.productId);
    if (picker.target.kind === "story") return str(draft.payload.productId) ? [str(draft.payload.productId)] : [];
    const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
    const value = str(entries[picker.target.index]?.productId);
    return value ? [value] : [];
  }, [picker, drafts]);

  if (!canManage) {
    return (
      <EmptyState
        title="没有权限"
        hint="首页装修需要商品管理权限（PRODUCT_MANAGE），请联系管理员。"
      />
    );
  }
  if (permissionDenied) {
    return <EmptyState title="没有权限" hint="后台拒绝了本次访问（403）。" />;
  }
  if (error) {
    return (
      <EmptyState
        title="加载失败"
        hint={error}
        action={<Button onClick={reload}>重试</Button>}
      />
    );
  }
  if (!sorted) return <TableSkeleton />;

  return (
    <>
      <PageHeader
        title="首页装修"
        count={sorted.length}
        actions={
          <div className="flex items-center gap-3">
            {savedAt ? <span className="text-sm text-ink-secondary">已发布 {savedAt}</span> : null}
            <Button onClick={saveAll} disabled={saving}>
              {saving ? "保存中…" : "保存发布"}
            </Button>
          </div>
        }
      />

      {saveError ? (
        <div className="mb-4 rounded-lg border border-sale bg-sale/10 p-3 text-sm text-ink">
          保存失败：{saveError}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <Labeled label="添加新区块">
          <Select
            value={addType}
            onChange={(e) => setAddType(e.target.value as HomepageSectionType)}
          >
            {(Object.keys(TYPE_LABELS) as HomepageSectionType[]).map((type) => {
              const left = SECTION_LIMITS[type] - (counts.get(type) ?? 0);
              return (
                <option key={type} value={type} disabled={left <= 0}>
                  {TYPE_LABELS[type]}（{left <= 0 ? "已达上限" : `还可加 ${left}`}）
                </option>
              );
            })}
          </Select>
        </Labeled>
        <Button variant="secondary" onClick={addSection}>
          添加区块
        </Button>
        <span className="text-xs text-ink-muted">
          单例区块（Hero/信任条/分类/方案/房间/UGC/品牌/保障）只能停用，不能删除；排序与启用状态保存后生效。
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {sorted.map((draft, index) => (
          <section
            key={draft.key}
            className={`rounded-lg border bg-card p-4 ${
              draft.enabled ? "border-border" : "border-border opacity-60"
            }`}
          >
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <strong className="text-sm text-ink">{TYPE_LABELS[draft.type]}</strong>
              {SINGLETON_TYPES.has(draft.type) ? (
                <span className="rounded bg-primary-light/60 px-2 py-0.5 text-xs text-ink-secondary">
                  单例
                </span>
              ) : null}
              {draft.type === "PRODUCT_GRID" || draft.type === "ROOM_INSPIRATION" ? (
                <span className="text-xs text-ink-muted">{draft.products.length} 个商品</span>
              ) : null}
              <label className="ml-1 flex items-center gap-1 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patchDraft(draft.key, { enabled: e.target.checked })}
                />
                启用
              </label>
              <span className="flex-1" />
              <Button variant="text" onClick={() => moveSection(index, -1)} disabled={index === 0}>
                ↑ 上移
              </Button>
              <Button
                variant="text"
                onClick={() => moveSection(index, 1)}
                disabled={index === sorted.length - 1}
              >
                ↓ 下移
              </Button>
              {SINGLETON_TYPES.has(draft.type) ? null : (
                <Button variant="text" onClick={() => removeSection(draft.key)}>
                  删除
                </Button>
              )}
            </header>

            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Labeled label="区块标题（可选）">
                <TextInput
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => patchDraft(draft.key, { title: e.target.value })}
                />
              </Labeled>
              <Labeled label="区块副标题（可选）">
                <TextInput
                  value={draft.subtitle}
                  maxLength={500}
                  onChange={(e) => patchDraft(draft.key, { subtitle: e.target.value })}
                />
              </Labeled>
            </div>

            <PayloadEditor
              draft={draft}
              categories={categories}
              names={names}
              patch={(payloadPatch) => patchPayload(draft.key, payloadPatch)}
              setProducts={(rows) => setJoinRows(draft.key, rows)}
              openPicker={setPicker}
            />
          </section>
        ))}
      </div>

      {picker ? (
        <ProductPickerDialog
          key={`${picker.key}-${picker.mode}`}
          open
          title="选择商品"
          multi={picker.mode === "multi"}
          initialSelected={pickerInitial}
          onClose={() => setPicker(null)}
          onApply={onPickerApply}
          onNames={(incoming) => setNames((prev) => ({ ...prev, ...incoming }))}
        />
      ) : null}
    </>
  );
}

export default function AdminHomepagePage() {
  return <HomepageAdminContent />;
}
```

注意：选品弹窗的合并逻辑统一在页面级 `onPickerApply`；`JoinsEditor` 只负责展示/排序/角标与打开弹窗。`crypto.randomUUID()` 在浏览器（https/localhost）可用，无需 polyfill。

- [ ] **Step 5: 前端门禁**

```bash
cd frontend
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-api.ts
git add src/components/admin/AdminShell.tsx
git add "src/app/admin/(shell)/homepage/page.tsx"
git commit -m "feat(homepage): admin homepage composer — sections, payload editors, product joins"
```

---

### Task 6: Storefront 首页（数据层 + 区块组件 + 瘦 RSC 页面）

**Files:**
- Modify: `frontend/src/lib/api.ts`（共享文件，只加不改：首页类型、`getHomepage()`、`api.getProductsByIds`）
- Modify: `frontend/src/components/product/ProductCard.tsx`（加可选 `badge?: string`，不传无变化）
- Create: `frontend/src/components/home/sectionShell.tsx`（`SectionShell` / `SectionHeading` / `SmartLink`）
- Create: `frontend/src/components/home/SectionPlaceholder.tsx`
- Create: `frontend/src/lib/home-tracking.ts`（`trackAttrs` data-attr 构造器 + 事件类型）
- Create: `frontend/src/components/home/HomeTracking.tsx`（客户端事件委托岛屿）
- Create: `frontend/src/components/home/default-sections.ts`
- Create: 10 个区块组件（见 Step 5–7）
- Create: `frontend/src/components/home/sectionRegistry.ts`
- Replace: `frontend/src/app/(storefront)/page.tsx`（瘦 RSC）

**Interfaces:**
- Consumes: `GET /api/v1/storefront/homepage`（Task 3）；seed 默认区块（Task 4）；`trackCustom`（Task 7 Step 1 — HomeTracking 先按该签名写，Task 7 才加导出；若先跑 tsc 可在 tracking.ts 提前加，Task 7 不重复）；ProductCard/PriceBox/TrustBar/PlaceholderImage/Button/ButtonLink。
- Produces:
  - `getHomepage(): Promise<HomepageResponse>`（server fetch，revalidate 120 + STOREFRONT_TAGS）。
  - `api.getProductsByIds(ids)`（浏览器相对路径，Recently Viewed 用）。
  - registry：`SECTION_REGISTRY: Record<HomepageSectionType, ComponentType<SectionProps>>`，`SectionProps = { section: HomepageSection }`。

- [ ] **Step 1: api.ts 加首页类型（在 `Product` interface 之后追加）**

```ts
// --- homepage CMS (storefront composition) ----------------------------------

export type HomepageSectionType =
  | "HERO"
  | "USP"
  | "CATEGORY_TILES"
  | "PRODUCT_GRID"
  | "SOLUTIONS"
  | "PRODUCT_STORY"
  | "ROOM_INSPIRATION"
  | "UGC"
  | "BRAND_STORY"
  | "CONFIDENCE";

export interface HomepageCategoryTile {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
}

/** A full storefront Product plus its per-section badge. */
export type HomepageSectionProduct = Product & { badge: string | null };

export interface HomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  payload: Record<string, unknown>;
  // Present only on the types hydrated by the backend.
  products?: HomepageSectionProduct[];
  categories?: HomepageCategoryTile[];
}

export interface HomepageResponse {
  sections: HomepageSection[];
}
```

- [ ] **Step 2: api.ts 加 getHomepage（requestVoid 之后）与 api.getProductsByIds（api 对象内，getCategories 之前）**

顶部 import 增加：

```ts
import { STOREFRONT_TAGS } from "./cache-tags";
```

`requestVoid` 之后加（RSC 专用，绝对 URL + ISR tag）：

```ts
// Homepage composition. Server Components only (absolute URL + ISR tags);
// the browser reads sections through server-rendered markup.
export async function getHomepage(): Promise<HomepageResponse> {
  const res = await fetch(serverApiUrl("/api/v1/storefront/homepage"), {
    next: { revalidate: 120, tags: STOREFRONT_TAGS },
  });
  await assertOk(res);
  return res.json() as Promise<HomepageResponse>;
}
```

`export const api = {` 的第一条方法加：

```ts
  // Recently Viewed batch lookup; backend preserves the requested id order.
  getProductsByIds: (ids: string[]) =>
    request<Paged<Product>>(
      `/api/v1/storefront/products?ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`,
    ),
```

- [ ] **Step 3: ProductCard 加可选 badge（不改既有调用方）**

`src/components/product/ProductCard.tsx`：

```tsx
interface ProductCardProps {
  product: Product;
  /** Section-provided corner badge (e.g. 新品). Undefined = no chip. */
  badge?: string;
}

export function ProductCard({ product, badge }: ProductCardProps) {
```

在图片 `<Link className="relative block">` 内部、Out of Stock 浮层之前加角标（已有库存浮层保留；角标右上，库存浮层保持左上）：

```tsx
        {badge ? (
          <span className="absolute right-3 top-3 rounded bg-cta px-2 py-1 text-xs font-semibold text-white">
            {badge}
          </span>
        ) : null}
```

- [ ] **Step 4: 共享骨架**

Create `src/lib/home-tracking.ts`（事件名集中此处，禁止散落字符串）：

```ts
import type { HomepageSection } from "./api";

export type HomepageTrackEvent =
  | "HomepageView"
  | "HeroClick"
  | "CategoryClick"
  | "SolutionClick"
  | "ProductClick";

/**
 * Data attributes consumed by the HomeTracking delegated click listener
 * (names per spec §5.7). Spread onto any clickable element; closest() catches
 * nested clicks.
 */
export function trackAttrs(
  event: HomepageTrackEvent,
  section: Pick<HomepageSection, "id" | "title">,
  position?: number,
): Record<string, string> {
  return {
    "data-track-event": event,
    "data-section-id": section.id,
    "data-section-name": section.title ?? "",
    ...(position === undefined ? {} : { "data-section-position": String(position) }),
  };
}
```

Create `src/components/home/sectionShell.tsx`:

```tsx
import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Standard horizontal rhythm for homepage sections (mirrors the old page). */
export function SectionShell({
  children,
  className = "",
  bleed = false,
}: {
  children: ReactNode;
  className?: string;
  bleed?: boolean;
}) {
  if (bleed) {
    return <section className={className}>{children}</section>;
  }
  return (
    <section className={`mx-auto max-w-[1200px] px-4 py-10 sm:px-6 ${className}`.trim()}>
      {children}
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string | null;
  subtitle?: string | null;
  action?: ReactNode;
}) {
  if (!title && !action) return null;
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4">
      <div>
        {title ? <h2 className="text-3xl font-semibold text-ink">{title}</h2> : null}
        {subtitle ? <p className="mt-1 text-ink-secondary">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** In-app/hash links use next/link; absolute https URLs render as plain anchors. */
export function SmartLink({
  href,
  className,
  children,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
```

Create `src/components/home/SectionPlaceholder.tsx`（中性 coming-soon；不出现任何人名/引语/假照片）：

```tsx
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionShell } from "./sectionShell";

/**
 * Empty-content state for CMS sections with nothing configured yet.
 * Copy is deliberately neutral (spec §8: no invented people/quotes/photos).
 */
export function SectionPlaceholder({
  title,
  message,
  inside = false,
}: {
  title?: string | null;
  message: string;
  /** Render without SectionShell, inside a component that already has one. */
  inside?: boolean;
}) {
  const card = (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
      <PlaceholderImage label="" className="h-16 w-16 rounded-lg opacity-60" />
      {title ? <h2 className="text-2xl font-semibold text-ink">{title}</h2> : null}
      <p className="max-w-md text-sm text-ink-secondary">{message}</p>
    </div>
  );
  return inside ? card : <SectionShell>{card}</SectionShell>;
}
```

Create `src/components/home/HomeTracking.tsx`（全站唯一的首页点击监听；区块组件只打 data-attr）：

```tsx
"use client";

import { useEffect } from "react";
import { trackCustom } from "@/lib/tracking";
import type { HomepageTrackEvent } from "@/lib/home-tracking";

/**
 * Fires HomepageView once and delegates every section click via data-* attrs.
 * Standard Pixel events (ViewContent/AddToCart/…) are untouched elsewhere.
 */
export function HomeTracking() {
  useEffect(() => {
    trackCustom("HomepageView", {});

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>("[data-track-event]");
      if (!el) return;
      const name = el.dataset.trackEvent as HomepageTrackEvent | undefined;
      if (!name) return;
      const position = el.dataset.sectionPosition;
      trackCustom(name, {
        section_id: el.dataset.sectionId ?? "",
        section_name: el.dataset.sectionName ?? "",
        ...(position === undefined ? {} : { position: Number(position) }),
      });
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
```

Create `src/components/home/default-sections.ts`（与 seed 同构；后端不可达时的前端回退，保证永不白屏）：

```ts
import type { HomepageSection } from "@/lib/api";

/**
 * Fallback composition mirroring the Task 4 seed. Used only when the homepage
 * API call fails from the RSC. Category tiles and grids come back empty here;
 * empty-state cards render instead of crashing the page.
 */
export const DEFAULT_SECTIONS: HomepageSection[] = [
  {
    id: "default-hero",
    type: "HERO",
    sortOrder: 0,
    title: "Small Space. Big Luwag.",
    subtitle: "Furniture designed for condos, rentals and everyday small-space living.",
    payload: {
      ctaPrimaryText: "Shop Small-Space Picks",
      ctaPrimaryLink: "/collections",
      ctaSecondaryText: "Explore Solutions",
      ctaSecondaryLink: "#solutions",
    },
  },
  { id: "default-usp", type: "USP", sortOrder: 10, title: null, subtitle: null, payload: {} },
  {
    id: "default-categories",
    type: "CATEGORY_TILES",
    sortOrder: 20,
    title: "Shop by Category",
    subtitle: null,
    payload: { categoryIds: [] },
    categories: [],
  },
  {
    id: "default-grid-1",
    type: "PRODUCT_GRID",
    sortOrder: 30,
    title: "Small-Space Favorites",
    subtitle: null,
    payload: {},
    products: [],
  },
  {
    id: "default-story-1",
    type: "PRODUCT_STORY",
    sortOrder: 40,
    title: "Made For Real Small Spaces",
    subtitle: null,
    payload: {},
  },
  {
    id: "default-solutions",
    type: "SOLUTIONS",
    sortOrder: 50,
    title: "Shop by Solution",
    subtitle: "Whatever your space problem, there is furniture built for it.",
    payload: {
      items: [
        { title: "Small Bedroom", blurb: "Compact beds, wardrobes and storage", link: "/collections/bedroom-essentials" },
        { title: "Home Office", blurb: "Foldable desks that disappear", link: "/collections/small-space-solutions" },
        { title: "Rental Friendly", blurb: "Portable, non-permanent furniture", link: "/collections/small-space-solutions" },
        { title: "Foldable Furniture", blurb: "Set up and stow in seconds", link: "/collections/small-space-solutions" },
        { title: "Narrow Space", blurb: "Slim profiles for tight corners", link: "/collections/small-space-solutions" },
        { title: "Storage Solution", blurb: "Make every corner useful", link: "/collections/storage-organization" },
      ],
    },
  },
  { id: "default-story-2", type: "PRODUCT_STORY", sortOrder: 60, title: null, subtitle: null, payload: {} },
  {
    id: "default-grid-2",
    type: "PRODUCT_GRID",
    sortOrder: 70,
    title: "Small Upgrades",
    subtitle: null,
    payload: {},
    products: [],
  },
  {
    id: "default-room",
    type: "ROOM_INSPIRATION",
    sortOrder: 80,
    title: "Room Inspiration",
    subtitle: null,
    payload: {},
    products: [],
  },
  { id: "default-ugc", type: "UGC", sortOrder: 90, title: "Real Homes", subtitle: null, payload: {} },
  {
    id: "default-brand",
    type: "BRAND_STORY",
    sortOrder: 100,
    title: null,
    subtitle: null,
    payload: {
      body: "LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts. Our name comes from maluwag: spacious, easy-going, and maluwag sa budget. Pieces that fit, prices that don’t hurt, cash on delivery. Because a small space should feel maluwag.",
    },
  },
  {
    id: "default-confidence",
    type: "CONFIDENCE",
    sortOrder: 110,
    title: null,
    subtitle: null,
    payload: {
      bullets: [
        "Cash on Delivery — pay at your door",
        "Nationwide delivery",
        "Real-time order updates by phone",
      ],
    },
  },
];
```

- [ ] **Step 5: tsc 中途检查（HomeTracking 依赖 Task 7 的 trackCustom；先在 tracking.ts 加上导出）**

在 `frontend/src/lib/tracking.ts` 的 `track()` 函数之后追加（Task 7 不重复此步）：

```ts
/** Fires a custom Meta Pixel event (homepage funnel), same no-op guards as track(). */
export function trackCustom(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !PIXEL_ID || !window.fbq) return;
  window.fbq("trackCustom", event, data);
}
```

```bash
cd frontend
pnpm exec tsc --noEmit
```

Expected: 通过（区块组件尚未引用 registry 时也无报错）。

- [ ] **Step 6: 区块组件（第一批）**

Create `src/components/home/HeroSection.tsx`（三态：桌面视频+移动封面 / 图片 / 无媒体渐变文字）：

```tsx
import { ButtonLink } from "@/components/ui/Button";
import { poppins } from "@/lib/fonts";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Highlight the "luwag" word in the seeded headline; other titles render as-is. */
function renderTitle(title: string) {
  return title.split(/(Luwag\.?)/g).map((part, i) =>
    /^Luwag/.test(part) ? (
      <span key={i} className={`${poppins.className} lowercase text-cta`}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function HeroSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const desktop = str(p.desktopImage);
  const mobile = str(p.mobileImage);
  const video = str(p.videoUrl);
  const poster = str(p.posterImage);
  const primary = {
    text: str(p.ctaPrimaryText) || "Shop Small-Space Picks",
    href: str(p.ctaPrimaryLink) || "/collections",
  };
  const secondary = {
    text: str(p.ctaSecondaryText) || "Explore Solutions",
    href: str(p.ctaSecondaryLink) || "#solutions",
  };

  const ctas = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ButtonLink href={primary.href} size="lg" {...trackAttrs("HeroClick", section, 1)}>
        {primary.text}
      </ButtonLink>
      <ButtonLink href={secondary.href} variant="secondary" size="lg" {...trackAttrs("HeroClick", section, 2)}>
        {secondary.text}
      </ButtonLink>
    </div>
  );

  if (video || desktop) {
    return (
      <section className="relative">
        {video ? (
          <>
            <div className="relative hidden h-[520px] w-full md:block">
              <video
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                controls={false}
                poster={poster || desktop || undefined}
              >
                <source src={video} type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-gradient-to-r from-ink/60 via-ink/25 to-transparent" />
            </div>
            <div className="relative aspect-[4/5] w-full md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mobile || poster || desktop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink/40 to-ink/50" />
            </div>
          </>
        ) : (
          <>
            <div className="relative hidden aspect-[16/7] w-full md:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={desktop} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-ink/55 via-ink/20 to-transparent" />
            </div>
            <div className="relative aspect-[4/5] w-full md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mobile || desktop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink/40 to-ink/50" />
            </div>
          </>
        )}
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-5 px-4 sm:px-6">
            <h1 className="max-w-xl text-4xl font-semibold text-white sm:text-5xl">{section.title}</h1>
            {section.subtitle ? (
              <p className="max-w-lg text-base text-white/90">{section.subtitle}</p>
            ) : null}
            {ctas}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-b from-primary-light/50 to-background">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-semibold text-ink sm:text-5xl">
          {section.title ? renderTitle(section.title) : null}
        </h1>
        {section.subtitle ? (
          <p className="max-w-xl text-base text-ink-secondary">{section.subtitle}</p>
        ) : null}
        {ctas}
      </div>
    </section>
  );
}
```

Create `src/components/home/UspSection.tsx`（payload 无 items 时完整回退现有 TrustBar，默认四条一字不改）：

```tsx
import type { ReactNode } from "react";
import { TrustBar } from "@/components/ui/TrustBar";
import { SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function UspIcon({ icon }: { icon?: string }): ReactNode {
  const common = "h-6 w-6 text-cta";
  switch (icon) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
        </svg>
      );
    case "truck":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" strokeLinejoin="round" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "shield":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function UspSection({ section }: { section: HomepageSection }) {
  const items = Array.isArray(section.payload?.items) ? section.payload.items : [];
  if (items.length === 0) {
    return (
      <SectionShell className="py-10">
        <TrustBar />
      </SectionShell>
    );
  }

  return (
    <SectionShell className="py-10">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.slice(0, 4).map((item, index) => (
          <div key={index} className="flex flex-col items-center gap-2 text-center">
            <UspIcon icon={str((item as { icon?: unknown }).icon) || undefined} />
            <span className="text-sm font-semibold text-ink">
              {str((item as { label?: unknown }).label)}
            </span>
            {str((item as { sub?: unknown }).sub) ? (
              <span className="text-xs text-ink-secondary">
                {str((item as { sub?: unknown }).sub)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/CategoryTilesSection.tsx`：

```tsx
import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

export function CategoryTilesSection({ section }: { section: HomepageSection }) {
  const categories = section.categories ?? [];

  if (categories.length === 0) {
    return <SectionPlaceholder title={section.title} message="Categories are being prepared — check back soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {categories.map((category, index) => (
          <Link
            key={category.id}
            href={`/categories/${category.slug}`}
            {...trackAttrs("CategoryClick", section, index + 1)}
            className="group relative block aspect-square overflow-hidden rounded-lg"
          >
            {category.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={category.imageUrl}
                alt={category.name}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <PlaceholderImage label="" className="absolute inset-0 h-full w-full" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 p-3 text-sm font-semibold text-white">
              {category.name}
            </span>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/ProductGridSection.tsx`：

```tsx
import { ProductCard } from "@/components/product/ProductCard";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

export function ProductGridSection({ section }: { section: HomepageSection }) {
  const products = section.products ?? [];
  const twoColumns = section.payload?.columns === 2;
  const gridClass = twoColumns
    ? "grid grid-cols-2 gap-4"
    : "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4";

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {products.length === 0 ? (
        <SectionPlaceholder
          inside
          message="Products coming soon — our team is curating this selection."
        />
      ) : (
        <div className={gridClass}>
          {products.map((product, index) => (
            <span
              key={product.id}
              className="contents"
              {...trackAttrs("ProductClick", section, index + 1)}
            >
              <ProductCard product={product} badge={product.badge ?? undefined} />
            </span>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
```

Create `src/components/home/SolutionsSection.tsx`（迁移现有 6 卡；section 带 `id="solutions"` 供 Hero 锚点）：

```tsx
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell, SmartLink } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function SolutionsSection({ section }: { section: HomepageSection }) {
  const items = Array.isArray(section.payload?.items) ? section.payload.items : [];

  return (
    <SectionShell className="scroll-mt-20">
      <div id="solutions" className="scroll-mt-20" />
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {items.length === 0 ? (
        <SectionPlaceholder inside message="Solution collections are being prepared." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((item, index) => {
            const row = item as { title?: unknown; blurb?: unknown; link?: unknown };
            return (
              <SmartLink
                key={index}
                href={str(row.link) || "/collections"}
                {...trackAttrs("SolutionClick", section, index + 1)}
                className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
              >
                <span className="text-base font-semibold text-ink group-hover:text-cta">
                  {str(row.title)}
                </span>
                {str(row.blurb) ? (
                  <span className="text-sm text-ink-secondary">{str(row.blurb)}</span>
                ) : null}
              </SmartLink>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
```

- [ ] **Step 7: 区块组件（第二批）+ registry + 页面替换**

Create `src/components/home/ProductStorySection.tsx`（图+文横向；两条故事按 sortOrder 自动换边）：

```tsx
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionShell } from "./sectionShell";
import type { HomepageSection, Product } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ProductStorySection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const product = (p.product ?? null) as Product | null;
  const image = str(p.imageUrl) || product?.images[0]?.url || "";
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const ctaLink = str(p.ctaLink) || (product ? `/products/${product.slug}`) : "");
  const ctaText = str(p.ctaText) || (product ? "Shop this pick" : "");

  if (!image && !body && !product) {
    return <SectionPlaceholder title={section.title} message="Story coming soon." />;
  }

  // sortOrder 40 -> image left; sortOrder 60 -> image right.
  const reversed = section.sortOrder >= 55;

  return (
    <SectionShell>
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
        <div className={reversed ? "md:order-2" : ""}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ) : (
            <PlaceholderImage label="" className="aspect-[4/3] w-full rounded-xl" />
          )}
        </div>
        <div className={`flex flex-col gap-4 ${reversed ? "md:order-1" : ""}`}>
          {heading ? <h2 className="text-3xl font-semibold text-ink">{heading}</h2> : null}
          {body ? <p className="whitespace-pre-line text-ink-secondary">{body}</p> : null}
          {product ? (
            <Link
              href={`/products/${product.slug}`}
              {...trackAttrs("ProductClick", section, 1)}
              className="text-sm font-semibold text-cta hover:underline"
            >
              {product.name}
            </Link>
          ) : null}
          {ctaLink && ctaText ? (
            <div>
              <ButtonLink href={ctaLink} variant="secondary" size="md">
                {ctaText}
              </ButtonLink>
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/RoomInspirationSection.tsx`：

```tsx
import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function RoomInspirationSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const image = str(p.imageUrl);
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const products = section.products ?? [];

  if (!image && products.length === 0 && !body) {
    return <SectionPlaceholder title={section.title} message="Room inspiration coming soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={heading} />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ) : (
            <PlaceholderImage label="" className="aspect-[4/3] w-full rounded-xl" />
          )}
          {body ? <p className="mt-4 text-ink-secondary">{body}</p> : null}
        </div>
        {products.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              Shop this room
            </h3>
            {products.map((product, index) => {
              const thumb = product.images[0]?.url;
              return (
                <Link
                  key={product.id}
                  href={`/products/${product.slug}`}
                  {...trackAttrs("ProductClick", section, index + 1)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-md"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <PlaceholderImage label="" className="h-16 w-16 rounded-md" />
                  )}
                  <span className="line-clamp-2 flex-1 text-sm font-medium text-ink">
                    {product.name}
                  </span>
                  {product.badge ? (
                    <span className="rounded bg-primary-light/60 px-2 py-1 text-xs text-cta">
                      {product.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/UgcSection.tsx`：

```tsx
import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection, Product } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function UgcSection({ section }: { section: HomepageSection }) {
  const entries = Array.isArray(section.payload?.entries) ? section.payload.entries : [];

  if (entries.length === 0) {
    return <SectionPlaceholder title={section.title} message="Real home photos coming soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.slice(0, 6).map((entry, index) => {
          const row = entry as {
            imageUrl?: unknown;
            name?: unknown;
            location?: unknown;
            comment?: unknown;
            product?: Product;
          };
          const image = str(row.imageUrl);
          return (
            <figure
              key={index}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <PlaceholderImage label="" className="aspect-square w-full" />
              )}
              <figcaption className="flex flex-1 flex-col gap-2 p-4">
                <blockquote className="flex-1 text-sm text-ink-secondary">
                  “{str(row.comment)}”
                </blockquote>
                <p className="text-sm font-semibold text-ink">
                  {str(row.name)}
                  {str(row.location) ? (
                    <span className="font-normal text-ink-muted"> · {str(row.location)}</span>
                  ) : null}
                </p>
                {row.product ? (
                  <Link
                    href={`/products/${row.product.slug}`}
                    {...trackAttrs("ProductClick", section, index + 1)}
                    className="text-sm font-semibold text-cta hover:underline"
                  >
                    Shop {row.product.name}
                  </Link>
                ) : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/BrandStorySection.tsx`：

```tsx
import { SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function BrandStorySection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)).filter(Boolean) : [];

  return (
    <SectionShell>
      <div className="max-w-3xl">
        {heading ? <h2 className="mb-3 text-2xl font-semibold text-ink">{heading}</h2> : null}
        {body ? <p className="leading-relaxed text-ink-secondary">{body}</p> : null}
        {bullets.length > 0 ? (
          <ul className="mt-5 flex flex-col gap-2 text-ink-secondary">
            {bullets.slice(0, 6).map((bullet, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="font-semibold text-cta">✓</span>
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SectionShell>
  );
}
```

Create `src/components/home/ConfidenceSection.tsx`（购买保障三条文案沿用旧首页，不改字；标题三重回退）：

```tsx
import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ConfidenceSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const heading = str(p.heading) || section.title || "Shop with confidence";
  const body = str(p.body);
  const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)).filter(Boolean) : [];

  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        <h2 className="mb-4 text-2xl font-semibold text-ink">{heading}</h2>
        {body ? <p className="mb-4 max-w-2xl text-ink-secondary">{body}</p> : null}
        {bullets.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {bullets.slice(0, 6).map((bullet, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border bg-background p-4 text-ink-secondary"
              >
                <span className="font-semibold text-cta">✓</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
```

Create `src/components/home/sectionRegistry.ts`：

```tsx
import type { ComponentType } from "react";
import type { HomepageSection, HomepageSectionType } from "@/lib/api";
import { BrandStorySection } from "./BrandStorySection";
import { CategoryTilesSection } from "./CategoryTilesSection";
import { ConfidenceSection } from "./ConfidenceSection";
import { HeroSection } from "./HeroSection";
import { ProductGridSection } from "./ProductGridSection";
import { ProductStorySection } from "./ProductStorySection";
import { RoomInspirationSection } from "./RoomInspirationSection";
import { SolutionsSection } from "./SolutionsSection";
import { UgcSection } from "./UgcSection";
import { UspSection } from "./UspSection";

export interface SectionProps {
  section: HomepageSection;
}

export const SECTION_REGISTRY: Record<HomepageSectionType, ComponentType<SectionProps>> = {
  HERO: HeroSection,
  USP: UspSection,
  CATEGORY_TILES: CategoryTilesSection,
  PRODUCT_GRID: ProductGridSection,
  SOLUTIONS: SolutionsSection,
  PRODUCT_STORY: ProductStorySection,
  ROOM_INSPIRATION: RoomInspirationSection,
  UGC: UgcSection,
  BRAND_STORY: BrandStorySection,
  CONFIDENCE: ConfidenceSection,
};
```

Replace `src/app/(storefront)/page.tsx` **整文件**为（旧 SOLUTIONS 常量、旧品牌/保障段落全部删除，已迁入 CMS 区块组件；Recently Viewed 挂载点注释留给 Task 7）：

```tsx
import { DEFAULT_SECTIONS } from "@/components/home/default-sections";
import { HomeTracking } from "@/components/home/HomeTracking";
import { SECTION_REGISTRY } from "@/components/home/sectionRegistry";
import { getHomepage } from "@/lib/api";

// ISR revalidation is configured inside getHomepage (revalidate: 120 + tags).
export default async function HomePage() {
  let sections;
  try {
    const response = await getHomepage();
    // Empty table (seed not run yet) -> use the built-in composition rather
    // than a blank page.
    sections = response.sections.length > 0 ? response.sections : DEFAULT_SECTIONS;
  } catch {
    sections = DEFAULT_SECTIONS;
  }

  return (
    <>
      <HomeTracking />
      {sections.map((section) => {
        const SectionComponent = SECTION_REGISTRY[section.type];
        return <SectionComponent key={section.id} section={section} />;
      })}
      {/* Task 7 inserts <RecentlyViewed /> before the first sortOrder >= 100 section. */}
    </>
  );
}
```

- [ ] **Step 8: 前端门禁 + commit**

```bash
cd frontend
pnpm exec tsc --noEmit
pnpm lint
pnpm build
git add src/lib/api.ts src/lib/home-tracking.ts src/lib/tracking.ts
git add src/components/product/ProductCard.tsx
git add src/components/home
git add "src/app/(storefront)/page.tsx"
git commit -m "feat(home): CMS-driven storefront homepage with section registry and fallback composition"
```

Expected: tsc/eslint/build 全部通过；旧首页的 SOLUTIONS 常量与品牌/保障硬编码不再被引用（已迁入区块）。

---

### Task 7: Recently Viewed 岛屿、移动端四项 TabBar、首页 JSON-LD/metadata

**Files:**
- Create: `frontend/src/lib/recently-viewed.ts`
- Create: `frontend/src/components/home/RecentlyViewed.tsx`
- Modify: `frontend/src/components/product/PdpClient.tsx`（挂载时写 `sh:rv`）
- Create: `frontend/src/components/layout/MobileTabBar.tsx`
- Modify: `frontend/src/app/(storefront)/layout.tsx`（挂载 TabBar + main 底部留白）
- Create: `frontend/src/lib/home-jsonld.ts`
- Modify: `frontend/src/app/(storefront)/page.tsx`（metadata + JSON-LD + 挂载 RecentlyViewed）

**Interfaces:**
- Consumes: Task 6 的 `api.getProductsByIds`；ProductCard；`SITE_URL`（`lib/product-jsonld.ts` 已导出）。
- Produces: localStorage `sh:rv`（最新在前、去重、上限 12）；PDP 浏览即写；首页槽位 13 渲染 Recently Viewed（无记录不渲染）；移动端固定底栏四项（不做 Wishlist）。
- 注：`trackCustom` 已在 Task 6 Step 5 加入 `tracking.ts`，本任务不重复。

- [ ] **Step 1: Recently Viewed 存储助手**

Create `src/lib/recently-viewed.ts`：

```ts
/**
 * Recently Viewed product ids, localStorage "sh:rv".
 * Newest first, de-duplicated, capped at 12. SSR-safe: every read returns [].
 */
const KEY = "sh:rv";
const MAX = 12;

export function getRecentProductIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function recordProductView(id: string): string[] {
  if (typeof window === "undefined") return [];
  const ids = [id, ...getRecentProductIds().filter((x) => x !== id)].slice(0, MAX);
  window.localStorage.setItem(KEY, JSON.stringify(ids));
  return ids;
}
```

- [ ] **Step 2: RecentlyViewed 岛屿**

Create `src/components/home/RecentlyViewed.tsx`：

```tsx
"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading, SectionShell } from "./sectionShell";
import { api, type Product } from "@/lib/api";
import { getRecentProductIds } from "@/lib/recently-viewed";

/** IA slot 13. Renders nothing until the browser has a non-empty sh:rv list. */
export function RecentlyViewed() {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    const ids = getRecentProductIds();
    // No synchronous empty write: keep state null on no-history so SSR and
    // first client render agree (a stateful [] here trips the react-hooks
    // set-during-effect lint and is pointless — the null guard below hides it).
    if (ids.length === 0) {
      return;
    }
    let active = true;
    api
      .getProductsByIds(ids)
      .then((res) => {
        if (!active) return;
        const byId = new Map(res.items.map((product) => [product.id, product]));
        // Backend filters ACTIVE; keep the localStorage visit order.
        setProducts(
          ids
            .map((id) => byId.get(id))
            .filter((product): product is Product => product !== undefined),
        );
      })
      .catch(() => {
        if (active) setProducts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!products || products.length === 0) return null;

  return (
    <SectionShell>
      <SectionHeading title="Recently Viewed" />
      {/* Spec §5.4: horizontal scrolling rail. Card keeps its 4:5 image. */}
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:px-0">
        {products.map((product) => (
          <div key={product.id} className="w-44 shrink-0 sm:w-56">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 3: PdpClient 挂载时写入浏览记录**

`src/components/product/PdpClient.tsx`：import 区加：

```tsx
import { recordProductView } from "@/lib/recently-viewed";
```

在「Keep ?variant= in sync」那个 useEffect **之后**插入：

```tsx
  // Homepage Recently Viewed (IA slot 13): newest-first, capped in the helper.
  useEffect(() => {
    recordProductView(product.id);
  }, [product.id]);
```

- [ ] **Step 4: MobileTabBar**

Create `src/components/layout/MobileTabBar.tsx`（四项；无 Wishlist；PDP/购物车/结算页隐藏，避免与 MobileStickyCta 重叠）：

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ITEMS: Array<{ href: string; label: string; icon: ReactNode }> = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/collections",
    label: "Categories",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/account",
    label: "Account",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function MobileTabBar() {
  const pathname = usePathname();

  // PDP and LP both render MobileStickyCta (z-30); cart/checkout are focused
  // flows — hide the tab bar on all four so the two fixed bars never overlap.
  const hidden =
    pathname.startsWith("/products/") ||
    pathname.startsWith("/lp/") ||
    pathname === "/cart" ||
    pathname === "/checkout";
  if (hidden) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // z-30, not z-40: the PDP/LP MobileStickyCta is z-30 and its ORDER NOW bar
  // must not be painted over where both could theoretically mount.
  return (
    <>
      {/* In-flow clearance: keeps the footer's last content reachable above
          the fixed bar. Rendered here (after Footer), NOT as <main> padding —
          main-level padding also dead-bands hidden pages (cart/checkout). */}
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-4">
          {ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                  isActive(item.href) ? "text-cta" : "text-ink-secondary"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
```

- [ ] **Step 5: layout.tsx 挂载（共享文件——动手前在并行群里告知线 B：仅追加 TabBar，不改其他结构）**

`src/app/(storefront)/layout.tsx`：

1. import 区加：

```tsx
import { MobileTabBar } from "@/components/layout/MobileTabBar";
```

2. `<main>` 保持原样不加 padding（`className="flex-1"`）：底部避让由 MobileTabBar 自身的 in-flow spacer 在 Footer 之后承担；加在 main 上会在 cart/checkout（TabBar 隐藏页）产生永久死区，且 spacer 位于 Footer 之前无法保证版权行不被遮挡。

3. `<MessengerChat />` 之后（`</Providers>` 之前）加：

```tsx
      <MobileTabBar />
```

- [ ] **Step 6: 首页 JSON-LD + metadata**

Create `src/lib/home-jsonld.ts`（风格对齐 `product-jsonld.ts`）：

```ts
import { SITE_URL } from "./product-jsonld";

/** Organization + WebSite (with SearchAction) for the homepage. */
export function buildHomeJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "LUWAG Living",
        url: SITE_URL,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "LUWAG Living",
        publisher: { "@id": `${SITE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}
```

`src/app/(storefront)/page.tsx` 更新（在 Task 6 版本上改三处）：

1. 顶部加 import：

```tsx
import type { Metadata } from "next";
import { buildHomeJsonLd } from "@/lib/home-jsonld";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
```

2. 默认导出之前加：

```tsx
// absolute bypasses the root "%s | LUWAG Living" template (avoids a double suffix).
export const metadata: Metadata = {
  title: { absolute: "Small-Space & Condo Furniture Philippines | LUWAG Living" },
  description:
    "Small space furniture for condos and rentals in the Philippines — beds, desks, storage and foldable pieces. Cash on delivery, nationwide shipping.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Small Space. Big Luwag. | LUWAG Living",
    description:
      "Furniture designed for condos, rentals and everyday small-space living. Cash on delivery, nationwide shipping in the Philippines.",
    url: "/",
    siteName: "LUWAG Living",
    type: "website",
  },
};
```

3. `return (...)` 改为（Recently Viewed 插在第一个 sortOrder ≥ 100 的区块之前；JSON-LD 紧跟 HomeTracking）：

```tsx
  const rvIndex = sections.findIndex((section) => section.sortOrder >= 100);

  return (
    <>
      <HomeTracking />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildHomeJsonLd()) }}
      />
      {sections.map((section, index) => {
        const SectionComponent = SECTION_REGISTRY[section.type];
        return (
          <div key={section.id}>
            {index === rvIndex ? <RecentlyViewed /> : null}
            <SectionComponent section={section} />
          </div>
        );
      })}
      {rvIndex === -1 ? <RecentlyViewed /> : null}
    </>
  );
```

（外层 `<div>` 只作插入锚点，不产生可见布局影响；若 lint 介意可换 Fragment 数组返回，二者等价。）

- [ ] **Step 7: 门禁 + commit**

```bash
cd frontend
pnpm exec tsc --noEmit
pnpm lint
pnpm build
git add src/lib/recently-viewed.ts src/lib/home-jsonld.ts
git add src/components/home/RecentlyViewed.tsx
git add src/components/layout/MobileTabBar.tsx
git add src/components/product/PdpClient.tsx
git add "src/app/(storefront)/layout.tsx" "src/app/(storefront)/page.tsx"
git commit -m "feat(home): recently viewed island, mobile tab bar, homepage metadata and JSON-LD"
```

---

### Task 8: 隔离实例浏览器验收 + 全量门禁 + 数据清场

**Files:** 无新增代码；本任务只跑实例、验收、清场。

**Interfaces:** 验证 Task 1–7 的端到端行为（spec §9）。

- [ ] **Step 1: 后端全量门禁**

```bash
cd backend
pnpm lint
pnpm build
pnpm exec vitest run
```

Expected: 零 lint 错误、build 成功、全部 vitest 通过（含 Task 2/3 新增 spec 与既有 reviews/orders 等无回归）。

- [ ] **Step 2: 前端全量门禁**

```bash
cd frontend
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Expected: 全部通过。

- [ ] **Step 3: 启动隔离验收实例（严禁触碰用户的 :3000/:3001）**

终端 A（后端隔离端口；dotenv 不覆盖 shell env）：

```bash
cd backend
PORT=3010 pnpm start:dev
```

终端 B（前端隔离端口 + 假 Pixel ID 用于埋点验证）：

```bash
cd frontend
NEXT_PUBLIC_META_PIXEL_ID=000000000000 API_TARGET=http://localhost:3010 PORT=3002 pnpm dev
```

接口冒烟：

```bash
curl -s http://localhost:3010/api/v1/storefront/homepage | python3 -m json.tool | head -40
```

Expected: 12 个区块按 sortOrder 0–110；空 grid 带 `products: []`；category 区块若无 ACTIVE 有图顶层分类则 `categories: []`（不报错）。

- [ ] **Step 4: 桌面 1280px 验收（Chrome DevTools MCP / Playwright MCP，viewport 1280×900）**

打开 `http://localhost:3002`（首次加载后用 DevTools Network 勾选 Disable cache 硬刷新一次——Next 16 dev fetch 缓存粘连）：

- [ ] Hero（无媒体态）：奶油色渐变背景、标题 "Small Space. Big Luwag."、其中 Luwag 为 poppins 小写 cta 色；副标题与两个按钮；点 "Explore Solutions" 锚点跳到 `#solutions`。
- [ ] USP：默认 TrustBar 四条（Cash On Delivery / Made For Small Spaces / Secure Checkout / Philippines Delivery），文案一字未改。
- [ ] Shop by Category：桌面 6 列瓷砖；无图/停用分类不出现；点击跳 `/categories/<slug>`。
- [ ] Small-Space Favorites / Small Upgrades：虚线占位卡 "Products coming soon…"，标题仍在。
- [ ] 两个 PRODUCT_STORY：占位卡；顺序为 Made For Real Small Spaces（slot40）与无标题第二条（slot60）。
- [ ] Shop by Solution：6 张方案卡，链接与 seed 一致（bedroom-essentials / small-space-solutions ×4 / storage-organization）。
- [ ] Room Inspiration 占位卡；UGC 标题 Real Homes，占位文案为 "Real home photos coming soon."，无人名/引语。
- [ ] BRAND_STORY：§3.4 品牌正文完整（含 maluwag sa budget 原句）；CONFIDENCE：三条 ✓ 保障卡，旧文案未改字。
- [ ] 首次访问**不出现** Recently Viewed；桌面宽度下移动端 TabBar 不显示。

- [ ] **Step 5: 自定义 Pixel 事件验证（1280px 下用 DevTools console）**

页面加载后在 console 安装拦截器，再通过 Header 的 LUWAG logo 用前端路由回到首页（触发 HomeTracking 重新挂载）：

```js
window.__calls = [];
const __orig = window.fbq;
window.fbq = (...args) => { window.__calls.push(args); __orig && __orig(...args); };
```

依次：点 Hero 主按钮（随即返回）、点一个分类瓷砖、点一个方案卡，检查：

```js
window.__calls.filter((c) => c[0] === "trackCustom").map((c) => c[1]);
```

Expected: 含 `HomepageView`、`HeroClick`、`CategoryClick`、`SolutionClick`；每条第三参为对象且含 `section_id`、`section_name`，点击事件含从 1 开始的 `position`。随后进任一 PDP，确认标准 `track("ViewContent", …)` 仍被调用（在 `__calls` 中能看到 `["track","ViewContent",…]`），加购事件链路代码未被改动（代码审查 `tracking.ts` 的 `track()` 无修改即可，不必真下单）。

- [ ] **Step 6: 移动 390px 验收（viewport 390×844，touch 模拟）**

- [ ] Hero 文案竖排、按钮通栏；USP 2×2；分类 2 列；grid/方案卡单列或 2 列正确。
- [ ] 底部固定 TabBar 四项：Home / Categories / Search / Account；无 Wishlist/心形图标；主内容底部留白不被遮挡。
- [ ] 进任一 PDP：TabBar 消失（与 MobileStickyCta 不重叠）；Console 执行 `JSON.parse(localStorage.getItem('sh:rv'))` 为长度 1 数组（含当前商品 UUID）。
- [ ] `/cart`、`/checkout` 两路由 TabBar 同样隐藏。
- [ ] 返回首页硬刷新：Recently Viewed 出现在 UGC 与 Brand Story 之间（即第一个 sortOrder≥100 区块之前），商品卡顺序=浏览顺序。
- [ ] 连看 13 个不同 PDP 后回首页：`sh:rv` 长度被截到 12，重复访问同一商品不产生重复 id。
- [ ] 无痕窗口（无 `sh:rv`）打开首页：Recently Viewed 整段不渲染（SSR HTML 与水合后都无该区块）。

- [ ] **Step 7: 后台装修验收（`http://localhost:3002/admin/homepage`）**

用既有管理员登录；左侧导航出现「首页装修」。

- [ ] 12 个区块卡片按顺序显示，类型中文标签正确，单例区块有「单例」标记且无删除按钮。
- [ ] 选品：编辑 Small-Space Favorites → 搜索并选 4 个真实在售商品，其中第一个角标填「新品」，保存发布；出现内联「已发布 …」提示；硬刷新前台首页：网格出现 4 张卡，第一张带「新品」角标；console 点该卡产生 `ProductClick`（position=1，section_name="Small-Space Favorites"）。
- [ ] 后台把其中一个商品库存/SKU 情况不做改动；改为加入一个无库存商品（若库中没有则跳过此子项），前台该商品被过滤，占位卡不再出现（有其他 3 个可售时）。
- [ ] 分类：取消所有分类勾选保存 → 前台该区块显示 coming soon 占位；恢复勾选保存后恢复。
- [ ] 停用 BRAND_STORY → 保存后前台品牌区块消失；重新启用恢复（单例不能被删除，只被停用）。
- [ ] 限额：尝试再添加一条 HERO → 下拉项显示「已达上限」；通过 API 直造重复单例验证 400（`curl -X PATCH .../sections` 带两条 HERO，带管理员 token；若取 token 繁琐，此子项以单测覆盖为准可跳过）。尝试添加第 3 条 PRODUCT_GRID 允许；添加第 4 条时下拉置灰。
- [ ] 上移/下移：交换两个区块顺序保存，前台顺序同步；新加区块在未保存时提示先保存再选品。
- [ ] UGC 编辑器顶部可见警示原文：「仅可录入已获授权的真实客户内容，禁止伪造评价。」
- [ ] USP 编辑器可见提示「留空（不添加任何条目）则前台显示默认四条…」；角标输入 placeholder 为「角标，如：新品」。
- [ ] Hero 贴一个真实商品图 URL 到桌面端图片并保存 → 硬刷新后 Hero 切换为图片态（白字覆盖层、两个按钮可见）；清空 URL 保存后恢复渐变文字态。视频态若手头没有 MP4 素材可留待运营验证，代码已过 tsc/build。

- [ ] **Step 8: ISR/缓存行为**

后台保存后 120 秒内或 revalidate webhook 触发后内容更新；验收以硬刷新为准（已知 Next 16 dev fetch 粘连）。本地未配 `REVALIDATE_URL`/`REVALIDATE_SECRET` 时 `revalidateCache` 直接 no-op（无网络调用、无日志，见 `src/common/revalidation.ts:29`），不影响 200 响应；若日后配了 bridge 但前端未启动，后端只会打 warn 日志，同样不影响保存。

- [ ] **Step 9: 验收数据清场（禁止遗留测试配置）**

后台验收改动了区块与选品，恢复为 seed 默认：先清关联与区块，再重跑 seed。

```bash
cd backend
DATABASE_URL_VALUE=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
psql "$DATABASE_URL_VALUE" -c "DELETE FROM homepage_section_products; DELETE FROM homepage_sections;"
pnpm exec tsx prisma/seed.ts
```

Expected: `DELETE …` 两行 + `Ensured 12 homepage sections.`。再 curl storefront homepage：两条 grid `products: []`，BRAND_STORY enabled，顺序恢复 0–110。

- [ ] **Step 10: 关停验收实例并确认工作区干净**

关闭终端 A/B（:3010/:3002）。确认未在仓库留下临时文件：

```bash
git status --short
```

Expected: 只有本计划文档（如尚未提交）与各 Task 的正常提交；无未跟踪调试脚本/截图。

- [ ] **Step 11: 提交计划文档（若此前未提交）**

```bash
git add docs/superpowers/plans/2026-09-15-homepage-redesign.md
git commit -m "docs: homepage redesign implementation plan"
```

- [ ] **Step 12: 验收完成汇报**

汇报内容：两个 viewport 的结论、自定义 Pixel 事件验证结果、后台四个关键流程（选品/停用/限额/排序）结果、清场后 curl 输出摘要、backend/frontend 门禁结果。任何跳过的子项明确标注原因。
