import { describe, expect, it } from "vitest";
import {
  canonicalCombinationKey,
  countCandidateCombinations,
  deriveVariantName,
  planVariantReconciliation,
  validateCatalogGraph,
} from "./catalog-graph.js";

describe("catalog graph identity", () => {
  it("keeps identity when option display order changes", () => {
    const pairs = [
      { optionId: "size", valueId: "large" },
      { optionId: "color", valueId: "red" },
    ];
    expect(canonicalCombinationKey(pairs)).toBe("color:red|size:large");
    expect(canonicalCombinationKey([...pairs].reverse())).toBe(
      "color:red|size:large",
    );
  });

  it("does not alias delimiter-containing IDs", () => {
    const embeddedDelimiter = canonicalCombinationKey([
      { optionId: "a", valueId: "b|c:d" },
    ]);
    const separatePairs = canonicalCombinationKey([
      { optionId: "a", valueId: "b" },
      { optionId: "c", valueId: "d" },
    ]);

    expect(embeddedDelimiter).not.toBe(separatePairs);
    expect(embeddedDelimiter).toBe("a:b%7Cc%3Ad");
  });

  it("keeps encoded identities stable when raw pair keys tie", () => {
    const pairs = [
      { optionId: "a:b", valueId: "c" },
      { optionId: "a", valueId: "b:c" },
    ];

    expect(canonicalCombinationKey(pairs)).toBe(
      canonicalCombinationKey([...pairs].reverse()),
    );
  });

  it("uses display position only for the generated name", () => {
    expect(
      deriveVariantName([
        { optionPosition: 1, valueLabel: "Large" },
        { optionPosition: 0, valueLabel: "Red" },
      ]),
    ).toBe("Red / Large");
  });

  it("counts zero, one, and two active groups", () => {
    expect(countCandidateCombinations([])).toBe(1);
    expect(
      countCandidateCombinations([{ name: "Color", activeValueCount: 1 }]),
    ).toBe(1);
    expect(
      countCandidateCombinations([
        { name: "Color", activeValueCount: 2 },
        { name: "Size", activeValueCount: 3 },
      ]),
    ).toBe(6);
  });

  it("rejects a graph above one hundred candidates", () => {
    expect(() =>
      countCandidateCombinations([
        { name: "Color", activeValueCount: 11 },
        { name: "Size", activeValueCount: 10 },
      ]),
    ).toThrow(/Color|Size/);
  });

  it("rejects a third active group", () => {
    expect(() =>
      validateCatalogGraph({
        options: [
          option("color", "Color", 0, ["red"]),
          option("size", "Size", 1, ["large"]),
          option("style", "Style", 2, ["classic"]),
        ],
      }),
    ).toThrow(/two|2/);
  });

  it("rejects case-insensitive duplicate active option and value labels", () => {
    expect(() =>
      validateCatalogGraph({
        options: [
          option("color", "Color", 0, ["red", "RED"]),
          option("colour", "color", 1, ["blue"]),
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it("allows one active value per option", () => {
    expect(
      validateCatalogGraph({
        options: [option("style", "Style", 0, ["classic"])],
      }),
    ).toMatchObject({ candidateCount: 1, activeOptionCount: 1 });
  });

  it("allows one empty-key variant when there are no active groups", () => {
    expect(validateCatalogGraph({ options: [] })).toMatchObject({
      candidateCount: 1,
      combinationKeys: [""],
    });
  });
});

describe("variant reconciliation", () => {
  it("retains existing identities, creates new keys, disables historical keys, and deletes retired history-free keys", () => {
    const plan = planVariantReconciliation(
      [
        {
          id: "variant-red",
          combinationKey: "color:red",
          hasHistory: false,
        },
        {
          id: "variant-blue",
          combinationKey: "color:blue",
          hasHistory: true,
        },
        {
          id: "variant-green",
          combinationKey: "color:green",
          hasHistory: false,
        },
      ],
      ["color:red", "color:yellow"],
    );

    expect(plan.retain).toEqual([
      {
        id: "variant-red",
        combinationKey: "color:red",
        hasHistory: false,
      },
    ]);
    expect(plan.create).toEqual(["color:yellow"]);
    expect(plan.disable).toEqual([
      {
        id: "variant-blue",
        combinationKey: "color:blue",
        hasHistory: true,
      },
    ]);
    expect(plan.delete).toEqual([
      {
        id: "variant-green",
        combinationKey: "color:green",
        hasHistory: false,
      },
    ]);
  });

  it("rejects duplicate existing or desired combination keys", () => {
    expect(() =>
      planVariantReconciliation(
        [
          { id: "v1", combinationKey: "color:red", hasHistory: false },
          { id: "v2", combinationKey: "color:red", hasHistory: false },
        ],
        ["color:red"],
      ),
    ).toThrow(/duplicate/i);

    expect(() =>
      planVariantReconciliation(
        [],
        ["color:red", "color:red"],
      ),
    ).toThrow(/duplicate/i);
  });
});

function option(
  id: string,
  name: string,
  position: number,
  labels: readonly string[],
) {
  return {
    id,
    name,
    position,
    values: labels.map((label, index) => ({
      id: `${id}-${index}`,
      label,
      isActive: true,
    })),
    isActive: true,
  };
}
