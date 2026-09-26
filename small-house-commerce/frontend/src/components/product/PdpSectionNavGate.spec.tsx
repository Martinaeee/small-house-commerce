import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product, ProductMediaSet } from "@/lib/api";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { PdpSectionNavGate } from "./PdpSectionNavGate";

/**
 * The Specifications link must follow the DISPLAYED variant's weight. A
 * catalogue-wide scan used to leave the link visible while the section itself
 * rendered nothing.
 */

const sharedMedia: ProductMediaSet = {
  resolvedScope: "SHARED",
  media: [
    {
      id: "shared-1",
      url: "/shared.jpg",
      type: "IMAGE",
      altText: "Chair",
      sortOrder: 0,
    },
  ],
  catalogGraphVersion: 7,
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
  // No product-level specs: the section's existence rests on the variant weight.
  materials: null,
  width: null,
  height: null,
  depth: null,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  features: null,
  catalogGraphVersion: 7,
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
  ],
  variants: [
    {
      id: "red",
      name: "Red",
      position: 0,
      combinationKey: "color:red",
      optionValueIds: ["red"],
      sku: {
        id: "sku-red",
        skuCode: "RED",
        status: "ACTIVE",
        price: 100,
        compareAtPrice: null,
        availableInventory: 3,
        productWeight: 23,
      },
    },
    {
      id: "blue",
      name: "Blue",
      position: 1,
      combinationKey: "color:blue",
      optionValueIds: ["blue"],
      sku: {
        id: "sku-blue",
        skuCode: "BLUE",
        status: "ACTIVE",
        price: 110,
        compareAtPrice: null,
        availableInventory: 3,
        productWeight: null,
      },
    },
  ],
  defaultDisplayVariantId: "red",
  effectiveCoverMedia: sharedMedia.media[0],
  images: sharedMedia.media,
  initialMediaSet: sharedMedia,
  availableMediaScopes: { optionValueIds: [], variantIds: [] },
  detailBlocks: [],
};

function SelectColor({ valueId }: { valueId: string }) {
  const { primaryLine, selectOption } = usePdpPurchase();
  return (
    <button
      type="button"
      onClick={() =>
        selectOption(primaryLine.clientLineId, "color", valueId)
      }
    >
      pick {valueId}
    </button>
  );
}

function renderGate() {
  return render(
    <PdpPurchaseProvider product={product}>
      <PdpSectionNavGate product={product} hasDetails={false} />
      <SelectColor valueId="blue" />
    </PdpPurchaseProvider>,
  );
}

describe("PdpSectionNavGate", () => {
  it("shows the Specifications link only while the displayed variant has specs", async () => {
    const user = userEvent.setup();
    renderGate();

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    expect(
      within(nav).getByRole("link", { name: "Specifications" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "pick blue" }));

    expect(
      within(nav).queryByRole("link", { name: "Specifications" }),
    ).toBeNull();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Delivery & FAQs",
      "Reviews",
      "Order Now",
    ]);
  });
});
