/**
 * Cookie consent for optional advertising measurement (Meta Pixel + CAPI).
 *
 * The choice is stored locally and announced through a window event so
 * already-mounted components (the pixel loader, the consent bar) react
 * without a reload. First-party storefront analytics does not depend on it:
 * that trail is anonymous, tab-scoped and ad-free.
 *
 * Read functions never throw: unavailable storage (private mode) falls back
 * to an in-page memory value so the visitor's choice still governs this tab.
 */

export type ConsentChoice = "granted" | "denied";

export const CONSENT_STORAGE_KEY = "luwag:cookie-consent:v1";
export const CONSENT_CHANGED_EVENT = "luwag:consent-changed";
export const CONSENT_OPEN_EVENT = "luwag:consent-open";

let memoryChoice: ConsentChoice | null = null;

export function readConsentChoice(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    // Readable storage is authoritative: another tab may have changed it.
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") return stored;
    return null;
  } catch {
    // Storage unavailable (private mode): the in-page fallback still rules.
    return memoryChoice;
  }
}

/** True only after the visitor explicitly accepted optional cookies. */
export function hasAdsConsent(): boolean {
  return readConsentChoice() === "granted";
}

export function saveConsentChoice(choice: ConsentChoice): void {
  memoryChoice = choice;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    } catch {
      // Memory fallback above keeps the choice valid for this page view.
    }
    window.dispatchEvent(
      new CustomEvent<ConsentChoice>(CONSENT_CHANGED_EVENT, { detail: choice }),
    );
  }
}

export function onConsentChange(
  listener: (choice: ConsentChoice) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const choice = (event as CustomEvent<unknown>).detail;
    if (choice === "granted" || choice === "denied") listener(choice);
  };
  window.addEventListener(CONSENT_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, handler);
}

/** Footer / privacy-page entry point: reopens the choice bar. */
export function openConsentSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

export function onConsentOpen(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CONSENT_OPEN_EVENT, listener);
  return () => window.removeEventListener(CONSENT_OPEN_EVENT, listener);
}
