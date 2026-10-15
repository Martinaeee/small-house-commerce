import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/lib/api";
import { PdpPurchaseProvider } from "./PdpPurchaseProvider";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { PdpDetails } from "./PdpDetails";
import { PdpSectionNavGate } from "./PdpSectionNavGate";

const product: Product = {
  id: "detail-product",
  name: "Convertible Table",
  slug: "convertible-table",
  description: "A compact table that adapts to small rooms.",
  tagline: "Small-space flexibility.",
  categoryId: "tables",
  ratingAverage: 4.9,
  reviewCount: 8,
  room: null,
  internalRole: null,
  solutions: [],
  width: 120,
  height: 75,
  depth: 60,
  foldedWidth: 120,
  foldedHeight: 12,
  foldedDepth: 60,
  materials: "Powder-coated steel",
  features: "Folds flat\nLocking frame",
  catalogGraphVersion: 1,
  options: [
    {
      id: "finish",
      kind: "COLOR",
      name: "Finish",
      position: 0,
      presentation: "TEXT",
      isMediaDriver: false,
      values: [
        {
          id: "black",
          label: "Black",
          position: 0,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
        },
        {
          id: "white",
          label: "White",
          position: 1,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
        },
      ],
    },
  ],
  defaultDisplayVariantId: "black-variant",
  effectiveCoverMedia: null,
  images: [],
  variants: [
    {
      id: "black-variant",
      name: "Black",
      position: 0,
      combinationKey: "finish:black",
      optionValueIds: ["black"],
      sku: {
        id: "black-sku",
        skuCode: "TABLE-BLACK",
        status: "ACTIVE",
        price: 4999,
        compareAtPrice: null,
        availableInventory: 5,
        productWeight: 8.5,
        packageWidth: 130,
        packageHeight: 20,
        packageDepth: 70,
        packageWeight: 10,
      },
    },
    {
      id: "white-variant",
      name: "White",
      position: 1,
      combinationKey: "finish:white",
      optionValueIds: ["white"],
      sku: {
        id: "white-sku",
        skuCode: "TABLE-WHITE",
        status: "ACTIVE",
        price: 5299,
        compareAtPrice: null,
        availableInventory: 4,
        productWeight: 9.25,
        packageWidth: 132,
        packageHeight: 22,
        packageDepth: 72,
        packageWeight: 11,
      },
    },
  ],
  effectiveFaq: [
    {
      id: "faq-delivery",
      title: "Delivery & Cash on Delivery",
      answer: [{ kind: "paragraph", text: "Delivery details." }],
      enabled: true,
      position: 0,
      defaultOpen: true,
    },
  ],
  detailBlocks: [
    {
      id: "blank-first",
      type: "IMAGE",
      url: "  ",
      altText: "Must not render",
      sortOrder: 0,
    },
    {
      id: "featured",
      type: "IMAGE",
      url: "featured.jpg",
      altText: "Featured construction detail",
      sortOrder: 1,
    },
    {
      id: "blank-middle",
      type: "VIDEO",
      url: "",
      altText: "Must not render either",
      sortOrder: 2,
    },
    {
      id: "remaining-image",
      type: "IMAGE",
      url: "remaining-1.jpg",
      altText: "Folded table",
      sortOrder: 3,
    },
    {
      id: "remaining-video",
      type: "VIDEO",
      url: "remaining-2.mp4",
      altText: "Folding demonstration",
      sortOrder: 4,
    },
  ],
};

function contentOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("h2, img, video")).map(
    (node) => {
      if (node instanceof HTMLImageElement) return node.getAttribute("src") ?? "";
      if (node instanceof HTMLVideoElement) {
        return (
          node.dataset.videoSource ??
          node.querySelector("source")?.getAttribute("src") ??
          ""
        );
      }
      return node.textContent?.trim() ?? "";
    },
  );
}

describe("PdpDetails", () => {
  it("switches both dimension sections with the displayed SKU and per-axis fallback", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    item.width = 100; item.depth = 50; item.height = 70;
    Object.assign(item.variants[0].sku!, { productWidth: 120, productDepth: 60, productHeight: 75 });
    Object.assign(item.variants[1].sku!, { productWidth: null, productDepth: 80, productHeight: 0 });
    render(<PdpPurchaseProvider product={item}>
      <ProductOptionSelector lineId="primary" instanceId="dimension-test" />
      <PdpDetails product={item} supportEmail="help@luwag.ph" supportHours="Daily" />
    </PdpPurchaseProvider>);
    const sections = ["Product Specifications", "Material & Dimensions"].map(name => screen.getByRole("region", { name }));
    for (const section of sections) {
      expect(within(section).getAllByText("Width")[0].nextElementSibling?.textContent).toBe("120 cm");
      expect(within(section).getByText("Depth").nextElementSibling).toHaveTextContent("60 cm");
      expect(within(section).getByText("Height").nextElementSibling).toHaveTextContent("75 cm");
      expect(within(section).queryByText("130 cm")).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "White" }));
    for (const section of sections) {
      expect(within(section).getAllByText("Width")[0].nextElementSibling?.textContent).toBe("100 cm");
      expect(within(section).getByText("Depth").nextElementSibling).toHaveTextContent("80 cm");
      expect(within(section).getByText("Height").nextElementSibling?.textContent).toBe("0 cm");
      expect(within(section).queryByText("132 cm")).not.toBeInTheDocument();
    }
  });

  it("keeps navigation and anchors aligned for SKU-only dimensions and empty selections", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item, { materials: null, features: null, width: null, depth: null, height: null, foldedWidth: null, foldedDepth: null, foldedHeight: null });
    for (const variant of item.variants) variant.sku!.productWeight = null;
    Object.assign(item.variants[0].sku!, { productWidth: 0, productDepth: null, productHeight: null });
    Object.assign(item.variants[1].sku!, { productWidth: null, productDepth: null, productHeight: null });
    render(<PdpPurchaseProvider product={item}>
      <PdpSectionNavGate product={item} hasDetails={false} />
      <ProductOptionSelector lineId="primary" instanceId="dimension-nav-test" />
      <PdpDetails product={item} supportEmail="help@luwag.ph" supportHours="Daily" />
    </PdpPurchaseProvider>);
    expect(screen.getByRole("link", { name: "Specifications" })).toHaveAttribute("href", "#specifications");
    expect(screen.getByRole("region", { name: "Product Specifications" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "White" }));
    expect(screen.queryByRole("link", { name: "Specifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Product Specifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Material & Dimensions" })).not.toBeInTheDocument();
  });

  it("conserves mixed detail media around truthful structured sections", () => {
    const { container } = render(
      <PdpPurchaseProvider product={product}>
        <PdpDetails
          product={product}
          supportEmail="help@luwag.ph"
          supportHours="Daily, 9am–6pm"
        />
      </PdpPurchaseProvider>,
    );

    expect(contentOrder(container)).toEqual([
      "Description",
      "Why You’ll Love It",
      "featured.jpg",
      "Product Specifications",
      "remaining-1.jpg",
      "remaining-2.mp4",
      "Material & Dimensions",
      "Delivery, Returns & FAQs",
    ]);

    for (const id of ["details", "specifications", "shipping-faq"]) {
      const target = container.querySelector(`#${id}`);
      expect(target).not.toBeNull();
      expect(target).toHaveClass("scroll-mt-28");
    }

    for (const url of ["featured.jpg", "remaining-1.jpg"]) {
      expect(container.querySelectorAll(`[src="${url}"]`)).toHaveLength(1);
    }
    expect(
      container.querySelectorAll('[data-video-source="remaining-2.mp4"]'),
    ).toHaveLength(1);
    expect(screen.queryByAltText("Must not render")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Must not render either"),
    ).not.toBeInTheDocument();
    const detailVideo = screen.getByLabelText(
      "Folding demonstration",
    ) as HTMLVideoElement;
    expect(detailVideo).toHaveAttribute("data-video-mode", "CONTENT");
    expect(detailVideo).toHaveAttribute("data-video-source", "remaining-2.mp4");
    expect(detailVideo).not.toHaveAttribute("src");
    expect(detailVideo.querySelector("source")).toBeNull();
    expect(detailVideo).toHaveAttribute("controls");
    expect(detailVideo).toHaveProperty("muted", true);
    expect(detailVideo).toHaveAttribute("playsinline");
    expect(screen.getAllByText("Folds flat")).toHaveLength(1);
    expect(screen.getAllByText("Locking frame")).toHaveLength(1);
  });

  it("shows only real public specification fields and follows the current display SKU weight", async () => {
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <ProductOptionSelector lineId="primary" instanceId="detail-test" />
        <PdpDetails
          product={product}
          supportEmail="help@luwag.ph"
          supportHours="Daily, 9am–6pm"
        />
      </PdpPurchaseProvider>,
    );

    const specifications = screen.getByRole("region", {
      name: "Product Specifications",
    });
    expect(within(specifications).getByText("8.5 kg")).toBeVisible();
    expect(
      within(specifications).getByText("Powder-coated steel"),
    ).toBeVisible();
    expect(within(specifications).queryByText(/package/i)).not.toBeInTheDocument();
    expect(within(specifications).queryByText(/assembly/i)).not.toBeInTheDocument();
    expect(
      within(specifications).queryByText(/load capacity/i),
    ).not.toBeInTheDocument();
    expect(within(specifications).queryByText("130 cm")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "White" }));

    await waitFor(() =>
      expect(within(specifications).getByText("9.25 kg")).toBeVisible(),
    );
    expect(within(specifications).queryByText("8.5 kg")).not.toBeInTheDocument();
  });
});
