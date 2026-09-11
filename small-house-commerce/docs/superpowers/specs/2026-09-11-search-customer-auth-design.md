# Header Search (fuzzy) + Storefront Customer Auth — Design

Date: 2026-09-11
Status: approved in chat (user: 执行)
Reference: ikea.com/ph header (rounded search field, person account icon)

## 1. Scope and locked decisions

Two features ship together in one plan:

1. **Fuzzy product search** reachable from the header on desktop and mobile.
2. **Customer registration / login by email + password**, with a profile +
   order-history account area.

Locked answers (AskUserQuestion):

- Auth method: **email + password** (self-contained; no SMS provider).
- Account scope: **profile + order history** (no address book, no checkout
  changes this iteration).
- Mobile search: **search icon that reveals an input bar under the header**
  (not a persistent second row; not drawer-only).

Standing project constraints that apply:

- No new npm dependencies (backend already has `argon2`, `@nestjs/jwt`,
  `zod`; Postgres extension ≠ npm package).
- Storefront API must never expose `supplierSku / supplierCost /
  costCurrency / landedCost`, nor review internals
  `isVisible / source / verifiedOrderItemId`.
- No fake data; real empty states only.
- No wishlist/heart icon anywhere.
- COD copy stays exactly: delivery "Metro Manila 3–5 days, provinces
  5–7 days"; payment "Cash on Delivery". No installment pricing.

## 2. Current state (facts from code)

- Storefront product listing already accepts `search` but implements it as
  `name/slug ILIKE '%q%'` (`products.service.ts storefrontList`) — exact
  substring, zero typo tolerance.
- `Customer` is keyed by **normalized phone** (`normalizedPhone` unique,
  E.164), has nullable `name/email`, no password. Checkout upserts a
  Customer by phone. There is no customer-facing login.
- Admin auth exists: `POST /auth/login|refresh|logout`, `GET /auth/me`,
  argon2 hashes, opaque refresh token (sha256 stored, rotated),
  `JwtAuthGuard`. Config: `JWT_SECRET` (≥32 chars), `JWT_ACCESS_TTL`
  (default 1h), `JWT_REFRESH_TTL` (default 7d).
- Frontend has no auth pages. Browser calls use relative `/api/v1/...`
  (proxied, no CORS) via the `request<T>()` helper in `lib/api.ts`.
- Postgres runs in Docker (`postgres:18-alpine`, db `small_house`).
- Tests are pure vitest units (no DB integration harness exists).

## 3. Fuzzy product search — backend

### 3.1 Why pg_trgm

Rejected alternatives:

- Keep Prisma `contains`: cannot tolerate typos.
- Meilisearch / Typesense: a new service + dependency, overkill for a
  ~dozens-to-thousands of products catalog.

**pg_trgm** is a bundled Postgres extension (trigram similarity), zero new
services or npm packages.

### 3.2 Migration

New Prisma migration containing raw SQL:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS products_slug_trgm_idx
  ON products USING gin (slug gin_trgm_ops)
  WHERE status = 'ACTIVE';
```

Partial indexes cover only ACTIVE rows (everything the storefront can
match). The migration is applied with `prisma migrate dev`.

### 3.3 Matching semantics

Pure helper `buildTrgmSearch(tokens: string[])` (new file
`src/modules/catalog/product-search.ts`) returns a `Prisma.Sql` fragment
plus the ordered bind values. Unit-tested without a database.

- Split the raw query on whitespace; drop empties; cap at 6 tokens; each
  trimmed and truncated to 64 chars.
- **Every** token must match (AND across tokens); a token matches a product
  when ANY of these holds (OR within the group):
  - `word_similarity(token, name) >= 0.25`
  - `word_similarity(token, slug) >= 0.25`
  - `name ILIKE '%' || token || '%'`
  - `slug ILIKE '%' || token || '%'`
- For tokens shorter than 3 characters trigrams are unstable, so only the
  two ILIKE branches apply (prefix/substring still works, e.g. "tb",
  "desk").
- `word_similarity` (not `similarity`) compares against the best matching
  word, so "chari" matches the word "chair" inside "Dining Chair".
- Threshold `0.25` is an exported, commented constant
  (`TRGM_MATCH_THRESHOLD`) — permissive for short furniture words;
  ranking decides what surfaces first.

Ranking for ordering:

```text
score = MIN over tokens of GREATEST(
  word_similarity(token, name), word_similarity(token, slug))
```

and products containing an exact token via ILIKE get `GREATEST(score, 0.9)`
per token so exact/prefix matches always beat fuzzy ones.

Tiebreak: `created_at DESC` (same as today).

### 3.4 Query assembly

`storefrontList` branches:

- **No `search`**: unchanged Prisma query.
- **With `search`**: one parameterized `$queryRaw` (tagged template, user
  values bound — never string-concatenated) returns
  `{ id: string; rank: number }` rows with all existing filters compiled
  into the same SQL:
  - `status = 'ACTIVE'`
  - category subtree: `category_id IN (server-derived UUID list via
    Prisma.join)` — the existing `expandCategoryIds` helper is reused;
    UUIDs come from our own DB and are safe to inline.
  - room: `room = $token::"Room"` (explicit enum cast; the Postgres enum
    type is `"Room"`).
  - solution: `$token::"Solution" = ANY(solutions)` (enum array; enum
    type `"Solution"`).
  - price: `EXISTS(SELECT 1 FROM product_variants v JOIN skus s ON
    s.variant_id = v.id WHERE v.product_id = products.id AND
    s.price BETWEEN $lo AND $hi)` (mirrors today's Prisma price filter,
    including NULL-priced SKUs being excluded by the range).
  - limit/offset for pagination.
- The raw query returns IDs only; products are then loaded with the
  existing `findMany({ select: STOREFRONT_SELECT, where: { id: { in } } })`
  and reordered in JS to follow raw-query rank order, then run through the
  **same** inventory + review-summary enrichment as today. Response shape
  (`{ items, total, page, pageSize }`) is unchanged. `count` uses the same
  WHERE fragment without ordering/pagination.

Matching is restricted to **name and slug only**. Description is excluded
to avoid noise (and slug carries product code suffixes, so code search
works).

### 3.5 Endpoint / contract

No new endpoint. `GET /storefront/products?search=…` keeps its existing
contract; the only change is tolerance + relevance ordering. Existing
`pageSize` max in the DTO applies to suggestions (call with
`pageSize=6`). Admin product list search stays ILIKE-exact as today.

## 4. Fuzzy product search — frontend

### 4.1 Header search UI

New client island `components/layout/SiteSearch.tsx`, rendered by
`Header`:

- **Desktop (lg+)**: an IKEA-style rounded pill input inside the header
  row (magnifier icon + placeholder "Search furniture…"), sits between the
  nav and the account/cart icons. Width grows with available space
  (`w-full max-w-[420px]`).
- **Mobile (<lg)**: a magnifier icon button to the left of the cart icon.
  Tapping reveals an input bar on its own row directly under the header
  (`position: static` second row inside the sticky header, so it sticks
  with it), autofocused; an ✕ closes it. Same component, state-driven.
- Submit (Enter) navigates `/search?q=<encoded>` via `router.push`.
- The portaled-overlay lesson from the mega menu applies: no overlay is
  needed for the open bar (it is in-flow), but the suggestions dropdown is
  portaled to `document.body` with a measured top/left/width because the
  sticky header's `backdrop-blur` is a containing block for fixed
  descendants.

### 4.2 Suggestions dropdown

- Debounce 250 ms; query `api.getProducts({ search, pageSize: 6 })`.
- Dropdown shows up to 6 rows: square 48px image/placeholder, name, price.
- Keyboard: ArrowUp/Down moves an active row, Enter navigates to the
  active product or `/search` if none active, Escape closes and returns
  focus to the input. Click outside closes. Loading and empty states
  ("No matches — press Enter to search").
- In-flight request is superseded (ignore stale responses by a request
  seq counter).
- No suggestion requests for queries under 2 characters.

### 4.3 Results page

New route `app/search/page.tsx` (server component, `revalidate = 120`
like category pages):

- Reads `q` from searchParams; heading `Search results for "{q}"` with
  `(total)`; fetches through the same products API with the existing
  room/solution/price + pagination params.
- Reuses `CollectionFilters`; the component gains an optional
  `preserve?: Record<string, string | undefined>` prop so every filter
  link keeps `q` (merged into its querystring builder). Category and
  collection pages pass nothing (behavior unchanged).
- Empty state (real): "No products match “{q}”. Check the spelling or
  browse a category." + links to the four root category pages.
- Missing/empty `q`: a prompt state ("Start by typing what you're looking
  for.") instead of querying.
- Product grid, price display and "Load more" pagination identical to
  `/categories/[slug]`.

### 4.4 Sitemap / SEO

`/search` is excluded from sitemap and gets `robots: { index: false }`
metadata (faceted/search pages should not be indexed).

## 5. Customer auth — backend

### 5.1 Schema additions (`prisma/schema/customer.prisma`)

```prisma
model CustomerAccount {
  id           String    @id @default(uuid(7)) @db.Uuid
  email        String    @unique
  passwordHash String    @map("password_hash")
  name         String
  /// Set once the customer saves a phone number; links checkout history.
  customerId   String?   @unique @map("customer_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  customer      Customer?              @relation(fields: [customerId],
    references: [id], onDelete: SetNull)
  refreshTokens CustomerRefreshToken[]

  @@map("customer_accounts")
}

model CustomerRefreshToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  accountId String    @map("account_id") @db.Uuid
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  account CustomerAccount @relation(fields: [accountId], references: [id],
    onDelete: Cascade)

  @@index([accountId])
  @@index([expiresAt])
  @@map("customer_refresh_tokens")
}
```

Add the back-relation `account CustomerAccount?` to `Customer`.
Migration via `prisma migrate dev` (name `add_customer_accounts`).

### 5.2 Token separation

- Access JWT carries `{ sub: accountId, email, kind: "customer" }`, signed
  with the existing `JWT_SECRET` and `JWT_ACCESS_TTL`.
- New `CustomerJwtGuard` rejects tokens whose `kind !== "customer"`.
- The admin `JwtAuthGuard` is tightened to **reject** any token carrying
  `kind: "customer"` (old admin tokens have no `kind` and still pass).
  Unit test: each guard rejects the other token kind.
- Refresh tokens are opaque random 48-byte strings, sha256-hashed at rest,
  rotated on refresh with reuse rejection, exactly like admin refresh.

### 5.3 Endpoints

New `StorefrontCustomersController` at `storefront/customers`, served by a
new `StorefrontCustomerAuthService` inside the customers module:

| Method & path | Auth | Body / returns |
|---|---|---|
| `POST /storefront/customers/register` | — | `{name, email, password}` → `{accessToken, refreshToken, expiresAt, account:{id,name,email,phone:null}}` |
| `POST /storefront/customers/login` | — | `{email, password}` → same shape |
| `POST /storefront/customers/refresh` | — | `{refreshToken}` → new token pair |
| `POST /storefront/customers/logout` | — | `{refreshToken}` → `{ok:true}` (idempotent) |
| `GET /storefront/customers/me` | customer | profile incl. linked phone |
| `PATCH /storefront/customers/me` | customer | `{name?, phone?}`; phone links order history |
| `GET /storefront/customers/me/orders` | customer | paged order summaries |

DTO rules (zod):

- `email`: valid email, trimmed, lowercased; max 254.
- `password`: min 8, max 200.
- `name`: 1–120 chars, trimmed; required at registration, optional later.
- `phone`: validated through existing `normalizePhilippinePhone`.

Behavior:

- Register: 409 on duplicate email; argon2 hash (default options, same as
  admin); generic messages otherwise.
- Login: same generic 401 "Invalid credentials" for unknown email or bad
  password. (CustomerAccount has no status column; disabling accounts is
  out of scope.)
- `PATCH /me` with `phone`: normalize; in a transaction upsert the
  `Customer` by `normalizedPhone` (create with name/email from account),
  then if that customer is already linked to a **different** account →
  409 "This phone number is linked to another account"; else set
  `account.customerId`. Backfill `customer.name/email` only when null.
- `GET /me/orders`: no linked customer yet → `{items:[],total:0,page:1,
  pageSize:10}`. Otherwise orders by `customerId`, newest first, page/pageSize
  query (default 10, max 50). Each item exposes only storefront-safe
  fields:

  ```text
  orderNumber, orderStatus, paymentStatus, grandTotal, currency,
  createdAt, items: [{ productNameSnapshot, variantSnapshot, quantity,
                       lineTotal }]
  ```

  No costs, AID, optimizer fields, addresses, internal notes.
- Global prefix `/api/v1` already applies; rate limiting is not introduced
  (no brute-force protection exists for admin either; note as follow-up).

### 5.4 Module wiring

- Service + controller live under `src/modules/customers/`
  (`storefront-customer-auth.service.ts`,
  `storefront/customers.controller.ts`, `customer-jwt.guard.ts`).
- CustomersModule imports `AuthModule` (which already exports
  `JwtModule`) — or a small shared token module if imports get cyclic;
  prefer importing AuthModule. PrismaModule already global.
- No change to checkout or admin customer management.

## 6. Customer auth — frontend

### 6.1 Auth client and state

- `lib/auth.ts`: types (`CustomerAccount`, `TokenPair`), `authApi`
  functions over the same relative `/api/v1` base, and `tokenStorage`
  (refresh token in `localStorage` key `sh_refresh`; access token only in
  React state/memory). One refresh-flight promise prevents parallel
  401 retries from double-refreshing.
- `components/auth/AuthProvider.tsx` ("use client"): on mount, if a refresh
  token exists, call `/refresh` to mint an access token then `/me`
  (refresh failure → clear storage, guest); exposes
  `{ account, status: 'loading'|'authed'|'guest', login, register,
  logout, refreshProfile }`. Mounted once in the root layout.
- An authenticated fetch wrapper is used only for the three authed
  endpoints; everything else stays anonymous.

### 6.2 Pages

- `/register` and `/login`: centered card pages, shared presentational
  pieces; links between them; on success honor `?next=<safe relative
  path>` (validated to start with `/` and not `//`), default `/account`.
  Error messages come from the API ("Invalid credentials", 409 email
  conflict). Titles/meta per page.
- `/account` (client page):
  - Auth gate: while `status==='loading'` a minimal loading state; guest
    → `router.replace('/login?next=/account')`.
  - Profile card: name, email; edit name inline (PATCH).
  - Phone panel: if unlinked, explanation "Add your phone number to see
    COD orders placed by SMS/phone" + phone input (save → PATCH); if
    linked, show the display phone with an option to change (same PATCH,
    same conflict handling).
  - Orders panel: fetch `/me/orders`; list rows (orderNumber, date,
    status label, ₱ grandTotal, item count); each links to the existing
    `/order-success/[orderNumber]` page. Empty state: "No orders yet" +
    "Start shopping" link to `/collections`.
  - Logout button (calls logout endpoint, clears storage, stays on
    /account which bounces to /login).

### 6.3 Header entry

`Header` adds one icon before the cart icon (mobile and desktop):

- Guest: person icon linking `/login`; desktop also shows text "Log in".
- Authed: person icon + "Hi, {firstName}" linking `/account`.
- Never a heart/wishlist icon.
- Icon order on mobile (left→right): hamburger, centered logo, then
  search, person, cart. On desktop the logo and nav stay left, the search
  pill grows in the middle, and search is not duplicated as an icon;
  person + cart sit at the far right.

The header must not break SSR: account-dependent text renders after the
provider resolves (icon-only neutral state on server/first paint).

## 7. Edge cases and errors

- Search with only spaces/short tokens: skip trgm, ILIKE only; empty term
  = unfiltered list (existing behavior).
- Very long query: DTO already caps `search` at 255 chars.
- Suggestions racing with navigation: ignore stale responses; abort via
  seq counter (no AbortController needed).
- Refresh token expired/revoked: client clears storage and falls back to
  guest; protected page redirects to login.
- Register/login double submit: buttons disable while pending.
- A customer who checked out as guest with phone X, later registers and
  adds phone X: historical orders appear immediately (phone linkage).
- pg_trgm already enabled / indexes already exist: `IF NOT EXISTS`
  guards make the migration idempotent.

## 8. Testing

Backend (vitest, pure units — no DB harness in this repo):

- `product-search.spec.ts`: tokenization (whitespace, cap 6, truncation),
  short-token branch, AND-of-OR group structure, rank expression, exact
  boost, SQL fragment contains bound placeholders for every user token
  (assert on `Prisma.sql` debug text) and never interpolates raw input.
- Admin-guard / customer-guard cross-rejection unit tests (sign both
  kinds with the test secret).
- Customer auth service tests with a mocked PrismaService: register
  conflict mapping, invalid-credential paths, refresh rotation/reuse,
  phone linking upsert + cross-account 409, order serialization omits
  forbidden fields.
- Live verification (manual during implementation): migration on the
  docker DB; typo searches through the running API (`chari`, `dning
  ch`, `tabel`); full register → add phone → see COD order flow.

Frontend:

- Gates: `pnpm lint && pnpm exec tsc --noEmit && pnpm build`.
- Chrome MCP live checks desktop + 390px mobile: pill input, suggestions
  keyboard control, `/search` filters keep `q`, empty state, register →
  login → account, header icon states, logout.

## 9. Out of scope (explicit)

- Email verification, password reset email flows, SMS/OTP login.
- Address book management and checkout prefill for signed-in customers.
- Per-customer order tracking beyond the existing order-success page;
  brute-force rate limiting; admin UI to browse accounts.
- Synonym dictionary / controlled vocabulary; search analytics.
