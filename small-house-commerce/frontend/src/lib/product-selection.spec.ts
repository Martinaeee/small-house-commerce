import { describe, expect, it } from "vitest";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "./api";
import {
  combinationKeyForSelection,
  createInitialSelection,
  reduceProductSelection,
  resolveSelection,
  type ProductSelectionState,
} from "./product-selection";

const options: StorefrontProductOption[] = [
  {
    id: "color",
    kind: "COLOR",
    name: "Color",
    position: 0,
    presentation: "SWATCH",
    isMediaDriver: true,
    values: [
      {
        id: "red",
        label: "Red",
        position: 0,
        swatchHex: "#ff0000",
        thumbnailUrl: null,
        thumbnailAlt: null,
      },
      {
        id: "blue",
        label: "Blue",
        position: 1,
        swatchHex: "#0000ff",
        thumbnailUrl: null,
        thumbnailAlt: null,
      },
    ],
  },
  {
    id: "size",
    kind: "SIZE",
    name: "Size",
    position: 1,
    presentation: "TEXT",
    isMediaDriver: false,
    values: [
      {
        id: "small",
        label: "Small",
        position: 0,
        swatchHex: null,
        thumbnailUrl: null,
        thumbnailAlt: null,
      },
      {
        id: "large",
        label: "Large",
        position: 1,
        swatchHex: null,
        thumbnailUrl: null,
        thumbnailAlt: null,
      },
    ],
  },
];

function variant(
  id: string,
  color: "red" | "blue",
  size: "small" | "large",
  overrides: Partial<StorefrontProductVariant["sku"]> & {
    status?: "ACTIVE" | "DISABLED";
  } = {},
): StorefrontProductVariant {
  return {
    id,
    name: `${color} ${size}`,
    position: 0,
    combinationKey: `color:${color}|size:${size}`,
    optionValueIds: [color, size],
    sku: {
      id: `sku-${id}`,
      skuCode: id.toUpperCase(),
      status: "ACTIVE",
      price: 100,
      compareAtPrice: 120,
      availableInventory: 5,
      ...overrides,
    },
  };
}

const redSmall = variant("red-small", "red", "small");
const redLarge = variant("red-large", "red", "large", {
  availableInventory: 0,
});
const blueLarge = variant("blue-large", "blue", "large", { price: 140 });
const disabledBlueSmall = variant("blue-small-disabled", "blue", "small", {
  status: "DISABLED",
});
const unpricedBlueSmall = variant("blue-small-unpriced", "blue", "small", {
  price: null,
});

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Configurable chair",
    slug: "configurable-chair",
    description: null,
    tagline: null,
    categoryId: "category-1",
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    images: [],
    detailBlocks: [],
    catalogGraphVersion: 3,
    options,
    variants: [
      redSmall,
      redLarge,
      blueLarge,
      disabledBlueSmall,
      unpricedBlueSmall,
    ],
    defaultDisplayVariantId: redSmall.id,
    effectiveCoverMedia: null,
    ...overrides,
  };
}

function select(
  product: Product,
  state: ProductSelectionState,
  optionId: string,
  valueId: string,
) {
  return reduceProductSelection(product, state, {
    type: "SELECT_OPTION",
    optionId,
    valueId,
  });
}

describe("combinationKeyForSelection", () => {
  it("computes the backend canonical key without option-position heuristics", () => {
    expect(
      combinationKeyForSelection([...options].reverse(), {
        size: "large",
        color: "blue",
      }),
    ).toBe("color:blue|size:large");
  });

  it("encodes delimiters so distinct identities cannot collide", () => {
    const delimiterOptions: StorefrontProductOption[] = [
      {
        ...options[0],
        id: "a",
        values: [{ ...options[0].values[0], id: "b|c:d" }],
      },
    ];

    expect(
      combinationKeyForSelection(delimiterOptions, { a: "b|c:d" }),
    ).toBe("a:b%7Cc%3Ad");
  });

  it("uses encoded tokens as the deterministic tie-break for tied raw keys", () => {
    const tiedOptions: StorefrontProductOption[] = [
      {
        ...options[0],
        id: "a:b",
        values: [{ ...options[0].values[0], id: "c" }],
      },
      {
        ...options[1],
        id: "a",
        values: [{ ...options[1].values[0], id: "b:c" }],
      },
    ];
    const selected = { "a:b": "c", a: "b:c" };

    expect(combinationKeyForSelection(tiedOptions, selected)).toBe(
      combinationKeyForSelection([...tiedOptions].reverse(), selected),
    );
  });

  it("supports zero, one, and two groups and rejects incomplete selections", () => {
    expect(combinationKeyForSelection([], {})).toBe("");
    expect(combinationKeyForSelection(options.slice(0, 1), { color: "red" })).toBe(
      "color:red",
    );
    expect(combinationKeyForSelection(options, { color: "red" })).toBeNull();
    expect(
      combinationKeyForSelection(options, { color: "red", size: "unknown" }),
    ).toBeNull();
  });
});

describe("selection initialization", () => {
  it("prefills a valid deep link without confirming purchase", () => {
    const product = productFixture();
    const state = createInitialSelection(product, blueLarge.id);
    const derived = resolveSelection(product, state);

    expect(state).toMatchObject({
      selectedValueIds: { color: "blue", size: "large" },
      explicitlyTouchedOptionIds: [],
      selectionSource: "DEEP_LINK",
      selectionRevision: 0,
      confirmedCombinationKey: null,
      confirmedRevision: null,
    });
    expect(derived.resolvedVariant?.id).toBe(blueLarge.id);
    expect(derived.purchaseConfirmed).toBe(false);
  });

  it.each([
    ["unknown variant", "missing"],
    ["disabled variant", disabledBlueSmall.id],
    ["unpriced variant", unpricedBlueSmall.id],
  ])("clears an invalid deep link to an %s", (_label, variantId) => {
    const state = createInitialSelection(productFixture(), variantId);

    expect(state.selectedValueIds).toEqual({});
    expect(state.selectionSource).toBe("DEFAULT");
    expect(resolveSelection(productFixture(), state).resolvedVariant).toBeNull();
  });

  it("keeps a multi-SKU default as display-only state", () => {
    const product = productFixture();
    const state = createInitialSelection(product);
    const derived = resolveSelection(product, state);

    expect(state.selectedValueIds).toEqual({});
    expect(derived.resolvedVariant).toBeNull();
    expect(derived.displayVariant?.id).toBe(redSmall.id);
    expect(derived.price).toBe(100);
    expect(derived.purchaseConfirmed).toBe(false);
    expect(derived.missingOptionIds).toEqual(["color", "size"]);
  });

  it("directly resolves the only selectable zero-group SKU", () => {
    const onlyVariant: StorefrontProductVariant = {
      id: "default",
      name: "Default",
      position: 0,
      combinationKey: "",
      optionValueIds: [],
      sku: {
        id: "sku-default",
        skuCode: "DEFAULT",
        status: "ACTIVE",
        price: 75,
        compareAtPrice: null,
        availableInventory: 2,
      },
    };
    const product = productFixture({
      options: [],
      variants: [onlyVariant],
      defaultDisplayVariantId: onlyVariant.id,
    });
    const state = createInitialSelection(product);
    const derived = resolveSelection(product, state);

    expect(state.selectedValueIds).toEqual({});
    expect(derived.resolvedCombinationKey).toBe("");
    expect(derived.resolvedVariant?.id).toBe(onlyVariant.id);
    expect(derived.purchaseConfirmed).toBe(true);
    expect(derived.missingOptionIds).toEqual([]);
  });

  it("keeps a deep link unconfirmed even when it targets the only selectable SKU", () => {
    const product = productFixture({ variants: [redSmall] });
    const state = createInitialSelection(product, redSmall.id);

    expect(state.selectionSource).toBe("DEEP_LINK");
    expect(resolveSelection(product, state).purchaseConfirmed).toBe(false);
  });

  it("directly resolves one selectable SKU without treating a disabled peer as selectable", () => {
    const product = productFixture({
      variants: [redSmall, disabledBlueSmall],
    });
    const state = createInitialSelection(product);
    const derived = resolveSelection(product, state);

    expect(state.selectedValueIds).toEqual({ color: "red", size: "small" });
    expect(state.selectionSource).toBe("DEFAULT");
    expect(derived.selectableVariants.map(({ id }) => id)).toEqual([redSmall.id]);
    expect(derived.purchaseConfirmed).toBe(true);
  });
});

describe("selection reducer and selectors", () => {
  it("confirms an ordinary multi-SKU selection only after every group is touched", () => {
    const product = productFixture();
    const initial = createInitialSelection(product);
    const withColor = select(product, initial, "color", "red");
    const complete = select(product, withColor, "size", "small");

    expect(withColor.explicitlyTouchedOptionIds).toEqual(["color"]);
    expect(withColor.selectionRevision).toBe(1);
    expect(resolveSelection(product, withColor).purchaseConfirmed).toBe(false);
    expect(complete.explicitlyTouchedOptionIds).toEqual(["color", "size"]);
    expect(complete.selectionRevision).toBe(2);
    expect(complete.confirmedCombinationKey).toBe("color:red|size:small");
    expect(complete.confirmedRevision).toBe(2);
    expect(resolveSelection(product, complete).purchaseConfirmed).toBe(true);
  });

  it("allows a confirm dialog to confirm a deep-linked combination", () => {
    const product = productFixture();
    const deepLink = createInitialSelection(product, blueLarge.id);
    const confirmed = reduceProductSelection(product, deepLink, { type: "CONFIRM" });

    expect(confirmed.selectionSource).toBe("CONFIRM_DIALOG");
    expect(confirmed.confirmedCombinationKey).toBe("color:blue|size:large");
    expect(confirmed.confirmedRevision).toBe(0);
    expect(resolveSelection(product, confirmed).purchaseConfirmed).toBe(true);
  });

  it("rejects stale confirmation revisions even when the combination key still matches", () => {
    const product = productFixture();
    const stale: ProductSelectionState = {
      ...createInitialSelection(product, redSmall.id),
      confirmedCombinationKey: redSmall.combinationKey,
      confirmedRevision: 0,
      selectionRevision: 1,
    };

    expect(resolveSelection(product, stale).purchaseConfirmed).toBe(false);
  });

  it.each([
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ])(
    "wraps revision %s deterministically when a real option mutation occurs",
    (selectionRevision) => {
      const product = productFixture();
      const state: ProductSelectionState = {
        ...createInitialSelection(product, redSmall.id),
        selectionRevision,
        confirmedCombinationKey: redSmall.combinationKey,
        confirmedRevision: selectionRevision,
      };
      const changed = select(product, state, "size", "large");

      expect(changed.selectionRevision).toBe(0);
      expect(changed.selectionRevision).not.toBe(selectionRevision);
      expect(changed.confirmedCombinationKey).toBeNull();
      expect(changed.confirmedRevision).toBeNull();
      expect(resolveSelection(product, changed).purchaseConfirmed).toBe(false);
    },
  );

  it("does not advance an unsafe revision for a no-op same-value selection", () => {
    const product = productFixture();
    const selectionRevision = Number.MAX_SAFE_INTEGER + 1;
    const state: ProductSelectionState = {
      ...createInitialSelection(product, redSmall.id),
      selectionRevision,
    };
    const unchangedSelection = select(product, state, "size", "small");

    expect(unchangedSelection.selectionRevision).toBe(selectionRevision);
  });

  it("increments revision and invalidates confirmation after an option mutation", () => {
    const product = productFixture();
    const confirmed = reduceProductSelection(
      product,
      createInitialSelection(product, redSmall.id),
      { type: "CONFIRM" },
    );
    const changed = select(product, confirmed, "size", "large");

    expect(changed.selectionRevision).toBe(1);
    expect(changed.confirmedCombinationKey).toBeNull();
    expect(changed.confirmedRevision).toBeNull();
    expect(resolveSelection(product, changed).purchaseConfirmed).toBe(false);
  });

  it("clears only an incompatible downstream selection without auto-selecting a replacement", () => {
    const product = productFixture({ variants: [redSmall, blueLarge] });
    const deepLink = createInitialSelection(product, redSmall.id);
    const changed = select(product, deepLink, "color", "blue");

    expect(changed.selectedValueIds).toEqual({ color: "blue" });
    expect(changed.selectionRevision).toBe(1);
    expect(resolveSelection(product, changed).missingOptionIds).toEqual(["size"]);
  });

  it("does not clear an upstream choice when a downstream choice forms no combination", () => {
    const product = productFixture({ variants: [redSmall, blueLarge] });
    let state = createInitialSelection(product);
    state = select(product, state, "color", "red");
    state = select(product, state, "size", "large");

    expect(state.selectedValueIds).toEqual({ color: "red", size: "large" });
    expect(resolveSelection(product, state).resolvedVariant).toBeNull();
  });

  it("keeps an out-of-stock ACTIVE SKU selectable and displayable but not purchasable", () => {
    const product = productFixture();
    const state = reduceProductSelection(
      product,
      createInitialSelection(product, redLarge.id),
      { type: "CONFIRM" },
    );
    const derived = resolveSelection(product, state);

    expect(derived.selectableVariants.map(({ id }) => id)).toContain(redLarge.id);
    expect(derived.displayVariant?.id).toBe(redLarge.id);
    expect(derived.resolvedVariant?.id).toBe(redLarge.id);
    expect(derived.purchasableVariant).toBeNull();
    expect(derived.availableInventory).toBe(0);
    expect(derived.purchaseConfirmed).toBe(true);
  });

  it("excludes disabled, unpriced, and SKU-less variants from selectable resolution", () => {
    const noSku: StorefrontProductVariant = {
      ...variant("no-sku", "blue", "small"),
      id: "no-sku",
      sku: null,
    };
    const product = productFixture({
      variants: [redSmall, disabledBlueSmall, unpricedBlueSmall, noSku],
    });
    const derived = resolveSelection(product, {
      ...createInitialSelection(product),
      selectedValueIds: { color: "blue", size: "small" },
    });

    expect(derived.selectableVariants.map(({ id }) => id)).toEqual([redSmall.id]);
    expect(derived.resolvedVariant).toBeNull();
    expect(derived.purchasableVariant).toBeNull();
  });

  it.each([
    [0, 1],
    [-4, 1],
    [1.9, 1],
    [8.8, 8],
    [99, 99],
    [120, 99],
    [Number.POSITIVE_INFINITY, 99],
    [Number.NaN, 1],
  ])("normalizes quantity %s to integer %s", (quantity, expected) => {
    const product = productFixture();
    const state = reduceProductSelection(product, createInitialSelection(product), {
      type: "SET_QUANTITY",
      quantity,
    });

    expect(state.quantity).toBe(expected);
  });

  it("ignores unknown option/value identities without mutating state", () => {
    const product = productFixture();
    const initial = createInitialSelection(product);

    expect(select(product, initial, "unknown", "red")).toBe(initial);
    expect(select(product, initial, "color", "unknown")).toBe(initial);
  });
});
