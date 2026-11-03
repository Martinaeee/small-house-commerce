import { describe, expect, it } from "vitest";
import {
  autosaveStatusLabel,
  buildCheckoutSnapshot,
  restoredFormState,
  type CheckoutAutosaveForm,
  type CheckoutAutosaveSnapshot,
} from "./checkoutAutosave";

const FORM: CheckoutAutosaveForm = {
  name: "",
  phone: "",
  province: "",
  city: "",
  barangay: "",
  postalCode: "",
  streetAddress: "",
  landmark: "",
  preferredDeliveryDate: "",
  notes: "",
};

const SNAPSHOT: CheckoutAutosaveSnapshot = {
  customer: {
    name: "Ma",
    phone: "0917",
    province: "Bulacan",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
  },
  items: [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 2 }],
  preferredDeliveryDate: null,
  promoCodeInput: "SAVE10",
  promoCodeApplied: null,
  customerNote: "Call first",
};

describe("buildCheckoutSnapshot", () => {
  it("keeps a half-typed phone and an empty name", () => {
    const snapshot = buildCheckoutSnapshot({ ...FORM, name: "Ma", phone: "0917" }, [
      { skuId: "11111111-1111-4111-8111-111111111111", quantity: 2 },
    ], { input: "", applied: null });
    expect(snapshot.customer.name).toBe("Ma");
    expect(snapshot.customer.phone).toBe("0917");
    expect(snapshot.items).toEqual([
      { skuId: "11111111-1111-4111-8111-111111111111", quantity: 2 },
    ]);
  });

  it("turns a blank date into null but keeps an unapplied promo input", () => {
    const snapshot = buildCheckoutSnapshot(
      { ...FORM, preferredDeliveryDate: "  " },
      [],
      { input: "SAVE10", applied: null },
    );
    expect(snapshot.preferredDeliveryDate).toBeNull();
    expect(snapshot.promoCodeInput).toBe("SAVE10");
    expect(snapshot.promoCodeApplied).toBeNull();
  });
});

describe("restoredFormState", () => {
  it("maps an incomplete saved draft back into the form verbatim", () => {
    expect(restoredFormState(SNAPSHOT)).toEqual({
      name: "Ma",
      phone: "0917",
      province: "Bulacan",
      city: "",
      barangay: "",
      postalCode: "",
      streetAddress: "",
      landmark: "",
      preferredDeliveryDate: "",
      notes: "Call first",
      promoCodeInput: "SAVE10",
      promoCodeApplied: null,
    });
  });

  it("leaves a missing date empty so the existing date rules still apply", () => {
    expect(restoredFormState(SNAPSHOT).preferredDeliveryDate).toBe("");
  });
});

describe("autosaveStatusLabel", () => {
  it("never claims the shop saved while offline", () => {
    expect(autosaveStatusLabel("offline")).not.toMatch(/saved\./i);
    expect(autosaveStatusLabel("offline")).toMatch(/retry/i);
  });
});
