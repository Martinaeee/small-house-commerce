import localFont from "next/font/local";

/**
 * Poppins (SIL OFL 1.1), self-hosted latin subset woff2 — the LUWAG
 * brand face per Brand Foundation §4. We ship only the 700 master (~8KB),
 * which is what BrandWordmark uses; body/nav copy stays on the system
 * sans stack (--font-sans) per existing DESIGN_SYSTEM.
 *
 * Self-hosted rather than next/font/google so production image builds never
 * depend on reaching fonts.gstatic.com from the deploy host (the HK VPS
 * reachability was never verified) and the font is on the origin (no
 * third-party requests — consistent with the no-third-party-script until
 * Pixel launch stance). Applied via `poppins.className` on BrandWordmark;
 * the preload is emitted only on routes that render chrome.
 */
export const poppins = localFont({
  src: [{ path: "../styles/fonts/poppins-700-latin.woff2", weight: "700", style: "normal" }],
  display: "swap",
  variable: "--font-poppins",
});

/**
 * Poppins Medium (500), same SIL OFL 1.1 / v24 / latin subset as the 700
 * master above (~7.7KB). The homepage brand-story block sets its display
 * heading in 500 (design v8 `--v8-heading`); 700 would read noticeably
 * heavier against the approved mockup, and the system sans would drop the
 * geometric character entirely.
 *
 * Kept in its own face so the weight is only fetched on pages that render
 * that block (preload: false) — the 700 master stays the preloaded face.
 */
export const poppinsMedium = localFont({
  src: [{ path: "../styles/fonts/poppins-500-latin.woff2", weight: "500", style: "normal" }],
  display: "swap",
  preload: false,
  variable: "--font-poppins-medium",
});

/**
 * Prata (SIL OFL 1.1), self-hosted latin subset woff2 (~4.4KB). The homepage
 * brand-story block sets both its heading and its body in this face to match
 * the approved mockup: a high-contrast Didone-leaning serif whose small
 * x-height (x/cap ≈ 0.65, the mockup's own ratio) and generous set-width are
 * what the geometric Poppins cannot give the section.
 *
 * Single 400 master — Prata ships no other weight. preload stays off: the
 * section sits below the fold and the Poppins masters own the preload budget.
 */
export const storySerif = localFont({
  src: [{ path: "../styles/fonts/prata-400-latin.woff2", weight: "400", style: "normal" }],
  display: "swap",
  preload: false,
  variable: "--font-story-serif",
});
