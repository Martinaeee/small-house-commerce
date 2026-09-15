/**
 * LUWAG wordmark — Brand Foundation §4 direction C (pure wordmark):
 * lowercase, semibold, unusually generous letter-spacing; the spacing
 * itself is the joke — the name looks maluwag (roomy). Deep-brown cta
 * token; deliberately no house/spoon/ladle iconography (§4 hard no's).
 *
 * The wordmark may stand alone visually in chrome (header, drawer,
 * footer), but every landing/profile context pairs it with an English
 * descriptor sentence nearby (§3 risk rule, Cebuano "ladle" ambiguity).
 * The negative margin cancels the trailing letter-spacing so the glyphs
 * stay optically centered; it scales with font-size because both use em.
 */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="LUWAG"
      className={`me-[-0.42em] inline-block font-sans text-base font-semibold lowercase leading-none tracking-[0.42em] text-cta ${className}`}
    >
      luwag
    </span>
  );
}
