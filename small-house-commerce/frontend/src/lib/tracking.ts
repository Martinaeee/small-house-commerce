import { api } from "./api";
import { hasAdsConsent } from "./consent";

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

const VISIT_SESSION_KEY = "sh:lpvisit";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export const MARKETING_TOUCH_STORAGE_KEY = "sh:marketing-touch";
type StoredTouch = { credential: string; expiresAt: string };
let memoryTouch: StoredTouch | null = null;

function validTouch(value: unknown): StoredTouch | null {
  if (!value || typeof value !== "object") return null;
  const touch = value as Partial<StoredTouch>;
  return typeof touch.credential === "string" && touch.credential.length > 0 && touch.credential.length <= 8192 && typeof touch.expiresAt === "string" && Date.parse(touch.expiresAt) > Date.now()
    ? { credential: touch.credential, expiresAt: touch.expiresAt } : null;
}

function storedTouch(): StoredTouch | null {
  let saved: StoredTouch | null = null;
  try { saved = validTouch(JSON.parse(window.localStorage.getItem(MARKETING_TOUCH_STORAGE_KEY) ?? "null")); } catch {}
  const memory = validTouch(memoryTouch);
  return memory && (!saved || Date.parse(memory.expiresAt) > Date.parse(saved.expiresAt)) ? memory : saved;
}

export function readAttribution(): { marketingCredential?: string } {
  if (typeof window === "undefined") return {};
  const touch = storedTouch();
  return touch ? { marketingCredential: touch.credential } : {};
}

/**
 * The current marketing-touch credential for this browser, or null. Analytics
 * attaches it to every first-party event so the server can resolve which
 * campaign link produced the visit — the same signed credential checkout
 * sends to attribute orders, so both funnels stay on one last-touch contract.
 */
export function currentMarketingCredential(): string | null {
  if (typeof window === "undefined") return null;
  return storedTouch()?.credential ?? null;
}

let memoryVisitKey: string | null = null;
let touchSequence = 0;
let acceptedSequence = 0;

function tabVisitKey(): string {
  if (memoryVisitKey) return memoryVisitKey;
  try {
    const stored = window.sessionStorage.getItem(VISIT_SESSION_KEY);
    if (stored && stored.length <= 128 && /^[A-Za-z0-9_-]+$/.test(stored)) memoryVisitKey = stored;
  } catch {}
  memoryVisitKey ??= Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  try { window.sessionStorage.setItem(VISIT_SESSION_KEY, memoryVisitKey); } catch {}
  return memoryVisitKey;
}

export async function recordMarketingTouch(context: { path: string; search: string; landingPageId?: string }): Promise<void> {
  if (typeof window === "undefined" || context.path === "/admin" || context.path.startsWith("/admin/")) return;
  const params = new URLSearchParams(context.search);
  if (!context.landingPageId && !params.has("cl") && !params.has("aid")) return;
  const sequence = ++touchSequence;
  const input: Parameters<typeof api.marketingTouch>[0] = { path: context.path, visitKey: tabVisitKey(), ...(context.landingPageId ? { landingPageId: context.landingPageId } : {}) };
  if (params.has("cl")) input.code = params.get("cl")!;
  else if (params.has("aid")) {
    input.aid = params.get("aid")!;
    input.adId = params.get("ad_id") ?? params.get("adid");
    for (const [field, key] of [["campaignId", "campaign_id"], ["adsetId", "adset_id"], ["utmSource", "utm_source"], ["utmMedium", "utm_medium"], ["utmCampaign", "utm_campaign"], ["utmContent", "utm_content"], ["utmTerm", "utm_term"]] as const) input[field] = params.get(key);
  }
  try {
    const result = validTouch(await api.marketingTouch(input));
    if (!result) return;
    const previous = storedTouch();
    if (previous && (Date.parse(previous.expiresAt) > Date.parse(result.expiresAt) || (previous.expiresAt === result.expiresAt && sequence < acceptedSequence))) return;
    memoryTouch = result; acceptedSequence = sequence;
    try { window.localStorage.setItem(MARKETING_TOUCH_STORAGE_KEY, JSON.stringify(result)); } catch {}
  } catch {}
}


/** The command object fbevents.js expects to find on `window._fbq`. */
type FbqCommand = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  push: FbqCommand;
  loaded: boolean;
  version: string;
  queue: unknown[][];
};

/** Extra Pixel arguments. `eventID` is how Meta dedupes Pixel vs CAPI. */
export type MetaTrackOptions = { eventID?: string };

/** Loads the Meta Pixel base script once. Safe to call on every page. */
export function initMetaPixel(): void {
  if (typeof window === "undefined" || !PIXEL_ID || window.fbq) return;
  // Optional advertising measurement runs only after an explicit opt-in.
  if (!hasAdsConsent()) return;

  // This mirrors the official snippet exactly. The loader replays `_fbq.queue`
  // and reads `version`/`loaded`; handing it a bare array (or a function
  // without those properties) makes fbevents.js throw and no event is ever
  // sent.
  function fbq(...args: unknown[]): void {
    const self = fbq as unknown as FbqCommand;
    if (self.callMethod) self.callMethod(...args);
    else self.queue.push(args);
  }
  const command = fbq as unknown as FbqCommand;
  command.push = command;
  command.loaded = true;
  command.version = "2.0";
  command.queue = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fbq = command;
  if (!w._fbq) w._fbq = command;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  w.fbq("init", PIXEL_ID);
  w.fbq("track", "PageView");
}

/**
 * Fires a Meta Pixel event when a pixel id is configured and ads consent was
 * granted; no-op otherwise.
 *
 * The bootstrap is ensured first: React runs child effects before the layout's
 * MetaPixelInit, so a product page can emit ViewContent before the pixel
 * exists. The stub queues the command and fbevents.js replays it on load.
 */
export function track(
  event: string,
  data?: Record<string, unknown>,
  options?: MetaTrackOptions,
): void {
  if (typeof window === "undefined" || !PIXEL_ID || !hasAdsConsent()) return;
  initMetaPixel();
  if (options) window.fbq?.("track", event, data, options);
  else window.fbq?.("track", event, data);
}

/** Fires a custom Meta Pixel event (homepage funnel), same guards as track(). */
export function trackCustom(
  event: string,
  data?: Record<string, unknown>,
  options?: MetaTrackOptions,
): void {
  if (typeof window === "undefined" || !PIXEL_ID || !hasAdsConsent()) return;
  initMetaPixel();
  if (options) window.fbq?.("trackCustom", event, data, options);
  else window.fbq?.("trackCustom", event, data);
}
