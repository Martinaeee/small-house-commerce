import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OptimizersService } from './optimizers.service.js';

interface Row {
  id: string;
  userId: string;
  aid: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
}

function createPrismaMock() {
  const rows: Row[] = [];
  const unique = (error: unknown, code: string) => {
    const candidate = error as { code?: string };
    return candidate?.code === code;
  };
  return {
    rows,
    user: { findUnique: vi.fn(async () => ({ id: 'u1', name: 'Operator', status: 'ACTIVE' })) },
    optimizerProfile: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; aid?: string; userId?: string } }) =>
          rows.find(
            (row) =>
              (where.id !== undefined && row.id === where.id) ||
              (where.aid !== undefined && row.aid === where.aid) ||
              (where.userId !== undefined && row.userId === where.userId),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'status'> }) => {
        if (rows.some((row) => row.aid === data.aid || row.userId === data.userId)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row: Row = { id: `op-${rows.length + 1}`, status: 'ACTIVE', ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          const row = rows.find((candidate) => candidate.id === where.id);
          if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
          Object.assign(row, data);
          return row;
        },
      ),
    },
    _unique: unique,
  };
}

function createService() {
  const prisma = createPrismaMock();
  return { prisma, service: new OptimizersService(prisma as never) };
}

describe('OptimizersService', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('creates a stable server-generated profile once for an active operator', async () => {
    const first = await ctx.service.ensureProfileForUser('u1');
    ctx.prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Renamed', status: 'ACTIVE' });
    const again = await ctx.service.ensureProfileForUser('u1');
    expect(first.aid).toMatch(/^OP-[A-F0-9]{12}$/);
    expect(again.aid).toBe(first.aid);
    expect(ctx.prisma.rows).toHaveLength(1);
  });

  it('concurrent first-time profile requests reuse the same user identity', async () => {
    const [a, b] = await Promise.all([ctx.service.ensureProfileForUser('u1'), ctx.service.ensureProfileForUser('u1')]);
    expect(a.aid).toBe(b.aid);
    expect(ctx.prisma.rows).toHaveLength(1);
  });

  it('does not revive a disabled optimizer profile or enroll a disabled user', async () => {
    await ctx.service.create({ userId: 'u1', aid: 'OLD', displayName: 'Old' });
    ctx.prisma.rows[0]!.status = 'DISABLED';
    await expect(ctx.service.ensureProfileForUser('u1')).rejects.toMatchObject({ status: 403 });
    ctx.prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Old', status: 'DISABLED' });
    await expect(ctx.service.ensureProfileForUser('u2')).rejects.toMatchObject({ status: 404 });
    expect(ctx.prisma.rows).toHaveLength(1);
  });

  it('stores the canonical AID form', async () => {
    const created = await ctx.service.create({
      userId: 'u1',
      aid: ' ma-1 ',
      displayName: 'Optimizer A',
    });
    expect(created.aid).toBe('MA-1');
    expect(created.status).toBe('ACTIVE');
  });

  it('rejects an AID that is not a usable code', async () => {
    await expect(
      ctx.service.create({ userId: 'u1', aid: 'MA 1', displayName: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.service.create({ userId: 'u1', aid: '-MA1', displayName: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a blank display name', async () => {
    await expect(
      ctx.service.create({ userId: 'u1', aid: 'MA-1', displayName: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate AID to a named conflict', async () => {
    await ctx.service.create({ userId: 'u1', aid: 'MA-1', displayName: 'A' });
    await expect(
      ctx.service.create({ userId: 'u2', aid: 'ma-1', displayName: 'B' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves an AID regardless of case and padding', async () => {
    await ctx.service.create({ userId: 'u1', aid: 'MA-1', displayName: 'Optimizer A' });
    await expect(ctx.service.resolveByAid(' ma-1 ')).resolves.toMatchObject({
      userId: 'u1',
      displayName: 'Optimizer A',
    });
  });

  it('returns null for an unusable or unknown AID instead of throwing', async () => {
    await expect(ctx.service.resolveByAid('MA 1')).resolves.toBeNull();
    await expect(ctx.service.resolveByAid('NOPE')).resolves.toBeNull();
  });

  it('updates the profile status and reports a missing profile', async () => {
    const created = await ctx.service.create({ userId: 'u1', aid: 'MA-1', displayName: 'A' });
    await expect(ctx.service.updateStatus(created.id, 'DISABLED')).resolves.toMatchObject({
      status: 'DISABLED',
    });
    await expect(ctx.service.updateStatus('missing', 'DISABLED')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
