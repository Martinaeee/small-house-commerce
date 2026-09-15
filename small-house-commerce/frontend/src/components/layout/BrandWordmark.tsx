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
export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="LUWAG"
      className={`inline-flex items-center gap-[0.4em] text-base leading-none text-cta ${className}`}
    >
      <svg
        width="1.12em"
        height="1.12em"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" fill="#6B4F3A" />
        <rect x="8" y="8" width="9" height="9" fill="#C9A77B" />
        <rect x="13.5" y="13.5" width="10.5" height="10.5" rx="1.6" stroke="#FAF8F5" strokeWidth="2" />
      </svg>
      <span className={`${poppins.className} font-bold lowercase tracking-[0.02em]`}>
        luwag
      </span>
    </span>
  );
}
