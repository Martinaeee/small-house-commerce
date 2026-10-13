import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionService } from './promotion.service.js';

const revalidation = vi.hoisted(() => ({
  revalidateCache: vi.fn(async () => undefined),
}));

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: revalidation.revalidateCache,
}));

const row = {
  id: '0199a000-0000-7000-8000-000000000001',
  code: 'WELCOME10',
  discountType: 'PERCENT' as const,
  discountValue: 10,
  minSpend: 0,
  maxUses: 5,
  perCustomerLimit: 1,
  validFrom: null,
  validUntil: null,
  status: 'ACTIVE' as const,
  archivedAt: null,
  createdAt: new Date('2026-10-12T00:00:00.000Z'),
  updatedAt: new Date('2026-10-12T00:00:00.000Z'),
};

function harness() {
  const tx = {
    newsletterPromotion: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => row),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    newsletterPromotion: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async () => ({ ...row, discountValue: 15 })),
    },
  };
  return {
    service: new PromotionService(prisma as never),
  };
}

describe('PromotionService storefront revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates the storefront after starting a new round', async () => {
    const { service } = harness();

    await service.create({
      code: 'WELCOME10',
      discountType: 'PERCENT',
      discountValue: 10,
      minSpend: 0,
      maxUses: 5,
      perCustomerLimit: 1,
      validFrom: null,
      validUntil: null,
    });

    expect(revalidation.revalidateCache).toHaveBeenCalledWith(['storefront']);
  });

  it('revalidates the storefront after editing the active round', async () => {
    const { service } = harness();

    await service.update(row.id, { discountValue: 15 });

    expect(revalidation.revalidateCache).toHaveBeenCalledWith(['storefront']);
  });
});
