// src/modules/catalog/review-utils.spec.ts
import { describe, expect, it } from 'vitest';
import { serializeReview, summarizeRatings } from './review-utils.js';

describe('summarizeRatings', () => {
  it('returns zero count and null average for no reviews', () => {
    expect(summarizeRatings([])).toEqual({ reviewCount: 0, ratingAverage: null });
  });

  it('counts reviews and rounds the average to one decimal', () => {
    const rows = [{ rating: 5 }, { rating: 4 }, { rating: 3 }];
    expect(summarizeRatings(rows)).toEqual({ reviewCount: 3, ratingAverage: 4.0 });
  });

  it('rounds the half-up average 4.25 to 4.3 and never returns NaN', () => {
    const rows = [
      { rating: 5 },
      { rating: 5 },
      { rating: 5 },
      { rating: 2 }, // sum 17 / 4 = 4.25
    ];
    expect(summarizeRatings(rows).ratingAverage).toBe(4.3);
  });
});

describe('serializeReview', () => {
  it('maps a Prisma review to the storefront shape and drops internal fields', () => {
    const out = serializeReview({
      id: 'r1',
      authorName: 'Maria',
      location: 'Manila',
      rating: 5,
      title: 'Great',
      comment: 'Perfect for my condo.',
      photos: ['https://example.com/a.jpg'],
      isVisible: true,
      source: 'ADMIN',
      verifiedOrderItemId: 'should-not-leak',
      productId: 'p1',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    expect(out).toEqual({
      id: 'r1',
      authorName: 'Maria',
      location: 'Manila',
      rating: 5,
      title: 'Great',
      comment: 'Perfect for my condo.',
      photos: ['https://example.com/a.jpg'],
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(Object.keys(out)).not.toContain('source');
    expect(Object.keys(out)).not.toContain('isVisible');
    expect(Object.keys(out)).not.toContain('verifiedOrderItemId');
  });
});
