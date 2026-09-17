# Task 6 — Acceptance Report (controller-run)

Plan: `docs/superpowers/plans/2026-09-15-room-scene-hotspots.md`
Spec: `docs/superpowers/specs/2026-09-15-room-scene-hotspots-design.md`
Branch: `feat/home-pdp` @ `0f44208`. Date: 2026-09-16.

## Verdict: PASS — all acceptance areas green; cleanup complete; no test data remains.

## Environment (isolated from user stacks)

- Backend: `node dist/main.js` on **:3010** against shared dev DB
  `postgresql://postgres:postgres@localhost:5432/small_house` (same DB as user
  stacks; **no migration** in this feature — payload-only JSONB).
- Frontend: `PORT=3002 API_TARGET=http://localhost:3010 npm run dev` on **:3002**
  (explicit `API_TARGET` required — default proxies to the user's stale :3000).
- User stacks verified alive and untouched throughout: :3000 (pid 94097),
  :3001 (55196), :3003 (84529), :3004 (68125).
- `prisma migrate status`: up to date, 16 migrations, no drift.

## Gates (at HEAD 0f44208)

- Backend: vitest **166 tests / 20 files pass**; `nest build` green; oxlint only
  the 3 pre-existing warnings.
- Frontend: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` green.

## A. Admin visual editor (`/admin/homepage`, ROOM_INSPIRATION) — PASS

Two scenes / four hotspots created entirely through the UI (image-by-URL field,
click-to-place on the preview image, product picker):

- Click placement on image records percentage coordinates; actual PATCH body
  shows values **clamped to 3–97 and rounded to 1 decimal** (e.g. 47.1 / 38.6,
  72.4 / 65.2; edge clicks landed as 3 / 97).
- Cancel in the product picker revokes the pending dot (no pending productId is
  ever saved; sanitizer strips `productId === ""`).
- Picker disables products already used **in the same scene**; the same product
  in a *different* scene stays selectable (fixture: shared product across
  scenes 1 and 2 saved fine).
- Per-dot delete; dot reposition via banner→click on image (no picker reopens).
- Scene delete uses Chinese `window.confirm`; ↑/↓ reorder works (↑ disabled on
  first scene — order restored via the other scene's ↑).
- 5-scene cap: at 5 scenes the "添加场景图" button is hidden.
- Save: PATCH returns 200 with the full 12-section replacement body.
- All Chinese helper copy present per constraint (新后台字段配中文操作提示).

## B. Backend DTO + hydration — PASS

- Storefront payload hydrates scenes with live product data: price,
  compareAtPrice, slug, name, images arrays joined per hotspot (fixture: scene 1
  → 3 hotspots, scene 2 → 1).
- **OOS product that is still ACTIVE is retained** as a dot (fixture T1 ZY,
  inventory 0 — dot + card render, card shows price; by design no add-to-cart
  affordance exists in the card anyway).
- Unresolvable/ghost productId is accepted by the admin save (raw payload kept)
  but **dropped from the storefront response** — no ghost dot, no 500.
- zod rejection messages verified verbatim over HTTP 400:
  - duplicate product in one scene:
    `Validation failed: payload.scenes.0.hotspots.3.productId: product appears twice in one scene`
  - 9 hotspots: hotspots `<=8 items`
  - 6 scenes: scenes `<=5 items`
- Room storefront section still carries legacy `products: []` joins; unrelated
  sections untouched.

## C. Storefront desktop (1280) — PASS

- Snap rail renders full-width 16:10 slides (1152px), white dots at percentage
  positions; desktop thumbnail strip under the rail; active thumbnail ring.
- Pop-in: IntersectionObserver ≥60% triggers once per scene; WAAPI animation
  end times measured at 260 / 350 / 440 ms = stagger 0 / 90 / 180 + 260 ms
  duration; ring layer delayed +120 ms. Re-scroll does not replay (played Set).
- `prefers-reduced-motion: reduce`: no `.hotspot-pop`/`.hotspot-ring` nodes,
  dots render at final opacity immediately.
- Product card (portal, fixed, 240px, 8px viewport clamp): name, image with
  PlaceholderImage fallback (fixture product has no image), price box
  `₱1,299.00` / struck `₱4,566.00` / **72% OFF** — PHP only, existing
  PriceBox component, no copy changes.
- Card href navigates to the correct PDP (`/products/t10-carrier-k9q2z7`).
- Near-viewport-bottom dot flips card **above** the dot (dot bottom 872–900 →
  card top 734–884) and stays on screen.
- Card closes on: overlay click, Esc (real keyboard event), rail scroll,
  window resize; second click on the open dot toggles shut.
- Thumbnail click scrolls rail (scrollLeft 1152 for slide 2).
- Tracking: card Link carries `data-track-event=ProductClick`,
  `data-section-id/-name`, and `data-section-position` **reset per scene**
  (1-based within the scene). Delegated document listener fires **exactly one**
  `trackCustom("ProductClick", …)` per click (the apparent 3735-call storm was a
  test-harness artifact: the forwarding wrapper re-entered Meta's partially
  broken fbevents.js; a non-forwarding wrapper proved single-fire; the console
  error originates in third-party fbevents.js, pre-existing). Pixel stays a
  no-op without `NEXT_PUBLIC_META_PIXEL_ID`; existing ViewContent/etc untouched.

## D. Storefront mobile (390×844 @3, touch emulation) — PASS

- Slides 358px; rail snaps; 240px card fits with 8px bounds (65→305px).
- Mobile indicator spans (`aria-hidden`) switch active state (w-4 bg-cta vs
  w-2 bg-border); desktop thumbnail strip hidden (`lg:flex`/`lg:hidden`).
- Esc closes card via real key press (synthetic KeyboardEvent does not trigger
  React listeners in this build — harness quirk, not product behavior).

## E. Legacy fallback — PASS

With ROOM payload restored to `{}` (cache-busted fetch, per known Next 16 dev
sticky-cache behavior), the section renders the old two-column image/body
layout ("Products coming soon…" placeholder path elsewhere unaffected) and
**zero** gallery/hotspot DOM nodes are emitted.

## Artifacts (this git-ignored SDD workspace)

- `shot-desktop-gallery.jpeg` — gallery + dot, desktop
- `shot-desktop-card.jpeg` — open product card (₱1,299 / ₱4,566 / 72% OFF)
- `shot-mobile-gallery.jpeg` — 390px rail + mobile indicators
- `shot-mobile-card.jpeg` — 390px card clamped in viewport

## Cleanup (mandatory, all verified)

1. ROOM_INSPIRATION payload PATCHed back to `{}` with all 12 sections;
   storefront **and** admin GET verify `payload: {}`, products 0, scenes 0.
   Diff audit of before/after admin GET: the other 11 sections are byte-for-byte
   identical (payload/title/subtitle/enabled/sortOrder/joins).
2. Throwaway admin `acc-shot-c404d615@smallhouse.test`
   (userId `01a0a871-30da-77dc-90c7-85046497eb05`): user + 1 user_role row +
   refresh token deleted via Prisma script; post-delete reads return null / 0;
   temp script removed from `backend/`.
3. chrome-devtools test page closed (only about:blank remains).
4. :3010 and :3002 stopped; both ports confirmed free; user stacks re-verified
   LISTENING.
5. All `/tmp` acceptance artifacts removed (tokens, payloads, logs, scripts).
6. No `.playwright-mcp` artifacts in the worktree; the pre-existing shared
   `codex建站/.playwright-mcp` contains 0 files dated today and was left
   untouched (belongs to earlier brand-lockup work).
7. `git status` clean at 0f44208.

## Notes / known harness quirks (not product defects)

- Next 16 dev fetch cache is sticky in dev; hard reload/query bust needed after
  admin saves (existing project memory).
- Playwright MCP screenshots hang at "waiting for fonts to load" in this
  environment and `browser_resize` doesn't change innerWidth; chrome-devtools
  MCP + CDP emulation used instead.
- :3002 must be started with `API_TARGET=http://localhost:3010` or it silently
  proxies to the user's stale :3000 (symptom: 0 dots with data saved).
