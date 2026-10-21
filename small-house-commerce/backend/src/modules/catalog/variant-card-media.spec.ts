import { describe, expect, it } from 'vitest';
import { variantCardImageSchema, variantCardMediaSchema } from './variant-card-media.js';

describe('independent variant card image schema', () => {
  const cover = { type: 'IMAGE' as const, url: '/uploads/card.webp', altText: 'Cover' };

  it('allows an empty draft pair without supplying shared media', () => {
    expect(variantCardMediaSchema.parse({ cover: null, hover: null })).toEqual({ cover: null, hover: null });
  });

  it('allows the same explicitly selected URL with separate slot Alt snapshots', () => {
    expect(variantCardMediaSchema.parse({ cover, hover: { ...cover, altText: 'Hover' } })).toEqual({
      cover: { type: 'IMAGE', url: '/uploads/card.webp', altText: 'Cover' },
      hover: { type: 'IMAGE', url: '/uploads/card.webp', altText: 'Hover' },
    });
  });

  it('accepts the maximum Alt length without truncating it', () => {
    const altText = 'x'.repeat(255);
    expect(variantCardImageSchema.parse({ ...cover, altText }).altText).toBe(altText);
  });

  it('requires explicit Alt intent rather than manufacturing one', () => {
    expect(variantCardImageSchema.safeParse({ type: 'IMAGE', url: cover.url }).success).toBe(false);
  });
});
