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
