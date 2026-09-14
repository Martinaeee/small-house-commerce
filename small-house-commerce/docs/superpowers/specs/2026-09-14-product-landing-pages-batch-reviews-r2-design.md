# Product Landing Pages (A/B URLs) + Batch Review Import + R2 Image Upload — Design

Date: 2026-09-14
Status: awaiting user review
Decisions locked via AskUserQuestion:

1. Backend **unfrozen for this feature**: new table, migration, endpoints.
2. A/B mechanism: **independent URLs assigned manually** to each optimizer/ad
   (no automatic traffic split in V1).
3. Batch reviews: **new backend batch endpoint** (atomic).
4. Image upload: **Cloudflare R2 presigned direct upload**; URL entry stays.
5. Landing-page admin follows the reference "Single page marketing"
   screen: global LP list with per-LP **views / orders / conversion rate /
   status / modified date**, checkbox **bulk title edit**, an optional
   **promo headline block** per LP, an optional **schedule window**, and an
   internal ad/FB-catalog code column.

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
  product gallery);
- an optional **promo headline block** (one headline + optional subtext,
  e.g. "Christmas Sale – Buy 1 Take 1"), rendered above the H1;
- an optional **schedule window** (start/end) for time-boxed campaigns.

Description, variants, specifications and reviews are **not** overridable
in V1.

Each landing page has its own stable URL `/lp/<slug>` that an optimizer
puts in their ad link, plus an internal **ad code** (FB 目录编号, e.g.
`single-EEECS-1331`). No server-side traffic splitting: distribution is
decided in the ad platform. A global **Single page marketing** admin list
shows each LP's views, orders, conversion rate, effective status and
modified date, supports product/status/date filters and **bulk title
edit** (e.g. retitle every selected LP for a Christmas campaign).

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
  name           String            // internal label, e.g. "优化师A-首图版"
  adCode         String?           @map("ad_code") // FB 目录/广告编号, e.g. "single-EEECS-1331"
  slug           String            @unique // /lp/<slug>, kebab-case
  titleOverride  String?           @map("title_override") // H1; null = product.name
  // Ordered [{ "url": "...", "altText": "..." }]; null/empty = inherit product images
  imagesOverride Json?             @map("images_override")
  seoTitle       String?           @map("seo_title")
  seoDescription String?           @map("seo_description")
  // Optional promotional headline block rendered above the H1 on the LP.
  promoEnabled   Boolean           @default(false) @map("promo_enabled")
  promoHeadline  String?           @map("promo_headline") // e.g. "Christmas Sale"
  promoSubtext   String?           @map("promo_subtext") // optional second line
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

`Product` gains `landingPages ProductLandingPage[]`. Migration
`add_product_landing_pages`. No seed data.

**Effective status** = `status = ACTIVE` AND (`startAt` null OR now ≥
startAt) AND (`endAt` null OR now ≤ endAt). Evaluated per request, so a
Christmas promo LP can be created in advance and goes live / expires with
no manual switch. The admin list shows the manual status plus the computed
state: 未开始 Scheduled / 进行中 Live / 已结束 Ended / 已停用 Disabled.

`imagesOverride` JSON is validated at the API boundary (zod): 0–10 items,
`{ url: https-url ≤2048, altText?: string ≤200 }`, order = array index.
JSON (not a ProductImage FK) deliberately: ad creative often uses images
that never appear in the canonical gallery.

### 3.3 Backend endpoints

Admin, all guarded `JwtAuthGuard + PermissionsGuard('PRODUCT_MANAGE')`:

| Method & path | Purpose |
|---|---|
| `GET /admin/landing-pages?search=&status=&dateFrom=&dateTo=&page=&pageSize=` | **global marketing list** with per-LP views / orders / conversion (filters mirror the reference screen: product model search, status, modified-date range) |
| `POST /admin/landing-pages/bulk-title` | `{ ids: string[], titleOverride: string }` — bulk retitle selected LPs in one transaction |
| `GET /admin/products/:productId/landing-pages` | per-product list, ordered sortOrder then createdAt |
| `POST /admin/products/:productId/landing-pages` | create |
| `PATCH /admin/landing-pages/:id` | update (any field optional; null clears override) |
| `DELETE /admin/landing-pages/:id` | delete |

Global list row shape (metrics computed in SQL, no orders-table write
path changes):

```ts
{
  id, name, adCode, slug, productId, productName, status,
  effectiveStatus: "LIVE" | "SCHEDULED" | "ENDED" | "DISABLED",
  startAt, endAt, sortOrder, updatedAt,
  views: number,       // distinct sessions in landing_page_visits
  orders: number,      // order_attributions.landing_page_id = id (all non-cancelled)
  conversionRate: number, // orders / views, 0 when views = 0
}
```

Order counting rule: orders attributed to the LP whose final status is
not `CANCELLED`/`DENIED` (the two terminal failure states). This is a
marketing conversion, not a settled-sale count — the column label is
「转化率」 matching the reference screen.

Public (no auth):

- `GET /api/v1/storefront/lp/:slug` →
  `{ landingPage: { id, name, slug, titleOverride, imagesOverride,
  seoTitle, seoDescription, promoEnabled, promoHeadline, promoSubtext },
  product: <storefrontGetBySlug output> }`
- 404 when the landing page is missing/manually DISABLED, the schedule
  window does not currently contain `now`, **or** the parent product is
  not ACTIVE. Product payload is built with the existing
  `storefrontGetBySlug` — zero supplier fields can leak because the
  select is unchanged.
- `POST /api/v1/storefront/lp/:slug/view` — idempotent session view
  beacon, body `{ visitKey }` (client-generated UUID). Upsert into
  `landing_page_visits` against `@@unique([landingPageId, visitKey])`;
  a duplicate key is swallowed (204). Only counts when the LP is
  effectively live; never errors the page (beacon is best-effort).

Zod DTO:

- `name` 1–120 required; `adCode` nullable ≤64;
- `slug` required on create, kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`,
  ≤120; unique → 409 with Chinese-safe English error;
- `titleOverride` nullable ≤200;
- `imagesOverride` nullable array of the shape above (≤10);
- `seoTitle` nullable ≤200, `seoDescription` nullable ≤300;
- `promoEnabled` boolean; when true, `promoHeadline` required 1–120;
  `promoSubtext` nullable ≤200;
- `startAt` / `endAt` nullable ISO datetimes; `endAt > startAt` when both
  set;
- `status` enum; `sortOrder` int.

Bulk-title DTO: `ids: z.array(uuid).min(1).max(100)`,
`titleOverride: z.string().trim().min(1).max(200)` (sets the same H1
override on every selected LP — this is the "圣诞促销" mass retitle from
the reference screen; internal names and slugs are untouched).

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
- View counting (sessions, not hits): a tiny `LandingViewTracker` client
  component on the LP page generates/reuses a per-tab-session UUID in
  `sessionStorage` (`sh:lpvisit`) and POSTs the beacon once on mount. A
  user who reloads is the same session; opening the link in a new tab
  counts as a new session — the standard "sessions → orders" marketing
  denominator. The tracker and the localStorage attribution write happen
  together.

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
- **Promo headline block**: when `promoEnabled` and `promoHeadline` is
  set, the LP renders a sale-colour strip immediately above the H1
  (headline, optional subtext under it). It uses the existing sale token
  (`bg-sale/text-white`) — the same colour already reserved for discounts
  — and is rendered ONLY on the LP, never on the canonical PDP. Copy is
  free text; there is no price/coupon logic in V1 (honest display only,
  no fabricated discounts).
- A small client component (`LandingViewTracker`) records the LP id for
  attribution and fires the view beacon on mount. Pixel
  PageView/ViewContent fire exactly as today; `content_name` naturally
  carries the override H1.

### 3.6 Admin UI

Two surfaces, matching how the reference tool organises them:

**Global screen `/admin/single-pages` ("Single Pages" nav item,
PRODUCT_MANAGE)** — modelled on the reference screenshot:

- Filter bar: product-model search (product name), status select,
  modified date-from/date-to.
- Table columns: row checkbox · FB目录编号 (adCode) · Single page title
  (titleOverride, click-sortable) · Product model · Page link (full
  `/lp/slug`, click to copy/open) · 访问量 views · 订单 orders ·
  转化率 conversionRate (percentage) · Status (effective status badge) ·
  date modified · edit (pen icon).
- Bulk action bar: with rows checked, "批量修改单页标题" opens a
  one-field dialog → applies one title to all selected LPs in a single
  request; optimistic row update, then refetch.
- "+" button in the page header opens a create dialog that first asks
  which product the LP belongs to (product search select).
- Chinese guide card explains: 每个优化师/广告组一个独立链接；访问量按会话去重；
  转化率 = 订单数 ÷ 访问会话数（取消/拒单不计），仅供投放参考；批量标题用于
  「圣诞促销」这类统一换主题，不影响网址、库存与评论。

**Per-product entry**: the product edit page gets a "落地页 (N)" link to
the same global screen filtered by that product; the create dialog
pre-fills the product. (No separate duplicate list page.)

Create/edit dialog fields with per-field Chinese hints:

- 内部名称：只给后台看，如「优化师A-首图版」；
- FB 目录编号：可填广告/目录编号（如 single-EEECS-1331），仅后台展示，可留空；
- Slug：落地页网址 `/lp/...`，英文小写连字符，一键根据名称生成，保存后勿改；
- 标题覆盖（单页标题）：留空则前台显示产品原名；批量修改改的就是这个字段；
- 图片覆盖：留空=用产品主图组；填写后落地页只显示这组图（按行号排序）；
- 促销标题块（选填）：勾选后填写主标题（如 Christmas Sale）与副标题，
  前台在产品名上方显示促销条；不填价格/不编造折扣，只做展示；
- 开始/结束时间（选填）：到点自动上线/到期，留空=长期有效；
- SEO 标题/描述：投放链接预览用，可留空；
- 顶部说明卡：独立 URL、共享 SKU/库存/评论、停用或时间窗外链接 404。

Gallery rows use the shared `ImageUrlInput` (feature C). LP images bypass
the `ProductImage` table entirely (stored as JSON), so they never leak
into the canonical product gallery or PLP cards.

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
  - effective status: scheduled (now < startAt), ended (now > endAt),
    live inside window, DISABLED overrides everything;
  - view beacon: first visit inserts; same visitKey twice → one row;
    beacon on disabled/outside-window LP → no insert, 204;
  - metrics query: seeded visits + attributed orders (incl. one
    CANCELLED) → correct views/orders/conversionRate numbers;
  - bulk title: two LPs retitled in one call; empty/200+ ids → 400;
  - promo: promoEnabled without promoHeadline → 400; endAt ≤ startAt →
    400;
  - batch reviews: all valid → count created; one bad row → 400 and zero
    rows inserted;
  - presign: URL shape (`X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Signature`, R2 host), deterministic host/key; missing config
    → 503;
  - checkout attribution persists `landingPageId`.
- `npx tsc --noEmit`, `pnpm lint`, `pnpm build` (frontend); backend
  lint/test per existing scripts.
- Manual end-to-end on dev: create LP in admin → open `/lp/slug`
  (override H1 + promo strip + custom gallery; same variants/reviews/
  stock) → reload (views stays 1) and open in a new tab (views becomes 2)
  → place a COD test order → confirm conversionRate on the list and the
  LP id on the admin order detail → test bulk retitle on 2 LPs → delete
  all test data. Test batch dialog with good and bad rows. R2 path can
  only fully execute once the user supplies bucket credentials; until
  then verify the 503 fallback and URL path.

## 7. Explicit non-goals (V1)

- Automatic percentage traffic splitting.
- Advanced reporting beyond the list columns (time-series charts,
  per-optimizer rollups, GMV/revenue per LP, Pixel offline conversions).
- Overriding description, variants, price or reviews per landing page;
  the promo block is display-only text, not a coupon/pricing engine.
- Image cropping/compression, multi-file bulk upload, disk-local storage.
- Customer-facing review submission (unchanged; V1.5 track).

## 8. Rough task breakdown (for the implementation plan)

1. Prisma models (`ProductLandingPage` + `LandingPageVisit`) + migration
   + client regen.
2. Backend LP CRUD DTO/service (incl. effective-status + promo/schedule
   validation) + tests.
3. Backend global marketing-list endpoint with views/orders/conversion
   metrics + filters; bulk-title endpoint + tests.
4. Backend public LP composite endpoint + idempotent view beacon + tests.
5. Backend order DTO/service `landingPageId` + test.
6. Backend batch reviews endpoint + test.
7. Backend uploads module (SigV4 presign) + config + tests.
8. Frontend LP route + shared PdpView refactor + promo strip +
   LandingViewTracker + attribution capture + checkout wiring.
9. Frontend admin: global Single Pages list (filters, metrics, checkboxes,
   bulk-title dialog) + create/edit dialog + product-edit entry + Chinese
   hints.
10. Frontend admin: ImageUrlInput + wire into product/review/LP forms.
11. Frontend admin: batch-import dialog on reviews page.
12. Full verification, manual end-to-end, cleanup, commit.
