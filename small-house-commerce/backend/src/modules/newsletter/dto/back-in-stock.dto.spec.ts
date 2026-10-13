import { describe, expect, it } from 'vitest';
import {
  backInStockQuerySchema,
  backInStockSubscribeSchema,
  backInStockUnsubscribeQuerySchema,
} from './back-in-stock.dto.js';

const SKU_ID = '018f4d9f-7b31-7a4d-8d64-3c6f8b889c11';

describe('back-in-stock DTO schemas', () => {
  it('trims a valid email and accepts a UUID SKU', () => {
    expect(
      backInStockSubscribeSchema.parse({
        email: '  Shopper@Example.com  ',
        skuId: SKU_ID,
      }),
    ).toEqual({ email: 'Shopper@Example.com', skuId: SKU_ID });
  });

  it.each([
    { email: 'not-an-email', skuId: SKU_ID },
    { email: 'a@b.com', skuId: 'not-a-uuid' },
    { email: `${'a'.repeat(200)}@b.com`, skuId: SKU_ID },
  ])('rejects invalid subscribe input %#', (input) => {
    expect(backInStockSubscribeSchema.safeParse(input).success).toBe(false);
  });

  it('defaults and bounds the admin list query', () => {
    expect(backInStockQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      backInStockQuerySchema.parse({
        page: '2',
        pageSize: '50',
        status: 'PENDING',
      }),
    ).toEqual({ page: 2, pageSize: 50, status: 'PENDING' });
    expect(
      backInStockQuerySchema.safeParse({ pageSize: 101 }).success,
    ).toBe(false);
  });

  it('requires a bounded unsubscribe token', () => {
    expect(
      backInStockUnsubscribeQuerySchema.parse({ token: 'payload.mac' }),
    ).toEqual({ token: 'payload.mac' });
    expect(
      backInStockUnsubscribeQuerySchema.safeParse({ token: '' }).success,
    ).toBe(false);
  });
});
