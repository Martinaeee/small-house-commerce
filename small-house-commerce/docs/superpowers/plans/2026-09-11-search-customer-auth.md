# Fuzzy Product Search + Storefront Customer Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an IKEA-style header search with typo-tolerant product matching, plus email/password customer registration/login with a profile + order-history account area.

**Architecture:** Fuzzy search uses the bundled Postgres `pg_trgm` extension (GIN indexes + `word_similarity`) through one parameterized `$queryRaw`, reusing the existing storefront product enrichment pipeline. Customer auth is a parallel identity to admin auth: new `CustomerAccount` / `CustomerRefreshToken` tables, argon2 hashes, JWTs tagged `kind: "customer"` with a dedicated guard, and order history linked through the existing phone-keyed `Customer`. Frontend adds a client AuthProvider, login/register/account routes, a SiteSearch island, and a `/search` results page.

**Tech Stack:** NestJS 12, Prisma 7 (multi-file schema, generated client `src/generated/prisma`), PostgreSQL 18 in Docker (`small-house-postgres`, db `small_house`), zod, argon2, @nestjs/jwt, vitest (unit `*.spec.ts`); Next.js 16 App Router, React 19, Tailwind v4.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-09-11-search-customer-auth-design.md` — read it alongside this plan; the spec is the binding authority on behavior.

## Global Constraints

- No new npm dependencies. `argon2`, `@nestjs/jwt`, `zod` are already installed backend-side; `pg_trgm` is a Postgres extension, not an npm package.
- Backend imports use ESM `.js` extensions on relative paths (NodeNext), e.g. `import { PrismaService } from '../../prisma/prisma.service.js';`.
- Storefront responses must never expose `supplierSku / supplierCost / costCurrency / landedCost`, nor review internals `isVisible / source / verifiedOrderItemId`.
- No fake data anywhere; real empty states. No wishlist/heart icon.
- COD copy stays "Cash on Delivery"; delivery copy "Metro Manila 3–5 days, provinces 5–7 days". No installment pricing.
- Never stage `docs/frontend/HOMEPAGE_SPEC.md`, `docs/superpowers/plans/2026-09-11-pdp-refinement.md`, or `docs/research/`. Always `git add <explicit paths>`.
- Repo root for all commands is `small-house-commerce/`; backend commands run in `backend/`, frontend in `frontend/`.
- Backend gates: `pnpm run lint && pnpm run build && pnpm exec vitest run`. Frontend gates: `pnpm lint && pnpm exec tsc --noEmit && pnpm build`.
- Migrations: `pnpm exec prisma migrate dev --name <kebab-name>`; generated client lands in `src/generated/prisma` automatically.

---

## File structure

**Backend**

- Create `prisma/migrations/<timestamp>_add_pg_trgm_product_search/migration.sql` — extension + GIN indexes (hand-written via `--create-only`).
- Create `src/modules/catalog/product-search.ts` — pure trigram SQL builder + tokenizer.
- Create `src/modules/catalog/product-search.spec.ts`.
- Modify `src/modules/catalog/products.service.ts` — fuzzy branch of `storefrontList`; extract shared `present()` enrichment.
- Modify `prisma/schema/customer.prisma` — `CustomerAccount`, `CustomerRefreshToken`, `Customer.account` back-relation.
- Create `src/modules/customers/dto/storefront-customer.dto.ts`.
- Create `src/modules/customers/customer-jwt.guard.ts` + `customer-jwt.guard.spec.ts`.
- Create `src/modules/customers/current-customer.decorator.ts`.
- Create `src/modules/customers/storefront-customer-auth.service.ts` + `.spec.ts`.
- Create `src/modules/customers/storefront/customers.controller.ts`.
- Modify `src/modules/customers/customers.module.ts`.
- Modify `src/modules/auth/jwt-auth.guard.ts` — reject `kind: "customer"` tokens.

**Frontend**

- Create `src/lib/auth.ts` — token storage, typed auth API client, refresh-flight.
- Create `src/components/auth/AuthProvider.tsx`; create `src/components/auth/Providers.tsx`.
- Create `src/components/auth/AccountEntry.tsx`.
- Create `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/account/page.tsx`.
- Create `src/components/layout/SiteSearch.tsx`.
- Create `src/app/search/page.tsx`.
- Modify `src/components/collection/CollectionFilters.tsx` (`preserve` prop).
- Modify `src/components/layout/Header.tsx`; modify `src/app/layout.tsx`.

---

## Task 1: pg_trgm migration + pure search-SQL builder

**Files:**
- Create: `backend/prisma/migrations/<created>_add_pg_trgm_product_search/migration.sql`
- Create: `backend/src/modules/catalog/product-search.ts`
- Test: `backend/src/modules/catalog/product-search.spec.ts`

**Interfaces (produces — consumed by Task 2):**
```ts
export const TRGM_MATCH_THRESHOLD = 0.25; // word_similarity cutoff
export const MAX_SEARCH_TOKENS = 6;
export function tokenizeSearch(raw: string): string[];
export interface TrgmSearchSql { match: Prisma.Sql; rank: Prisma.Sql; }
export function buildTrgmSearch(tokens: string[]): TrgmSearchSql;
```
`match` is a boolean SQL fragment over the `products` table (qualified column names). `rank` is a numeric `0..1` fragment; order by `rank DESC, products.created_at DESC`.

- [ ] **Step 1: Create the migration directory by hand**

`--create-only` is unusable here: Prisma skips it when there is no Prisma
schema diff, and this migration is raw SQL only. Create a correctly named
folder instead (run in `backend/`):

```bash
MIG="prisma/migrations/$(date +%Y%m%d%H%M%S)_add_pg_trgm_product_search"
mkdir -p "$MIG"
echo "$MIG"
```

Keep the printed path for the next step.

- [ ] **Step 2: Write `migration.sql` into that directory**

Create `$MIG/migration.sql` with exactly:

```sql
-- Fuzzy product search (spec §3.2): bundled Postgres trigram extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Partial GIN indexes: storefront search matches ACTIVE products only.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS products_slug_trgm_idx
  ON products USING gin (slug gin_trgm_ops)
  WHERE status = 'ACTIVE';
```

- [ ] **Step 3: Apply the migration**

Run:
```bash
pnpm exec prisma migrate dev
```
Expected: migration applied, client regenerated, no drift errors.

- [ ] **Step 4: Verify the extension is live**

Run:
```bash
docker exec small-house-postgres psql -U postgres -d small_house -tc "SELECT extname FROM pg_extension WHERE extname='pg_trgm';"
```
Expected: a line containing `pg_trgm`.

- [ ] **Step 5: Write the failing test**

Create `backend/src/modules/catalog/product-search.spec.ts`:

```ts
import { Prisma } from '../../generated/prisma/client.js';
import {
  TRGM_MATCH_THRESHOLD,
  MAX_SEARCH_TOKENS,
  buildTrgmSearch,
  tokenizeSearch,
} from './product-search.js';

/** Flattens nested Prisma.Sql value arrays for assertion. */
function flatValues(sql: Prisma.Sql): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object' && 'sql' in value) {
      walk((value as Prisma.Sql).values);
    } else {
      out.push(value);
    }
  };
  walk(sql.values);
  return out;
}

describe('tokenizeSearch', () => {
  it('splits on whitespace, trims and drops empties', () => {
    expect(tokenizeSearch('  dining   chair ')).toEqual(['dining', 'chair']);
  });

  it(`caps at ${MAX_SEARCH_TOKENS} tokens and truncates each to 64 chars`, () => {
    expect(tokenizeSearch('a b c d e f g')).toHaveLength(6);
    const long = 'x'.repeat(80);
    expect(tokenizeSearch(long)[0]).toHaveLength(64);
  });
});

describe('buildTrgmSearch', () => {
  it('ANDs one parenthesized group per token', () => {
    const result = buildTrgmSearch(['dining', 'chair']);
    const ands = result.match.sql.match(/ AND /g) ?? [];
    expect(ands).toHaveLength(1);
    expect(result.match.sql).toContain('word_similarity');
  });

  it('uses trgm branches on 3+ char tokens and binds every token as a parameter', () => {
    const result = buildTrgmSearch(['chair']);
    expect(result.match.sql).toContain('word_similarity');
    expect(result.match.sql).toContain('ILIKE');
    // Prisma parameterizes: neither user input nor the threshold is inlined.
    expect(result.match.sql).not.toContain('chair');
    expect(flatValues(result.match)).toContain('chair');
    expect(flatValues(result.match)).toContain('%chair%');
    expect(flatValues(result.match)).toContain(TRGM_MATCH_THRESHOLD);
  });

  it('skips trigram branches for tokens shorter than 3 chars', () => {
    const result = buildTrgmSearch(['tb']);
    expect(result.match.sql).not.toContain('word_similarity');
    expect(result.match.sql).toContain('ILIKE');
    expect(flatValues(result.match)).toContain('%tb%');
  });

  it('ranks by the weakest token (LEAST of per-token GREATEST scores)', () => {
    const result = buildTrgmSearch(['dining', 'chair']);
    expect(result.rank.sql).toContain('LEAST');
    expect(result.rank.sql).toContain('GREATEST');
    const commas = result.rank.sql.match(/,/g) ?? [];
    expect(commas.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run src/modules/catalog/product-search.spec.ts`
Expected: FAIL — module `./product-search.js` not found.

- [ ] **Step 7: Implement `product-search.ts`**

Create `backend/src/modules/catalog/product-search.ts`:

```ts
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Typo-tolerant product search on the bundled pg_trgm extension
 * (spec §3.3). word_similarity scores a token against the best matching
 * word inside a column, so "chari" matches the word "chair" inside
 * "Dining Chair". ILIKE branches keep exact/prefix matches working and
 * cover tokens shorter than 3 characters (trigrams are unstable there).
 */

export const TRGM_MATCH_THRESHOLD = 0.25;
export const MAX_SEARCH_TOKENS = 6;
const MAX_TOKEN_LENGTH = 64;

export function tokenizeSearch(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((token) => token.trim().slice(0, MAX_TOKEN_LENGTH))
    .filter((token) => token.length > 0)
    .slice(0, MAX_SEARCH_TOKENS);
}

/** Boolean group: this single token matches via trgm OR substring. */
function tokenCondition(token: string): Prisma.Sql {
  const pattern = `%${token}%`;
  if (token.length < 3) {
    return Prisma.sql`(
      products.name ILIKE ${pattern}
      OR products.slug ILIKE ${pattern}
    )`;
  }
  return Prisma.sql`(
    word_similarity(${token}, products.name) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR word_similarity(${token}, products.slug) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR products.name ILIKE ${pattern}
    OR products.slug ILIKE ${pattern}
  )`;
}

/** Per-token relevance: best name/slug similarity, with an exact-prefix boost. */
function tokenScore(token: string): Prisma.Sql {
  const pattern = `%${token}%`;
  const exact = Prisma.sql`CASE
      WHEN products.name ILIKE ${pattern} OR products.slug ILIKE ${pattern}
      THEN 0.9 ELSE 0 END`;
  if (token.length < 3) {
    return exact;
  }
  return Prisma.sql`GREATEST(
    word_similarity(${token}, products.name),
    word_similarity(${token}, products.slug),
    ${exact}
  )`;
}

export interface TrgmSearchSql {
  /** True iff the row matches every token. */
  match: Prisma.Sql;
  /** 0..1 score; the weakest token decides (all tokens must be relevant). */
  rank: Prisma.Sql;
}

export function buildTrgmSearch(tokens: string[]): TrgmSearchSql {
  if (tokens.length === 0) {
    throw new Error('buildTrgmSearch requires at least one token');
  }
  const conditions = tokens.map(tokenCondition);
  const scores = tokens.map(tokenScore);
  return {
    match: Prisma.join(conditions, ' AND '),
    rank: Prisma.sql`LEAST(${Prisma.join(scores, ', ')})`,
  };
}
```

- [ ] **Step 8: Run tests, then full backend gate**

Run: `pnpm exec vitest run src/modules/catalog/product-search.spec.ts` → PASS.
Run: `pnpm run lint && pnpm run build && pnpm exec vitest run` → all green.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/migrations backend/src/modules/catalog/product-search.ts backend/src/modules/catalog/product-search.spec.ts
git commit -m "feat(catalog): pg_trgm migration and fuzzy search SQL builder"
```

---

## Task 2: Fuzzy search inside `storefrontList`

**Files:**
- Modify: `backend/src/modules/catalog/products.service.ts`

**Interfaces:**
- Consumes: `tokenizeSearch`, `buildTrgmSearch` from Task 1; `expandCategoryIds` (already imported); `STOREFRONT_SELECT`.
- Produces: same HTTP contract as before on `GET /api/v1/storefront/products?search=…` (`{ items, total, page, pageSize }`), now typo-tolerant and relevance-ordered. No-search and admin paths are untouched.

- [ ] **Step 1: Add the import**

At the existing catalog imports in `products.service.ts`, add:

```ts
import { buildTrgmSearch, tokenizeSearch } from './product-search.js';
```

- [ ] **Step 2: Extract the shared enrichment tail**

Add a record type near `STOREFRONT_SELECT`:

```ts
type StorefrontProductRecord = Prisma.ProductGetPayload<{
  select: typeof STOREFRONT_SELECT;
}>;
```

In `storefrontList`, replace this block:

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

with:

```ts
    return {
      items: await this.presentStorefront(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
```

Add the private method (below `storefrontList`):

```ts
  /**
   * Runs storefront product rows through the shared enrichment:
   * availableInventory on every SKU, plus review summary.
   */
  private async presentStorefront(items: StorefrontProductRecord[]) {
    const enriched = await this.withAvailableInventory(items);
    const summary = await this.reviews.summaryForProducts(enriched.map((p) => p.id));
    return enriched.map((p) => {
      const s = summary.get(p.id) ?? { reviewCount: 0, ratingAverage: null };
      return { ...p, reviewCount: s.reviewCount, ratingAverage: s.ratingAverage };
    });
  }
```

- [ ] **Step 3: Branch to fuzzy search at the top of `storefrontList`**

Replace the current search handling inside `storefrontList`:

```ts
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
```

with:

```ts
    const tokens = query.search ? tokenizeSearch(query.search) : [];
    if (query.search && tokens.length > 0) {
      return this.storefrontFuzzyList(query, tokens);
    }
```

(The rest of the existing Prisma path — subtree category, room, solution, price, findMany/count — stays exactly as it is.)

- [ ] **Step 4: Implement the fuzzy path**

Add these two private methods to `ProductsService` (place them right after `storefrontList` / next to `presentStorefront`):

```ts
  /** Non-search SQL filters shared by the fuzzy id/count queries. */
  private storefrontFilterFragments(
    query: StorefrontProductQuery,
    categoryIds: string[],
  ): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [Prisma.sql`products.status = 'ACTIVE'`];

    if (query.categoryId) {
      // UUIDs come from our own category table; bind them as a uuid array.
      filters.push(Prisma.sql`products.category_id = ANY(${categoryIds}::uuid[])`);
    }
    if (query.room) {
      filters.push(Prisma.sql`products.room = ${query.room}::"Room"`);
    }
    if (query.solution) {
      filters.push(Prisma.sql`${query.solution}::"Solution" = ANY(products.solutions)`);
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const price =
        query.minPrice !== undefined && query.maxPrice !== undefined
          ? Prisma.sql`s.price BETWEEN ${query.minPrice} AND ${query.maxPrice}`
          : query.minPrice !== undefined
            ? Prisma.sql`s.price >= ${query.minPrice}`
            : Prisma.sql`s.price <= ${query.maxPrice!}`;
      filters.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM product_variants pv
        JOIN skus s ON s.variant_id = pv.id
        WHERE pv.product_id = products.id AND ${price}
      )`);
    }

    return filters;
  }

  private async storefrontFuzzyList(
    query: StorefrontProductQuery,
    tokens: string[],
  ) {
    // Subtree expansion is reused for categoryId (same helper as the Prisma path).
    let categoryIds: string[] = [];
    if (query.categoryId) {
      const activeCategories = await this.prisma.category.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, parentId: true },
      });
      categoryIds = expandCategoryIds(activeCategories, query.categoryId);
    }

    const trgm = buildTrgmSearch(tokens);
    const whereSql = Prisma.sql`${Prisma.join(
      [...this.storefrontFilterFragments(query, categoryIds), trgm.match],
      ' AND ',
    )}`;
    const offset = (query.page - 1) * query.pageSize;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; rank: number }[]>`
        SELECT products.id, ${trgm.rank} AS rank
        FROM products
        WHERE ${whereSql}
        ORDER BY rank DESC, products.created_at DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*)::bigint AS total
        FROM products
        WHERE ${whereSql}
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    if (rows.length === 0) {
      return { items: [], total, page: query.page, pageSize: query.pageSize };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: STOREFRONT_SELECT,
    });
    // findMany does not preserve the raw rank order; re-apply it.
    const byId = new Map(products.map((product) => [product.id, product]));
    const ordered = rows
      .map((row) => byId.get(row.id))
      .filter((product): product is StorefrontProductRecord => product !== undefined);

    return {
      items: await this.presentStorefront(ordered),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
```

- [ ] **Step 5: Build and restart the backend**

Run: `pnpm run lint && pnpm run build && pnpm exec vitest run` → green.
Restart the dev/prod API (it serves on :3000; if a prod server is running, rebuild then restart `node --enable-source-maps dist/main`).

- [ ] **Step 6: Live-verify typo tolerance against seeded products**

Run each, expecting the seeded chair products (names like "Stock Chair …", "E2E Chair …") in `items`:
```bash
curl -s "http://localhost:3000/api/v1/storefront/products?search=chari&pageSize=5" | head -c 400
curl -s "http://localhost:3000/api/v1/storefront/products?search=dning%20chr&pageSize=5" | head -c 400
curl -s "http://localhost:3000/api/v1/storefront/products?search=tabel&pageSize=5" | head -c 200
curl -s "http://localhost:3000/api/v1/storefront/products?search=zzzzqq&pageSize=5" | head -c 120
```
Expected: chair searches return the chairs (total ≥ 7 for `chari`); nonsense returns `{"items":[],"total":0,...}`. Also confirm a response item still carries `variants[].sku.availableInventory` and never `supplierCost`/`landedCost`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/catalog/products.service.ts
git commit -m "feat(catalog): typo-tolerant storefront search via pg_trgm ranking"
```

---

## Task 3: Customer identity schema + migration

**Files:**
- Modify: `backend/prisma/schema/customer.prisma`

- [ ] **Step 1: Add the back-relation on `Customer`**

In `customer.prisma`, in model `Customer`, add to its relation block:

```prisma
  addresses CustomerAddress[]
  orders     Order[]
  account    CustomerAccount?
```

- [ ] **Step 2: Append the two new models**

At the end of `customer.prisma`:

```prisma
/// Storefront customer login identity (email + password). Separate from the
/// admin User and from the phone-keyed Customer row: customerId links COD
/// order history once the shopper saves their phone number.
model CustomerAccount {
  id           String    @id @default(uuid(7)) @db.Uuid
  email        String    @unique
  passwordHash String    @map("password_hash")
  name         String
  customerId   String?   @unique @map("customer_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  customer      Customer?              @relation(fields: [customerId], references: [id], onDelete: SetNull)
  refreshTokens CustomerRefreshToken[]

  @@map("customer_accounts")
}

/// Opaque refresh tokens (only the sha256 hash is stored), mirroring admin
/// RefreshToken: rotation revokes the presented row, enabling reuse detection.
model CustomerRefreshToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  accountId String    @map("account_id") @db.Uuid
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  account CustomerAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@index([expiresAt])
  @@map("customer_refresh_tokens")
}
```

- [ ] **Step 3: Create and apply the migration**

Run: `pnpm exec prisma migrate dev --name add_customer_accounts`
Expected: migration SQL creates `customer_accounts` and `customer_refresh_tokens`; client regenerates.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema/customer.prisma backend/prisma/migrations
git commit -m "feat(customers): CustomerAccount and refresh token schema"
```

---

## Task 4: Storefront customer DTOs + token-kind guards

**Files:**
- Create: `backend/src/modules/customers/dto/storefront-customer.dto.ts`
- Create: `backend/src/modules/customers/customer-jwt.guard.ts`
- Create: `backend/src/modules/customers/current-customer.decorator.ts`
- Modify: `backend/src/modules/auth/jwt-auth.guard.ts`
- Test: `backend/src/modules/customers/customer-jwt.guard.spec.ts`

**Interfaces (produces):**
```ts
// DTOs
registerSchema, loginSchema, storefrontRefreshSchema, updateMeSchema, customerOrdersQuerySchema
// Guard attaches to request.customer
interface RequestCustomer { accountId: string; email: string }
// Decorator
CurrentCustomer(): ParameterDecorator
```

- [ ] **Step 1: Write the failing guard test**

Create `backend/src/modules/customers/customer-jwt.guard.spec.ts`:

```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { CustomerJwtGuard } from './customer-jwt.guard.js';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';

function config() {
  return { getOrThrow: (key: string) => (key === 'jwt.secret' ? SECRET : '1h') };
}

function contextFor(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('token kind separation', () => {
  const jwt = new JwtService();
  const customerGuard = new CustomerJwtGuard(jwt, config() as never);
  const adminGuard = new JwtAuthGuard(jwt, config() as never);

  const customerToken = jwt.sign(
    { sub: 'acct-1', email: 'a@example.com', kind: 'customer' },
    { secret: SECRET, expiresIn: '1h' },
  );
  const adminToken = jwt.sign(
    { sub: 'user-1', email: 'admin@example.com' },
    { secret: SECRET, expiresIn: '1h' },
  );

  it('CustomerJwtGuard accepts customer tokens and attaches accountId', async () => {
    const ctx = contextFor(`Bearer ${customerToken}`);
    await expect(customerGuard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as {
      customer?: { accountId: string };
    };
    expect(req.customer?.accountId).toBe('acct-1');
  });

  it('CustomerJwtGuard rejects admin tokens (no kind claim)', async () => {
    await expect(
      customerGuard.canActivate(contextFor(`Bearer ${adminToken}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('JwtAuthGuard rejects customer tokens', async () => {
    await expect(
      adminGuard.canActivate(contextFor(`Bearer ${customerToken}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('both guards reject a missing header', async () => {
    await expect(customerGuard.canActivate(contextFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Run it and verify failure**

Run: `pnpm exec vitest run src/modules/customers/customer-jwt.guard.spec.ts`
Expected: FAIL — `customer-jwt.guard.js` not found; JwtAuthGuard does not reject customer tokens.

- [ ] **Step 3: Create the DTO file**

Create `backend/src/modules/customers/dto/storefront-customer.dto.ts`:

```ts
import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Match the codebase convention (auth.dto.ts): z.string().email().
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const storefrontRefreshSchema = z.object({
  refreshToken: z.string().min(10).max(400),
});

/** PATCH /me: at least one of name/phone must be present. */
export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(32).optional(),
  })
  .refine((value) => value.name !== undefined || value.phone !== undefined, {
    message: 'Nothing to update',
  });

export const customerOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type StorefrontRefreshInput = z.infer<typeof storefrontRefreshSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type CustomerOrdersQuery = z.infer<typeof customerOrdersQuerySchema>;
```

- [ ] **Step 4: Create the customer guard**

Create `backend/src/modules/customers/customer-jwt.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface RequestCustomer {
  accountId: string;
  email: string;
}

type AuthenticatedRequest = Request & { customer?: RequestCustomer };

/**
 * Storefront guard: accepts ONLY access tokens carrying kind: "customer".
 * Admin tokens (no kind claim) are rejected, keeping the two identities
 * from ever being interchangeable.
 */
@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        kind?: string;
      }>(header.slice('Bearer '.length), {
        secret: this.config.getOrThrow<string>('jwt.secret'),
      });
      if (payload.kind !== 'customer') {
        throw new UnauthorizedException('Invalid or expired token');
      }
      request.customer = { accountId: payload.sub, email: payload.email };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

- [ ] **Step 5: Tighten the admin guard**

In `backend/src/modules/auth/jwt-auth.guard.ts`, change the verify block:

```ts
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; kind?: string }>(
        token,
        { secret: this.config.getOrThrow<string>('jwt.secret') },
      );
      if (payload.kind === 'customer') {
        throw new UnauthorizedException('Invalid or expired token');
      }
      request.user = { userId: payload.sub, email: payload.email };
```

- [ ] **Step 6: Create the decorator**

Create `backend/src/modules/customers/current-customer.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestCustomer } from './customer-jwt.guard.js';

/** Injects the customer attached by CustomerJwtGuard. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestCustomer => {
    const request = context
      .switchToHttp()
      .getRequest<{ customer?: RequestCustomer }>();
    return request.customer!;
  },
);
```

- [ ] **Step 7: Run gates**

Run: `pnpm exec vitest run src/modules/customers/customer-jwt.guard.spec.ts` → PASS.
Run: `pnpm run lint && pnpm run build && pnpm exec vitest run` → all green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/customers backend/src/modules/auth/jwt-auth.guard.ts
git commit -m "feat(customers): storefront auth DTOs and customer/admin token-kind guards"
```

---

## Task 5: Storefront customer auth service

**Files:**
- Create: `backend/src/modules/customers/storefront-customer-auth.service.ts`
- Test: `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`

**Interfaces (produces, consumed by Task 6 controller):**
```ts
class StorefrontCustomerAuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  refresh(input: StorefrontRefreshInput): Promise<TokenPair>;
  logout(refreshToken: string): Promise<{ ok: true }>;
  me(accountId: string): Promise<CustomerProfile>;
  updateMe(accountId: string, input: UpdateMeInput): Promise<CustomerProfile>;
  listOrders(accountId: string, query: CustomerOrdersQuery): Promise<{
    items: StorefrontOrderSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>;
}
type AuthResult = TokenPair & { account: CustomerProfile };
type TokenPair = { accessToken: string; refreshToken: string; expiresAt: Date };
type CustomerProfile = { id: string; name: string; email: string; phone: string | null };
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`:

```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { StorefrontCustomerAuthService } from './storefront-customer-auth.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const config = {
  getOrThrow: (key: string) => (key === 'jwt.accessTtl' ? '1h' : '7d'),
} as never;

function makeService(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    customerAccount: {},
    customerRefreshToken: {},
    customer: {},
    order: {},
    // The service uses both transaction forms: interactive callback
    // (phone linking) and the awaited-array form (orders list).
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;
  // JwtService needs an explicit secret in tests (no JwtModule config here).
  return new StorefrontCustomerAuthService(prisma, new JwtService({ secret: SECRET }), config);
}

const accountRow = {
  id: 'acct-1',
  email: 'juan@example.com',
  name: 'Juan',
  passwordHash: '',
  customerId: null,
  customer: null,
};

describe('StorefrontCustomerAuthService', () => {
  it('register hashes the password and lowercases email', async () => {
    const create = vi.fn().mockResolvedValue({ ...accountRow, email: 'juan@example.com' });
    const service = makeService({
      customerAccount: { create, findUnique: vi.fn().mockResolvedValue(null) },
      customerRefreshToken: { create: vi.fn().mockResolvedValue(undefined) },
    });
    const result = await service.register({
      name: 'Juan',
      email: 'Juan@Example.com',
      password: 'longpassword',
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.email).toBe('juan@example.com');
    expect(create.mock.calls[0][0].data.passwordHash).not.toBe('longpassword');
    expect(result.account.email).toBe('juan@example.com');
    expect(result.accessToken).toBeTruthy();
  });

  it('register maps a duplicate email to 409', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue(accountRow),
        create: vi.fn(),
      },
    });
    await expect(
      service.register({ name: 'Juan', email: 'juan@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login rejects an unknown email with 401', async () => {
    const service = makeService({
      customerAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.login({ email: 'nobody@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects a wrong password with 401 even when the email exists', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...accountRow, passwordHash: await argon2.hash('correct-password') }),
      },
    });
    await expect(
      service.login({ email: 'juan@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('links a saved phone by upserting Customer and rejects a phone owned by another account', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'cust-9', normalizedPhone: '+639170000001' });
    const update = vi.fn().mockResolvedValue(undefined);

    const ownerService = makeService({
      customer: {
        upsert,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'other-account' }),
        update,
      },
    });
    await expect(
      ownerService.updateMe('acct-1', { phone: '0917 000 0001' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();

    const upsertFree = vi
      .fn()
      .mockResolvedValue({ id: 'cust-10', normalizedPhone: '+639170000002' });
    const freeService = makeService({
      customer: {
        upsert: upsertFree,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customerAccount: {
        // Call 1: requireAccount at updateMe entry.
        // Call 2: owner lookup inside the transaction (null = phone free).
        // Call 3: requireAccount when me() reloads the profile.
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...accountRow,
            customerId: 'cust-10',
            customer: { normalizedPhone: '+639170000002' },
          }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const profile = await freeService.updateMe('acct-1', { phone: '09170000002' });
    expect(profile.phone).toBe('+639170000002');
    // New COD customer inherits the account identity on creation.
    expect(upsertFree.mock.calls[0][0].create).toMatchObject({
      normalizedPhone: '+639170000002',
      name: 'Juan',
      email: 'juan@example.com',
    });
  });

  it('serializes orders without cost/supplier/internal fields and converts decimals', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ ...accountRow, customerId: 'cust-1' }),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            orderNumber: 'ORD-1',
            orderStatus: 'NEW',
            paymentStatus: 'COD_PENDING',
            currency: 'PHP',
            grandTotal: { toString: () => '1999.00' },
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            items: [
              {
                productNameSnapshot: 'Stock Chair',
                variantSnapshot: 'Default',
                quantity: 2,
                lineTotal: { toString: () => '3998.00' },
              },
            ],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });
    const page = await service.listOrders('acct-1', { page: 1, pageSize: 10 });
    expect(page.items[0].grandTotal).toBe(1999);
    expect(page.items[0].items[0].lineTotal).toBe(3998);
    expect(JSON.stringify(page.items)).not.toContain('optimizer');
    expect(JSON.stringify(page.items)).not.toContain('landedCost');
  });

  it('returns an empty order page when no phone is linked yet', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ ...accountRow, customerId: null }),
      },
    });
    const page = await service.listOrders('acct-1', { page: 1, pageSize: 10 });
    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
  });
});
```

- [ ] **Step 2: Run it and verify failure**

Run: `pnpm exec vitest run src/modules/customers/storefront-customer-auth.service.spec.ts`
Expected: FAIL — service module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/customers/storefront-customer-auth.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import type { MsDuration } from '../auth/auth.module.js';
import type {
  CustomerOrdersQuery,
  LoginInput,
  RegisterInput,
  StorefrontRefreshInput,
  UpdateMeInput,
} from './dto/storefront-customer.dto.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function durationToMillis(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Number(match[1]) * factor;
}

type AccountWithCustomer = {
  id: string;
  email: string;
  name: string;
  customerId: string | null;
  customer?: { normalizedPhone: string } | null;
};

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface StorefrontOrderSummary {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  grandTotal: number;
  createdAt: Date;
  items: {
    productNameSnapshot: string;
    variantSnapshot: string;
    quantity: number;
    lineTotal: number;
  }[];
}

const ORDER_SUMMARY_SELECT = {
  orderNumber: true,
  orderStatus: true,
  paymentStatus: true,
  currency: true,
  grandTotal: true,
  createdAt: true,
  items: {
    select: {
      productNameSnapshot: true,
      variantSnapshot: true,
      quantity: true,
      lineTotal: true,
    },
  },
} as const;

@Injectable()
export class StorefrontCustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterInput): Promise<TokenPair & { account: CustomerProfile }> {
    const existing = await this.prisma.customerAccount.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const account = await this.prisma.customerAccount.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await argon2.hash(input.password),
      },
    });
    const tokens = await this.issueTokens(account.id, account.email);

    return {
      ...tokens,
      account: { id: account.id, name: account.name, email: account.email, phone: null },
    };
  }

  async login(input: LoginInput): Promise<TokenPair & { account: CustomerProfile }> {
    const account = await this.prisma.customerAccount.findUnique({
      where: { email: input.email },
      include: { customer: { select: { normalizedPhone: true } } },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await argon2.verify(account.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const tokens = await this.issueTokens(account.id, account.email);
    return { ...tokens, account: this.toProfile(account) };
  }

  async refresh(input: StorefrontRefreshInput): Promise<TokenPair> {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await this.prisma.customerRefreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.revokedAt !== null || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotation with reuse rejection mirrors the admin AuthService.
    await this.prisma.customerRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const account = await this.prisma.customerAccount.findUnique({
      where: { id: stored.accountId },
      select: { id: true, email: true },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(account.id, account.email);
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(accountId: string): Promise<CustomerProfile> {
    const account = await this.requireAccount(accountId);
    return this.toProfile(account);
  }

  async updateMe(accountId: string, input: UpdateMeInput): Promise<CustomerProfile> {
    const account = await this.requireAccount(accountId);

    if (input.phone !== undefined) {
      const normalizedPhone = normalizePhilippinePhone(input.phone);
      if (!normalizedPhone) {
        throw new BadRequestException('Please enter a valid Philippine mobile number');
      }
      // Linking runs in a transaction so the account/Customer stay consistent.
      // A conflicting owner throws, rolling back the upsert/backfill too.
      await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({
          where: { normalizedPhone },
          // A brand-new phone-keyed Customer inherits the account identity.
          create: { normalizedPhone, name: account.name, email: account.email },
          update: {},
        });
        // Backfill the COD customer snapshot only where checkout left gaps.
        await tx.customer.updateMany({
          where: { id: customer.id, name: null },
          data: { name: account.name },
        });
        await tx.customer.updateMany({
          where: { id: customer.id, email: null },
          data: { email: account.email },
        });
        const owner = await tx.customerAccount.findUnique({
          where: { customerId: customer.id },
          select: { id: true },
        });
        if (owner && owner.id !== accountId) {
          throw new ConflictException('This phone number is linked to another account');
        }
        await tx.customerAccount.update({
          where: { id: accountId },
          data: { customerId: customer.id, ...(input.name !== undefined ? { name: input.name } : {}) },
        });
      });
    } else if (input.name !== undefined) {
      await this.prisma.customerAccount.update({
        where: { id: accountId },
        data: { name: input.name },
      });
    }

    return this.me(accountId);
  }

  async listOrders(
    accountId: string,
    query: CustomerOrdersQuery,
  ): Promise<{
    items: StorefrontOrderSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const account = await this.requireAccount(accountId);
    if (!account.customerId) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { customerId: account.customerId },
        select: ORDER_SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where: { customerId: account.customerId } }),
    ]);

    const items = rows.map((order) => ({
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      grandTotal: Number(order.grandTotal),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        productNameSnapshot: item.productNameSnapshot,
        variantSnapshot: item.variantSnapshot,
        quantity: item.quantity,
        lineTotal: Number(item.lineTotal),
      })),
    }));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async requireAccount(accountId: string): Promise<AccountWithCustomer> {
    const account = await this.prisma.customerAccount.findUnique({
      where: { id: accountId },
      include: { customer: { select: { normalizedPhone: true } } },
    });
    if (!account) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return account;
  }

  private toProfile(account: AccountWithCustomer): CustomerProfile {
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.customer?.normalizedPhone ?? null,
    };
  }

  private async issueTokens(accountId: string, email: string): Promise<TokenPair> {
    const accessTtl = this.config.getOrThrow<MsDuration>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync(
      { sub: accountId, email, kind: 'customer' },
      { expiresIn: accessTtl },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + durationToMillis(refreshTtl));

    await this.prisma.customerRefreshToken.create({
      data: { accountId, tokenHash: hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, expiresAt };
  }
}
```

- [ ] **Step 4: Run tests and the full gate**

Run: `pnpm exec vitest run src/modules/customers/storefront-customer-auth.service.spec.ts` → PASS.
If a type error appears on `$transaction`/Prisma payload types during `pnpm run build`, widen the mock in the spec (tests compile with the project); do not weaken the service code.
Run: `pnpm run lint && pnpm run build && pnpm exec vitest run` → green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/customers/storefront-customer-auth.service.ts backend/src/modules/customers/storefront-customer-auth.service.spec.ts
git commit -m "feat(customers): storefront register/login/refresh/profile/orders service"
```

---

## Task 6: Storefront customers controller + module wiring

**Files:**
- Create: `backend/src/modules/customers/storefront/customers.controller.ts`
- Modify: `backend/src/modules/customers/customers.module.ts`

**Interfaces:** routes under global prefix `/api/v1`:
`POST /storefront/customers/register|login|refresh|logout`,
`GET/PATCH /storefront/customers/me`, `GET /storefront/customers/me/orders`.

- [ ] **Step 1: Create the controller**

Create `backend/src/modules/customers/storefront/customers.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CustomerJwtGuard } from '../customer-jwt.guard.js';
import { CurrentCustomer } from '../current-customer.decorator.js';
import { StorefrontCustomerAuthService } from '../storefront-customer-auth.service.js';
import {
  customerOrdersQuerySchema,
  loginSchema,
  registerSchema,
  storefrontRefreshSchema,
  updateMeSchema,
  type CustomerOrdersQuery,
  type LoginInput,
  type RegisterInput,
  type StorefrontRefreshInput,
  type UpdateMeInput,
} from '../dto/storefront-customer.dto.js';

/** Public storefront customer account endpoints (spec §5.3). */
@Controller('storefront/customers')
export class StorefrontCustomersController {
  constructor(private readonly auth: StorefrontCustomerAuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(storefrontRefreshSchema)) body: StorefrontRefreshInput) {
    return this.auth.refresh(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(storefrontRefreshSchema)) body: StorefrontRefreshInput) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(CustomerJwtGuard)
  me(@CurrentCustomer() customer: { accountId: string }) {
    return this.auth.me(customer.accountId);
  }

  @Patch('me')
  @UseGuards(CustomerJwtGuard)
  updateMe(
    @CurrentCustomer() customer: { accountId: string },
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ) {
    return this.auth.updateMe(customer.accountId, body);
  }

  @Get('me/orders')
  @UseGuards(CustomerJwtGuard)
  listOrders(
    @CurrentCustomer() customer: { accountId: string },
    @Query(new ZodValidationPipe(customerOrdersQuerySchema)) query: CustomerOrdersQuery,
  ) {
    return this.auth.listOrders(customer.accountId, query);
  }
}
```

- [ ] **Step 2: Wire the module**

Replace `backend/src/modules/customers/customers.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminCustomersController } from './admin/customers.controller.js';
import { CustomerJwtGuard } from './customer-jwt.guard.js';
import { CustomersService } from './customers.service.js';
import { StorefrontCustomerAuthService } from './storefront-customer-auth.service.js';
import { StorefrontCustomersController } from './storefront/customers.controller.js';

@Module({
  // AuthModule exports JwtModule; the customer guard injects JwtService.
  imports: [AuthModule],
  controllers: [AdminCustomersController, StorefrontCustomersController],
  providers: [CustomersService, StorefrontCustomerAuthService, CustomerJwtGuard],
  exports: [CustomersService],
})
export class CustomersModule {}
```

- [ ] **Step 3: Run gates and restart**

Run: `pnpm run lint && pnpm run build && pnpm exec vitest run` → green.
Restart the API on :3000.

- [ ] **Step 4: Live-verify the full account flow**

Run (jq is optional — read raw JSON if unavailable):
```bash
BASE=http://localhost:3000/api/v1/storefront/customers
curl -s -X POST $BASE/register -H 'Content-Type: application/json' \
  -d '{"name":"Test Buyer","email":"buyer@example.com","password":"longpassword"}'
# repeat → expect 409 "already exists"
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/register -H 'Content-Type: application/json' \
  -d '{"name":"Test Buyer","email":"buyer@example.com","password":"longpassword"}'
# wrong password → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/login -H 'Content-Type: application/json' \
  -d '{"email":"buyer@example.com","password":"wrongpassword"}'
# login, capture tokens
TOKENS=$(curl -s -X POST $BASE/login -H 'Content-Type: application/json' \
  -d '{"email":"buyer@example.com","password":"longpassword"}')
echo "$TOKENS"
ACCESS=$(echo "$TOKENS" | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
REFRESH=$(echo "$TOKENS" | sed -E 's/.*"refreshToken":"([^"]+)".*/\1/')
curl -s $BASE/me -H "Authorization: Bearer $ACCESS"
# /me without token → 401; admin guard must reject this customer token:
curl -s -o /dev/null -w '%{http_code}\n' $BASE/me
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $ACCESS"
# link the phone that owns seeded COD orders (use a phone from an existing order;
# any valid PH number returns empty orders if none exist)
curl -s -X PATCH $BASE/me -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"phone":"09170000002"}'
curl -s "$BASE/me/orders" -H "Authorization: Bearer $ACCESS"
curl -s -X POST $BASE/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"
# replaying the old refresh token now → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"
```
Expected codes: 409, 401, `/me` 200 with `phone`, unauthenticated 401, admin `/auth/me` 401, refresh 200 then replay 401.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/customers/storefront/customers.controller.ts backend/src/modules/customers/customers.module.ts
git commit -m "feat(customers): storefront account endpoints (register/login/me/orders)"
```

---

## Task 7: Frontend auth foundation — client, provider, layout

**Files:**
- Create: `frontend/src/lib/auth.ts`
- Create: `frontend/src/components/auth/AuthProvider.tsx`
- Create: `frontend/src/components/auth/Providers.tsx`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces (produces):**
```ts
type CustomerAccount = { id: string; name: string; email: string; phone: string | null };
useAuth(): { status: 'loading'|'authed'|'guest'; account: CustomerAccount|null;
  login(email,password): Promise<void>; register(name,email,password): Promise<void>;
  logout(): Promise<void>; refreshProfile(): Promise<void>;
  saveProfile(input: {name?: string; phone?: string}): Promise<CustomerAccount>; }
customerApi.listOrders(page): Promise<Paged<AccountOrder>>
```

- [ ] **Step 1: Create `lib/auth.ts`**

Create `frontend/src/lib/auth.ts`:

```ts
/**
 * Storefront customer auth client.
 *
 * The refresh token persists in localStorage; the short-lived access token
 * lives only in module memory (cleared on refresh, then re-minted once).
 * A single in-flight refresh promise prevents parallel 401 retries from
 * rotating the same refresh token twice.
 */

const REFRESH_KEY = "sh_refresh";

export interface CustomerAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface AccountOrderItem {
  productNameSnapshot: string;
  variantSnapshot: string;
  quantity: number;
  lineTotal: number;
}

export interface AccountOrder {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  grandTotal: number;
  createdAt: string;
  items: AccountOrderItem[];
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export const tokenStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(REFRESH_KEY, token);
  },
  clear() {
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

let accessToken: string | null = null;
let refreshFlight: Promise<string | null> | null = null;

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `Request failed: ${res.status}`;
  } catch {
    return `Request failed: ${res.status}`;
  }
}

/** Mints a new access token from the stored refresh token (once, shared). */
export async function refreshAccessToken(): Promise<string | null> {
  const stored = tokenStorage.get();
  if (!stored) return null;
  if (!refreshFlight) {
    refreshFlight = (async () => {
      try {
        const res = await fetch("/api/v1/storefront/customers/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (!res.ok) {
          tokenStorage.clear();
          return null;
        }
        const pair = (await res.json()) as TokenPair;
        accessToken = pair.accessToken;
        tokenStorage.set(pair.refreshToken); // rotation
        return pair.accessToken;
      } catch {
        tokenStorage.clear();
        return null;
      } finally {
        refreshFlight = null;
      }
    })();
  }
  return refreshFlight;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const run = (token: string | null) =>
    fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });

  let res = await run(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await run(refreshed);
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

export const customerApi = {
  async register(name: string, email: string, password: string): Promise<CustomerAccount> {
    const res = await fetch("/api/v1/storefront/customers/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as TokenPair & { account: CustomerAccount };
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
    return data.account;
  },

  async login(email: string, password: string): Promise<CustomerAccount> {
    const res = await fetch("/api/v1/storefront/customers/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as TokenPair & { account: CustomerAccount };
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
    return data.account;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStorage.get();
    accessToken = null;
    tokenStorage.clear();
    if (refreshToken) {
      // Best effort: local sign-out happens regardless of the response.
      await fetch("/api/v1/storefront/customers/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  },

  me: () => authedFetch<CustomerAccount>("/api/v1/storefront/customers/me"),

  saveProfile: (input: { name?: string; phone?: string }) =>
    authedFetch<CustomerAccount>("/api/v1/storefront/customers/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  listOrders: (page = 1) =>
    authedFetch<{
      items: AccountOrder[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/v1/storefront/customers/me/orders?page=${page}`),
};

/** Relative redirect target whitelist: same-origin paths only. */
export function safeNext(next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/account";
}
```

- [ ] **Step 2: Create the AuthProvider**

Create `frontend/src/components/auth/AuthProvider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  customerApi,
  refreshAccessToken,
  tokenStorage,
  type CustomerAccount,
} from "@/lib/auth";

type AuthStatus = "loading" | "authed" | "guest";

interface AuthContextValue {
  status: AuthStatus;
  account: CustomerAccount | null;
  login: (email: string, password: string) => Promise<CustomerAccount>;
  register: (name: string, email: string, password: string) => Promise<CustomerAccount>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveProfile: (input: { name?: string; phone?: string }) => Promise<CustomerAccount>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  // Avoid setState after unmount during the mount refresh.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!tokenStorage.get()) {
      setStatus("guest");
      return;
    }
    void (async () => {
      const token = await refreshAccessToken();
      if (!alive.current) return;
      if (!token) {
        setAccount(null);
        setStatus("guest");
        return;
      }
      try {
        const me = await customerApi.me();
        if (!alive.current) return;
        setAccount(me);
        setStatus("authed");
      } catch {
        if (!alive.current) return;
        tokenStorage.clear();
        setAccount(null);
        setStatus("guest");
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await customerApi.login(email, password);
    setAccount(me);
    setStatus("authed");
    return me;
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const me = await customerApi.register(name, email, password);
      setAccount(me);
      setStatus("authed");
      return me;
    },
    [],
  );

  const logout = useCallback(async () => {
    await customerApi.logout();
    setAccount(null);
    setStatus("guest");
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await customerApi.me();
    setAccount(me);
  }, []);

  const saveProfile = useCallback(
    async (input: { name?: string; phone?: string }) => {
      const me = await customerApi.saveProfile(input);
      setAccount(me);
      return me;
    },
    [],
  );

  const value = useMemo(
    () => ({ status, account, login, register, logout, refreshProfile, saveProfile }),
    [status, account, login, register, logout, refreshProfile, saveProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
```

- [ ] **Step 3: Create the Providers wrapper**

Create `frontend/src/components/auth/Providers.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";

/** Client providers that wrap the whole storefront shell. */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```

- [ ] **Step 4: Wrap the layout**

In `frontend/src/app/layout.tsx`, add the import:

```tsx
import { Providers } from "@/components/auth/Providers";
```

and wrap the body contents:

```tsx
      <body className="flex min-h-full flex-col">
        <Providers>
          <MetaPixelInit />
          <AnnouncementBar />
          <Header navItems={navItems} />
          <main className="flex-1">{children}</main>
          <Footer collections={footerCollections} />
        </Providers>
      </body>
```

- [ ] **Step 5: Typecheck**

Run (in `frontend/`): `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/auth.ts frontend/src/components/auth/AuthProvider.tsx frontend/src/components/auth/Providers.tsx frontend/src/app/layout.tsx
git commit -m "feat(storefront): customer auth client and provider"
```

---

## Task 8: Login, register, account pages + header account entry

**Files:**
- Create: `frontend/src/components/auth/AccountEntry.tsx`
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/register/page.tsx`
- Create: `frontend/src/app/account/page.tsx`
- Modify: `frontend/src/components/layout/Header.tsx`

**Interfaces:** consumes `useAuth`, `safeNext`, `customerApi.listOrders` from Task 7.

- [ ] **Step 1: Create the shared form styles / AccountEntry**

Create `frontend/src/components/auth/AccountEntry.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

/**
 * IKEA-style person icon in the header: guests go to /login, signed-in
 * shoppers to /account. SSR/first paint renders the neutral icon only.
 */
export function AccountEntry() {
  const { status, account } = useAuth();

  const icon = (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  if (status === "authed" && account) {
    const firstName = account.name.split(" ")[0] ?? account.name;
    return (
      <Link
        href="/account"
        className="flex items-center gap-2 rounded-lg p-2 text-ink hover:text-cta"
        aria-label="Your account"
      >
        {icon}
        <span className="hidden text-sm font-medium lg:inline">Hi, {firstName}</span>
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      className="flex items-center gap-2 rounded-lg p-2 text-ink hover:text-cta"
      aria-label="Log in"
    >
      {icon}
      <span className="hidden text-sm font-medium lg:inline">
        {status === "loading" ? "" : "Log in"}
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Create the login page**

Create `frontend/src/app/login/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { safeNext } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push(safeNext(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[420px] px-4 py-12">
      <h1 className="text-2xl font-semibold text-ink">Log in</h1>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" size="md" disabled={pending} className="w-full">
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-secondary">
        New to Small House PH?{" "}
        <Link
          href={`/register?next=${encodeURIComponent(safeNext(searchParams.get("next")))}`}
          className="text-cta hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create the register page**

Create `frontend/src/app/register/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { safeNext } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password);
      router.push(safeNext(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[420px] px-4 py-12">
      <h1 className="text-2xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        Check out as always with Cash on Delivery — an account lets you view
        your orders.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Full name
          <input
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="text-xs font-normal text-ink-muted">At least 8 characters.</span>
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" size="md" disabled={pending} className="w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-secondary">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(safeNext(searchParams.get("next")))}`}
          className="text-cta hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
```

- [ ] **Step 4: Create the account page**

Create `frontend/src/app/account/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useAuth } from "@/components/auth/AuthProvider";
import { customerApi, type AccountOrder } from "@/lib/auth";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

const STATUS_LABELS: Record<string, string> = {
  NEW: "Order received",
  PENDING: "Pending",
  QUESTION: "Needs confirmation",
  CONFIRMED: "Confirmed",
  ABNORMAL: "Review needed",
  SHIPPING: "Shipping",
  SIGNED: "Delivered",
  CANCELLED: "Cancelled",
  DENIED: "Denied",
  AFTER_SALES: "After sales",
};

function OrdersPanel() {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    customerApi
      .listOrders(1)
      .then((page) => {
        if (alive) setOrders(page.items);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load orders");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-600" role="alert">{error}</p>;
  }
  if (!orders) {
    return <p className="text-sm text-ink-muted">Loading your orders…</p>;
  }
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-ink-secondary">No orders yet.</p>
        <Link href="/collections" className="mt-2 inline-block text-sm text-cta hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {orders.map((order) => (
        <li key={order.orderNumber}>
          <Link
            href={`/order-success/${order.orderNumber}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 hover:border-primary"
          >
            <div>
              <p className="font-semibold text-ink">{order.orderNumber}</p>
              <p className="text-xs text-ink-muted">
                {new Date(order.createdAt).toLocaleDateString("en-PH", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                {order.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)
                {" · "}
                {STATUS_LABELS[order.orderStatus] ?? order.orderStatus}
              </p>
            </div>
            <span className="font-semibold text-ink">{formatPrice(order.grandTotal)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function AccountPage() {
  const { status, account, saveProfile, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Render-phase redirect would fight hydration; gate after mount instead.
  useEffect(() => {
    if (status === "guest") router.replace("/login?next=/account");
  }, [status, router]);

  useEffect(() => {
    if (account) {
      setName(account.name);
      setPhone(account.phone ?? "");
    }
  }, [account]);

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const input = {
        ...(name.trim() !== account?.name ? { name: name.trim() } : {}),
        ...(phone.trim() && phone.trim() !== account?.phone ? { phone: phone.trim() } : {}),
      };
      if (Object.keys(input).length === 0) {
        setPending(false);
        return;
      }
      await saveProfile(input);
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  if (status === "loading" || status === "guest") {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-sm text-ink-muted">
        Loading your account…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">My account</h1>
        <Button
          variant="secondary"
          size="md"
          onClick={async () => {
            await logout();
            router.push("/");
          }}
        >
          Log out
        </Button>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-ink">Profile</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={onSaveProfile}>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Full name
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Email
            <input className={inputCls} value={account?.email ?? ""} disabled />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Mobile number
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0917 123 4567"
              inputMode="tel"
              autoComplete="tel"
            />
            <span className="text-xs font-normal text-ink-muted">
              Add the number you use for COD orders to see their history here.
            </span>
          </label>
          {message && <p className="text-sm text-cta">{message}</p>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div>
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">My orders</h2>
        <OrdersPanel />
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add the account icon to the header**

In `frontend/src/components/layout/Header.tsx`, add the import:

```tsx
import { AccountEntry } from "@/components/auth/AccountEntry";
```

Wrap the existing cart Link in an icon cluster with the account entry
before it. Do NOT change the cart SVG. Only two edits: (1) add the import,
(2) replace

```tsx
        {/* Cart */}
        <Link
          href="/cart"
          className="ml-auto flex items-center gap-2 rounded-lg p-2 text-ink hover:text-cta"
          aria-label="Shopping cart"
        >
```

with

```tsx
        {/* Account + cart */}
        <div className="ml-auto flex items-center gap-1">
          <AccountEntry />
          <Link
            href="/cart"
            className="flex items-center gap-2 rounded-lg p-2 text-ink hover:text-cta"
            aria-label="Shopping cart"
          >
```

and close the new wrapper `</div>` immediately after the cart Link's
closing `</Link>`. Task 9 moves `ml-auto` from this wrapper onto the
desktop search pill.

- [ ] **Step 6: Gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm build` → green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/auth/AccountEntry.tsx frontend/src/app/login frontend/src/app/register frontend/src/app/account frontend/src/components/layout/Header.tsx
git commit -m "feat(storefront): login/register/account pages and header account entry"
```

---

## Task 9: Site search island + /search results page

**Files:**
- Create: `frontend/src/components/layout/SiteSearch.tsx`
- Create: `frontend/src/app/search/page.tsx`
- Modify: `frontend/src/components/collection/CollectionFilters.tsx`
- Modify: `frontend/src/components/layout/Header.tsx`

**Interfaces:**
- Consumes `api.getProducts({ search, pageSize: 6 })` (already typed in `lib/api.ts`).
- `CollectionFilters` gains optional `preserve?: Record<string, string | undefined>`; existing callers omit it.

- [ ] **Step 1: Add `preserve` to CollectionFilters**

In `frontend/src/components/collection/CollectionFilters.tsx`, change the
props interface:

```tsx
interface CollectionFiltersProps {
  /** Listing path the filter links point at, e.g. /collections/x or /categories/y. */
  basePath: string;
  active: { room?: string; solution?: string; minPrice?: string; maxPrice?: string };
  /** Extra query params every filter link preserves (e.g. { q } on /search). */
  preserve?: Record<string, string | undefined>;
}
```

Change the signature and `qs` builder:

```tsx
export function CollectionFilters({ basePath, active, preserve }: CollectionFiltersProps) {
  // Builds a query string keeping every other dimension as-is.
  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...active, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(preserve ?? {})) {
      if (value && !params.has(key)) params.set(key, value);
    }
    const q = params.toString();
    return q ? `?${q}` : "";
  };
```

Keep the existing `const base = basePath;` line — all the filter links
below still build hrefs as `` `${base}${qs(...)}` ``.

- [ ] **Step 2: Create the SiteSearch island**

Create `frontend/src/components/layout/SiteSearch.tsx`:

```tsx
"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { api, type Product } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";

/**
 * IKEA-style header search (spec §4). Desktop: rounded pill in the header.
 * Mobile: magnifier that opens a bar under the sticky header. Suggestions
 * are portaled to document.body (the blurred header is a containing block
 * for fixed descendants — same lesson as the mega menu).
 */
const DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 6;

function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
}

export function SiteSearch() {
  const router = useRouter();
  const navId = useId();
  // Portals render client-only: false on the server and first paint.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileBarTop, setMobileBarTop] = useState(0);
  const [activeRow, setActiveRow] = useState(-1);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;

  // Debounced suggestion fetch with stale-response protection.
  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setLoading(false);
      setActiveRow(-1);
      return;
    }
    setLoading(true);
    const mySeq = ++seq.current;
    const timer = window.setTimeout(() => {
      api
        .getProducts({ search: trimmed, pageSize: SUGGESTION_LIMIT })
        .then((page) => {
          if (mySeq !== seq.current) return;
          setResults(page.items);
          setLoading(false);
        })
        .catch(() => {
          if (mySeq !== seq.current) return;
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, canSearch]);

  // Focus the mobile input as soon as its bar is mounted.
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  // Scrolling closes every overlay (the sticky header offsets change).
  useEffect(() => {
    if (!open && !mobileOpen) return;
    const onScroll = () => {
      setOpen(false);
      setMobileOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open, mobileOpen]);

  const measure = useCallback((input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  const closeAll = useCallback(() => {
    setOpen(false);
    setMobileOpen(false);
  }, []);

  const goToResults = useCallback(
    (value: string) => {
      const q = value.trim();
      if (!q) return;
      closeAll();
      router.push(`/search?q=${encodeURIComponent(q)}`);
    },
    [router, closeAll],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRow >= 0 && results[activeRow]) {
      const product = results[activeRow];
      closeAll();
      router.push(`/products/${product.slug}`);
      return;
    }
    goToResults(query);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && open && results.length > 0) {
      event.preventDefault();
      setActiveRow((cur) => (cur + 1) % results.length);
    } else if (event.key === "ArrowUp" && open && results.length > 0) {
      event.preventDefault();
      setActiveRow((cur) => (cur <= -1 ? results.length - 1 : cur - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveRow(-1);
    }
  }

  // One field description, instantiated separately for the desktop pill and
  // the mobile bar so the mobile input deterministically owns its ref.
  const renderField = (inputRef: { current: HTMLInputElement | null } | null) => (
    <form role="search" onSubmit={onSubmit} className="w-full">
      <div className="relative w-full">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef ?? undefined}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveRow(-1);
          }}
          onFocus={(e) => {
            setOpen(true);
            measure(e.currentTarget);
          }}
          onClick={(e) => measure(e.currentTarget)}
          onKeyDown={onKeyDown}
          placeholder="Search furniture…"
          aria-label="Search products"
          aria-expanded={open}
          aria-controls={`${navId}-search-suggestions`}
          className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
        />
      </div>
    </form>
  );

  return (
    <>
      {/* Mobile: icon button. ml-auto pushes the mobile icon group
          (search/account/cart) to the right edge; on desktop this button is
          hidden and the pill below carries its own ml-auto. */}
      <button
        type="button"
        onClick={() => {
          const header = document.querySelector("header");
          setMobileBarTop(header?.getBoundingClientRect().bottom ?? 0);
          setMobileOpen(true);
        }}
        aria-label="Search"
        className="ml-auto flex items-center rounded-lg p-2 text-ink hover:text-cta lg:hidden"
      >
        <SearchIcon className="h-6 w-6" />
      </button>

      {/* Desktop: pill (ml-auto pushes it to the right of the nav) */}
      <div className="ml-auto hidden w-full max-w-[420px] lg:block">
        {renderField(null)}
      </div>

      {/* Mobile full-width bar under the sticky header */}
      {mounted &&
        mobileOpen &&
        createPortal(
          <div
            className="fixed inset-x-0 z-50 border-b border-border bg-background p-3 shadow-lg lg:hidden"
            style={{ top: mobileBarTop }}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1">{renderField(mobileInputRef)}</div>
              <button
                type="button"
                onClick={closeAll}
                aria-label="Close search"
                className="rounded-lg p-2 text-ink hover:text-cta"
              >
                ✕
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Suggestions dropdown (desktop and mobile) */}
      {mounted &&
        open &&
        canSearch &&
        anchor &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close suggestions"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              id={`${navId}-search-suggestions`}
              className="fixed z-50 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
              style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
              role="listbox"
            >
              {loading && results.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">
                  No matches — press Enter to search
                </p>
              ) : (
                <ul className="max-h-[360px] overflow-y-auto py-1">
                  {results.map((product, index) => {
                    const firstImage = product.images[0]?.url;
                    const price = product.variants[0]?.sku?.price ?? null;
                    return (
                      <li key={product.id}>
                        <Link
                          href={`/products/${product.slug}`}
                          onClick={closeAll}
                          onMouseEnter={() => setActiveRow(index)}
                          role="option"
                          aria-selected={activeRow === index}
                          className={`flex items-center gap-3 px-3 py-2 ${
                            activeRow === index ? "bg-primary-light/40" : ""
                          }`}
                        >
                          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
                            {firstImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={firstImage}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <PlaceholderImage label="" className="h-full w-full" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {product.name}
                            </span>
                            <span className="text-sm font-semibold text-ink">
                              {price !== null ? formatPrice(price) : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  <li className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => goToResults(query)}
                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-cta hover:bg-primary-light/40"
                    >
                      See all results for “{trimmed}”
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
```

- [ ] **Step 3: Place SiteSearch in the header**

In `frontend/src/components/layout/Header.tsx`, add:

```tsx
import { SiteSearch } from "./SiteSearch";
```

Insert `<SiteSearch />` **between** `<MainNav items={navItems} />` and the
account/cart cluster. Two small edits:

1. Add `import { SiteSearch } from "./SiteSearch";`.
2. The cluster wrapper created in Task 8 changes from
   `<div className="ml-auto flex items-center gap-1">` to
   `<div className="flex shrink-0 items-center gap-1">` — the desktop
   search pill now carries `ml-auto`. The cart Link itself is unchanged.

Final inner structure:

```tsx
        <MainNav items={navItems} />
        <SiteSearch />
        <div className="flex shrink-0 items-center gap-1">
          <AccountEntry />
          {/* cart Link unchanged */}
        </div>
```

- [ ] **Step 4: Create the /search results page**

Create `frontend/src/app/search/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { ProductCard } from "@/components/product/ProductCard";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

interface SearchParams {
  q?: string;
  page?: string;
  room?: string;
  solution?: string;
  minPrice?: string;
  maxPrice?: string;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  let products: Paged<Product> | null = null;
  let roots: Category[] = [];

  if (q) {
    // `q` is the page param; the storefront API parameter is `search`.
    const params = new URLSearchParams({
      search: q,
      page: String(page),
      pageSize: "24",
    });
    if (sp.room) params.set("room", sp.room);
    if (sp.solution) params.set("solution", sp.solution);
    if (sp.minPrice) params.set("minPrice", sp.minPrice);
    if (sp.maxPrice) params.set("maxPrice", sp.maxPrice);

    const [productsRes, categoriesRes] = await Promise.all([
      fetch(serverApiUrl(`/api/v1/storefront/products?${params.toString()}`), {
        next: { revalidate: 120 },
      }),
      fetch(serverApiUrl("/api/v1/storefront/categories"), { next: { revalidate: 300 } }),
    ]);
    if (productsRes.ok) products = (await productsRes.json()) as Paged<Product>;
    if (categoriesRes.ok) roots = (await categoriesRes.json()) as Category[];
  }

  const items = products?.items ?? [];
  const totalPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;
  const activeFilterCount =
    (sp.room ? 1 : 0) + (sp.solution ? 1 : 0) + (sp.minPrice !== undefined ? 1 : 0);

  // Pagination keeps the query and every active filter.
  const pageHref = (target: number) => {
    const p = new URLSearchParams({ q, page: String(target) });
    if (sp.room) p.set("room", sp.room);
    if (sp.solution) p.set("solution", sp.solution);
    if (sp.minPrice) p.set("minPrice", sp.minPrice);
    if (sp.maxPrice) p.set("maxPrice", sp.maxPrice);
    return `/search?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {!q ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <h1 className="text-2xl font-semibold text-ink">Search</h1>
          <p className="mt-2 text-ink-secondary">
            Start by typing what you’re looking for in the search bar.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
            Search results for “{q}”
            {products && (
              <span className="ml-2 text-base font-normal text-ink-muted">({products.total})</span>
            )}
          </h1>

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <CollectionFilters
              basePath="/search"
              preserve={{ q }}
              active={{ room: sp.room, solution: sp.solution, minPrice: sp.minPrice, maxPrice: sp.maxPrice }}
            />
          </div>

          {items.length === 0 ? (
            <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-ink-secondary">
                {activeFilterCount > 0
                  ? "No products match these filters."
                  : `No products match “${q}”. Check the spelling or browse a category.`}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {roots.map((root) => (
                  <Link
                    key={root.id}
                    href={`/categories/${root.slug}`}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink-secondary hover:border-primary hover:text-cta"
                  >
                    {root.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <nav aria-label="Search pages" className="mt-8 flex items-center justify-center gap-4">
                {page > 1 && (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:border-primary"
                  >
                    Previous
                  </Link>
                )}
                <span className="text-sm text-ink-muted">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:border-primary"
                  >
                    Load more
                  </Link>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Exclude /search from the sitemap**

The sitemap (`frontend/src/app/sitemap.ts`) only enumerates known routes;
confirm no line adds `/search` (nothing to change if absent). The
`robots: { index: false }` metadata above is the mechanism.

- [ ] **Step 6: Gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm build` → green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layout/SiteSearch.tsx frontend/src/app/search/page.tsx frontend/src/components/collection/CollectionFilters.tsx frontend/src/components/layout/Header.tsx
git commit -m "feat(storefront): header search with suggestions and /search results"
```

---

## Task 10: Full gates + live verification

**Files:** none (verification only).

- [ ] **Step 1: Backend gate**

Run in `backend/`:
```bash
pnpm run lint && pnpm run build && pnpm exec vitest run
```
Expected: lint clean, build success, **all** specs pass (including the new
product-search, customer guard and customer auth service specs).

- [ ] **Step 2: Frontend gate**

Run in `frontend/`:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: clean; build output includes `/login`, `/register`, `/account`,
`/search` routes.

- [ ] **Step 3: Restart both servers**

Backend :3000 from `backend/dist/main`; frontend `next start -p 3001`
(rebuild already done by the gate).

- [ ] **Step 4: Chrome desktop verification (≥1280px)**

On `http://localhost:3001/`:
1. Header shows the rounded search pill between nav and the person/cart icons.
2. Type `chari` — within ~250ms a suggestion dropdown lists chair products
   (thumbnail/placeholder, name, price). Arrow keys move the highlight;
   Enter on a highlighted row opens that PDP; plain Enter opens
   `/search?q=chari` showing the chairs with `(N)` count.
3. On `/search?…`, click a room/price filter — the URL keeps `q=chari`;
   a nonsense query (`zzqqx`) shows the empty state with four category
   chips.
4. Person icon → `/login`. Register a new account (name/email/8-char
   password) → redirected to `/account`; header now reads "Hi, {first}".
   Log out → back to guest icon. Log in again via `/login`.
5. In Account, save phone `09170000002` (the test-linked number); profile
   shows the E.164 value; if an order exists for that number it appears in
   "My orders" and links to `/order-success/<number>`. Invalid phone shows
   the API validation error.

- [ ] **Step 5: Chrome mobile verification (390×844 touch emulation)**

1. Header row: hamburger left, centered logo, then search / person / cart
   at the right.
2. Tap search icon → bar opens directly under the sticky header, focused;
   type and see the same suggestions; ✕ closes; scrolling closes it.
3. Person icon → login flow works; "Hi, {first}" replaces "Log in".
4. Mega-menu drawer from the earlier feature still opens/closes (no
   regression).

- [ ] **Step 6: Final commit if anything was touched**

If verification required fixes, commit them with explicit paths:
```bash
git add <paths>
git commit -m "fix(storefront): search/auth verification fixes"
```
Do NOT stage `docs/frontend/HOMEPAGE_SPEC.md`, the PDP plan file, or
`docs/research/`. Do not push without asking.
