import { describe, expect, it } from "vitest";
import { createProductSchema } from "./product.dto.js";

const base = {
  name: "Chair",
  slug: "chair",
  categoryId: "018f0000-0000-7000-8000-000000000001",
};

describe("detail block scope", () => {
  it("accepts an option-value scope and leaves the variant scope empty", () => {
    const parsed = createProductSchema.parse({
      ...base,
      detailBlocks: [
        {
          type: "IMAGE",
          url: "https://cdn.test/detail.jpg",
          sortOrder: 0,
          optionValueId: "018f0000-0000-7000-8000-000000000002",
        },
      ],
    });
    expect(parsed.detailBlocks[0].optionValueId).toBe(
      "018f0000-0000-7000-8000-000000000002",
    );
    expect(parsed.detailBlocks[0].variantId).toBeUndefined();
  });

  it("rejects a non-uuid scope id", () => {
    expect(() =>
      createProductSchema.parse({
        ...base,
        detailBlocks: [
          { type: "IMAGE", url: "https://cdn.test/detail.jpg", variantId: "abc" },
        ],
      }),
    ).toThrow();
  });

  it("keeps a shared block shared", () => {
    const parsed = createProductSchema.parse({
      ...base,
      detailBlocks: [{ type: "IMAGE", url: "https://cdn.test/detail.jpg" }],
    });
    expect(parsed.detailBlocks[0]).toMatchObject({ type: "IMAGE" });
    expect(parsed.detailBlocks[0].optionValueId ?? null).toBeNull();
  });
});
