# PDP Refinement — Castlery-Style Gallery, Mobile Sticky CTA, Reviews

Date: 2026-09-11
Status: Approved
Reference: https://www.castlery.com/ product pages
Supersedes for implementation: refines `PDP_SPEC.md` §6.3 (gallery), §6.4 (info area),
§8 (price presentation), §12 (mobile sticky CTA), §19 (size guide), §22 (reviews).
The original PDP_SPEC stays as the V1.0 baseline; this document is the V1.1 build slice.

## 1. Goal

Bring the Product Detail Page up to the Castlery interaction standard on desktop and
mobile, while staying a COD-first store with no accounts in V1:

- Desktop: left gallery, right product information (breadcrumb, name, rating, price,
  variants, size guide entry, quantity, CTAs, trust).
- Mobile: full-width gallery first, product information below, name + price + ORDER NOW
  fixed to the bottom at all times.
- Full-screen photo lightbox opened from any image, opening at the clicked image.
- Product details / size guide in a modal (desktop) / bottom sheet (mobile).
- Real review data model and display components, zero fabricated reviews.

## 2. Confirmed Decisions

| Topic | Decision |
|---|---|
| Reviews | Real data only. Admin-entered reviews for cold start; customer reviews (post-order, moderated) deferred to V1.5. Build the schema, admin API, and storefront display now. No mock/hard-coded reviews. |
| Empty review state | PDP shows "No reviews yet"; rating row hidden when count is 0. |
| Instalment pricing | **Not built** (no financing in a COD store). Price = compare-at strikethrough → current price → "Save ₱X". |
| Wishlist heart | **Not built**. Desktop has no heart; mobile top-right action is a quick add-to-cart icon button. |
| Product photography | All gallery interactions built against backend image URLs; placeholder rendering stays until real images are inserted. No code change needed when images land. |
| Variant "sets" | Modelled as existing variants with their own SKU/price. No new bundling/pricing engine. |

## 3. Desktop Layout

Two-column grid, gap 32–48px, max width 1200px. Left column ~55% (gallery), right
~45% (information). Stacks to one column under `lg`.

Right column order (PDP_SPEC §6.4):

1. **Breadcrumb**: `Home › <Category> › <Product name>` (links, last item plain text).
2. **Product name** (existing §7 title rules).
3. **Rating row**: star icons + `N reviews` linking to the reviews anchor; when
   `reviewCount === 0` render "No reviews yet" in muted text, no stars.
4. **Price module**: current price; compare-at price struck through when present;
   red `Save ₱X` when discount exists. No instalment line.
5. **Stock state** (existing §18 behaviour): In stock / Only N left / Out of stock.
6. **Variant selector** when more than one variant exists (existing buttons), with
   label `Variant` (or the option name when options are introduced later).
7. **Size guide** text button/link — opens the Product Details modal at the Dimensions
   section. Only shown when the product carries dimension data.
8. **Quantity** stepper (existing).
9. **CTAs**: ORDER NOW (primary) + ADD TO CART (secondary), existing stock-gate rules.
10. **COD trust list** (existing).

Variant switching updates price, stock state, CTA enabled-state, and the URL query
(`?variant=<variantId>`), Castlery-style: shareable URL, back-button restores.
On first load `?variant=` preselects that variant when valid. Variant-specific images
are not modelled yet: the gallery stays shared. A `variant.images` hook is not added
speculatively; when admin supports variant images, gallery binding is added then.

## 4. Gallery (Desktop and Mobile)

Data source: `product.images` (sorted `sortOrder`); empty → single placeholder.

- **Main image**: 1:1 (DESIGN_SYSTEM), clickable, opens the lightbox at that image.
- **Thumbnail strip** below the main image: shows the first 5 thumbnails. When the
  product has more than 5 images, the 5th tile is an **"+N / View all photos"** tile
  that opens the lightbox at image index 4. With 1–5 images all are shown directly.
- Clicking a thumbnail swaps the main image (existing behaviour) AND is a click target
  for the lightbox only via the main image / "+N" tile — thumbnails themselves swap,
  they do not open the lightbox (matches Castlery).
- Placeholder state: main placeholder is not clickable; strip and "+N" hidden.

### Lightbox

Full-screen overlay, near-black translucent backdrop, image contained (not cropped),
centred:

- Opens at the **exact image clicked** (index passed in; scroll/position synced).
- Counter `i/n` bottom-right area or under image; prev/next arrows (desktop),
  horizontal swipe (mobile), keyboard ←/→/Esc.
- Close: **✕ top-right**, click backdrop, Esc. Body scroll locked while open.
- URL does not change for the lightbox.
- Photos can include future video/customer-photo media types; V1 renders image URLs
  only and ignores unsupported kinds.

## 5. Mobile Layout (≤767px)

Page order:

1. Gallery: full-width main image + horizontal thumbnail strip (smaller thumbnails,
   ~64px). Tap main image → lightbox positioned at the current image.
2. Information block:
   - breadcrumb (small, may truncate)
   - row: **product name (left) + quick add-to-cart icon button (right)**
   - rating row
   - price module
   - variants
   - size guide entry
   - (quantity lives in the sticky-bar interaction? — see below)
3. Description, reviews, related products below as today.

Quantity on mobile: the stepper stays in the information block only. The sticky bar
stays compact (name/price + ORDER NOW, matching Castlery's mobile bar) and places the
order with the currently selected variant and quantity (default 1).

### Product Details — bottom sheet

"Size guide" opens a bottom sheet (mobile) / centered modal (desktop), title
**Product details**, close via **✕ top-right**, swipe-down/backdrop click on mobile.
Content is an accordion with sections, each rendered only when data exists:

- **Dimensions** — the existing SizeGuide table (product size + folded size), plus
  package dimensions/weight when present.
- **Details** — material/description facts from product fields.
- **Delivery, warranty and returns** — static COD store policy copy
  (Metro Manila 3–5 days, provinces 5–7 days; COD; returns/warranty statement once
  policy is final — V1 shows delivery + COD only, no invented warranty numbers).
- **Assembly** — shown only when an assembly field exists (not modelled → hidden).

The current always-visible SizeGuide table on the PDP is removed from inline flow and
moved into this modal.

### Sticky bottom bar

Fixed, white background, top border, safe-area padding, `z-index` below modals:

- Left: product name (1 line, truncated) + current price (selected variant).
- Right: **ORDER NOW** primary button, full-height.
- Reflects selected variant/price live. Out of stock → button disabled,
  label "Out of stock". Tapping ORDER NOW runs the existing stock gate +
  direct-checkout flow.
- Hidden inside the lightbox and details sheet (those overlays cover it).
- Page gets bottom padding so related/footer content is never permanently hidden.

## 6. Reviews — Data Model

New Prisma model in the catalog schema:

```
model ProductReview {
  id                    String   @id @default(uuid())
  productId             String
  product               Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  source                 ReviewSource   // ADMIN | CUSTOMER
  authorName             String
  location               String?
  rating                 Int            // 1..5, validated at API
  title                  String?
  comment                String
  photos                 String[]       @default([])  // image URLs
  isVisible              Boolean        @default(true)
  verifiedOrderItemId    String?        // null in V1; wired when customer reviews ship
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt

  @@index([productId, isVisible])
}

enum ReviewSource { ADMIN CUSTOMER }
```

No fabricated data is seeded. Product relations get `reviews ProductReview[]`.

### Backend API

Admin (guarded by the existing permission system; reuse `product.manage` or add
`review.manage` — decision: reuse `product.manage`, no new permission):

- `POST   /api/v1/admin/products/:id/reviews` — create (admin-entered)
- `PATCH  /api/v1/admin/reviews/:id` — edit, toggle `isVisible`
- `GET    /api/v1/admin/products/:id/reviews` — list including hidden
- `DELETE /api/v1/admin/reviews/:id`

Validation (zod): rating int 1–5; authorName/comment required and length-bounded;
photos array of URLs, max 6; source fixed by endpoint (admin endpoint sets ADMIN).

Storefront:

- Product detail response gains:
  - `ratingAverage: number | null` (visible reviews only, rounded 1 decimal, null if none)
  - `reviewCount: number`
  - `reviews: Array<{ id, authorName, location, rating, title, comment, photos, createdAt }>`
    — visible only, newest first, capped (V1: 10 on PDP; list endpoint not needed yet).
- List/card endpoints include only `ratingAverage` and `reviewCount` (cheap aggregate;
  if this requires N+1 queries, defer aggregates to a denormalized field on Product in
  the same slice).

Implementation note for performance: compute aggregates via Prisma `groupBy` per
product; the storefront product list page-size is small (≤24). Denormalized counters
are only added if measured queries are bad — do not add speculatively.

### Frontend components

- `RatingStars` — presentational, `value` 0–5, supports half via rounded average
  shown to nearest 0.5; sizing prop. Read-only (no input).
- `ReviewSection` (`id="reviews"`): summary header (average, stars, count), list of
  reviews (stars, title, comment, customer photo thumbnails, name, location),
  empty state "No reviews yet". No write form.
- Rating row in the info area links to `#reviews`.

## 7. Files

Backend:

- `backend/prisma/schema/catalog.prisma` — model + enum + relation
- new migration (manual SQL reviewed, naming like existing migrations)
- `src/modules/catalog/reviews.service.ts`
- `src/modules/catalog/admin/reviews.controller.ts`
- `src/modules/catalog/storefront/products.controller.ts` + `products.service.ts`
  (aggregates + embedded reviews on detail)
- `src/modules/catalog/catalog.module.ts` wiring
- dto + unit tests (service: visibility filter, aggregate math, validation)

Frontend:

- new: `components/product/PdpClient.tsx` (client island: variant state + URL sync,
  owns gallery/modal/sticky-bar coordination)
- new: `components/product/ProductLightbox.tsx`
- new: `components/product/ProductDetailsModal.tsx` (modal + bottom sheet via
  responsive classes; no extra dependency)
- new: `components/product/MobileStickyCta.tsx`
- new: `components/product/RatingStars.tsx`
- new: `components/product/ReviewSection.tsx`
- rewritten: `components/product/ProductGallery.tsx` (main + ≤5 thumbs + "+N")
- slimmed: `components/product/ProductPurchase.tsx` (variant/price/qty/CTA logic moves
  to shared hooks used by desktop info column and sticky bar — extract
  `useProductPurchase(product)` hook to avoid duplicated logic)
- `app/products/[slug]/page.tsx` — breadcrumb, mobile/desktop ordering, reviews,
  modal, sticky bar
- `lib/api.ts` — review types + product response fields

No new npm dependencies (no carousel/lightbox library — interactions are small).

## 8. Validation & Acceptance

- `pnpm --filter backend lint`, `test`; `pnpm --filter frontend lint`, `build`.
- Manual browser pass at 1280px and 390px widths:
  1. Variant switch updates price/stock/CTA and `?variant=`; reload keeps selection.
  2. Gallery: thumb swap; main image opens lightbox on clicked index; ✕/Esc/arrow/swipe;
     body scroll locked; "+N" tile when >5 images; placeholder product shows no
     lightbox affordance.
  3. Mobile sticky bar visible throughout scroll, name+price correct, ORDER NOW gated
     by stock, bar hidden under overlays, no content permanently hidden.
  4. Size guide opens sheet/modal with ✕; accordion sections; empty sections hidden.
  5. Reviews: none → "No reviews yet"; insert an admin review via API → appears on PDP
     after revalidate; `isVisible=false` never reaches storefront.
- Existing Meta Pixel ViewContent/AddToCart events keep firing with selected SKU.

## 9. Out of Scope

Customer review submission/moderation UI, review photos upload (URLs only for admin),
denormalized rating counters unless needed, variant-specific images, wishlist,
instalments, offer/carousel modules (PDP_SPEC §9 offers stay as future CMS work),
review pagination beyond the 10-item cap.
