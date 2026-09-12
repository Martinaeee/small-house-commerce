import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client.js';
import { StorefrontCustomerAuthService } from './storefront-customer-auth.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${target}`,
    { code: 'P2002', clientVersion: '7.10.0' },
  );
}

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const config = {
  getOrThrow: (key: string) => (key === 'jwt.accessTtl' ? '1h' : '7d'),
} as never;

type CustomerTokenRow = Record<string, unknown> & {
  id: string;
  accountId: string;
  familyId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type CustomerStagedOp =
  | { type: 'revoke'; id: string; revokedAt: Date }
  | { type: 'create'; data: Record<string, unknown> }
  | { type: 'delete'; where: Record<string, unknown> };

interface CustomerTxn {
  stages: CustomerStagedOp[];
  locks: Array<{ id: string; release: () => void }>;
  rolledBack: boolean;
}

interface CustomerDbHooks {
  onFind?: (readCount: number) => void;
  beforeClaim?: () => Promise<void> | void;
}

/**
 * In-memory customerRefreshToken delegate modelling the Postgres semantics
 * the rotation relies on: staged writes applied only on callback resolve
 * (throw = rollback), and per-row claim locks held until transaction end so
 * a concurrent conditional claim re-evaluates against the latest committed
 * row version (READ COMMITTED) and matches zero rows for the loser.
 */
function makeCustomerRefreshTokenDb(
  initial: CustomerTokenRow[],
  hooks: CustomerDbHooks = {},
) {
  const rows: CustomerTokenRow[] = [...initial];
  const transactions: CustomerTxn[] = [];
  const txnStore = new AsyncLocalStorage<CustomerTxn>();
  const rowLocks = new Map<string, Promise<void>>();
  let reads = 0;

  const matches = (row: CustomerTokenRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const deleteRows = (where: Record<string, unknown>): number => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (matches(rows[i]!, where)) rows.splice(i, 1);
    }
    return before - rows.length;
  };

  const commit = (txn: CustomerTxn) => {
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

  async function claim(
    id: string,
    revokedAt: Date,
    txn: CustomerTxn | undefined,
  ): Promise<number> {
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

  const customerRefreshToken = {
    findUnique: vi
      .fn()
      .mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
        hooks.onFind?.(++reads);
        const row = rows.find((candidate) => candidate.tokenHash === where.tokenHash);
        return row ? { ...row } : null;
      }),
    update: vi
      .fn()
      .mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
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
          data: Record<string, unknown>;
        }) => {
          const txn = txnStore.getStore();
          if (
            where.id !== undefined &&
            where.revokedAt === null &&
            data.revokedAt instanceof Date
          ) {
            const count = await claim(where.id as string, data.revokedAt as Date, txn);
            return { count };
          }
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
          txn.stages.push({ type: 'delete', where });
          return { count: 0 };
        }
        return { count: deleteRows(where) };
      }),
    create: vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const txn = txnStore.getStore();
        if (txn) {
          txn.stages.push({ type: 'create', data });
          return { id: `rt-staged-${txn.stages.length}` };
        }
        const row = { id: `rt-new-${rows.length + 1}`, revokedAt: null, ...data };
        rows.push(row);
        return row;
      }),
  };

  let client: unknown = null;

  const $transaction = vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const txn: CustomerTxn = { stages: [], locks: [], rolledBack: false };
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
    customerRefreshToken,
    $transaction,
    setClient(value: unknown) {
      client = value;
    },
  };
}

function makeService(
  prismaOverrides: Record<string, unknown>,
  db?: ReturnType<typeof makeCustomerRefreshTokenDb>,
) {
  const prisma = {
    customerAccount: {},
    customer: {},
    order: {},
    ...prismaOverrides,
    // With a staging DB the refresh tests run through the commit/rollback
    // runner; everything else keeps the inline callback/array runner. The
    // service uses both transaction forms: interactive callback (phone
    // linking, refresh) and the awaited-array form (orders list).
    customerRefreshToken: db
      ? db.customerRefreshToken
      : (prismaOverrides.customerRefreshToken ?? {}),
    $transaction: db
      ? db.$transaction
      : vi.fn(async (arg: unknown) =>
          Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
        ),
  } as unknown as PrismaService;
  db?.setClient(prisma);
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

  it('register maps a concurrent duplicate-email P2002 on create to 409', async () => {
    const service = makeService({
      customerAccount: {
        // Pre-check misses; a racing transaction wins the unique email.
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(p2002('CustomerAccount_email_key')),
      },
    });
    await expect(
      service.register({ name: 'Juan', email: 'juan@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateMe maps a concurrent phone-link P2002 on account update to 409', async () => {
    const service = makeService({
      customer: {
        upsert: vi.fn().mockResolvedValue({ id: 'cust-9', normalizedPhone: '+639170000002' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customerAccount: {
        // Call 1: requireAccount; call 2: owner lookup (misses the racer).
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null),
        // The racing account already owns customerId cust-9.
        update: vi.fn().mockRejectedValue(p2002('CustomerAccount_customerId_key')),
      },
    });
    await expect(
      service.updateMe('acct-1', { phone: '09170000002' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

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

  it('PATCH /me with name+phone seeds and backfills Customer using the NEW name', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'cust-11', normalizedPhone: '+639170000003' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = makeService({
      customer: { upsert, updateMany },
      customerAccount: {
        // Call 1: requireAccount at updateMe entry (pre-update name "Juan").
        // Call 2: owner lookup inside the transaction (null = phone free).
        // Call 3: requireAccount when me() reloads the profile.
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...accountRow,
            name: 'Juanita',
            customerId: 'cust-11',
            customer: { normalizedPhone: '+639170000003' },
          }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });

    const profile = await service.updateMe('acct-1', {
      name: 'Juanita',
      phone: '0917 000 0003',
    });

    expect(profile.name).toBe('Juanita');
    // A brand-new phone-keyed Customer is seeded with the incoming name.
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      normalizedPhone: '+639170000003',
      name: 'Juanita',
    });
    // The name:null backfill (first updateMany) also gets the incoming name.
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'cust-11', name: null },
      data: { name: 'Juanita' },
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

  const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
    const service = makeService(
      {
        customerRefreshToken: db.customerRefreshToken,
        customerAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
        },
      },
      db,
    );

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
    const service = makeService(
      {
        customerRefreshToken: db.customerRefreshToken,
        customerAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
        },
      },
      db,
    );

    await service.refresh({ refreshToken: 'old-customer-token' });
    await expect(service.refresh({ refreshToken: 'old-customer-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(db.rows).toHaveLength(0);
    expect(db.customerRefreshToken.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', familyId: 'fam-1' },
    });
    // The deletion COMMITTED; a 401 thrown inside the callback would roll it
    // back and this transaction would be recorded as rolledBack.
    expect(db.transactions[1]!.rolledBack).toBe(false);
  });

  it('the transaction fake discards staged customer-token writes when the callback throws', async () => {
    const db = makeCustomerRefreshTokenDb([
      {
        id: 'rt-x',
        accountId: 'acct-1',
        familyId: 'fam-x',
        tokenHash: hashToken('x-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    makeService({ customerRefreshToken: db.customerRefreshToken }, db);

    await expect(
      db.$transaction(
        async (tx: {
          customerRefreshToken: { deleteMany: (args: unknown) => Promise<unknown> };
        }) => {
          await tx.customerRefreshToken.deleteMany({
            where: { accountId: 'acct-1', familyId: 'fam-x' },
          });
          throw new Error('boom after staging');
        },
      ),
    ).rejects.toThrow('boom after staging');

    expect(db.rows).toHaveLength(1);
    expect(db.transactions[0]!.rolledBack).toBe(true);
  });

  it('refresh coalesces a legacy NULL-family customer row into a fresh family', async () => {
    const db = makeCustomerRefreshTokenDb([
      {
        id: 'rt-legacy',
        accountId: 'acct-1',
        familyId: null,
        tokenHash: hashToken('legacy-customer-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    const service = makeService(
      {
        customerRefreshToken: db.customerRefreshToken,
        customerAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
        },
      },
      db,
    );

    const result = await service.refresh({ refreshToken: 'legacy-customer-token' });

    expect(result.accessToken).toBeTruthy();
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]!.id).toBe('rt-legacy');
    expect(db.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.rows[0]!.familyId).toBeNull();
    expect(db.rows[1]!.familyId).toEqual(expect.any(String));
    expect(db.rows[1]!.familyId).not.toBeNull();
    expect(db.rows[1]!.revokedAt).toBeNull();
  });

  it('replaying a revoked legacy NULL-family customer row deletes only that singleton row', async () => {
    const db = makeCustomerRefreshTokenDb([
      {
        id: 'rt-legacy',
        accountId: 'acct-1',
        familyId: null,
        tokenHash: hashToken('legacy-customer-token'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    const service = makeService(
      {
        customerRefreshToken: db.customerRefreshToken,
        customerAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
        },
      },
      db,
    );

    await service.refresh({ refreshToken: 'legacy-customer-token' });
    expect(db.rows).toHaveLength(2);

    await expect(
      service.refresh({ refreshToken: 'legacy-customer-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.customerRefreshToken.deleteMany).toHaveBeenLastCalledWith({
      where: { accountId: 'acct-1', id: 'rt-legacy' },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.revokedAt).toBeNull();
    expect(db.rows[0]!.familyId).toEqual(expect.any(String));
  });

  it('concurrent customer refreshes of the same token have exactly one winner; the loser wipes the family', async () => {
    let resolveSecondRead!: () => void;
    const secondRead = new Promise<void>((resolve) => {
      resolveSecondRead = resolve;
    });
    let releaseClaims!: () => void;
    const claimsGate = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });

    const db = makeCustomerRefreshTokenDb(
      [
        {
          id: 'rt-1',
          accountId: 'acct-1',
          familyId: 'fam-1',
          tokenHash: hashToken('race-customer-token'),
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        },
      ],
      {
        onFind: (readCount: number) => {
          if (readCount === 2) resolveSecondRead();
        },
        beforeClaim: async () => {
          await claimsGate;
        },
      },
    );
    const service = makeService(
      {
        customerRefreshToken: db.customerRefreshToken,
        customerAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'acct-1', email: 'juan@example.com' }),
        },
      },
      db,
    );

    const first = service.refresh({ refreshToken: 'race-customer-token' });
    const second = service.refresh({ refreshToken: 'race-customer-token' });
    await secondRead;
    releaseClaims();

    const [outcomeA, outcomeB] = await Promise.allSettled([first, second]);
    expect([outcomeA.status, outcomeB.status].sort()).toEqual(['fulfilled', 'rejected']);
    const winner = outcomeA.status === 'fulfilled' ? outcomeA.value : outcomeB.value;
    expect(winner.accessToken).toBeTruthy();
    const loser = outcomeA.status === 'rejected' ? outcomeA.reason : outcomeB.reason;
    expect(loser).toBeInstanceOf(UnauthorizedException);

    // Exactly one sibling minted, and the loser wipes it as part of the family.
    expect(db.customerRefreshToken.create).toHaveBeenCalledTimes(1);
    expect(db.rows).toHaveLength(0);
    expect(db.customerRefreshToken.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', familyId: 'fam-1' },
    });
    expect(db.customerRefreshToken.updateMany).toHaveBeenCalledTimes(2);
    expect(db.customerRefreshToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
