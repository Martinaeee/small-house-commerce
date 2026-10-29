/**
 * First-party storefront analytics (dashboard §18).
 *
 * The Meta pixel answers "what did ads do"; this answers "what did people do
 * on the site", and it is what the dashboard's homepage and conversion
 * numbers are built from. Events are batched and sent to
 * `POST /api/v1/storefront/events`.
 *
 * Rules that keep the numbers honest:
 *   - one session id per browser tab (sessionStorage), so a refresh is the
 *     same session and a new tab is a new one;
 *   - impressions are recorded by an IntersectionObserver, not on render, so a
 *     section nobody scrolled to is never counted;
 *   - the server dedupes impressions per session, section and Manila day.
 */

import { currentMarketingCredential } from "./tracking";

export type FirstPartyEventName =
  | "PAGE_VIEW"
  | "PRODUCT_VIEW"
  | "ADD_TO_CART"
  | "BEGIN_CHECKOUT"
  | "PURCHASE"
  | "HOMEPAGE_SECTION_IMPRESSION"
  | "HOMEPAGE_SECTION_CLICK"
  | "SEARCH";

export type DeviceType = "desktop" | "tablet" | "mobile";

export interface FirstPartyEvent {
  eventName: FirstPartyEventName;
  sessionId: string;
  pageUrl: string;
  pagePath: string;
  deviceType: DeviceType;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  entityId?: string | null;
  sectionId?: string | null;
  sectionType?: string | null;
  destination?: string | null;
  productId?: string | null;
  campaignId?: string | null;
  /**
   * The signed marketing-touch credential, attached to every event so the
   * server resolves and stores the campaign link behind the action. Same
   * last-touch credential checkout uses; null budget for organic traffic.
   */
  marketingCredential?: string;
}

const SESSION_KEY = "sh:fsid";
const ENDPOINT = "/api/v1/storefront/events";
const FLUSH_DELAY_MS = 1500;
const MAX_BATCH = 20;

const queue: FirstPartyEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionIdCache: string | null = null;

/** One id per browser tab. Survives reloads, not tab closes. */
export function analyticsSessionId(): string {
  if (sessionIdCache) return sessionIdCache;
  if (typeof window === "undefined") return "server";
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      sessionIdCache = stored;
      return stored;
    }
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    sessionIdCache = created;
    return created;
  } catch {
    // Private mode with storage disabled: fall back to a per-page id.
    const fallback = `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionIdCache = fallback;
    return fallback;
  }
}

export function detectDeviceType(): DeviceType {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia?.("(max-width: 767px)").matches) return "mobile";
  if (window.matchMedia?.("(max-width: 1023px)").matches) return "tablet";
  return "desktop";
}

function utmParams(): { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } {
  if (typeof window === "undefined") {
    return { utmSource: null, utmMedium: null, utmCampaign: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
  };
}

function baseEvent(eventName: FirstPartyEventName): FirstPartyEvent | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  // Admin and preview traffic is not storefront traffic.
  if (path.startsWith("/admin") || path.startsWith("/preview")) return null;
  const credential = currentMarketingCredential();
  return {
    eventName,
    sessionId: analyticsSessionId(),
    pageUrl: window.location.href.slice(0, 1024),
    pagePath: path.slice(0, 512),
    deviceType: detectDeviceType(),
    referrer: document.referrer ? document.referrer.slice(0, 1024) : null,
    ...utmParams(),
    ...(credential ? { marketingCredential: credential } : {}),
  };
}

/** Queues an event; the batch is flushed shortly after. */
export function trackFirstParty(
  eventName: FirstPartyEventName,
  payload: Partial<Omit<FirstPartyEvent, "eventName" | "sessionId">> = {},
): void {
  const base = baseEvent(eventName);
  if (!base) return;
  queue.push({ ...base, ...payload });
  if (queue.length >= MAX_BATCH) {
    flushAnalytics();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAnalytics();
  }, FLUSH_DELAY_MS);
}

export function flushAnalytics(): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ events });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Analytics must never surface an error to the shopper.
    });
  } catch {
    // Ignore transport failures entirely.
  }
}

/** Installs the flush-on-hide hooks. Safe to call more than once. */
let listenersInstalled = false;
export function installAnalyticsFlushHooks(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  const flush = () => flushAnalytics();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
