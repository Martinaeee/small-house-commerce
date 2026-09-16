export interface CheckoutDraftCustomer {
  name: string; phone: string; province: string; city: string;
  barangay: string; postalCode: string; streetAddress: string; landmark: string;
}
export interface CheckoutDraft { customer: CheckoutDraftCustomer; savedAt: string }
const DRAFT_KEY = "luwag_checkout_draft";

export function readCheckoutDraft(): CheckoutDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutDraft;
    if (!parsed || typeof parsed.customer !== "object" || parsed.customer === null || Array.isArray(parsed.customer)) return null;
    return parsed;
  } catch { return null; }
}
export function writeCheckoutDraft(customer: CheckoutDraftCustomer): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, savedAt: new Date().toISOString() }));
  } catch { /* memory fallback: flow degrades per spec §5.3 */ }
}
export function clearCheckoutDraft(): void {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
