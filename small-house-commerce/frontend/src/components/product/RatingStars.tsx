// src/components/product/RatingStars.tsx
/**
 * Read-only star rating, PDP_SPEC §22. Renders to the nearest half star
 * using text glyphs (no icon dependency). Filled/half stars use the amber
 * star token; empty stars fall back to the border token.
 */
const HALF_STAR_BACKGROUND =
  "linear-gradient(to right, var(--color-star) 50%, var(--color-border) 50%)";

type StarState = "full" | "half" | "empty";

export function RatingStars({ value, className = "" }: { value: number; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  const full = Math.floor(rounded);
  const half = rounded - full === 0.5;
  const stars: StarState[] = Array.from({ length: 5 }, (_, i) => {
    if (i < full) return "full";
    if (i === full && half) return "half";
    return "empty";
  });

  return (
    <span
      className={`inline-flex text-star ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
      role="img"
    >
      {stars.map((star, i) => (
        <span
          key={i}
          data-rating-star={star}
          className={star === "empty" ? "text-border" : star === "half" ? "inline-block" : ""}
          style={
            star === "half"
              ? {
                  background: HALF_STAR_BACKGROUND,
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }
              : undefined
          }
        >
          {star === "empty" ? "☆" : "★"}
        </span>
      ))}
    </span>
  );
}
