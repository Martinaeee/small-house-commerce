/**
 * Server-side copy of consented commerce events (Meta Conversions API bridge).
 *
 * The browser Pixel and the backend CAPI share one `event_id` per occurrence,
 * so Meta records an event once. Purchase is intentionally absent here: the
 * backend enqueues it in a durable outbox at order creation, keyed by the
 * order number, and the browser's success-page Pixel event carries the same
 * `purchase-<orderNumber>` id.
 *
 * Nothing is sent unless the visitor accepted optional cookies; the backend
 * refuses unconsented payloads as well.
 */

import { hasAdsConsent } from "./consent";

const ENDPOINT = "/api/v1/storefront/meta-events";
const FBP_COOKIE = "_fbp";
const FBC_COOKIE = "_fbc";
const FB_COOKIE_PATTERN = /^fb\.\d+\.\d+\.[\w.-]+$/;
const FBC_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) return entry.slice(prefix.length) || null;
  }
  return null;
}

function metaCookie(value: string | null, maxLength: number): string | null {
  if (!value || value.length > maxLength) return null;
  return FB_COOKIE_PATTERN.test(value) ? value : null;
}

/**
 * Meta's click id cookie may not exist yet when consent is granted after the
 * ad click (the Pixel only starts after the choice). Reconstructing it from
 * the landing URL keeps ad-click attribution intact for this visit.
 */
function ensureFbcFromLanding(): string | null {
  if (typeof window === "undefined") return null;
  const existing = metaCookie(readCookie(FBC_COOKIE), 300);
  if (existing) return existing;
  const fbclid = new URLSearchParams(window.location.search).get("fbclid");
  if (!fbclid || !/^[A-Za-z0-9_-]{8,512}$/.test(fbclid)) return null;
  const value = `fb.1.${Date.now()}.${fbclid}`;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${FBC_COOKIE}=${value}; path=/; max-age=${FBC_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  return value;
}

export interface MetaBrowserIds {
  fbp: string | null;
  fbc: string | null;
}

export function readMetaBrowserIds(): MetaBrowserIds {
  return {
    fbp: metaCookie(readCookie(FBP_COOKIE), 200),
    fbc: metaCookie(readCookie(FBC_COOKIE), 300),
  };
}

export interface ServerEventInput {
  name: string;
  eventId: string;
  data: Record<string, unknown>;
}

/** Fire-and-forget mirror to the backend; failures stay invisible. */
export function sendMetaServerEvent(input: ServerEventInput): void {
  if (typeof window === "undefined" || !hasAdsConsent()) return;
  try {
    const ids = readMetaBrowserIds();
    const fbc = ids.fbc ?? ensureFbcFromLanding();
    const body = JSON.stringify({
      name: input.name,
      eventId: input.eventId,
      customData: input.data,
      eventSourceUrl: window.location.href.slice(0, 1024),
      fbp: ids.fbp,
      fbc,
      consent: true,
    });
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // The Pixel event already fired; the mirror is best effort.
    });
  } catch {
    // Never surface measurement failures to the shopper.
  }
}
