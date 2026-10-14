import { describe, expect, it } from "vitest";
import type {
  AdminFaqCategory,
  AdminFaqItem,
  AdminProductFaq,
} from "@/lib/admin-api";
import {
  copyApplicableSharedItems,
  moveFaqItemWithinCategory,
  resolveAdminFaqPreview,
} from "./faq-view";

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

const productId = "product-1";
const sharedA: AdminFaqItem = {
  ...shippingA,
  id: "shared-a",
  title: "Shared A",
  position: 3,
  audience: { scope: "ALL" },
};
const sharedTargeted: AdminFaqItem = {
  ...shippingA,
  id: "shared-targeted",
  title: "Shared targeted",
  position: 1,
  category: "RETURNS",
  audience: { scope: "PRODUCTS", productIds: [productId, "product-2"] },
};
const sharedForAnotherProduct: AdminFaqItem = {
  ...shippingA,
  id: "shared-other",
  title: "Shared for another product",
  position: 0,
  audience: { scope: "PRODUCTS", productIds: ["product-2", "product-3"] },
};
const sharedDisabled: AdminFaqItem = {
  ...shippingA,
  id: "shared-disabled",
  title: "Shared disabled",
  position: 2,
  enabled: false,
};
const productA: AdminFaqItem = {
  id: "product-a",
  title: "Product A",
  answer: [{ kind: "paragraph", text: "Product answer" }],
  enabled: true,
  position: 4,
  defaultOpen: true,
};
const productDisabled: AdminFaqItem = {
  ...productA,
  id: "product-disabled",
  enabled: false,
  position: 0,
};

function productFaq(mode: AdminProductFaq["mode"]): AdminProductFaq {
  return { mode, items: [productA], version: 2 };
}

describe("resolveAdminFaqPreview", () => {
  it.each([
    ["SHARED", [sharedA.id]],
    ["EXTEND", [sharedA.id, productA.id]],
    ["CUSTOM", [productA.id]],
  ] as const)("resolves %s preview in source order", (mode, ids) => {
    const resolved = resolveAdminFaqPreview(
      [sharedA],
      productFaq(mode),
      productId,
    );

    expect(resolved.map((item) => item.id)).toEqual(ids);
    expect(resolved.map((item) => item.position)).toEqual(
      ids.map((_, position) => position),
    );
  });

  it("filters disabled entries and sorts each source before combining EXTEND", () => {
    const resolved = resolveAdminFaqPreview(
      [sharedA, sharedDisabled, sharedTargeted, sharedForAnotherProduct],
      {
        mode: "EXTEND",
        items: [productA, productDisabled],
        version: 2,
      },
      productId,
    );

    expect(resolved.map((item) => item.id)).toEqual([
      sharedTargeted.id,
      sharedA.id,
      productA.id,
    ]);
    expect(resolved.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it("never applies targeted shared questions to an unknown or different product", () => {
    const shared = [sharedTargeted];

    expect(resolveAdminFaqPreview(shared, productFaq("SHARED"), null)).toEqual(
      [],
    );
    expect(
      resolveAdminFaqPreview(shared, productFaq("SHARED"), "product-9"),
    ).toEqual([]);
    expect(
      resolveAdminFaqPreview(shared, productFaq("SHARED"), productId).map(
        (item) => item.id,
      ),
    ).toEqual([sharedTargeted.id]);
  });
});

describe("copyApplicableSharedItems", () => {
  it("copies only applicable enabled questions as exact product-owned fields", () => {
    const ids = ["copy-1", "copy-2"];
    const copied = copyApplicableSharedItems(
      [sharedA, sharedDisabled, sharedTargeted, sharedForAnotherProduct],
      productId,
      3,
      () => ids.shift()!,
    );

    expect(copied.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: "copy-1", position: 3 },
      { id: "copy-2", position: 4 },
    ]);
    expect(copied.map((item) => item.title)).toEqual([
      sharedTargeted.title,
      sharedA.title,
    ]);
    expect(
      copied.every(
        (item) => !("audience" in item) && !("category" in item),
      ),
    ).toBe(true);
    expect(
      copied.every((item) =>
        Object.keys(item).every((key) =>
          [
            "id",
            "title",
            "answer",
            "enabled",
            "position",
            "defaultOpen",
          ].includes(key),
        ),
      ),
    ).toBe(true);
    expect(copied[0]?.answer).not.toBe(sharedTargeted.answer);
  });

  it("creates independent ids on every explicit copy", () => {
    let sequence = 0;
    const createId = () => `copy-${++sequence}`;

    const first = copyApplicableSharedItems(
      [sharedA, sharedTargeted],
      productId,
      0,
      createId,
    );
    const second = copyApplicableSharedItems(
      [sharedA, sharedTargeted],
      productId,
      first.length,
      createId,
    );

    expect(first.map((item) => item.id)).toEqual(["copy-1", "copy-2"]);
    expect(second.map((item) => item.id)).toEqual(["copy-3", "copy-4"]);
    expect(second.map((item) => item.position)).toEqual([2, 3]);
  });
});
