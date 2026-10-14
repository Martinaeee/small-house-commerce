import { poppins } from "@/lib/fonts";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { BrandAssetImage } from "./BrandAssetImage";

/**
 * Tone decides the generated fallback as one unit. Uploaded derivatives retain
 * their original pixels; this palette only applies when an asset is absent or
 * fails to load.
 */
const TONES = {
  brand: {
    word: "text-cta",
    tile: "var(--color-cta)",
    square: "var(--color-primary)",
    stroke: "var(--color-background)",
  },
  onDark: {
    word: "text-footer-foreground",
    tile: "var(--color-footer-logo-tile)",
    square: "var(--color-footer-logo-square)",
    stroke: "var(--color-footer-logo-stroke)",
  },
} as const;

type BrandWordmarkProps = {
  brand?: PublicStorefrontShell["brand"];
  variant?: "horizontal" | "square";
  decorative?: boolean;
  className?: string;
  /** Retained for the generated Footer fallback on its dark surface. */
  tone?: keyof typeof TONES;
};

function GeneratedBrandWordmark({
  brandName,
  variant,
  decorative,
  className,
  tone,
}: {
  brandName: string;
  variant: "horizontal" | "square";
  decorative: boolean;
  className: string;
  tone: keyof typeof TONES;
}) {
  const colors = TONES[tone];
  return (
    <span
      data-testid={`brand-fallback-${variant}`}
      aria-label={decorative ? undefined : brandName}
      aria-hidden={decorative || undefined}
      className={`inline-flex items-center text-base leading-none ${colors.word} ${
        variant === "horizontal" ? "gap-[0.4em]" : ""
      } ${className}`.trim()}
    >
      <svg
        width="1.12em"
        height="1.12em"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" fill={colors.tile} />
        <rect x="8" y="8" width="9" height="9" fill={colors.square} />
        <rect
          x="13.5"
          y="13.5"
          width="10.5"
          height="10.5"
          rx="1.6"
          stroke={colors.stroke}
          strokeWidth="2"
        />
      </svg>
      {variant === "horizontal" ? (
        <span
          className={`${poppins.className} font-bold lowercase tracking-[0.02em]`}
        >
          luwag
        </span>
      ) : null}
    </span>
  );
}

/**
 * Storefront brand lockup. Desktop Header and Footer request the horizontal
 * derivative; mobile Header requests the square derivative. The current LUWAG
 * generated mark remains the deterministic fallback for missing/broken assets.
 */
export function BrandWordmark({
  brand,
  variant = "horizontal",
  decorative = false,
  className = "",
  tone = "brand",
}: BrandWordmarkProps) {
  const brandName = brand?.brandName ?? "LUWAG";
  const asset =
    variant === "horizontal" ? brand?.horizontalLogo : brand?.squareMark;
  const fallback = (
    <GeneratedBrandWordmark
      brandName={brandName}
      variant={variant}
      decorative={decorative}
      className={className}
      tone={tone}
    />
  );

  if (!asset) return fallback;

  return (
    <BrandAssetImage
      src={asset.url}
      width={asset.width}
      height={asset.height}
      alt={decorative ? "" : brandName}
      className={`${
        variant === "horizontal"
          ? "h-[1.12em] w-auto max-w-[10em]"
          : "h-[1.12em] w-[1.12em]"
      } ${className}`.trim()}
      fallback={fallback}
    />
  );
}
