import { describe, expect, it } from 'vitest';
import { updateProductSchema } from './product.dto.js';

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
