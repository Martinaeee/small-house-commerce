import { api } from "./api";

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
