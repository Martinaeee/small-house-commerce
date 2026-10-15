import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LandingBlocksLayout, LandingBlocksProvider, LandingContentView, MarketingBlocks } from "./LandingContentView";
import { ProductOptionSelector } from "./ProductOptionSelector";
import type { Product } from "@/lib/api";
import { deliveryWindows } from "@/lib/deliveryWindow";
import type { LandingContent } from "@/lib/marketing-content";

const saved: LandingContent = {
  schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null,
  blocks: [
    { id: "hero", type: "hero", sourceKey: null, props: { title: "Independent title", tagline: "Small space", promoHeadline: null, promoSubtext: null } },
    { id: "buy", type: "buy", sourceKey: null, props: {} },
    { id: "copy", type: "richText", sourceKey: null, props: { html: "<p><strong>Verified markup</strong></p>" } },
  ],
};

describe("shared landing content renderer", () => {
  it("follows the selected SKU dimensions in live landing facts without package leakage", async () => {
    const user = userEvent.setup();
    const item: Product = {
      id: "landing-dims", name: "Table", slug: "table", description: null, tagline: null, categoryId: "tables",
      ratingAverage: null, reviewCount: 0, room: null, internalRole: null, solutions: [],
      width: 100, depth: 50, height: 70, foldedWidth: null, foldedDepth: null, foldedHeight: null,
      materials: null, features: null, catalogGraphVersion: 1, defaultDisplayVariantId: "Small", effectiveCoverMedia: null, images: [],
      options: [{ id: "size", kind: "SIZE", name: "Size", position: 0, presentation: "TEXT", isMediaDriver: false,
        values: ["Small", "Large"].map((label, position) => ({ id: label, label, position, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null })),
      }],
      variants: ["Small", "Large"].map((name, position) => ({
        id: name, name, position, combinationKey: `size:${name}`, optionValueIds: [name],
        sku: { id: `sku-${name}`, skuCode: name, status: "ACTIVE", price: 1499, compareAtPrice: null, availableInventory: 3,
          productWidth: position === 0 ? 120 : null, productDepth: position === 0 ? 60 : 80, productHeight: position === 0 ? 75 : 0,
          packageWidth: 999, packageDepth: 888, packageHeight: 777,
        },
      })),
    };
    render(<LandingBlocksProvider product={item} approvedContent={saved} preview delivery={deliveryWindows()}>
      <ProductOptionSelector lineId="primary" instanceId="landing-dimensions" />
      <MarketingBlocks block={{ id: "facts", type: "facts", sourceKey: null, props: {} }} />
    </LandingBlocksProvider>);
    for (const name of ["Product Specifications", "Material & Dimensions"]) {
      const region = within(screen.getByRole("region", { name }));
      expect(region.getByText("Width").nextElementSibling?.textContent).toBe("120 cm");
      expect(region.getByText("Depth").nextElementSibling?.textContent).toBe("60 cm");
      expect(region.getByText("Height").nextElementSibling?.textContent).toBe("75 cm");
      expect(region.queryByText("999 cm")).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Large" }));
    for (const name of ["Product Specifications", "Material & Dimensions"]) {
      const region = within(screen.getByRole("region", { name }));
      expect(region.getByText("Width").nextElementSibling?.textContent).toBe("100 cm");
      expect(region.getByText("Depth").nextElementSibling?.textContent).toBe("80 cm");
      expect(region.getByText("Height").nextElementSibling?.textContent).toBe("0 cm");
      expect(region.queryByText("888 cm")).not.toBeInTheDocument();
    }
  });

  it("renders the independent title and only server-approved rich markup", () => {
    render(<LandingContentView content={saved} approvedContent={saved} product={null} preview />);
    expect(screen.getByRole("heading", { name: "Independent title" })).toBeInTheDocument();
    expect(screen.getByText("Verified markup").tagName).toBe("STRONG");
    expect(screen.getByText(/Purchase is unavailable/)).toBeInTheDocument();
  });

  it("never executes unsaved HTML that differs from the validated document", () => {
    const changed: LandingContent = { ...saved, blocks: [saved.blocks[0], saved.blocks[1], { id: "copy", type: "richText", sourceKey: null, props: { html: '<img src="bad" onerror="bad()"><script>bad()</script>' } }] };
    const { container } = render(<LandingContentView content={changed} approvedContent={saved} product={null} preview />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('img[src="bad"]')).toBeNull();
    expect(container).toHaveTextContent('<script>bad()</script>');
  });

  it("marks the editable block layout for adjacent gallery and purchase styling", () => {
    const { container } = render(<LandingBlocksLayout><div /></LandingBlocksLayout>);
    expect(container.firstChild).toHaveClass("landing-blocks-layout");
  });

  it("keeps the inherited product lead fixed above reorderable detail blocks", () => {
    const inherited: LandingContent = {
      ...saved,
      blocks: [
        saved.blocks[2],
        saved.blocks[1],
        saved.blocks[0],
        { id: "gallery", type: "gallery", sourceKey: null, props: { media: [] } },
      ],
    };

    const { container } = render(<LandingContentView content={inherited} approvedContent={inherited} product={null} preview />);
    const article = container.querySelector("article");
    const lead = container.querySelector('[data-landing-product-lead="true"]');

    expect(article?.firstElementChild).toBe(lead);
    expect(lead).toHaveClass("lg:grid-cols-2");
    expect(lead?.querySelector('[data-landing-block="gallery"]')).toBeInTheDocument();
    expect(lead?.querySelector('[data-landing-block="hero"]')).toBeInTheDocument();
    expect(lead?.querySelector('[data-landing-block="buy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-landing-block="richText"]')?.closest('[data-landing-product-lead="true"]')).toBeNull();
  });
});
