export interface CheckoutDraftCustomer {
  name: string; phone: string; province: string; city: string;
  barangay: string; postalCode: string; streetAddress: string; landmark: string;
}
export interface CheckoutDraftSelection {
  kind: "PDP_INLINE";
  productSlug: string;
  productQuery?: string;
  items: { skuId: string; quantity: number }[];
}
export interface CheckoutDraft {
  customer: CheckoutDraftCustomer;
  savedAt: string;
  /** ISO yyyy-MM-dd（UTC 零点约定，spec §3.2 D-1）；null/缺省 = 未选。订单级数据，故在顶层。 */
  preferredDeliveryDate?: string | null;
  selection?: CheckoutDraftSelection;
}
const DRAFT_KEY = "luwag_checkout_draft";

function isCheckoutDraftSelection(
  value: unknown,
): value is CheckoutDraftSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  if (
    selection.kind !== "PDP_INLINE" ||
    typeof selection.productSlug !== "string" ||
    selection.productSlug.trim() === "" ||
    (selection.productQuery !== undefined &&
      (typeof selection.productQuery !== "string" ||
        (selection.productQuery !== "" &&
          (!selection.productQuery.startsWith("?") ||
            selection.productQuery.includes("#") ||
            selection.productQuery.length > 2048)))) ||
    !Array.isArray(selection.items) ||
    selection.items.length === 0
  ) {
    return false;
  }
  return selection.items.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const line = item as Record<string, unknown>;
    return (
      typeof line.skuId === "string" &&
      line.skuId.trim() !== "" &&
      typeof line.quantity === "number" &&
      Number.isInteger(line.quantity) &&
      line.quantity >= 1 &&
      line.quantity <= 99
    );
  });
}

export function readCheckoutDraft(): CheckoutDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutDraft;
    if (!parsed || typeof parsed.customer !== "object" || parsed.customer === null || Array.isArray(parsed.customer)) return null;
    if (
      parsed.selection !== undefined &&
      !isCheckoutDraftSelection(parsed.selection)
    ) {
      return null;
    }
    return parsed;
  } catch { return null; }
}
export function writeCheckoutDraft(
  customer: CheckoutDraftCustomer,
  preferredDeliveryDate: string | null = null,
  selection?: CheckoutDraftSelection,
): void {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        customer,
        preferredDeliveryDate,
        selection,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch { /* memory fallback: flow degrades per spec §5.3 */ }
}
export function clearCheckoutDraft(): void {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
