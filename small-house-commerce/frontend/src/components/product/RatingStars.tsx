// src/components/product/RatingStars.tsx
/**
 * Read-only star rating, PDP_SPEC §22. Renders to the nearest half star
 * using text glyphs (no icon dependency). Filled/half stars use the amber
 * star token; empty stars fall back to the border token.
 */
export function RatingStars({ value, className = "" }: { value: number; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  const full = Math.floor(rounded);
  const half = rounded - full === 0.5;
  const stars = Array.from({ length: 5 }, (_, i) => {
    if (i < full) return "★";
    if (i === full && half) return "⯨";
    return "☆";
  });
  return (
    <span
      className={`inline-flex text-star ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
      role="img"
    >
      {stars.map((star, i) => (
        <span key={i} className={star === "☆" ? "text-border" : ""}>
          {star}
        </span>
      ))}
    </span>
  );
}
