import { describe, expect, it } from 'vitest';
import { findProductCardReadinessIssues } from './product-card-readiness.js';

const cover = (url = '/uploads/card.webp') => ({
  cover: { type: 'IMAGE' as const, url, altText: null }, hover: null,
});
const variant = (id: string, cardMedia: unknown = null, price: unknown = 100, status = 'ACTIVE'): {
  id: string; name: string; cardMedia: unknown; sku: { status: string; price: unknown } | null;
} => ({
  id, name: id, cardMedia, sku: { status, price },
});
const product = (variants: ReturnType<typeof variant>[], defaultDisplayVariantId: string | null = null) => ({
  id: 'p', name: 'Table', defaultDisplayVariantId, variants,
});

describe('independent product card publish readiness', () => {
  it('reports every active priced variant missing its own cover including zero price', () => {
    const issues = findProductCardReadinessIssues([product([
      variant('small', null, 0), variant('large'), variant('disabled', null, 100, 'DISABLED'), variant('unpriced', null, null),
    ])]);
    expect(issues).toEqual([{
      productId: 'p', productName: 'Table', missingCoverVariants: [
        { variantId: 'small', name: 'small' }, { variantId: 'large', name: 'large' },
      ], defaultDisplayVariantMissing: true,
    }]);
  });

  it('allows a configured single variant without asking for an extra default selection', () => {
    expect(findProductCardReadinessIssues([product([variant('a', cover())])])).toEqual([]);
  });

  it('allows an absent hover image but never substitutes a hover for a cover', () => {
    expect(findProductCardReadinessIssues([product([variant('a', { cover: null, hover: cover().cover })])]))
      .toMatchObject([{ missingCoverVariants: [{ variantId: 'a' }], defaultDisplayVariantMissing: false }]);
  });

  it.each([null, 'foreign', 'disabled', 'unpriced'])('requires an explicit valid default for multiple selectable variants: %s', defaultId => {
    const result = findProductCardReadinessIssues([product([
      variant('a', cover()), variant('b', cover('/uploads/b.webp'), 0),
      variant('disabled', null, 100, 'DISABLED'), variant('unpriced', null, null),
    ], defaultId)]);
    expect(result).toMatchObject([{ missingCoverVariants: [], defaultDisplayVariantMissing: true }]);
  });

  it('accepts an explicit zero-price default without checking inventory', () => {
    const row = product([variant('a', cover()), variant('b', cover('/uploads/b.webp'), 0)], 'b');
    Object.assign(row.variants[1]!.sku!, { availableInventory: 0 });
    expect(findProductCardReadinessIssues([row])).toEqual([]);
  });

  it.each([
    { cover: { type: 'VIDEO', url: '/uploads/a.mp4', altText: null }, hover: null },
    { cover: { type: 'IMAGE', url: 'javascript:alert(1)', altText: null }, hover: null },
    { cover: null, hover: null },
    'not a snapshot',
  ])('does not accept invalid or empty stored metadata %j', cardMedia => {
    expect(findProductCardReadinessIssues([product([variant('a', cardMedia)])]))
      .toMatchObject([{ missingCoverVariants: [{ variantId: 'a' }] }]);
  });

  it('does not invent configuration from a shared gallery or an option thumbnail', () => {
    const row = product([variant('a')]);
    Object.assign(row, { images: [{ type: 'IMAGE', url: '/shared.webp', isScene: true }], thumbnailUrl: '/thumb.webp' });
    expect(findProductCardReadinessIssues([row])).toMatchObject([{ missingCoverVariants: [{ variantId: 'a' }] }]);
  });

  it('collects all affected products without mutating their state', () => {
    const rows = [product([variant('a')]), { ...product([variant('b')]), id: 'other', name: 'Chair' }];
    const before = structuredClone(rows);
    expect(findProductCardReadinessIssues(rows).map(issue => issue.productName)).toEqual(['Table', 'Chair']);
    expect(rows).toEqual(before);
  });

  it('ignores disabled, unpriced and missing SKUs without manufacturing an empty-product default', () => {
    const row = product([variant('disabled', null, 100, 'DISABLED'), variant('unpriced', null, null)]);
    row.variants.push({ ...variant('missing'), sku: null });
    expect(findProductCardReadinessIssues([row, product([])])).toEqual([]);
  });
});
