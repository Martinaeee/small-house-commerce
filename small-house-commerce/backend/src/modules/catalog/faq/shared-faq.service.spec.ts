import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_FAQ_SET_ID, SharedFaqService } from './shared-faq.service.js';
import type { FaqItem } from './faq-content.js';

const ITEM: FaqItem = {
  id: '11111111-1111-7111-8111-111111111111',
  title: 'How does Cash on Delivery work?',
  answer: [{ kind: 'paragraph', text: 'Pay the rider when the order arrives.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

interface Row {
  id: string;
  items: FaqItem[];
  version: number;
  updatedByUserId: string | null;
}

function createPrismaMock() {
  let row: Row | null = null;
  return {
    current: () => row,
    sharedFaqSet: {
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => {
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        return row;
      }),
      upsert: vi.fn(
        async ({ create }: { create: { id: string; items: FaqItem[]; version: number } }) => {
          row ??= { ...create, updatedByUserId: null };
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number };
          data: Partial<Row>;
        }) => {
          if (!row || row.version !== where.version) return { count: 0 };
          row = { ...row, ...data } as Row;
          return { count: 1 };
        },
      ),
    },
  };
}

function createService() {
  const prisma = createPrismaMock();
  return { prisma, service: new SharedFaqService(prisma as never) };
}

describe('SharedFaqService', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('creates the singleton on first read', async () => {
    const set = await ctx.service.get();
    expect(set.id).toBe(SHARED_FAQ_SET_ID);
    expect(set.items).toEqual([]);
    expect(set.version).toBe(0);
    expect(ctx.prisma.sharedFaqSet.upsert).toHaveBeenCalledOnce();
  });

  it('returns the stored library on later reads without re-creating it', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    const set = await ctx.service.get();
    expect(set.items).toEqual([ITEM]);
    expect(set.version).toBe(1);
    expect(ctx.prisma.sharedFaqSet.upsert).toHaveBeenCalledOnce();
  });

  it('validates the payload before writing', async () => {
    await expect(
      ctx.service.update([{ ...ITEM, title: '' }], 0, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale version with a named conflict', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    await expect(ctx.service.update([ITEM], 0, 'u2')).rejects.toMatchObject({
      response: { code: 'FAQ_VERSION_MISMATCH', currentVersion: 1 },
    });
  });

  it('increments the version and records who edited the library', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    expect(ctx.prisma.current()).toMatchObject({ version: 1, updatedByUserId: 'u1' });
  });

  it('reports a conflict when the guarded update matches no row', async () => {
    await ctx.service.get();
    ctx.prisma.sharedFaqSet.findUniqueOrThrow = vi.fn(async () => ({
      id: SHARED_FAQ_SET_ID,
      items: [],
      version: 0,
      updatedByUserId: null,
    })) as never;
    ctx.prisma.sharedFaqSet.updateMany = vi.fn(async () => ({ count: 0 })) as never;
    await expect(ctx.service.update([ITEM], 0, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an empty library so every shared question can be switched off', async () => {
    await expect(ctx.service.update([], 0, 'u1')).resolves.toEqual({ version: 1 });
  });
});
