import { describe, expect, it } from "vitest";
import type { AdminOrderListRow } from "@/lib/admin-api";
import { buildPackingSlipHtml } from "./packing-slip";

const row = {
  orderNumber: "PH100027",
  customer: {
    name: "Marisol <Reyes>",
    normalizedPhone: "+639171224466",
  },
  shippingAddress: {
    streetAddress: "24-B Kamuning St.",
    barangay: "Kamuning",
    city: "Quezon City",
    province: "Metro Manila",
    postalCode: "1103",
  },
  items: [
    {
      id: "line-1",
      productNameSnapshot: "Foldable Desk",
      skuCodeSnapshot: "SKU-FD-140",
      variantSnapshot: "Walnut",
      quantity: 2,
    },
  ],
} as unknown as AdminOrderListRow;

describe("the local packing slip", () => {
  it("contains the real lines and quantities, not prices or carrier fields", () => {
    const html = buildPackingSlipHtml(row);
    expect(html).toContain("PH100027");
    expect(html).toContain("Foldable Desk");
    expect(html).toContain("SKU-FD-140");
    expect(html).toContain("× 2");
    expect(html).toContain("Internal packing slip");
    expect(html).not.toContain("₱");
    expect(html).not.toContain("Tracking number");
  });

  it("escapes order text instead of injecting it into the print window", () => {
    const html = buildPackingSlipHtml(row);
    expect(html).toContain("Marisol &lt;Reyes&gt;");
    expect(html).not.toContain("Marisol <Reyes>");
  });
});
