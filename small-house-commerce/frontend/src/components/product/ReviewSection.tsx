// src/components/product/ReviewSection.tsx
import type { Product } from "@/lib/api";
import { RatingStars } from "./RatingStars";

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
              <li key={review.id} className="border-b border-border pb-6 last:border-0 last:pb-0">
                <div className="mb-1 flex items-center gap-2">
                  <RatingStars value={review.rating} className="text-sm" />
                  {review.title && (
                    <span className="text-sm font-semibold text-ink">{review.title}</span>
                  )}
                </div>
                <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                  {review.comment}
                </p>
                {review.photos.length > 0 && (
                  <div className="mb-2 flex gap-2">
                    {review.photos.map((photo) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={photo}
                        src={photo}
                        alt="Customer review"
                        className="h-16 w-16 rounded-md border border-border object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  {review.authorName}
                  {review.location ? `, ${review.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
