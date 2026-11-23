import { describe, expect, it } from "vitest";
import { createProductSchema, updateProductSchema } from "./product.dto.js";

const base = {
  name: "Chair",
  slug: "chair",
  categoryId: "018f0000-0000-7000-8000-000000000001",
};

describe("detail block scope", () => {  it.each(["optionValueId", "variantId"] as const)(
    "accepts a persisted legacy UUID for %s on create and update",
    (scopeField) => {
      const legacyId = "cdc54a3c-8bfa-832d-e016-d659f5aba8ad";
      const detailBlocks = [
        { type: "IMAGE", url: "https://cdn.test/detail.jpg", [scopeField]: legacyId },
      ];
      expect(createProductSchema.parse({ ...base, detailBlocks }).detailBlocks[0][scopeField]).toBe(legacyId);
      expect(updateProductSchema.parse({ detailBlocks }).detailBlocks![0][scopeField]).toBe(legacyId);
    },
  );

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

  it.each([
    ["accepts a carousel group key", "launch-day-组-1", true],
    ["rejects an overlong carousel group key", "g".repeat(65), false],
  ] as const)("create: %s", (_name, groupKey, ok) => {
    const payload = {
      ...base,
      detailBlocks: [
        { type: "IMAGE", url: "https://cdn.test/detail.jpg", groupKey },
      ],
    };
    if (!ok) {
      expect(() => createProductSchema.parse(payload)).toThrow();
      return;
    }
    expect(createProductSchema.parse(payload).detailBlocks[0].groupKey).toBe(groupKey);
  });

  it("update: keeps a carousel group key and drops it when omitted", () => {
    const parsed = updateProductSchema.parse({
      detailBlocks: [
        { type: "IMAGE", url: "https://cdn.test/detail.jpg", groupKey: "summer-set" },
        { type: "IMAGE", url: "https://cdn.test/single.jpg" },
      ],
    });
    expect(parsed.detailBlocks![0].groupKey).toBe("summer-set");
    expect(parsed.detailBlocks![1].groupKey).toBeUndefined();
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

describe("Why You’ll Love It block visibility", () => {
  it("accepts the block switch on create and update", () => {
    expect(
      createProductSchema.parse({ ...base, highlightsVisible: false }).highlightsVisible,
    ).toBe(false);
    expect(updateProductSchema.parse({ highlightsVisible: true }).highlightsVisible).toBe(
      true,
    );
  });

  it("leaves the switch undefined when the payload omits it", () => {
    expect(createProductSchema.parse(base).highlightsVisible).toBeUndefined();
    expect(updateProductSchema.parse({ name: "Chair" }).highlightsVisible).toBeUndefined();
  });
});
