export interface CheckoutDraftCustomer {
  name: string; phone: string; province: string; city: string;
  barangay: string; postalCode: string; streetAddress: string; landmark: string;
}
export interface CheckoutDraft {
  customer: CheckoutDraftCustomer;
  savedAt: string;
  /** ISO yyyy-MM-dd（UTC 零点约定，spec §3.2 D-1）；null/缺省 = 未选。订单级数据，故在顶层。 */
  preferredDeliveryDate?: string | null;
}
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
export function writeCheckoutDraft(
  customer: CheckoutDraftCustomer,
  preferredDeliveryDate: string | null = null,
): void {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ customer, preferredDeliveryDate, savedAt: new Date().toISOString() }),
    );
  } catch { /* memory fallback: flow degrades per spec §5.3 */ }
}
export function clearCheckoutDraft(): void {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
