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
});
