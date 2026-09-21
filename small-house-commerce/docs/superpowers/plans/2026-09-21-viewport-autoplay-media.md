# Viewport Autoplay Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured video/poster support to product, review, card, Hero, Category Tile, Room Scene, UGC, and Product Story media, with one viewport-aware player coordinator, bounded resource loading, and safe legacy compatibility.

**Architecture:** Extend phase-1 product media with posters and normalize review/homepage media at backend boundaries. Mount one `ViewportPlaybackProvider` at the Storefront root; every placement uses a small `ViewportVideo` client island while Server Components retain data/layout responsibility. One true-viewport observer selects a single winner, one preload observer handles proximity, and mode-specific source policies prevent offscreen video downloads.

**Tech Stack:** PostgreSQL 18, Prisma 7.10, NestJS 12, Zod, Next.js 16.3.4, React 19, TypeScript, Vitest, Testing Library, Playwright, Lighthouse.

**Spec:** `docs/superpowers/specs/2026-09-20-viewport-autoplay-media-design.md`

## Global Constraints

- Execute after completion gates in `2026-09-21-product-variant-options-media.md` and `2026-09-21-pdp-inline-cod-order.md` because product media contracts, cards, PDP composition, and E2E harness are dependencies.
- Keep one Storefront-root `ViewportPlaybackProvider`; do not add module singletons, nested providers, or Hero-private autoplay.
- Every mounted player receives a unique `instanceToken` separate from logical `mediaId`.
- Playback eligibility uses an observer with `rootMargin: 0`; preload proximity uses a separate observer with `rootMargin: 300px 0px`. Preload state never selects the winner.
- At most one video plays. LIGHTBOX active media has priority; all other ties use stable DOM/layout order.
- All automatic playback is muted and `playsInline`.
- `TEASER` loops, has custom controls, and removes its source/decoder offscreen. `CONTENT` plays once with native controls and retains time. `LIGHTBOX` owns priority while active. `HERO` uses the same coordinator.
- `prefers-reduced-motion` and Save-Data disable automatic source loading/play; explicit user Play may override while remaining singleton.
- `document.hidden` pauses all players and clears manual intent; returning visible never resurrects protected manual playback.
- Programmatic pause/play events must not become manual intent. Ignore stale play promises by instance/source/command generations.
- Review media compatibility returns both structured `media` and legacy `photos`; legacy photos-only writes replace IMAGE rows only and preserve VIDEO rows.
- Homepage Category Tile, Room Scene, UGC, and Product Story remain `HomepageSection.payload` JSON; no dedicated Prisma tables.
- New Homepage VIDEO requires a poster. Compatibility responses project IMAGE URL or VIDEO poster into legacy `imageUrl`, never the video URL.
- Explicit `media:null` for Room/UGC/Product Story clears media and projected alias atomically; Category override deletion intentionally falls back to global Category image.
- Once UGC IDs exist, revisionless/missing/duplicate-ID whole-list writes are rejected for IMAGE and VIDEO.
- After the first Homepage media write, the media-aware compatibility backend is the rollback floor. An older backend may not receive Homepage CMS writes.
- Write a failing test and observe the expected failure before every production change.
- Before changing the Storefront root layout, Server/Client Component boundary, dynamic route, or test harness route, read the relevant local guide under `frontend/node_modules/next/dist/docs/`; this repository uses Next.js 16 breaking APIs.
- Production migration/backfill requires a backup and explicit database risk-gate approval.

## Delivered Interfaces

```ts
export type PlaybackMode = "TEASER" | "CONTENT" | "LIGHTBOX" | "HERO";
export type PlaybackStopReason =
  | "WINNER_CHANGED"
  | "OUT_OF_VIEW"
  | "DOCUMENT_HIDDEN"
  | "MANUAL_PAUSE"
  | "ENDED"
  | "UNMOUNTED"
  | "SOURCE_CHANGED";

export type PlaybackCommand =
  | { type: "PLAY"; commandGeneration: number; manual: boolean }
  | { type: "PAUSE"; commandGeneration: number; reason: PlaybackStopReason }
  | { type: "EVICT_SOURCE"; commandGeneration: number };

export interface ViewportPlaybackRegistration {
  mediaId: string;
  videoElement: HTMLVideoElement;
  visibilityElement: Element;
  mode: PlaybackMode;
  active: boolean;
  sourceGeneration: number;
  layoutOrder?: number;
  onCommand(command: PlaybackCommand): void;
}

export type PlaybackRegistrationPatch = Partial<
  Pick<
    ViewportPlaybackRegistration,
    "mediaId" | "mode" | "active" | "sourceGeneration" | "layoutOrder"
  >
>;

export interface ViewportPlaybackController {
  register(input: ViewportPlaybackRegistration): string;
  update(token: string, patch: PlaybackRegistrationPatch): void;
  unregister(token: string): void;
  requestManualPlay(token: string): void;
  requestManualPause(token: string): void;
  notifyEnded(token: string): void;
}
```

```ts
export interface ViewportVideoTracking {
  placement:
    | "pdp_gallery"
    | "pdp_detail"
    | "pdp_lightbox"
    | "review"
    | "product_card"
    | "homepage_hero"
    | "homepage_category_tile"
    | "homepage_room_scene"
    | "homepage_ugc"
    | "homepage_product_story";
  productId?: string;
  variantId?: string;
  reviewId?: string;
  homepageSectionId?: string;
  sceneOrEntryId?: string;
}

export interface ViewportVideoProps {
  id: string;
  src: string;
  poster?: string | null;
  label: string;
  mode: PlaybackMode;
  active?: boolean;
  className?: string;
  layoutOrder?: number;
  onExpand?: () => void;
  tracking: ViewportVideoTracking;
}
```

```ts
export type MarketingMedia =
  | { type: "IMAGE"; url: string; posterUrl?: never }
  | { type: "VIDEO"; url: string; posterUrl: string };

export interface ProductReviewMedia {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  posterUrl: string | null;
  altText: string | null;
  sortOrder: number;
}

export interface SaveHomepageSectionInput {
  id?: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: Record<string, unknown> | null;
}

export interface AdminHomepageSection extends SaveHomepageSectionInput {
  id: string;
  contentRevision: string;
}

export interface SaveHomepageSectionsRequest {
  sections: SaveHomepageSectionInput[];
  expectedContentRevisions: Record<string, string>;
}
```

---

### Task 1: Product Posters and Additive Review Media Schema

**Files:**
- Modify: `backend/prisma/schema/catalog.prisma`
- Create: `backend/prisma/migrations/20260921130000_add_viewport_media/migration.sql`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/products.service.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.update.spec.ts`

**Interfaces:**
- Consumes phase-1 `ProductImage` scopes.
- Produces nullable product/detail posters and additive `ProductReviewMedia` without dropping `photos`.

- [ ] **Step 1: Write failing product poster round-trip tests**

```ts
it("round-trips posterUrl for product and detail videos", async () => {
  const saved = await service.update(productId, {
    images: [{ type: "VIDEO", url: videoUrl, posterUrl, sortOrder: 0 }],
    detailBlocks: [{ type: "VIDEO", url: detailVideoUrl, posterUrl, sortOrder: 0 }],
  });
  expect(saved.images[0].posterUrl).toBe(posterUrl);
  expect(saved.detailBlocks[0].posterUrl).toBe(posterUrl);
});
```

Also verify IMAGE rows clear/ignore poster, scoped identity remains unchanged, and existing video without poster remains readable during compatibility.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/catalog/products.service.spec.ts src/modules/catalog/products.service.update.spec.ts
```

Expected: FAIL because poster columns and review media model do not exist.

- [ ] **Step 3: Add nullable poster columns and review-media table**

Add `posterUrl` to `ProductImage`/`ProductDetailBlock`. Add `ProductReviewMedia` with review FK, `DetailBlockType`, URL, nullable poster/alt, sort order, timestamps, and cascade-on-review-delete. Keep `ProductReview.photos`.

- [ ] **Step 4: Validate, generate, migrate, test, and typecheck**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_test?schema=public" pnpm --dir backend exec prisma migrate deploy
pnpm --dir backend exec vitest run src/modules/catalog/products.service.spec.ts src/modules/catalog/products.service.update.spec.ts
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema/catalog.prisma backend/prisma/migrations/20260921130000_add_viewport_media/migration.sql backend/src/modules/catalog/dto/product.dto.ts backend/src/modules/catalog/products.service.ts backend/src/modules/catalog/products.service.spec.ts backend/src/modules/catalog/products.service.update.spec.ts
git commit -m "feat(api): add product posters and review media schema"
```

---

### Task 2: Review Media Compatibility API and Backfill

**Files:**
- Modify: `backend/src/modules/catalog/dto/review.dto.ts`
- Create: `backend/src/modules/catalog/dto/review.dto.spec.ts`
- Modify: `backend/src/modules/catalog/review-utils.ts`
- Modify: `backend/src/modules/catalog/review-utils.spec.ts`
- Modify: `backend/src/modules/catalog/reviews.service.ts`
- Modify: `backend/src/modules/catalog/reviews.service.spec.ts`
- Create: `backend/scripts/backfill-review-media.ts`
- Create: `backend/scripts/audit-viewport-media.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces structured `media[]`, legacy `photos[]`, dual-read/write, and idempotent audit/backfill.

- [ ] **Step 1: Write failing compatibility tests**

```ts
it("lets a photos-only write replace images without deleting videos", async () => {
  await service.adminUpdate(reviewId, { photos: [newImageUrl] });
  const review = await service.adminGet(reviewId);
  expect(review.media).toEqual([
    expect.objectContaining({ type: "IMAGE", url: newImageUrl }),
    expect.objectContaining({ type: "VIDEO", url: existingVideoUrl }),
  ]);
});
```

Cover six ordered media, invalid URL/type, new media→ordered IMAGE photos projection, row-first read, photos fallback, verified/helpful/date retention, and VIDEO modification only through explicit media payload.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/catalog/dto/review.dto.spec.ts src/modules/catalog/review-utils.spec.ts src/modules/catalog/reviews.service.spec.ts
```

- [ ] **Step 3: Implement transactional dual-read/write and backfill scripts**

```ts
export const productReviewMediaInputSchema = z.discriminatedUnion("type", [
  reviewImageInputSchema,
  reviewVideoInputSchema,
]);
```

New-media writes replace all media and project IMAGE URLs to photos in the same transaction. Legacy photos writes replace only IMAGE rows. Reads prefer rows and synthesize IMAGE media from photos only when rows are absent.

Backfill with set-based `unnest(photos) WITH ORDINALITY`, skip reviews already containing rows, and audit URL/order/count equality.

- [ ] **Step 4: Verify tests and audit**

```bash
pnpm --dir backend exec vitest run src/modules/catalog/dto/review.dto.spec.ts src/modules/catalog/review-utils.spec.ts src/modules/catalog/reviews.service.spec.ts
pnpm --dir backend run audit:viewport-media -- --check
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/catalog/dto/review.dto.ts backend/src/modules/catalog/dto/review.dto.spec.ts backend/src/modules/catalog/review-utils.ts backend/src/modules/catalog/review-utils.spec.ts backend/src/modules/catalog/reviews.service.ts backend/src/modules/catalog/reviews.service.spec.ts backend/scripts/backfill-review-media.ts backend/scripts/audit-viewport-media.ts backend/package.json
git commit -m "feat(api): serve structured review media compatibly"
```

---

### Task 3: Homepage Marketing Media and Revision-Safe Backend

**Files:**
- Modify: `backend/src/modules/cms/dto/homepage-section.dto.ts`
- Modify: `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`
- Create: `backend/src/modules/cms/homepage-media.ts`
- Create: `backend/src/modules/cms/homepage-media.spec.ts`
- Modify: `backend/src/modules/cms/homepage.service.ts`
- Modify: `backend/src/modules/cms/homepage.service.spec.ts`

**Interfaces:**
- Produces `MarketingMedia`, `contentRevision`, safe merge/projection, stable UGC UUIDs, and named conflicts.

- [ ] **Step 1: Write failing homepage media/revision tests**

```ts
it("projects a category video poster for old Storefront clients", async () => {
  const section = await service.storefrontGet(categoryVideoFixture);
  expect(section.categories[0].media).toEqual(categoryVideo);
  expect(section.categories[0].imageUrl).toBe(categoryVideo.posterUrl);
  expect(categoryRepository.update).not.toHaveBeenCalled();
});
```

Cover VIDEO required poster, IMAGE reject poster, category override with null/non-null global image, omission preserve, media:null alias clear→reread, Room hotspot media validation, UGC UUID/reorder, missing/duplicate IDs, stale revision, old write preservation, and effective legacy projection.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/cms/dto/homepage-section.dto.spec.ts src/modules/cms/homepage-media.spec.ts src/modules/cms/homepage.service.spec.ts
```

- [ ] **Step 3: Implement shared schema, merge, projection, and optimistic save**

```ts
export type MarketingMedia =
  | { type: "IMAGE"; url: string }
  | { type: "VIDEO"; url: string; posterUrl: string };

export interface SaveHomepageSectionsCompatibilityInput {
  sections: SaveHomepageSectionInput[];
  expectedContentRevisions?: Record<string, string>;
}
```

Keep routes unchanged. Compare all loaded revisions inside the save transaction. Omitted media preserves; explicit null clears media and alias; Category deletion falls back globally. Merge Room by scene ID and UGC by unique UUID, never array position. Return `HOMEPAGE_CONTENT_CONFLICT` or `CMS_MEDIA_REVISION_REQUIRED` as specified.

- [ ] **Step 4: Verify backend media compatibility**

```bash
pnpm --dir backend exec vitest run src/modules/cms/dto/homepage-section.dto.spec.ts src/modules/cms/homepage-media.spec.ts src/modules/cms/homepage.service.spec.ts
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend build
```

- [ ] **Step 5: Commit and mark rollback floor candidate**

```bash
git add backend/src/modules/cms
git commit -m "feat(api): protect homepage marketing media writes"
```

Do not enable Homepage media editing until this build is verified and recorded as the minimum rollback backend.

---

### Task 4: Product and Review Admin Media Editors

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/components/admin/ProductForm.gallery.spec.ts`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/reviews/page.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/reviews/batch-reviews-grid-dialog.tsx`
- Create: `frontend/src/lib/review-media-form.ts`
- Create: `frontend/src/lib/review-media-form.spec.ts`

**Interfaces:**
- Consumes existing `ImageUrlInput` for image/video/poster uploads.
- Produces poster editing and six ordered review media slots.

- [ ] **Step 1: Write failing Admin serialization/editor tests**

Verify video poster preservation, IMAGE poster stripping, legacy video warning/no block, six ordered review media, TSV photos→IMAGE media, batch ordering, and verified purchase invariants.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/admin/ProductForm.gallery.spec.ts src/lib/review-media-form.spec.ts
```

- [ ] **Step 3: Extend product/review editors without duplicating upload validation**

Add poster URL/upload only for VIDEO, poster preview, labels, and legacy warning. Replace review photo slots with typed media slots; keep TSV photo compatibility.

- [ ] **Step 4: Verify frontend tests and types**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/admin-api.ts frontend/src/components/admin/ProductForm.tsx frontend/src/components/admin/ProductForm.gallery.spec.ts frontend/src/app/admin/'(shell)'/products/'[id]'/reviews frontend/src/lib/review-media-form.ts frontend/src/lib/review-media-form.spec.ts
git commit -m "feat(admin): edit product and review video posters"
```

---

### Task 5: Homepage Marketing Media Editor and Stale-Save UX

**Files:**
- Create: `frontend/src/lib/media.ts`
- Create: `frontend/src/lib/homepage-media.ts`
- Create: `frontend/src/lib/homepage-media.spec.ts`
- Create: `frontend/src/components/admin/MarketingMediaEditor.tsx`
- Create: `frontend/src/components/admin/MarketingMediaEditor.spec.tsx`
- Modify: `frontend/src/components/admin/RoomSceneEditor.tsx`
- Create: `frontend/src/components/admin/RoomSceneEditor.spec.tsx`
- Modify: `frontend/src/app/admin/(shell)/homepage/page.tsx`
- Modify: `frontend/src/lib/admin-api.ts`

**Interfaces:**
- Produces typed Homepage payloads, explicit null clear, revision map, stable UGC UUIDs, and one shared media editor.

- [ ] **Step 1: Write failing normalization/editor/conflict tests**

```ts
it("projects the poster rather than the video URL for compatibility", () => {
  expect(serializeMarketingMedia({
    type: "VIDEO",
    url: videoUrl,
    posterUrl,
  })).toEqual({
    media: { type: "VIDEO", url: videoUrl, posterUrl },
    imageUrl: posterUrl,
  });
});
```

Cover legacy image deserialize, explicit null, sanitize preservation, revision map all IDs, Category overrides, Room fixed ratio/hotspots, UGC UUIDs, named 409 banner, no blind retry, and unsaved draft retention.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/homepage-media.spec.ts src/components/admin/MarketingMediaEditor.spec.tsx src/components/admin/RoomSceneEditor.spec.tsx
```

- [ ] **Step 3: Implement shared editor and media-aware sanitize/save**

Use IMAGE/VIDEO selector, matching `ImageUrlInput`, required poster for video, no Admin autoplay, and poster-only preview. `sanitizePayload` must explicitly retain media/categoryMedia/UGC IDs/null clears. Save `{sections, expectedContentRevisions}` and keep draft on conflict.

- [ ] **Step 4: Verify frontend and production build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/media.ts frontend/src/lib/homepage-media.ts frontend/src/lib/homepage-media.spec.ts frontend/src/components/admin/MarketingMediaEditor.tsx frontend/src/components/admin/MarketingMediaEditor.spec.tsx frontend/src/components/admin/RoomSceneEditor.tsx frontend/src/components/admin/RoomSceneEditor.spec.tsx frontend/src/app/admin/'(shell)'/homepage/page.tsx frontend/src/lib/admin-api.ts
git commit -m "feat(admin): edit homepage marketing media safely"
```

---

### Task 6: Playback Coordinator, Shared Observers, and ViewportVideo

**Files:**
- Create: `frontend/src/components/media/viewport-playback.ts`
- Create: `frontend/src/components/media/viewport-playback.spec.ts`
- Create: `frontend/src/components/media/ViewportPlaybackProvider.tsx`
- Create: `frontend/src/components/media/ViewportPlaybackProvider.spec.tsx`
- Create: `frontend/src/components/media/ViewportVideo.tsx`
- Create: `frontend/src/components/media/ViewportVideo.spec.tsx`
- Create: `frontend/src/lib/media-tracking.ts`
- Modify: `frontend/src/app/(storefront)/layout.tsx`

**Interfaces:**
- Produces the exact provider/controller/player interfaces declared above.

- [ ] **Step 1: Write failing pure coordinator and provider tests**

```ts
it("chooses the highest eligible ratio and pauses the old winner first", () => {
  const state = registerVisiblePlayers([
    { token: "first", ratio: 0.7 },
    { token: "second", ratio: 0.9 },
  ]);
  expect(selectWinner(state)).toBe("second");
  expect(commandLog).toEqual([
    { token: "first", type: "PAUSE" },
    { token: "second", type: "PLAY" },
  ]);
});
```

Cover 0.6 threshold, stable DOM tie, manual protected-mode override singleton, hidden clearing manual intent, same-source attach not identity change, stale generations, duplicate media instances, unregister isolation, rejected play silence, and exactly two shared playback/preload observers for many players.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/media/viewport-playback.spec.ts src/components/media/ViewportPlaybackProvider.spec.tsx src/components/media/ViewportVideo.spec.tsx
```

- [ ] **Step 3: Implement pure state machine, root provider, and mode-driven player**

Playback observer thresholds are `[0, 0.25, 0.6, 0.75, 1]` with `rootMargin: "0px"`; preload observer uses `rootMargin: "300px 0px"`. Generate `instanceToken` per mount. Track command/source generations and command origin. Derive loop/controls/preload/source policy from mode; callers cannot supply contradictory booleans.

- [ ] **Step 4: Verify media tests, typecheck, and build**

```bash
pnpm --dir frontend exec vitest run src/components/media
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/media frontend/src/lib/media-tracking.ts frontend/src/app/'(storefront)'/layout.tsx
git commit -m "feat(storefront): coordinate viewport video playback"
```

---

### Task 7: PDP Gallery, Lightbox, Detail, and Review Playback

**Files:**
- Modify: `frontend/src/components/product/ProductGallery.tsx`
- Create: `frontend/src/components/product/ProductGallery.spec.tsx`
- Modify: `frontend/src/components/product/ProductLightbox.tsx`
- Create: `frontend/src/components/product/ProductLightbox.spec.tsx`
- Modify: `frontend/src/components/product/ProductDetailBody.tsx`
- Create: `frontend/src/components/product/ProductDetailBody.spec.tsx`
- Modify: `frontend/src/components/product/ReviewCard.tsx`
- Create: `frontend/src/components/product/ReviewCard.spec.tsx`
- Modify: `frontend/src/components/product/PdpClient.tsx`

**Interfaces:**
- Consumes phase-1 scoped media and Task 6 player.
- Produces TEASER Gallery, LIGHTBOX active media, and CONTENT Detail/Review.

- [ ] **Step 1: Write failing placement tests**

Verify Gallery active video TEASER, thumbnail poster/no video source, independent Expand/Play controls without nesting, Lightbox priority/background pause/close release, Detail/Review CONTENT/no loop/controls, media-scope source generation reset, and Helpful/Report operability.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/ProductGallery.spec.tsx src/components/product/ProductLightbox.spec.tsx src/components/product/ProductDetailBody.spec.tsx src/components/product/ReviewCard.spec.tsx
```

- [ ] **Step 3: Replace direct videos with ViewportVideo**

Gallery current VIDEO uses TEASER. Thumbnails render poster image/badge only. Lightbox current VIDEO uses LIGHTBOX and releases on close/change. Detail and selected Review VIDEO use CONTENT and retain native controls.

- [ ] **Step 4: Verify components and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product
git commit -m "feat(storefront): autoplay PDP and review media"
```

---

### Task 8: Product Card Effective-Cover Playback

**Files:**
- Modify: `frontend/src/components/product/ProductCard.tsx`
- Create: `frontend/src/components/product/ProductCard.spec.tsx`
- Modify: `frontend/src/components/product/PlpProductCard.tsx`
- Modify: `frontend/src/components/product/PlpProductCard.spec.tsx`
- Modify: `frontend/src/components/home/RecentlyViewed.tsx`

**Interfaces:**
- Consumes phase-1 `effectiveCoverMedia` and Task 6 TEASER.
- Produces one card media abstraction inherited by Home/Search/Category/Collection/Related/Recently Viewed.

- [ ] **Step 1: Write failing card tests**

Verify effective cover instead of `images[0]`, VIDEO→TEASER, IMAGE unchanged, variant cover source generation reset, source eviction offscreen, link/Quick Add/Play controls not nested, and no media duplication in consumers.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/ProductCard.spec.tsx src/components/product/PlpProductCard.spec.tsx
```

- [ ] **Step 3: Add the type-aware card media island**

Keep card/server layout unchanged; render IMAGE normally and VIDEO through `ViewportVideo` TEASER. Quick Add header remains poster-only and does not register playback.

- [ ] **Step 4: Verify all card consumers and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product/ProductCard.tsx frontend/src/components/product/ProductCard.spec.tsx frontend/src/components/product/PlpProductCard.tsx frontend/src/components/product/PlpProductCard.spec.tsx frontend/src/components/home/RecentlyViewed.tsx
git commit -m "feat(storefront): autoplay effective product covers"
```

---

### Task 9: Hero and Homepage Marketing Placement Playback

**Files:**
- Create: `frontend/src/components/media/MarketingMediaView.tsx`
- Create: `frontend/src/components/media/MarketingMediaView.spec.tsx`
- Modify: `frontend/src/components/home/HeroSection.tsx`
- Modify: `frontend/src/components/home/CategoryTilesSection.tsx`
- Modify: `frontend/src/components/home/RoomInspirationSection.tsx`
- Modify: `frontend/src/components/home/RoomSceneGallery.tsx`
- Create: `frontend/src/components/home/RoomSceneGallery.spec.tsx`
- Modify: `frontend/src/components/home/room-scenes.ts`
- Modify: `frontend/src/components/home/room-scenes.spec.ts`
- Modify: `frontend/src/components/home/UgcSection.tsx`
- Modify: `frontend/src/components/home/ProductStorySection.tsx`

**Interfaces:**
- Produces IMAGE/VIDEO marketing island; Category/Room TEASER; UGC/Story CONTENT; Hero HERO.

- [ ] **Step 1: Write failing marketing placement tests**

```tsx
it("keeps only the active Room scene eligible and its hotspots clickable", async () => {
  render(<RoomSceneGallery scenes={videoScenes} />);
  expect(getPlayer("scene-a")).toHaveAttribute("data-active", "true");
  await user.click(screen.getByRole("button", { name: "Open Red Chair" }));
  expect(screen.getByRole("dialog", { name: "Red Chair" })).toBeVisible();
});
```

Cover legacy image fallback, Category/Room TEASER, UGC/Story CONTENT, Hero mode, poster-only scene thumbnails, fixed 16:10 hotspots, active-scene only, independent links/controls, server-rendered shells, and one root winner.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/media/MarketingMediaView.spec.tsx src/components/home/room-scenes.spec.ts src/components/home/RoomSceneGallery.spec.tsx
```

- [ ] **Step 3: Implement marketing media island and migrate sections**

Server Components normalize/select media and retain layout/text/links. Only `MarketingMediaView` is client-side. RoomSceneGallery’s existing observer controls active scene/hotspots only; playback registration remains in the root Provider.

- [ ] **Step 4: Verify homepage tests and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/media/MarketingMediaView.tsx frontend/src/components/media/MarketingMediaView.spec.tsx frontend/src/components/home
git commit -m "feat(storefront): autoplay homepage marketing media"
```

---

### Task 10: Browser, Resource, Accessibility, and Performance Gate

**Files:**
- Modify: `frontend/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `frontend/playwright.config.ts`
- Create: `frontend/e2e/viewport-media.spec.ts`
- Create: `frontend/e2e/homepage-stale-admin.spec.ts`
- Create: `frontend/e2e/media-performance.spec.ts`
- Create: `frontend/lighthouserc.cjs`
- Create: `frontend/src/app/__e2e/viewport-media/page.tsx`
- Modify: `backend/prisma/seed-e2e.ts`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Produces observable resource/playback assertions and rollback-floor runbook.

- [ ] **Step 1: Add test dependencies and failing browser scenarios**

```bash
pnpm --dir frontend add -D @axe-core/playwright @lhci/cli
```

Write scenarios for highest ratio/DOM tie, exactly one playback and one preload observer, Room interaction observer isolation, manual winner handoff, hidden-tab manual clear, TEASER source eviction vs CONTENT retention, Room switch/hotspots, stale Admin 409/no erasure, reduced motion, Save-Data, Slow 4G request audit, keyboard/axe, and zero play-promise console errors.

- [ ] **Step 2: Run and verify RED**

```bash
MEDIA_E2E_HARNESS=1 pnpm --dir frontend exec playwright test e2e/viewport-media.spec.ts e2e/homepage-stale-admin.spec.ts e2e/media-performance.spec.ts
```

Expected: FAIL until instrumentation/fixtures and every placement are complete.

- [ ] **Step 3: Add gated harness, deterministic fixtures, and performance scripts**

The `/__e2e/viewport-media` route must return 404 unless `MEDIA_E2E_HARNESS=1`. Add fixtures for multiple same-media instances, each playback mode, scoped variants, review videos, Category/Room/UGC/Story videos, and stale revisions. Add `test:browser:media` and `perf:media` scripts.

Capture a pre-change Lighthouse median. Fail on LCP regression over 10%, CLS increase over 0.02, or any non-winner initial video transfer.

Document the compatibility backend SHA as Homepage media rollback floor; if it fails after media writes, disable Homepage CMS PATCH and forward-fix or reverse-project/audit before an older backend writes.

- [ ] **Step 4: Run the complete phase gate**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
pnpm --dir backend test
pnpm --dir backend test:e2e
pnpm --dir backend lint
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend build
pnpm --dir frontend test
pnpm --dir frontend lint
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
MEDIA_E2E_HARNESS=1 pnpm --dir frontend run test:browser:media
pnpm --dir frontend run perf:media
pnpm --dir frontend exec lhci autorun --config=./lighthouserc.cjs
```

Expected: all exit 0, only one winner plays, and no non-winner video transfers initially.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/playwright.config.ts frontend/e2e frontend/lighthouserc.cjs frontend/src/app/__e2e backend/prisma/seed-e2e.ts docs/DEPLOYMENT.md
git commit -m "test(storefront): gate viewport media resources and behavior"
```

## Phase 3 Completion Gate

- All Task 10 commands pass from a clean test database and production build.
- Chrome desktop, WebKit/Safari behavior, and 375/768/1280 viewports are manually verified.
- Gallery, Detail, Review, cards, Hero, Category Tile, Room Scene, UGC, and Product Story all use one coordinator.
- Reduced motion, Save-Data, hidden tab, failed autoplay, and no-JS/poster fallbacks remain usable.
- Slow 4G shows no batch video preload and no meaningful LCP/CLS regression.
- Review IMAGE dual-read/write and Homepage legacy image projections pass audits.
- Compatibility backend is recorded as the Homepage media rollback floor before enabling media writes.
- Production migration/backfill/deployment waits for explicit database risk-gate approval.
