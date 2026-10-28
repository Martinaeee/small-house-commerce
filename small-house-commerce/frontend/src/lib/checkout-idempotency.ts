const STORAGE_PREFIX = "luwag_checkout_idem:";
// Must match the backend's checkoutSchema.idempotencyKey validation.
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;

/**
 * One key per checkout attempt, reused across retries. The backend answers a
 * replay with the original order instead of creating a second one, so a
 * timeout, a lost response or a double click cannot duplicate an order.
 *
 * The scope is the checkout URL (items / buy-now selection): a new cart gets
 * a new key, while reloading or retrying the same checkout keeps it.
 */
export function checkoutIdempotencyKey(scope: string): string {
  const storageKey = `${STORAGE_PREFIX}${scope}`;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored && KEY_PATTERN.test(stored)) return stored;
  } catch {
    // Storage can be denied; a per-mount key still covers this page's retries.
  }
  const key = newKey();
  try {
    window.sessionStorage.setItem(storageKey, key);
  } catch {
    // Same fallback: the caller holds the key for the life of the page.
  }
  return key;
}

/**
 * A successful order ends this checkout attempt. Clearing after success means
 * a later purchase from the same Buy Now / Quick COD scope gets a fresh key;
 * failures, timeouts and lost responses never call this, so their retries
 * still replay the original order.
 */
export function clearCheckoutIdempotencyKey(scope: string): void {
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
  } catch {
    // Storage can be denied; there is nothing persisted to clear.
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
  // retries. The key is not a secret.
  return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
