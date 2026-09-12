# Post-Launch Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the post-launch security findings from the final whole-branch review (M5, M6 and Recommendations 2, 3, 5 of `.superpowers/sdd/2026-09-11-search-customer-auth/final-review.md`): refresh-token families with atomic rotation and reuse-revocation, hand-rolled rate limiting on auth endpoints, an argon2 login-timing equalizer, ILIKE wildcard escaping, and the deferred auth/search test coverage.

**Architecture:** Five backend-only changes. (1) A nullable `familyId` UUID column on both `RefreshToken` and `CustomerRefreshToken`, backfilled so every existing row is its own singleton family, with composite indexes for the family delete. (2) Both auth services perform refresh inside ONE Prisma interactive `$transaction`: a presented valid token is revoked and re-minted in the same family; presenting an already-rotated token deletes the entire family. Because throwing inside a Prisma transaction rolls it back, the callback returns a status object and the 401 is thrown *after* commit. (3) A dependency-free, clock-injectable sliding-window-log limiter plus a Nest `ThrottleGuard` driven by `@SetMetadata`; two bucket dimensions (client IP, normalized email from the body) and one Express `trust proxy` hop so `request.ip` is the real client in production. (4) Both logins run a dummy argon2 verify against a lazily-cached module-level hash when the account is unknown, returning the identical 401. (5) `%`/`_`/`\` in search tokens are escaped with an explicit `ESCAPE '\'`, plus the deferred unit tests and two source-text/SQL guards.

**Tech Stack:** NestJS 12 on `@nestjs/platform-express` (Express adapter), Prisma 7 (multi-file schema in `prisma/schema`, generated client in `src/generated/prisma`, driver adapter `@prisma/adapter-pg`), PostgreSQL 18 in Docker (`small-house-postgres`, db `small_house`), argon2, zod, vitest (unit `*.spec.ts`, `globals: true`), oxlint. No new npm packages.

**Spec reference:** `.superpowers/sdd/2026-09-11-search-customer-auth/final-review.md` — M5 (ILIKE escaping), M6 (timing oracle), Recommendation 2 (rate limiting), Recommendation 3 (test gaps), Recommendation 5 (non-atomic refresh window). Structural template: `docs/superpowers/plans/2026-09-11-search-customer-auth.md`.

## Global Constraints

- **No new npm dependencies** (no `@nestjs/throttler`) — every rate-limit primitive is hand-rolled.
- **Migrations must be additive, non-destructive and idempotent.** Never suggest `migrate reset`, `db push --force-reset`, deletes of migrations, or dropped columns. If a step would require a reset, STOP and mark the task BLOCKED in the working notes.
- **Storefront responses must never expose** `supplierSku / supplierCost / costCurrency / landedCost / isVisible / source / verifiedOrderItemId`.
- **No PII, token or password logging.** Do not add `Logger` calls that print emails, tokens, hashes or request bodies.
- **Commands:** pnpm commands run from `small-house-commerce/backend/`; lint is `pnpm run lint` (oxlint), build is `pnpm run build` (`nest build`), unit tests `pnpm exec vitest run`. Full gate: `pnpm run lint && pnpm run build && pnpm exec vitest run`.
- **Prisma:** run the PLAIN `pnpm exec prisma ...` commands from `backend/` exactly as written. NEVER pass `--schema` (in this repo it emits an empty client; the schema directory is configured in `prisma7.config.ts`).
- **ESM:** relative imports carry `.js` extensions (NodeNext), e.g. `import { PrismaService } from '../../prisma/prisma.service.js';`.
- **Commits:** every task ends with explicit paths only — `git add backend/src/... backend/prisma/...` — never `git add -A`, `git add .`, or `-am`. Commit prefixes: `fix(security): ...` or `test(...): ...`. Run git from `small-house-commerce/`.
- **Protected files — never stage:** `small-house-commerce/docs/frontend/HOMEPAGE_SPEC.md`, `small-house-commerce/docs/superpowers/plans/2026-09-11-pdp-refinement.md`, anything under `small-house-commerce/docs/research/`.
- The Nest app is **express-based** (`@nestjs/platform-express` is the installed adapter; `main.ts` uses `NestFactory.create`). `request.ip` / `request.body` are Express values.
- No frontend changes in this wave; the 429 envelope is Nest's standard shape, which the existing frontend `request()` helper already surfaces as an error message.

---

## File structure

**Backend**

- Modify `prisma/schema/identity.prisma` — `RefreshToken.familyId` + composite index.
- Modify `prisma/schema/customer.prisma` — `CustomerRefreshToken.familyId` + composite index.
- Create `prisma/migrations/<created>_add_refresh_token_families/migration.sql` (via `--create-only`, then hand-finalized).
- Create `src/common/rate-limit.window.ts` + `rate-limit.window.spec.ts` — pure sliding-window limiter, IPv6 /64 helper.
- Create `src/common/throttle.guard.ts` + `throttle.guard.spec.ts` — metadata-driven Nest guard.
- Modify `src/modules/auth/auth.service.ts`, create `src/modules/auth/auth.service.spec.ts`.
- Modify `src/modules/customers/storefront-customer-auth.service.ts` and its existing `.spec.ts`.
- Modify `src/modules/auth/auth.controller.ts`, `src/modules/customers/storefront/customers.controller.ts`.
- Modify `src/main.ts` — `NestExpressApplication` + `trust proxy`.
- Modify `src/modules/catalog/product-search.ts` and `product-search.spec.ts`.

**Schema decision (familyId):** the column is added **nullable** in both Prisma schema and SQL, every existing row is backfilled to `family_id = id`, and service code treats a null as a singleton family (`stored.familyId ?? randomUUID()` when minting; id-only delete on reuse). Rationale: a NOT-NULL column added to populated tables relies on Prisma's generated default/backfill dance and is needlessly risky; the nullable add is purely additive, idempotent, and the backfill makes null impossible for all rows written so far. Null can only ever appear from an out-of-band SQL write, which the coalesce handles safely. There is no `rotatedAt` column in either model — rotation is recorded by the existing `revokedAt` (`identity.prisma:134`, `customer.prisma:83`).

---

## Task 1: Refresh-token family columns, indexes, additive migration

**Files:**
- Modify: `backend/prisma/schema/identity.prisma`
- Modify: `backend/prisma/schema/customer.prisma`
- Create: `backend/prisma/migrations/<created>_add_refresh_token_families/migration.sql`

- [ ] **Step 1: Add `familyId` to the admin `RefreshToken` model**

In `backend/prisma/schema/identity.prisma`, in model `RefreshToken`, add the field directly below `tokenHash`:

```prisma
  tokenHash String    @unique @map("token_hash")
  /// Family id shared by every rotation of one login. Null only for rows
  /// written out-of-band; the migration backfills existing rows to their own
  /// singleton family, and the app always sets it (coalesce on read).
  familyId  String?   @map("family_id") @db.Uuid
```

and add the composite index alongside the existing `@@index` lines:

```prisma
  @@index([userId])
  @@index([userId, familyId])
  @@index([expiresAt])
  @@map("refresh_tokens")
```

- [ ] **Step 2: Add `familyId` to `CustomerRefreshToken`**

In `backend/prisma/schema/customer.prisma`, in model `CustomerRefreshToken`, add below `tokenHash`:

```prisma
  tokenHash String    @unique @map("token_hash")
  /// Rotation family; see RefreshToken.familyId in identity.prisma.
  familyId  String?   @map("family_id") @db.Uuid
```

and the composite index:

```prisma
  @@index([accountId])
  @@index([accountId, familyId])
  @@index([expiresAt])
  @@map("customer_refresh_tokens")
```

- [ ] **Step 3: Create the migration without applying it**

Run in `backend/`:

```bash
pnpm exec prisma migrate dev --create-only --name add_refresh_token_families
```

Expected: a new directory `prisma/migrations/<timestamp>_add_refresh_token_families/` containing a generated `migration.sql` with two `ALTER TABLE ... ADD COLUMN "family_id" UUID` statements and two `CREATE INDEX` statements. Do NOT apply yet.

- [ ] **Step 4: Replace the generated SQL with the idempotent final version**

Open the new `migration.sql` and make its entire contents exactly:

```sql
-- Refresh-token rotation families (final-review Rec 5). Additive: the column
-- stays nullable; existing rows are backfilled into singleton families and
-- every new row always carries a family id from the application.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" UUID;
ALTER TABLE "customer_refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" UUID;

-- Backfill: each pre-existing token starts its own family. Idempotent.
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
UPDATE "customer_refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;

-- CreateIndex: family revocation deletes by (account, family).
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_family_id_idx"
  ON "refresh_tokens"("user_id", "family_id");
CREATE INDEX IF NOT EXISTS "customer_refresh_tokens_account_id_family_id_idx"
  ON "customer_refresh_tokens"("account_id", "family_id");
```

(If the generated file used different index names, keep the names Prisma printed and use those same names here; the predicted names follow the repo's existing `<table>_<cols>_idx` convention seen in `20260911154437_add_customer_accounts/migration.sql`.)

- [ ] **Step 5: Apply the migration and regenerate the client (plain command, no --schema)**

Run in `backend/`:

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

Expected: migration applied, no drift reported, client regenerated into `src/generated/prisma`. Note: `backend/src/generated/prisma/` is git-ignored (`.gitignore:8`) — regeneration is required locally for the build but is never committed; do NOT use `git add -f` on it.

- [ ] **Step 6: Verify the backfill and indexes against the live database**

Run:

```bash
docker exec small-house-postgres psql -U postgres -d small_house -tc \
  "SELECT count(*) FROM refresh_tokens WHERE family_id IS NULL
   UNION ALL SELECT count(*) FROM customer_refresh_tokens WHERE family_id IS NULL;"
docker exec small-house-postgres psql -U postgres -d small_house -tc \
  "SELECT indexname FROM pg_indexes WHERE indexname IN
   ('refresh_tokens_user_id_family_id_idx','customer_refresh_tokens_account_id_family_id_idx');"
```

Expected: two `0` rows, then both index names listed.

- [ ] **Step 7: Backend gate**

Run in `backend/`:

```bash
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green (the new schema field is unused so far).

- [ ] **Step 8: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/prisma/schema/identity.prisma backend/prisma/schema/customer.prisma backend/prisma/migrations
git commit -m "fix(security): refresh-token family ids with additive backfill migration"
```

---

## Task 2: Atomic refresh rotation with family revocation

**Why the 401 is thrown after the transaction:** Prisma interactive transactions roll back every statement when the callback throws. Family revocation must *persist*, so the callback returns a discriminated outcome (`{status:'invalid'}` / `{status:'ok', tokens}`) and the service throws `UnauthorizedException` after the callback resolves and commits.

> **CONTROLLER RULING (2026-09-12, post Task-2 review) — supersedes the rotate snippets in Tasks 2a/2b below.** Postgres runs Prisma interactive transactions at READ COMMITTED; `findUnique` + an unconditional `update({ where:{id} })` lets two concurrent refreshes of the same valid token BOTH succeed (two valid new pairs, reuse detector never fires). The rotation MUST atomically claim the row:
> `const claimed = await tx.<table>.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: now } });`
> — `claimed.count === 1` is the single winner (proceed to issue siblings); `count !== 1` means the row was claimed first by a concurrent request OR was already revoked: take the SAME family-reuse path (revoke/delete the whole family, outcome `{status:'invalid'}` thrown after commit). The unconditional `update` snippets printed in Steps below are to be read with this replacement. Additionally: admin refresh must `select` only `{ id, email, status }` (never load `passwordHash`), and the tests must include (a) a `$transaction` fake that models rollback-on-throw so outcome-after-commit is structurally enforced, (b) legacy NULL `familyId` rows for both the coalesce and singleton-revoke branches, and (c) an interleaved-concurrency test that fails on the old read-then-update pattern and proves exactly one winner plus family wipe.

### Task 2a: Admin `AuthService`

**Files:**
- Create: `backend/src/modules/auth/auth.service.spec.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/auth/auth.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const config = {
  getOrThrow: (key: string) => (key === 'jwt.accessTtl' ? '1h' : '7d'),
} as never;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface TokenRow {
  id: string;
  userId: string;
  familyId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** In-memory refreshToken delegate so rotation/replay mutate real rows. */
function makeRefreshTokenDb(initial: TokenRow[]) {
  const rows: TokenRow[] = [...initial];
  return {
    rows,
    refreshToken: {
      findUnique: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
          rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
        ),
      update: vi
        .fn()
        .mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => {
          const row = rows.find((candidate) => candidate.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      deleteMany: vi
        .fn()
        .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i]!;
            const matches =
              where.familyId !== undefined
                ? row.userId === where.userId && row.familyId === where.familyId
                : row.userId === where.userId && row.id === where.id;
            if (matches) rows.splice(i, 1);
          }
          return { count: before - rows.length };
        }),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: Omit<TokenRow, 'id' | 'revokedAt'> }) => {
          const row: TokenRow = { id: `rt-new-${rows.length + 1}`, revokedAt: null, ...data };
          rows.push(row);
          return row;
        }),
    },
  };
}

function makeService(overrides: Record<string, unknown>) {
  const prisma = {
    user: {},
    refreshToken: {},
    // The service uses the interactive-callback form of $transaction.
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => unknown)(prisma),
    ),
    ...overrides,
  } as unknown as PrismaService;
  return new AuthService(prisma, new JwtService({ secret: SECRET }), config);
}

afterEach(() => vi.restoreAllMocks());

const activeUser = { id: 'u-1', email: 'admin@example.com', name: 'Admin', status: 'ACTIVE' };
const future = () => new Date(Date.now() + 60_000);

describe('AuthService.refresh — rotation families', () => {
  it('rotates a valid token inside the same family and revokes the old row', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-1', userId: 'u-1', familyId: 'fam-1', tokenHash: hashToken('old-token'), expiresAt: future(), revokedAt: null },
    ]);
    const service = makeService({
      refreshToken: db.refreshToken,
      user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
    });

    const result = await service.refresh({ refreshToken: 'old-token' });

    expect(result.accessToken).toBeTruthy();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.rows[1]!.familyId).toBe('fam-1');
    expect(db.rows[1]!.revokedAt).toBeNull();
  });

  it('replaying the rotated token returns 401 and deletes the whole family (sibling included)', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-1', userId: 'u-1', familyId: 'fam-1', tokenHash: hashToken('old-token'), expiresAt: future(), revokedAt: null },
    ]);
    const service = makeService({
      refreshToken: db.refreshToken,
      user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
    });

    await service.refresh({ refreshToken: 'old-token' });
    await expect(service.refresh({ refreshToken: 'old-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // The freshly minted sibling is gone too — the family is revoked.
    expect(db.rows).toHaveLength(0);
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', familyId: 'fam-1' },
    });
  });

  it('returns 401 for an unknown token hash without deleting anything', async () => {
    const db = makeRefreshTokenDb([]);
    const service = makeService({ refreshToken: db.refreshToken });

    await expect(service.refresh({ refreshToken: 'never-issued' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired-but-never-replayed token without family revocation', async () => {
    const db = makeRefreshTokenDb([
      {
        id: 'rt-exp',
        userId: 'u-1',
        familyId: 'fam-2',
        tokenHash: hashToken('expired-token'),
        expiresAt: new Date(Date.now() - 1_000),
        revokedAt: null,
      },
    ]);
    const service = makeService({ refreshToken: db.refreshToken });

    await expect(service.refresh({ refreshToken: 'expired-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/auth/auth.service.spec.ts
```

Expected: FAIL — the new token row is never created (`issueTokens` still takes no family) and replay does not delete the family.

- [ ] **Step 3: Implement atomic rotation in `auth.service.ts`**

Replace the import lines at the top of `backend/src/modules/auth/auth.service.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
```

with:

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
```

and add the generated-client import directly below the PrismaService import:

```ts
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
```

Replace the whole `refresh` method:

```ts
  async refresh(input: RefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const now = new Date();

    // Throwing inside the callback would roll back the family revocation, so
    // the callback returns an outcome and the 401 is thrown after commit.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored) {
        return { status: 'invalid' as const };
      }

      if (stored.expiresAt <= now) {
        return { status: 'invalid' as const };
      }

      if (stored.revokedAt !== null) {
        // Reuse of an already-rotated token: revoke the entire family.
        await this.revokeFamily(tx, stored.userId, stored.familyId, stored.id);
        return { status: 'invalid' as const };
      }

      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });

      const user = await tx.user.findUnique({ where: { id: stored.userId } });
      if (!user || user.status !== 'ACTIVE') {
        return { status: 'invalid' as const };
      }

      const tokens = await this.issueTokens(
        tx,
        user.id,
        user.email,
        stored.familyId ?? randomUUID(),
      );
      return { status: 'ok' as const, tokens };
    });

    if (outcome.status !== 'ok') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return outcome.tokens;
  }
```

Add this private method directly below `refresh`:

```ts
  /**
   * Deletes every token in a rotation family. A null familyId can only exist
   * for a row written out-of-band (the migration backfills all real rows);
   * such a row is a singleton family of one.
   */
  private async revokeFamily(
    tx: Prisma.TransactionClient,
    userId: string,
    familyId: string | null,
    selfId: string,
  ): Promise<void> {
    if (familyId !== null) {
      await tx.refreshToken.deleteMany({ where: { userId, familyId } });
    } else {
      await tx.refreshToken.deleteMany({ where: { userId, id: selfId } });
    }
  }
```

Change the `issueTokens` signature and its create call (the method becomes transaction-client aware; the JWT signing code in between is unchanged):

```ts
  private async issueTokens(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    email: string,
    familyId: string,
  ) {
```

```ts
    await client.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });
```

Finally, update the single login call site so a new login starts a fresh family. In `login`, replace:

```ts
    const tokens = await this.issueTokens(user.id, user.email);
```

with:

```ts
    const tokens = await this.issueTokens(this.prisma, user.id, user.email, randomUUID());
```

- [ ] **Step 4: Run the focused tests, then the gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/auth/auth.service.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: the new spec passes; everything else stays green.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.service.spec.ts
git commit -m "fix(security): atomic admin refresh rotation with family revocation"
```

### Task 2b: Customer `StorefrontCustomerAuthService`

**Files:**
- Modify: `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`
- Modify: `backend/src/modules/customers/storefront-customer-auth.service.ts`

- [ ] **Step 1: Add the failing tests**

In `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`, add the node-crypto import next to the existing imports:

```ts
import { createHash } from 'node:crypto';
```

and inside the top-level `describe('StorefrontCustomerAuthService', ...)` block, append these tests:

```ts
  const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

  function makeCustomerRefreshTokenDb(
    initial: Array<Record<string, unknown>>,
  ) {
    const rows: Array<Record<string, unknown>> = [...initial];
    return {
      rows,
      customerRefreshToken: {
        findUnique: vi
          .fn()
          .mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
            rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
          ),
        update: vi
          .fn()
          .mockImplementation(
            async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              const row = rows.find((candidate) => candidate.id === where.id);
              if (row) Object.assign(row, data);
              return row;
            },
          ),
        deleteMany: vi
          .fn()
          .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              const row = rows[i]!;
              const matches =
                where.familyId !== undefined
                  ? row.accountId === where.accountId && row.familyId === where.familyId
                  : row.accountId === where.accountId && row.id === where.id;
              if (matches) rows.splice(i, 1);
            }
            return { count: before - rows.length };
          }),
        create: vi
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: `rt-new-${rows.length + 1}`, revokedAt: null, ...data };
            rows.push(row);
            return row;
          }),
      },
    };
  }

  it('refresh rotates a valid customer token inside the same family', async () => {
    const db = makeCustomerRefreshTokenDb([
      {
        id: 'rt-1',
        accountId: 'acct-1',
        familyId: 'fam-1',
        tokenHash: hashToken('old-customer-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    const service = makeService({
      customerRefreshToken: db.customerRefreshToken,
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
      },
    });

    const result = await service.refresh({ refreshToken: 'old-customer-token' });

    expect(result.accessToken).toBeTruthy();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.rows[1]!.familyId).toBe('fam-1');
  });

  it('replaying a rotated customer token revokes the whole family and returns 401', async () => {
    const db = makeCustomerRefreshTokenDb([
      {
        id: 'rt-1',
        accountId: 'acct-1',
        familyId: 'fam-1',
        tokenHash: hashToken('old-customer-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    const service = makeService({
      customerRefreshToken: db.customerRefreshToken,
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
      },
    });

    await service.refresh({ refreshToken: 'old-customer-token' });
    await expect(service.refresh({ refreshToken: 'old-customer-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(db.rows).toHaveLength(0);
    expect(db.customerRefreshToken.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', familyId: 'fam-1' },
    });
  });
```

- [ ] **Step 2: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/customers/storefront-customer-auth.service.spec.ts
```

Expected: FAIL — no family rotation/family delete in the customer service yet.

- [ ] **Step 3: Implement atomic rotation**

In `backend/src/modules/customers/storefront-customer-auth.service.ts`, change the node-crypto import:

```ts
import { createHash, randomBytes } from 'node:crypto';
```

to:

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
```

Replace the whole `refresh` method:

```ts
  async refresh(input: StorefrontRefreshInput): Promise<TokenPair> {
    const tokenHash = hashToken(input.refreshToken);
    const now = new Date();

    // The callback must not throw on the reuse path (Prisma would roll the
    // family deletion back); return an outcome and 401 after commit instead.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.customerRefreshToken.findUnique({
        where: { tokenHash },
      });
      if (!stored) {
        return { status: 'invalid' as const };
      }

      if (stored.expiresAt <= now) {
        return { status: 'invalid' as const };
      }

      if (stored.revokedAt !== null) {
        await this.revokeFamily(tx, stored.accountId, stored.familyId, stored.id);
        return { status: 'invalid' as const };
      }

      await tx.customerRefreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });

      const account = await tx.customerAccount.findUnique({
        where: { id: stored.accountId },
        select: { id: true, email: true },
      });
      if (!account) {
        return { status: 'invalid' as const };
      }

      const tokens = await this.issueTokens(
        tx,
        account.id,
        account.email,
        stored.familyId ?? randomUUID(),
      );
      return { status: 'ok' as const, tokens };
    });

    if (outcome.status !== 'ok') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return outcome.tokens;
  }
```

Add this private method directly below `refresh`:

```ts
  /** Deletes every customer token in a rotation family (null = out-of-band singleton row). */
  private async revokeFamily(
    tx: Prisma.TransactionClient,
    accountId: string,
    familyId: string | null,
    selfId: string,
  ): Promise<void> {
    if (familyId !== null) {
      await tx.customerRefreshToken.deleteMany({ where: { accountId, familyId } });
    } else {
      await tx.customerRefreshToken.deleteMany({ where: { accountId, id: selfId } });
    }
  }
```

Change `issueTokens` to take a client and a family id:

```ts
  private async issueTokens(
    client: Prisma.TransactionClient | PrismaService,
    accountId: string,
    email: string,
    familyId: string,
  ): Promise<TokenPair> {
```

and its create call:

```ts
    await client.customerRefreshToken.create({
      data: { accountId, familyId, tokenHash: hashToken(refreshToken), expiresAt },
    });
```

Update the two new-login call sites. In `register`:

```ts
    const tokens = await this.issueTokens(this.prisma, account.id, account.email, randomUUID());
```

In `login`:

```ts
    const tokens = await this.issueTokens(this.prisma, account.id, account.email, randomUUID());
```

- [ ] **Step 4: Run focused tests and the gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/customers/storefront-customer-auth.service.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/customers/storefront-customer-auth.service.ts backend/src/modules/customers/storefront-customer-auth.service.spec.ts
git commit -m "fix(security): atomic customer refresh rotation with family revocation"
```

---

## Task 3: Hand-rolled rate limiting

Policies (from the review wave ruling):

| Route | IP bucket | Identifier bucket |
|---|---|---|
| `POST /api/v1/auth/login` | 10 / 10 min | — |
| `POST /api/v1/storefront/customers/login` | 10 / 10 min | 5 / email / 10 min |
| `POST /api/v1/storefront/customers/register` | 5 / 60 min | — |
| `POST /api/v1/auth/refresh` | 30 / 10 min | — |
| `POST /api/v1/storefront/customers/refresh` | 30 / 10 min | — |

Cleanup design: **sweep-on-write**, no timer. Each `hit()` prunes its own bucket's expired timestamps; at most once per 10 minutes a global sweep drops empty buckets. Timers (even unref'd) complicate unit tests and process shutdown for no gain — the map is bounded by distinct keys seen inside the longest window (60 min).

### Task 3a: Pure sliding-window limiter + IPv6 normalization

**Files:**
- Create: `backend/src/common/rate-limit.window.ts`
- Create: `backend/src/common/rate-limit.window.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/rate-limit.window.spec.ts`:

```ts
import {
  SlidingWindowRateLimiter,
  normalizeClientIp,
} from './rate-limit.window.js';

describe('SlidingWindowRateLimiter', () => {
  it('admits exactly `limit` hits, then blocks until the window slides', () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.hit('k', 3, 1_000, 100).allowed).toBe(true);
    }
    const blocked = limiter.hit('k', 3, 1_000, 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000);

    // The first hit is 1,000 ms old at t=1,100: it has slid out, so one slot
    // opens (boundary is strict: now - t < windowMs).
    expect(limiter.hit('k', 3, 1_000, 1_100).allowed).toBe(true);
  });

  it('treats a timestamp exactly at the window edge as expired', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.hit('k', 1, 1_000, 0).allowed).toBe(true);
    expect(limiter.hit('k', 1, 1_000, 1_000).allowed).toBe(true);
  });

  it('isolates keys and reports a positive Retry-After on the blocked one', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.hit('a', 1, 1_000, 0).allowed).toBe(true);
    expect(limiter.hit('b', 1, 1_000, 0).allowed).toBe(true);
    const blocked = limiter.hit('a', 1, 1_000, 500);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 500 });
  });

  it('sweeps stale empty buckets on write (no timer)', () => {
    const limiter = new SlidingWindowRateLimiter(1);
    limiter.hit('short', 1, 100, 0);
    expect(limiter.size).toBe(1);
    // Past the sweep interval AND the bucket window, any write triggers cleanup.
    limiter.hit('other', 1, 100, 200);
    expect(limiter.size).toBe(1);
  });
});

describe('normalizeClientIp', () => {
  it('passes IPv4 through unchanged', () => {
    expect(normalizeClientIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeClientIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 clients into their /64 network prefix', () => {
    expect(normalizeClientIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    // Two hosts on the same /64 share a bucket; the compressed form expands.
    expect(normalizeClientIp('2001:db8:1:2::abcd')).toBe('2001:db8:1:2::/64');
    expect(normalizeClientIp('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
  });

  it('keeps distinct /64 networks apart and maps missing IPs to "unknown"', () => {
    expect(normalizeClientIp('2001:db8:9:9::1')).not.toBe(
      normalizeClientIp('2001:db8:1:2::1'),
    );
    expect(normalizeClientIp(undefined)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/common/rate-limit.window.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the limiter**

Create `backend/src/common/rate-limit.window.ts`:

```ts
/**
 * Dependency-free sliding-window-log rate limiter.
 *
 * Every accepted hit records a timestamp; a request is blocked when the
 * number of timestamps inside the trailing window already equals the limit.
 * The clock is injected for deterministic tests. State is per-process memory,
 * which matches the single-instance deployment behind one reverse proxy.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** When blocked: ms until the oldest in-window hit expires; 0 when allowed. */
  retryAfterMs: number;
}

interface RateBucket {
  windowMs: number;
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private lastSweep = 0;

  constructor(private readonly sweepIntervalMs = 10 * 60_000) {}

  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): RateLimitDecision {
    this.sweepIfDue(now);

    const bucket = this.buckets.get(key) ?? { windowMs, timestamps: [] };
    bucket.windowMs = windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);

    if (bucket.timestamps.length >= limit) {
      const retryAfterMs = Math.max(
        0,
        (bucket.timestamps[0] ?? now) + windowMs - now,
      );
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterMs };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Number of live buckets (test/observability). */
  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
    this.lastSweep = 0;
  }

  /**
   * Periodic cleanup without a timer: at most once per sweepIntervalMs, prune
   * expired timestamps from every bucket and drop buckets that are empty.
   */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < this.sweepIntervalMs) {
      return;
    }
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < bucket.windowMs,
      );
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Rate-limit identity for a peer address. Residential IPv6 clients get a
 * fresh /64 per household but rotate host addresses inside it, so IPv6 peers
 * are bucketed by their first four hextets. IPv4 (including ::ffff:-mapped)
 * keeps the literal address.
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  if (!ip) {
    return 'unknown';
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) {
    return mapped[1]!;
  }
  if (!ip.includes(':')) {
    return ip;
  }

  // Expand '::' into zero groups, then keep the network side (first 4).
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...tailGroups,
  ].map((group) => (group === '' ? '0' : group));

  return `${groups.slice(0, 4).join(':')}::/64`;
}
```

- [ ] **Step 4: Run tests and gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/common/rate-limit.window.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/common/rate-limit.window.ts backend/src/common/rate-limit.window.spec.ts
git commit -m "fix(security): clock-injectable sliding-window rate limiter with IPv6 /64 helper"
```

### Task 3b: Metadata-driven `ThrottleGuard`

**Files:**
- Create: `backend/src/common/throttle.guard.ts`
- Create: `backend/src/common/throttle.guard.spec.ts`

- [ ] **Step 1: Write the failing guard test**

Create `backend/src/common/throttle.guard.spec.ts`:

```ts
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import {
  THROTTLE_KEY,
  ThrottleGuard,
  type ThrottlePolicy,
} from './throttle.guard.js';

function contextFor(options: {
  ip: string;
  body?: unknown;
  handler: () => void;
}): { ctx: ExecutionContext; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  const ctx = {
    getHandler: () => options.handler,
    getClass: () => class ThrottledController {},
    switchToHttp: () => ({
      getRequest: () => ({ ip: options.ip, body: options.body ?? {} }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

/** Mirrors the post-decoration state @Throttle produces on a method. */
function handlerWith(policies: ThrottlePolicy[]): () => void {
  const handler = () => undefined;
  Reflect.defineMetadata(THROTTLE_KEY, policies, handler);
  return handler;
}

const ipPolicy: ThrottlePolicy = {
  key: 'test:ip',
  bucket: 'ip',
  limit: 2,
  windowMs: 60_000,
};
const emailPolicy: ThrottlePolicy = {
  key: 'test:email',
  bucket: 'email',
  limit: 1,
  windowMs: 60_000,
};

describe('ThrottleGuard', () => {
  it('passes under the limit', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy]);
    const { ctx } = contextFor({ ip: '203.0.113.1', handler });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks with the Nest envelope and a Retry-After header past the limit', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy]);
    const { ctx, setHeader } = contextFor({ ip: '203.0.113.2', handler });

    guard.canActivate(ctx);
    guard.canActivate(ctx);

    try {
      guard.canActivate(ctx);
      throw new Error('expected HttpException');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(httpError.getResponse()).toEqual({
        statusCode: 429,
        message: 'Too many requests',
        error: 'Too Many Requests',
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
      expect(Number(setHeader.mock.calls[0]![1])).toBeGreaterThanOrEqual(1);
    }
  });

  it('applies the email bucket across different IPs and ignores email casing/spacing', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy, emailPolicy]);

    const first = contextFor({ ip: '203.0.113.3', body: { email: 'Juan@Example.com ' }, handler });
    const second = contextFor({ ip: '203.0.113.4', body: { email: ' juan@example.com' }, handler });
    expect(guard.canActivate(first.ctx)).toBe(true);
    expect(() => guard.canActivate(second.ctx)).toThrow(HttpException);
  });

  it('skips the email bucket when no email is present (IP bucket still applies)', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy, emailPolicy]);
    const { ctx } = contextFor({ ip: '203.0.113.5', body: { refreshToken: 'x' }, handler });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows routes without throttle metadata', () => {
    const guard = new ThrottleGuard();
    const { ctx } = contextFor({ ip: '203.0.113.6', handler: () => undefined });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/common/throttle.guard.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard**

Create `backend/src/common/throttle.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SlidingWindowRateLimiter, normalizeClientIp } from './rate-limit.window.js';

export const THROTTLE_KEY = 'throttle:policies';

export type ThrottleBucket = 'ip' | 'email';

export interface ThrottlePolicy {
  /** Bucket namespace including route and dimension, e.g. 'admin-login:ip'. */
  key: string;
  bucket: ThrottleBucket;
  limit: number;
  windowMs: number;
}

/** Declares one or more rate-limit policies for a route; read by ThrottleGuard. */
export const Throttle = (...policies: ThrottlePolicy[]) =>
  SetMetadata(THROTTLE_KEY, policies);

type ThrottledRequest = Request & { body?: unknown };

/**
 * In-process sliding-window throttle applied per route with @UseGuards.
 * Every guard instance owns its limiter; policy keys are route-specific so
 * the two modules' guards never share a bucket by accident.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly limiter = new SlidingWindowRateLimiter();

  // Reflector is provided by Nest core; the default keeps `new ThrottleGuard()`
  // working in unit tests.
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    const policies = this.reflector.getAllAndOverride<ThrottlePolicy[]>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!policies || policies.length === 0) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<ThrottledRequest>();
    const response = http.getResponse<Response>();

    const ip = normalizeClientIp(request.ip);
    const email = emailFromBody(request.body);
    const now = Date.now();

    let blocked = false;
    let retryAfterMs = 0;

    for (const policy of policies) {
      const subject = policy.bucket === 'email' ? email : ip;
      // Malformed/absent body: the IP dimension still protects the route.
      if (policy.bucket === 'email' && subject === null) {
        continue;
      }
      const decision = this.limiter.hit(
        `${policy.key}:${subject}`,
        policy.limit,
        policy.windowMs,
        now,
      );
      if (!decision.allowed) {
        blocked = true;
        retryAfterMs =
          retryAfterMs === 0 ? decision.retryAfterMs : Math.min(retryAfterMs, decision.retryAfterMs);
      }
    }

    if (blocked) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

function emailFromBody(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const candidate = (body as Record<string, unknown>).email;
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (normalized.length > 0 && normalized.length <= 254) {
        return normalized;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests and gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/common/throttle.guard.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/common/throttle.guard.ts backend/src/common/throttle.guard.spec.ts
git commit -m "fix(security): metadata-driven throttle guard (IP and normalized-email buckets)"
```

### Task 3c: Apply policies to controllers + trust one proxy hop

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/customers/storefront/customers.controller.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Throttle the admin auth controller**

In `backend/src/modules/auth/auth.controller.ts`, add the imports:

```ts
import { Throttle, ThrottleGuard } from '../../common/throttle.guard.js';
```

Decorate `login`:

```ts
  @Post('login')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'admin-login:ip', bucket: 'ip', limit: 10, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) {
    return this.auth.login(input);
  }
```

Decorate `refresh` (leave `logout` and `me` untouched):

```ts
  @Post('refresh')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'admin-refresh:ip', bucket: 'ip', limit: 30, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) input: RefreshInput) {
    return this.auth.refresh(input);
  }
```

- [ ] **Step 2: Throttle the storefront customer controller**

In `backend/src/modules/customers/storefront/customers.controller.ts`, add the import:

```ts
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
```

Decorate `register`, `login`, and `refresh` (leave `logout`, `me`, PATCH, orders untouched):

```ts
  @Post('register')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'customer-register:ip', bucket: 'ip', limit: 5, windowMs: 60 * 60_000 })
  @HttpCode(HttpStatus.CREATED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @UseGuards(ThrottleGuard)
  @Throttle(
    { key: 'customer-login:ip', bucket: 'ip', limit: 10, windowMs: 10 * 60_000 },
    { key: 'customer-login:email', bucket: 'email', limit: 5, windowMs: 10 * 60_000 },
  )
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'customer-refresh:ip', bucket: 'ip', limit: 30, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(storefrontRefreshSchema)) body: StorefrontRefreshInput) {
    return this.auth.refresh(body);
  }
```

- [ ] **Step 3: Trust exactly one proxy hop**

Replace the entire contents of `backend/src/main.ts` with:

```ts
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Production sits behind exactly one reverse proxy (Caddy in the prod
  // compose). Trusting one hop makes Express derive request.ip from the
  // X-Forwarded-For entry immediately to the LEFT of the trusted proxy hop;
  // client-supplied entries further left are ignored (verified on Express 5 /
  // proxy-addr). The throttle guard buckets on that address. Do not raise this
  // above 1 without re-checking header spoofing.
  app.set('trust proxy', 1);

  // All routes live under /api/v1 per SYSTEM_ARCHITECTURE.md §62-65:
  // storefront, admin and webhooks are namespaces below this prefix.
  app.setGlobalPrefix('api/v1');

  // Validated at boot, so this is guaranteed to be present and numeric.
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('app.port'));
}

await bootstrap();
```

- [ ] **Step 4: Gate and live-verify the 429 path**

Run in `backend/`:

```bash
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Restart the API on :3000, then:

```bash
# 11 rapid bad logins: the 11th must be 429 with Retry-After.
# Use a schema-valid email: Zod's z.email() rejects 'x@y.z' with 400 (the guard
# still throttles, but the first ten responses would be 400, not 401).
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3000/api/v1/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"x@example.com","password":"longpassword"}'
done; echo
curl -s -i -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"x@example.com","password":"longpassword"}' | grep -iE 'HTTP/|retry-after'
# A different route family is unaffected:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/storefront/customers/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"not-a-real-token"}'
```

Expected: ten `401` responses then `429`; the `-i` response carries `retry-after: <seconds>` (600 for the 10-minute window); the customer refresh route answers independently (401, not 429).

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/auth/auth.controller.ts backend/src/modules/customers/storefront/customers.controller.ts backend/src/main.ts
git commit -m "fix(security): throttle auth routes and trust one proxy hop"
```

---

## Task 4: Login timing equalizer (M6)

A single lazily-computed dummy argon2 hash lives at module level in each service. Unknown-account logins still perform one argon2 verify and then return the identical 401, so account existence is not distinguishable by latency.

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts` and `auth.service.spec.ts`
- Modify: `backend/src/modules/customers/storefront-customer-auth.service.ts` and `.spec.ts`

- [ ] **Step 1: Add failing admin tests**

Append this describe block to `backend/src/modules/auth/auth.service.spec.ts`:

```ts
describe('AuthService.login — timing equalizer', () => {
  it('runs an argon2 verify on unknown email and still returns 401', async () => {
    const verifySpy = vi.spyOn(argon2, 'verify');
    const service = makeService({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      service.login({ email: 'ghost@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifySpy).toHaveBeenCalledOnce();
    expect(verifySpy.mock.calls[0]![1]).toBe('longpassword');
  });

  it('logs in an active user with the correct password and starts a family', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const service = makeService({
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'u-1',
            email: 'admin@example.com',
            name: 'Admin',
            status: 'ACTIVE',
            passwordHash: await argon2.hash('longpassword'),
          }),
      },
      refreshToken: { create },
    });

    const result = await service.login({ email: 'admin@example.com', password: 'longpassword' });
    expect(result.user.email).toBe('admin@example.com');
    expect(result.refreshToken).toBeTruthy();
    expect(create.mock.calls[0]![0].data.familyId).toEqual(expect.any(String));
  });

  it('rejects a wrong password with 401', async () => {
    const service = makeService({
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'u-1',
            email: 'admin@example.com',
            name: 'Admin',
            status: 'ACTIVE',
            passwordHash: await argon2.hash('longpassword'),
          }),
      },
    });

    await expect(
      service.login({ email: 'admin@example.com', password: 'otherpassword1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

Add the argon2 import at the top of the spec (with the other imports):

```ts
import argon2 from 'argon2';
```

- [ ] **Step 2: Tighten the existing customer unknown-email test**

In `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`, replace the test `login rejects an unknown email with 401` with:

```ts
  it('login burns an argon2 verify on unknown email and returns 401', async () => {
    const verifySpy = vi.spyOn(argon2, 'verify');
    const service = makeService({
      customerAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.login({ email: 'nobody@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifySpy).toHaveBeenCalledOnce();
    expect(verifySpy.mock.calls[0]![1]).toBe('longpassword');
  });
```

- [ ] **Step 3: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/auth/auth.service.spec.ts src/modules/customers/storefront-customer-auth.service.spec.ts
```

Expected: FAIL — unknown-email paths return without calling `argon2.verify`.

- [ ] **Step 4: Equalize the admin service**

In `backend/src/modules/auth/auth.service.ts`, add the cached dummy hash directly below the `hashToken` function:

```ts
/**
 * One-time random constant hashed once per process. Unknown-account logins
 * verify against it so the argon2 work (and therefore latency) matches the
 * known-account path (final-review M6: email-enumeration timing oracle).
 */
const DUMMY_PASSWORD = randomBytes(32).toString('hex');
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  return (dummyHashPromise ??= argon2.hash(DUMMY_PASSWORD));
}
```

In `login`, replace:

```ts
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }
```

with:

```ts
    if (!user) {
      await argon2.verify(await dummyHash(), input.password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }
```

- [ ] **Step 5: Equalize the customer service**

In `backend/src/modules/customers/storefront-customer-auth.service.ts`, add the same helper below `hashToken`:

```ts
/** Cached dummy hash burned on unknown-account logins to flatten timing (M6). */
const DUMMY_PASSWORD = randomBytes(32).toString('hex');
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  return (dummyHashPromise ??= argon2.hash(DUMMY_PASSWORD));
}
```

In `login`, replace:

```ts
    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }
```

with:

```ts
    if (!account) {
      await argon2.verify(await dummyHash(), input.password);
      throw new UnauthorizedException('Invalid credentials');
    }
```

- [ ] **Step 6: Run focused tests and the gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/auth/auth.service.spec.ts src/modules/customers/storefront-customer-auth.service.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 7: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.service.spec.ts backend/src/modules/customers/storefront-customer-auth.service.ts backend/src/modules/customers/storefront-customer-auth.service.spec.ts
git commit -m "fix(security): argon2 timing equalizer on unknown login accounts"
```

---

## Task 5: ILIKE escaping + deferred test hygiene (M5, Rec 3)

### Task 5a: Escape `%`, `_`, `\` in product search

**Files:**
- Modify: `backend/src/modules/catalog/product-search.ts`
- Modify: `backend/src/modules/catalog/product-search.spec.ts`

- [ ] **Step 1: Add the failing escaping tests**

Append to `backend/src/modules/catalog/product-search.spec.ts`, inside a new top-level describe:

```ts
describe('buildTrgmSearch — LIKE wildcard escaping (M5)', () => {
  it('sets ESCAPE \'\\\' on every ILIKE and never binds a bare %% pattern', () => {
    const result = buildTrgmSearch(['%']);
    expect(result.match.sql).toContain("ESCAPE '\\'");
    expect(result.rank.sql).toContain("ESCAPE '\\'");

    // Bound LIKE patterns start and end with %; a '%'-only token must become
    // '%\\%%' (escaped wildcard), never the match-all '%%'.
    const likePatterns = flatValues(result.match).filter(
      (value): value is string =>
        typeof value === 'string' && value.length > 1 && value.startsWith('%') && value.endsWith('%'),
    );
    expect(likePatterns).not.toContain('%%');
    expect(likePatterns).toContain('%\\%%');
    // A 1-char token takes the ILIKE-only branch (<3 chars, no trgm binds):
    // the raw token is never passed to word_similarity, so both bound LIKE
    // values (name + slug) are the escaped pattern — observed ['%\\%%','%\\%%'].
    expect(likePatterns.length).toBe(2);
    expect(likePatterns.every((value) => value === '%\\%%')).toBe(true);
  });

  it('escapes underscore and backslash tokens', () => {
    const underscore = buildTrgmSearch(['a_b']);
    expect(underscore.match.sql).toContain("ESCAPE '\\'");
    expect(flatValues(underscore.match)).toContain('%a\\_b%');

    const backslash = buildTrgmSearch(['a\\b']);
    expect(flatValues(backslash.match)).toContain('%a\\\\b%');
  });

  it('keeps ordinary token patterns unchanged', () => {
    const result = buildTrgmSearch(['chair']);
    expect(flatValues(result.match)).toContain('%chair%');
    // Tokens >= 3 chars also bind the raw token for word_similarity (short
    // tokens never reach the trgm branch — see the first test above).
    expect(flatValues(result.match)).toContain('chair');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/catalog/product-search.spec.ts
```

Expected: FAIL — no `ESCAPE` clause and the `%` token binds as `%%`.

- [ ] **Step 3: Implement escaping**

In `backend/src/modules/catalog/product-search.ts`, add an escaping helper directly below `tokenizeSearch`:

```ts
/** Escapes LIKE meta-characters; callers append `ESCAPE '\'` to the predicate. */
function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, '\\$&');
}

function likePattern(token: string): string {
  return `%${escapeLike(token)}%`;
}
```

Replace `tokenCondition` with:

```ts
/** Boolean group: this single token matches via trgm OR substring. */
function tokenCondition(token: string): Prisma.Sql {
  const pattern = likePattern(token);
  if (token.length < 3) {
    return Prisma.sql`(
      products.name ILIKE ${pattern} ESCAPE '\\'
      OR products.slug ILIKE ${pattern} ESCAPE '\\'
    )`;
  }
  return Prisma.sql`(
    word_similarity(${token}, products.name) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR word_similarity(${token}, products.slug) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR products.name ILIKE ${pattern} ESCAPE '\\'
    OR products.slug ILIKE ${pattern} ESCAPE '\\'
  )`;
}
```

Replace `tokenScore` with:

```ts
/** Per-token relevance: best name/slug similarity, with an exact-prefix boost. */
function tokenScore(token: string): Prisma.Sql {
  const pattern = likePattern(token);
  const exact = Prisma.sql`CASE
      WHEN products.name ILIKE ${pattern} ESCAPE '\\'
        OR products.slug ILIKE ${pattern} ESCAPE '\\'
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
```

(The TS literal `'\\'` emits the single-backslash SQL text `ESCAPE '\'`.)

- [ ] **Step 4: Run focused tests and gate**

Run in `backend/`:

```bash
pnpm exec vitest run src/modules/catalog/product-search.spec.ts
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/catalog/product-search.ts backend/src/modules/catalog/product-search.spec.ts
git commit -m "fix(security): escape LIKE wildcards in storefront product search"
```

### Task 5b: Deferred auth tests, deep-key whitelist, SQL-text guards

**Files:**
- Modify: `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`
- Modify: `backend/src/modules/catalog/product-search.spec.ts`

- [ ] **Step 1: Add the deferred customer auth tests**

In `backend/src/modules/customers/storefront-customer-auth.service.spec.ts`, append these tests inside the existing top-level describe (the `createHash` import and `hashToken` helper were added in Task 2b):

```ts
  it('login (happy path) returns tokens and profile for a valid password', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({
          ...accountRow,
          passwordHash: await argon2.hash('longpassword'),
          customer: null,
        }),
      },
      customerRefreshToken: { create },
    });

    const result = await service.login({ email: 'juan@example.com', password: 'longpassword' });

    expect(result.account.email).toBe('juan@example.com');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(create.mock.calls[0]![0].data.familyId).toEqual(expect.any(String));
  });

  it('logout invalidates the presented refresh token idempotently', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = makeService({ customerRefreshToken: { updateMany } });

    await expect(service.logout('some-refresh-token')).resolves.toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashToken('some-refresh-token'), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('updateMe with only a name updates the account without touching the phone-keyed Customer', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn();
    const service = makeService({
      customer: { upsert },
      customerAccount: {
        // Call 1: requireAccount at entry. Call 2: requireAccount inside me().
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce({ ...accountRow, name: 'Juanita', customer: null }),
        update,
      },
    });

    const profile = await service.updateMe('acct-1', { name: 'Juanita' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { name: 'Juanita' },
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(profile.name).toBe('Juanita');
  });

  it('register rethrows non-P2002 database errors unchanged', async () => {
    const boom = new Error('database down');
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(boom),
      },
    });

    await expect(
      service.register({ name: 'Juan', email: 'juan@example.com', password: 'longpassword' }),
    ).rejects.toBe(boom);
  });
```

(Refresh-success is already covered by Task 2b's `refresh rotates a valid customer token inside the same family` test — do not duplicate it.)

- [ ] **Step 2: Strengthen the order whitelist test with deep key extraction**

At the top of `backend/src/modules/customers/storefront-customer-auth.service.spec.ts` (below `p2002`), add:

```ts
/** Collects every object key at every depth, including inside arrays. */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

const FORBIDDEN_STOREFRONT_KEYS = [
  'supplierSku',
  'supplierCost',
  'costCurrency',
  'landedCost',
  'isVisible',
  'source',
  'verifiedOrderItemId',
];
```

Replace the test `serializes orders without cost/supplier/internal fields and converts decimals` with a version that first injects decoy forbidden fields into the "database" rows, then asserts the serialized object's actual keys:

```ts
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
            // Decoy columns that must never survive serialization.
            supplierSku: 'SKU-SUPPLIER',
            supplierCost: 5,
            costCurrency: 'CNY',
            landedCost: 7,
            items: [
              {
                productNameSnapshot: 'Stock Chair',
                variantSnapshot: 'Default',
                quantity: 2,
                lineTotal: { toString: () => '3998.00' },
                source: 'ADMIN',
                isVisible: false,
                verifiedOrderItemId: 'oi-1',
                landedCost: 9,
              },
            ],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });

    const page = await service.listOrders('acct-1', { page: 1, pageSize: 10 });
    expect(page.items[0]!.grandTotal).toBe(1999);
    expect(page.items[0]!.items[0]!.lineTotal).toBe(3998);

    const serializedKeys = collectKeys(page.items);
    for (const forbidden of FORBIDDEN_STOREFRONT_KEYS) {
      expect(serializedKeys.has(forbidden)).toBe(false);
    }
  });
```

- [ ] **Step 3: Add the two source-text guards to the search spec**

At the top of `backend/src/modules/catalog/product-search.spec.ts`, add:

```ts
import { readFileSync } from 'node:fs';
```

and append a final describe block:

```ts
describe('storefront product SQL hygiene', () => {
  const productsServiceSource = readFileSync(
    new URL('./products.service.ts', import.meta.url),
    'utf8',
  );

  it('fuzzy search ORDER BY ends with the deterministic products.id DESC tiebreak (M4)', () => {
    expect(productsServiceSource).toMatch(
      /ORDER BY rank DESC, products\.created_at DESC, products\.id DESC\s*LIMIT/,
    );
  });

  it('STOREFRONT_SELECT whitelists no supplier/cost columns on skus', () => {
    const start = productsServiceSource.indexOf('const STOREFRONT_SELECT');
    const end = productsServiceSource.indexOf('} satisfies Prisma.ProductSelect');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = productsServiceSource.slice(start, end);
    for (const forbidden of ['supplierSku', 'supplierCost', 'costCurrency', 'landedCost']) {
      expect(block).not.toContain(forbidden);
    }
    expect(block).toContain('skuCode');
  });
});
```

- [ ] **Step 4: Run the gate**

Run in `backend/`:

```bash
pnpm run lint && pnpm run build && pnpm exec vitest run
```

Expected: all specs green. The two source-text guards already pass against current code (M4 was fixed earlier and the whitelist is already explicit) — they are regression guards, per the review.

- [ ] **Step 5: Commit**

Run in `small-house-commerce/`:

```bash
git add backend/src/modules/customers/storefront-customer-auth.service.spec.ts backend/src/modules/catalog/product-search.spec.ts
git commit -m "test(security): deferred auth coverage, deep-key whitelist and SQL-text guards"
```

---

## Final verification (whole wave)

- [ ] Run from `backend/`:

```bash
pnpm run lint && pnpm run build && pnpm exec vitest run
pnpm exec prisma migrate status
```

Expected: zero lint/build/test failures; migration status "up to date"; no un-generated client drift.

- [ ] Confirm no protected files are staged (working tree may contain their unrelated modifications — they must simply never appear in a `git add` of this wave):

```bash
git status --porcelain | grep -E 'HOMEPAGE_SPEC|2026-09-11-pdp-refinement|docs/research/' || echo 'clean'
```

Any lines printed are expected pre-existing modifications; verify none of the wave's commits included them — the wave makes 9 commits, so check `git show --stat HEAD~8..HEAD`.

- [ ] Smoke the auth surfaces manually: admin login (wrong password 401, valid 200), customer login, refresh once (200), replay old refresh token (401, family rows deleted in both tables), then a fresh login still works (proving revocation was scoped to the family, not the account).
