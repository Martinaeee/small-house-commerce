import { describe, expect, it } from 'vitest';
import { bulkProductStatusSchema, updateProductSchema } from './product.dto.js';

describe('product SEO fields', () => {
  it('keeps independently persisted SEO title and meta description', () => {
    expect(
      updateProductSchema.parse({
        seoTitle: '  Space-saving cabinet | LUWAG  ',
        metaDescription: '  A compact cabinet made for flexible Filipino homes.  ',
      }),
    ).toMatchObject({
      seoTitle: 'Space-saving cabinet | LUWAG',
      metaDescription: 'A compact cabinet made for flexible Filipino homes.',
    });

    expect(
      updateProductSchema.parse({
        seoTitle: null,
        metaDescription: null,
      }),
    ).toMatchObject({ seoTitle: null, metaDescription: null });
  });

  it('uses the existing landing-page SEO storage bounds', () => {
    expect(
      updateProductSchema.safeParse({ seoTitle: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      updateProductSchema.safeParse({ metaDescription: 'x'.repeat(301) }).success,
    ).toBe(false);
  });
});

describe('bulk product status', () => {
  const id = (n: number) =>
    `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

  it('accepts a bounded batch of real uuids with a publishable status', () => {
    expect(
      bulkProductStatusSchema.parse({ ids: [id(1), id(2)], status: 'ACTIVE' }),
    ).toEqual({ ids: [id(1), id(2)], status: 'ACTIVE' });
    expect(
      bulkProductStatusSchema.parse({ ids: [id(3)], status: 'DISABLED' }),
    ).toEqual({ ids: [id(3)], status: 'DISABLED' });
  });

  it('rejects empty, oversized, or malformed batches', () => {
    expect(
      bulkProductStatusSchema.safeParse({ ids: [], status: 'ACTIVE' }).success,
    ).toBe(false);
    expect(
      bulkProductStatusSchema.safeParse({
        ids: Array.from({ length: 51 }, (_, index) => id(index)),
        status: 'ACTIVE',
      }).success,
    ).toBe(false);
    expect(
      bulkProductStatusSchema.safeParse({ ids: ['not-a-uuid'], status: 'ACTIVE' })
        .success,
    ).toBe(false);
  });

  it('rejects statuses outside ACTIVE / DISABLED (DRAFT stays an editor action)', () => {
    expect(
      bulkProductStatusSchema.safeParse({ ids: [id(1)], status: 'DRAFT' })
        .success,
    ).toBe(false);
  });
});
