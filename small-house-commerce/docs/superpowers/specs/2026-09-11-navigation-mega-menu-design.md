# Navigation Mega Menu + Category Tree — Design Spec

**Date:** 2026-09-11
**Status:** Approved by user (chat, 2026-09-11)
**Reference UX:** https://www.castlery.com/sg — desktop hover mega menu; mobile left-side drawer with accordion subcategories and thumbnail rows.

## Goal

Restructure the storefront top navigation into a Castlery-style system:

1. Announcement (promo) bar moves to the very top of **every** page; the header sits below it and sticks.
2. Desktop: root categories open a full-width hover/focus **mega menu** (subcategory links left, image cards right).
3. Mobile: a hamburger opens a **left-side slide-in drawer**; tapping a root expands its subcategories in rows with thumbnail images.
4. Subcategories are a real **two-level category tree** with real `/categories/[slug]` landing pages.

## Constraints (standing)

- No new npm dependencies (frontend or backend).
- Images come later: `imageUrl` is nullable; empty state = beige placeholder block, never a broken `<img>`.
- No wishlist heart; no search/account in V1 (cart icon only).
- No fake data: empty categories show a real empty state on their landing page.
- Promo copy unchanged: "Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide".
- Backend storefront responses must never expose `supplierSku/supplierCost/costCurrency/landedCost` or review internals.
- `docs/frontend/HOMEPAGE_SPEC.md` is never committed.

## 1. Information architecture

Top-level order (per HOMEPAGE_SPEC §6):

| Item | Type | Target |
|---|---|---|
| New Arrivals | flat link | `/collections/new-arrivals` |
| Storage & Organization | root category | `/categories/storage-organization` + mega/drawer |
| Tables & Desks | root category | `/categories/tables-desks` + mega/drawer |
| Chairs & Stools | root category | `/categories/chairs-stools` + mega/drawer |
| Bedroom Essentials | root category | `/categories/bedroom-essentials` + mega/drawer |
| Solutions | flat link | `/collections/small-space-solutions` |
| Best Sellers | flat link | `/collections/best-sellers` |

Two-level tree (4 roots, 16 leaves):

- **Storage & Organization** (`storage-organization`): Shelving & Racks (`shelving-racks`), Cabinets & Drawers (`cabinets-drawers`), Wardrobes (`wardrobes`), Shoe Racks (`shoe-racks`), Kitchen & Bathroom Storage (`kitchen-bathroom-storage`)
- **Tables & Desks** (`tables-desks`): Dining Tables (`dining-tables`), Desks (`desks`), Coffee & Side Tables (`coffee-side-tables`), Folding Tables (`folding-tables`)
- **Chairs & Stools** (`chairs-stools`): Dining Chairs (`dining-chairs`), Office Chairs (`office-chairs`), Stools & Bar Stools (`stools-bar-stools`), Benches (`benches`)
- **Bedroom Essentials** (`bedroom-essentials`): Bed Frames (`bed-frames`), Mattresses (`mattresses`), Bedside Tables (`bedside-tables`), Bedroom Storage (`bedroom-storage`)

The pre-existing stray root `Chairs` (`chairs`) is removed by the seed (no products attached).

The 12 demo products are remapped to leaves by name match (mapping executed and recorded by the seed script; products with no sensible match keep their current assignment if it lands inside the new tree, otherwise Shelving & Racks as the generic storage leaf).

## 2. Backend changes

### 2.1 Schema — `Category.imageUrl`

`backend/prisma/schema/catalog.prisma`, model `Category`:

```prisma
imageUrl String? @map("image_url")
```

New Prisma migration `add_category_image_url`; regenerate client.

### 2.2 Storefront category tree

`storefrontTree()` already returns full category rows, so `imageUrl` flows through with no DTO change. Frontend `Category` type gains `imageUrl: string | null`.

### 2.3 Subtree product filtering

`ProductsService.storefrontList` (storefront only; admin stays exact-match): when `categoryId` matches a category with descendants, filter `categoryId IN [id, ...descendantIds]`. Descendants resolved with one `findMany` over ACTIVE categories (trees are shallow; in-memory walk). Unknown/leaf ids behave exactly as today (single id).

Unit tests (vitest): root id returns products attached to a leaf; leaf id returns only its own; unknown id behaves as single-id match.

## 3. Seeding

New idempotent script `backend/prisma/seed-categories.ts` (run via `tsx`, same runner as `seed.ts`):

- Upsert the 4 roots + 16 leaves by slug (parentId, sortOrder from array order, status ACTIVE, imageUrl null).
- Delete the stray `chairs` slug only if it has no products.
- Remap the 12 demo products: match by slug/name keywords to leaves; print the applied mapping.
- Never delete products; wrap category upserts + product updates in a transaction.

## 4. Frontend — chrome

### 4.1 Announcement bar

New `components/layout/AnnouncementBar.tsx` (server component, static markup): `bg-cta px-4 py-2 text-center text-xs font-medium text-white sm:text-sm`, existing copy. Rendered at the top of `<body>` in `app/layout.tsx`, before `<Header>`. Removed from `app/page.tsx`. Scrolls away (not sticky); `<Header>` remains `sticky top-0`.

### 4.2 Data loading

`app/layout.tsx` fetches both, 300s revalidate, failure-tolerant (`[]`):

- `/api/v1/storefront/categories` — the 4-root tree (mega/drawer data).
- Flat links: keep the NAVIGATION collection fetch; add the two known system/scenario slugs from constants rather than a new endpoint. Flat-link definitions:

```ts
[
  { kind: "link", label: "New Arrivals", href: "/collections/new-arrivals", position: 0 },
  { kind: "tree", ...root, position: 1..4 },
  { kind: "link", label: "Solutions", href: "/collections/small-space-solutions", position: 5 },
  { kind: "link", label: "Best Sellers", href: "/collections/best-sellers", position: 6 },
]
```

The nav model is composed in a small pure helper `lib/nav.ts` (`buildNav(roots, navCollections)`): flat links render only when their backing collection exists; tree roots in tree order; merged and sorted by position. Unit-testable without React.

### 4.3 Header

Stays a server component composing: logo (left on desktop; center on mobile), `MainNav` island, cart icon. Mobile row: hamburger (left), logo center, cart right. Desktop row unchanged apart from nav content.

### 4.4 MainNav island — desktop mega menu

`components/layout/MainNav.tsx` ("use client") containing desktop + mobile pieces.

- One open panel at a time; state = root id | null.
- Hover intent: `onMouseEnter` root/panel opens with ~120ms close delay on leave, so diagonal mouse travel root→panel doesn't close; keyboard focus on the root link or any child opens; Escape closes and returns focus to the root; click outside closes.
- Panel: full-width bar directly under header (`absolute inset-x-0`, inside the sticky header's positioning context), border + shadow, `bg-background`.
  - Left: root name as "View all {root}" link, then leaf links in up to 2 columns.
  - Right: 3 image cards for the first 3 leaves (`<Image>`-free plain `<img>` with loading lazy is acceptable in this codebase? — no: use Next.js `next/image` consistent with existing ProductCard if ProductCard uses it; otherwise plain img to match). Each card: image/placeholder + label + arrow; links to the leaf.
- Placeholder: `bg-primary-light/50` block with the leaf name centered in `text-ink-muted` when `imageUrl` is null.
- ARIA: root is a button-expanded composite: root link + small disclosure chevron button (`aria-expanded`, `aria-controls`); panel `role="menu"`-like region labelled by root; links are real `<Link>`s. Full keyboard: Tab/Shift-Tab through, Esc close.

### 4.5 MainNav island — mobile drawer

- Hamburger button (`aria-label="Open menu"`, `aria-expanded`, `aria-controls`).
- Drawer: `fixed inset-y-0 left-0 w-[85%] max-w-[380px]`; translate-x transition; backdrop `fixed inset-0 bg-black/50`.
- Body scroll lock while open; Escape closes; backdrop click closes; focus trap inside while open; initial focus on the close button; focus returns to hamburger on close. `prefers-reduced-motion`: disable translate/opacity transitions (instant).
- Content: flat links as simple rows; root rows with chevron; accordion expands leaf rows **in place**, each leaf row = name (left) + 64×64 thumbnail (right, placeholder when null). Only one root expanded at a time (Castlery behavior); tapping the root label itself navigates to the root landing page, chevron toggles — the whole row is a button that toggles, with a separate small "View all" link at the top of the expanded section to reach the root page (avoids tap-target ambiguity).

## 5. Category landing page

New route `frontend/src/app/categories/[slug]/page.tsx`:

- Fetch category tree (300s); find node by slug anywhere in tree → `notFound()` if missing.
- Fetch `/api/v1/storefront/products?categoryId=<id>&page=&pageSize=24` (subtree expansion backend-side), same room/solution/price filters as collection page, reusing `CollectionFilters` with a `basePath` prop (`/categories/${slug}`) — small prop addition; defaults stay collection-compatible.
- Layout mirrors collection page: simple header (name + leaf chip links for roots; parent link for leaves), product grid via `ProductCard`, pagination, empty state "No products in this category yet."
- `generateMetadata`: title = category name; root pages get "Shop {name} …".
- `revalidate = 120`.

PDP breadcrumb category name lookup is unaffected (still resolves by id in the tree).

## 6. Files

**Backend**
- Modify: `prisma/schema/catalog.prisma` (+migration dir), `src/modules/catalog/products.service.ts`
- Create: `prisma/seed-categories.ts`
- Test: `src/modules/catalog/products.subtree.spec.ts` (or nearest existing spec)

**Frontend**
- Create: `src/components/layout/AnnouncementBar.tsx`, `src/components/layout/MainNav.tsx`, `src/lib/nav.ts`, `src/app/categories/[slug]/page.tsx`
- Modify: `src/app/layout.tsx`, `src/components/layout/Header.tsx`, `src/app/page.tsx`, `src/lib/api.ts` (Category.imageUrl), `src/components/collection/CollectionFilters.tsx` (basePath)

## 7. Verification

1. Backend: `pnpm run lint && pnpm run build && pnpm exec vitest run`.
2. Run seed-categories; verify tree via storefront API and product remap log.
3. Frontend: `pnpm lint && pnpm exec tsc --noEmit && pnpm build`.
4. Chrome MCP live checks at localhost:3001: desktop hover mega menu (delay, click-through, Esc), keyboard only; 390px emulation: drawer slide-in, accordion thumbnail rows, focus trap/Esc/backdrop/scroll-lock; category pages (root = subtree products, leaf = own, empty leaf empty state); announcement bar present on PDP and cart too.
