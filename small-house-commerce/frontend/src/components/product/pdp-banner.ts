import type { Product } from "@/lib/api";

/**
 * Resolved PDP promo banner. The admin authors at most one strip per product
 * (or in bulk from the products list); everything here is presentation-only.
 */
export interface PdpBannerStyle {
  text: string;
  background: string;
  textColor: string;
}

/** Campaign red (the site's sale colour) when the editor never picked one. */
export const PDP_BANNER_DEFAULT_BACKGROUND = "var(--color-sale)";
export const PDP_BANNER_DARK_TEXT = "#000000";
export const PDP_BANNER_LIGHT_TEXT = "#ffffff";

/** WCAG relative luminance for a `#rrggbb` value; null for anything else. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map(
    (channel) => {
      const srgb = channel / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    },
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Pick readable text when the editor left the colour empty. */
export function readableTextColor(background: string): string {
  const luminance = relativeLuminance(background);
  if (luminance === null) return PDP_BANNER_LIGHT_TEXT;
  // Choose whichever of black/white has the higher WCAG contrast ratio.
  return luminance > 0.179 ? PDP_BANNER_DARK_TEXT : PDP_BANNER_LIGHT_TEXT;
}

/**
 * The banner is shown only when enabled AND it has copy — an empty enabled
 * banner is a half-finished edit, not a blank strip on the storefront.
 */
export function resolvePdpBanner(
  product: Pick<
    Product,
    "pdpBannerEnabled" | "pdpBannerText" | "pdpBannerBackground" | "pdpBannerTextColor"
  >,
): PdpBannerStyle | null {
  const text = product.pdpBannerText?.trim();
  if (!product.pdpBannerEnabled || !text) return null;
  const background = product.pdpBannerBackground?.trim() || PDP_BANNER_DEFAULT_BACKGROUND;
  const textColor =
    product.pdpBannerTextColor?.trim() || readableTextColor(background);
  return { text, background, textColor };
}
