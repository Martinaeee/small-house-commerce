/**
 * Meta Pixel + attribution helpers (TRACKING_SPEC §4-§5, §12).
 *
 * The pixel is a no-op without NEXT_PUBLIC_META_PIXEL_ID, so local
 * development never loads Facebook scripts. Attribution parameters are
 * always read from the URL (aid, fbclid, utm_*, campaign/adset/ad ids) so
 * orders carry them to the backend snapshot (§5: every order preserves AID).
 */

export type Attribution = {
  sourceType?: string;
  aid?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  landingPageId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

/** Last-visited landing page wins; read back at checkout (TRACKING: sh:lp). */
export const LANDING_PAGE_STORAGE_KEY = "sh:lp";
/** One UUID per browser tab session, reused for every LP beacon in the tab. */
export const LANDING_VISIT_SESSION_KEY = "sh:lpvisit";

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
    landingPageId: window.localStorage.getItem(LANDING_PAGE_STORAGE_KEY) ?? null,
  };
}

/** Called by the LP view tracker: this LP gets attribution until another is visited. */
export function persistLandingPage(landingPageId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANDING_PAGE_STORAGE_KEY, landingPageId);
}

/** Loads the Meta Pixel base script once. Safe to call on every page. */
export function initMetaPixel(): void {
  if (typeof window === "undefined" || !PIXEL_ID || window.fbq) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w._fbq = w._fbq || [];
  w.fbq = (...args: unknown[]) => {
    w._fbq.push(args);
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

/** Fires a custom Meta Pixel event (homepage funnel), same no-op guards as track(). */
export function trackCustom(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !PIXEL_ID || !window.fbq) return;
  window.fbq("trackCustom", event, data);
}
