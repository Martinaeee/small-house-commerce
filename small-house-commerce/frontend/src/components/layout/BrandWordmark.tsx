import { poppins } from "@/lib/fonts";

/**
 * LUWAG lockup — Brand Foundation §4 direction A (expanding-room tile,
 * also the favicon) paired with the §4-C lowercase wordmark.
 *
 * v0 shipped Poppins-600 with 0.42em tracking on the system font stack
 * (the brand face was never actually loaded): at 18px the wide tracking
 * read sparse and cheap. Furniture-house wordmarks (IKEA, MUJI, Nitori)
 * carry a tight bold word with a symbol, so the wordmark is now Poppins
 * 700 with near-zero tracking and the two-square tile that already means
 * "a small space becoming a roomy one". Flush left, no trailing tracking
 * gap. Everything is em-sized so header/footer/drawer size overrides on
 * the parent scale the lockup uniformly. Descriptor copy (footer/hero)
 * supplies the English context required by the §3 Cebuano risk rule.
 */
/**
 * Tone decides the whole lockup, not just the word: the tile is drawn with
 * hard-coded brand fills, and `text-cta` is itself #6B4F3A — on a brown
 * surface (footer) that is brown on brown. Passing a colour class cannot fix
 * it, because Tailwind emits arbitrary values before theme colours, so the
 * override silently loses. One tone → one colour class, deterministically.
 */
const TONES = {
  brand: { word: "text-cta", tile: "#6B4F3A", square: "#C9A77B", stroke: "#FAF8F5" },
  onDark: { word: "text-[#fff8f1]", tile: "#FAF8F5", square: "#C9A77B", stroke: "#6B4F3A" },
} as const;

export function BrandWordmark({
  className = "",
  tone = "brand",
}: {
  className?: string;
  tone?: keyof typeof TONES;
}) {
  const colors = TONES[tone];
  return (
    <span
      aria-label="LUWAG"
      className={`inline-flex items-center gap-[0.4em] text-base leading-none ${colors.word} ${className}`}
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
        <rect x="13.5" y="13.5" width="10.5" height="10.5" rx="1.6" stroke={colors.stroke} strokeWidth="2" />
      </svg>
      <span className={`${poppins.className} font-bold lowercase tracking-[0.02em]`}>
        luwag
      </span>
    </span>
  );
}
