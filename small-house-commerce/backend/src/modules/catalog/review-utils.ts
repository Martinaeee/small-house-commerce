// src/modules/catalog/review-utils.ts
/**
 * Pure review aggregation/serialization. Kept free of Nest/Prisma so the
 * rating math is trivially unit-testable.
 */

export interface RatingSummary {
  reviewCount: number;
  /** Mean of visible ratings, rounded to 1 decimal; null when there are none. */
  ratingAverage: number | null;
}

export function summarizeRatings(rows: { rating: number }[]): RatingSummary {
  const reviewCount = rows.length;
  if (reviewCount === 0) return { reviewCount: 0, ratingAverage: null };
  const total = rows.reduce((sum, row) => sum + row.rating, 0);
  // Math.round is half-up: 4.25 -> 4.3. Number.EPSILON offsets binary-double
  // drift that would floor an exact x.x5 boundary (e.g. 4.35 -> 4.3).
  const ratingAverage = Math.round((total / reviewCount) * 10 + Number.EPSILON) / 10;
  return { reviewCount, ratingAverage };
}

export interface StorefrontReviewShape {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: string;
}

type SerializableReview = {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: Date;
};

export function serializeReview(review: SerializableReview): StorefrontReviewShape {
  return {
    id: review.id,
    authorName: review.authorName,
    location: review.location,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    photos: review.photos,
    createdAt: review.createdAt.toISOString(),
  };
}
