export const CHECKOUT_AUTOSAVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_KEY = "luwag_checkout_attempt_v1";
const DATA_KEY = "luwag_checkout_autosave_v1";
export const CHECKOUT_DRAFT_HEADER = "x-checkout-draft-token";

export type CheckoutAutosaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "unavailable"
  | "expired"
  | "converted";

export interface CheckoutAutosaveSnapshot {
  customer: {
    name: string;
    phone: string;
    province: string;
    city: string;
    barangay: string;
    postalCode: string;
    streetAddress: string;
    landmark: string;
  };
  items: { skuId: string; quantity: number }[];
  preferredDeliveryDate: string | null;
  promoCodeInput: string;
  promoCodeApplied: string | null;
  customerNote: string;
}

export interface CheckoutAttempt {
  token: string;
  key: string;
  createdAt: number;
}

interface StoredAutosave {
  token: string;
  revision: number;
  snapshot: CheckoutAutosaveSnapshot;
  savedAt: number;
}

export function checkoutAttemptKey(input: {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}): string {
  if (input.skuId) return `buy:${input.skuId}:${input.qty ?? "1"}:${input.slug ?? ""}`;
  if (input.itemsParam) {
    const ids = Array.from(
      new Set(
        input.itemsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ).sort();
    return ids.length === 0 ? "cart:all" : `cart:${ids.join(",")}`;
  }
  return "cart:all";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createCheckoutDraftToken(now: number = Date.now()): string {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return `${now.toString(36)}.${base64Url(random)}`;
}

export function tokenCreatedAt(token: string): number | null {
  const [time] = token.split(".");
  const ms = Number.parseInt(time ?? "", 36);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

export function resolveCheckoutAttempt(
  key: string,
  now: number = Date.now(),
): CheckoutAttempt {
  const stored = readAttempts().find((attempt) => attempt.key === key);
  if (
    stored &&
    now >= stored.createdAt &&
    now - stored.createdAt < CHECKOUT_AUTOSAVE_MAX_AGE_MS
  ) {
    return stored;
  }
  const attempt = { token: createCheckoutDraftToken(now), key, createdAt: now };
  try {
    const others = readAttempts().filter(
      (entry) => entry.key !== key && now - entry.createdAt < CHECKOUT_AUTOSAVE_MAX_AGE_MS,
    );
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify([...others, attempt]));
  } catch {
    /* storage disabled: the mounted checkout still has its token */
  }
  return attempt;
}

function readAttempts(): CheckoutAttempt[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? "null");
    // Keep the original single-entry format readable across a release.
    return (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter(
      (entry): entry is CheckoutAttempt =>
        entry && typeof entry.token === "string" && typeof entry.key === "string" &&
        Number.isFinite(entry.createdAt),
    );
  } catch {
    return [];
  }
}

function readAutosaves(): StoredAutosave[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DATA_KEY) ?? "null");
    return (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter(
      (entry): entry is StoredAutosave =>
        entry && typeof entry.token === "string" && entry.snapshot &&
        Number.isInteger(entry.revision) &&
        Date.now() - entry.savedAt < CHECKOUT_AUTOSAVE_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

export function readAutosave(
  attempt: CheckoutAttempt,
): { revision: number; snapshot: CheckoutAutosaveSnapshot } | null {
  const stored = readAutosaves().find((entry) => entry.token === attempt.token);
  return stored ? { revision: stored.revision, snapshot: stored.snapshot } : null;
}

export function readAutosaveRevision(attempt: CheckoutAttempt): number {
  return readAutosave(attempt)?.revision ?? 0;
}

export function writeAutosave(
  attempt: CheckoutAttempt,
  revision: number,
  snapshot: CheckoutAutosaveSnapshot,
): void {
  try {
    const stored: StoredAutosave = {
      token: attempt.token,
      revision,
      snapshot,
      savedAt: Date.now(),
    };
    const others = readAutosaves().filter((entry) => entry.token !== attempt.token);
    localStorage.setItem(DATA_KEY, JSON.stringify([...others, stored]));
  } catch {
    /* storage disabled: the form keeps working */
  }
}

export function clearAutosave(attempt?: CheckoutAttempt): void {
  try {
    const data = readAutosaves().filter((entry) => attempt && entry.token !== attempt.token);
    const attempts = readAttempts().filter((entry) => attempt && entry.token !== attempt.token);
    if (data.length) localStorage.setItem(DATA_KEY, JSON.stringify(data));
    else localStorage.removeItem(DATA_KEY);
    if (attempts.length) localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempts));
    else localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* ignore */
  }
}

/** Restore local first, then prefer the server revision when it is newer. */
export async function restoreCheckoutDraft(
  key: string,
  now: number = Date.now(),
): Promise<CheckoutAutosaveSnapshot | null> {
  const attempt = resolveCheckoutAttempt(key, now);
  if (now - attempt.createdAt >= CHECKOUT_AUTOSAVE_MAX_AGE_MS) {
    clearAutosave(attempt);
    return null;
  }
  const local = readAutosave(attempt);
  try {
    const res = await fetch("/api/v1/storefront/checkout-drafts/current", {
      headers: { [CHECKOUT_DRAFT_HEADER]: attempt.token },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        revision: number;
        snapshot: CheckoutAutosaveSnapshot;
      };
      // Another tab or a shopper edit can advance storage while GET is in
      // flight. Compare with the current copy, not just the pre-request one.
      const latest = readAutosave(attempt) ?? local;
      if (!latest || body.revision >= latest.revision) {
        writeAutosave(attempt, body.revision, body.snapshot);
        return body.snapshot;
      }
      return latest.snapshot;
    }
  } catch {
    /* offline: local copy still restores */
  }
  return (readAutosave(attempt) ?? local)?.snapshot ?? null;
}

export function readCheckoutAttemptToken(key: string): string | null {
  const stored = readAttempts().find((entry) => entry.key === key);
  if (!stored) return null;
  if (Date.now() - stored.createdAt >= CHECKOUT_AUTOSAVE_MAX_AGE_MS) return null;
  return stored.token;
}

export interface CheckoutAutosaveForm {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
  preferredDeliveryDate: string;
  notes: string;
}

export function buildCheckoutSnapshot(
  form: CheckoutAutosaveForm,
  items: { skuId: string; quantity: number }[],
  promo: { input: string; applied: string | null },
): CheckoutAutosaveSnapshot {
  return {
    customer: {
      name: form.name.slice(0, 120),
      phone: form.phone.slice(0, 24),
      province: form.province.slice(0, 120),
      city: form.city.slice(0, 120),
      barangay: form.barangay.slice(0, 120),
      postalCode: form.postalCode.slice(0, 20),
      streetAddress: form.streetAddress.slice(0, 255),
      landmark: form.landmark.slice(0, 255),
    },
    items: items.slice(0, 100).map((item) => ({
      skuId: item.skuId,
      quantity: item.quantity,
    })),
    preferredDeliveryDate: form.preferredDeliveryDate.trim() || null,
    promoCodeInput: promo.input.slice(0, 32),
    promoCodeApplied: promo.applied
      ? promo.applied.slice(0, 32).toUpperCase()
      : null,
    customerNote: form.notes.slice(0, 200),
  };
}

export interface CheckoutRestoredFormState extends CheckoutAutosaveForm {
  promoCodeInput: string;
  promoCodeApplied: string | null;
}

/** Maps a saved draft back to the form; a missing date stays empty. */
export function restoredFormState(
  snapshot: CheckoutAutosaveSnapshot,
): CheckoutRestoredFormState {
  return {
    ...snapshot.customer,
    preferredDeliveryDate: snapshot.preferredDeliveryDate ?? "",
    notes: snapshot.customerNote,
    promoCodeInput: snapshot.promoCodeInput,
    promoCodeApplied: snapshot.promoCodeApplied,
  };
}

export function autosaveStatusLabel(status: CheckoutAutosaveStatus): string {
  if (status === "saving") return "Saving your details…";
  if (status === "saved")
    return "Your details are saved. You can come back to this checkout.";
  if (status === "offline") {
    return "We could not save to the shop yet. Your details stay on this device and will retry.";
  }
  if (status === "conflict")
    return "This checkout was updated in another tab. Your changes stay on this device; review before continuing.";
  if (status === "unavailable")
    return "We could not save to the shop. Your changes stay on this device; you can still continue checkout.";
  if (status === "expired")
    return "This saved checkout has expired. Please continue with a new one.";
  if (status === "converted") return "This checkout was already placed.";
  return "Your details are saved as you type.";
}
