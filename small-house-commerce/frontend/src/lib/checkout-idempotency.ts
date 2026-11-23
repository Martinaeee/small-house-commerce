const STORAGE_PREFIX = "luwag_checkout_idem:";
// Must match the backend's checkoutSchema.idempotencyKey validation.
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;

export interface CheckoutIdempotencyAttempt {
  key: string;
  /** Ads consent captured when this checkout attempt first submitted. */
  metaConsent: boolean;
}

/**
 * One attempt per checkout scope, reused across retries and reloads. The
 * backend answers a replay with the original order instead of creating a
 * second one, so every request under the same key must also carry the same
 * submit-time consent snapshot. Otherwise a lost response followed by a
 * consent change could make the browser Purchase disagree with the CAPI
 * copy created by the first request.
 *
 * The scope is the checkout URL (items / buy-now selection): a new cart gets
 * a new attempt, while reloading or retrying the same checkout keeps it.
 */
export function checkoutIdempotencyAttempt(
  scope: string,
  currentMetaConsent: boolean,
): CheckoutIdempotencyAttempt {
  const storageKey = `${STORAGE_PREFIX}${scope}`;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(storageKey);
  } catch {
    // Storage can be denied; the caller holds the attempt for this mount.
  }

  if (stored !== null) {
    const parsed = parseStoredAttempt(stored, currentMetaConsent);
    if (parsed !== null) {
      // Builds before the consent snapshot stored a raw key. Upgrade it in
      // place so subsequent reloads keep the consent captured right now.
      if (KEY_PATTERN.test(stored)) persistAttempt(storageKey, parsed);
      return parsed;
    }
  }

  const attempt = { key: newKey(), metaConsent: currentMetaConsent };
  persistAttempt(storageKey, attempt);
  return attempt;
}

function parseStoredAttempt(
  stored: string,
  legacyMetaConsent: boolean,
): CheckoutIdempotencyAttempt | null {
  if (KEY_PATTERN.test(stored)) {
    return { key: stored, metaConsent: legacyMetaConsent };
  }
  try {
    const parsed = JSON.parse(stored) as {
      key?: unknown;
      metaConsent?: unknown;
    };
    if (
      typeof parsed.key === "string" &&
      KEY_PATTERN.test(parsed.key) &&
      typeof parsed.metaConsent === "boolean"
    ) {
      return { key: parsed.key, metaConsent: parsed.metaConsent };
    }
  } catch {
    // Invalid or pre-contract storage is replaced below.
  }
  return null;
}

function persistAttempt(
  storageKey: string,
  attempt: CheckoutIdempotencyAttempt,
): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(attempt));
  } catch {
    // The caller's per-mount ref still covers retries on this page.
  }
}

/**
 * A successful order ends this checkout attempt. Clearing after success means
 * a later purchase from the same Buy Now / Quick COD scope gets a fresh key;
 * failures, timeouts and lost responses never call this, so their retries
 * still replay the original order with the original consent snapshot.
 */
export function clearCheckoutIdempotencyKey(scope: string): void {
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
  } catch {
    // Storage can be denied; there is nothing persisted to clear.
  }
}

/**
 * The order a tab already placed for this checkout scope.
 *
 * F02: the success page must not wait for the cart cleanup, and cleanup may
 * fail. If the shopper navigates back to the same confirmation (its URL still
 * names the un-cleaned items), a new idempotency key would create a second
 * order for the same purchase. This marker is written the moment the server
 * confirms the order, so the confirmation step can re-open the receipt instead
 * of submitting again.
 *
 * Tab-scoped and short-lived; a different checkout URL (new items or a new
 * Buy Now selection) has a different scope and is unaffected.
 */
const COMPLETED_PREFIX = "luwag_checkout_completed:";
export const COMPLETED_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export interface CompletedCheckout {
  orderNumber: string;
  placedAt: number;
}

export function recordCompletedCheckout(
  scope: string,
  orderNumber: string,
  now: number = Date.now(),
): void {
  try {
    window.sessionStorage.setItem(
      `${COMPLETED_PREFIX}${scope}`,
      JSON.stringify({ orderNumber, placedAt: now } satisfies CompletedCheckout),
    );
  } catch {
    // Storage denied: the in-memory idempotency ref still protects this mount.
  }
}

export function findCompletedCheckout(
  scope: string,
  now: number = Date.now(),
): CompletedCheckout | null {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(`${COMPLETED_PREFIX}${scope}`);
  } catch {
    return null;
  }
  if (stored === null) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<CompletedCheckout>;
    if (
      typeof parsed.orderNumber !== "string" ||
      parsed.orderNumber.length === 0 ||
      typeof parsed.placedAt !== "number" ||
      now - parsed.placedAt > COMPLETED_CHECKOUT_TTL_MS
    ) {
      return null;
    }
    return { orderNumber: parsed.orderNumber, placedAt: parsed.placedAt };
  } catch {
    return null;
  }
}

/**
 * Cleanup managed to empty the cart, so this confirmation URL no longer
 * describes a resubmittable purchase. The next checkout gets its own scope.
 */
export function clearCompletedCheckout(scope: string): void {
  try {
    window.sessionStorage.removeItem(`${COMPLETED_PREFIX}${scope}`);
  } catch {
    // Storage denied; the marker never existed.
  }
}

function newKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Last resort: unique within a tab, which is all the server needs to match
  // retries. The key is not a secret. The random suffix is padded so the key
  // always clears the backend's 16-character minimum.
  return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;
}
