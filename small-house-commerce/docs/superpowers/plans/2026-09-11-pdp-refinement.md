# PDP Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Product Detail Page to the Castlery interaction standard — desktop two-column with rating/reviews, a full-screen photo lightbox, mobile product-details bottom sheet and a compact sticky ORDER NOW bar — backed by a real admin-managed ProductReview model.

**Architecture:** Backend adds a `ProductReview` table owned by the catalog module; a pure aggregation/serialization helper (unit tested) computes rating summaries, a `ReviewsService` does admin CRUD + visible-only storefront reads, and `ProductsService` attaches `ratingAverage`/`reviewCount` (list + detail) and `reviews[]` (detail only). Frontend collapses all PDP interactivity into one client island `PdpClient` that owns variant/quantity/overlay state and renders presentational children (gallery, lightbox, details sheet, sticky bar, review components).

**Tech Stack:** NestJS + Prisma 7 (PostgreSQL) + Zod on the backend; Next.js 16 App Router, React 19, Tailwind CSS v4 (zero new dependencies) on the frontend; pnpm workspace; vitest for the backend unit test.

**Spec:** `small-house-commerce/docs/frontend/PDP_REFINEMENT_2026-09.md` (read alongside `docs/frontend/PDP_SPEC.md`).

## Global Constraints

- Backend source imports use **`.js` specifiers** (ESM/TS), e.g. `from './reviews.service.js'`.
- Prisma models live in split files under `backend/prisma/schema/*.prisma`; client is generated into `backend/src/generated/prisma`; import enums from `../../generated/prisma/client.js`.
- DB naming: `@map("snake_case")` columns, `@@map("plural_snake")` tables, `@db.Uuid` ids (`@default(uuid(7))`), timestamps `@db.Timestamptz(3)` — match `catalog.prisma` exactly.
- Run backend commands from `small-house-commerce/backend`, frontend from `small-house-commerce/frontend`. Package manager is **pnpm**.
- Admin endpoints reuse the existing `@Permissions('PRODUCT_MANAGE')` guard pair — no new permission.
- Storefront must never expose `isVisible=false`, `source`, or `verifiedOrderItemId`.
- Frontend styles use ONLY DESIGN_SYSTEM tokens already defined in `globals.css` (`primary`, `primary-light`, `cta`, `cta-hover`, `ink`, `ink-secondary`, `ink-muted`, `sale`, `border`, `card`, `background`). No hex in components.
- No new npm dependencies. No fabricated/mock reviews. Prices are PHP only; no instalment pricing. No wishlist heart.
- COD delivery copy (existing, reused): Metro Manila 3–5 days, provinces 5–7 days, Cash on Delivery.
- Keep Meta Pixel `ViewContent` / `AddToCart` events firing with the selected SKU.

---

## File Structure

Backend (all under `small-house-commerce/backend`):

- Modify `prisma/schema/catalog.prisma` — add `ReviewSource` enum, `ProductReview` model, `Product.reviews` relation.
- Create migration via `prisma migrate dev`.
- Create `src/modules/catalog/review-utils.ts` — pure helpers `summarizeRatings`, `serializeReview`.
- Test `src/modules/catalog/review-utils.spec.ts`.
- Create `src/modules/catalog/dto/review.dto.ts` — zod schemas + inferred types.
- Create `src/modules/catalog/reviews.service.ts`.
- Create `src/modules/catalog/admin/reviews.controller.ts`.
- Modify `src/modules/catalog/products.service.ts` — attach summaries/reviews.
- Modify `src/modules/catalog/catalog.module.ts` — register service + controller.

Frontend (all under `small-house-commerce/frontend`):

- Modify `src/lib/api.ts` — `Review` type + new Product fields.
- Create `src/components/product/RatingStars.tsx`.
- Create `src/components/product/ReviewSection.tsx`.
- Create `src/components/product/ProductLightbox.tsx`.
- Create `src/components/product/ProductDetailsModal.tsx`.
- Create `src/components/product/MobileStickyCta.tsx`.
- Rewrite `src/components/product/ProductGallery.tsx` (controlled, ≤5 thumbs + "+N").
- Create `src/components/product/PdpClient.tsx` (the island; supersedes `ProductPurchase.tsx`).
- Delete `src/components/product/ProductPurchase.tsx`; refactor `src/components/product/SizeGuide.tsx` to a borderless `DimensionRows`.
- Modify `src/app/products/[slug]/page.tsx` — breadcrumb category fetch, `PdpClient`, `ReviewSection`, remove inline SizeGuide.

---

## Task 1: ProductReview schema, migration, generated client

**Files:**
- Modify: `prisma/schema/catalog.prisma`
- Generate: `prisma/migrations/<timestamp>_add_product_reviews/migration.sql` + `src/generated/prisma/*`

**Interfaces:**
- Produces: Prisma model `ProductReview` with fields `{ id, productId, source, authorName, location, rating, title, comment, photos, isVisible, verifiedOrderItemId, createdAt, updatedAt }`, enum `ReviewSource { ADMIN CUSTOMER }`, and `Product.reviews ProductReview[]`.

- [ ] **Step 1: Add the enum and model to `catalog.prisma`**

Append the enum near the other enums (after `enum InternalProductRole { ... }`):

```prisma
/// Product review source. ADMIN = merchant-entered for cold start;
/// CUSTOMER = post-order (submission/moderation ships in V1.5).
enum ReviewSource {
  ADMIN
  CUSTOMER
}
```

Append the model at the end of the file:

```prisma
/// PDP_SPEC §22 reviews. Admin can seed reviews for cold start; customer
/// reviews arrive post-order in V1.5. Storefront reads isVisible rows only.
/// photos are image URLs (admin enters URLs in V1; upload comes later).
/// verifiedOrderItemId is a plain nullable column for now — no FK until the
/// customer-review flow exists.
model ProductReview {
  id                  String       @id @default(uuid(7)) @db.Uuid
  productId           String       @map("product_id") @db.Uuid
  source              ReviewSource @default(ADMIN)
  authorName          String       @map("author_name")
  location            String?
  rating              Int
  title               String?
  comment             String
  photos              String[]     @default([])
  isVisible           Boolean      @default(true) @map("is_visible")
  verifiedOrderItemId String?      @map("verified_order_item_id") @db.Uuid
  createdAt           DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, isVisible])
  @@map("product_reviews")
}
```

Add the relation to the `Product` model, in the relations block next to `images ProductImage[]`:

```prisma
  reviews ProductReview[]
```

- [ ] **Step 2: Validate the schema**

Run: `cd small-house-commerce/backend && pnpm exec prisma validate`
Expected: `The schema ... is valid`.

- [ ] **Step 3: Create and apply the migration (Postgres Docker is running on :5432)**

Run: `cd small-house-commerce/backend && pnpm exec prisma migrate dev --name add_product_reviews`
Expected: migration created under `prisma/migrations/<timestamp>_add_product_reviews/`, applied, and client regenerated (output mentions `Generated Prisma Client`).

- [ ] **Step 4: Confirm the client exposes the model and enum**

Run: `cd small-house-commerce/backend && grep -rl "ProductReview" src/generated/prisma | head -3`
Expected: at least one generated file path.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema/catalog.prisma prisma/migrations src/generated/prisma
git commit -m "feat(catalog): add ProductReview model and migration"
```

---

## Task 2: Review DTO (zod)

**Files:**
- Create: `src/modules/catalog/dto/review.dto.ts`

**Interfaces:**
- Produces: `createAdminReviewSchema`, `updateAdminReviewSchema`, types `CreateAdminReviewInput`, `UpdateAdminReviewInput`.
- Consumed by: Task 4 controller, Task 5 service.

- [ ] **Step 1: Create the DTO file**

```ts
// src/modules/catalog/dto/review.dto.ts
import { z } from 'zod';

// Admin enters reviews for cold start (PDP_SPEC §22). Photos are URLs, max 6.
const photoSchema = z.string().url().max(2048);

export const createAdminReviewSchema = z.object({
  authorName: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  comment: z.string().trim().min(1).max(5000),
  photos: z.array(photoSchema).max(6).default([]),
  isVisible: z.boolean().default(true),
});
export type CreateAdminReviewInput = z.infer<typeof createAdminReviewSchema>;

// PATCH: every field optional; no defaults may survive here so an omitted
// field means "leave unchanged". Zod 4's .partial() PRESERVES inner
// defaults, so omit the defaulted fields first and re-add them plain —
// the same convention as updateProductSchema in product.dto.ts.
export const updateAdminReviewSchema = createAdminReviewSchema
  .omit({ photos: true, isVisible: true })
  .partial()
  .extend({
    photos: z.array(photoSchema).max(6).optional(),
    isVisible: z.boolean().optional(),
    // Allow explicitly clearing the optional text fields.
    location: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
  });
export type UpdateAdminReviewInput = z.infer<typeof updateAdminReviewSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `cd small-house-commerce/backend && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors. (If the project has no root `tsc` script, this command still works via the local typescript binary.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/catalog/dto/review.dto.ts
git commit -m "feat(catalog): add review zod DTOs"
```

---

## Task 3: Pure review helpers + first unit test (TDD)

This is the project's first unit test; it stays pure (no Nest, no Prisma) so no mocking infrastructure is needed.

**Files:**
- Create: `src/modules/catalog/review-utils.ts`
- Test: `src/modules/catalog/review-utils.spec.ts`

**Interfaces:**
- Produces:
  - `summarizeRatings(rows: { rating: number }[]): { reviewCount: number; ratingAverage: number | null }`
  - `StorefrontReviewShape`, and `serializeReview(input): StorefrontReviewShape`
- Consumed by: Task 5 `ReviewsService`.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/catalog/review-utils.spec.ts
import { describe, expect, it } from 'vitest';
import { serializeReview, summarizeRatings } from './review-utils.js';

describe('summarizeRatings', () => {
  it('returns zero count and null average for no reviews', () => {
    expect(summarizeRatings([])).toEqual({ reviewCount: 0, ratingAverage: null });
  });

  it('counts reviews and rounds the average to one decimal', () => {
    const rows = [{ rating: 5 }, { rating: 4 }, { rating: 3 }];
    expect(summarizeRatings(rows)).toEqual({ reviewCount: 3, ratingAverage: 4.0 });
  });

  it('rounds the half-up average 4.25 to 4.3 and never returns NaN', () => {
    const rows = [
      { rating: 5 },
      { rating: 5 },
      { rating: 5 },
      { rating: 2 }, // sum 17 / 4 = 4.25
    ];
    expect(summarizeRatings(rows).ratingAverage).toBe(4.3);
  });
});

describe('serializeReview', () => {
  it('maps a Prisma review to the storefront shape and drops internal fields', () => {
    const out = serializeReview({
      id: 'r1',
      authorName: 'Maria',
      location: 'Manila',
      rating: 5,
      title: 'Great',
      comment: 'Perfect for my condo.',
      photos: ['https://example.com/a.jpg'],
      isVisible: true,
      source: 'ADMIN',
      verifiedOrderItemId: 'should-not-leak',
      productId: 'p1',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    expect(out).toEqual({
      id: 'r1',
      authorName: 'Maria',
      location: 'Manila',
      rating: 5,
      title: 'Great',
      comment: 'Perfect for my condo.',
      photos: ['https://example.com/a.jpg'],
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(Object.keys(out)).not.toContain('source');
    expect(Object.keys(out)).not.toContain('isVisible');
    expect(Object.keys(out)).not.toContain('verifiedOrderItemId');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/catalog/review-utils.spec.ts`
Expected: FAIL — cannot resolve `./review-utils.js`.

- [ ] **Step 3: Implement the helper**

```ts
// src/modules/catalog/review-utils.ts
/**
 * Pure review aggregation/serialization. Kept free of Nest/Prisma so the
 * rating math is trivially unit-testable.
 */

export interface RatingSummary {
  reviewCount: number;
  /** Mean of visible ratings, rounded to 1 decimal; null when there are none. */
  ratingAverage: number | null;
}

export function summarizeRatings(rows: { rating: number }[]): RatingSummary {
  const reviewCount = rows.length;
  if (reviewCount === 0) return { reviewCount: 0, ratingAverage: null };
  const total = rows.reduce((sum, row) => sum + row.rating, 0);
  // Math.round is half-up: 4.25 -> 4.3. One decimal matches the PDP display.
  const ratingAverage = Math.round((total / reviewCount) * 10) / 10;
  return { reviewCount, ratingAverage };
}

export interface StorefrontReviewShape {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: string;
}

type SerializableReview = {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: Date;
};

export function serializeReview(review: SerializableReview): StorefrontReviewShape {
  return {
    id: review.id,
    authorName: review.authorName,
    location: review.location,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    photos: review.photos,
    createdAt: review.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/catalog/review-utils.spec.ts`
Expected: PASS (4 assertions across the two describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/modules/catalog/review-utils.ts src/modules/catalog/review-utils.spec.ts
git commit -m "feat(catalog): pure review aggregation helpers with unit tests"
```

---

## Task 4: ReviewsService

**Files:**
- Create: `src/modules/catalog/reviews.service.ts`

**Interfaces:**
- Consumes: `PrismaService` (existing `../../prisma/prisma.service.js`), Task 2 DTO types, Task 3 helpers.
- Produces methods:
  - `adminCreate(productId: string, input: CreateAdminReviewInput)`
  - `adminListForProduct(productId: string)`
  - `adminUpdate(id: string, input: UpdateAdminReviewInput)`
  - `adminRemove(id: string)`
  - `storefrontForProduct(productId: string): Promise<{ reviews: StorefrontReviewShape[] } & RatingSummary>`
  - `summaryForProducts(productIds: string[]): Promise<Map<string, RatingSummary>>`

- [ ] **Step 1: Create the service**

```ts
// src/modules/catalog/reviews.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateAdminReviewInput,
  UpdateAdminReviewInput,
} from './dto/review.dto.js';
import {
  serializeReview,
  summarizeRatings,
  type RatingSummary,
  type StorefrontReviewShape,
} from './review-utils.js';

const STOREFRONT_REVIEW_TAKE = 10;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- admin ---------------------------------------------------------------

  async adminCreate(productId: string, input: CreateAdminReviewInput) {
    await this.ensureProduct(productId);
    return this.prisma.productReview.create({
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
    });
  }

  async adminListForProduct(productId: string) {
    await this.ensureProduct(productId);
    return this.prisma.productReview.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminUpdate(id: string, input: UpdateAdminReviewInput) {
    await this.ensureReview(id);
    // Map null to null (clear), undefined is omitted by Prisma automatically.
    return this.prisma.productReview.update({
      where: { id },
      data: {
        ...(input.authorName !== undefined && { authorName: input.authorName }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.comment !== undefined && { comment: input.comment }),
        ...(input.photos !== undefined && { photos: input.photos }),
        ...(input.isVisible !== undefined && { isVisible: input.isVisible }),
      },
    });
  }

  async adminRemove(id: string) {
    await this.ensureReview(id);
    await this.prisma.productReview.delete({ where: { id } });
  }

  // --- storefront ----------------------------------------------------------

  async storefrontForProduct(
    productId: string,
  ): Promise<{ reviews: StorefrontReviewShape[] } & RatingSummary> {
    // The reviews[] page is capped at 10, but count/average MUST span all
    // visible reviews (spec: the cap applies to the list, not the summary),
    // so run the page query and the aggregate in parallel.
    const [rows, agg] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId, isVisible: true },
        orderBy: { createdAt: 'desc' },
        take: STOREFRONT_REVIEW_TAKE,
      }),
      this.prisma.productReview.aggregate({
        where: { productId, isVisible: true },
        _count: { _all: true },
        _avg: { rating: true },
      }),
    ]);
    const avg = agg._avg.rating;
    return {
      reviews: rows.map(serializeReview),
      reviewCount: agg._count._all,
      ratingAverage: avg === null ? null : Math.round(avg * 10) / 10,
    };
  }

  /** Visible-only averages for a batch of products (list pages/cards). */
  async summaryForProducts(productIds: string[]): Promise<Map<string, RatingSummary>> {
    const result = new Map<string, RatingSummary>();
    if (productIds.length === 0) return result;

    const grouped = await this.prisma.productReview.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, isVisible: true },
      _avg: { rating: true },
      _count: { _all: true },
    });

    for (const row of grouped) {
      // groupBy gives the exact average; round at the edge like the helper.
      const avg = row._avg.rating;
      result.set(row.productId, {
        reviewCount: row._count._all,
        ratingAverage: avg === null ? null : Math.round(avg * 10) / 10,
      });
    }
    return result;
  }

  // --- internal ------------------------------------------------------------

  private async ensureProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
  }

  private async ensureReview(id: string): Promise<void> {
    const review = await this.prisma.productReview.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!review) throw new NotFoundException('Review not found');
  }
}
```

Note: `summarizeRatings` is imported but only used by `storefrontForProduct` via spread — keep the import; oxlint will not flag a used symbol.

- [ ] **Step 2: Typecheck**

Run: `cd small-house-commerce/backend && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/catalog/reviews.service.ts
git commit -m "feat(catalog): add ReviewsService (admin CRUD + storefront reads)"
```

---

## Task 5: Admin reviews controller + module wiring

**Files:**
- Create: `src/modules/catalog/admin/reviews.controller.ts`
- Modify: `src/modules/catalog/catalog.module.ts`

**Interfaces:**
- Produces routes (all guarded by `JwtAuthGuard` + `PermissionsGuard` + `PRODUCT_MANAGE`):
  - `GET    /api/v1/admin/products/:productId/reviews`
  - `POST   /api/v1/admin/products/:productId/reviews`
  - `PATCH  /api/v1/admin/reviews/:id`
  - `DELETE /api/v1/admin/reviews/:id`

- [ ] **Step 1: Create the controller**

```ts
// src/modules/catalog/admin/reviews.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  createAdminReviewSchema,
  updateAdminReviewSchema,
  type CreateAdminReviewInput,
  type UpdateAdminReviewInput,
} from '../dto/review.dto.js';
import { ReviewsService } from '../reviews.service.js';

/**
 * Admin review entry points. Cold-start reviews are merchant-authored; the
 * guard/permission pair matches AdminProductsController. Two base paths need
 * two controller classes, both declared in this file.
 */
@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':productId/reviews')
  list(@Param('productId') productId: string) {
    return this.reviews.adminListForProduct(productId);
  }

  @Post(':productId/reviews')
  create(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createAdminReviewSchema)) input: CreateAdminReviewInput,
  ) {
    return this.reviews.adminCreate(productId, input);
  }
}

@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAdminReviewSchema)) input: UpdateAdminReviewInput,
  ) {
    return this.reviews.adminUpdate(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reviews.adminRemove(id);
  }
}
```

- [ ] **Step 2: Register in the catalog module**

In `src/modules/catalog/catalog.module.ts`, add the import and the two controllers and the provider. Resulting relevant parts:

```ts
import {
  AdminProductReviewsController,
  AdminReviewsController,
} from './admin/reviews.controller.js';
// ...existing imports...
import { ReviewsService } from './reviews.service.js';
```
```ts
  controllers: [
    AdminCategoriesController,
    AdminProductsController,
    AdminProductReviewsController,
    AdminReviewsController,
    AdminSuppliersController,
    StorefrontCategoriesController,
    StorefrontProductsController,
  ],
  providers: [CategoriesService, ProductsService, ReviewsService, SuppliersService],
```

- [ ] **Step 3: Build and lint**

Run: `cd small-house-commerce/backend && pnpm run build && pnpm run lint`
Expected: build succeeds, no lint errors.

- [ ] **Step 4: Smoke-check the route is protected**

With the backend running (`pnpm start:dev`), run:

`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/admin/products/00000000-0000-0000-0000-000000000000/reviews`

Expected: `401` (route exists, auth required) — not 404.

- [ ] **Step 5: Commit**

```bash
git add src/modules/catalog/admin/reviews.controller.ts src/modules/catalog/catalog.module.ts
git commit -m "feat(catalog): admin review endpoints guarded by PRODUCT_MANAGE"
```

---

## Task 6: Attach review data to storefront product responses

**Files:**
- Modify: `src/modules/catalog/products.service.ts`

**Interfaces:**
- Consumes: `ReviewsService` (Task 4).
- Produces: list items and detail item each gain `ratingAverage: number | null`, `reviewCount: number`; the detail item additionally gains `reviews: StorefrontReviewShape[]`.

- [ ] **Step 1: Inject ReviewsService**

Add the import and constructor argument (constructor currently only takes `PrismaService`):

```ts
import { ReviewsService } from './reviews.service.js';
```
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}
```

- [ ] **Step 2: Attach summaries in `storefrontList`**

In `storefrontList`, change the return so summaries are attached after the inventory enrichment. Replace the current `return { items: await this.withAvailableInventory(items), ... }` with:

```ts
    const enriched = await this.withAvailableInventory(items);
    const summary = await this.reviews.summaryForProducts(enriched.map((p) => p.id));
    const withReviews = enriched.map((p) => {
      const s = summary.get(p.id) ?? { reviewCount: 0, ratingAverage: null };
      return { ...p, reviewCount: s.reviewCount, ratingAverage: s.ratingAverage };
    });

    return {
      items: withReviews,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
```

- [ ] **Step 3: Attach summary + reviews in `storefrontGetBySlug`**

Replace the method's final return line (`return (await this.withAvailableInventory([product]))[0];`) with:

```ts
    const base = (await this.withAvailableInventory([product]))[0];
    const reviewData = await this.reviews.storefrontForProduct(base.id);
    return { ...base, ...reviewData };
```

- [ ] **Step 4: Build, lint, run unit tests**

Run: `cd small-house-commerce/backend && pnpm run build && pnpm run lint && pnpm exec vitest run`
Expected: build clean, lint clean, the Task 3 spec passes (default vitest config includes `**/*.spec.ts`).

- [ ] **Step 5: End-to-end data check against the running API**

Create a visible admin review requires a JWT; instead verify the storefront shape directly. First grab a product slug, then check the JSON fields exist:

`curl -s 'http://localhost:3000/api/v1/storefront/products?pageSize=1' | python3 -c "import sys,json; d=json.load(sys.stdin); print({k:d['items'][0][k] for k in ('reviewCount','ratingAverage')})"`

Expected: `{'reviewCount': 0, 'ratingAverage': None}`.

Then on a detail URL (`/api/v1/storefront/products/<slug>`) confirm the same keys plus `reviews: []`. (Insert an admin review via the API with a valid admin JWT in manual testing per the spec acceptance; not required for this commit.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/catalog/products.service.ts
git commit -m "feat(catalog): expose rating summary and reviews on storefront products"
```

---

## Task 7: Frontend API types

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `export interface Review`; `Product` gains `ratingAverage: number | null`, `reviewCount: number`, and optional `reviews?: Review[]` (detail only).

- [ ] **Step 1: Add the Review interface and Product fields**

Add near the other exported interfaces:

```ts
export interface Review {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: string;
}
```

Add these three fields to the existing `export interface Product { ... }` (place after `categoryId`):

```ts
  ratingAverage: number | null;
  reviewCount: number;
  /** Present only on the single-product detail response. */
  reviews?: Review[];
```

- [ ] **Step 2: Typecheck/lint (expect temporary errors until Task 12 wiring)**

Run: `cd small-house-commerce/frontend && pnpm lint`
Expected: no error from `api.ts` itself. (A `next build` now would complain the fields aren't produced — they are, by Task 6; do the full build in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(storefront): add review types to API client"
```

---

## Task 8: RatingStars and ReviewSection

**Files:**
- Create: `src/components/product/RatingStars.tsx`
- Create: `src/components/product/ReviewSection.tsx`

**Interfaces:**
- `RatingStars({ value, className? }: { value: number; className?: string })` — read-only, rounds to nearest 0.5, renders 5 star glyphs (★/☆/half via clip is unnecessary; use full stars for `floor`, one ½ symbol when remainder ≥ .25, else ☆).
- `ReviewSection({ product }: { product: Product })` — `id="reviews"`; empty state "No reviews yet".

- [ ] **Step 1: Create RatingStars**

```tsx
// src/components/product/RatingStars.tsx
/**
 * Read-only star rating, PDP_SPEC §22. Renders to the nearest half star
 * using text glyphs (no icon dependency). Colour is the CTA brown.
 */
export function RatingStars({ value, className = "" }: { value: number; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  const full = Math.floor(rounded);
  const half = rounded - full === 0.5;
  const stars = Array.from({ length: 5 }, (_, i) => {
    if (i < full) return "★";
    if (i === full && half) return "⯨";
    return "☆";
  });
  return (
    <span
      className={`inline-flex text-cta ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
      role="img"
    >
      {stars.map((star, i) => (
        <span key={i} className={star === "☆" ? "text-border" : ""}>
          {star}
        </span>
      ))}
    </span>
  );
}
```

(If the `⯨` half glyph renders inconsistently, fall back to showing the nearest whole-star count plus the numeric average next to it — the average text always accompanies this component.)

- [ ] **Step 2: Create ReviewSection**

```tsx
// src/components/product/ReviewSection.tsx
import type { Product } from "@/lib/api";
import { RatingStars } from "./RatingStars";

/** PDP_SPEC §22. Read-only in V1: admin-authored reviews, no write form. */
export function ReviewSection({ product }: { product: Product }) {
  const reviews = product.reviews ?? [];
  const count = product.reviewCount ?? 0;
  const average = product.ratingAverage;

  return (
    <section id="reviews" className="scroll-mt-24 rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-2xl font-semibold text-ink">Customer Reviews</h2>

      {count === 0 || average === null ? (
        <p className="text-sm text-ink-muted">No reviews yet</p>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <RatingStars value={average} className="text-lg" />
            <span className="text-sm font-semibold text-ink">{average.toFixed(1)}</span>
            <span className="text-sm text-ink-secondary">· {count} reviews</span>
          </div>

          <ul className="flex flex-col gap-6">
            {reviews.map((review) => (
              <li key={review.id} className="border-b border-border pb-6 last:border-0 last:pb-0">
                <div className="mb-1 flex items-center gap-2">
                  <RatingStars value={review.rating} className="text-sm" />
                  {review.title && (
                    <span className="text-sm font-semibold text-ink">{review.title}</span>
                  )}
                </div>
                <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                  {review.comment}
                </p>
                {review.photos.length > 0 && (
                  <div className="mb-2 flex gap-2">
                    {review.photos.map((photo) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={photo}
                        src={photo}
                        alt="Customer review"
                        className="h-16 w-16 rounded-md border border-border object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  {review.authorName}
                  {review.location ? `, ${review.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Lint**

Run: `cd small-house-commerce/frontend && pnpm lint`
Expected: no new errors in these files.

- [ ] **Step 4: Commit**

```bash
git add src/components/product/RatingStars.tsx src/components/product/ReviewSection.tsx
git commit -m "feat(storefront): RatingStars and ReviewSection with empty state"
```

---

## Task 9: ProductLightbox

**Files:**
- Create: `src/components/product/ProductLightbox.tsx`

**Interfaces:**
- `<ProductLightbox images: ProductImage[]; index: number; onClose(): void; onNavigate(i:number):void />`. Opens at `index`; keyboard ←/→/Esc; mobile swipe; ✕ top-right; body scroll lock; `z-[60]`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/product/ProductLightbox.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

interface Props {
  images: ProductImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ProductLightbox({ images, index, onClose, onNavigate }: Props) {
  const touchX = useRef<number | null>(null);
  const [animating, setAnimating] = useState(false);

  const go = useCallback(
    (next: number) => {
      const clamped = (next + images.length) % images.length;
      setAnimating(true);
      onNavigate(clamped);
    },
    [images.length, onNavigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, go, onClose]);

  useEffect(() => {
    const t = setTimeout(() => setAnimating(false), 150);
    return () => clearTimeout(t);
  }, [index]);

  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(delta) > 40) go(delta < 0 ? index + 1 : index - 1);
        touchX.current = null;
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
      >
        ✕
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={() => go(index - 1)}
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={() => go(index + 1)}
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
          >
            ›
          </button>
        </>
      )}

      <div className="flex flex-1 items-center justify-center p-4 sm:p-10">
        {current.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={current.url}
            alt={current.altText ?? "Product image"}
            className={`max-h-full max-w-full rounded-md object-contain transition-opacity duration-150 ${
              animating ? "opacity-0" : "opacity-100"
            }`}
          />
        ) : (
          <PlaceholderImage label="" className="aspect-square w-full max-w-xl rounded-md" />
        )}
      </div>

      <div className="pb-6 text-center text-sm font-medium text-white/80">
        {index + 1} / {images.length}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd small-house-commerce/frontend && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/product/ProductLightbox.tsx
git commit -m "feat(storefront): full-screen PDP photo lightbox"
```

---

## Task 10: ProductDetailsModal (bottom sheet) + refactor SizeGuide into DimensionRows

**Files:**
- Modify/repurpose: `src/components/product/SizeGuide.tsx`
- Create: `src/components/product/ProductDetailsModal.tsx`

**Interfaces:**
- `DimensionRows({ product }: { product: Product })` — borderless rows (product size, folded size when present); returns `null` when no dimension data.
- `<ProductDetailsModal product onClose />` — responsive sheet/modal, title "Product details", ✕, native `<details>` accordion sections (Dimensions, Details, Delivery, warranty and returns). Body scroll lock + Esc to close; `z-50`.

- [ ] **Step 1: Replace `SizeGuide.tsx` contents**

Keep the `cm`/`kg`/`Row` helpers but export a borderless `DimensionRows` (no card, no heading) so it nests in the accordion. Full new file:

```tsx
// src/components/product/SizeGuide.tsx
import type { Product } from "@/lib/api";

/** PDP_SPEC §19 fit data, rendered inside the Product Details sheet. */

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function cm(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${value} cm`;
}

export function DimensionRows({ product }: { product: Product }) {
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null;
  const hasFolded =
    product.foldedWidth !== null ||
    product.foldedHeight !== null ||
    product.foldedDepth !== null;

  if (!hasDimensions && !hasFolded) return null;

  return (
    <dl>
      {hasDimensions && (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Product size
          </p>
          <Row label="Width" value={cm(product.width)} />
          <Row label="Height" value={cm(product.height)} />
          <Row label="Depth" value={cm(product.depth)} />
        </>
      )}
      {hasFolded && (
        <>
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Folded size
          </p>
          <Row label="Width" value={cm(product.foldedWidth)} />
          <Row label="Folded height" value={cm(product.foldedHeight)} />
          <Row label="Folded depth" value={cm(product.foldedDepth)} />
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Measurements may vary slightly. Measure your doorway before delivery.
      </p>
    </dl>
  );
}
```

- [ ] **Step 2: Create ProductDetailsModal**

```tsx
// src/components/product/ProductDetailsModal.tsx
"use client";

import { useEffect, type ReactNode } from "react";
import type { Product } from "@/lib/api";
import { DimensionRows } from "./SizeGuide";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="border-b border-border py-4 last:border-0 [&_summary]:cursor-pointer"
    >
      <summary className="flex list-none items-center justify-between text-base font-semibold text-ink">
        {title}
        <span className="text-ink-muted">⌄</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

export function ProductDetailsModal({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Product details"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Product details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink-secondary hover:bg-border/50"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6">
          <Section title="Dimensions" defaultOpen>
            <DimensionRows product={product} />
          </Section>

          {product.description && (
            <Section title="Details">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                {product.description}
              </p>
            </Section>
          )}

          <Section title="Delivery, warranty and returns">
            <dl>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-sm text-ink-secondary">Delivery</dt>
                <dd className="text-right text-sm font-medium text-ink">
                  Metro Manila 3–5 days, provinces 5–7 days
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-sm text-ink-secondary">Payment</dt>
                <dd className="text-right text-sm font-medium text-ink">Cash on Delivery</dd>
              </div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
```

Note: the Dimensions section always renders; `DimensionRows` returns `null` for products with no dimensions (acceptable — shows the empty group; if preferred, the page can conditionally render the whole sheet entry button only when dimensions exist, which Task 12 does).

- [ ] **Step 3: Lint**

Run: `cd small-house-commerce/frontend && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/product/SizeGuide.tsx src/components/product/ProductDetailsModal.tsx
git commit -m "feat(storefront): product details bottom sheet with dimensions"
```

---

## Task 11: Rewrite ProductGallery and create MobileStickyCta

**Files:**
- Rewrite: `src/components/product/ProductGallery.tsx`
- Create: `src/components/product/MobileStickyCta.tsx`

**Interfaces:**
- `<ProductGallery images={ProductImage[]} active={number} onSelect={(i)=>void} onOpenLightbox={(i)=>void} />`.
  Main image is a button opening at `active`; the strip shows up to 4 thumbnails — when `images.length > 4` the 5th strip tile is `+N` (N = remaining count) opening the lightbox at index 4. Empty/placeholder images: main is not a button and the strip is hidden.
- `<MobileStickyCta name price compareAtPrice outOfStock busy onOrderNow />` — fixed bottom bar, `md:hidden`, `z-30`.

- [ ] **Step 1: Rewrite ProductGallery**

```tsx
// src/components/product/ProductGallery.tsx
"use client";

import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

const DIRECT_THUMBS = 4;

interface Props {
  images: ProductImage[];
  active: number;
  onSelect: (index: number) => void;
  onOpenLightbox: (index: number) => void;
}

/**
 * PDP_SPEC §6.3 + refinement: main image opens the lightbox; up to four
 * thumbnails swap the main image; beyond four photos the fifth strip tile is
 * a "+N" entry into the lightbox (opens at index 4). A single placeholder
 * product is not interactive.
 */
export function ProductGallery({ images, active, onSelect, onOpenLightbox }: Props) {
  const hasRealImages = images.length > 0 && images.some((image) => image.url);
  const current = images[Math.min(active, images.length - 1)];
  const extra = images.length - DIRECT_THUMBS;

  if (!hasRealImages) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <PlaceholderImage label="" className="aspect-square w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onOpenLightbox(active)}
        aria-label="Open image gallery"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.altText ?? "Product image"}
          className="aspect-square w-full object-cover"
        />
      </button>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.slice(0, DIRECT_THUMBS).map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`View image ${index + 1}`}
              className={`h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                index === active ? "border-cta" : "border-border hover:border-primary"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}

          {extra > 0 && (
            <button
              type="button"
              onClick={() => onOpenLightbox(DIRECT_THUMBS)}
              aria-label={`View all ${images.length} photos`}
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border-2 border-border bg-primary-light/40 text-sm font-semibold text-cta hover:border-primary"
            >
              +{extra}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create MobileStickyCta**

```tsx
// src/components/product/MobileStickyCta.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { PriceBox } from "@/components/ui/PriceBox";

/** PDP_SPEC §12: fixed name + price + ORDER NOW, mobile only. */
export function MobileStickyCta({
  name,
  price,
  compareAtPrice,
  outOfStock,
  busy,
  onOrderNow,
}: {
  name: string;
  price: number | null;
  compareAtPrice: number | null;
  outOfStock: boolean;
  busy: boolean;
  onOrderNow: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <PriceBox price={price} compareAtPrice={compareAtPrice} />
        </div>
        <Button
          onClick={onOrderNow}
          disabled={busy || outOfStock}
          size="md"
          className="shrink-0"
          data-testid="sticky-order-now"
        >
          {outOfStock ? "Out of Stock" : "ORDER NOW"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint**

Run: `cd small-house-commerce/frontend && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/product/ProductGallery.tsx src/components/product/MobileStickyCta.tsx
git commit -m "feat(storefront): controlled gallery with +N tile and mobile sticky CTA"
```

---

## Task 12: PdpClient island and PDP page wiring

**Files:**
- Create: `src/components/product/PdpClient.tsx`
- Delete: `src/components/product/ProductPurchase.tsx`
- Modify: `src/app/products/[slug]/page.tsx`

**Interfaces:**
- `<PdpClient product={Product} categoryName={string | null} />` owns: selected variant id (initialised from `?variant=`), quantity, lightbox index/open, details sheet open; renders desktop two-column grid (gallery + info) and, on mobile, the reordered info block and `MobileStickyCta`; hides the sticky bar while an overlay is open.

- [ ] **Step 1: Create PdpClient**

```tsx
// src/components/product/PdpClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Product } from "@/lib/api";
import { api, cartStorage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import { track } from "@/lib/tracking";
import { RatingStars } from "./RatingStars";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailsModal } from "./ProductDetailsModal";
import { MobileStickyCta } from "./MobileStickyCta";

/** Small inline cart glyph used for the mobile quick-add action. */
function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 4h2l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h7.9a1.5 1.5 0 0 0 1.5-1.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20.5" r="1.2" />
      <circle cx="18" cy="20.5" r="1.2" />
    </svg>
  );
}

export function PdpClient({ product, categoryName }: { product: Product; categoryName: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variants = product.variants;
  const images = product.images;

  const firstSellable = useMemo(
    () => variants.find((v) => v.sku !== null) ?? null,
    [variants],
  );

  const initialVariant =
    variants.find((v) => v.id === searchParams.get("variant")) ?? firstSellable;

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialVariant?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [galleryActive, setGalleryActive] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;
  const sku = selectedVariant?.sku ?? null;
  const available = sku?.availableInventory ?? 0;
  const outOfStock = sku === null || available <= 0;
  const lowStock = !outOfStock && available <= 5;
  const price = sku?.price ?? null;
  const compareAt = sku?.compareAtPrice ?? null;
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null;

  // Keep ?variant= in sync (shareable, back-button restorable).
  useEffect(() => {
    if (!selectedVariantId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("variant") === selectedVariantId) return;
    params.set("variant", selectedVariantId);
    router.replace(`/products/${product.slug}?${params.toString()}`, { scroll: false });
  }, [selectedVariantId, product.slug, router]);

  // TRACKING_SPEC ViewContent — once per product view.
  useEffect(() => {
    track("ViewContent", {
      content_ids: [product.id],
      content_name: product.name,
      content_type: "product",
      value: price ?? undefined,
      currency: "PHP",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  async function addToCart(qty: number) {
    if (!sku) return;
    setBusy(true);
    setNotice(null);
    try {
      const summary = await api.addToCart({ cartId: cartStorage.get(), skuId: sku.id, quantity: qty });
      cartStorage.set(summary.cartId);
      setNotice("Added to cart");
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: qty }],
        value: price ? price * qty : undefined,
        currency: "PHP",
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add to cart");
    } finally {
      setBusy(false);
    }
  }

  function orderNow() {
    if (!sku || sku.availableInventory <= 0) {
      setNotice("This item is out of stock");
      return;
    }
    router.push(`/checkout?skuId=${sku.id}&qty=${quantity}`);
  }

  const stockLabel = outOfStock ? "Out of Stock" : lowStock ? `Only ${available} left` : null;
  const overlayOpen = lightboxIndex !== null || detailsOpen;
  const ratingRow =
    product.reviewCount > 0 && product.ratingAverage !== null ? (
      <a href="#reviews" className="inline-flex items-center gap-2 text-sm text-ink-secondary">
        <RatingStars value={product.ratingAverage} className="text-sm" />
        {product.reviewCount} reviews
      </a>
    ) : (
      <span className="text-sm text-ink-muted">No reviews yet</span>
    );

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductGallery
          images={images}
          active={galleryActive}
          onSelect={setGalleryActive}
          onOpenLightbox={(i) => setLightboxIndex(i)}
        />

        <div className="flex flex-col gap-4">
          {/* Breadcrumb */}
          {/* Categories have no storefront landing route in V1, so the
              category name is plain text; only Home is a link. */}
          <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
            <a href="/" className="hover:text-cta">Home</a>
            {categoryName && (
              <>
                {" › "}
                <span className="text-ink-secondary">{categoryName}</span>
              </>
            )}
            {" › "}
            <span className="text-ink-secondary">{product.name}</span>
          </nav>

          {/* Name row; quick-add glyph replaces the wishlist heart on mobile */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{product.name}</h1>
            <button
              type="button"
              onClick={() => addToCart(1)}
              disabled={outOfStock}
              aria-label="Add to cart"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-cta hover:border-primary disabled:text-ink-muted md:hidden"
            >
              <CartGlyph />
            </button>
          </div>

          {ratingRow}

          <div>
            <PriceBox price={price} compareAtPrice={compareAt} />
            {price !== null && compareAt !== null && compareAt > price && (
              <p className="mt-1 text-sm font-medium text-sale">Save {formatPrice(compareAt - price)}</p>
            )}
          </div>

          {stockLabel && (
            <p className="text-sm font-semibold text-sale" data-testid="stock-state">{stockLabel}</p>
          )}

          {variants.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink-secondary">Variant</span>
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedVariantId(variant.id)}
                    disabled={variant.sku === null}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-muted ${
                      variant.id === selectedVariantId
                        ? "border-cta bg-primary-light/40 text-cta"
                        : "border-border bg-card text-ink hover:border-primary"
                    }`}
                  >
                    {variant.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasDimensions && (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="self-start text-sm font-medium text-cta underline-offset-2 hover:underline"
            >
              Size guide
            </button>
          )}

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-ink-secondary">Qty</span>
            <div className="flex items-center rounded-lg border border-border bg-card">
              <button type="button" aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-11 w-11 text-lg text-ink hover:text-cta">−</button>
              <span className="w-8 text-center text-base font-semibold" data-testid="qty">{quantity}</span>
              <button type="button" aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="h-11 w-11 text-lg text-ink hover:text-cta">+</button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={orderNow} disabled={busy} className="flex-1" data-testid="order-now">ORDER NOW</Button>
            <Button variant="secondary" onClick={() => addToCart(quantity)} disabled={busy} className="flex-1">
              ADD TO CART
            </Button>
          </div>

          {notice && <p role="status" className="rounded-lg border border-primary bg-primary-light/40 px-3 py-2 text-sm text-cta">{notice}</p>}

          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Cash On Delivery Available</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Nationwide Delivery</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Customer Support Available</li>
          </ul>
        </div>
      </div>

      {lightboxIndex !== null && (
        <ProductLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
      {detailsOpen && <ProductDetailsModal product={product} onClose={() => setDetailsOpen(false)} />}
      {!overlayOpen && (
        <MobileStickyCta
          name={product.name}
          price={price}
          compareAtPrice={compareAt}
          outOfStock={outOfStock}
          busy={busy}
          onOrderNow={orderNow}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Wrap the Suspense boundary and rewrite the page**

`useSearchParams` requires a Suspense boundary. Replace `src/app/products/[slug]/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PdpClient } from "@/components/product/PdpClient";
import { ProductCard } from "@/components/product/ProductCard";
import { ReviewSection } from "@/components/product/ReviewSection";
import { TrustBar } from "@/components/ui/TrustBar";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  return { title: product?.name, description: product?.description ?? undefined };
}

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

async function fetchCategoryName(categoryId: string): Promise<string | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as Category[];
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === categoryId) return node.name;
      stack.push(...node.children);
    }
    return null;
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) notFound();

  const [categoryName, relatedRes] = await Promise.all([
    fetchCategoryName(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate } },
    ).catch(() => null),
  ]);

  let related: Product[] = [];
  if (relatedRes?.ok) {
    related = ((await relatedRes.json()) as Paged<Product>).items.filter(
      (item) => item.id !== product.id,
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 pb-24 sm:px-6 md:pb-8">
      <Suspense fallback={null}>
        <PdpClient product={product} categoryName={categoryName} />
      </Suspense>

      <section className="mt-12 flex flex-col gap-8">
        {product.description && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
            <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
              {product.description}
            </p>
          </div>
        )}
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

- [ ] **Step 3: Delete the superseded component**

Run: `git rm src/components/product/ProductPurchase.tsx` (from `small-house-commerce/frontend`).
Confirm nothing else imports it: `grep -rn "ProductPurchase" src` should return nothing.

- [ ] **Step 4: Lint and production build**

Run: `cd small-house-commerce/frontend && pnpm lint && pnpm build`
Expected: no lint errors; build succeeds (this also typechecks the new review fields end to end).

- [ ] **Step 5: Commit**

```bash
git add src/components/product/PdpClient.tsx src/app/products/[slug]/page.tsx
git commit -m "feat(storefront): Castlery-style PDP island — breadcrumb, rating, overlays, mobile bar"
```

---

## Task 13: Browser acceptance pass (desktop + mobile)

**Files:** none (verification only).

Both dev servers run (backend :3000, frontend :3001). Restart them if the Prisma client regeneration requires it.

- [ ] **Step 1: Desktop walk-through at 1280px width**

Open `http://localhost:3001`, go to a product. Verify:
- breadcrumb, name, "No reviews yet" (no stars when 0), price, variant buttons (on multi-variant products), Size guide entry, Qty, ORDER NOW + ADD TO CART, COD list.
- Switch variant → price/stock/CTA update and `?variant=<id>` appears; reload keeps the selection.
- A product with images: thumbnails swap the main image; clicking the main image opens the lightbox on that image; ✕/Esc/arrows work; body scroll is locked.
- With `>4` images the strip shows four thumbnails plus a `+N` tile that opens the lightbox at image 5 (index 4).
- Size guide opens the centered modal at Dimensions; ✕/Esc close.
- Placeholder-only product: main image is not clickable, no thumbnail strip, no lightbox.

- [ ] **Step 2: Mobile walk-through at 390×844**

Resize/emulate, reload the PDP. Verify:
- gallery full width; sticky bar (name + price + ORDER NOW) stays visible while scrolling and is hidden while the lightbox/details sheet is open.
- quick-add cart glyph (top-right of the name) adds the selected SKU; out-of-stock disables it.
- tap main image → lightbox opens at that image and swipe + ✕ work.
- Size guide opens as a bottom sheet, ✕ closes.
- ORDER NOW routes to `/checkout?skuId=...&qty=...`; out-of-stock shows the inline notice and the bar button reads "Out of Stock".
- page bottom padding means footer/related are not permanently covered by the bar.

- [ ] **Step 3: Review data path**

Insert a visible review with an authenticated admin JWT (login via `/api/v1/auth/...` to obtain a token, then `POST /api/v1/admin/products/:productId/reviews` with `Authorization: Bearer <token>`), wait for ISR/revalidate (≤120s) or restart the frontend, and confirm: stars + count + the review appear under **Customer Reviews** and the info-area rating row links to `#reviews`. Set `isVisible:false` via `PATCH /api/v1/admin/reviews/:id` and confirm it never reaches the PDP.

- [ ] **Step 4: Full gates**

Run:
- `cd small-house-commerce/backend && pnpm run lint && pnpm run build && pnpm exec vitest run`
- `cd small-house-commerce/frontend && pnpm lint && pnpm build`

Expected: all green.

- [ ] **Step 5: Final commit if any verification fixes were made**

```bash
git add -A
git commit -m "fix(storefront): PDP refinement browser verification fixes"
```

---

## Self-Review notes (already applied)

- Spec §3 desktop: breadcrumb, rating row, price/Compare-at/Save, stock, variant + URL sync, size guide, qty, CTAs, trust → Tasks 8/12.
- Spec §4 gallery (main click, ≤5 thumbs, +N, lightbox positioning/✕/keys/swipe/scroll-lock, placeholder inert) → Tasks 9/11/12.
- Spec §5 mobile ordering, quick-add glyph, bottom sheet, sticky bar hidden under overlays → Tasks 10/11/12/13.
- Spec §6 review model/admin API/storefront aggregates/empty state/no fabricated data → Tasks 1–6, 8.
- No instalments, no wishlist, no new deps, no mock reviews → enforced in Global Constraints.
- Type consistency: storefront field names are `ratingAverage`, `reviewCount`, `reviews` across DTO/service/api.ts/components; helper names match their consumers.
