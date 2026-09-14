# Product Landing Pages (A/B URLs) + Batch Review Import + R2 Image Upload — Design

Date: 2026-09-14
Status: awaiting user review
Decisions locked via AskUserQuestion:

1. Backend **unfrozen for this feature**: new table, migration, endpoints.
2. A/B mechanism: **independent URLs assigned manually** to each optimizer/ad
   (no automatic traffic split in V1).
3. Batch reviews: **new backend batch endpoint** (atomic).
4. Image upload: **Cloudflare R2 presigned direct upload**; URL entry stays.

Three features ship together because (2) and (3) reuse the admin UX surfaces
(1) adds, and the operator's immediate workflow is: spin up a landing page
per optimizer → upload its creative images directly → bulk-seed reviews.

## 1. Standing constraints that apply

- No new npm dependencies, backend or frontend. R2 signing uses Node's
  built-in `crypto` (SigV4 presigned URL); the browser PUTs with plain
  `fetch`.
- Storefront API must never expose `supplierSku / supplierCost /
  costCurrency / landedCost`, nor review internals
  `isVisible / source / verifiedOrderItemId`.
- No fake/seeded data left in the dev database after verification.
- COD copy, Pixel events (ViewContent/AddToCart/InitiateCheckout), and PHP
  pricing stay exactly as they are.
- Tailwind design tokens only. Every new admin field gets a Chinese
  operator hint (established convention).
- Backend is frozen **except for this feature**; after it ships, freeze
  resumes.

## 2. Current state (verified in code)

- No landing-page model exists. `order.prisma` **already has**
  `OrderAttribution.landingPageId String?` (nullable, no FK), but the
  checkout DTO (`orders/dto/order.dto.ts`) does not accept it and the admin
  order page can only ever render it empty.
- PDP is a server component (`(storefront)/products/[slug]/page.tsx`) that
  fetches `/storefront/products/:slug` and passes one `Product` object to
  `PdpClient` (`product.name` → H1, `product.images` → gallery). The same
  object drives JSON-LD and Pixel ViewContent.
- Reusable assembler: `ProductsService.storefrontGetBySlug(slug)` returns
  the full storefront product payload incl. `availableInventory` and
  review aggregates. A landing endpoint can reuse it unchanged.
- Reviews: only `POST /admin/products/:productId/reviews` (single) exists;
  `ReviewsService.adminCreate` inserts one row. DTO:
  `createAdminReviewSchema` (authorName, location?, rating 1–5, title?,
  comment ≤5000, photos: url[] ≤6, isVisible).
- No upload capability anywhere: no multer, no multipart endpoint, no
  storage SDK, no bucket config. Every image field in the system stores an
  http(s) URL string (`ProductImage.url`, `ProductReview.photos[]`,
  `Collection.heroImage`).
- Frontend attribution is read live from URL params by `readAttribution()`
  in `src/lib/tracking.ts`; `CheckoutForm` sends it as
  `attribution: readAttribution()`. AID/UTM pattern is the model for
  landing-page attribution.
- Migrations are Prisma, folder schema (`prisma/schema/*.prisma`),
  applied against the Docker Postgres `small-house-postgres`.

## 3. Feature A — Product landing pages

### 3.1 Concept

One product owns zero or more **landing pages**. A landing page renders
the *same sellable product* (same SKUs, price, stock, dimensions, size
guide, reviews, related products) but overrides presentation:

- **visible page title / H1** (optional override; blank = product name);
- **image gallery** (optional ordered override set; null = inherit the
  product gallery).

Description, variants, specifications and reviews are **not** overridable
in V1.

Each landing page has its own stable URL `/lp/<slug>` that an optimizer
puts in their ad link. No server-side traffic splitting: distribution is
decided in the ad platform.

### 3.2 Data model — new model `ProductLandingPage`

New file `prisma/schema/landing-page.prisma`:

```prisma
enum LandingPageStatus {
  ACTIVE
  DISABLED
}

model ProductLandingPage {
  id             String            @id @default(uuid(7)) @db.Uuid
  productId      String            @map("product_id") @db.Uuid
  name           String            // internal label only, e.g. "优化师A-首图版"
  slug           String            @unique // /lp/<slug>, kebab-case
  titleOverride  String?           @map("title_override") // H1; null = product.name
  // Ordered [{ "url": "...", "altText": "..." }]; null/empty = inherit product images
  imagesOverride Json?             @map("images_override")
  seoTitle       String?           @map("seo_title")
  seoDescription String?           @map("seo_description")
  status         LandingPageStatus @default(ACTIVE)
  sortOrder      Int               @default(0) @map("sort_order")
  createdAt      DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, status])
  @@map("product_landing_pages")
}
```

`Product` gains `landingPages ProductLandingPage[]`. Migration
`add_product_landing_pages`. No seed data.

`imagesOverride` JSON is validated at the API boundary (zod): 0–10 items,
`{ url: https-url ≤2048, altText?: string ≤200 }`, order = array index.
JSON (not a ProductImage FK) deliberately: ad creative often uses images
that never appear in the canonical gallery.

### 3.3 Backend endpoints

Admin, all guarded `JwtAuthGuard + PermissionsGuard('PRODUCT_MANAGE')`:

| Method & path | Purpose |
|---|---|
| `GET /admin/products/:productId/landing-pages` | list, ordered sortOrder then createdAt |
| `POST /admin/products/:productId/landing-pages` | create |
| `PATCH /admin/landing-pages/:id` | update (any field optional; null clears override) |
| `DELETE /admin/landing-pages/:id` | delete |

Zod DTO:

- `name` 1–120 required;
- `slug` required on create, kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`,
  ≤120; unique → 409 with Chinese-safe English error;
- `titleOverride` nullable ≤200;
- `imagesOverride` nullable array of the shape above (≤10);
- `seoTitle` nullable ≤200, `seoDescription` nullable ≤300;
- `status` enum; `sortOrder` int.

Public (no auth):

- `GET /api/v1/storefront/lp/:slug` →
  `{ landingPage: { id, name, slug, titleOverride, imagesOverride,
  seoTitle, seoDescription }, product: <storefrontGetBySlug output> }`
- 404 when the landing page is missing/DISABLED **or** the parent product
  is not ACTIVE. Product payload is built with the existing
  `storefrontGetBySlug` — zero supplier fields can leak because the
  select is unchanged.

### 3.4 Order attribution (uses the existing column)

- Checkout DTO: add
  `landingPageId: z.string().uuid().nullable().optional()` inside
  `attribution`.
- `OrdersService` writes it to `OrderAttribution.landingPageId` alongside
  the existing snapshot fields.
- Storefront: visiting `/lp/:slug` persists the landing page id in
  `localStorage` (`sh:lp`, mirroring the AID pattern). `readAttribution()`
  includes it; checkout sends it. **Last landing page visited wins**, same
  mental model as AID/UTM. It is only an attribution hint; price/stock
  always come from the cart SKUs.

### 3.5 Storefront rendering

- New route `src/app/(storefront)/lp/[slug]/page.tsx`. To avoid
  duplicating the ~250-line PDP, the existing product page is refactored:
  its inner layout moves into a shared `PdpView` (server component) taking
  `{ product, category, delivery, seo?, canonicalPath? }`.
- The LP route fetches the composite and builds a **merged product**:
  `{ ...product, name: titleOverride?.trim() || product.name, images:
  imagesOverride?.length ? sorted(imagesOverride) : product.images }`.
  Everything downstream (PdpClient, gallery, variants, reviews, JSON-LD
  helper, related products) is untouched and receives the merged object.
- SEO rules:
  - `<link rel="canonical" href=".../products/{real-slug}">` — LP
    variants must not split product SEO.
  - `title`/`description`/Open Graph use `seoTitle/seoDescription` when
    present, else the override name (the ad creative intent);
  - JSON-LD keeps the **real** product name, slug and images (structured
    data describes the offer, not the variant).
- A small client component records the LP id for attribution on mount.
  Pixel PageView/ViewContent fire exactly as today; `content_name`
  naturally carries the override H1.

### 3.6 Admin UI

- New page `/admin/products/[id]/landing-pages` ("落地页" tab linked from
  the product edit header), listing rows: internal name, `/lp/slug`
  (+copy-link), status badge, created date, edit/disable/delete.
- Create/edit dialog with per-field Chinese hints:
  - 内部名称：只给后台看，如「优化师A-首图版」；
  - Slug：落地页网址 `/lp/...`，英文小写连字符，一键根据名称生成，保存后勿改；
  - 标题覆盖：留空则前台显示产品原名；
  - 图片覆盖：留空=用产品主图组；填写后落地页只显示这组图（按行号排序）；
  - SEO 标题/描述：投放链接预览用，可留空；
  - 顶部说明卡：独立 URL、共享 SKU/库存/评论、DISABLED 后链接 404。
- Gallery rows use the shared `ImageUrlInput` (feature C).
- LP images bypass the `ProductImage` table entirely (stored as JSON), so
  they never leak into the canonical product gallery or PLP cards.

## 4. Feature B — Batch review import (backend)

- `POST /admin/products/:productId/reviews/batch`
  (PRODUCT_MANAGE), body `{ items: CreateAdminReviewInput[] }`,
  1 ≤ items ≤ 100.
- **Atomic, all-or-nothing**: every row is validated with the existing
  single-review schema. On the first invalid row(s), return
  400 `{ errors: [{ row, field, message }] }` and create nothing.
- All valid → one `prisma.$transaction` of individual creates (we need
  per-row uuid/default timestamps; `createMany` acceptable if generated
  defaults behave identically) and return `{ created: n }`.
- Source is always `ADMIN`; same `ensureProduct` guard.
- Admin reviews page gains a **"批量导入"** button opening a dialog:
  - one TSV line per review, columns
    `姓名 ⇥ 地区(可空) ⇥ 星级1-5 ⇥ 标题(可空) ⇥ 评论 ⇥ 图片URL(多个用 | 分隔)`;
  - Chinese format card + one prefilled example line; client-side parse
    and pre-validation (row/column errors shown before submitting);
  - result screen: "成功导入 N 条" or the backend's per-row errors;
  - the single-add form stays unchanged.

## 5. Feature C — Cloudflare R2 direct upload

### 5.1 Why URLs today

The V1 schema stores image URL strings and no storage integration exists
(server has no multipart handler, no bucket/credentials). Direct upload
therefore needs real object storage; R2 is chosen for zero egress fees.

### 5.2 Backend

New `uploads` module:

- `POST /admin/uploads/presign` (PRODUCT_MANAGE), body
  `{ contentType, fileName }`.
  - allowlist `image/jpeg | image/png | image/webp`;
  - key scheme `catalog/<yyyy>/<uuid7-or-random>.<ext>`;
  - builds an R2 S3-compatible presigned **PUT** URL (SigV4, Node
    `crypto`, 10-minute expiry, signed `Content-Type`), no SDK dependency;
  - returns `{ uploadUrl, publicUrl, key, expiresIn: 600 }`.
- Config via env (`.env`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
  (custom domain, e.g. `https://img.smallhouse.ph`). Missing config →
  503 with a clear "R2 not configured" message; URL entry keeps working.
- `.env.example` updated with the five variables and a runbook comment;
  no secrets committed.
- Bucket setup is the operator's manual step (runbook in the page hint):
  create bucket, attach public custom domain, add CORS allowing
  `PUT` from the admin origin.

### 5.3 Frontend

- Shared `components/admin/ImageUrlInput.tsx`: the existing URL text input
  plus an **"上传图片"** button → file picker (images only, client cap
  8 MB) → presign → `PUT` the file to R2 → write the returned `publicUrl`
  into the same field; small thumbnail preview; 503 → hint
  「图片直传未配置（R2），可直接粘贴图片 URL」.
- Wired into: product image rows (ProductForm), review photo rows (single
  + batch dialog), and landing-page gallery rows.
- Zero new browser dependencies (`fetch` PUT).

## 6. Verification

- Backend vitest:
  - LP service: active LP returns composite; DISABLED LP → 404; parent
    product DRAFT → 404; duplicate slug → 409;
  - batch reviews: all valid → count created; one bad row → 400 and zero
    rows inserted;
  - presign: URL shape (`X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Signature`, R2 host), deterministic host/key; missing config
    → 503;
  - checkout attribution persists `landingPageId`.
- `npx tsc --noEmit`, `pnpm lint`, `pnpm build` (frontend); backend
  lint/test per existing scripts.
- Manual end-to-end on dev: create LP in admin → open `/lp/slug`
  (override H1 + custom gallery; same variants/reviews/stock) → place a
  COD test order → confirm the admin order detail shows the LP id in
  attribution → delete all test data. Test batch dialog with good and bad
  rows. R2 path can only fully execute once the user supplies bucket
  credentials; until then verify the 503 fallback and URL path.

## 7. Explicit non-goals (V1)

- Automatic percentage traffic splitting, per-LP stats dashboards
  (attribution data is captured; reporting comes later).
- Overriding description, variants, price or reviews per landing page.
- Image cropping/compression, multi-file bulk upload, disk-local storage.
- Customer-facing review submission (unchanged; V1.5 track).

## 8. Rough task breakdown (for the implementation plan)

1. Prisma model + migration + client regen.
2. Backend LP admin CRUD + public composite endpoint + tests.
3. Backend order DTO/service `landingPageId` + test.
4. Backend batch reviews endpoint + test.
5. Backend uploads module (SigV4 presign) + config + tests.
6. Frontend LP route + shared PdpView refactor + attribution capture +
   checkout wiring.
7. Frontend admin: landing-pages page + nav/edit link + Chinese hints.
8. Frontend admin: ImageUrlInput + wire into product/review forms.
9. Frontend admin: batch-import dialog on reviews page.
10. Full verification, manual end-to-end, cleanup, commit.
