/**
 * The contact the shopper gave us for restock alerts.
 *
 * The storefront has no customer account, so the only way to know how to
 * reach a returning shopper is to remember what they typed the first time.
 * It lives in this browser only and is reused by every later alert, which is
 * what makes the second click a single click.
 */
export interface RestockContact {
  email: string;
  phone: string | null;
}

const STORAGE_KEY = "luwag_restock_contact";

/**
 * Keeps the digits and a leading + so the number can be dialled or messaged
 * as typed. Returns null for anything that does not look like a number.
 */
export function normalizeContactPhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function readRestockContact(): RestockContact | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const email = (parsed as { email?: unknown }).email;
    if (typeof email !== "string" || email.trim() === "") return null;
    const phone = (parsed as { phone?: unknown }).phone;
    return {
      email: email.trim(),
      phone: typeof phone === "string" && phone.trim() !== "" ? phone.trim() : null,
    };
  } catch {
    // A corrupt or blocked storage must never break the page.
    return null;
  }
}

export function writeRestockContact(contact: RestockContact): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        email: contact.email.trim(),
        phone: contact.phone?.trim() ?? null,
      }),
    );
  } catch {
    // Private mode or a full quota: the alert still works, we just ask again
    // next time.
  }
}

/**
 * Registers the restock alert for one exact SKU.
 *
 * Throws when the alert could not be saved, so the caller can tell the
 * shopper the truth instead of promising an email that will not arrive.
 */
export async function subscribeToRestockAlert(input: {
  skuId: string;
  email: string;
  phone?: string | null;
}): Promise<void> {
  const phone = input.phone ? normalizeContactPhone(input.phone) : null;
  const response = await fetch("/api/v1/storefront/back-in-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim(),
      skuId: input.skuId,
      ...(phone ? { phone } : {}),
    }),
  });
  if (!response.ok) throw new Error(String(response.status));
}
