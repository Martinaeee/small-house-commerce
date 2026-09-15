// src/components/product/ReviewSection.tsx
import type { Product } from "@/lib/api";
import { RatingStars } from "./RatingStars";
import { ReviewCard } from "./ReviewCard";

/** PDP_SPEC §22. Read-only in V1: admin-authored reviews, no write form. */
export function ReviewSection({ product }: { product: Product }) {
  const reviews = product.reviews ?? [];
  const count = product.reviewCount ?? 0;
  const average = product.ratingAverage;

  return (
    <section id="reviews" className="scroll-mt-28 rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-2xl font-semibold text-ink">Customer Reviews</h2>

      {count === 0 || average === null ? (
        <p className="text-sm text-ink-muted">No reviews yet</p>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <RatingStars value={average} className="text-lg" />
            <span className="text-sm font-semibold text-ink">{average.toFixed(1)}</span>
            <span className="text-sm text-ink-secondary">· {count} {count === 1 ? "review" : "reviews"}</span>
          </div>

          <ul className="flex flex-col gap-6">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
