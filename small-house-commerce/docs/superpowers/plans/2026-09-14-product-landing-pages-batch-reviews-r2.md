# 产品多落地页 + 评论批量导入 + R2 直传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个产品拥有多个独立 URL 的落地页（`/lp/<slug>`，仅覆盖标题/图集/促销条/时间窗，共享 SKU、库存、评论），后台 Single Pages 全局页展示访问量/订单/转化率并支持批量改标题；评论支持后端原子批量导入；图片支持 Cloudflare R2 预签名直传（URL 方式保留）。

**Architecture:** 后端新增 `ProductLandingPage`/`LandingPageVisit` 两张表（访问按会话 visitKey 去重；订单转化复用已存在的 `OrderAttribution.landingPageId` 裸列，按最终状态计数）；落地页详情复用 `ProductsService.storefrontGetBySlug` 白名单装配器，杜绝成本字段泄漏；R2 用 Node 内置 crypto 手写 SigV4 预签名 PUT，浏览器直传，零新依赖。前端把 PDP 主体抽成共享服务端组件 `PdpView`，LP 路由合并 override 后复用它；后台新增 `/admin/single-pages`（导航名 "Single Pages"）。

**Tech Stack:** NestJS（ESM, nodenext）+ Prisma 7（多文件 schema, `prisma-client` generator, pg adapter）+ zod 4 + vitest + oxlint；Next.js 16 App Router（Turbopack, React 19, Server Components）+ Tailwind v4；Cloudflare R2（S3 SigV4）。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-09-14-product-landing-pages-batch-reviews-r2-design.md`（计划与 spec 绑定，执行时两份都要读；冲突以 spec 为准）。

## Global Constraints

- **直接在本地 `main` 分支工作、本地提交**（用户明确指示，覆盖 skill 的 worktree 默认值）。禁止 worktree、禁止新建分支、禁止 `git push`、禁止 PR。
- 每个 commit 只 `git add <显式路径>`，禁止 `git add -A`/`git add .`。永远不要 stage：`small-house-commerce/docs/frontend/HOMEPAGE_SPEC.md`、`small-house-commerce/docs/superpowers/plans/2026-09-11-pdp-refinement.md`、未跟踪的 `docs/research/`、`.playwright-mcp/`、`home.jpeg`、`docs/BRAND_FOUNDATION_V1.md`、自动生成的 AGENTS.md/CLAUDE.md。
- **零新 npm 依赖**（前后端都不行）。R2 签名只用 `node:crypto`，浏览器只用 `fetch`。
- 后端仅为本特性解冻；Task 1–7 完成后冻结恢复。不改动任何无关后端代码。
- 店面 API 永不暴露 `supplierSku/supplierCost/costCurrency/landedCost`，评论内部字段 `isVisible/source/verifiedOrderItemId` 不进店面对象。LP 公共详情必须复用 `storefrontGetBySlug`，不得自写 select。
- 禁止假评论/种子评论；批量导入的评论都视为管理员撰写的真实冷启动评论（source 固定 ADMIN）。
- 验证结束后**不得在开发库留下任何测试数据**（落地页、访问、评论、订单）。Task 12 有强制清理步骤。
- Prisma 提示 reset / 检测 drift 时**立即 STOP 并报告**，绝不接受 reset。
- 价格只显示 PHP、COD 文案与配送文案一字不改；Meta Pixel 的 ViewContent/AddToCart/InitiateCheckout/Purchase 必须继续触发；不要加 wishlist/心形图标。
- 样式只用 Tailwind 设计 token；既有例外仅限 `text-sale/border-sale/bg-sale`（促销条用 `bg-sale text-white`）与后台错误红 `text-red-700`/`border-sale/40 bg-sale/5`。
- 每个新后台字段必须有中文操作提示（既有约定）。
- R2 环境变量未配置时**应用必须正常启动**（env schema 中全部 optional），仅在请求 presign 时返回 503。
- dev 服务器（后端 127.0.0.1:3000、前端 localhost:3001）**绝不重启**；它们由用户持有。
- 所有命令用绝对路径 `cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/<backend|frontend>" && ...`（shell cwd 不跨调用保持）。
- Next.js 动手前必须先读 `frontend/node_modules/next/dist/docs/` 相关文档（Next 16，见 AGENTS.md）。
- 测试纪律：先写失败测试（vitest，纯 `new Service(prismaMock)` 风格，不引入 TestingModule）；前端无测试框架，靠 `tsc --noEmit` + `eslint` + `next build` + 手动验证。
- react-hooks 纪律：effect 体内禁止同步 setState；重置逻辑放 useCallback；列表页用 nonce + `Promise.allSettled` + `errorStatus(reason)` 既有模式。

## File Structure

后端（`small-house-commerce/backend`）：

- `prisma/schema/landing-page.prisma` — **新建**，`LandingPageStatus` 枚举 + `ProductLandingPage` + `LandingPageVisit`。
- `prisma/migrations/20260914120000_add_product_landing_pages/migration.sql` — **新建**，手写迁移。
- `prisma/schema/catalog.prisma` — Product 增加 `landingPages` 关系。
- `src/modules/catalog/landing/dto/landing-page.dto.ts` — **新建**，全部 zod DTO（create/update/query/bulk-title/view）。
- `src/modules/catalog/landing/landing-page.util.ts` — **新建**，`effectiveStatus()` 纯函数。
- `src/modules/catalog/landing/landing-pages.service.ts` — **新建**，CRUD + 指标列表 + 公共复合 + 访问 beacon。
- `src/modules/catalog/landing/landing-pages.service.spec.ts` — **新建**，Task 2/3/4 全部单测。
- `src/modules/catalog/landing/admin/landing-pages.controller.ts` — **新建**，两个 admin controller 类。
- `src/modules/catalog/landing/storefront/landing-pages.controller.ts` — **新建**，公共 GET/beacon。
- `src/modules/catalog/catalog.module.ts` — 注册新 controller/service。
- `src/modules/orders/dto/order.dto.ts`、`src/modules/orders/orders.service.ts`、`src/modules/orders/orders.service.spec.ts`（新建）— landingPageId 贯通 + 测试。
- `src/modules/catalog/dto/review.dto.ts`、`src/modules/catalog/reviews.service.ts`、`src/modules/catalog/reviews.service.spec.ts`（新建）、`src/modules/catalog/admin/reviews.controller.ts` — 批量评论。
- `src/modules/uploads/` — **新建模块**：`r2-presign.ts` + `r2-presign.spec.ts`、`uploads.service.ts` + `uploads.service.spec.ts`、`dto/upload.dto.ts`、`admin/uploads.controller.ts`、`uploads.module.ts`。
- `src/config/env.validation.ts`、`src/config/configuration.ts`、`src/app.module.ts`、`.env.example` — R2 配置。

前端（`small-house-commerce/frontend`）：

- `src/lib/product-jsonld.ts` — **新建**，从 PDP 页原样迁出的 SITE_URL/absoluteUrl/buildProductJsonLd。
- `src/components/product/PdpView.tsx` — **新建**服务端组件，PDP 主体（脚本 + PdpClient + 锚点 nav + sections + related）。
- `src/components/product/PdpClient.tsx` — 增加 `productPath?`、`promoSlot?` 两个可选 props。
- `src/app/(storefront)/products/[slug]/page.tsx` — 瘦身：数据准备 + 渲染 PdpView。
- `src/app/(storefront)/lp/[slug]/page.tsx` — **新建** LP 路由。
- `src/components/product/LandingViewTracker.tsx` — **新建** client 小岛（归因 + beacon）。
- `src/lib/tracking.ts` — 导出 Attribution 类型 + `sh:lp` 持久化 + readAttribution 携带。
- `src/lib/api.ts` — LP composite/beacon 方法与类型。
- `src/lib/admin-api.ts` — LP、批量评论、presign 的类型与方法。
- `src/components/admin/AdminShell.tsx` — Single Pages 导航。
- `src/app/admin/(shell)/single-pages/page.tsx` + `landing-page-form.tsx` — **新建**全局营销页与表单。
- `src/app/admin/(shell)/products/[id]/edit/page.tsx` — 落地页入口。
- `src/components/admin/ImageUrlInput.tsx` — **新建** URL+直传复合输入。
- `src/components/admin/ProductForm.tsx`、reviews 页 — 接入 ImageUrlInput。
- `src/app/admin/(shell)/products/[id]/reviews/batch-import-dialog.tsx` — **新建** TSV 批量导入。

---

## Task 1: Prisma 模型 + 手写迁移 + 客户端再生成

**Files:**
- Create: `small-house-commerce/backend/prisma/schema/landing-page.prisma`
- Create: `small-house-commerce/backend/prisma/migrations/20260914120000_add_product_landing_pages/migration.sql`
- Modify: `small-house-commerce/backend/prisma/schema/catalog.prisma`（Product 关系块加一行）

**Interfaces:**
- Consumes: `prisma7.config.ts` 已配置 `schema: 'prisma/schema'`（目录合并，新文件自动纳入，无需改配置）。
- Produces: 生成客户端上的 `prisma.productLandingPage` 与 `prisma.landingPageVisit` delegate；枚举 `LandingPageStatus`（从 `../../generated/prisma/client.js` 值导入）。

- [ ] **Step 1: 新建 schema 文件**

`prisma/schema/landing-page.prisma`：

```prisma
enum LandingPageStatus {
  ACTIVE
  DISABLED
}

model ProductLandingPage {
  id             String            @id @default(uuid(7)) @db.Uuid
  productId      String            @map("product_id") @db.Uuid
  name           String // internal label, e.g. "优化师A-首图版"
  adCode         String?           @map("ad_code") // FB 目录/广告编号
  slug           String            @unique // /lp/<slug>, kebab-case
  titleOverride  String?           @map("title_override") // H1; null = product.name
  // Ordered [{ "url": "...", "altText": "..." }]; null/empty = inherit product images
  imagesOverride Json?             @map("images_override")
  seoTitle       String?           @map("seo_title")
  seoDescription String?           @map("seo_description")
  // Optional promotional headline block rendered above the H1 on the LP.
  promoEnabled   Boolean           @default(false) @map("promo_enabled")
  promoHeadline  String?           @map("promo_headline")
  promoSubtext   String?           @map("promo_subtext")
  // Optional schedule window: LP is publicly reachable only inside it.
  startAt        DateTime?         @map("start_at") @db.Timestamptz(3)
  endAt          DateTime?         @map("end_at") @db.Timestamptz(3)
  status         LandingPageStatus @default(ACTIVE)
  sortOrder      Int               @default(0) @map("sort_order")
  createdAt      DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)

  product Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  visits  LandingPageVisit[]

  @@index([productId, status])
  @@map("product_landing_pages")
}

// One row per browser SESSION per LP. visitKey is a per-tab-session UUID made
// client-side and kept in sessionStorage; the unique constraint makes the
// view beacon idempotent, so "views" counts sessions, not raw hits.
model LandingPageVisit {
  id            String   @id @default(uuid(7)) @db.Uuid
  landingPageId String   @map("landing_page_id") @db.Uuid
  visitKey      String
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  landingPage ProductLandingPage @relation(fields: [landingPageId], references: [id], onDelete: Cascade)

  @@unique([landingPageId, visitKey])
  @@index([landingPageId, createdAt])
  @@map("landing_page_visits")
}
```

- [ ] **Step 2: Product 模型加反向关系**

在 `prisma/schema/catalog.prisma` 的 `model Product` 关系块中，把：

```prisma
  reviews ProductReview[]
```

替换为：

```prisma
  reviews ProductReview[]
  landingPages ProductLandingPage[]
```

- [ ] **Step 3: 手写迁移 SQL**

新建 `prisma/migrations/20260914120000_add_product_landing_pages/migration.sql`（风格对齐 `20260911015337_add_collections`：先建类型/表，再建索引，最后加外键；`updated_at` 无默认值）：

```sql
-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "product_landing_pages" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ad_code" TEXT,
    "slug" TEXT NOT NULL,
    "title_override" TEXT,
    "images_override" JSONB,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "promo_enabled" BOOLEAN NOT NULL DEFAULT false,
    "promo_headline" TEXT,
    "promo_subtext" TEXT,
    "start_at" TIMESTAMPTZ(3),
    "end_at" TIMESTAMPTZ(3),
    "status" "LandingPageStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_visits" (
    "id" UUID NOT NULL,
    "landing_page_id" UUID NOT NULL,
    "visit_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "landing_page_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_landing_pages_slug_key" ON "product_landing_pages"("slug");
CREATE INDEX "product_landing_pages_product_id_status_idx" ON "product_landing_pages"("product_id", "status");
CREATE UNIQUE INDEX "landing_page_visits_landing_page_id_visit_key_key" ON "landing_page_visits"("landing_page_id", "visit_key");
CREATE INDEX "landing_page_visits_landing_page_id_created_at_idx" ON "landing_page_visits"("landing_page_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_landing_pages" ADD CONSTRAINT "product_landing_pages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "landing_page_visits" ADD CONSTRAINT "landing_page_visits_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "product_landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: 应用迁移并再生成客户端**

Run:

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec prisma migrate dev && pnpm exec prisma generate && pnpm exec prisma migrate status
```

Expected: migration `20260914120000_add_product_landing_pages` applied；migrate status 显示 up to date；**没有** "drift"/"reset" 提示。若 CLI 要求 reset，立即 STOP 并报告用户，不要确认。

- [ ] **Step 5: 静态检查**

Run:

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && npx tsc --noEmit && pnpm lint && pnpm test
```

Expected: 全绿（生成客户端 gitignored；tsc 能解析 `productLandingPage` delegate 即说明 generate 成功）。

- [ ] **Step 6: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/prisma/schema/landing-page.prisma small-house-commerce/backend/prisma/schema/catalog.prisma small-house-commerce/backend/prisma/migrations/20260914120000_add_product_landing_pages/migration.sql && git commit -m "feat(backend): product landing page models and migration"
```

## Task 2: 落地页 DTO、生效状态工具、CRUD service（含失败测试）

**Files:**
- Create: `small-house-commerce/backend/src/modules/catalog/landing/dto/landing-page.dto.ts`
- Create: `small-house-commerce/backend/src/modules/catalog/landing/landing-page.util.ts`
- Create: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.ts`
- Test: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`（`prisma.productLandingPage`、`prisma.product`）；`ProductsService`（Task 4 注入使用，本任务先出现在构造函数签名里）。
- Produces:
  - `type LandingEffectiveStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'DISABLED'`
  - `effectiveStatus(input: {status; startAt: Date|string|null; endAt}, now?: Date): LandingEffectiveStatus`
  - zod schemas：`createLandingPageSchema`、`updateLandingPageSchema`、`adminLandingPageQuerySchema`、`bulkTitleLandingPagesSchema`、`landingPageViewSchema`、`landingImageOverrideSchema`；infer 类型 `CreateLandingPageInput/UpdateLandingPageInput/AdminLandingPageQuery/BulkTitleLandingPagesInput/LandingPageViewInput/LandingImageOverrideInput`
  - `LandingPagesService`：`adminListForProduct(productId)`、`adminCreate(productId, input)`、`adminUpdate(id, input)`、`adminRemove(id)`；序列化对象 = Prisma 行 + `effectiveStatus`（Task 3/4 继续在同类上追加方法）。

- [ ] **Step 1: 先写失败测试**

`src/modules/catalog/landing/landing-pages.service.spec.ts`：

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductsService } from '../products.service.js';
import { LandingPagesService } from '../landing-pages.service.js';
import { createLandingPageSchema, updateLandingPageSchema } from './dto/landing-page.dto.js';
import { effectiveStatus } from '../landing-page.util.js';

const NOW = new Date('2026-09-14T12:00:00Z');

function lpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    productId: '22222222-2222-2222-2222-222222222222',
    name: '优化师A-首图版',
    adCode: null,
    slug: 'os-chair',
    titleOverride: null,
    imagesOverride: null,
    seoTitle: null,
    seoDescription: null,
    promoEnabled: false,
    promoHeadline: null,
    promoSubtext: null,
    startAt: null,
    endAt: null,
    status: 'ACTIVE',
    sortOrder: 0,
    createdAt: new Date('2026-09-10T00:00:00Z'),
    updatedAt: new Date('2026-09-13T00:00:00Z'),
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    product: { findUnique: vi.fn(async () => ({ id: '22222222-2222-2222-2222-222222222222' })) },
    productLandingPage: {
      findMany: vi.fn(async () => [lpRow()]),
      findUnique: vi.fn(async () => lpRow()),
      create: vi.fn(async (args: { data: unknown }) => ({ ...lpRow(), ...(args.data as object) })),
      update: vi.fn(async (args: { where: { id: string }; data: unknown }) => ({
        ...lpRow(),
        ...args.data,
        id: args.where.id,
      })),
      delete: vi.fn(async (args: { where: { id: string } }) => lpRow({ id: args.where.id })),
    },
  };
}

describe('effectiveStatus', () => {
  it('DISABLED always wins', () => {
    expect(effectiveStatus({ status: 'DISABLED', startAt: null, endAt: null }, NOW)).toBe('DISABLED');
  });
  it('no window means LIVE', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: null, endAt: null }, NOW)).toBe('LIVE');
  });
  it('start in the future is SCHEDULED', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: new Date('2026-09-15T00:00:00Z'), endAt: null }, NOW)).toBe('SCHEDULED');
  });
  it('end in the past is ENDED', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: null, endAt: new Date('2026-09-13T00:00:00Z') }, NOW)).toBe('ENDED');
  });
  it('inside the window is LIVE', () => {
    expect(
      effectiveStatus(
        { status: 'ACTIVE', startAt: new Date('2026-09-13T00:00:00Z'), endAt: new Date('2026-09-15T00:00:00Z') },
        NOW,
      ),
    ).toBe('LIVE');
  });
});

describe('createLandingPageSchema', () => {
  const valid = () => ({
    name: '圣诞版',
    slug: 'os-chair-xmas',
    adCode: 'FB-1234',
    titleOverride: '圣诞特价人体工学椅',
    imagesOverride: [{ url: 'https://cdn.example.test/a.jpg', altText: '主图' }],
    promoEnabled: true,
    promoHeadline: 'Christmas Sale',
    promoSubtext: 'Limited time',
    startAt: '2026-12-01T00:00:00+08:00',
    endAt: '2026-12-31T23:59:59+08:00',
    status: 'ACTIVE',
    sortOrder: 2,
  });

  it('accepts the valid payload', () => {
    expect(createLandingPageSchema.safeParse(valid()).success).toBe(true);
  });
  it('rejects bad slugs', () => {
    for (const slug of ['UPPER', '-lead', 'trail-', 'with space', '中文']) {
      expect(createLandingPageSchema.safeParse({ ...valid(), slug }).success).toBe(false);
    }
  });
  it('requires promoHeadline when promoEnabled is true', () => {
    expect(createLandingPageSchema.safeParse({ ...valid(), promoEnabled: true, promoHeadline: null }).success).toBe(false);
  });
  it('rejects endAt <= startAt', () => {
    expect(
      createLandingPageSchema.safeParse({ ...valid(), endAt: '2026-11-30T23:59:59+08:00' }).success,
    ).toBe(false);
  });
  it('rejects more than 10 images', () => {
    const imagesOverride = Array.from({ length: 11 }, (_, i) => ({ url: `https://cdn.example.test/${i}.jpg` }));
    expect(createLandingPageSchema.safeParse({ ...valid(), imagesOverride }).success).toBe(false);
  });
  it('rejects non-https-ish invalid urls and overlong names', () => {
    expect(createLandingPageSchema.safeParse({ ...valid(), imagesOverride: [{ url: 'not-a-url' }] }).success).toBe(false);
    expect(createLandingPageSchema.safeParse({ ...valid(), name: 'x'.repeat(121) }).success).toBe(false);
  });
  it('update schema has no slug field and is fully optional', () => {
    expect(updateLandingPageSchema.safeParse({}).success).toBe(true);
    expect('slug' in updateLandingPageSchema.shape).toBe(false);
  });
});

describe('LandingPagesService CRUD', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let products: Pick<ProductsService, 'storefrontGetBySlug'>;
  let service: LandingPagesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    products = { storefrontGetBySlug: vi.fn() };
    service = new LandingPagesService(prisma as never, products as unknown as ProductsService);
  });

  const validInput = () =>
    createLandingPageSchema.parse({
      name: '圣诞版',
      slug: 'os-chair-xmas',
      titleOverride: '圣诞特价人体工学椅',
      startAt: '2026-12-01T00:00:00+08:00',
      endAt: '2026-12-31T23:59:59+08:00',
    });

  it('creates a landing page with Date-converted window and effectiveStatus attached', async () => {
    const result = await service.adminCreate('22222222-2222-2222-2222-222222222222', validInput());
    const data = prisma.productLandingPage.create.mock.calls[0]![0].data;
    expect(data.startAt).toBeInstanceOf(Date);
    expect(data.endAt).toBeInstanceOf(Date);
    expect(result.effectiveStatus).toBe('SCHEDULED');
  });

  it('create throws 404 when the parent product is missing', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.adminCreate('22222222-2222-2222-2222-222222222222', validInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create maps P2002 slug collision to 409', async () => {
    prisma.productLandingPage.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.adminCreate('22222222-2222-2222-2222-222222222222', validInput()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists for a product in sortOrder/createdAt order with effectiveStatus', async () => {
    const rows = await service.adminListForProduct('22222222-2222-2222-2222-222222222222');
    expect(prisma.productLandingPage.findMany.mock.calls[0]![0].orderBy).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ]);
    expect(rows[0]).toMatchObject({ slug: 'os-chair', effectiveStatus: 'LIVE' });
  });

  it('update 404s on unknown id; otherwise persists and clears nullable fields', async () => {
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.adminUpdate('11111111-1111-1111-1111-111111111111', updateLandingPageSchema.parse({})),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.productLandingPage.findUnique.mockResolvedValueOnce(lpRow());
    await service.adminUpdate(
      '11111111-1111-1111-1111-111111111111',
      updateLandingPageSchema.parse({ titleOverride: null, promoEnabled: false, promoHeadline: null }),
    );
    const data = prisma.productLandingPage.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.titleOverride).toBeNull();
    expect(data.promoHeadline).toBeNull();
  });

  it('remove 404s on unknown id and returns id on success', async () => {
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(null);
    await expect(service.adminRemove('11111111-1111-1111-1111-111111111111')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(lpRow());
    await expect(service.adminRemove('11111111-1111-1111-1111-111111111111')).resolves.toEqual({
      id: '11111111-1111-1111-1111-111111111111',
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/catalog/landing/landing-pages.service.spec.ts
```

Expected: FAIL（文件/模块不存在，或 service 缺方法）。

- [ ] **Step 3: 实现 DTO**

`src/modules/catalog/landing/dto/landing-page.dto.ts`：

```ts
import { z } from 'zod';
import { LandingPageStatus } from '../../../../generated/prisma/client.js';

export const landingImageOverrideSchema = z.object({
  url: z.string().url().max(2048),
  altText: z.string().trim().max(200).nullable().optional(),
});
export type LandingImageOverrideInput = z.infer<typeof landingImageOverrideSchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug 只能使用小写字母、数字、连字符，且不能以连字符开头或结尾');

// Cross-field rules shared by create/update: promo block needs its headline,
// and the schedule window must be ordered.
function applyLandingRules<T extends z.ZodObjectDef>(data: z.infer<z.ZodObject<T>>, ctx: z.RefinementCtx) {
  if (data.promoEnabled === true && !data.promoHeadline?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '开启促销块时必须填写促销标题',
      path: ['promoHeadline'],
    });
  }
  if (data.startAt && data.endAt && new Date(data.endAt).getTime() <= new Date(data.startAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束时间必须晚于开始时间', path: ['endAt'] });
  }
}

const landingPageBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  adCode: z.string().trim().max(64).nullable().optional(),
  titleOverride: z.string().trim().max(200).nullable().optional(),
  imagesOverride: z.array(landingImageOverrideSchema).max(10).nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  promoEnabled: z.boolean().optional(),
  promoHeadline: z.string().trim().max(120).nullable().optional(),
  promoSubtext: z.string().trim().max(200).nullable().optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.nativeEnum(LandingPageStatus).optional(),
  sortOrder: z.number().int().min(0).max(99999).optional(),
});

export const createLandingPageSchema = landingPageBaseSchema
  .extend({ slug: slugSchema })
  .superRefine(applyLandingRules);
export type CreateLandingPageInput = z.infer<typeof createLandingPageSchema>;

// Slug is immutable after creation.
export const updateLandingPageSchema = landingPageBaseSchema.partial().superRefine(applyLandingRules);
export type UpdateLandingPageInput = z.infer<typeof updateLandingPageSchema>;

export const adminLandingPageQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(LandingPageStatus).optional(),
  effectiveStatus: z.enum(['LIVE', 'SCHEDULED', 'ENDED', 'DISABLED']).optional(),
  productId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  sortBy: z.enum(['updatedAt', 'title']).default('updatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminLandingPageQuery = z.infer<typeof adminLandingPageQuerySchema>;

export const bulkTitleLandingPagesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  titleOverride: z.string().trim().min(1).max(200),
});
export type BulkTitleLandingPagesInput = z.infer<typeof bulkTitleLandingPagesSchema>;

export const landingPageViewSchema = z.object({
  // Per-tab-session UUID generated in the browser; length guard only.
  visitKey: z.string().trim().min(8).max(100),
});
export type LandingPageViewInput = z.infer<typeof landingPageViewSchema>;
```

- [ ] **Step 4: 实现 effectiveStatus 工具**

`src/modules/catalog/landing/landing-page.util.ts`：

```ts
import type { LandingPageStatus } from '../../../../generated/prisma/client.js';

export type LandingEffectiveStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'DISABLED';

export interface EffectiveStatusInput {
  status: LandingPageStatus;
  startAt: Date | string | null;
  endAt: Date | string | null;
}

// ACTIVE + inside (or without) a schedule window is LIVE; boundaries inclusive.
export function effectiveStatus(lp: EffectiveStatusInput, now: Date = new Date()): LandingEffectiveStatus {
  if (lp.status === 'DISABLED') return 'DISABLED';
  const instant = now.getTime();
  if (lp.startAt && new Date(lp.startAt).getTime() > instant) return 'SCHEDULED';
  if (lp.endAt && new Date(lp.endAt).getTime() < instant) return 'ENDED';
  return 'LIVE';
}
```

- [ ] **Step 5: 实现 service（CRUD 部分）**

`src/modules/catalog/landing/landing-pages.service.ts`（从 `src/modules/catalog/landing/` 出发：PrismaService 为 `../../../prisma/prisma.service.js`，generated 为 `../../../../generated/prisma/client.js`，对照 reviews.service.ts 的相对层级）：

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client.js';
import type { LandingPageStatus } from '../../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProductsService } from '../products.service.js';
import { effectiveStatus, type LandingEffectiveStatus } from './landing-page.util.js';
import type {
  CreateLandingPageInput,
  UpdateLandingPageInput,
} from './dto/landing-page.dto.js';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// '' from a trimmed optional string is normalized to NULL; undefined stays
// undefined so PATCH only touches the fields the client sent.
function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value.length > 0 ? value : null;
}

@Injectable()
export class LandingPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async adminListForProduct(productId: string) {
    await this.ensureProduct(productId);
    const rows = await this.prisma.productLandingPage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async adminCreate(productId: string, input: CreateLandingPageInput) {
    await this.ensureProduct(productId);
    try {
      const row = await this.prisma.productLandingPage.create({
        data: {
          productId,
          slug: input.slug,
          ...this.scalarWritableData(input),
          startAt: input.startAt ? new Date(input.startAt) : null,
          endAt: input.endAt ? new Date(input.endAt) : null,
        },
      });
      return this.serialize(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`链接标识 ${input.slug} 已被使用，请换一个`);
      }
      throw error;
    }
  }

  async adminUpdate(id: string, input: UpdateLandingPageInput) {
    await this.ensureLandingPage(id);
    const row = await this.prisma.productLandingPage.update({
      where: { id },
      data: {
        ...this.scalarWritableData(input),
        startAt:
          input.startAt === undefined ? undefined : input.startAt === null ? null : new Date(input.startAt),
        endAt: input.endAt === undefined ? undefined : input.endAt === null ? null : new Date(input.endAt),
      },
    });
    return this.serialize(row);
  }

  async adminRemove(id: string) {
    await this.ensureLandingPage(id);
    await this.prisma.productLandingPage.delete({ where: { id } });
    return { id };
  }

  private async ensureProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException(`Product #${productId} not found`);
  }

  private async ensureLandingPage(id: string) {
    const row = await this.prisma.productLandingPage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Landing page #${id} not found`);
    return row;
  }

  private scalarWritableData(input: CreateLandingPageInput | UpdateLandingPageInput) {
    return {
      name: input.name,
      adCode: optionalText(input.adCode),
      titleOverride: optionalText(input.titleOverride),
      imagesOverride:
        input.imagesOverride === undefined
          ? undefined
          : input.imagesOverride === null
            ? Prisma.DbNull
            : input.imagesOverride,
      seoTitle: optionalText(input.seoTitle),
      seoDescription: optionalText(input.seoDescription),
      promoEnabled: input.promoEnabled,
      promoHeadline: optionalText(input.promoHeadline),
      promoSubtext: optionalText(input.promoSubtext),
      status: input.status,
      sortOrder: input.sortOrder,
    };
  }

  private serialize<T extends { status: LandingPageStatus; startAt: Date | null; endAt: Date | null }>(
    row: T,
  ): T & { effectiveStatus: LandingEffectiveStatus } {
    return { ...row, effectiveStatus: effectiveStatus(row) };
  }
}
```

（`LandingPageStatus` 若 tsc 报仅类型导入没问题——它只用在泛型约束上，保持 `import type`；值枚举只在 DTO 中使用。）

- [ ] **Step 6: 跑测试确认通过 + 全量门禁**

Run:

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/catalog/landing/landing-pages.service.spec.ts && npx tsc --noEmit && pnpm lint && pnpm test
```

Expected: 新测试全绿；全量 vitest 全绿；oxlint 无告警（留意未用导入 `products`——它被构造函数注入即算使用）。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/catalog/landing && git commit -m "feat(backend): landing page CRUD service, DTOs and effective status"
```

## Task 3: 指标列表（访问/订单/转化率）+ 批量改标题 + admin 路由 + 模块注册

**Files:**
- Modify: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.ts`（追加 `adminList`、`bulkRetitle`）
- Create: `small-house-commerce/backend/src/modules/catalog/landing/admin/landing-pages.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog.module.ts`
- Test: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 delegates（`landingPageVisit.groupBy`、`orderAttribution.groupBy`、`productLandingPage.updateMany/$transaction`）；`OrderAttribution → Order` 关系字段名（动手前先确认，见 Step 0）。
- Produces:
  - `GET /api/v1/admin/landing-pages?...` → `{ items: AdminLandingPageRow[], total, page, pageSize }`
  - `POST /api/v1/admin/landing-pages/bulk-title` → `{ updated: number }`
  - `PATCH /api/v1/admin/landing-pages/:id`、`DELETE /api/v1/admin/landing-pages/:id`
  - `GET/POST /api/v1/admin/products/:productId/landing-pages`
  - `AdminLandingPageRow`（字段见下，全部 JSON 安全；Date 由 Nest 序列化为 ISO 字符串）。

- [ ] **Step 0: 确认 OrderAttribution 的关系字段名（只读）**

Run:

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && grep -n "model OrderAttribution" -A 30 prisma/schema/order.prisma
```

Expected: 模型内有名为 `order Order @relation(...)` 的关系字段（groupBy 过滤用 `order: { orderStatus: { notIn: [...] } }`）。若字段名不叫 `order`，以实际名字替换本任务代码。

- [ ] **Step 1: 追加失败测试**

在 `landing-pages.service.spec.ts` 末尾追加：

```ts
import {
  adminLandingPageQuerySchema,
  bulkTitleLandingPagesSchema,
} from './dto/landing-page.dto.js';

describe('LandingPagesService.adminList metrics', () => {
  function createMetricsMock() {
    return {
      product: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      productLandingPage: {
        findMany: vi.fn(async () => [
          {
            id: 'lp-1', name: 'A', adCode: null, slug: 'a', productId: 'p1', titleOverride: null,
            status: 'ACTIVE', startAt: null, endAt: null, sortOrder: 0,
            updatedAt: new Date('2026-09-10T00:00:00Z'), product: { name: 'Chair' },
          },
          {
            id: 'lp-2', name: 'B', adCode: 'FB-9', slug: 'b', productId: 'p1', titleOverride: 'B 标题',
            status: 'ACTIVE', startAt: null, endAt: null, sortOrder: 1,
            updatedAt: new Date('2026-09-11T00:00:00Z'), product: { name: 'Chair' },
          },
        ]),
        count: vi.fn(async () => 2),
        updateMany: vi.fn(async () => ({ count: 2 })),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      landingPageVisit: {
        groupBy: vi.fn(async () => [{ landingPageId: 'lp-1', _count: { _all: 4 } }]),
      },
      orderAttribution: {
        groupBy: vi.fn(async () => [{ landingPageId: 'lp-1', _count: { _all: 2 } }]),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
  }

  it('joins visits/orders and computes conversion rate, zero when no views', async () => {
    const prisma = createMetricsMock();
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never);
    const result = await service.adminList(adminLandingPageQuerySchema.parse({}));

    expect(result.total).toBe(2);
    const a = result.items.find((i) => i.id === 'lp-1')!;
    const b = result.items.find((i) => i.id === 'lp-2')!;
    expect(a).toMatchObject({ productName: 'Chair', views: 4, orders: 2, conversionRate: 0.5, effectiveStatus: 'LIVE' });
    expect(b).toMatchObject({ views: 0, orders: 0, conversionRate: 0 });

    const orderWhere = prisma.orderAttribution.groupBy.mock.calls[0]![0].where;
    expect(orderWhere).toMatchObject({
      landingPageId: { in: ['lp-1', 'lp-2'] },
      order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
    });
  });

  it('passes search/status/date/effective/product filters into Prisma where', async () => {
    const prisma = createMetricsMock();
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never);
    await service.adminList(
      adminLandingPageQuerySchema.parse({
        search: '椅',
        status: 'ACTIVE',
        effectiveStatus: 'LIVE',
        productId: '22222222-2222-2222-2222-222222222222',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        sortBy: 'title',
        sortDir: 'asc',
      }),
    );
    const args = prisma.productLandingPage.findMany.mock.calls[0]![0];
    expect(args.where.productId).toBe('22222222-2222-2222-2222-222222222222');
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.OR.map((c: { name?: unknown }) => 'name' in c)).toContain(true);
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.updatedAt.gte).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(args.where.updatedAt.lt).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(args.orderBy[0]).toEqual({ titleOverride: 'asc' });
  });

  it('bulkRetitle updates all ids in one statement; DTO bounds are 1..100 ids and 1..200 chars', async () => {
    const prisma = createMetricsMock();
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never);
    await expect(service.bulkRetitle(['lp-1', 'lp-2'], '圣诞促销')).resolves.toEqual({ updated: 2 });
    expect(prisma.productLandingPage.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { in: ['lp-1', 'lp-2'] } },
      data: { titleOverride: '圣诞促销' },
    });

    expect(bulkTitleLandingPagesSchema.safeParse({ ids: [], titleOverride: 'x' }).success).toBe(false);
    expect(
      bulkTitleLandingPagesSchema.safeParse({
        ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`),
        titleOverride: 'x',
      }).success,
    ).toBe(false);
    expect(bulkTitleLandingPagesSchema.safeParse({ ids: ['11111111-1111-1111-1111-111111111111'], titleOverride: '' }).success).toBe(false);
    expect(
      bulkTitleLandingPagesSchema.safeParse({
        ids: ['11111111-1111-1111-1111-111111111111'],
        titleOverride: 'x'.repeat(201),
      }).success,
    ).toBe(false);
  });
});
```

（import 语句放到文件顶部既有 import 区，与其余 import 合并；`LandingPagesService` 已在文件内导入。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/catalog/landing/landing-pages.service.spec.ts
```

Expected：新 describe FAIL（`adminList is not a function` 等）。

- [ ] **Step 3: service 追加方法与行类型**

在 `landing-pages.service.ts` 中：

1. 顶部 import 增补（保留既有 import）：

```ts
import type {
  AdminLandingPageQuery,
  BulkTitleLandingPagesInput,
  CreateLandingPageInput,
  UpdateLandingPageInput,
} from './dto/landing-page.dto.js';
```

（用这一行替换原来只导入 Create/Update 两个类型的那行。）

2. 在 `@Injectable()` class 之前加导出类型：

```ts
export interface AdminLandingPageRow {
  id: string;
  name: string;
  adCode: string | null;
  slug: string;
  productId: string;
  productName: string;
  titleOverride: string | null;
  status: LandingPageStatus;
  effectiveStatus: LandingEffectiveStatus;
  startAt: Date | null;
  endAt: Date | null;
  sortOrder: number;
  updatedAt: Date;
  views: number;
  orders: number;
  conversionRate: number;
}

function nextUtcDay(yyyyMmDd: string): Date {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
```

3. class 内（`adminListForProduct` 之前即可）追加：

```ts
  async adminList(query: AdminLandingPageQuery) {
    const now = new Date();
    const where: Prisma.ProductLandingPageWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { titleOverride: { contains: query.search, mode: 'insensitive' } },
        { adCode: { contains: query.search, mode: 'insensitive' } },
        { product: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.updatedAt = {
        gte: query.dateFrom ? new Date(`${query.dateFrom}T00:00:00Z`) : undefined,
        lt: query.dateTo ? nextUtcDay(query.dateTo) : undefined,
      };
    }
    if (query.effectiveStatus) this.applyEffectiveStatus(where, query.effectiveStatus, now);

    const orderBy: Prisma.ProductLandingPageOrderByWithRelationInput[] =
      query.sortBy === 'title'
        ? [{ titleOverride: query.sortDir }, { updatedAt: 'desc' }]
        : [{ updatedAt: query.sortDir }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productLandingPage.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          adCode: true,
          slug: true,
          productId: true,
          titleOverride: true,
          status: true,
          startAt: true,
          endAt: true,
          sortOrder: true,
          updatedAt: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.productLandingPage.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const [visitGroups, orderGroups] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : this.prisma.landingPageVisit.groupBy({
            by: ['landingPageId'],
            where: { landingPageId: { in: ids } },
            _count: { _all: true },
          }),
      ids.length === 0
        ? Promise.resolve([])
        : this.prisma.orderAttribution.groupBy({
            by: ['landingPageId'],
            where: {
              landingPageId: { in: ids },
              order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
            },
            _count: { _all: true },
          }),
    ]);
    const countOf = (key: string | null, map: Map<string, number>) => (key ? map.get(key) ?? 0 : 0);
    const viewsMap = new Map(visitGroups.map((g) => [g.landingPageId ?? '', g._count._all]));
    const ordersMap = new Map(orderGroups.map((g) => [g.landingPageId ?? '', g._count._all]));

    const items: AdminLandingPageRow[] = rows.map((row) => {
      const views = countOf(row.id, viewsMap);
      const orders = countOf(row.id, ordersMap);
      return {
        id: row.id,
        name: row.name,
        adCode: row.adCode,
        slug: row.slug,
        productId: row.productId,
        productName: row.product.name,
        titleOverride: row.titleOverride,
        status: row.status,
        effectiveStatus: effectiveStatus(row, now),
        startAt: row.startAt,
        endAt: row.endAt,
        sortOrder: row.sortOrder,
        updatedAt: row.updatedAt,
        views,
        orders,
        conversionRate: views === 0 ? 0 : Math.round((orders / views) * 10000) / 10000,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async bulkRetitle(ids: string[], titleOverride: string) {
    const result = await this.prisma.productLandingPage.updateMany({
      where: { id: { in: ids } },
      data: { titleOverride },
    });
    return { updated: result.count };
  }

  private applyEffectiveStatus(
    where: Prisma.ProductLandingPageWhereInput,
    value: LandingEffectiveStatus,
    now: Date,
  ) {
    if (value === 'DISABLED') {
      where.status = 'DISABLED';
      return;
    }
    where.status = 'ACTIVE';
    if (value === 'SCHEDULED') {
      where.startAt = { gt: now };
      return;
    }
    if (value === 'ENDED') {
      where.endAt = { lt: now };
      return;
    }
    // LIVE: ACTIVE, started (or no start), not ended (or no end), inclusive bounds.
    where.AND = [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gte: now } }] },
    ];
  }
```

- [ ] **Step 4: 新建 admin controllers**

`src/modules/catalog/landing/admin/landing-pages.controller.ts`（相对层级：guards `../../../auth/…`，pipe `../../../../common/pipes/…`）：

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import type {
  AdminLandingPageQuery,
  BulkTitleLandingPagesInput,
  CreateLandingPageInput,
  UpdateLandingPageInput,
} from '../dto/landing-page.dto.js';
import {
  adminLandingPageQuerySchema,
  bulkTitleLandingPagesSchema,
  createLandingPageSchema,
  updateLandingPageSchema,
} from '../dto/landing-page.dto.js';
import { LandingPagesService } from '../landing-pages.service.js';

@Controller('admin/landing-pages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get()
  list(@Query(new ZodValidationPipe(adminLandingPageQuerySchema)) query: AdminLandingPageQuery) {
    return this.landingPages.adminList(query);
  }

  @Post('bulk-title')
  @HttpCode(200)
  bulkTitle(
    @Body(new ZodValidationPipe(bulkTitleLandingPagesSchema)) body: BulkTitleLandingPagesInput,
  ) {
    return this.landingPages.bulkRetitle(body.ids, body.titleOverride);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLandingPageSchema)) body: UpdateLandingPageInput,
  ) {
    return this.landingPages.adminUpdate(id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.landingPages.adminRemove(id);
  }
}

@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get(':productId/landing-pages')
  listForProduct(@Param('productId') productId: string) {
    return this.landingPages.adminListForProduct(productId);
  }

  @Post(':productId/landing-pages')
  create(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createLandingPageSchema)) body: CreateLandingPageInput,
  ) {
    return this.landingPages.adminCreate(productId, body);
  }
}
```

注意：先核对 `src/modules/catalog/admin/reviews.controller.ts` 中 `Permissions` 装饰器的实际 import 路径与文件名（`../../../auth/permissions.decorator.js`），若实际文件名不同（如 `permission.decorator.ts`），以现有文件为准。`@Delete` 返回 `{id}` 用 200（前端 adminApi 默认解析 JSON；若仓库其他 DELETE 约定返回 204，跟随既有约定并让前端方法兼容空响应）。

- [ ] **Step 5: 注册进 CatalogModule**

`src/modules/catalog/catalog.module.ts`：

import 区加：

```ts
import {
  AdminLandingPagesController,
  AdminProductLandingPagesController,
} from './landing/admin/landing-pages.controller.js';
import { LandingPagesService } from './landing/landing-pages.service.js';
```

`controllers:` 数组在 `AdminProductReviewsController, AdminReviewsController,` 之后加：

```ts
  AdminLandingPagesController,
  AdminProductLandingPagesController,
```

`providers:` 数组在 `ReviewsService, SuppliersService` 之后加：

```ts
  LandingPagesService,
```

（`ProductsService` 已在 providers 中，LandingPagesService 可直接注入。）

- [ ] **Step 6: 全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：全绿。若 `order: { ... }` 关系过滤 tsc 报错（Prisma 7 若要求 `is`），改成 `order: { is: { orderStatus: { notIn: ['CANCELLED','DENIED'] } } }`，同步改测试里的 `toMatchObject`，并在计划此处记录。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/catalog/landing small-house-commerce/backend/src/modules/catalog/catalog.module.ts && git commit -m "feat(backend): landing page metrics list, bulk retitle and admin routes"
```

## Task 4: 公共落地页复合接口 + 会话访问 beacon（含测试）

**Files:**
- Modify: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.ts`（追加两个公共方法）
- Create: `small-house-commerce/backend/src/modules/catalog/landing/storefront/landing-pages.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog.module.ts`（注册公共 controller）
- Test: `small-house-commerce/backend/src/modules/catalog/landing/landing-pages.service.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: `ProductsService.storefrontGetBySlug(slug)`（现有白名单装配器，返回店面 Product；成本字段永不外泄）；`landingPageViewSchema`。
- Produces:
  - `GET /api/v1/storefront/lp/:slug` → `{ landingPage: PublicLandingPage, product: StorefrontProduct }`；缺失/停用/时间窗外/父产品下架一律 404。
  - `POST /api/v1/storefront/lp/:slug/view` body `{visitKey}` → 恒 204（幂等 upsert，竞争产生的 P2002 吞掉，不 live 直接 no-op）。
  - `PublicLandingPage` 仅含：`id,name,slug,titleOverride,imagesOverride,seoTitle,seoDescription,promoEnabled,promoHeadline,promoSubtext`（**不含** status/startAt/endAt/sortOrder/adCode 等内部字段）。

- [ ] **Step 1: 追加失败测试**

在 spec 文件追加：

```ts
describe('storefront landing composite + view beacon', () => {
  const liveInclude = () => ({
    id: 'lp-1',
    name: 'A',
    adCode: 'FB-1',
    slug: 'a',
    titleOverride: '促销名',
    imagesOverride: [{ url: 'https://cdn.example.test/a.jpg', altText: '图' }],
    seoTitle: null,
    seoDescription: null,
    promoEnabled: true,
    promoHeadline: 'Christmas Sale',
    promoSubtext: null,
    status: 'ACTIVE',
    startAt: null,
    endAt: null,
    sortOrder: 0,
    product: { slug: 'chair', status: 'ACTIVE' },
  });

  it('returns whitelisted landing fields plus the storefront product', async () => {
    const prisma = {
      product: { findUnique: vi.fn() },
      productLandingPage: { findUnique: vi.fn(async () => liveInclude()) },
      landingPageVisit: { upsert: vi.fn() },
    };
    const products = { storefrontGetBySlug: vi.fn(async () => ({ id: 'p1', slug: 'chair', name: 'Chair' })) };
    const service = new LandingPagesService(prisma as never, products as never);

    const result = await service.storefrontGetComposite('a');
    expect(products.storefrontGetBySlug).toHaveBeenCalledWith('chair');
    expect(result.landingPage).toEqual({
      id: 'lp-1',
      name: 'A',
      slug: 'a',
      titleOverride: '促销名',
      imagesOverride: [{ url: 'https://cdn.example.test/a.jpg', altText: '图' }],
      seoTitle: null,
      seoDescription: null,
      promoEnabled: true,
      promoHeadline: 'Christmas Sale',
      promoSubtext: null,
    });
    expect(result.landingPage).not.toHaveProperty('adCode');
    expect(result.landingPage).not.toHaveProperty('status');
    expect(result.product).toMatchObject({ slug: 'chair' });
  });

  it.each([
    ['missing', null],
    ['disabled', { ...liveInclude(), status: 'DISABLED' }],
    ['scheduled', { ...liveInclude(), startAt: new Date('2099-01-01T00:00:00Z') }],
    ['ended', { ...liveInclude(), endAt: new Date('2000-01-01T00:00:00Z') }],
    ['parent draft', { ...liveInclude(), product: { slug: 'chair', status: 'DRAFT' } }],
  ])('404 when %s', async (_label, row) => {
    const prisma = {
      productLandingPage: { findUnique: vi.fn(async () => row) },
      landingPageVisit: { upsert: vi.fn() },
    };
    const products = { storefrontGetBySlug: vi.fn() };
    const service = new LandingPagesService(prisma as never, products as never);
    await expect(service.storefrontGetComposite('a')).rejects.toBeInstanceOf(NotFoundException);
    expect(products.storefrontGetBySlug).not.toHaveBeenCalled();
  });

  it('recordView upserts with the compound unique key for a live LP', async () => {
    const prisma = {
      productLandingPage: {
        findUnique: vi.fn(async () => ({
          id: 'lp-1', status: 'ACTIVE', startAt: null, endAt: null,
          product: { status: 'ACTIVE' },
        })),
      },
      landingPageVisit: { upsert: vi.fn(async () => ({})) },
    };
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never);
    await service.recordView('a', 'visit-uuid-1234');
    expect(prisma.landingPageVisit.upsert).toHaveBeenCalledWith({
      where: { landingPageId_visitKey: { landingPageId: 'lp-1', visitKey: 'visit-uuid-1234' } },
      create: { landingPageId: 'lp-1', visitKey: 'visit-uuid-1234' },
      update: {},
    });
  });

  it('recordView is a silent no-op when not live and swallows a race P2002', async () => {
    const prisma = {
      productLandingPage: {
        findUnique: vi.fn(async () => ({
          id: 'lp-1', status: 'DISABLED', startAt: null, endAt: null,
          product: { status: 'ACTIVE' },
        })),
      },
      landingPageVisit: { upsert: vi.fn() },
    };
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never);
    await expect(service.recordView('a', 'visit-uuid-1234')).resolves.toBeUndefined();
    expect(prisma.landingPageVisit.upsert).not.toHaveBeenCalled();

    prisma.productLandingPage.findUnique.mockResolvedValueOnce({
      id: 'lp-1', status: 'ACTIVE', startAt: null, endAt: null, product: { status: 'ACTIVE' },
    });
    prisma.landingPageVisit.upsert.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.recordView('a', 'visit-uuid-1234')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/catalog/landing/landing-pages.service.spec.ts
```

Expected：新 describe FAIL。

- [ ] **Step 3: service 追加公共方法**

`landing-pages.service.ts`：

1. import 增补 `LandingImageOverrideInput`（from DTO type import）与 `Prisma` 已在。
2. 模块级加 JSON 收敛函数（放在 `isUniqueViolation` 旁）：

```ts
// Only accept an actual non-empty array of objects from the Json column.
function toImageOverrides(value: Prisma.JsonValue | null): LandingImageOverrideInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value as LandingImageOverrideInput[];
}
```

3. class 内追加（放在 CRUD 方法之后、private 方法之前）：

```ts
  async storefrontGetComposite(slug: string) {
    const lp = await this.prisma.productLandingPage.findUnique({
      where: { slug },
      include: { product: { select: { slug: true, status: true } } },
    });
    if (!lp || lp.product.status !== 'ACTIVE' || effectiveStatus(lp) !== 'LIVE') {
      // Same 404 for every non-public state: do not disclose scheduled/disabled LPs.
      throw new NotFoundException(`Landing page #${slug} not found`);
    }
    const product = await this.products.storefrontGetBySlug(lp.product.slug);
    return {
      landingPage: {
        id: lp.id,
        name: lp.name,
        slug: lp.slug,
        titleOverride: lp.titleOverride,
        imagesOverride: toImageOverrides(lp.imagesOverride),
        seoTitle: lp.seoTitle,
        seoDescription: lp.seoDescription,
        promoEnabled: lp.promoEnabled,
        promoHeadline: lp.promoHeadline,
        promoSubtext: lp.promoSubtext,
      },
      product,
    };
  }

  async recordView(slug: string, visitKey: string): Promise<void> {
    const lp = await this.prisma.productLandingPage.findUnique({
      where: { slug },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        product: { select: { status: true } },
      },
    });
    if (!lp || lp.product.status !== 'ACTIVE' || effectiveStatus(lp) !== 'LIVE') return;
    try {
      await this.prisma.landingPageVisit.upsert({
        where: { landingPageId_visitKey: { landingPageId: lp.id, visitKey } },
        create: { landingPageId: lp.id, visitKey },
        update: {},
      });
    } catch (error) {
      // Concurrent first-hit race: the unique row already exists, count is unchanged.
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }
```

若 tsc 对复合 unique 的 where key 报错，以生成客户端中的实际名字为准（Prisma 惯例即 `landingPageId_visitKey`）。

- [ ] **Step 4: 新建 storefront controller**

`src/modules/catalog/landing/storefront/landing-pages.controller.ts`（**无 guards**，公共路由；pipe 相对层级 `../../../../common/pipes/…`）：

```ts
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import type { LandingPageViewInput } from '../dto/landing-page.dto.js';
import { landingPageViewSchema } from '../dto/landing-page.dto.js';
import { LandingPagesService } from '../landing-pages.service.js';

@Controller('storefront/lp')
export class StorefrontLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.landingPages.storefrontGetComposite(slug);
  }

  @Post(':slug/view')
  @HttpCode(204)
  async recordView(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(landingPageViewSchema)) body: LandingPageViewInput,
  ): Promise<void> {
    await this.landingPages.recordView(slug, body.visitKey);
  }
}
```

- [ ] **Step 5: 注册 controller**

`src/modules/catalog/catalog.module.ts`：import 加

```ts
import { StorefrontLandingPagesController } from './landing/storefront/landing-pages.controller.js';
```

并把 `StorefrontLandingPagesController` 加进 `controllers:` 数组（与 StorefrontProductsController 同区）。

- [ ] **Step 6: 全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：全绿。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/catalog/landing small-house-commerce/backend/src/modules/catalog/catalog.module.ts && git commit -m "feat(backend): public landing page composite and idempotent view beacon"
```

---

## Task 5: 下单归因携带 landingPageId（复用已存在列）

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/dto/order.dto.ts`
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts`
- Test（新建）: `small-house-commerce/backend/src/modules/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `OrderAttribution.landingPageId` 列**已存在于** `prisma/schema/order.prisma`（`@map("landing_page_id")`，无 FK 约束）——本任务无迁移。
- Produces: checkout DTO attribution 接受 `landingPageId?: string(uuid)|null`；下单时原样写入 `OrderAttribution.landingPageId`（未提供 → null）。转化计数（Task 3）按此列聚合。

- [ ] **Step 1: 先写失败测试**

`src/modules/orders/orders.service.spec.ts`：

```ts
import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { checkoutSchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

const SKU_ID = '00000000-0000-0000-0000-0000000000a1';
const LP_ID = '11111111-1111-1111-1111-111111111111';

function skuRecord() {
  return {
    id: SKU_ID,
    skuCode: 'CHAIR-1',
    status: 'ACTIVE',
    price: new Prisma.Decimal('199'),
    landedCost: new Prisma.Decimal('100'),
    variant: {
      id: '00000000-0000-0000-0000-0000000000b1',
      name: 'Single',
      productId: '00000000-0000-0000-0000-0000000000c1',
      product: {
        id: '00000000-0000-0000-0000-0000000000c1',
        name: 'Chair',
        status: 'ACTIVE',
      },
    },
  };
}

function checkoutOverrides(overrides: Record<string, unknown> = {}) {
  return checkoutSchema.parse({
    customer: {
      name: 'Jane',
      phone: '09171234567',
      province: 'Metro Manila',
      city: 'Manila',
      streetAddress: '1 Main St',
    },
    items: [{ skuId: SKU_ID, quantity: 1 }],
    ...overrides,
  });
}

function createHarness() {
  const tx = {
    order: { create: vi.fn(async () => ({ id: 'order-1' })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    sku: { findUnique: vi.fn(async () => skuRecord()) },
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]),
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const inventory = {
    availableBySku: vi.fn(async () => new Map([[SKU_ID, 5]])),
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    reserveWithin: vi.fn(async () => ({})),
  };
  const service = new OrdersService(prisma as never, inventory as unknown as InventoryService);
  return { service, prisma, tx, inventory };
}

describe('OrdersService.checkout attribution', () => {
  it('persists landingPageId into OrderAttribution when provided', async () => {
    const { service, tx } = createHarness();
    await service.checkout(checkoutOverrides({ attribution: { landingPageId: LP_ID } }));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBe(LP_ID);
  });

  it('persists null landingPageId when attribution omits it', async () => {
    const { service, tx } = createHarness();
    await service.checkout(checkoutOverrides({}));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBeNull();
  });

  it('rejects a non-uuid landingPageId at the DTO boundary', () => {
    // safeParse the raw object: parse() output would already be validated.
    const result = checkoutSchema.safeParse({
      customer: {
        name: 'Jane',
        phone: '09171234567',
        province: 'Metro Manila',
        city: 'Manila',
        streetAddress: '1 Main St',
      },
      items: [{ skuId: SKU_ID, quantity: 1 }],
      attribution: { landingPageId: 'not-a-uuid' },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/orders/orders.service.spec.ts
```

Expected：前两个 FAIL（`landingPageId` 为 undefined）；第三个 FAIL（schema 当前放行）。

- [ ] **Step 3: DTO 加字段**

`src/modules/orders/dto/order.dto.ts` 的 checkout attribution 对象中，在 `adId` 之后加一行（保持与周围 `campaignId/adsetId/adId` 同样的 nullable/optional 风格）：

```ts
      landingPageId: z.string().uuid().nullable().optional(),
```

- [ ] **Step 4: service 写入归因**

`src/modules/orders/orders.service.ts` 的 `attribution: { create: { ... } }` 块中，在：

```ts
              adId: input.attribution.adId ?? null,
```

之后加：

```ts
              landingPageId: input.attribution.landingPageId ?? null,
```

- [ ] **Step 5: 全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/orders/orders.service.spec.ts && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：全绿；既有下单链路行为不变（未带 attribution 时该列为 null）。

- [ ] **Step 6: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/orders && git commit -m "feat(backend): persist landing page id on checkout attribution"
```

## Task 6: 评论批量导入（原子后端接口，含测试）

**Files:**
- Modify: `small-house-commerce/backend/src/modules/catalog/dto/review.dto.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/reviews.service.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/admin/reviews.controller.ts`
- Test（新建）: `small-house-commerce/backend/src/modules/catalog/reviews.service.spec.ts`

**Interfaces:**
- Consumes: 现有 `createAdminReviewSchema`（authorName/rating/comment/photos/isVisible 规则原样复用）；`ReviewsService.ensureProduct`（private，本类内直接调用）。
- Produces:
  - `POST /api/v1/admin/products/:productId/reviews/batch` body `{ items: unknown[] }`（1–100）。
  - 全部合法 → 单事务批量插入，source 固定 `'ADMIN'`，返回 `{ created: number }`。
  - 任一不合法 → **零插入**，400 body 含 `{ message, errors: Array<{row, field, message}> }`，row 从 1 起。

- [ ] **Step 1: 先写失败测试**

`src/modules/catalog/reviews.service.spec.ts`：

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { batchReviewsSchema } from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';

function createPrismaMock() {
  return {
    product: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
    productReview: { create: vi.fn(async (args: { data: unknown }) => ({ id: 'r1', ...args.data })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const validRow = () => ({
  authorName: 'Maria',
  location: 'Cebu',
  rating: 5,
  title: 'Great',
  comment: 'Maganda ang quality, sulit sa presyo.',
  photos: [],
  isVisible: true,
});

describe('ReviewsService.adminBatchCreate', () => {
  it('inserts every valid row in one transaction as ADMIN and returns created count', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    const result = await service.adminBatchCreate('p1', [validRow(), { ...validRow(), authorName: 'Jose' }]);
    expect(result).toEqual({ created: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productReview.create).toHaveBeenCalledTimes(2);
    for (const call of prisma.productReview.create.mock.calls) {
      expect(call[0].data).toMatchObject({ productId: 'p1', source: 'ADMIN', rating: 5 });
    }
  });

  it('rejects the whole batch with row-scoped errors and inserts nothing', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    const bad = [
      validRow(),
      { authorName: '', location: 'Cebu', rating: 9, title: '', comment: '', photos: [] },
    ];
    await expect(service.adminBatchCreate('p1', bad)).rejects.toBeInstanceOf(BadRequestException);
    try {
      await service.adminBatchCreate('p1', bad);
      throw new Error('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        errors: Array<{ row: number; field: string; message: string }>;
      };
      expect(body.errors.length).toBeGreaterThanOrEqual(3);
      expect(body.errors.every((e) => e.row === 2)).toBe(true);
      expect(body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['authorName', 'rating', 'comment']));
    }
    expect(prisma.productReview.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s on unknown product and inserts nothing', async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValueOnce(null);
    const service = new ReviewsService(prisma as never);
    await expect(service.adminBatchCreate('missing', [validRow()])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.productReview.create).not.toHaveBeenCalled();
  });

  it('batch DTO only accepts 1..100 raw items', () => {
    expect(batchReviewsSchema.safeParse({ items: [] }).success).toBe(false);
    expect(batchReviewsSchema.safeParse({ items: Array(101).fill(validRow()) }).success).toBe(false);
    expect(batchReviewsSchema.safeParse({ items: [validRow()] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/catalog/reviews.service.spec.ts
```

Expected：FAIL（schema/service/方法不存在）。

- [ ] **Step 3: DTO 追加批量外壳**

`src/modules/catalog/dto/review.dto.ts` 末尾加：

```ts
// Rows are validated one-by-one against createAdminReviewSchema inside the
// service: the outer schema only bounds the batch size so a huge paste
// fails fast and row-level errors can point at the offending row.
export const batchReviewsSchema = z.object({
  items: z.array(z.unknown()).min(1).max(100),
});
export type BatchReviewsInput = z.infer<typeof batchReviewsSchema>;
```

- [ ] **Step 4: service 实现原子批量**

`src/modules/catalog/reviews.service.ts`：

1. 顶部把 `NotFoundException` 的导入扩为：

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
```

2. import 类型：

```ts
import type { BatchReviewsInput } from './dto/review.dto.js';
import { createAdminReviewSchema } from './dto/review.dto.js';
```

（若 `createAdminReviewSchema` 已被文件导入，合并即可。）

3. 在 `adminCreate` 旁加：

```ts
  // Spec: one failing row rejects the WHOLE batch with zero inserts.
  async adminBatchCreate(productId: string, items: BatchReviewsInput['items']) {
    const parsed = new Array<z.infer<typeof createAdminReviewSchema>>();
    const errors: Array<{ row: number; field: string; message: string }> = [];

    items.forEach((raw, index) => {
      const result = createAdminReviewSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            row: index + 1,
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          });
        }
      } else {
        parsed.push(result.data);
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: '有评论行未通过校验，未导入任何评论',
        errors,
      });
    }

    await this.ensureProduct(productId);

    await this.prisma.$transaction(
      parsed.map((input) =>
        this.prisma.productReview.create({
          data: {
            productId,
            source: 'ADMIN',
            authorName: input.authorName,
            location: input.location ?? null,
            rating: input.rating,
            title: input.title ?? null,
            comment: input.comment,
            photos: input.photos,
            isVisible: input.isVisible,
          },
        }),
      ),
    );

    return { created: parsed.length };
  }
```

4. 文件顶部确保有 `import type { z } from 'zod';`（若 `z.infer` 类型注解报命名空间错误；也可以把 parsed 显式标成 `Awaited<ReturnType<ReviewsService['adminCreate']>>` 不现实——统一用 `import type { z } from 'zod';`）。

- [ ] **Step 5: controller 加路由**

`src/modules/catalog/admin/reviews.controller.ts`：

1. import：

```ts
import type { BatchReviewsInput } from '../dto/review.dto.js';
import { batchReviewsSchema } from '../dto/review.dto.js';
```

2. 在 `AdminProductReviewsController` 中、既有单条 `@Post(':productId/reviews')` 方法**之前**加：

```ts
  @Post(':productId/reviews/batch')
  batchCreate(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(batchReviewsSchema)) body: BatchReviewsInput,
  ) {
    return this.reviews.adminBatchCreate(productId, body.items);
  }
```

（`/reviews/batch` 比 `/reviews` 多一段，Express 不会误匹配；方法放前面仅为可读性。）

- [ ] **Step 6: 全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：全绿。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/catalog/dto/review.dto.ts small-house-commerce/backend/src/modules/catalog/reviews.service.ts small-house-commerce/backend/src/modules/catalog/reviews.service.spec.ts small-house-commerce/backend/src/modules/catalog/admin/reviews.controller.ts && git commit -m "feat(backend): atomic batch review import with row-scoped 400 errors"
```

## Task 7: Cloudflare R2 预签名直传（node:crypto SigV4，零依赖）

**Files:**
- Create: `small-house-commerce/backend/src/modules/uploads/dto/upload.dto.ts`
- Create: `small-house-commerce/backend/src/modules/uploads/r2-presign.ts`
- Create: `small-house-commerce/backend/src/modules/uploads/uploads.service.ts`
- Create: `small-house-commerce/backend/src/modules/uploads/admin/uploads.controller.ts`
- Create: `small-house-commerce/backend/src/modules/uploads/uploads.module.ts`
- Test: `small-house-commerce/backend/src/modules/uploads/r2-presign.spec.ts`、`uploads.service.spec.ts`
- Modify: `src/config/env.validation.ts`、`src/config/configuration.ts`、`src/app.module.ts`、`.env.example`

**Interfaces:**
- Consumes: `ConfigService`（`@nestjs/config`，全局 ConfigModule）；R2 5 个可选环境变量。
- Produces:
  - `buildR2PresignedPutUrl(settings, key, contentType, expiresIn, now?)` 纯函数（可测、无网络）。
  - `POST /api/v1/admin/uploads/presign` body `{contentType: 'image/jpeg'|'image/png'|'image/webp', fileName}` → `{uploadUrl, publicUrl, key, expiresIn: 600}`；R2 未配置 → 503 + 中文 message。
  - key 形状 `catalog/<UTC年>/<uuid>.<jpg|png|webp>`；PUT 签名绑定 Content-Type，10 分钟有效。
  - 浏览器用 `fetch(uploadUrl, {method:'PUT', headers:{'Content-Type':contentType}, body:file})` 直传。

- [ ] **Step 1: 先写失败测试**

`src/modules/uploads/r2-presign.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildR2PresignedPutUrl, type R2Settings } from './r2-presign.js';

const settings: R2Settings = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretexample',
  bucket: 'smallhouse-catalog',
  publicBaseUrl: 'https://img.example.test/',
};
const NOW = new Date('2026-09-14T12:00:00Z');

function params(uploadUrl: string): URLSearchParams {
  return new URL(uploadUrl).searchParams;
}

describe('buildR2PresignedPutUrl', () => {
  it('builds a deterministic SigV4 PUT url scoped to the bucket key', () => {
    const r = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const u = new URL(r.uploadUrl);
    expect(u.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/smallhouse-catalog/catalog/2026/uuid.jpg');
    expect(params(r.uploadUrl).get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(params(r.uploadUrl).get('X-Amz-Expires')).toBe('600');
    expect(params(r.uploadUrl).get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(params(r.uploadUrl).get('X-Amz-Date')).toBe('20260914T120000Z');
    expect(params(r.uploadUrl).get('X-Amz-Credential')).toBe(
      'AKIAEXAMPLE/20260914/auto/s3/aws4_request',
    );
    expect(params(r.uploadUrl).get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(r).toMatchObject({
      key: 'catalog/2026/uuid.jpg',
      expiresIn: 600,
      publicUrl: 'https://img.example.test/catalog/2026/uuid.jpg',
    });
  });

  it('is deterministic for identical inputs', () => {
    const a = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const b = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    expect(a.uploadUrl).toBe(b.uploadUrl);
  });

  it('signature changes when secret, content-type or time changes', () => {
    const base = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const otherSecret = buildR2PresignedPutUrl({ ...settings, secretAccessKey: 'other' }, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const otherType = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/png', 600, NOW);
    const otherTime = buildR2PresignedPutUrl(
      settings,
      'catalog/2026/uuid.jpg',
      'image/jpeg',
      600,
      new Date('2026-09-14T12:00:01Z'),
    );
    expect(otherSecret.uploadUrl).not.toBe(base.uploadUrl);
    expect(otherType.uploadUrl).not.toBe(base.uploadUrl);
    expect(otherTime.uploadUrl).not.toBe(base.uploadUrl);
  });
});
```

`src/modules/uploads/uploads.service.spec.ts`：

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { R2Settings } from './r2-presign.js';
import { UploadsService } from './uploads.service.js';

const settings: R2Settings = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretexample',
  bucket: 'smallhouse-catalog',
  publicBaseUrl: 'https://img.example.test',
};

describe('UploadsService.presign', () => {
  it('503s when R2 is not configured (boot still succeeds without env)', () => {
    const undefinedConfig = { get: vi.fn(() => undefined) };
    const partialConfig = { get: vi.fn(() => ({ ...settings, bucket: null })) };
    expect(() => new UploadsService(undefinedConfig as never).presign('image/jpeg', 'a.jpg')).toThrow(
      ServiceUnavailableException,
    );
    expect(() => new UploadsService(partialConfig as never).presign('image/jpeg', 'a.jpg')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('mints a year/uuid key with the mapped extension and 10-minute expiry', () => {
    const config = { get: vi.fn((key: string) => (key === 'r2' ? settings : undefined)) };
    const service = new UploadsService(config as never);
    const jpg = service.presign('image/jpeg', 'photo.JPG');
    expect(jpg.key).toMatch(/^catalog\/2026\/[0-9a-f-]{36}\.jpg$/);
    expect(jpg.expiresIn).toBe(600);
    expect(jpg.publicUrl).toBe(`https://img.example.test/${jpg.key}`);
    expect(new URL(jpg.uploadUrl).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    expect(service.presign('image/png', 'p.png').key).toMatch(/\.png$/);
    expect(service.presign('image/webp', 'p.webp').key).toMatch(/\.webp$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec vitest run src/modules/uploads
```

Expected：FAIL（模块不存在）。

- [ ] **Step 3: 实现 SigV4 纯函数**

`src/modules/uploads/r2-presign.ts`：

```ts
import { createHash, createHmac } from 'node:crypto';

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

const REGION = 'auto';
const SERVICE = 's3';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

// AWS SigV4 uses strict RFC3986 percent encoding (encodeURIComponent misses !'()*).
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

// Presigned PUT (SigV4 query-param auth), signed Content-Type, unsigned body.
// R2 endpoint shape: https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>
export function buildR2PresignedPutUrl(
  settings: R2Settings,
  key: string,
  contentType: string,
  expiresIn: number,
  now: Date = new Date(),
): PresignResult {
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${settings.bucket}/${key}`;
  const signedHeaders = 'content-type;host';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;

  const queryParts: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${settings.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const canonicalQueryString = queryParts
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${settings.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const baseUrl = settings.publicBaseUrl.replace(/\/+$/, '');
  return { uploadUrl, publicUrl: `${baseUrl}/${key}`, key, expiresIn };
}
```

- [ ] **Step 4: DTO、service、controller、module**

`src/modules/uploads/dto/upload.dto.ts`：

```ts
import { z } from 'zod';

export const presignUploadSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileName: z.string().trim().min(1).max(255),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
```

`src/modules/uploads/uploads.service.ts`：

```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PresignUploadInput } from './dto/upload.dto.js';
import { buildR2PresignedPutUrl, type PresignResult, type R2Settings } from './r2-presign.js';

const EXTENSION_BY_TYPE: Record<PresignUploadInput['contentType'], 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  presign(contentType: PresignUploadInput['contentType'], _fileName: string): PresignResult {
    const r2 = this.config.get<R2Settings | null>('r2');
    if (
      !r2 ||
      !r2.accountId ||
      !r2.accessKeyId ||
      !r2.secretAccessKey ||
      !r2.bucket ||
      !r2.publicBaseUrl
    ) {
      // Boot is intentionally allowed without R2; only presigning is unavailable.
      throw new ServiceUnavailableException('图片直传未配置（R2），可直接粘贴图片 URL');
    }
    const year = new Date().getUTCFullYear();
    const key = `catalog/${year}/${randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;
    return buildR2PresignedPutUrl(r2, key, contentType, 600);
  }
}
```

（`_fileName` 保留在签名里以便审计/未来按原名排障，但 key 不使用用户输入，杜绝路径穿越与怪异字符。若 oxlint 对未使用参数报错，去掉参数名改为 `presign(contentType: ...)` 并同步 controller 调用与测试。）

`src/modules/uploads/admin/uploads.controller.ts`（相对层级同 Task 3 的 admin 子目录：guards `../../../auth/…`、pipe `../../../../common/pipes/…`）：

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import type { PresignUploadInput } from '../dto/upload.dto.js';
import { presignUploadSchema } from '../dto/upload.dto.js';
import { UploadsService } from '../uploads.service.js';

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  presign(@Body(new ZodValidationPipe(presignUploadSchema)) body: PresignUploadInput) {
    return this.uploads.presign(body.contentType, body.fileName);
  }
}
```

`src/modules/uploads/uploads.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminUploadsController } from './admin/uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminUploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
```

- [ ] **Step 5: 配置接线（可选环境变量，缺省可启动）**

1. `src/config/env.validation.ts`：在 envSchema 的 JWT 字段之后加 5 个 optional 字段：

```ts
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
```

2. `src/config/configuration.ts`：在返回对象的 `jwt: { ... }` 块之后加：

```ts
    r2: {
      accountId: env.R2_ACCOUNT_ID ?? null,
      accessKeyId: env.R2_ACCESS_KEY_ID ?? null,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? null,
      bucket: env.R2_BUCKET ?? null,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? null,
    },
```

3. `src/app.module.ts`：import 区加：

```ts
import { UploadsModule } from './modules/uploads/uploads.module.js';
```

`imports:` 数组在 `CollectionsModule` 之后加 `UploadsModule,`。

4. `.env.example` 末尾追加（密钥永不入库）：

```bash

### Cloudflare R2（可选；不配置时后台仍可用「粘贴图片 URL」方式）
# 1) R2 控制台创建 bucket（建议 smallhouse-catalog）
# 2) 绑定 bucket 公开访问域名（如 https://img.smallhouse.ph）填入 R2_PUBLIC_BASE_URL
# 3) bucket CORS 允许后台来源：AllowedOrigins 填后台域名（开发期加 http://localhost:3001），
#    AllowedMethods 加 PUT，AllowedHeaders 加 content-type
# 4) 创建 R2 API Token（Object Read & Write），取 Access Key ID / Secret
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
```

- [ ] **Step 6: 全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：全绿；无 R2 环境变量时不影响任何既有测试与启动（env 字段 optional）。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add small-house-commerce/backend/src/modules/uploads small-house-commerce/backend/src/config/env.validation.ts small-house-commerce/backend/src/config/configuration.ts small-house-commerce/backend/src/app.module.ts small-house-commerce/backend/.env.example && git commit -m "feat(backend): R2 presigned PUT uploads with SigV4, optional config"
```

## Task 8: 店面 `/lp/[slug]` 路由、PDP 抽共享组件、Pixel 归因贯通

**Files:**
- Modify: `frontend/src/lib/tracking.ts`、`frontend/src/lib/api.ts`、`frontend/src/components/product/PdpClient.tsx`、`frontend/src/app/(storefront)/products/[slug]/page.tsx`
- Create: `frontend/src/lib/product-jsonld.ts`、`frontend/src/components/product/PdpView.tsx`、`frontend/src/components/product/LandingViewTracker.tsx`、`frontend/src/app/(storefront)/lp/[slug]/page.tsx`

**Interfaces:**
- Consumes: `GET /storefront/lp/:slug` composite（Task 4）；现有 `CheckoutForm` 提交 `readAttribution()`（不改 CheckoutForm 代码，类型自动变宽）。
- Produces:
  - 浏览器 localStorage `sh:lp`（最后访问的 LP id），sessionStorage `sh:lpvisit`（每标签会话一个 UUID）；`readAttribution()` 输出新增 `landingPageId`。
  - `/lp/<slug>` 页面：仅 H1/name、图集、SEO 标题/描述、促销条随 override；价格/SKU/库存/评论/FAQ/related 全部走真实 product；JSON-LD 与 canonical 保持真实 PDP；Pixel ViewContent 事件 content_name 自然变成 override 名（PdpClient 未改事件逻辑）。

- [ ] **Step 0: 先读 Next 16 文档（AGENTS.md 强制）**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && find node_modules/next/dist/docs -iname '*.md' | grep -Ei 'page|metadata|params' | head -20
```

读其中动态路由 page 与 generateMetadata 两篇（Next 16：`params` 是 Promise，必须 `await`；本任务两个页面都照现有 PDP 的 async params 写法）。

- [ ] **Step 1: tracking.ts 改造（精确 Edit）**

`frontend/src/lib/tracking.ts`：

1. 把未导出的类型改为导出并加两键常量位置：

```ts
type Attribution = {
  sourceType?: string;
  aid?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};
```

替换为：

```ts
export type Attribution = {
  sourceType?: string;
  aid?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  landingPageId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

/** Last-visited landing page wins; read back at checkout (TRACKING: sh:lp). */
export const LANDING_PAGE_STORAGE_KEY = "sh:lp";
/** One UUID per browser tab session, reused for every LP beacon in the tab. */
export const LANDING_VISIT_SESSION_KEY = "sh:lpvisit";
```

2. `readAttribution` 的 return 对象加最后一个 LP（在 utmCampaign 之后）：

```ts
    utmCampaign: params.get("utm_campaign") ?? null,
    landingPageId: window.localStorage.getItem(LANDING_PAGE_STORAGE_KEY) ?? null,
```

3. 文件末尾加持久化函数：

```ts
/** Called by the LP view tracker: this LP gets attribution until another is visited. */
export function persistLandingPage(landingPageId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANDING_PAGE_STORAGE_KEY, landingPageId);
}
```

- [ ] **Step 2: api.ts 改造（精确 Edit）**

`frontend/src/lib/api.ts`：

1. 顶部加类型导入：

```ts
import type { Attribution } from "./tracking";
```

2. 类型区（`Paged` 接口之后）加：

```ts
export interface LandingImageOverride {
  url: string;
  altText?: string | null;
}

export interface LandingPageInfo {
  id: string;
  name: string;
  slug: string;
  titleOverride: string | null;
  imagesOverride: LandingImageOverride[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
}

export interface LandingPageComposite {
  landingPage: LandingPageInfo;
  product: Product;
}
```

3. 把 `request<T>` 中 `if (!res.ok) { ... }` 错误块抽成共享函数，并增加空响应助手（整段替换 `request<T>` 函数）：

```ts
async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    /* keep default message */
  }
  throw new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
  return res.json() as Promise<T>;
}

// View beacons return 204 No Content.
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
}
```

4. `createOrder` 的 attribution 类型（`attribution?: { sourceType?: string; aid?: string | null };`）替换为：

```ts
    attribution?: Attribution;
```

5. `api` 对象中 `getProductBySlug` 之后加两个方法：

```ts
  getLandingPage: (slug: string) =>
    request<LandingPageComposite>(
      `/api/v1/storefront/lp/${encodeURIComponent(slug)}`,
    ),
  recordLandingPageView: (slug: string, visitKey: string) =>
    requestVoid(`/api/v1/storefront/lp/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      body: JSON.stringify({ visitKey }),
    }),
```

- [ ] **Step 3: 抽出 product-jsonld.ts**

新建 `frontend/src/lib/product-jsonld.ts`（从 PDP 页原样迁出 `SITE_URL/absoluteUrl/buildJsonLd`，函数改名 `buildProductJsonLd`，逻辑一字不动）：

```ts
import type { Product, Sku } from "./api";

export const SITE_URL = "https://smallhouse.ph";

export function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

/** Product (+ BreadcrumbList) JSON-LD. Omit fields we cannot populate honestly. */
export function buildProductJsonLd(
  product: Product,
  category: { name: string; slug: string } | null,
): Record<string, unknown> {
  const pageUrl = `${SITE_URL}/products/${product.slug}`;
  const images = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));

  const sellableSkus = product.variants.flatMap((variant) =>
    variant.sku ? [variant.sku] : [],
  );
  const pricedSkus = sellableSkus.filter(
    (sku): sku is Sku => sku.price !== null,
  );

  const offers =
    pricedSkus.length > 0
      ? {
          "@type": "AggregateOffer",
          priceCurrency: "PHP",
          lowPrice: Math.min(...pricedSkus.map((sku) => sku.price as number)),
          highPrice: Math.max(...pricedSkus.map((sku) => sku.price as number)),
          offerCount: pricedSkus.length,
          availability: sellableSkus.some((sku) => sku.availableInventory > 0)
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          url: pageUrl,
        }
      : undefined;

  // Aggregate ratings only exist when visible reviews exist; inventing one
  // would be fake-review markup.
  const aggregateRating =
    product.reviewCount > 0 && product.ratingAverage !== null
      ? {
          "@type": "AggregateRating",
          ratingValue: product.ratingAverage,
          reviewCount: product.reviewCount,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined;

  const productLd: Record<string, unknown> = {
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: images.length > 0 ? images : undefined,
    sku: sellableSkus[0]?.skuCode,
    brand: { "@type": "Brand", name: "Small House" },
    category: category?.name,
    offers,
    aggregateRating,
  };

  const crumbs = [
    { name: "Home", url: SITE_URL },
    ...(category ? [{ name: category.name, url: `${SITE_URL}/categories/${category.slug}` }] : []),
    { name: product.name, url: pageUrl },
  ];
  const breadcrumbLd = {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };

  return { "@context": "https://schema.org", "@graph": [productLd, breadcrumbLd] };
}
```

- [ ] **Step 4: PdpClient 加两个可选 props（精确 Edit）**

`frontend/src/components/product/PdpClient.tsx`：

1. import 行之后加类型导入：

```ts
import { useEffect, useMemo, useState } from "react";
```

改为：

```ts
import { useEffect, useMemo, useState, type ReactNode } from "react";
```

2. 组件签名：

```tsx
export function PdpClient({
  product,
  category,
  delivery,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
}) {
```

改为：

```tsx
export function PdpClient({
  product,
  category,
  delivery,
  productPath,
  promoSlot,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  /** Base path for ?variant= sync; LP pages pass /lp/<slug>, PDP defaults to /products/<slug>. */
  productPath?: string;
  /** Optional promotional block rendered between breadcrumb and H1 (LP only). */
  promoSlot?: ReactNode;
}) {
```

3. variant URL 同步 effect：

```ts
    const url = `/products/${product.slug}?${params.toString()}`;
```

改为：

```ts
    const basePath = productPath ?? `/products/${product.slug}`;
    const url = `${basePath}?${params.toString()}`;
```

同 effect 的依赖数组：

```ts
  }, [selectedVariantId, urlVariant, initialVariantId, variants, product.slug, router]);
```

改为：

```ts
  }, [selectedVariantId, urlVariant, initialVariantId, variants, productPath, router]);
```

（默认路径仍由 `product.slug` 推导，PDP 行为不变；eslint exhaustive-deps 以 productPath 为准。）

4. 促销插槽：在面包屑 `</nav>` 与 `{/* Name row ... */}` 注释之间插入：

```tsx
          </nav>

          {promoSlot}

          {/* Name row; quick-add glyph replaces the wishlist heart on mobile */}
```

- [ ] **Step 5: 新建 PdpView 服务端组件**

`frontend/src/components/product/PdpView.tsx`（JSX 从 PDP page 原样迁入，新增 productPath/promoSlot 透传）：

```tsx
import { Suspense, type ReactNode } from "react";
import { PdpClient } from "./PdpClient";
import { PdpInfoSections } from "./PdpInfoSections";
import { ProductCard } from "./ProductCard";
import { ReviewSection } from "./ReviewSection";
import { TrustBar } from "@/components/ui/TrustBar";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import type { Product } from "@/lib/api";

/**
 * Shared PDP body for both /products/[slug] and /lp/[slug]. The LP route
 * supplies a merged product (overridden name/images) and optional promoSlot;
 * everything else (reviews, specs, price, related) is the shared product.
 */
export function PdpView({
  product,
  category,
  delivery,
  related,
  jsonLd,
  promoSlot,
  productPath,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  related: Product[];
  jsonLd: unknown;
  promoSlot?: ReactNode;
  productPath?: string;
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 pb-24 sm:px-6 md:pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // Escape "<" as the JSON escape so admin-authored strings cannot
          // break out of the script tag; JSON parsers still read it as "<".
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Suspense fallback={null}>
        {/* key remounts the island per product so in-app PDP→PDP navigation
            cannot carry the previous product selected variant into state/URL. */}
        <PdpClient
          key={product.id}
          product={product}
          category={category}
          delivery={delivery}
          productPath={productPath}
          promoSlot={promoSlot}
        />
      </Suspense>

      {/* Desktop section anchors; the 64px offset clears the sticky header. */}
      <nav
        aria-label="Product sections"
        className="sticky top-16 z-20 mt-10 hidden gap-6 border-b border-border bg-background/95 py-3 text-sm font-semibold backdrop-blur lg:flex"
      >
        {product.description && (
          <a href="#details" className="text-ink-secondary hover:text-cta">Details</a>
        )}
        <a href="#shipping-faq" className="text-ink-secondary hover:text-cta">Delivery &amp; FAQs</a>
        <a href="#reviews" className="text-ink-secondary hover:text-cta">Reviews</a>
      </nav>

      <section className="mt-12 flex flex-col gap-8 lg:mt-8">
        {product.description && (
          <div id="details" className="scroll-mt-28 rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
            <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
              {product.description}
            </p>
          </div>
        )}
        <PdpInfoSections />
        <ReviewSection product={product} />
        <TrustBar />
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-6 text-2xl font-semibold text-ink">You May Also Like</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: PDP page 瘦身（整文件替换）**

`frontend/src/app/(storefront)/products/[slug]/page.tsx` 全文替换为：

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";

export const revalidate = 120;

async function fetchProduct(slug: string): Promise<Product | null> {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/products/${slug}`), {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as Product;
  } catch {
    return null;
  }
}

export async function fetchCategoryInfo(
  categoryId: string,
): Promise<{ name: string; slug: string } | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as Category[];
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === categoryId) return { name: node.name, slug: node.slug };
      stack.push(...node.children);
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) return { title: "Product not found" };

  const description = product.description ?? undefined;
  const images = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));

  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      url: `/products/${product.slug}`,
      type: "website",
      images: images.length > 0 ? images : undefined,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title: product.name,
      description,
      images: images.length > 0 ? images : undefined,
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) notFound();

  const [category, relatedRes] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate } },
    ).catch(() => null),
  ]);

  let related: Product[] = [];
  if (relatedRes?.ok) {
    try {
      related = ((await relatedRes.json()) as Paged<Product>).items.filter(
        (item) => item.id !== product.id,
      );
    } catch {
      related = [];
    }
  }

  return (
    <PdpView
      product={product}
      category={category}
      delivery={deliveryWindows()}
      related={related}
      jsonLd={buildProductJsonLd(product, category)}
    />
  );
}
```

注意：`fetchCategoryInfo` 改为 **导出**（Step 7 的 LP 页面直接 import 复用，避免重复 DFS 代码）。

- [ ] **Step 7: LandingViewTracker 小岛**

`frontend/src/components/product/LandingViewTracker.tsx`：

```tsx
"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import {
  LANDING_VISIT_SESSION_KEY,
  persistLandingPage,
} from "@/lib/tracking";

/**
 * Mounts only on /lp/<slug>. Persists the LP id for checkout attribution
 * (last LP wins) and fires the idempotent session-scoped view beacon.
 * StrictMode double-invocation is guarded by the fired ref and, on the
 * server, by the (landingPageId, visitKey) unique constraint.
 */
export function LandingViewTracker({
  landingPageId,
  slug,
}: {
  landingPageId: string;
  slug: string;
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    persistLandingPage(landingPageId);

    let visitKey = window.sessionStorage.getItem(LANDING_VISIT_SESSION_KEY);
    if (!visitKey) {
      visitKey = crypto.randomUUID();
      window.sessionStorage.setItem(LANDING_VISIT_SESSION_KEY, visitKey);
    }
    void api.recordLandingPageView(slug, visitKey).catch(() => {
      /* best-effort: never block the page on analytics */
    });
  }, [landingPageId, slug]);

  return null;
}
```

- [ ] **Step 8: 新建 LP 路由页**

`frontend/src/app/(storefront)/lp/[slug]/page.tsx`：

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingViewTracker } from "@/components/product/LandingViewTracker";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import {
  serverApiUrl,
  type LandingPageComposite,
  type Paged,
  type Product,
  type ProductImage,
} from "@/lib/api";
// One directory up from the lp route tree: reuse the PDP data helpers.
import { fetchCategoryInfo } from "../../products/[slug]/page";

export const revalidate = 120;

async function fetchLandingPage(slug: string): Promise<LandingPageComposite | null> {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/lp/${slug}`), {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as LandingPageComposite;
  } catch {
    return null;
  }
}

// Only visible H1/name and gallery are overridden; every shared field
// (reviews, SKUs, price, stock, specs) stays sourced from the real product.
function applyLandingOverrides(data: LandingPageComposite): Product {
  const { landingPage: lp, product } = data;
  const images: ProductImage[] =
    lp.imagesOverride && lp.imagesOverride.length > 0
      ? lp.imagesOverride.map((image, index) => ({
          id: `lp-${lp.id}-img-${index}`,
          url: image.url,
          altText: image.altText ?? null,
          sortOrder: index,
        }))
      : product.images;
  const name = lp.titleOverride?.trim() ? lp.titleOverride.trim() : product.name;
  return { ...product, name, images };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchLandingPage(slug);
  if (!data) return { title: "Product not found" };

  const merged = applyLandingOverrides(data);
  const description = data.landingPage.seoDescription ?? merged.description ?? undefined;
  const images = [...merged.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));
  const title = data.landingPage.seoTitle ?? merged.name;

  return {
    title,
    description,
    // LPs are marketing duplicates: canonical always points at the real PDP.
    alternates: { canonical: `/products/${data.product.slug}` },
    openGraph: {
      title,
      description,
      url: `/products/${data.product.slug}`,
      type: "website",
      images: images.length > 0 ? images : undefined,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images: images.length > 0 ? images : undefined,
    },
  };
}

export default async function LandingPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchLandingPage(slug);
  if (!data) notFound();

  const product = applyLandingOverrides(data);
  const lp = data.landingPage;

  const [category, relatedRes] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate } },
    ).catch(() => null),
  ]);

  let related: Product[] = [];
  if (relatedRes?.ok) {
    try {
      related = ((await relatedRes.json()) as Paged<Product>).items.filter(
        (item) => item.id !== product.id,
      );
    } catch {
      related = [];
    }
  }

  const promoSlot =
    lp.promoEnabled && lp.promoHeadline ? (
      <div className="rounded-lg bg-sale px-4 py-3 text-white">
        <p className="text-base font-bold">{lp.promoHeadline}</p>
        {lp.promoSubtext ? <p className="mt-0.5 text-sm opacity-90">{lp.promoSubtext}</p> : null}
      </div>
    ) : null;

  return (
    <>
      <LandingViewTracker landingPageId={lp.id} slug={lp.slug} />
      {/* Real name/slug/images for structured data: LP is a marketing duplicate. */}
      <PdpView
        product={product}
        category={category}
        delivery={deliveryWindows()}
        related={related}
        jsonLd={buildProductJsonLd(data.product, category)}
        promoSlot={promoSlot}
        productPath={`/lp/${lp.slug}`}
      />
    </>
  );
}
```

注意验证相对 import 路径：`src/app/(storefront)/lp/[slug]/page.tsx` 到 `src/app/(storefront)/products/[slug]/page.tsx` 为 `../../products/[slug]/page`（route group 目录 `(storefront)` 是真实磁盘目录，参与相对路径）。若 tsc 解析不到，用 `@/app/(storefront)/products/[slug]/page` 风格修正。Next 允许从 page 模块导出/复用函数；如构建器对跨 page import 有警告，把 `fetchCategoryInfo` 下沉到新文件 `src/lib/storefront-category.ts` 并让两个页面都从那里导入（二选一，以 build 结果为准）。

- [ ] **Step 9: 前端门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && npx tsc --noEmit && pnpm lint && pnpm build
```

Expected：全绿；构建输出中同时出现 `/products/[slug]` 与 `/lp/[slug]` 两条路由。

- [ ] **Step 10: 手动冒烟（dev 服务器已在跑，不重启）**

后端先通过 admin API 建一条 LP（或等 Task 9 后台 UI），浏览器验证：

1. `/lp/<slug>` 显示 override 标题/图集，价格/评论/SKU 与 `/products/<real-slug>` 一致；未填 override 的 LP 与 PDP 视觉一致。
2. Network：`/api/v1/storefront/lp/<slug>/view` 返回 204；同标签刷新不产生新 visit 行（后台列表访问量不增）；新标签页访问 +1。
3. 从 LP 加购并下一单（COD），请求体 attribution 含 `landingPageId`（Task 12 统一清理该订单）。
4. 停用 LP / 设未来时间窗 → 页面 404、beacon 无请求体写入。
5. Pixel 配置时 ViewContent 仍触发（无 PIXEL_ID 环境下确认无 JS console error 即可）。

- [ ] **Step 11: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add "small-house-commerce/frontend/src/lib/tracking.ts" "small-house-commerce/frontend/src/lib/api.ts" "small-house-commerce/frontend/src/lib/product-jsonld.ts" "small-house-commerce/frontend/src/components/product/PdpClient.tsx" "small-house-commerce/frontend/src/components/product/PdpView.tsx" "small-house-commerce/frontend/src/components/product/LandingViewTracker.tsx" "small-house-commerce/frontend/src/app/(storefront)/products/[slug]/page.tsx" "small-house-commerce/frontend/src/app/(storefront)/lp/[slug]/page.tsx" && git commit -m "feat(storefront): /lp/[slug] landing route with shared PDP body and view tracking"
```

## Task 9: 后台 Single Pages 全局页（指标表格 + 筛选 + 批量改标题 + 编辑弹窗）

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`（LP/批量评论/presign 类型与方法，一次加齐供 Task 10/11 用）
- Create: `frontend/src/app/admin/(shell)/single-pages/landing-page-form.tsx`
- Create: `frontend/src/app/admin/(shell)/single-pages/page.tsx`
- Modify: `frontend/src/components/admin/AdminShell.tsx`（导航项）
- Modify: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`（落地页入口）

**Interfaces:**
- Consumes: Task 3/4 admin 与 storefront 接口；`useAdminAuth().hasPermission`；admin 原语 `Dialog/Field/Select/TextInput/Textarea/Button/Badge/Pagination/PageHeader/EmptyState/TableSkeleton/inputCls`；`adminApi.listProducts({search,page,pageSize})` 做产品候选。
- Produces: `/admin/single-pages`（导航名 **Single Pages**，PRODUCT_MANAGE）；列：勾选、单页标题（可排序）、产品型号、FB目录编号、页面链接（复制/打开）、访问量、订单、转化率、生效状态、修改时间、编辑笔。

- [ ] **Step 1: admin-api 类型与方法**

`frontend/src/lib/admin-api.ts`：在 collections 区块之后（`setCollectionProducts` 之后、对象结束 `};` 之前）加：

```ts
  // --- product landing pages ("Single Pages") -----------------------------
  listLandingPages: (p: {
    search?: string;
    status?: LandingStatus;
    effectiveStatus?: LandingEffectiveStatus;
    productId?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: "updatedAt" | "title";
    sortDir?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }): Promise<Paged<AdminLandingPageRow>> =>
    adminAuthedFetch<Paged<AdminLandingPageRow>>(
      `/api/v1/admin/landing-pages${buildQuery({
        search: p.search,
        status: p.status,
        effectiveStatus: p.effectiveStatus,
        productId: p.productId,
        dateFrom: p.dateFrom,
        dateTo: p.dateTo,
        sortBy: p.sortBy,
        sortDir: p.sortDir,
        page: p.page,
        pageSize: p.pageSize,
      })}`,
    ),

  listProductLandingPages: (productId: string): Promise<AdminLandingPageDetail[]> =>
    adminAuthedFetch<AdminLandingPageDetail[]>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/landing-pages`,
    ),

  createLandingPage: (
    productId: string,
    input: LandingPageInput,
  ): Promise<AdminLandingPageDetail> =>
    adminAuthedFetch<AdminLandingPageDetail>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/landing-pages`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  updateLandingPage: (
    id: string,
    input: Partial<LandingPageInput>,
  ): Promise<AdminLandingPageDetail> =>
    adminAuthedFetch<AdminLandingPageDetail>(
      `/api/v1/admin/landing-pages/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  deleteLandingPage: (id: string): Promise<void> =>
    adminAuthedFetch<void>(`/api/v1/admin/landing-pages/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  bulkTitleLandingPages: (
    ids: string[],
    titleOverride: string,
  ): Promise<{ updated: number }> =>
    adminAuthedFetch<{ updated: number }>("/api/v1/admin/landing-pages/bulk-title", {
      method: "POST",
      body: JSON.stringify({ ids, titleOverride }),
    }),

  batchCreateReviews: (
    productId: string,
    items: BatchReviewInput[],
  ): Promise<{ created: number }> =>
    adminAuthedFetch<{ created: number }>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/reviews/batch`,
      { method: "POST", body: JSON.stringify({ items }) },
    ),

  presignUpload: (
    contentType: string,
    fileName: string,
  ): Promise<PresignUploadResult> =>
    adminAuthedFetch<PresignUploadResult>("/api/v1/admin/uploads/presign", {
      method: "POST",
      body: JSON.stringify({ contentType, fileName }),
    }),
```

同文件类型区（reviews 类型附近）加：

```ts
// --- landing pages -----------------------------------------------------------
export type LandingStatus = "ACTIVE" | "DISABLED";
export type LandingEffectiveStatus = "LIVE" | "SCHEDULED" | "ENDED" | "DISABLED";

export interface AdminLandingPageRow {
  id: string;
  name: string;
  adCode: string | null;
  slug: string;
  productId: string;
  productName: string;
  titleOverride: string | null;
  status: LandingStatus;
  effectiveStatus: LandingEffectiveStatus;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  updatedAt: string;
  views: number;
  orders: number;
  conversionRate: number;
}

export interface LandingImageOverrideInput {
  url: string;
  altText?: string | null;
}

export interface AdminLandingPageDetail extends AdminLandingPageRow {
  imagesOverride: LandingImageOverrideInput[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
  createdAt: string;
}

export interface LandingPageInput {
  name: string;
  slug?: string;
  titleOverride?: string | null;
  adCode?: string | null;
  imagesOverride?: LandingImageOverrideInput[] | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  promoEnabled?: boolean;
  promoHeadline?: string | null;
  promoSubtext?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: LandingStatus;
  sortOrder?: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export interface BatchReviewInput {
  authorName: string;
  location?: string | null;
  rating: number;
  title?: string | null;
  comment: string;
  photos?: string[];
  isVisible?: boolean;
}
```

- [ ] **Step 2: 表单组件（含产品选择器、中文提示、校验/转换）**

`frontend/src/app/admin/(shell)/single-pages/landing-page-form.tsx`：

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Textarea } from "@/components/admin/Field";
import {
  adminApi,
  type AdminLandingPageDetail,
  type AdminProduct,
  type LandingImageOverrideInput,
  type LandingPageInput,
  type LandingStatus,
} from "@/lib/admin-api";

export interface LandingFormValue {
  name: string;
  slug: string;
  adCode: string;
  titleOverride: string;
  images: LandingImageOverrideInput[];
  seoTitle: string;
  seoDescription: string;
  promoEnabled: boolean;
  promoHeadline: string;
  promoSubtext: string;
  startAt: string; // datetime-local
  endAt: string;
  status: LandingStatus;
  sortOrder: string;
}

export const emptyLandingForm: LandingFormValue = {
  name: "",
  slug: "",
  adCode: "",
  titleOverride: "",
  images: [],
  seoTitle: "",
  seoDescription: "",
  promoEnabled: false,
  promoHeadline: "",
  promoSubtext: "",
  startAt: "",
  endAt: "",
  status: "ACTIVE",
  sortOrder: "0",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function landingFormFromDetail(detail: AdminLandingPageDetail): LandingFormValue {
  return {
    name: detail.name,
    slug: detail.slug,
    adCode: detail.adCode ?? "",
    titleOverride: detail.titleOverride ?? "",
    images: detail.imagesOverride ?? [],
    seoTitle: detail.seoTitle ?? "",
    seoDescription: detail.seoDescription ?? "",
    promoEnabled: detail.promoEnabled,
    promoHeadline: detail.promoHeadline ?? "",
    promoSubtext: detail.promoSubtext ?? "",
    startAt: toLocalInput(detail.startAt),
    endAt: toLocalInput(detail.endAt),
    status: detail.status,
    sortOrder: String(detail.sortOrder),
  };
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateLandingForm(
  form: LandingFormValue,
  isCreate: boolean,
): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("内部名称必填");
  if (form.name.trim().length > 120) errors.push("内部名称最多 120 字");
  if (isCreate) {
    if (!form.slug.trim()) errors.push("Slug（链接标识）必填");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim()))
      errors.push("Slug 只能用小写字母、数字、连字符，且不能以连字符开头/结尾");
  }
  if (form.adCode.trim().length > 64) errors.push("FB 目录编号最多 64 字");
  if (form.titleOverride.trim().length > 200) errors.push("标题覆盖最多 200 字");
  if (form.images.length > 10) errors.push("覆盖图片最多 10 张");
  for (const [i, image] of form.images.entries()) {
    if (!/^https?:\/\/.+/.test(image.url)) errors.push(`第 ${i + 1} 张图片 URL 不合法`);
  }
  if (form.promoEnabled && !form.promoHeadline.trim())
    errors.push("开启促销块时必须填写促销标题");
  if (
    form.startAt &&
    form.endAt &&
    new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()
  )
    errors.push("结束时间必须晚于开始时间");
  if (!Number.isInteger(Number(form.sortOrder)) || Number(form.sortOrder) < 0)
    errors.push("Sort 必须是不小于 0 的整数");
  return errors;
}

export function toLandingInput(form: LandingFormValue): LandingPageInput {
  return {
    name: form.name.trim(),
    slug: form.slug.trim(),
    adCode: form.adCode.trim() || null,
    titleOverride: form.titleOverride.trim() || null,
    imagesOverride: form.images.length
      ? form.images.map((image) => ({ url: image.url, altText: image.altText ?? null }))
      : null,
    seoTitle: form.seoTitle.trim() || null,
    seoDescription: form.seoDescription.trim() || null,
    promoEnabled: form.promoEnabled,
    promoHeadline: form.promoHeadline.trim() || null,
    promoSubtext: form.promoSubtext.trim() || null,
    startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
    endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
    status: form.status,
    sortOrder: Number(form.sortOrder) || 0,
  };
}

const REMOVE_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-sm text-ink-muted hover:border-sale hover:text-sale";

export function LandingPageForm({
  mode,
  initial,
  lockedProduct,
  pending,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: LandingFormValue;
  lockedProduct?: { id: string; name: string } | null;
  pending: boolean;
  onSubmit: (productId: string, input: LandingPageInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<LandingFormValue>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [productId, setProductId] = useState<string | null>(lockedProduct?.id ?? null);
  const [productName, setProductName] = useState<string>(lockedProduct?.name ?? "");

  const set = <K extends keyof LandingFormValue>(key: K, value: LandingFormValue[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function runSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const result = await adminApi.listProducts({ search: search.trim(), page: 1, pageSize: 8 });
      setCandidates(result.items);
    } finally {
      setSearching(false);
    }
  }

  function submit() {
    const next = validateLandingForm(form, mode === "create");
    if (!productId) next.push("请先选择所属产品");
    if (next.length > 0) {
      setErrors(next);
      return;
    }
    onSubmit(productId as string, toLandingInput(form));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-primary-light/40 p-3 text-xs leading-relaxed text-ink-secondary">
        独立 URL、共享 SKU/库存/评论、停用或时间窗外链接 404。
      </p>

      {errors.length > 0 ? (
        <ul className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-xs text-red-700" role="alert">
          {errors.map((error) => (
            <li key={error}>• {error}</li>
          ))}
        </ul>
      ) : null}

      {mode === "create" ? (
        <Field label="所属产品">
          {productId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
              <span className="font-medium text-ink">{productName}</span>
              <button
                type="button"
                className="text-xs font-semibold text-cta hover:underline"
                onClick={() => {
                  setProductId(null);
                  setProductName("");
                }}
              >
                更换
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <TextInput
                  value={search}
                  placeholder="按产品名搜索"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                />
                <Button type="button" variant="secondary" size="md" onClick={() => void runSearch()}>
                  {searching ? "搜索中…" : "搜索"}
                </Button>
              </div>
              {candidates.length > 0 ? (
                <ul className="rounded-lg border border-border">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-primary-light/40"
                        onClick={() => {
                          setProductId(candidate.id);
                          setProductName(candidate.name);
                          setCandidates([]);
                        }}
                      >
                        {candidate.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Field>
      ) : (
        <Field label="所属产品">
          <p className="text-sm font-medium text-ink">{productName}</p>
        </Field>
      )}

      <Field label="内部名称" hint="内部名称，仅后台显示，如：优化师A-首图版、圣诞促销版。">
        <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <Field
        label="FB目录编号"
        hint="选填。FB 目录编号 / 广告编号，仅用于后台对照投放。"
      >
        <TextInput value={form.adCode} onChange={(e) => set("adCode", e.target.value)} />
      </Field>

      <Field
        label="Slug（链接标识）"
        hint="链接标识，保存后不要修改；只能小写字母、数字、连字符。中文名请手动填英文，或先填英文名用「生成」。"
      >
        <div className="flex gap-2">
          <TextInput
            value={form.slug}
            placeholder="os-chair-xmas"
            disabled={mode === "edit"}
            onChange={(e) => set("slug", e.target.value)}
          />
          {mode === "create" ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => set("slug", slugifyName(form.name))}
            >
              生成
            </Button>
          ) : null}
        </div>
      </Field>

      <Field label="标题覆盖" hint="选填。覆盖页面 H1 与标题；留空则使用产品名称。">
        <TextInput
          value={form.titleOverride}
          onChange={(e) => set("titleOverride", e.target.value)}
        />
      </Field>

      <Field
        label="图片覆盖"
        hint="选填。留空继承产品主图；建议 4–6 张，顺序即展示顺序。"
      >
        <div className="flex flex-col gap-2">
          {form.images.map((image, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextInput
                aria-label={`第 ${i + 1} 张图片 URL`}
                placeholder="https://…"
                value={image.url}
                onChange={(e) =>
                  set(
                    "images",
                    form.images.map((item, j) => (j === i ? { ...item, url: e.target.value } : item)),
                  )
                }
              />
              <TextInput
                aria-label={`第 ${i + 1} 张图片 alt 文本`}
                placeholder="alt（可空）"
                value={image.altText ?? ""}
                onChange={(e) =>
                  set(
                    "images",
                    form.images.map((item, j) => (j === i ? { ...item, altText: e.target.value } : item)),
                  )
                }
              />
              <button
                type="button"
                aria-label={`移除第 ${i + 1} 张图片`}
                className={REMOVE_BTN}
                onClick={() => set("images", form.images.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          {form.images.length < 10 ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="self-start"
              onClick={() => set("images", [...form.images, { url: "", altText: "" }])}
            >
              添加覆盖图片
            </Button>
          ) : null}
        </div>
      </Field>

      <div className="rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={form.promoEnabled}
            onChange={(e) => set("promoEnabled", e.target.checked)}
          />
          启用促销标题块（显示在页面 H1 上方）
        </label>
        {form.promoEnabled ? (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="促销标题" hint="选填块内必填。只写真实活动文案，不要编造折扣或倒计时。">
              <TextInput
                value={form.promoHeadline}
                onChange={(e) => set("promoHeadline", e.target.value)}
              />
            </Field>
            <Field label="促销副标题">
              <TextInput
                value={form.promoSubtext}
                onChange={(e) => set("promoSubtext", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="开始时间" hint="选填。未开始前链接 404。">
          <TextInput
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => set("startAt", e.target.value)}
          />
        </Field>
        <Field label="结束时间" hint="选填。结束后链接 404。">
          <TextInput
            type="datetime-local"
            value={form.endAt}
            onChange={(e) => set("endAt", e.target.value)}
          />
        </Field>
      </div>

      <Field label="SEO 标题" hint="选填。留空时使用覆盖标题（或产品名）。">
        <TextInput value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
      </Field>
      <Field label="SEO 描述" hint="选填。留空时使用产品描述。">
        <Textarea
          rows={3}
          value={form.seoDescription}
          onChange={(e) => set("seoDescription", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="状态">
          <select
            aria-label="状态"
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink"
            value={form.status}
            onChange={(e) => set("status", e.target.value as LandingStatus)}
          >
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </select>
        </Field>
        <Field label="Sort" hint="数字越小越靠前（同产品列表）。">
          <TextInput
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-2 flex justify-end gap-3">
        <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        <Button type="button" size="md" onClick={submit} disabled={pending}>
          {pending ? "保存中…" : mode === "create" ? "创建" : "保存"}
        </Button>
      </div>
    </div>
  );
}
```

（Task 10 会把图片覆盖行的 URL `TextInput` 换成 `ImageUrlInput`，本任务先按纯 URL 输入完成。）

- [ ] **Step 3: 全局列表页**

`frontend/src/app/admin/(shell)/single-pages/page.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge, type BadgeTone } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import { errorStatus } from "@/lib/admin-auth";
import {
  adminApi,
  type AdminLandingPageRow,
  type LandingEffectiveStatus,
  type LandingPageInput,
  type Paged,
} from "@/lib/admin-api";
import {
  emptyLandingForm,
  landingFormFromDetail,
  LandingPageForm,
  toLandingInput,
  type LandingFormValue,
} from "./landing-page-form";

const PAGE_SIZE = 20;

const EFFECTIVE_TONE: Record<LandingEffectiveStatus, BadgeTone> = {
  LIVE: "green",
  SCHEDULED: "amber",
  ENDED: "neutral",
  DISABLED: "red",
};
const EFFECTIVE_LABEL: Record<LandingEffectiveStatus, string> = {
  LIVE: "进行中",
  SCHEDULED: "未开始",
  ENDED: "已结束",
  DISABLED: "已停用",
};

function formatModified(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function SinglePagesInner() {
  const searchParams = useSearchParams();
  const presetProductId = searchParams.get("productId");
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [rows, setRows] = useState<Paged<AdminLandingPageRow> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"updatedAt" | "title">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [searchInput, setSearchInput] = useState("");
  const [effectiveInput, setEffectiveInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [applied, setApplied] = useState<{
    search?: string;
    effectiveStatus?: LandingEffectiveStatus;
    dateFrom?: string;
    dateTo?: string;
  }>({});

  const [presetProduct, setPresetProduct] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogInitial, setDialogInitial] = useState<LandingFormValue>(emptyLandingForm);
  const [dialogProduct, setDialogProduct] = useState<{ id: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!presetProductId) return;
    let active = true;
    adminApi
      .getProduct(presetProductId)
      .then((product) => {
        if (active) setPresetProduct({ id: product.id, name: product.name });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [presetProductId]);

  const reload = useCallback(async () => {
    setLoadError(null);
    setRows(null);
    try {
      const result = await adminApi.listLandingPages({
        search: applied.search,
        effectiveStatus: applied.effectiveStatus,
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        productId: presetProductId ?? undefined,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(result);
      setSelected((current) => {
        const next = new Set<string>();
        for (const item of result.items) if (current.has(item.id)) next.add(item.id);
        return next;
      });
    } catch (err) {
      setLoadError(
        errorStatus(err) === 403 ? "没有权限查看 Single Pages。" : "加载失败，请刷新重试。",
      );
    }
  }, [applied, sortBy, sortDir, page, presetProductId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pageIds = useMemo(() => rows?.items.map((row) => row.id) ?? [], [rows]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function applyFilters() {
    setPage(1);
    setApplied({
      search: searchInput.trim() || undefined,
      effectiveStatus: (effectiveInput || undefined) as LandingEffectiveStatus | undefined,
      dateFrom: dateFromInput || undefined,
      dateTo: dateToInput || undefined,
    });
  }

  function resetFilters() {
    setSearchInput("");
    setEffectiveInput("");
    setDateFromInput("");
    setDateToInput("");
    setPage(1);
    setApplied({});
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllOnPage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function copyLink(row: AdminLandingPageRow) {
    const url = `${window.location.origin}/lp/${row.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard blocked: open link still works */
    }
  }

  function openCreate() {
    setDialogMode("create");
    setDialogInitial(emptyLandingForm);
    setDialogProduct(presetProduct);
    setEditingId(null);
    setDialogError(null);
    setDialogPending(false);
    setDialogOpen(true);
  }

  async function openEdit(row: AdminLandingPageRow) {
    setDialogMode("edit");
    setDialogError(null);
    setDialogPending(true);
    setDialogOpen(true);
    setEditingId(row.id);
    setDialogProduct({ id: row.productId, name: row.productName });
    try {
      const all = await adminApi.listProductLandingPages(row.productId);
      const detail = all.find((item) => item.id === row.id);
      if (!detail) throw new Error("not found");
      setDialogInitial(landingFormFromDetail(detail));
    } catch {
      setDialogError("加载落地页详情失败，请关闭重试。");
    } finally {
      setDialogPending(false);
    }
  }

  async function handleSubmit(productId: string, input: LandingPageInput) {
    setDialogPending(true);
    setDialogError(null);
    try {
      if (dialogMode === "create") {
        await adminApi.createLandingPage(productId, input);
      } else if (editingId) {
        const { slug: _slug, ...patch } = toLandingInput(dialogInitial);
        void _slug;
        await adminApi.updateLandingPage(editingId, { ...patch, ...stripSlug(input) });
      }
      setDialogOpen(false);
      void reload();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "保存失败，请重试。");
    } finally {
      setDialogPending(false);
    }
  }

  async function submitBulk() {
    setBulkError(null);
    const title = bulkTitle.trim();
    if (!title || title.length > 200) {
      setBulkError("批量标题为 1–200 字。");
      return;
    }
    setBulkPending(true);
    try {
      const ids = [...selected];
      const result = await adminApi.bulkTitleLandingPages(ids, title);
      // Optimistic update so the table reacts immediately; reload reconciles.
      setRows((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                selected.has(row.id) ? { ...row, titleOverride: title } : row,
              ),
            }
          : current,
      );
      setBulkSuccess(`已更新 ${result.updated} 个页面的标题。`);
      setBulkOpen(false);
      setSelected(new Set());
      void reload();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "批量更新失败，请重试。");
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Single Pages"
        count={rows?.total}
        actions={canManage ? <Button size="md" onClick={openCreate}>新建落地页</Button> : undefined}
      />

      <p className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-ink-secondary">
        每个优化师/广告组一个独立链接；访问量按会话去重；转化率 = 订单数 ÷ 访问会话数（取消/拒单不计），仅供投放参考；批量标题用于「圣诞促销」这类统一换主题，不影响网址、库存与评论。
      </p>

      {presetProduct ? (
        <p className="mt-3 text-sm text-ink-secondary">
          当前只看产品：<span className="font-semibold text-ink">{presetProduct.name}</span>
          {" · "}
          <Link href="/admin/single-pages" className="text-cta hover:underline">
            查看全部
          </Link>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="搜索（标题 / 内部名 / FB编号 / 产品名）">
          <TextInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
          />
        </Field>
        <Field label="生效状态">
          <Select
            value={effectiveInput}
            onChange={(e) => setEffectiveInput(e.target.value)}
          >
            <option value="">全部</option>
            <option value="LIVE">进行中</option>
            <option value="SCHEDULED">未开始</option>
            <option value="ENDED">已结束</option>
            <option value="DISABLED">已停用</option>
          </Select>
        </Field>
        <Field label="修改起">
          <TextInput type="date" value={dateFromInput} onChange={(e) => setDateFromInput(e.target.value)} />
        </Field>
        <Field label="修改止">
          <TextInput type="date" value={dateToInput} onChange={(e) => setDateToInput(e.target.value)} />
        </Field>
        <Button variant="secondary" size="md" onClick={applyFilters}>
          筛选
        </Button>
        <Button variant="text" size="md" onClick={resetFilters}>
          重置
        </Button>
      </div>

      {bulkSuccess ? (
        <p className="mt-3 text-sm font-medium text-ink-secondary" role="status">
          {bulkSuccess}
        </p>
      ) : null}

      {selected.size > 0 && canManage ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="text-sm font-semibold text-ink">已选 {selected.size} 项</span>
          <Button size="md" variant="secondary" onClick={() => { setBulkTitle(""); setBulkError(null); setBulkSuccess(null); setBulkOpen(true); }}>
            批量改标题
          </Button>
          <Button variant="text" size="md" onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-ink">{loadError}</p>
            <Button variant="secondary" size="md" onClick={() => void reload()} className="mt-4">
              Retry
            </Button>
          </div>
        ) : rows === null ? (
          <TableSkeleton rows={6} cols={10} />
        ) : rows.items.length === 0 ? (
          <EmptyState
            title="还没有落地页。"
            hint="给产品创建第一个独立链接，用于不同优化师或广告组的投放页面。"
            action={canManage ? <Button size="md" onClick={openCreate}>新建落地页</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="全选本页"
                      checked={allOnPageSelected}
                      disabled={!canManage}
                      onChange={(e) => toggleAllOnPage(e.target.checked)}
                    />
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-cta"
                      onClick={() => {
                        if (sortBy !== "title") {
                          setSortBy("title");
                          setSortDir("asc");
                        } else {
                          setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
                        }
                        setPage(1);
                      }}
                    >
                      单页标题
                      <span aria-hidden>{sortBy === "title" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                  <th className="px-3 py-3">产品型号</th>
                  <th className="px-3 py-3">FB目录编号</th>
                  <th className="px-3 py-3">页面链接</th>
                  <th className="px-3 py-3 text-right">访问量</th>
                  <th className="px-3 py-3 text-right">订单</th>
                  <th className="px-3 py-3 text-right">转化率</th>
                  <th className="px-3 py-3">生效状态</th>
                  <th className="px-3 py-3">修改时间</th>
                  <th className="px-3 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.items.map((row) => (
                  <tr key={row.id} className="border-b border-border align-middle last:border-0">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${row.titleOverride || row.name}`}
                        checked={selected.has(row.id)}
                        disabled={!canManage}
                        onChange={(e) => toggleOne(row.id, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{row.titleOverride || row.name}</p>
                      <p className="text-xs text-ink-muted">{row.name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/products/${row.productId}/edit`}
                        className="text-ink-secondary hover:text-cta hover:underline"
                      >
                        {row.productName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-secondary">{row.adCode || "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Link
                          href={`/lp/${row.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cta hover:underline"
                        >
                          /lp/{row.slug}
                        </Link>
                        <button
                          type="button"
                          className="text-xs text-ink-muted hover:text-cta"
                          onClick={() => void copyLink(row)}
                        >
                          {copiedId === row.id ? "已复制" : "复制"}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-ink">{row.views}</td>
                    <td className="px-3 py-3 text-right font-medium text-ink">{row.orders}</td>
                    <td className="px-3 py-3 text-right font-medium text-ink">
                      {(row.conversionRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={EFFECTIVE_TONE[row.effectiveStatus]}>
                        {EFFECTIVE_LABEL[row.effectiveStatus]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-muted">
                      {formatModified(row.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={`编辑 ${row.titleOverride || row.name}`}
                          className="text-base text-ink-secondary hover:text-cta"
                          onClick={() => void openEdit(row)}
                        >
                          ✎
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows && rows.total > PAGE_SIZE ? (
        <div className="mt-6">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={rows.total}
            onChange={setPage}
          />
        </div>
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={dialogMode === "create" ? "新建落地页" : "编辑落地页"}
      >
        {dialogPending ? (
          <p className="py-8 text-center text-sm text-ink-muted">加载中…</p>
        ) : (
          <>
            {dialogError ? (
              <p className="mb-3 rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
                {dialogError}
              </p>
            ) : null}
            <LandingPageForm
              key={`${dialogMode}-${editingId ?? "new"}-${dialogOpen}`}
              mode={dialogMode}
              initial={dialogInitial}
              lockedProduct={dialogProduct}
              pending={dialogPending}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
            />
          </>
        )}
      </Dialog>

      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} title="批量修改标题">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-secondary">
            将选中的 {selected.size} 个页面标题统一覆盖为同一文案（例如「圣诞促销」活动主题），不影响网址、库存与评论。
          </p>
          {bulkError ? (
            <p className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700" role="alert">
              {bulkError}
            </p>
          ) : null}
          <Field label="新的统一标题">
            <TextInput value={bulkTitle} maxLength={200} onChange={(e) => setBulkTitle(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => setBulkOpen(false)} disabled={bulkPending}>
              取消
            </Button>
            <Button size="md" onClick={() => void submitBulk()} disabled={bulkPending}>
              {bulkPending ? "更新中…" : `更新 ${selected.size} 项`}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function stripSlug(input: LandingPageInput): Partial<LandingPageInput> {
  const { slug, ...rest } = input;
  void slug;
  return rest;
}

export default function SinglePagesPage() {
  // useSearchParams must sit under Suspense for the static-build boundary.
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={10} />}>
      <SinglePagesInner />
    </Suspense>
  );
}
```

注意清理 `handleSubmit`：上面 `const { slug: _slug, ...patch } = toLandingInput(dialogInitial)` 是废行，正确实现为

```ts
      } else if (editingId) {
        await adminApi.updateLandingPage(editingId, stripSlug(input));
      }
```

（写代码时用这个最终版本，删除 `_slug`/`patch` 临时行。）若 `Select` 不接受裸 onChange 签名或 `TableSkeleton` 的 props 名不同，以 reviews/collections 页现有用法为准对齐。

- [ ] **Step 4: 主导航加入口**

`frontend/src/components/admin/AdminShell.tsx`，在：

```ts
  { href: "/admin/collections", label: "Collections", permission: "PRODUCT_MANAGE" },
```

之后加：

```ts
  { href: "/admin/single-pages", label: "Single Pages", permission: "PRODUCT_MANAGE" },
```

- [ ] **Step 5: 产品编辑页加「落地页 (N)」入口**

`frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`：

1. 顶部 import 区确认已有 `Link`、`useEffect`、`useState`、`adminApi`（该页本就用它们；缺什么补什么）。
2. 组件内在 `product` state 旁加：

```tsx
  const [landingCount, setLandingCount] = useState<number | null>(null);

  useEffect(() => {
    if (!product) return;
    let active = true;
    adminApi
      .listProductLandingPages(product.id)
      .then((rows) => {
        if (active) setLandingCount(rows.length);
      })
      .catch(() => {
        if (active) setLandingCount(null);
      });
    return () => {
      active = false;
    };
  }, [product]);
```

3. 把：

```tsx
      <PageHeader title="Edit product" actions={<BackLink />} />
```

替换为：

```tsx
      <PageHeader
        title="Edit product"
        actions={
          <span className="flex items-center gap-4">
            {product && landingCount !== null ? (
              <Link
                href={`/admin/single-pages?productId=${product.id}`}
                className="text-sm font-semibold text-cta hover:underline"
              >
                落地页 ({landingCount})
              </Link>
            ) : null}
            <BackLink />
          </span>
        }
      />
```

（该页有多个 loading/error 分支也渲染 PageHeader 但没有 product；只替换 product 已加载的那一个，即文件中唯一 `title="Edit product"` 的 PageHeader。）

- [ ] **Step 6: 前端门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && npx tsc --noEmit && pnpm lint && pnpm build
```

Expected：全绿；构建输出出现 `/admin/single-pages`。

- [ ] **Step 7: 手动冒烟（不重启服务器）**

1. 用 dev@smallhouse.test 登录后台，导航出现 Single Pages（仅 PRODUCT_MANAGE 可见）。
2. 从产品编辑页点「落地页 (0)」→ 列表带产品预设；新建两条 LP（一条带标题/图片/促销块/未来时间窗），保存后列表可见、复制链接可用、笔按钮可编辑。
3. 勾两条 → 批量改标题 → 两列表题即时变化、刷新后保持；后端只发了一次请求（Network 确认）。
4. 筛选生效状态/日期/搜索词生效；标题列排序 asc/desc 切换。
5. 数据验证：空名称、坏 slug、促销块无标题、结束早于开始均被拦下并显示中文错误。

- [ ] **Step 8: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add "small-house-commerce/frontend/src/lib/admin-api.ts" "small-house-commerce/frontend/src/app/admin/(shell)/single-pages" "small-house-commerce/frontend/src/components/admin/AdminShell.tsx" "small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx" && git commit -m "feat(admin): Single Pages screen with metrics, filters and bulk retitle"
```

## Task 10: R2 直传组件 ImageUrlInput + 接入产品图片/覆盖图片/评论图片

**Files:**
- Create: `frontend/src/components/admin/ImageUrlInput.tsx`
- Modify: `frontend/src/components/admin/ProductForm.tsx`（替换“只能填 URL”提示与 URL 输入框）
- Modify: `frontend/src/app/admin/(shell)/single-pages/landing-page-form.tsx`（覆盖图片行）
- Modify: `frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx`（单条评论弹窗照片行）

**Interfaces:**
- Consumes: Task 7 `POST /api/v1/admin/uploads/presign` → `{uploadUrl, publicUrl, key, expiresIn}`；`adminApi.presignUpload(contentType, fileName)`（Task 9 已加）；`inputCls` from `@/components/admin/Field`。
- Produces: 可复用受控组件 `<ImageUrlInput value url onChange disabled />`：URL 输入 + 「上传图片」按钮（隐藏 file input）+ 缩略图；仅 JPG/PNG/WebP、≤8MB、客户端校验；503 显示「图片直传未配置（R2），可直接粘贴图片 URL」。

- [ ] **Step 1: 创建组件**

`frontend/src/components/admin/ImageUrlInput.tsx`：

```tsx
"use client";

import { useRef, useState } from "react";
import { inputCls } from "./Field";

const MAX_BYTES = 8 * 1024 * 1024;

const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Image field for admin forms: paste a public URL, or pick a local file and
 * PUT it straight to Cloudflare R2 via a backend presigned URL (no bytes
 * transit through our API). R2 being unconfigured is normal in dev: the 503
 * surfaces the Chinese fallback telling operators to paste a URL instead.
 */
export function ImageUrlInput({
  id,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  placeholder = "https://…",
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const ext = ACCEPTED_TYPES[file.type];
    if (!ext) {
      setError("仅支持 JPG / PNG / WebP 图片");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("图片不能超过 8MB");
      return;
    }
    setUploading(true);
    try {
      // Lazy import keeps the admin API module out of any non-upload bundle path.
      const { adminApi } = await import("@/lib/admin-api");
      const presign = await adminApi.presignUpload(file.type, file.name || `upload.${ext}`);
      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error("图片上传失败，请重试，或直接粘贴图片 URL");
      }
      onChange(presign.publicUrl);
    } catch (err) {
      // Backend 503 already carries the operator-facing Chinese sentence.
      setError(err instanceof Error && err.message ? err.message : "图片上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only external R2/URL thumbs; no optimizer domain allowlist.
          <img
            src={value}
            alt=""
            className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <input
          id={id}
          aria-label={ariaLabel}
          className={`${inputCls} min-w-0 flex-1`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || uploading}
          autoComplete="off"
        />
        <button
          type="button"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted disabled:border-border"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? "上传中…" : "上传图片"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>
      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: 接入 ProductForm**

`frontend/src/components/admin/ProductForm.tsx`：

1. 顶部 import 区（`TextInput` 等 admin 原语旁）加：

```tsx
import { ImageUrlInput } from "./ImageUrlInput";
```

2. 把 Images Section 的 hint（当前为）

```tsx
          <>
            只能填写图片网址 URL（以 http(s):// 开头），系统暂不支持本地选图上传。图片文件可发给开发放到网站
            <span className="font-mono"> /images/products/ </span>
            目录后取得网址，或使用任意图床链接。Sort 数字最小的是主图；建议 4–6
            张：白底主图、细节、尺寸图、生活场景图，不要带中文水印。
          </>
```

替换为：

```tsx
          <>
            可直接粘贴图片网址，或点「上传图片」从电脑选图（JPG/PNG/WebP，单张不超过
            8MB，直传 Cloudflare R2）。Sort 数字最小的是主图；建议 4–6
            张：白底主图、细节、尺寸图、生活场景图，不要带中文水印。
          </>
```

3. 把图片行里的 URL 输入（`id={`pf-images-${i}-url`}` 的整个 `<TextInput ... />`，含注释与 aria-label）替换为：

```tsx
                  <ImageUrlInput
                    id={`pf-images-${i}-url`}
                    ariaLabel={i === 0 ? undefined : `Image ${i + 1} URL`}
                    value={img.url}
                    onChange={(url) => setImage(i, { url })}
                    disabled={pending}
                  />
```

（保留外层 `Field` 与其 label/error/hint 不动；校验仍由 `validateProductForm` 对 `img.url` 生效。）

- [ ] **Step 3: 接入 LP 覆盖图片行**

`frontend/src/app/admin/(shell)/single-pages/landing-page-form.tsx`：

1. import 加：

```tsx
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
```

2. 把图片覆盖循环中第一张图的 URL `TextInput`（`aria-label={`第 ${i + 1} 张图片 URL`}` 的整个节点）替换为：

```tsx
              <ImageUrlInput
                ariaLabel={`第 ${i + 1} 张图片 URL`}
                value={image.url}
                onChange={(url) =>
                  set(
                    "images",
                    form.images.map((item, j) => (j === i ? { ...item, url } : item)),
                  )
                }
              />
```

（alt 行保持 `TextInput` 不动。）

- [ ] **Step 4: 接入单条评论弹窗照片行**

`frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx`：先读 560–600 行，照片行当前是 URL `TextInput`（值 `photo`、onChange `setPhoto(index, …)`）。import `ImageUrlInput`（路径 `@/components/admin/ImageUrlInput`），把该行的 URL 输入节点替换为：

```tsx
                          <ImageUrlInput
                            ariaLabel={`Review photo ${index + 1} URL`}
                            value={photo}
                            onChange={(url) => setPhoto(index, url)}
                            disabled={pending}
                          />
```

保留外层 Field/label 与「Add photo」「移除」按钮不变；校验逻辑不动。

- [ ] **Step 5: 前端门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && npx tsc --noEmit && pnpm lint && pnpm build
```

Expected：全绿。

- [ ] **Step 6: 手动冒烟**

1. 产品编辑页图片行出现「上传图片」；未配置 R2 时点击任意图片文件 → 红字显示「图片直传未配置（R2），可直接粘贴图片 URL」，输入框仍可粘贴 URL。
2. LP 创建弹窗覆盖图片、评论 Add review 弹窗照片行同样有上传按钮与 URL 回退。
3. 选非图片文件（如 .txt 改名）或 >8MB 文件 → 客户端中文拦截，不发请求。
4. 粘贴 URL 后出现缩略图；清空 URL 缩略图消失。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add "small-house-commerce/frontend/src/components/admin/ImageUrlInput.tsx" "small-house-commerce/frontend/src/components/admin/ProductForm.tsx" "small-house-commerce/frontend/src/app/admin/(shell)/single-pages/landing-page-form.tsx" "small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx" && git commit -m "feat(admin): direct R2 image upload alongside URL input"
```

## Task 11: 评论批量导入弹窗（TSV 粘贴 + 原子导入 + 行级报错）

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`（`BatchLineError` 类型）
- Modify: `frontend/src/lib/admin-auth.ts`（AdminApiError 保留结构化 body）
- Create: `frontend/src/app/admin/(shell)/products/[id]/reviews/batch-import-dialog.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx`（按钮 + 挂载）

**Interfaces:**
- Consumes: Task 6 `POST /api/v1/admin/products/:productId/reviews/batch`，body `{items: BatchReviewInput[]}`；成功 `{created:number}`；失败 400 body `{message:string, errors:{row,field,message}[]}`（整体不入库）。
- Produces: `<BatchImportReviewsDialog productId open onClose onImported />`，TSV 列序：姓名 ⇥ 地区(可空) ⇥ 星级1-5 ⇥ 标题(可空) ⇥ 评论 ⇥ 图片URL(可空，多张用 | 分隔)。

- [ ] **Step 1: AdminApiError 保留结构化错误**

`frontend/src/lib/admin-auth.ts`：

1. `AdminApiError` 改为：

```ts
export class AdminApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.details = details;
  }
}
```

2. `readError` 改为返回 message 和原始 body：

```ts
async function readError(res: Response): Promise<{ message: string; body: unknown }> {
  try {
    const body = (await res.json()) as { message?: string };
    return { message: body.message ?? `Request failed: ${res.status}`, body };
  } catch {
    return { message: `Request failed: ${res.status}`, body: undefined };
  }
}
```

3. 两处 throw（209、265 行）由

```ts
  if (!res.ok) throw new AdminApiError(await readError(res), res.status);
```

改为：

```ts
  if (!res.ok) {
    const error = await readError(res);
    throw new AdminApiError(
      error.message,
      res.status,
      typeof error.body === "object" && error.body !== null && "errors" in error.body
        ? (error.body as { errors: unknown }).errors
        : undefined,
    );
  }
```

（两处缩进按所在函数对齐。）

- [ ] **Step 2: 类型**

`frontend/src/lib/admin-api.ts`，`BatchReviewInput` 旁加：

```ts
export interface BatchLineError {
  row: number;
  field: string;
  message: string;
}
```

- [ ] **Step 3: 批量导入弹窗**

`frontend/src/app/admin/(shell)/products/[id]/reviews/batch-import-dialog.tsx`：

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { AdminApiError } from "@/lib/admin-auth";
import {
  adminApi,
  type BatchLineError,
  type BatchReviewInput,
} from "@/lib/admin-api";

// Column order mirrors the backend createAdminReviewSchema (Task 6).
const FORMAT_HINT =
  "每行一条，列之间用 Tab（制表符，可直接从 Excel/Google Sheets 整列粘贴）：姓名 ⇥ 地区(可空) ⇥ 星级1-5 ⇥ 标题(可空) ⇥ 评论 ⇥ 图片URL(可空，多张用 | 分隔)";
const EXAMPLE_LINE =
  "Maria Santos\tManila\t5\tSturdy shelf\tEasy to assemble and holds our books.\thttps://example.com/a.jpg|https://example.com/b.jpg";

type Parsed =
  | { ok: true; items: BatchReviewInput[] }
  | { ok: false; errors: BatchLineError[] };

function parseBatch(raw: string): Parsed {
  const errors: BatchLineError[] = [];
  const items: BatchReviewInput[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { ok: false, errors: [{ row: 0, field: "(root)", message: "请先粘贴至少一行评论" }] };
  }
  if (lines.length > 100) {
    errors.push({ row: 0, field: "(root)", message: "一次最多导入 100 条" });
    return { ok: false, errors };
  }

  lines.forEach((line, i) => {
    const row = i + 1;
    const cells = line.split("\t");
    if (cells.length < 5 || cells.length > 6) {
      errors.push({ row, field: "(root)", message: `应为 5–6 列（Tab 分隔），实际 ${cells.length} 列` });
      return;
    }
    const [authorName, location, ratingRaw, title, comment, photosRaw] = cells;
    const name = authorName.trim();
    if (!name || name.length > 120)
      errors.push({ row, field: "authorName", message: "姓名必填且不超过 120 字" });
    const locationTrim = location.trim();
    if (locationTrim.length > 120)
      errors.push({ row, field: "location", message: "地区不超过 120 字" });
    const rating = Number(ratingRaw.trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      errors.push({ row, field: "rating", message: "星级必须是 1–5 的整数" });
    const titleTrim = title.trim();
    if (titleTrim.length > 200)
      errors.push({ row, field: "title", message: "标题不超过 200 字" });
    const commentTrim = comment.trim();
    if (!commentTrim || commentTrim.length > 5000)
      errors.push({ row, field: "comment", message: "评论必填且不超过 5000 字" });
    const photos = (photosRaw ?? "")
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (photos.length > 6) {
      errors.push({ row, field: "photos", message: "每条评论最多 6 张图片" });
    } else {
      for (const photo of photos) {
        try {
          new URL(photo);
          if (!/^https?:\/\//.test(photo) || photo.length > 2048) throw new Error("bad");
        } catch {
          errors.push({ row, field: "photos", message: `图片 URL 不合法：${photo}` });
        }
      }
    }
    items.push({
      authorName: name,
      location: locationTrim || undefined,
      rating,
      title: titleTrim || undefined,
      comment: commentTrim,
      photos,
      isVisible: true,
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}

export function BatchImportReviewsDialog({
  productId,
  open,
  onClose,
  onImported,
}: {
  productId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<BatchLineError[] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  const parsed = parseBatch(raw);
  const clientErrors = raw.trim() && !parsed.ok ? parsed.errors : [];

  function close() {
    setRaw("");
    setServerErrors(null);
    setFatal(null);
    setCreated(null);
    onClose();
  }

  async function submit() {
    const result = parseBatch(raw);
    if (!result.ok) {
      setServerErrors(null);
      setFatal(null);
      return; // errors already rendered from clientErrors
    }
    setPending(true);
    setServerErrors(null);
    setFatal(null);
    try {
      const res = await adminApi.batchCreateReviews(productId, result.items);
      setCreated(res.created);
      onImported();
    } catch (err) {
      if (err instanceof AdminApiError && Array.isArray(err.details)) {
        setServerErrors(err.details as BatchLineError[]);
      } else {
        setFatal(err instanceof Error ? err.message : "导入失败，请重试");
      }
    } finally {
      setPending(false);
    }
  }

  const shownErrors = serverErrors ?? clientErrors;

  return (
    <Dialog open={open} onClose={close} title="批量导入评论">
      {created !== null ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink" role="status">
            成功导入 {created} 条评论（默认对顾客可见，可在列表中逐条隐藏）。
          </p>
          <div className="flex justify-end">
            <Button size="md" onClick={close}>
              完成
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-primary-light/40 p-3 text-xs leading-relaxed text-ink-secondary">
            {FORMAT_HINT}
          </p>
          <p className="text-xs text-ink-muted">
            示例（Tab 分隔）：
            <br />
            <span className="font-mono break-all">{EXAMPLE_LINE}</span>
          </p>
          <textarea
            aria-label="批量评论文本（TSV）"
            className="min-h-[240px] w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-ink"
            value={raw}
            placeholder={EXAMPLE_LINE}
            onChange={(e) => setRaw(e.target.value)}
            disabled={pending}
          />
          {shownErrors.length > 0 ? (
            <div
              role="alert"
              className="max-h-48 overflow-y-auto rounded-lg border border-sale/40 bg-sale/5 p-3 text-xs text-red-700"
            >
              <p className="font-semibold">
                {serverErrors
                  ? "有评论行未通过后端校验，未导入任何评论，请修正后重试："
                  : "请先修正以下行："}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {shownErrors.map((error, i) => (
                  <li key={`${error.row}-${error.field}-${i}`}>
                    {error.row > 0 ? `第 ${error.row} 行 · ${error.field}：` : ""}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {fatal ? (
            <p role="alert" className="text-sm text-red-700">
              {fatal}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={close} disabled={pending}>
              取消
            </Button>
            <Button size="md" onClick={() => void submit()} disabled={pending}>
              {pending ? "导入中…" : "导入（全部成功才入库）"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
```

注意：`parseBatch` 在每次 render 对 `raw` 全量重算（最多 100 行 × 6 列，成本可忽略），不使用 useEffect/useMemo 派生错误状态。

- [ ] **Step 4: 评论页加入口与挂载**

`frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx`：

1. import 区加：

```tsx
import { BatchImportReviewsDialog } from "./batch-import-dialog";
```

2. 在 Add/Edit 弹窗状态旁（约 153–157 行 `dialogOpen` 附近）加：

```tsx
  const [batchOpen, setBatchOpen] = useState(false);
```

3. PageHeader 的 actions 中，在 `Back to product` Link 与 `Add review` 按钮之间插入：

```tsx
            {canManage ? (
              <Button variant="secondary" size="md" onClick={() => setBatchOpen(true)}>
                批量导入
              </Button>
            ) : null}
```

4. 在文件末尾 Add/Edit 评论 `</Dialog>`（约 621 行）之后、组件最外层 `</div>` 之前加：

```tsx
      <BatchImportReviewsDialog
        productId={productId}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onImported={reload}
      />
```

（`reload` 是该页已有的 useCallback 刷新函数，与 Retry 按钮用的是同一个；若实际命名不同，以页面中的真实名字为准。）

- [ ] **Step 5: 前端门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && npx tsc --noEmit && pnpm lint && pnpm build
```

Expected：全绿。

- [ ] **Step 6: 手动冒烟（配合 Task 12 清理）**

1. 粘贴 3 行合法 TSV（含一行两张 `|` 分隔图片、一行留空地区/标题/图片）→ 提示成功 3 条，列表刷新可见，source 为后台录入。
2. 故意粘贴坏行（星级 9、少一列、7 张图）→ 客户端红字列出行号/字段，导入按钮请求不发出。
3. 绕过前端的坏数据由后端拒绝时，弹窗显示后端行级错误且列表一条都不多（原子性）。
4. 单条 Add review 弹窗的照片行此时已是 Task 10 的 ImageUrlInput，功能回归一次。

- [ ] **Step 7: Commit**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git add "small-house-commerce/frontend/src/lib/admin-auth.ts" "small-house-commerce/frontend/src/lib/admin-api.ts" "small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/reviews" && git commit -m "feat(admin): TSV batch review import with row-level errors"
```

## Task 12: 全量门禁、端到端冒烟与测试数据清理

**Files:** 无新增；仅运行与清理。

**Interfaces:** 消费 Tasks 1–11 全部成果。

- [ ] **Step 1: 后端全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/backend" && pnpm exec prisma migrate status && pnpm test && npx tsc --noEmit && pnpm lint
```

Expected：migrate status 干净（无 pending/漂移）；vitest 全绿（含 landing/orders/reviews/uploads 新 spec）；tsc、oxlint 零错误。任何 Prisma reset/drift 提示：**STOP，不接受 reset，向用户报告**。

- [ ] **Step 2: 前端全量门禁**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/small-house-commerce/frontend" && npx tsc --noEmit && pnpm lint && pnpm build
```

Expected：零错误；构建路由含 `/lp/[slug]`、`/admin/single-pages`。

- [ ] **Step 3: 端到端冒烟清单（dev 环境，勿重启服务）**

后台（http://localhost:3001/admin，dev@smallhouse.test / dev-admin-12345）：

1. 产品编辑页有「落地页 (N)」；创建 LP A：覆盖标题 + 2 张覆盖图 + 促销块（真实文案）+ 立即生效；LP B：未来开始时间。
2. Single Pages：两行可见，状态分别「进行中」「未开始」徽标颜色正确；复制链接得到绝对 URL；标题列排序、搜索、状态筛选、日期筛选各试一次。
3. 勾选 A/B 批量改标题「圣诞促销专题」→ 一次 POST，两列即时更新、刷新保持。
4. 编辑 A：改促销副标题、改 sortOrder，保存生效；slug 输入框禁用。
5. 评论批量导入 2 条（一条带图 URL）→ 成功计数；再造一条坏数据确认原子拒绝。
6. 图片：未配 R2 时上传 → 503 中文回退；粘贴 URL 保存产品成功，缩略图可见。

店面（开新无痕窗口，避免缓存）：

7. 访问 `/lp/<A-slug>`：H1 = 覆盖标题、图库 = 覆盖图、促销块在 H1 上方；评论/SKU/价格/库存与原产品一致；变体切换、加入购物车 URL 保持在 `/lp/<slug>?...`；Pixel 控制台无报错、ViewContent/AddToCart 触发。
8. 同一标签刷新多次 → 访问量只 +1（会话去重）；新标签/无痕窗再开 → +1；列表访问量与后台一致。
9. 用该 LP 下一单 COD（可货到付款，不必支付）→ 后台 Single Pages 该行订单 +1、转化率更新；DB 中 order_attributions.landing_page_id 指向 A（可 `pnpm exec prisma studio` 或 psql 只读查询确认，不修改数据）。
10. `/lp/<B-slug>` 与停用后的 A → 404 页面；原 `/products/<slug>` 普通 PDP 不受任何影响（标题/图片仍是产品自身）。
11. LP 的 view 接口直接 `curl -X POST` 一个不存在 slug → 204 静默（不产生脏数据）。

- [ ] **Step 4: 删除本次冒烟产生的全部数据**

只删本次创建的数据；开发库原有的 11 个遗留测试产品**一律不动**（除非用户明确授权）。用 psql（容器 small-house-postgres，库 small_house）按顺序：

```sql
-- 先核对范围：这些 LP slug 必须都是本次冒烟创建的
SELECT id, slug, name, created_at FROM product_landing_pages
WHERE created_at >= '<本次开工当日 UTC 0 点>';

-- 确认无误后，按外键顺序删除（订单级联会先处理 attribution）
DELETE FROM order_attributions
WHERE landing_page_id IN (SELECT id FROM product_landing_pages WHERE created_at >= '<ts>');
-- 冒烟 COD 订单本身也要删（连带 order items/status/payments/reservations/address 级联；
-- 先 SELECT id 确认是冒烟订单号再删）
DELETE FROM orders WHERE id IN (
  SELECT o.id FROM orders o JOIN order_attributions a ON a.order_id = o.id
  WHERE a.landing_page_id IN (SELECT id FROM product_landing_pages WHERE created_at >= '<ts>')
);
DELETE FROM landing_page_visits
WHERE landing_page_id IN (SELECT id FROM product_landing_pages WHERE created_at >= '<ts>');
DELETE FROM product_reviews
WHERE source = 'ADMIN' AND product_id = '<冒烟用产品id>'
  AND created_at >= '<ts>';
DELETE FROM product_landing_pages WHERE created_at >= '<ts>';
```

删除前每个 DELETE 先跑等价 SELECT 把行数/内容贴出来核对；实际表名/列名若与上面不符，以 `\d product_landing_pages` 等为准修正。删除后复查：四张表均无本次数据；`prisma migrate status` 仍干净；后台 Single Pages 恢复到任务前状态。

- [ ] **Step 5: 工作树核对**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站" && git status --short
```

Expected：只有本功能相关源码与计划文档；`HOMEPAGE_SPEC.md`、`2026-09-11-pdp-refinement.md`、`docs/research/`、`.playwright-mcp/`、`home.jpeg`、`docs/BRAND_FOUNDATION_V1.md`、自动生成的 AGENTS.md/CLAUDE.md **均未被暂存**。`generated/prisma` 仍被 gitignore 忽略。

- [ ] **Step 6: 最终汇报**

向用户汇报：12 个任务完成、迁移名、各提交哈希、门禁结果、冒烟结果、清理结果；并说明 R2 真实直传待用户提供 bucket 凭据后验证（当前已验证 503 回退路径），`.env.example` 中的配置步骤。

---

## Self-Review

### 1. Spec coverage（对照设计稿逐条）

| 设计稿要求 | 覆盖任务 |
|---|---|
| 一个产品多个 LP，独立手动 URL `/lp/<slug>`，不自动分流 | Task 1 模型/slug 唯一；Task 2 CRUD；Task 4 storefront；Task 8 前端路由 |
| LP 仅覆盖 H1/标题与图库；评论/SKU/规格/价格/库存共享 | Task 4 `storefrontGetComposite` 复用 `storefrontGetBySlug`；Task 8 `applyLandingOverrides` 只改 name/images |
| 全局后台 `/admin/single-pages`（参考截图布局，PRODUCT_MANAGE，导航名 Single Pages） | Task 9 Step 1–4 |
| 列：勾选、FB目录编号、可排序单页标题、产品型号、页面链接（复制/打开）、访问量、订单、转化率、生效状态、修改时间、编辑笔 | Task 9 Step 3 表头逐列 |
| 筛选：产品名搜索、状态、修改日期范围 | Task 3 query schema + Task 9 筛选条 |
| 批量勾选 + 一键批量改标题（一次后端请求） | Task 3 `bulk-title` + Task 9 toolbar/dialog |
| 选填促销标题块（标题+副标题，H1 上方，禁止编造折扣） | Task 1 字段；Task 2 校验；Task 9 表单；Task 8 promoSlot |
| 选填时间窗，自动上线/过期（窗外 404） | Task 1 字段；Task 2 util effectiveStatus；Task 4 LIVE 门禁；Task 9 徽标 |
| 访问量按会话去重（localStorage LP 归属 + sessionStorage UUID） | Task 1 visits 复合唯一；Task 4 upsert；Task 8 tracker |
| 订单数排除取消/拒单；转化率口径文案 | Task 3 groupBy + notIn；Task 9 说明卡原文 |
| checkout 归因落 landingPageId（列已存在，不加迁移） | Task 5 |
| 评论批量导入：后端原子接口、行级错误、TSV 弹窗 | Task 6；Task 11 |
| 图片直传 Cloudflare R2（presigned PUT、零依赖、可选配置/503） | Task 7；Task 10 |
| 不泄露 supplier* 成本字段与 review 内部字段 | Task 4 白名单 serialize；Task 8 类型仅 11 字段 |
| SEO：LP 标题/描述/OG/canonical 指向真实产品 | Task 8 generateMetadata |
| Pixel 事件继续触发、PHP/COD 文案不变 | Global Constraints + Task 8 PdpView 复用 |

### 2. Placeholder / TBD 扫描

全文无 TBD/TODO/“类似 Task N”/空测试；每个代码步骤给出完整代码或精确 old→new 替换。Task 9 Step 3 中残留的 `_slug/patch` 废行已在同一步显式标注「写代码时用最终版本」并给出正确片段——执行时以该最终片段为准。Task 10 Step 4、Task 11 Step 4 有两处「以实际命名为准」的回退（`setPhoto`/`reload`），均给出先读文件与预期形态，属锚点核实而非占位。

### 3. 跨任务类型/命名一致性

- 后端字段 ↔ DTO ↔ 前端类型：`adCode/titleOverride/imagesOverride/promoEnabled/promoHeadline/promoSubtext/startAt/endAt/sortOrder/effectiveStatus` 全文一致；Json 图片项 `{url, altText}` 三端同名。
- API 路径：admin `admin/products/:id/landing-pages`、`admin/landing-pages[/:id|/bulk-title]`、storefront `storefront/lp/:slug[/view]`、reviews batch `admin/products/:id/reviews/batch`、uploads `admin/uploads/presign` —— Task 2/3/4/6/7 定义处与 Task 9/10/11 admin-api 调用处逐一对应。
- `AdminLandingPageRow`（列表 17 字段）↔ `AdminLandingPageDetail extends Row`（详情追加 6 字段）：Task 3 serialize 输出字段与 Task 9 接口字段对齐；Task 2 per-product 列表也输出 detail 形态（同 serialize），Task 9 openEdit 用 `listProductLandingPages().find()` 取详情，契约一致。
- `BatchReviewInput`（Task 9 类型）↔ Task 6 后端按 `createAdminReviewSchema` 逐行 parse（authorName/location?/rating/title?/comment/photos/isVisible）↔ Task 11 弹窗构造体一致。
- 错误形态 `{row,field,message}` Task 6 抛出 ↔ Task 11 `BatchLineError` 与 AdminApiError.details 传递一致。
- presign 返回 `{uploadUrl,publicUrl,key,expiresIn}` Task 7 ↔ Task 9 类型 ↔ Task 10 使用一致。
- 归因键：localStorage `sh:lp`、sessionStorage `sh:lpvisit` Task 8 内部一致；`Attribution.landingPageId` ↔ Task 5 DTO/orders.service 字段一致。
- 状态色 tone：Task 9 `EFFECTIVE_TONE` 使用 Badge 已支持的 green/amber/neutral/red（已核实 Badge.tsx）。
- Button `variant="text"`、Dialog props、Field/TextInput/Select/Pagination/TableSkeleton 均已核实存在于对应原语文件。

## Execution Handoff

计划已完成并保存至 `small-house-commerce/docs/superpowers/plans/2026-09-14-product-landing-pages-batch-reviews-r2.md`。用户已批准方案并明确「按照以上方案执行」、约定直接在本地 `main` 提交（不建 worktree/分支、不 push），因此进入实现阶段时采用 inline 执行（superpowers:executing-plans），逐任务 TDD 推进并在每任务末尾按计划中给定的精确 `git add` 提交；不切换分支、不推送。
