/**
 * Meta Pixel + attribution helpers (TRACKING_SPEC §4-§5, §12).
 *
 * The pixel is a no-op without NEXT_PUBLIC_META_PIXEL_ID, so local
 * development never loads Facebook scripts. Attribution parameters are
 * always read from the URL (aid, fbclid, utm_*, campaign/adset/ad ids) so
 * orders carry them to the backend snapshot (§5: every order preserves AID).
 */

type Attribution = {
  sourceType?: string;
  aid?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/** Reads attribution parameters from the current URL. */
export function readAttribution(): Attribution {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);

  // §5 AID source: ?aid=xxxx, optionally ?adid= (Facebook post ad id).
  const aid = params.get("aid") ?? undefined;
  const postAdId = params.get("adid");

  return {
    aid: aid ?? null,
    campaignId: params.get("campaign_id") ?? null,
    adsetId: params.get("adset_id") ?? null,
    adId: params.get("ad_id") ?? postAdId ?? null,
    utmSource: params.get("utm_source") ?? null,
    utmMedium: params.get("utm_medium") ?? null,
    utmCampaign: params.get("utm_campaign") ?? null,
  };
}

/** Loads the Meta Pixel base script once. Safe to call on every page. */
export function initMetaPixel(): void {
  if (typeof window === "undefined" || !PIXEL_ID || window.fbq) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w._fbq = w._fbq || [];
  w.fbq = function fbq() {
    w._fbq.push(arguments);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  w.fbq("init", PIXEL_ID);
  w.fbq("track", "PageView");
}

/** Fires a Meta Pixel event when a pixel id is configured; no-op otherwise. */
export function track(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !PIXEL_ID || !window.fbq) return;
  window.fbq("track", event, data);
}
