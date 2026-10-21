"use client";

/**
 * Channel between the storefront offer and the checkout surfaces.
 *
 * Two events travel over it:
 * - "open": the shopper taps the offer line, so the subscribe popup opens on
 *   demand instead of waiting for the first-visit timer.
 * - "code": a subscription just revealed a promo code, so an open promo field
 *   can put it on the running total.
 *
 * The code is kept in localStorage because the shopper may subscribe on the
 * product page and only reach the checkout on the next page load.
 */

const CODE_KEY = "luwag_newsletter_promo_code";

type CodeListener = (code: string) => void;
type OpenListener = () => void;

const codeListeners = new Set<CodeListener>();
const openListeners = new Set<OpenListener>();

/** Asks the subscribe popup to open now. */
export function requestNewsletterOffer(): void {
  openListeners.forEach((listener) => listener());
}

export function onNewsletterOfferRequest(listener: OpenListener): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

/** Records a revealed code and hands it to every open promo field. */
export function grantNewsletterCode(code: string | null): void {
  const trimmed = (code ?? "").trim();
  if (trimmed === "") return;
  try {
    window.localStorage.setItem(CODE_KEY, trimmed);
  } catch {
    // Private mode: the code still reaches the open fields in this page.
  }
  codeListeners.forEach((listener) => listener(trimmed));
}

export function onNewsletterCodeGranted(listener: CodeListener): () => void {
  codeListeners.add(listener);
  return () => {
    codeListeners.delete(listener);
  };
}

/** The code a previous subscription revealed, if this browser still has it. */
export function readStoredNewsletterCode(): string | null {
  try {
    return window.localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

/** Forgets the granted code once it has been spent on an order. */
export function clearStoredNewsletterCode(): void {
  try {
    window.localStorage.removeItem(CODE_KEY);
  } catch {
    // Nothing to clear.
  }
}
