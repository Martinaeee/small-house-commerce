export const CHECKOUT_AUTOSAVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_KEY = "luwag_checkout_attempt_v1";
const DATA_KEY = "luwag_checkout_autosave_v1";
export const CHECKOUT_DRAFT_HEADER = "x-checkout-draft-token";

export type CheckoutAutosaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "offline"
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
  const stored = readAttempt();
  if (
    stored &&
    stored.key === key &&
    now - stored.createdAt < CHECKOUT_AUTOSAVE_MAX_AGE_MS
  ) {
    return stored;
  }
  const attempt = { token: createCheckoutDraftToken(now), key, createdAt: now };
  writeAttempt(attempt);
  return attempt;
}

function readAttempt(): CheckoutAttempt | null {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutAttempt;
    return typeof parsed.token === "string" && typeof parsed.key === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeAttempt(attempt: CheckoutAttempt): void {
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    /* storage disabled: sync degrades, form keeps working */
  }
}

export function readAutosave(
  attempt: CheckoutAttempt,
): { revision: number; snapshot: CheckoutAutosaveSnapshot } | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAutosave;
    if (parsed.token !== attempt.token || !parsed.snapshot) return null;
    return { revision: parsed.revision, snapshot: parsed.snapshot };
  } catch {
    return null;
  }
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
    localStorage.setItem(DATA_KEY, JSON.stringify(stored));
  } catch {
    /* see writeAttempt */
  }
}

export function clearAutosave(attempt?: CheckoutAttempt): void {
  try {
    localStorage.removeItem(DATA_KEY);
    const stored = readAttempt();
    if (!attempt || !stored || stored.token === attempt.token) {
      localStorage.removeItem(ATTEMPT_KEY);
    }
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
    });
    if (res.ok) {
      const body = (await res.json()) as {
        revision: number;
        snapshot: CheckoutAutosaveSnapshot;
      };
      if (!local || body.revision >= local.revision) {
        writeAutosave(attempt, body.revision, body.snapshot);
        return body.snapshot;
      }
    }
  } catch {
    /* offline: local copy still restores */
  }
  return local?.snapshot ?? null;
}

export function readCheckoutAttemptToken(key: string): string | null {
  const stored = readAttempt();
  if (!stored || stored.key !== key) return null;
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

export function autosaveStatusLabel(status: CheckoutAutosaveStatus): string {
  if (status === "saving") return "Saving your details…";
  if (status === "saved")
    return "Your details are saved. You can come back to this checkout.";
  if (status === "offline") {
    return "We could not save to the shop yet. Your details stay on this device and will retry.";
  }
  if (status === "expired")
    return "This saved checkout has expired. Please continue with a new one.";
  if (status === "converted") return "This checkout was already placed.";
  return "Your details are saved as you type.";
}
