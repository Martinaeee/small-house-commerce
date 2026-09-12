import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';
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

type StagedOp =
  | { type: 'revoke'; id: string; revokedAt: Date }
  | { type: 'create'; data: Omit<TokenRow, 'id' | 'revokedAt'> }
  | { type: 'delete'; where: Record<string, unknown> };

interface Txn {
  stages: StagedOp[];
  locks: Array<{ id: string; release: () => void }>;
  rolledBack: boolean;
}

interface DbHooks {
  /** Fired with the 1-based read count on every refreshToken.findUnique. */
  onFind?: (readCount: number) => void;
  /** Awaited before every atomic claim (updateMany ... WHERE revokedAt IS NULL). */
  beforeClaim?: () => Promise<void> | void;
}

/**
 * In-memory refreshToken delegate that models the Postgres semantics the
 * rotation relies on:
 *  - interactive transactions STAGE writes and only apply them to the shared
 *    rows when the callback RESOLVES; a throw discards staged writes
 *    (rollback);
 *  - an atomic claim takes a per-row lock for the duration of its
 *    transaction; a concurrent claim blocks until commit/rollback and then
 *    re-evaluates against the latest committed row version (READ COMMITTED),
 *    so `WHERE revokedAt IS NULL` matches zero rows for the loser.
 */
function makeRefreshTokenDb(initial: TokenRow[], hooks: DbHooks = {}) {
  const rows: TokenRow[] = [...initial];
  const transactions: Txn[] = [];
  const txnStore = new AsyncLocalStorage<Txn>();
  const rowLocks = new Map<string, Promise<void>>();
  let reads = 0;

  const matches = (row: TokenRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);

  const deleteRows = (where: Record<string, unknown>): number => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (matches(rows[i]!, where)) rows.splice(i, 1);
    }
    return before - rows.length;
  };

  const commit = (txn: Txn) => {
    for (const op of txn.stages) {
      if (op.type === 'revoke') {
        const row = rows.find((candidate) => candidate.id === op.id);
        if (row) row.revokedAt = op.revokedAt;
      } else if (op.type === 'create') {
        rows.push({ id: `rt-new-${rows.length + 1}`, revokedAt: null, ...op.data });
      } else {
        deleteRows(op.where);
      }
    }
  };

  async function claim(id: string, revokedAt: Date, txn: Txn | undefined): Promise<number> {
    await hooks.beforeClaim?.();
    for (;;) {
      const held = rowLocks.get(id);
      if (held) {
        await held;
        continue;
      }
      let resolveLock!: () => void;
      const lock = new Promise<void>((resolve) => {
        resolveLock = resolve;
      });
      rowLocks.set(id, lock);
      const release = () => {
        rowLocks.delete(id);
        resolveLock();
      };
      const row = rows.find((candidate) => candidate.id === id);
      const won = row !== undefined && row.revokedAt === null;
      if (won && txn) txn.stages.push({ type: 'revoke', id, revokedAt });
      if (txn) txn.locks.push({ id, release });
      else release();
      return won ? 1 : 0;
    }
  }

  const refreshToken = {
    findUnique: vi
      .fn()
      .mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
        hooks.onFind?.(++reads);
        // Statement snapshot: callers receive a detached copy.
        const row = rows.find((candidate) => candidate.tokenHash === where.tokenHash);
        return row ? { ...row } : null;
      }),
    update: vi
      .fn()
      .mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => {
          const row = rows.find((candidate) => candidate.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    updateMany: vi
      .fn()
      .mockImplementation(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<TokenRow>;
        }) => {
          const txn = txnStore.getStore();
          // Atomic rotation claim: WHERE id = ? AND revoked_at IS NULL.
          if (where.id !== undefined && where.revokedAt === null && data.revokedAt instanceof Date) {
            const count = await claim(where.id as string, data.revokedAt, txn);
            return { count };
          }
          // Non-transactional bulk updates (e.g. idempotent logout).
          let count = 0;
          for (const row of rows) {
            if (matches(row, where)) {
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        },
      ),
    deleteMany: vi
      .fn()
      .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        const txn = txnStore.getStore();
        if (txn) {
          // Staged: evaluated against committed rows at commit time.
          txn.stages.push({ type: 'delete', where });
          return { count: 0 };
        }
        return { count: deleteRows(where) };
      }),
    create: vi
      .fn()
      .mockImplementation(
        async ({ data }: { data: Omit<TokenRow, 'id' | 'revokedAt'> }) => {
          const txn = txnStore.getStore();
          if (txn) {
            txn.stages.push({ type: 'create', data });
            return { id: `rt-staged-${txn.stages.length}` };
          }
          const row: TokenRow = { id: `rt-new-${rows.length + 1}`, revokedAt: null, ...data };
          rows.push(row);
          return row;
        },
      ),
  };

  // The client the service receives as `tx` inside a transaction; makeService
  // binds it to the full fake prisma (token delegate + other delegates).
  let client: unknown = null;

  /** Interactive-transaction runner with commit/rollback semantics. */
  const $transaction = vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const txn: Txn = { stages: [], locks: [], rolledBack: false };
    transactions.push(txn);
    try {
      const result = await txnStore.run(txn, () => (arg as (tx: unknown) => unknown)(client));
      commit(txn);
      return result;
    } catch (error) {
      txn.rolledBack = true;
      throw error;
    } finally {
      for (const lock of txn.locks) lock.release();
    }
  });

  return {
    rows,
    transactions,
    refreshToken,
    txnStore,
    commit,
    $transaction,
    setClient(value: unknown) {
      client = value;
    },
  };
}

function makeService(
  overrides: Record<string, unknown>,
  db?: ReturnType<typeof makeRefreshTokenDb>,
) {
  const prisma = {
    user: {},
    ...overrides,
    refreshToken: db ? db.refreshToken : overrides.refreshToken ?? {},
    // Without a staging DB (non-refresh tests) the callback just runs inline.
    $transaction: db
      ? db.$transaction
      : vi.fn(async (arg: unknown) =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (tx: unknown) => unknown)(prisma),
        ),
  } as unknown as PrismaService;
  db?.setClient(prisma);
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
    const userFindUnique = vi.fn().mockResolvedValue(activeUser);
    const service = makeService(
      { refreshToken: db.refreshToken, user: { findUnique: userFindUnique } },
      db,
    );

    const result = await service.refresh({ refreshToken: 'old-token' });

    expect(result.accessToken).toBeTruthy();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.rows[1]!.familyId).toBe('fam-1');
    expect(db.rows[1]!.revokedAt).toBeNull();
    // MINOR-1: the rotation read must not load the password hash.
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { id: true, email: true, status: true },
    });
  });

  it('replaying the rotated token returns 401 and deletes the whole family (sibling included)', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-1', userId: 'u-1', familyId: 'fam-1', tokenHash: hashToken('old-token'), expiresAt: future(), revokedAt: null },
    ]);
    const service = makeService(
      {
        refreshToken: db.refreshToken,
        user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
      },
      db,
    );

    await service.refresh({ refreshToken: 'old-token' });
    await expect(service.refresh({ refreshToken: 'old-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // The freshly minted sibling is gone too — the family is revoked.
    expect(db.rows).toHaveLength(0);
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', familyId: 'fam-1' },
    });
    // Outcome-then-throw structure: the replay transaction COMMITTED the
    // deletion; throwing the 401 inside the callback would have rolled it
    // back and this transaction would be recorded as rolledBack.
    expect(db.transactions[1]!.rolledBack).toBe(false);
  });

  it('returns 401 for an unknown token hash without deleting anything', async () => {
    const db = makeRefreshTokenDb([]);
    const service = makeService({ refreshToken: db.refreshToken }, db);

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
    const service = makeService({ refreshToken: db.refreshToken }, db);

    await expect(service.refresh({ refreshToken: 'expired-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(1);
  });

  it('the transaction fake discards staged writes when the callback throws', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-x', userId: 'u-1', familyId: 'fam-x', tokenHash: hashToken('x-token'), expiresAt: future(), revokedAt: null },
    ]);
    makeService({ refreshToken: db.refreshToken }, db);

    // Direct exercise of the $transaction contract: a staged family deletion
    // followed by a throw must leave the committed rows untouched.
    await expect(
      db.$transaction(async (tx: { refreshToken: { deleteMany: (args: unknown) => Promise<unknown> } }) => {
        await tx.refreshToken.deleteMany({ where: { userId: 'u-1', familyId: 'fam-x' } });
        throw new Error('boom after staging');
      }),
    ).rejects.toThrow('boom after staging');

    expect(db.rows).toHaveLength(1);
    expect(db.transactions[0]!.rolledBack).toBe(true);
  });

  it('rotates a legacy NULL-family row by coalescing into a fresh family', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-legacy', userId: 'u-1', familyId: null, tokenHash: hashToken('legacy-token'), expiresAt: future(), revokedAt: null },
    ]);
    const service = makeService(
      {
        refreshToken: db.refreshToken,
        user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
      },
      db,
    );

    const result = await service.refresh({ refreshToken: 'legacy-token' });

    expect(result.accessToken).toBeTruthy();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]!.id).toBe('rt-legacy');
    expect(db.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.rows[0]!.familyId).toBeNull();
    const sibling = db.rows[1]!;
    expect(sibling.familyId).toEqual(expect.any(String));
    expect(sibling.familyId).not.toBeNull();
    expect(sibling.revokedAt).toBeNull();
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u-1', familyId: sibling.familyId }),
    });
  });

  it('replaying a revoked legacy NULL-family row deletes only that singleton row', async () => {
    const db = makeRefreshTokenDb([
      { id: 'rt-legacy', userId: 'u-1', familyId: null, tokenHash: hashToken('legacy-token'), expiresAt: future(), revokedAt: null },
    ]);
    const service = makeService(
      {
        refreshToken: db.refreshToken,
        user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
      },
      db,
    );

    // First rotation: old row revoked (still NULL family), sibling gets a
    // fresh random family.
    await service.refresh({ refreshToken: 'legacy-token' });
    expect(db.rows).toHaveLength(2);

    // Replay the NULL-family row: singleton self-only deletion; the successor
    // (different family) is untouched.
    await expect(service.refresh({ refreshToken: 'legacy-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshToken.deleteMany).toHaveBeenLastCalledWith({
      where: { userId: 'u-1', id: 'rt-legacy' },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.revokedAt).toBeNull();
    expect(db.rows[0]!.familyId).toEqual(expect.any(String));
  });

  it('concurrent refreshes of the same token have exactly one winner; the loser wipes the family', async () => {
    let resolveSecondRead!: () => void;
    const secondRead = new Promise<void>((resolve) => {
      resolveSecondRead = resolve;
    });
    let releaseClaims!: () => void;
    const claimsGate = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });

    const db = makeRefreshTokenDb(
      [
        { id: 'rt-1', userId: 'u-1', familyId: 'fam-1', tokenHash: hashToken('race-token'), expiresAt: future(), revokedAt: null },
      ],
      {
        onFind: (readCount) => {
          if (readCount === 2) resolveSecondRead();
        },
        // Both reads must land before either atomic claim is evaluated.
        beforeClaim: async () => {
          await claimsGate;
        },
      },
    );
    const service = makeService(
      {
        refreshToken: db.refreshToken,
        user: { findUnique: vi.fn().mockResolvedValue(activeUser) },
      },
      db,
    );

    const first = service.refresh({ refreshToken: 'race-token' });
    const second = service.refresh({ refreshToken: 'race-token' });
    await secondRead;
    releaseClaims();

    const [outcomeA, outcomeB] = await Promise.allSettled([first, second]);
    const statuses = [outcomeA.status, outcomeB.status].sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
    const winner = outcomeA.status === 'fulfilled' ? outcomeA.value : outcomeB.value;
    expect(winner.accessToken).toBeTruthy();
    const loser = outcomeA.status === 'rejected' ? outcomeA.reason : outcomeB.reason;
    expect(loser).toBeInstanceOf(UnauthorizedException);

    // Exactly one sibling was minted...
    expect(db.refreshToken.create).toHaveBeenCalledTimes(1);
    // ...and the loser family wipe caught it too: no valid token remains.
    expect(db.rows).toHaveLength(0);
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', familyId: 'fam-1' },
    });
    // Both contenders used the atomic conditional claim.
    expect(db.refreshToken.updateMany).toHaveBeenCalledTimes(2);
    expect(db.refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

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
