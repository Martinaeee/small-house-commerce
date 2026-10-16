import { describe, expect, it } from 'vitest';
import { bulkProductStatusSchema, createProductSchema, updateProductSchema } from './product.dto.js';

describe.each([
  ['create', createProductSchema, { name: 'Card table', slug: 'card-table', categoryId: '00000000-0000-4000-8000-000000000001' }],
  ['update', updateProductSchema, {}],
] as const)('legacy variant card media in %s', (_name, schema, basics) => {
  const cover = { type: 'IMAGE', url: '/uploads/legacy-card.webp', altText: null };
  const hover = { type: 'IMAGE', url: '/uploads/legacy-hover.webp', altText: 'Own hover' };

  it.each([
    ['configured', { cover, hover }],
    ['cleared', null],
    ['hover cleared', { cover, hover: null }],
  ])('preserves %s card snapshots', (_label, cardMedia) => {
    const parsed = schema.parse({ ...basics, variants: [{ name: 'A', position: 0, cardMedia }] });
    expect(parsed.variants?.[0]).toHaveProperty('cardMedia', cardMedia);
  });

  it('keeps omitted card metadata absent', () => {
    const parsed = schema.parse({ ...basics, variants: [{ name: 'A', position: 0 }] });
    expect(Object.hasOwn(parsed.variants![0]!, 'cardMedia')).toBe(false);
  });

  it.each([
    ['video', { cover: { ...cover, type: 'VIDEO' }, hover }],
    ['unsafe URL', { cover: { ...cover, url: '//cdn.example/card.webp' }, hover }],
    ['oversized Alt', { cover, hover: { ...hover, altText: 'x'.repeat(256) } }],
    ['gallery reference', { cover: { ...cover, id: '00000000-0000-4000-8000-000000000001' }, hover }],
  ])('rejects %s card snapshots', (_label, cardMedia) => {
    expect(schema.safeParse({ ...basics, variants: [{ name: 'A', position: 0, cardMedia }] }).success).toBe(false);
  });
});

describe.each([
  ['create', createProductSchema, { name: 'Sized table', slug: 'sized-table', categoryId: '00000000-0000-4000-8000-000000000001' }],
  ['update', updateProductSchema, {}],
] as const)('legacy SKU product dimensions in %s', (_name, schema, basics) => {
  const dimensions = { productWidth: 120, productDepth: 60, productHeight: 75 };
  const body = (fields: Record<string, unknown>) => ({
    ...basics, variants: [{ name: 'Sized', sku: { skuCode: 'DIM-ONE', ...fields } }],
  });

  it('retains independent product and package dimensions', () => {
    const fields = { ...dimensions, packageWidth: 130, packageDepth: 70, packageHeight: 85, productWeight: 4, packageWeight: 5, volumetricWeight: 9 };
    expect(schema.parse(body(fields)).variants?.[0]?.sku).toMatchObject(fields);
  });

  it('preserves explicit null clearing', () => {
    const fields = { productWidth: null, productDepth: null, productHeight: null };
    expect(schema.parse(body(fields)).variants?.[0]?.sku).toMatchObject(fields);
  });

  it('leaves omitted overrides absent', () => {
    const sku = schema.parse(body({})).variants![0]!.sku!;
    for (const field of Object.keys(dimensions)) expect(Object.hasOwn(sku, field)).toBe(false);
  });

  it('preserves zero under the nonnegative DTO policy', () => {
    const fields = { productWidth: 0, productDepth: 0, productHeight: 0 };
    expect(schema.parse(body(fields)).variants?.[0]?.sku).toMatchObject(fields);
  });

  it.each(Object.keys(dimensions).flatMap(field => [-1, NaN, Infinity, -Infinity].map(value => [field, value] as const)))(
    'rejects invalid %s=%s at its SKU field', (field, value) => {
      const result = schema.safeParse(body({ [field]: value }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.path.join('.') === `variants.0.sku.${field}`)).toBe(true);
    },
  );
});

describe.each([
  ['create', createProductSchema, { name: 'Bundle furniture', slug: 'bundle-furniture', categoryId: '00000000-0000-4000-8000-000000000001' }],
  ['update', updateProductSchema, {}],
] as const)('legacy SKU inventory mode in %s', (_name, schema, basics) => {
  const body = (fields: Record<string, unknown>) => ({ ...basics, variants: [{ name: 'Set', sku: { skuCode: 'BUNDLE-MODE', ...fields } }] });
  it.each([true, false])('preserves an explicit virtual marker %s', isBundle => {
    expect(schema.parse(body({ isBundle })).variants?.[0]?.sku).toHaveProperty('isBundle', isBundle);
  });
  it('leaves an omitted marker absent', () => {
    expect(Object.hasOwn(schema.parse(body({})).variants![0]!.sku!, 'isBundle')).toBe(false);
  });
  it.each([null, 'true', 1])('rejects a non-boolean marker %s', isBundle => {
    expect(schema.safeParse(body({ isBundle })).success).toBe(false);
  });
});

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
