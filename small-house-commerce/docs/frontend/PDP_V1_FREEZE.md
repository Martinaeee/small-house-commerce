# PDP V1 Freeze — 2026-09-26

Branch: `feature/admin-product-ui-redesign`
Freeze gate commit: `test(pdp): freeze pdp v1 acceptance gate` (this commit)
Accepted baseline when the round started: `7057747`

PDP V1 is frozen on this branch. The freeze is an audit, not a feature: no
product behaviour changed in this phase. The read-only acceptance gate lives
in `frontend/e2e/pdp-freeze.spec.ts` and captures the final evidence set in
`frontend/screenshots/phase5-*.png`.

## Frozen contract and where it is enforced

| Checklist item | Enforced by |
| --- | --- |
| Hero (name, tagline, selling points, price, dimensions, delivery, CTA) | `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |
| Gallery + thumbnails + play badge | `variant-options-media.spec.ts`, `pdp-freeze.spec.ts` |
| Variant selection (Color × Size, OOS truth) | `variant-options-media.spec.ts`, `pdp-freeze.spec.ts` |
| Variant deep link `?variant=<real uuid>` | `variant-options-media.spec.ts`, `pdp-freeze.spec.ts` |
| Price + compare-at + Subtotal honesty | `ProductOptionSelector.spec.tsx`, `pdp-ux-phase-1.spec.ts` |
| Estimated delivery + service assurances | `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |
| Inline COD (shared state, real order path, attribution) | `pdp-quick-cod.spec.ts`, `PdpQuickCodOrder.spec.tsx` |
| Trust bar | `pdp-freeze.spec.ts` |
| Sticky section nav (link ⇔ anchor, variant-aware) | `PdpSectionNavGate.spec.tsx`, `pdp-freeze.spec.ts` |
| Sticky buy (shared state, one cart mutation) | `pdp-ux-phase-1.spec.ts`, `PdpStickyBuy.spec.tsx` |
| Description + Benefits (`Why You’ll Love It`) | `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |
| Detail media conservation (order, no duplication) | `pdp-ux-phase-1.spec.ts`, `pdp-detail-blocks.spec.ts` |
| Viewport video (TEASER/CONTENT/LIGHTBOX, reduced motion, Save-Data) | `pdp-video.spec.ts`, `viewport-video-coordinator.spec.ts` |
| Specifications (materials, weight, no package rows) | `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |
| Material & Dimensions | `pdp-freeze.spec.ts` |
| Delivery, Returns & FAQs (`#shipping-faq`) | `pdp-freeze.spec.ts` |
| Related products (4, buyable, excludes self/OOS) | `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |
| Reviews (read-only V1) | `pdp-freeze.spec.ts`, `reviews` specs |
| Recently viewed (visit order, excludes current) | `RecentlyViewed.spec.tsx`, `pdp-freeze.spec.ts` |
| SEO metadata (title, description, canonical) | `products/[slug]/page.spec.tsx`, `admin-product-editor.spec.ts` |
| Attribution links (`aid`, `campaign_id`, `adset_id`, `ad_id`, `utm_*`) | `campaign-link-builder.spec.ts`, `tracking.spec.ts`, `pdp-quick-cod.spec.ts` |
| Tracking (ViewContent/AddToCart/InitiateCheckout/Purchase contract) | `commerce-events.spec.ts`, `PurchaseTracking.spec.tsx`, `PdpQuickCodOrder.spec.tsx` |
| Mobile 390/375 (touch targets, no overflow, sticky usable) | `pdp-ux-phase-1.spec.ts`, `pdp-quick-cod.spec.ts`, `pdp-freeze.spec.ts` |
| LP reuse (`/lp/<slug>` shares the PDP body) | `pdp-video.spec.ts`, `pdp-ux-phase-1.spec.ts`, `pdp-freeze.spec.ts` |

## Gate results at freeze

- Frontend unit: 628/628 (74 files)
- Backend unit: 708/708 (44 files)
- Chromium E2E: full suite green including `pdp-freeze.spec.ts` (8/8 with `--repeat-each=2`)
- TypeScript, Prisma validate, backend build, frontend build: pass
- Lint: 0 errors (pre-existing warnings only)
- `git diff --check`: clean

## Evidence screenshots (`frontend/screenshots/`)

`phase5-pdp-hero-1440.png`, `phase5-pdp-details-1440.png`,
`phase5-pdp-mobile-hero-390.png`, `phase5-inline-cod.png`,
`phase5-sticky-buy.png`, `phase5-video.png`, `phase5-reviews.png`,
`phase5-related.png`, `phase5-recently-viewed.png`.

## Explicitly deferred (not part of PDP V1)

- Product-specific FAQ schema
- Advanced recommendation engine
- Frequently Bought Together / Complete the Room
- Dynamic courier API
- Category Specification Template schema
- Export / Import
- Homepage redesign, Category page redesign
- Detail-image intrinsic dimensions (CLS): needs a schema addition, deferred
  since Minor Cleanup — `loading="lazy"` + natural aspect ratio stays.
- R2 real upload credentials (ops task)

## Rules that remain frozen with this contract

- Media precedence stays `Exact Variant → media-driver option value → Shared`.
- The three media data lines (shared gallery / scoped media / detail blocks)
  stay separate.
- Meta events `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase` are
  not disrupted.
- This round stops locally: no merge, no push, no PR, no deployment.
