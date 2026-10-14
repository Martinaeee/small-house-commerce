import { describe, expect, it } from "vitest";
import type { AdminFaqCategory, AdminFaqItem } from "@/lib/admin-api";
import { moveFaqItemWithinCategory } from "./faq-view";

function faqItem(
  id: string,
  category: AdminFaqCategory,
  position: number,
): AdminFaqItem {
  return {
    id,
    title: id,
    answer: [{ kind: "paragraph", text: `${id} answer` }],
    enabled: true,
    position,
    defaultOpen: false,
    category,
  };
}

const shippingA = faqItem("shipping-a", "DELIVERY", 0);
const paymentB = faqItem("payment-b", "PAYMENT_COD", 1);
const shippingC = faqItem("shipping-c", "DELIVERY", 2);

describe("moveFaqItemWithinCategory", () => {
  it("swaps adjacent siblings in one category without scrambling another category", () => {
    const next = moveFaqItemWithinCategory(
      [shippingA, paymentB, shippingC],
      shippingC.id,
      -1,
    );

    expect(next.map((item) => item.id)).toEqual([
      shippingC.id,
      paymentB.id,
      shippingA.id,
    ]);
    expect(next.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it("keeps the original order at the first and last category boundaries", () => {
    const items = [shippingA, paymentB, shippingC];

    expect(moveFaqItemWithinCategory(items, shippingA.id, -1)).toBe(items);
    expect(moveFaqItemWithinCategory(items, shippingC.id, 1)).toBe(items);
    expect(items.map((item) => item.id)).toEqual([
      shippingA.id,
      paymentB.id,
      shippingC.id,
    ]);
  });

  it("keeps the original order when the item does not exist", () => {
    const items = [shippingA, paymentB, shippingC];

    expect(moveFaqItemWithinCategory(items, "missing", 1)).toBe(items);
  });
});
