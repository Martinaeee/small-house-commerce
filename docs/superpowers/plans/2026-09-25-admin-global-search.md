# Admin Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real RBAC-aware Admin command palette and full search page for Products/SKUs, Orders, Customers, and Shipments, with stable navigation into each existing business context.

**Architecture:** Add a dedicated Nest SearchModule as a narrow cross-domain read model. It authenticates with the existing admin JWT, derives the caller’s granted entity groups once, executes only authorized parameterized PostgreSQL ranking queries, and returns grouped `limit + 1` projections without counts. The frontend adds one reusable search hook and result renderer, mounted through AdminGlobalHeader’s existing slot and reused by `/admin/search`; navigation extensions remain presentation-only and do not create secondary Product, Order, Customer, Shipment, Variant, or inventory state.

**Tech Stack:** NestJS 12, Prisma 7/PostgreSQL, Zod 4, Vitest 4 backend, Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS 4, Testing Library/Vitest frontend, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-25-admin-global-search-design.md`

## Global Constraints

- Work only on `feature/admin-product-ui-redesign`; never modify `main` directly.
- Before writing frontend code, read the relevant Next.js 16 guides under `small-house-commerce/frontend/node_modules/next/dist/docs/` as required by `small-house-commerce/frontend/AGENTS.md`; do not rely on older App Router conventions.
- Do not touch or stage the existing untracked `small-house-commerce/backend/uploads/` directory.
- Scope is Global Search Phase B only: no PDP, Notifications, Product Media, collection membership, bulk SKU, shipping workflow, SEO, or preview work.
- No Prisma schema change, database migration, new npm dependency, production deployment, push, or merge.
- Query contract: normalized `q` is 2–100 characters; exact/prefix matching starts at 2, contains starts at 3; `limit` defaults to 5 and is clamped by validation to 1–20.
- UI debounce is exactly 250ms; stale requests are aborted and may never overwrite a newer response.
- Palette renders at most five results per authorized entity; full page may request 20.
- RBAC: Products=`PRODUCT_MANAGE`, Orders=`ORDER_VIEW_ALL`, Customers=`CUSTOMER_MANAGE`, Shipments=`ORDER_VIEW_ALL`; `SHIPMENT_CREATE` stays write-only and `ORDER_VIEW_OWN` receives no Order/Shipment search in V1.
- Unauthorized groups are omitted and never queried. An ACTIVE user with no supported permission receives `{ groups: {} }`; missing/inactive identity receives 403.
- Search executes no total-count query, no Product graph hydration, no full Order workbench hydration, no shared cache, and logs no raw query/phone/email.
- Product/SKU search includes Draft/Disabled/unpriced records because it is admin navigation, not sellability filtering.
- SKU deep links use React refs and stable SKU identity; no timeout, `querySelector`, `nth-child`, or array-index identity.
- Follow TDD for every behavior: write the test, run it and see the expected failure, add the minimum implementation, then rerun to green.
- Each task is committed independently; do not push or deploy.
- Final gate includes backend/frontend full unit suites, TypeScript, ESLint/oxlint, both builds, complete Playwright, `git diff --check`, real 1440/1920 screenshots, zero console/page/hydration errors, and a clean tracked tree.

## Review Focus

1. Literal wildcard input such as `%`, `_`, and `\` must be matched as text, never expand a SQL LIKE pattern; Task 1 pins escaping and parameterization.
2. One Product matching both its own fields and several SKUs must appear once with the highest-ranked match, and an exact hit must never be lost behind many contains hits; Task 1 query tests and Task 10 real-Postgres E2E pin this.
3. A slow prior response or AbortError must never replace or erase a newer successful query; Task 5 pins both race orders.
4. Mixed permissions, inactive users, and `ORDER_VIEW_OWN`-only users must never trigger or expose unauthorized entity queries; Task 2 and Task 10 pin query counts and API payloads.
5. An SKU on a non-first typed VariantMatrix page and an SKU in a legacy graph-v0 editor must both deep-link without DOM selectors or timers; Task 9 pins both paths.

---

## File Structure

### Backend

- `small-house-commerce/backend/src/modules/search/dto/search.dto.ts` — request schema and public grouped result interfaces.
- `small-house-commerce/backend/src/modules/search/dto/search.dto.spec.ts` — query normalization and validation contract.
- `small-house-commerce/backend/src/modules/search/search.queries.ts` — search-term normalization, literal LIKE escaping, score constants, and four parameterized SQL builders.
- `small-house-commerce/backend/src/modules/search/search.queries.spec.ts` — pattern safety, score precedence, contains threshold, and SQL binding tests.
- `small-house-commerce/backend/src/modules/search/search.service.ts` — active-user permission snapshot, authorized parallel query execution, row serialization, deduped groups, and `hasMore`.
- `small-house-commerce/backend/src/modules/search/search.service.spec.ts` — RBAC, mapping, omission, error, and no-leak unit tests.
- `small-house-commerce/backend/src/modules/search/admin/search.controller.ts` — authenticated GET endpoint with no-store response.
- `small-house-commerce/backend/src/modules/search/admin/search.controller.spec.ts` — controller delegation and identity tests.
- `small-house-commerce/backend/src/modules/search/search.module.ts` — AuthModule/controller/provider wiring.
- `small-house-commerce/backend/src/app.module.ts` — imports SearchModule.

### Frontend

- `small-house-commerce/frontend/src/lib/admin-api.ts` — search/customer wire types and authenticated API methods.
- `small-house-commerce/frontend/src/lib/admin-search.ts` — group order, flattening, stable option IDs, and result href construction.
- `small-house-commerce/frontend/src/lib/admin-search.spec.ts` — pure result ordering and URL encoding tests.
- `small-house-commerce/frontend/src/components/admin/useAdminSearch.ts` — debounced/cancellable/stale-safe search state.
- `small-house-commerce/frontend/src/components/admin/useAdminSearch.spec.tsx` — hook timing and race tests.
- `small-house-commerce/frontend/src/components/admin/AdminSearchResults.tsx` — reusable grouped result renderer for dialog/page modes.
- `small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.tsx` — responsive trigger, command dialog, keyboard/focus orchestration.
- `small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.spec.tsx` — accessibility, keyboard, pointer, state, and navigation tests.
- `small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.tsx` — makes the existing search slot visible as compact mobile trigger and full desktop control.
- `small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.spec.tsx` — preserves honest fallback and verifies real responsive slot.
- `small-house-commerce/frontend/src/components/admin/AdminShell.tsx` — injects one AdminGlobalSearch instance with real permissions.
- `small-house-commerce/frontend/src/app/admin/(shell)/search/page.tsx` — full grouped results page using the shared hook/renderer.
- `small-house-commerce/frontend/src/app/admin/(shell)/search/page.spec.tsx` — URL query and state rendering tests.
- `small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.tsx` — minimal read-only Customer result destination.
- `small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.spec.tsx` — permission/loading/error/real-data tests.
- `small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx` — validates and forwards section/SKU navigation.
- `small-house-commerce/frontend/src/components/admin/ProductForm.tsx` — selects the requested tab and focuses legacy SKU inputs by refs.
- `small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx` — pages to and focuses typed SKU inputs by refs.
- Existing ProductForm/edit/VariantMatrix specs — deep-link regression tests.
- `small-house-commerce/frontend/src/app/admin/(shell)/orders/[id]/page.tsx` — stable Shipment section anchor.
- `small-house-commerce/frontend/src/i18n/zh.ts` and `en.ts` — complete Admin search strings in Task 6 and Customer-detail strings in Task 8.
- `small-house-commerce/backend/prisma/seed-e2e.ts` and `seed-e2e.spec.ts` — test-only Super Admin/Warehouse/Optimizer identities, guarded by the existing test-database refusal.
- `small-house-commerce/frontend/e2e/admin-global-search.spec.ts` — real-stack search/RBAC/deep-link/browser acceptance.

---

### Task 1: Backend search contract and safe SQL builders

**Files:**
- Create: `small-house-commerce/backend/src/modules/search/dto/search.dto.ts`
- Create: `small-house-commerce/backend/src/modules/search/dto/search.dto.spec.ts`
- Create: `small-house-commerce/backend/src/modules/search/search.queries.ts`
- Create: `small-house-commerce/backend/src/modules/search/search.queries.spec.ts`

**Interfaces:**
- Produces `adminSearchQuerySchema`, `AdminSearchQuery`, `AdminSearchResponse`, `SearchGroup<T>`, and four hit interfaces.
- Produces `normalizeSearchTerms(query: string): SearchTerms`.
- Produces `buildProductSearchQuery(terms, take)`, `buildOrderSearchQuery(terms, take)`, `buildCustomerSearchQuery(terms, take)`, and `buildShipmentSearchQuery(terms, take)`, each returning `Prisma.Sql`.
- Later tasks consume these exact names.

- [ ] **Step 1: Write failing DTO contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { adminSearchQuerySchema } from './search.dto.js';

describe('adminSearchQuerySchema', () => {
  it('normalizes whitespace and defaults limit to five', () => {
    expect(adminSearchQuerySchema.parse({ q: '  rolling   cart  ' })).toEqual({
      q: 'rolling cart',
      limit: 5,
    });
  });

  it.each(['', ' ', 'a', '🪑'])('rejects queries shorter than two Unicode characters: %j', (q) => {
    expect(adminSearchQuerySchema.safeParse({ q }).success).toBe(false);
  });

  it('counts Unicode code points consistently with the client', () => {
    expect(adminSearchQuerySchema.parse({ q: '🪑桌' }).q).toBe('🪑桌');
  });

  it('rejects a query over 100 characters and a limit over 20', () => {
    expect(adminSearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(adminSearchQuerySchema.safeParse({ q: 'chair', limit: 21 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the DTO test and verify RED**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search/dto/search.dto.spec.ts
```

Expected: FAIL because `search.dto.js` does not exist.

- [ ] **Step 3: Add the request schema and exact response interfaces**

```ts
import { z } from 'zod';

const normalizedQuery = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => {
    const length = [...value].length;
    return length >= 2 && length <= 100;
  }, 'q must contain 2 to 100 characters');

export const adminSearchQuerySchema = z.object({
  q: normalizedQuery,
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;
export interface SearchGroup<T> { items: T[]; hasMore: boolean }
```

Define the four hit interfaces exactly as approved in the spec, including `kind`, `matchedField`, `matchedText`, optional `matchedSku`, and grouped optional keys.

- [ ] **Step 4: Run the DTO test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing normalization and SQL-safety tests**

```ts
import type { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_SCORE,
  ORDER_SCORE,
  PRODUCT_SCORE,
  SHIPMENT_SCORE,
  buildProductSearchQuery,
  normalizeSearchTerms,
} from './search.queries.js';

function flatSqlValues(sql: Prisma.Sql): unknown[] {
  const values: unknown[] = [];
  const walk = (value: unknown): void => {
    if (value && typeof value === 'object' && 'values' in value) {
      for (const nested of (value as Prisma.Sql).values) walk(nested);
      return;
    }
    values.push(value);
  };
  for (const value of sql.values) walk(value);
  return values;
}

describe('normalizeSearchTerms', () => {
  it('escapes LIKE wildcards as literal characters', () => {
    expect(normalizeSearchTerms('50%_OFF\\SKU')).toMatchObject({
      exact: '50%_off\\sku',
      prefix: '50\\%\\_off\\\\sku%',
      contains: '%50\\%\\_off\\\\sku%',
    });
  });

  it('withholds contains for two-character searches', () => {
    expect(normalizeSearchTerms('ab').contains).toBeNull();
    expect(normalizeSearchTerms('abc').contains).toBe('%abc%');
  });

  it('normalizes complete and partial Philippine phone input without inventing a number', () => {
    expect(normalizeSearchTerms('0917 123 4567')).toMatchObject({
      phoneExact: '+639171234567',
      phoneDigits: '09171234567',
      phonePrefix: '09171234567%',
      phoneContains: '%09171234567%',
    });
    expect(normalizeSearchTerms('0917-12')).toMatchObject({
      phoneExact: null,
      phoneDigits: '091712',
      phonePrefix: '091712%',
      phoneContains: '%091712%',
    });
    expect(normalizeSearchTerms('not-a-phone')).toMatchObject({
      phoneExact: null,
      phoneDigits: null,
      phonePrefix: null,
      phoneContains: null,
    });
  });
});

describe('product search SQL', () => {
  it('keeps exact product code above exact SKU and binds user input', () => {
    expect(PRODUCT_SCORE.PRODUCT_CODE_EXACT).toBeGreaterThan(PRODUCT_SCORE.SKU_CODE_EXACT);
    const sql = buildProductSearchQuery(normalizeSearchTerms("x%' OR TRUE --"), 6);
    expect(sql.strings.join('')).not.toContain("x%' OR TRUE --");
    expect(flatSqlValues(sql)).toContain("x%' or true --");
  });
});
```

Pin every numeric score in the test and export the same constant objects from `search.queries.ts`:

```ts
expect(PRODUCT_SCORE).toEqual({
  PRODUCT_CODE_EXACT: 1000, SKU_CODE_EXACT: 950, NAME_EXACT: 900, SLUG_EXACT: 850,
  PRODUCT_CODE_PREFIX: 700, SKU_CODE_PREFIX: 675, NAME_PREFIX: 650, SLUG_PREFIX: 625,
  PRODUCT_CODE_CONTAINS: 400, SKU_CODE_CONTAINS: 375, NAME_CONTAINS: 350, SLUG_CONTAINS: 325,
});
expect(ORDER_SCORE).toEqual({
  ORDER_NUMBER_EXACT: 1000, PHONE_EXACT: 900, CUSTOMER_NAME_EXACT: 800,
  ORDER_NUMBER_PREFIX: 700, PHONE_PREFIX: 650, CUSTOMER_NAME_PREFIX: 600,
  ORDER_NUMBER_CONTAINS: 400, PHONE_CONTAINS: 350, CUSTOMER_NAME_CONTAINS: 300,
});
expect(CUSTOMER_SCORE).toEqual({
  PHONE_EXACT: 1000, EMAIL_EXACT: 900, NAME_EXACT: 800,
  PHONE_PREFIX: 700, EMAIL_PREFIX: 650, NAME_PREFIX: 600,
  PHONE_CONTAINS: 400, EMAIL_CONTAINS: 350, NAME_CONTAINS: 300,
});
expect(SHIPMENT_SCORE).toEqual({
  TRACKING_NUMBER_EXACT: 1000,
  TRACKING_NUMBER_PREFIX: 700,
  TRACKING_NUMBER_CONTAINS: 400,
});
```

Use those exact exported objects in the CASE builders rather than duplicating numeric literals.

- [ ] **Step 6: Run query tests and verify RED**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search/search.queries.spec.ts
```

Expected: FAIL because query helpers do not exist.

- [ ] **Step 7: Implement literal patterns and four parameterized queries**

```ts
import { Prisma } from '../../generated/prisma/client.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export interface SearchTerms {
  exact: string;
  prefix: string;
  contains: string | null;
  phoneExact: string | null;
  phoneDigits: string | null;
  phonePrefix: string | null;
  phoneContains: string | null;
}

export function normalizeSearchTerms(query: string): SearchTerms {
  const normalized = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const escaped = escapeLike(normalized);
  const digits = /^[+\d()\-\s]+$/.test(query) ? query.replace(/\D/g, '') : '';
  const phoneDigits = digits.length >= 2 ? digits : null;
  return {
    exact: normalized,
    prefix: `${escaped}%`,
    contains: [...normalized].length >= 3 ? `%${escaped}%` : null,
    phoneExact: normalizePhilippinePhone(query),
    phoneDigits,
    phonePrefix: phoneDigits === null ? null : `${escapeLike(phoneDigits)}%`,
    phoneContains:
      phoneDigits === null || [...normalized].length < 3
        ? null
        : `%${escapeLike(phoneDigits)}%`,
  };
}
```

Build every statement with `Prisma.sql`, bound values, `LIKE ... ESCAPE '\\'`, explicit aliases, `LIMIT ${take}`, and no interpolated raw text. Compare textual fields as `lower(column)` against the already-lowercased bound terms so exact/prefix/contains matching is case-insensitive. In Order/Customer SQL compare phone patterns against both canonical digits (`replace(normalized_phone, '+', '')`, for example `63917…`) and local digits (`'0' || substring(replace(normalized_phone, '+', '') from 3)`, for example `0917…`) so formatted partial input such as `0917-12` remains searchable without manufacturing a full phone number.

Product SQL uses these exact stages, all inside one `Prisma.sql` value:

1. `inventory_totals(sku_id, available_inventory)` groups `inventory` by `sku_id` and computes `COALESCE(SUM(on_hand - reserved), 0)::int`.
2. `candidates` unions one Product-field candidate per matching Product with one SKU-field candidate per matching SKU. Every branch selects `product_id`, `name`, `product_code`, `slug`, `product_status`, `updated_at`, `matched_field`, `matched_text`, `score`, `sku_id`, `sku_code`, `sku_status`, `variant_id`, `variant_name`, `price`, and `available_inventory`; Product-field rows use typed nulls for SKU columns.
3. Product-field CASE order and scores are exactly `PRODUCT_CODE`, `NAME`, then `SLUG` within exact/prefix/contains tiers; SKU-field rows use the SKU constants from `PRODUCT_SCORE`.
4. `ranked` adds `row_number() OVER (PARTITION BY product_id ORDER BY score DESC, sku_id NULLS LAST, product_id)`.
5. The final select keeps `product_rank = 1`, orders by `score DESC, updated_at DESC, product_id ASC`, and binds `LIMIT ${take}`.

Order, Customer, and Shipment queries use their declared CASE scores and deterministic `score DESC`, recent timestamp DESC, UUID ASC ordering. Include contains predicates only when `terms.contains !== null`, and phone contains predicates only when `terms.phoneContains !== null`. Keep the selected aliases identical to the private raw-row interfaces consumed in Task 2.

- [ ] **Step 8: Run both Task 1 specs, backend type/build check, and verify GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/search/dto/search.dto.spec.ts \
  src/modules/search/search.queries.spec.ts
pnpm --dir small-house-commerce/backend build
```

Expected: all PASS; no TypeScript error.

- [ ] **Step 9: Commit Task 1**

```bash
git add small-house-commerce/backend/src/modules/search/dto/search.dto.ts \
  small-house-commerce/backend/src/modules/search/dto/search.dto.spec.ts \
  small-house-commerce/backend/src/modules/search/search.queries.ts \
  small-house-commerce/backend/src/modules/search/search.queries.spec.ts
git commit -m "feat(admin): define global search query contract"
```

---

### Task 2: RBAC-aware aggregate SearchService

**Files:**
- Create: `small-house-commerce/backend/src/modules/search/search.service.ts`
- Create: `small-house-commerce/backend/src/modules/search/search.service.spec.ts`

**Interfaces:**
- Consumes Task 1 query builders and result interfaces.
- Produces `SearchService.search(userId: string, query: AdminSearchQuery): Promise<AdminSearchResponse>`.
- Controller in Task 3 depends on this exact method.

- [ ] **Step 1: Write failing RBAC and mapping tests**

Create a harness with `user.findUnique` and `$queryRaw` mocks. Pin these behaviors with explicit tests:

```ts
it('queries only groups authorized by the active user', async () => {
  const { service, prisma } = harness(['PRODUCT_MANAGE']);
  prisma.$queryRaw.mockResolvedValueOnce([productRow]);

  const result = await service.search(USER_ID, { q: 'chair', limit: 5 });

  expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  expect(prisma.user.findUnique.mock.calls[0]![0]).not.toHaveProperty('include');
  expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  expect(Object.keys(result.groups)).toEqual(['products']);
  expect(result.groups.products?.items[0]).toMatchObject({
    kind: 'PRODUCT',
    productId: PRODUCT_ID,
    matchedField: 'SKU_CODE',
    matchedSku: { skuCode: 'CHAIR-L', price: '1590', availableInventory: 17 },
  });
  expect(result.groups.products?.items[0]).not.toHaveProperty('supplierCost');
});

it('returns no groups and performs no raw query for ORDER_VIEW_OWN only', async () => {
  const { service, prisma } = harness(['ORDER_VIEW_OWN']);
  await expect(service.search(USER_ID, { q: 'PH12', limit: 5 })).resolves.toEqual({
    query: 'PH12',
    groups: {},
  });
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});

it.each(['DISABLED', null])('rejects missing or inactive identity: %s', async (status) => {
  const { service, prisma } = harness([]);
  prisma.user.findUnique.mockResolvedValue(status ? userWith([], status) : null);
  await expect(service.search(USER_ID, { q: 'chair', limit: 5 })).rejects.toBeInstanceOf(ForbiddenException);
});
```

Also test:

- all four permissions produce Product → Order → Customer → Shipment keys regardless of asynchronous completion order;
- `limit + 1` rows become `limit` items plus `hasMore: true`;
- nullable price/email map to null;
- Decimal price maps through `String`;
- Date maps to ISO-safe Date/string response value;
- duplicate Shipment tracking rows remain separate;
- one authorized query rejection rejects the aggregate response instead of returning partial completeness.

- [ ] **Step 2: Run service spec and verify RED**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search/search.service.spec.ts
```

Expected: FAIL because SearchService does not exist.

- [ ] **Step 3: Implement active-user permission snapshot and authorized parallel queries**

```ts
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: AdminSearchQuery): Promise<AdminSearchResponse> {
    const permissions = await this.permissionsForActiveUser(userId);
    const terms = normalizeSearchTerms(query.q);
    const take = query.limit + 1;
    const groups: AdminSearchResponse['groups'] = {};

    const jobs: Promise<void>[] = [];
    if (permissions.has('PRODUCT_MANAGE')) {
      jobs.push(this.productGroup(terms, query.limit, take).then((group) => { groups.products = group; }));
    }
    if (permissions.has('ORDER_VIEW_ALL')) {
      jobs.push(this.orderGroup(terms, query.limit, take).then((group) => { groups.orders = group; }));
      jobs.push(this.shipmentGroup(terms, query.limit, take).then((group) => { groups.shipments = group; }));
    }
    if (permissions.has('CUSTOMER_MANAGE')) {
      jobs.push(this.customerGroup(terms, query.limit, take).then((group) => { groups.customers = group; }));
    }
    await Promise.all(jobs);

    return {
      query: query.q,
      groups: {
        ...(groups.products ? { products: groups.products } : {}),
        ...(groups.orders ? { orders: groups.orders } : {}),
        ...(groups.customers ? { customers: groups.customers } : {}),
        ...(groups.shipments ? { shipments: groups.shipments } : {}),
      },
    };
  }
}
```

Implement the permission snapshot as a narrow `select`, not the broader `include` from PermissionsGuard:

```ts
import type { PermissionCode } from '../../generated/prisma/client.js';

private async permissionsForActiveUser(userId: string): Promise<Set<PermissionCode>> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      roles: {
        select: {
          role: {
            select: {
              permissions: {
                select: { permission: { select: { code: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!user || user.status !== 'ACTIVE') throw new ForbiddenException();
  return new Set(
    user.roles.flatMap(({ role }) =>
      role.permissions.map(({ permission }) => permission.code),
    ),
  );
}
```

Keep raw row interfaces private. Map `take` rows with a shared helper:

```ts
function toGroup<T>(rows: T[], limit: number): SearchGroup<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
```

Do not log query values or catch entity errors into partial results.

- [ ] **Step 4: Run service tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run all new backend search tests and build**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search
pnpm --dir small-house-commerce/backend build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add small-house-commerce/backend/src/modules/search/search.service.ts \
  small-house-commerce/backend/src/modules/search/search.service.spec.ts
git commit -m "feat(admin): aggregate authorized search results"
```

---

### Task 3: Search endpoint and Nest module wiring

**Files:**
- Create: `small-house-commerce/backend/src/modules/search/admin/search.controller.ts`
- Create: `small-house-commerce/backend/src/modules/search/admin/search.controller.spec.ts`
- Create: `small-house-commerce/backend/src/modules/search/search.module.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts:5-43`

**Interfaces:**
- Consumes `SearchService.search(userId, query)`.
- Produces `GET /api/v1/admin/search?q=...&limit=...` behind JwtAuthGuard with `Cache-Control: private, no-store`.

- [ ] **Step 1: Write the failing controller test**

```ts
it('delegates the validated query with the current admin user id', async () => {
  const search = vi.fn().mockResolvedValue({ query: 'chair', groups: {} });
  const controller = new AdminSearchController({ search } as never);

  await expect(
    controller.search({ q: 'chair', limit: 5 }, { userId: USER_ID, email: 'admin@test' }),
  ).resolves.toEqual({ query: 'chair', groups: {} });
  expect(search).toHaveBeenCalledWith(USER_ID, { q: 'chair', limit: 5 });
});
```

Pin guard metadata without applying the all-required Permissions decorator:

```ts
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';

it('requires authentication without declaring all entity permissions', () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, AdminSearchController)).toContain(JwtAuthGuard);
  expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminSearchController)).toBeUndefined();
});

it('marks every response private and non-cacheable', () => {
  expect(
    Reflect.getMetadata(HEADERS_METADATA, AdminSearchController.prototype.search),
  ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
});
```

Use the actual imports `../../../common/pipes/zod-validation.pipe.js`, `../../auth/current-user.decorator.js`, and `type RequestUser` from `../../auth/jwt-auth.guard.js` relative to the controller’s final location.

- [ ] **Step 2: Run the controller spec and verify RED**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search/admin/search.controller.spec.ts
```

Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement controller/module wiring**

```ts
@Controller('admin/search')
@UseGuards(JwtAuthGuard)
export class AdminSearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  search(
    @Query(new ZodValidationPipe(adminSearchQuerySchema)) query: AdminSearchQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.searchService.search(user.userId, query);
  }
}
```

`SearchModule` imports AuthModule, declares AdminSearchController and SearchService, and is imported once by AppModule. PrismaService is already global; do not duplicate PrismaModule or providers.

- [ ] **Step 4: Run controller/search tests and backend build**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/search
pnpm --dir small-house-commerce/backend build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add small-house-commerce/backend/src/modules/search \
  small-house-commerce/backend/src/app.module.ts
git commit -m "feat(admin): expose global search endpoint"
```

---

### Task 4: Frontend wire types and pure result model

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts:19-67,900-end`
- Create: `small-house-commerce/frontend/src/lib/admin-search.ts`
- Create: `small-house-commerce/frontend/src/lib/admin-search.spec.ts`

**Interfaces:**
- Produces frontend mirrors of `AdminSearchResponse` and each hit.
- Produces `adminApi.searchAdmin({ q, limit, signal })`; Task 8 separately adds `adminApi.getCustomer(id)`.
- Produces `flattenAdminSearchResults(response)`, `adminSearchHitHref(hit)`, and stable `adminSearchOptionId(hit)`.

- [ ] **Step 1: Write failing pure-model tests**

```ts
it('flattens groups in Products, Orders, Customers, Shipments order', () => {
  const flat = flattenAdminSearchResults(responseWithAllGroups());
  expect(flat.map(({ hit }) => hit.kind)).toEqual([
    'PRODUCT', 'ORDER', 'CUSTOMER', 'SHIPMENT',
  ]);
});

it('builds encoded stable context links', () => {
  expect(adminSearchHitHref(productSkuHit('CAR WH/L'))).toBe(
    '/admin/products/p1/edit?section=variants&sku=CAR%20WH%2FL',
  );
  expect(adminSearchHitHref(orderHit())).toBe('/admin/orders/o1');
  expect(adminSearchHitHref(customerHit())).toBe('/admin/customers/c1');
  expect(adminSearchHitHref(shipmentHit())).toBe('/admin/orders/o1#shipments');
});

it('uses entity id plus matched SKU id for stable option ids', () => {
  expect(adminSearchOptionId(productSkuHit('SKU-1'))).toBe('search-product-p1-sku-s1');
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-search.spec.ts
```

Expected: FAIL because module/functions do not exist.

- [ ] **Step 3: Add exact API types, authenticated method, and pure helpers**

```ts
searchAdmin: ({ q, limit = 5, signal }: { q: string; limit?: number; signal?: AbortSignal }) =>
  adminAuthedFetch<AdminSearchResponse>(
    `/api/v1/admin/search${buildQuery({ q, limit })}`,
    { signal },
  ),
```

Keep group order in one exported constant:

```ts
export const ADMIN_SEARCH_GROUPS = ['products', 'orders', 'customers', 'shipments'] as const;
```

Do not put display copy in pure helpers; only IDs, ordering, and href construction belong here.

- [ ] **Step 4: Run model tests and TypeScript**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-search.spec.ts
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add small-house-commerce/frontend/src/lib/admin-api.ts \
  small-house-commerce/frontend/src/lib/admin-search.ts \
  small-house-commerce/frontend/src/lib/admin-search.spec.ts
git commit -m "feat(admin): add global search client contract"
```

---

### Task 5: Debounced, cancellable search hook

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/useAdminSearch.ts`
- Create: `small-house-commerce/frontend/src/components/admin/useAdminSearch.spec.tsx`

**Interfaces:**
- Consumes `adminApi.searchAdmin`.
- Produces:

```ts
export type AdminSearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';
export type AdminSearchErrorCode = 'QUERY_TOO_LONG' | 'REQUEST_FAILED';
export function useAdminSearch(
  query: string,
  options: { enabled: boolean; limit: number; debounceMs?: number },
): {
  status: AdminSearchStatus;
  response: AdminSearchResponse | null;
  error: AdminSearchErrorCode | null;
  retry(): void;
};
```

- [ ] **Step 1: Write failing hook timing/race tests**

Use `renderHook`, `act`, deferred promises, and fake timers:

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderSearchHook(initialQ: string) {
  return renderHook(({ q }) => useAdminSearch(q, { enabled: true, limit: 5 }), {
    initialProps: { q: initialQ },
  });
}

async function startRequest(
  q: string,
  rerender: (props: { q: string }) => void,
): Promise<void> {
  rerender({ q });
  await vi.advanceTimersByTimeAsync(250);
}

it('does not request below two characters and debounces exactly 250ms', async () => {
  const { rerender } = renderSearchHook('a');
  await vi.advanceTimersByTimeAsync(500);
  expect(searchAdmin).not.toHaveBeenCalled();

  rerender({ q: 'ab' });
  await vi.advanceTimersByTimeAsync(249);
  expect(searchAdmin).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(searchAdmin).toHaveBeenCalledTimes(1);
});

it('aborts the old request and ignores its late success', async () => {
  const first = deferred<AdminSearchResponse>();
  const second = deferred<AdminSearchResponse>();
  searchAdmin.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result, rerender } = renderSearchHook('old');
  await vi.advanceTimersByTimeAsync(250);
  await startRequest('new', rerender);

  expect(searchAdmin.mock.calls[0]![0].signal.aborted).toBe(true);
  second.resolve(response('new'));
  await act(async () => second.promise);
  first.resolve(response('old'));
  await act(async () => first.promise);
  expect(result.current.response?.query).toBe('new');
});
```

Add the reverse race and local validation cases explicitly:

```ts
it('keeps the newer success when an older request rejects late', async () => {
  const first = deferred<AdminSearchResponse>();
  const second = deferred<AdminSearchResponse>();
  searchAdmin.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result, rerender } = renderSearchHook('old');
  await vi.advanceTimersByTimeAsync(250);
  await startRequest('new', rerender);
  second.resolve(response('new'));
  await act(async () => second.promise);
  first.reject(new DOMException('Aborted', 'AbortError'));
  await act(async () => { await first.promise.catch(() => undefined); });
  expect(result.current).toMatchObject({ status: 'success', response: response('new'), error: null });
});

it('rejects more than 100 normalized characters locally without a request', async () => {
  const { result } = renderHook(() =>
    useAdminSearch('x'.repeat(101), { enabled: true, limit: 5 }),
  );
  expect(result.current).toMatchObject({ status: 'error', error: 'QUERY_TOO_LONG' });
  await vi.advanceTimersByTimeAsync(500);
  expect(searchAdmin).not.toHaveBeenCalled();
});
```

Also test disabled mode, empty groups, retry, an ordinary failure mapping to `REQUEST_FAILED`, and AbortError silence. The test helper replaces the comment-only harness in the snippets with a real `initialProps`/`rerender` implementation.

- [ ] **Step 2: Run hook spec and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/useAdminSearch.spec.tsx
```

Expected: FAIL because hook does not exist.

- [ ] **Step 3: Implement request identity, timeout, and AbortController cleanup**

```ts
const requestId = useRef(0);
const [retryKey, setRetryKey] = useState(0);

useEffect(() => {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const length = [...normalized].length;
  const id = ++requestId.current;

  if (!enabled || length < 2) {
    setState(IDLE_STATE);
    return;
  }
  if (length > 100) {
    setState({ status: 'error', response: null, error: 'QUERY_TOO_LONG' });
    return;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    setState({ status: 'loading', response: null, error: null });
    void adminApi.searchAdmin({ q: normalized, limit, signal: controller.signal })
      .then((response) => {
        if (id !== requestId.current || controller.signal.aborted) return;
        const empty = flattenAdminSearchResults(response).length === 0;
        setState({ status: empty ? 'empty' : 'success', response, error: null });
      })
      .catch((error: unknown) => {
        if (
          id !== requestId.current ||
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) return;
        setState({ status: 'error', response: null, error: 'REQUEST_FAILED' });
      });
  }, debounceMs ?? 250);

  return () => {
    window.clearTimeout(timer);
    controller.abort();
  };
}, [query, enabled, limit, debounceMs, retryKey]);
```

`retry()` increments `retryKey`. Do not cache resolved responses.

- [ ] **Step 4: Run hook tests and TypeScript**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/useAdminSearch.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add small-house-commerce/frontend/src/components/admin/useAdminSearch.ts \
  small-house-commerce/frontend/src/components/admin/useAdminSearch.spec.tsx
git commit -m "feat(admin): manage cancellable global search state"
```

---

### Task 6: Reusable results and Global Header command palette

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/AdminSearchResults.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.tsx:7-80`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx:97-259`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- `AdminSearchResults` consumes response, mode, active option id, and optional activation callback.
- `AdminGlobalSearch` consumes `permissions: readonly string[]`.
- AdminShell mounts exactly one instance and passes it through `searchControl`.

- [ ] **Step 1: Write failing renderer/dialog tests**

Cover the complete UI contract with explicit Testing Library assertions:

```ts
it('opens with Control+K, focuses the combobox, and restores opener focus on Escape', async () => {
  const user = userEvent.setup();
  renderSearch({ permissions: ALL_SEARCH_PERMISSIONS });
  const trigger = screen.getByRole('button', { name: '全局搜索' });
  trigger.focus();
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: '搜索商品、订单、客户和物流' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});

it('moves across real options only and Enter uses the highlighted stable href', async () => {
  searchAdmin.mockResolvedValue(responseWithAllGroups());
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderSearch({ permissions: ALL_SEARCH_PERMISSIONS });
  await openAndType(user, 'chair');
  await vi.advanceTimersByTimeAsync(250);
  await screen.findByText('Chair');
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(push).toHaveBeenCalledWith('/admin/orders/o1');
});

it('cannot activate an option removed by a newer response', async () => {
  searchAdmin
    .mockResolvedValueOnce(responseWithProduct('Old chair'))
    .mockResolvedValueOnce(responseWithOrder('PH-NEW'));
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderSearch({ permissions: ALL_SEARCH_PERMISSIONS });
  await openAndType(user, 'old');
  await vi.advanceTimersByTimeAsync(250);
  await user.keyboard('{ArrowDown}');
  await replaceQuery(user, 'new');
  await vi.advanceTimersByTimeAsync(250);
  await screen.findByText('PH-NEW');
  await user.keyboard('{Enter}');
  expect(push).not.toHaveBeenCalled();
});
```

The real test helper implements `replaceQuery` with `user.clear` plus `user.type`; no production DOM query or timer is permitted.

Also assert:

- Meta+K path;
- pointer click;
- loading/empty/error/retry, including localized `QUERY_TOO_LONG` without a network request;
- grouped headings in fixed order;
- max five per group from payload;
- omitted groups absent;
- two-character enabled behavior;
- unsupported-permission trigger does not call API or expose data;
- `aria-activedescendant` references the highlighted option;
- body scroll lock/focus trap and cleanup;
- mobile compact trigger and desktop label are one component instance;
- Phase A fallback still renders if no `searchControl` is passed;
- real slot removes the “Coming soon” boundary without altering Notifications.

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/AdminGlobalSearch.spec.tsx \
  src/components/admin/AdminGlobalHeader.spec.tsx
```

Expected: new spec fails because components do not exist; existing header spec remains green before modifications.

- [ ] **Step 3: Implement shared result renderer**

`AdminSearchResults` iterates `ADMIN_SEARCH_GROUPS`, skips absent/empty groups, and renders entity-specific real fields. In `dialog` mode it defensively renders `group.items.slice(0, 5)`; in `page` mode it renders every returned item (maximum 20 from the endpoint). Product SKU rows include variant, SKU, formatted price, and available stock. Never display a fake image, count, or notification badge. In dialog mode use grouped listbox/option semantics; page mode uses headings and links with the same href helper.

- [ ] **Step 4: Implement one responsive command palette**

Use `createPortal` after the same hydration-safe `useSyncExternalStore` pattern already present in AdminShell. Keep one mounted AdminGlobalSearch instance; its trigger renders icon-only below `lg` and full label/shortcut at `lg+`. Modify AdminGlobalHeader’s search wrapper from desktop-hidden to a compact mobile width plus the existing 420–520px desktop width.

Register one document keydown listener while mounted. Ignore bare `k`; accept only Meta/Ctrl+K, call `preventDefault`, and open/focus. Maintain a ref list of actual options for Arrow/Enter behavior, not DOM queries. Reset `activeOptionId` whenever the normalized query changes; on Enter, resolve that ID again against the current flattened response and do nothing if it is absent. Esc closes, aborts visible interaction, unlocks body scroll, and restores `openerRef`.

- [ ] **Step 5: Inject the real control and add complete zh/en copy**

```tsx
<AdminGlobalHeader
  moduleTitle={title}
  admin={admin}
  onLogout={onLogout}
  searchControl={<AdminGlobalSearch permissions={admin.permissions} />}
  mobileMenuTrigger={
    <button
      ref={hamburgerRef}
      type="button"
      onClick={() => setDrawerOpen(true)}
      aria-label="Open admin menu"
      aria-expanded={drawerOpen}
      aria-controls={`${drawerId}-drawer`}
      className="flex items-center rounded-lg p-2 text-ink hover:text-cta md:hidden"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
        <path
          d="M4 7h16M4 12h16M4 17h16"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  }
/>
```

Add keys for trigger, input, group headings, loading, empty, error, retry, view-all, matched-field labels, status labels, and no-search-permission. Storefront copy is untouched.

- [ ] **Step 6: Run focused tests, TypeScript, and lint**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/AdminGlobalSearch.spec.tsx \
  src/components/admin/AdminGlobalHeader.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
```

Expected: tests/typecheck pass; lint has no new warning or error (the existing `admin-i18n.tsx` unused warning may remain unchanged).

- [ ] **Step 7: Commit Task 6**

```bash
git add small-house-commerce/frontend/src/components/admin/AdminSearchResults.tsx \
  small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.tsx \
  small-house-commerce/frontend/src/components/admin/AdminGlobalSearch.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.tsx \
  small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminShell.tsx \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): add global search command palette"
```

---

### Task 7: Full search results page

**Files:**
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/search/page.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/search/page.spec.tsx`

**Interfaces:**
- Consumes `useAdminSearch(query, { enabled, limit: 20 })` and `AdminSearchResults mode="page"`.
- Existing command palette navigates to `/admin/search?q=...`.

- [ ] **Step 1: Write failing page tests**

```ts
it('loads q from the URL, requests twenty rows per group, and renders shared results', async () => {
  navState.searchParams = 'q=rolling%20cart';
  searchAdmin.mockResolvedValue(responseWithAllGroups());
  renderPage();
  await vi.advanceTimersByTimeAsync(250);
  expect(searchAdmin).toHaveBeenCalledWith(expect.objectContaining({ q: 'rolling cart', limit: 20 }));
  expect(await screen.findByRole('heading', { name: 'Products' })).toBeVisible();
});

it('does not request or fake results without a valid q', async () => {
  navState.searchParams = '';
  renderPage();
  expect(screen.getByText('Enter at least 2 characters')).toBeVisible();
  expect(searchAdmin).not.toHaveBeenCalled();
});
```

Also test edit-and-submit URL replacement, loading/empty/error/retry, omitted groups, and all result links.

- [ ] **Step 2: Run page spec and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/search/page.spec.tsx'
```

Expected: FAIL because page does not exist.

- [ ] **Step 3: Implement the full page with shared components**

Use PageHeader, one query input, and URL-backed `q`. Form submit uses `router.replace('/admin/search?q=...')`; do not request on every uncontrolled keystroke until URL/query state is updated according to the same 250ms hook. Render no duplicated result markup.

- [ ] **Step 4: Run page test and TypeScript**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/search/page.spec.tsx'
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add 'small-house-commerce/frontend/src/app/admin/(shell)/search/page.tsx' \
  'small-house-commerce/frontend/src/app/admin/(shell)/search/page.spec.tsx'
git commit -m "feat(admin): add full global search results"
```

---

### Task 8: Real Customer result destination

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.spec.tsx`

**Interfaces:**
- Produces `AdminCustomerDetail`, `AdminCustomerAddress`, and `adminApi.getCustomer(id)`.
- Search href from Task 4 already targets this page.

- [ ] **Step 1: Write failing read-only Customer page tests**

```ts
it('renders only real customer identity, risk and addresses', async () => {
  getCustomer.mockResolvedValue(customerFixture());
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Jane Cruz' })).toBeVisible();
  expect(screen.getByText('+639171234567')).toBeVisible();
  expect(screen.getByText('jane@example.com')).toBeVisible();
  expect(screen.getByText('1 Main St')).toBeVisible();
  expect(screen.queryByRole('button', { name: /save|保存/i })).not.toBeInTheDocument();
});

it.each([403, 404, 500])('shows the correct non-editable error state for %s', async (status) => {
  getCustomer.mockRejectedValue(new AdminApiError('failed', status));
  renderPage();
  expect(await screen.findByRole('status')).toBeVisible();
});
```

Also verify `CUSTOMER_MANAGE` absence prevents the request and shows an honest unavailable state.

- [ ] **Step 2: Run page spec and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/customers/[id]/page.spec.tsx'
```

Expected: FAIL because types/API/page do not exist.

- [ ] **Step 3: Add wire types/API and implement read-only page**

Mirror real backend fields only:

```ts
export interface AdminCustomerAddress {
  id: string;
  customerId: string;
  fullName: string;
  phone: string;
  province: string;
  city: string;
  barangay: string | null;
  postalCode: string | null;
  streetAddress: string;
  landmark: string | null;
  createdAt: string;
}

export interface AdminCustomerDetail {
  id: string;
  name: string | null;
  normalizedPhone: string;
  email: string | null;
  currentRiskLevel: string;
  createdAt: string;
  updatedAt: string;
  addresses: AdminCustomerAddress[];
}
```

Use `adminApi.getCustomer(id)` with the existing endpoint:

```ts
getCustomer: (id: string): Promise<AdminCustomerDetail> =>
  adminAuthedFetch<AdminCustomerDetail>(
    `/api/v1/admin/customers/${encodeURIComponent(id)}`,
  ),
```

Build the page with PageHeader, Skeleton, EmptyState/error status, and address cards. Add typed zh/en keys for title fallback, identity, phone, email, risk, address, created date, permission-denied, not-found, generic error, and empty-address states in this task. Do not add edit/create/delete controls or a Customers nav item.

- [ ] **Step 4: Run tests and TypeScript**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/customers/[id]/page.spec.tsx'
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add small-house-commerce/frontend/src/lib/admin-api.ts \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts \
  'small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.tsx' \
  'small-house-commerce/frontend/src/app/admin/(shell)/customers/[id]/page.spec.tsx'
git commit -m "feat(admin): add customer search destination"
```

---

### Task 9: Stable Product SKU context links

**Files:**
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx:1-5,283-285,819-835`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx:785-847,2119-2249`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx:97-127,250-318`
- Modify: `small-house-commerce/frontend/src/components/admin/VariantMatrix.spec.tsx`

**Interfaces:**
- Edit page parses only `section=variants`; unknown sections become null.
- ProductForm adds `requestedSection?: ProductFormTabKey | null` and `requestedSkuCode?: string | null`.
- VariantMatrix adds `requestedSkuCode?: string | null`.

- [ ] **Step 1: Write failing edit-page forwarding tests**

Mock `useSearchParams` and assert:

```ts
navState.searchParams = 'section=variants&sku=E2E-CS-BLUE-M';
renderEditPage();
await waitForForm();
expect(productFormProps()).toMatchObject({
  requestedSection: 'variants',
  requestedSkuCode: 'E2E-CS-BLUE-M',
});
```

The same test rerenders after changing `navState.searchParams` to another persisted SKU and verifies the forwarded request changes without remounting:

```ts
navState.searchParams = 'section=variants&sku=E2E-CS-BLUE-L';
rerenderEditPage();
expect(productFormProps()).toMatchObject({
  requestedSection: 'variants',
  requestedSkuCode: 'E2E-CS-BLUE-L',
});
```

Unknown `section=media` from Global Search context is not accepted by this path, and missing/blank SKU becomes null.

- [ ] **Step 2: Write failing typed and legacy focus tests**

Typed non-first page:

```ts
render(<VariantMatrix candidates={thirtyOneCandidates} draft={draftWithTargetAtIndex(30)} requestedSkuCode="SKU-31" />);
expect(screen.getByLabelText('Variant 31 的 SKU 编码')).toHaveFocus();
expect(screen.getByText('第 2 / 2 页')).toBeVisible();
```

Legacy graph-v0:

```ts
renderProductForm({ initial: legacyProductWithSkus(['LEGACY-1', 'LEGACY-2']), requestedSection: 'variants', requestedSkuCode: 'LEGACY-2' });
expect(screen.getByLabelText('SKU 编码', { selector: '#pf-variants-1-sku-code' })).toHaveFocus();
```

Spy on `HTMLElement.prototype.scrollIntoView`; assert it is called with `{ block: 'center' }`. Rerender each typed and legacy harness with a different `requestedSkuCode` and assert focus moves to the second requested SKU, proving same-page query changes are handled. Use fake timers only to prove no timer is scheduled; production code must use refs/useLayoutEffect.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  'src/app/admin/(shell)/products/[id]/edit/page.spec.tsx' \
  src/components/admin/ProductForm.spec.tsx \
  src/components/admin/VariantMatrix.spec.tsx
```

Expected: FAIL because props/navigation do not exist.

- [ ] **Step 4: Implement URL forwarding and ProductForm tab synchronization**

EditProductPage imports `useSearchParams`, reads canonical values, and passes them to ProductForm. ProductForm uses a render-phase identity comparison, matching its existing `initial` synchronization pattern, to select the requested tab without a set-state effect loop.

For legacy rows, register the SKU TextInput nodes in `useRef(new Map<string, HTMLInputElement>())`; a `useLayoutEffect` focuses the exact canonical SKU ref when the variants panel is mounted.

- [ ] **Step 5: Implement typed matrix page/focus refs**

Find the target candidate from persisted `draft.variants[].sku.skuCode`, derive its page, synchronize page before render, attach a callback ref directly to the SKU input, then focus/scroll it in `useLayoutEffect`. Do not use `document`, selectors, row index identity, or timers. Unknown SKU leaves the current page and focus unchanged.

- [ ] **Step 6: Run focused tests, TypeScript, and lint**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  'src/app/admin/(shell)/products/[id]/edit/page.spec.tsx' \
  src/components/admin/ProductForm.spec.tsx \
  src/components/admin/VariantMatrix.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
```

Expected: PASS; no new warning/error.

- [ ] **Step 7: Commit Task 9**

```bash
git add 'small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx' \
  'small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.spec.tsx' \
  small-house-commerce/frontend/src/components/admin/ProductForm.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx \
  small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx \
  small-house-commerce/frontend/src/components/admin/VariantMatrix.spec.tsx
git commit -m "feat(admin): add stable search result deep links"
```

---

### Task 10: Real-stack Global Search E2E and RBAC fixtures

**Files:**
- Modify: `small-house-commerce/backend/prisma/seed-e2e.ts`
- Modify: `small-house-commerce/backend/prisma/seed-e2e.spec.ts`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/orders/[id]/page.tsx:1125-1194`
- Create: `small-house-commerce/frontend/e2e/admin-global-search.spec.ts`

**Interfaces:**
- Uses existing guarded `small_house_variant_test`, backend `3210`, frontend `3211`, and existing admin login/API helpers.
- Adds test-only Warehouse and Optimizer users using existing roles and the same documented E2E password; no production seed is changed.

- [ ] **Step 1: Add failing E2E scenarios before changing fixtures**

Create serial tests that:

1. Assert loopback origins and `small_house_variant_test` before any mutation.
2. Login as SUPER_ADMIN.
3. Use deterministic search fixtures to verify exact → prefix → contains order for every declared Product, Order, Customer, and Shipment field priority. Include one Product matching its own code/name plus two SKU codes and assert it appears once with the highest-ranked match.
4. Include Draft/Disabled Products, a disabled unpriced SKU, and inventory in two Warehouses; assert navigation still returns them and `availableInventory` equals the real sum of `onHand - reserved`.
5. Create storefront orders with unique customer phone/email values, confirm them, and create Shipments through real APIs. Give two different Shipments the same real tracking number and assert both remain separate results.
6. Open command search with keyboard; verify all four groups and keyboard Enter navigation.
7. Click exact SKU and assert URL includes `section=variants&sku=...`, variants tab is selected, and the canonical SKU input has focus.
8. Search Customer and open the real read-only page.
9. Search Shipment and assert URL hash `#shipments` plus visible tracking row.
10. Open “View all results” and verify `/admin/search?q=...` uses real results.
11. Login as Warehouse and assert Order/Shipment groups appear while Product/Customer never appear and direct API payload omits them.
12. Login as Optimizer and assert direct API returns `{ groups: {} }`; no entity result is rendered.
13. Create one Product whose name contains the literal text `%_\\`, search exactly `%_\\`, and assert only that intended match returns rather than the whole catalog.
14. Create at least 21 lower-ranked contains candidates plus one exact Product/SKU through the real test setup and assert the exact hit remains first, proving ranking happens in PostgreSQL before LIMIT.
15. Track console/error/pageerror/hydration failures for every page.
16. With the same authenticated real-stack flow, call `page.setViewportSize` for 1440×1000 and 1920×1080 and write the palette/full-results/SKU screenshots named in Task 11 to the existing gitignored `frontend/screenshots/` directory.

Before the browser spec, extend `seed-e2e.spec.ts` with the exact fixture contract:

```ts
it('declares one deterministic account for each search RBAC scenario', () => {
  expect(E2E_ROLE_ACCOUNTS).toEqual([
    { name: 'E2E Admin', email: 'e2e-admin@smallhouse.test', roleCode: 'SUPER_ADMIN' },
    { name: 'E2E Warehouse', email: 'e2e-warehouse@smallhouse.test', roleCode: 'WAREHOUSE' },
    { name: 'E2E Optimizer', email: 'e2e-optimizer@smallhouse.test', roleCode: 'OPTIMIZER' },
  ]);
});
```

Use a per-run UUID suffix for every mutable fixture. Register temporary Product IDs and delete them through the existing admin delete API in `test.afterAll` in reverse dependency order. Orders, Customers, and Shipments have no destructive admin endpoint, so they remain only in the disposable `_test` database; recreate `small_house_variant_test` before the final full-suite gate rather than adding a production-only delete path. Never connect to or clean production data.

- [ ] **Step 2: Run only the new E2E and verify RED**

Before running, stop only this worktree’s existing 3210/3211 review tasks so Playwright’s `reuseExistingServer: false` can own those ports. Do not stop user services on 3000/3001.

```bash
pnpm --dir small-house-commerce/backend exec vitest run prisma/seed-e2e.spec.ts
E2E_TEST_DB=small_house_variant_test \
  pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/admin-global-search.spec.ts --project=chromium
```

Expected: seed spec FAILS because `E2E_ROLE_ACCOUNTS` does not exist; browser spec FAILS at its first missing fixture/behavior assertion.

- [ ] **Step 3: Extend only the guarded E2E seed**

Replace the one-account early-return helper with one deterministic isolated-database upsert loop:

```ts
export const E2E_ADMIN_PASSWORD = 'E2eAdminPass123!';
export const E2E_ROLE_ACCOUNTS = [
  { name: 'E2E Admin', email: 'e2e-admin@smallhouse.test', roleCode: 'SUPER_ADMIN' },
  { name: 'E2E Warehouse', email: 'e2e-warehouse@smallhouse.test', roleCode: 'WAREHOUSE' },
  { name: 'E2E Optimizer', email: 'e2e-optimizer@smallhouse.test', roleCode: 'OPTIMIZER' },
] as const;

async function ensureE2eAdmins(ctx: SeedContext): Promise<void> {
  const passwordHash = await argon2.hash(E2E_ADMIN_PASSWORD);
  for (const account of E2E_ROLE_ACCOUNTS) {
    const role = await ctx.prisma.role.findUnique({
      where: { code: account.roleCode },
      select: { id: true },
    });
    if (!role) throw new Error(`The ${account.roleCode} role is missing — run prisma db seed first.`);
    await ctx.prisma.user.upsert({
      where: { email: account.email },
      create: {
        name: account.name,
        email: account.email,
        passwordHash,
        status: 'ACTIVE',
        roles: { create: [{ roleId: role.id }] },
      },
      update: {
        name: account.name,
        passwordHash,
        status: 'ACTIVE',
        roles: { deleteMany: {}, create: [{ roleId: role.id }] },
      },
    });
  }
}
```

Keep the existing `_test` database refusal ahead of this helper. These credentials stay in the E2E seed/spec only; do not add them to production seed or runtime code.

- [ ] **Step 4: Add the Shipment anchor that the failing browser assertion requires**

Wrap the existing Shipment `Card` without changing its table body: the wrapper is a `<div>` with `id="shipments"` and `className="scroll-mt-24"`, and the existing card remains its sole child. Render the anchor only with the real section; do not create a fake empty Shipment result target.

- [ ] **Step 5: Run the new E2E and verify GREEN**

Run the Step 2 commands. Expected: seed unit spec and all new browser scenarios PASS with zero browser errors.

- [ ] **Step 6: Run the existing Product Editor/variant E2E subset**

```bash
E2E_TEST_DB=small_house_variant_test \
  pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/variant-options-media.spec.ts \
  e2e/admin-product-editor.spec.ts \
  e2e/admin-global-search.spec.ts \
  --project=chromium
```

Expected: all pass; Product editor deep-link additions do not change save/media behavior.

- [ ] **Step 7: Commit Task 10**

```bash
git add small-house-commerce/backend/prisma/seed-e2e.ts \
  small-house-commerce/backend/prisma/seed-e2e.spec.ts \
  'small-house-commerce/frontend/src/app/admin/(shell)/orders/[id]/page.tsx' \
  small-house-commerce/frontend/e2e/admin-global-search.spec.ts
git commit -m "test(admin): cover global search end to end"
```

---

### Task 11: Full verification, performance evidence, and screenshot gate

**Files:**
- No required tracked source file.
- Real screenshots saved under existing gitignored `small-house-commerce/frontend/screenshots/`.
- If verification exposes a defect, first add a failing regression test to the owning task’s test file, then fix and commit that one defect.

**Interfaces:**
- Consumes the completed Phase B implementation.
- Produces release evidence only; no push/deploy/PDP continuation.

- [ ] **Step 1: Run all backend checks**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/backend build
```

Expected: all tests/build pass; oxlint reports no error.

- [ ] **Step 2: Run all frontend checks**

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/frontend build
```

Expected: all tests/type/build pass; no new lint warning/error. Record the pre-existing `admin-i18n.tsx` warning separately if it still exists unchanged.

- [ ] **Step 3: Run the complete Playwright suite**

Recreate only `small_house_variant_test` first if historical E2E orders prevent deterministic reseeding; never touch production or a non-test database.

```bash
E2E_TEST_DB=small_house_variant_test \
  pnpm --dir small-house-commerce/frontend exec playwright test --project=chromium
```

Expected: every existing and new test passes.

- [ ] **Step 4: Capture real 1440 and 1920 screenshots**

Inspect the real screenshots produced by `admin-global-search.spec.ts` during Step 3 (rerun that focused spec if any file is missing or stale):

- `phase-b-global-search-1440.png` — open palette with all four real groups.
- `phase-b-global-search-1920.png` — same state, verifying 420–520px search control and dialog placement.
- `phase-b-global-search-results-1440.png` — full results page at 1440px.
- `phase-b-global-search-results-1920.png` — full results page at 1920px.
- `phase-b-global-search-sku-deeplink-1920.png` — Product Editor variants tab with focused SKU row.

Use actual authenticated pages, not static mocks. Verify no page horizontal overflow and inspect console/network for errors or unauthorized calls.

- [ ] **Step 5: Collect query-plan evidence without changing DB**

Run parameterized `EXPLAIN (ANALYZE, BUFFERS)` for representative Product name, exact SKU, Order number, Customer phone, and Shipment tracking queries against the disposable test database. Record plan shape, buffer use, row counts, and measured timings in the completion report, not a migration. If the available fixture volume is not production-like, say explicitly that this proves query correctness/shape but does **not** establish p95; the approved production-like 150–200ms release gate remains open. If production-like evidence later misses that threshold, stop and report the separate additive-index gate; do not create an index in this phase.

- [ ] **Step 6: Verify repository boundaries**

```bash
git diff --check
git status --short
git log --oneline -12
```

Expected: no tracked change remains uncommitted; the only unrelated path may be the pre-existing `?? small-house-commerce/backend/uploads/`.

- [ ] **Step 7: Stop at the Phase B gate**

Report:

- commits;
- test/build/E2E counts and exact failures if any;
- screenshot paths and viewport sizes;
- RBAC matrix exercised;
- query-plan observations;
- migration verdict;
- unchanged uploads status;
- no push/deploy.

Do not begin Notifications, Product Media, or any PDP implementation without a new explicit confirmation.
