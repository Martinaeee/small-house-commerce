import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Product, StorefrontProductVariant } from "@/lib/api";
import {
  PdpPurchaseProvider,
  createInitialPurchaseLines,
  reducePurchaseLines,
  usePdpPurchase,
} from "./PdpPurchaseProvider";

const redSmall: StorefrontProductVariant = {
  id: "red-small",
  name: "Red / Small",
  position: 0,
  combinationKey: "color:red|size:small",
  optionValueIds: ["red", "small"],
  sku: {
    id: "sku-red-small",
    skuCode: "RED-SMALL",
    status: "ACTIVE",
    price: 100,
    compareAtPrice: null,
    availableInventory: 4,
  },
};

const blueLarge: StorefrontProductVariant = {
  id: "blue-large",
  name: "Blue / Large",
  position: 1,
  combinationKey: "color:blue|size:large",
  optionValueIds: ["blue", "large"],
  sku: {
    id: "sku-blue-large",
    skuCode: "BLUE-LARGE",
    status: "ACTIVE",
    price: 120,
    compareAtPrice: null,
    availableInventory: 2,
  },
};

const product: Product = {
  id: "product-1",
  name: "Chair",
  slug: "chair",
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
  catalogGraphVersion: 2,
  options: [
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
  ],
  variants: [redSmall, blueLarge],
  defaultDisplayVariantId: redSmall.id,
  effectiveCoverMedia: null,
};

function completeLine(
  lines: readonly ReturnType<typeof createInitialPurchaseLines>[number][],
  lineId: string,
  color: "red" | "blue",
  size: "small" | "large",
) {
  let next = reducePurchaseLines(product, lines, {
    type: "SELECT_OPTION",
    lineId,
    optionId: "color",
    valueId: color,
  });
  next = reducePurchaseLines(product, next, {
    type: "SELECT_OPTION",
    lineId,
    optionId: "size",
    valueId: size,
  });
  return next;
}

describe("purchase line state", () => {
  it("stores only canonical selection state plus clientLineId", () => {
    const [line] = createInitialPurchaseLines(product);

    expect(Object.keys(line).sort()).toEqual(
      [
        "clientLineId",
        "confirmedCombinationKey",
        "confirmedRevision",
        "explicitlyTouchedOptionIds",
        "quantity",
        "selectedValueIds",
        "selectionRevision",
        "selectionSource",
      ].sort(),
    );
    expect(line).not.toHaveProperty("variant");
    expect(line).not.toHaveProperty("sku");
    expect(line).not.toHaveProperty("price");
    expect(line).not.toHaveProperty("media");
  });

  it("keeps the original primary line at index zero when secondary lines are added and removed", () => {
    const initial = createInitialPurchaseLines(product);
    const primary = initial[0];
    const withSecondary = reducePurchaseLines(product, initial, {
      type: "ADD_LINE",
      clientLineId: "secondary",
    });
    const withoutSecondary = reducePurchaseLines(product, withSecondary, {
      type: "REMOVE_LINE",
      lineId: "secondary",
    });

    expect(withSecondary[0]).toBe(primary);
    expect(withSecondary.map(({ clientLineId }) => clientLineId)).toEqual([
      primary.clientLineId,
      "secondary",
    ]);
    expect(withoutSecondary).toEqual([primary]);
  });

  it("resets rather than replaces the primary line when it is removed", () => {
    const initial = createInitialPurchaseLines(product);
    const primaryId = initial[0].clientLineId;
    let lines = completeLine(initial, primaryId, "red", "small");
    lines = reducePurchaseLines(product, lines, {
      type: "ADD_LINE",
      clientLineId: "secondary",
    });
    lines = reducePurchaseLines(product, lines, {
      type: "REMOVE_LINE",
      lineId: primaryId,
    });

    expect(lines.map(({ clientLineId }) => clientLineId)).toEqual([
      primaryId,
      "secondary",
    ]);
    expect(lines[0].selectedValueIds).toEqual({});
    expect(lines[0].confirmedCombinationKey).toBeNull();
  });

  it("updates selection and quantity only on the addressed line", () => {
    const initial = createInitialPurchaseLines(product);
    const primary = initial[0];
    let lines = reducePurchaseLines(product, initial, {
      type: "ADD_LINE",
      clientLineId: "secondary",
    });
    lines = completeLine(lines, "secondary", "blue", "large");
    lines = reducePurchaseLines(product, lines, {
      type: "SET_QUANTITY",
      lineId: "secondary",
      quantity: 7,
    });

    expect(lines[0]).toBe(primary);
    expect(lines[0].quantity).toBe(1);
    expect(lines[1]).toMatchObject({
      selectedValueIds: { color: "blue", size: "large" },
      quantity: 7,
    });
  });

  it("invalidates confirmation only for the line entering variant-change mode", () => {
    const initial = createInitialPurchaseLines(product);
    const primaryId = initial[0].clientLineId;
    let lines = reducePurchaseLines(product, initial, {
      type: "ADD_LINE",
      clientLineId: "secondary",
    });
    lines = completeLine(lines, primaryId, "red", "small");
    lines = completeLine(lines, "secondary", "blue", "large");
    const secondaryConfirmation = lines[1].confirmedCombinationKey;

    lines = reducePurchaseLines(product, lines, {
      type: "CHANGE_LINE_VARIANT",
      lineId: primaryId,
    });

    expect(lines[0].confirmedCombinationKey).toBeNull();
    expect(lines[0].confirmedRevision).toBeNull();
    expect(lines[1].confirmedCombinationKey).toBe(secondaryConfirmation);
  });

  it("ignores actions for unknown lines and duplicate line IDs", () => {
    const initial = createInitialPurchaseLines(product);

    expect(
      reducePurchaseLines(product, initial, {
        type: "SET_QUANTITY",
        lineId: "missing",
        quantity: 3,
      }),
    ).toBe(initial);
    expect(
      reducePurchaseLines(product, initial, {
        type: "ADD_LINE",
        clientLineId: initial[0].clientLineId,
      }),
    ).toBe(initial);
  });
});

describe("PdpPurchaseProvider", () => {
  it("exposes orderLines[0] as the exact primary line and derives its display state", () => {
    function Probe() {
      const value = usePdpPurchase();
      return (
        <output>
          {JSON.stringify({
            samePrimary: value.primaryLine === value.orderLines[0],
            lineCount: value.orderLines.length,
            displayVariantId: value.primaryDerived.displayVariant?.id,
            resolvedVariantId: value.primaryDerived.resolvedVariant?.id ?? null,
            methods: [
              value.selectOption,
              value.confirmLine,
              value.setQuantity,
              value.addLine,
              value.removeLine,
              value.changeLineVariant,
            ].map((method) => typeof method),
          })}
        </output>
      );
    }

    const markup = renderToStaticMarkup(
      <PdpPurchaseProvider product={product}>
        <Probe />
      </PdpPurchaseProvider>,
    );

    expect(markup).toContain('&quot;samePrimary&quot;:true');
    expect(markup).toContain('&quot;lineCount&quot;:1');
    expect(markup).toContain(`&quot;displayVariantId&quot;:&quot;${redSmall.id}&quot;`);
    expect(markup).toContain('&quot;resolvedVariantId&quot;:null');
    expect(markup).toContain(
      '&quot;methods&quot;:[&quot;function&quot;,&quot;function&quot;,&quot;function&quot;,&quot;function&quot;,&quot;function&quot;,&quot;function&quot;]',
    );
  });

  it("uses a deep link only to prefill the primary display selection", () => {
    function Probe() {
      const { primaryLine, primaryDerived } = usePdpPurchase();
      return (
        <output>
          {JSON.stringify({
            source: primaryLine.selectionSource,
            touched: primaryLine.explicitlyTouchedOptionIds,
            resolvedVariantId: primaryDerived.resolvedVariant?.id,
            purchaseConfirmed: primaryDerived.purchaseConfirmed,
          })}
        </output>
      );
    }

    const markup = renderToStaticMarkup(
      <PdpPurchaseProvider product={product} initialVariantId={blueLarge.id}>
        <Probe />
      </PdpPurchaseProvider>,
    );

    expect(markup).toContain('&quot;source&quot;:&quot;DEEP_LINK&quot;');
    expect(markup).toContain('&quot;touched&quot;:[]');
    expect(markup).toContain(
      `&quot;resolvedVariantId&quot;:&quot;${blueLarge.id}&quot;`,
    );
    expect(markup).toContain('&quot;purchaseConfirmed&quot;:false');
  });

  it("throws when the context is consumed outside its provider", () => {
    function Probe() {
      usePdpPurchase();
      return null;
    }

    expect(() => renderToStaticMarkup(<Probe />)).toThrow(
      /PdpPurchaseProvider/,
    );
  });
});
