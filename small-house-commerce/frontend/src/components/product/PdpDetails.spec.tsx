import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

function tableRows(scope: HTMLElement) {
  return [...scope.querySelectorAll("tbody tr")].map((row) => ({
    selection: row.getAttribute("data-selection"),
    cells: [...row.querySelectorAll("th, td")].map((cell) =>
      cell.textContent?.replace(/\s+/g, " ").trim(),
    ),
  }));
}

function bundleComponent(productName: string, quantity: number) {
  return {
    productName, variantName: "Oak", quantity, width: 45, depth: 50, height: 80,
    foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Solid oak",
  };
}

describe("PdpDetails", () => {
  it("lists ordinary and Bundle facts together with no parent-size fallback", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    item.options[0].kind = "STYLE";
    Object.assign(item.variants[0].sku!, { productWidth: 120 });
    Object.assign(item.variants[1].sku!, {
      specificationSource: "BUNDLE_COMPONENTS", productWidth: 999, productDepth: 999, productHeight: 999,
      bundleComponents: [bundleComponent("Table", 1), bundleComponent("Chair", 4)],
    });
    item.options[0].values.push({ ...item.options[0].values[1], id: "bench", label: "With Bench", position: 2 });
    item.variants.push({ ...structuredClone(item.variants[1]), id: "bench-variant", name: "With Bench", position: 2,
      combinationKey: "finish:bench", optionValueIds: ["bench"], sku: {
        ...item.variants[1].sku!, id: "bench-sku", skuCode: "BENCH-SET", bundleComponents: [bundleComponent("Bench", 2)],
      },
    });
    render(<PdpPurchaseProvider product={item}>
      <ProductOptionSelector lineId="primary" instanceId="bundle-spec-test" />
      <PdpSectionNavGate product={item} hasDetails />
      <PdpDetails product={item} />
    </PdpPurchaseProvider>);

    const section = screen.getByRole("region", { name: "Product information" });
    const table = within(section).getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Style", "Dimensions", "Weight", "Materials"]);
    const rows = tableRows(table);
    expect(rows[0].cells[0]).toBe("Black");
    expect(rows[0].cells[1]).toBe("47.2W × 29.5H × 23.6D in");
    expect(rows[0].cells[3]).toBe("Powder-coated steel");
    const bundleRow = rows[1].cells.join(" | ");
    expect(bundleRow).toContain("Table / Oak × 1");
    expect(bundleRow).toContain("Chair / Oak × 4");
    expect(bundleRow).not.toMatch(/999|47\.2W/);
    expect(bundleRow).toContain("4 kg · Net weight / per item");
    expect(bundleRow).toContain("Solid oak");
    expect(screen.getByRole("link", { name: "Specifications" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "White" }));
    const selected = tableRows(within(section).getByRole("table"));
    expect(selected[1].selection).toBe("selected");
    expect(selected[1].cells.join(" | ")).toContain("Chair / Oak × 4");
    expect(selected[2].cells.join(" | ")).toContain("Bench / Oak × 2");

    await user.click(screen.getByRole("button", { name: "Black" }));
    expect(tableRows(within(section).getByRole("table"))[0].selection).toBe("selected");
  });

  it("hides the specifications section and its navigation for an empty Bundle product", async () => {
    const item = structuredClone(product);
    item.options[0].kind = "STYLE";
    item.materials = null;
    item.width = null;
    item.depth = null;
    item.height = null;
    item.foldedWidth = null;
    item.foldedDepth = null;
    item.foldedHeight = null;
    Object.assign(item.variants[0].sku!, { specificationSource: "BUNDLE_COMPONENTS", bundleComponents: [] });
    Object.assign(item.variants[1].sku!, { specificationSource: "BUNDLE_COMPONENTS", bundleComponents: [] });
    render(<PdpPurchaseProvider product={item}>
      <ProductOptionSelector lineId="primary" instanceId="invalid-bundle-spec" />
      <PdpSectionNavGate product={item} hasDetails />
      <PdpDetails product={item} />
    </PdpPurchaseProvider>);
    expect(screen.queryByRole("link", { name: "Specifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Product information" })).not.toBeInTheDocument();
  });

  it("keeps the per-axis SKU fallback and the zero override in the difference table", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    item.width = 100; item.depth = 50; item.height = 70;
    Object.assign(item.variants[0].sku!, { productWidth: 120, productDepth: 60, productHeight: 75 });
    Object.assign(item.variants[1].sku!, { productWidth: null, productDepth: 80, productHeight: 0 });
    render(<PdpPurchaseProvider product={item}>
      <ProductOptionSelector lineId="primary" instanceId="dimension-test" />
      <PdpDetails product={item} />
    </PdpPurchaseProvider>);

    const section = screen.getByRole("region", { name: "Product information" });
    const table = within(section).getByRole("table");
    expect(tableRows(table).map((row) => row.cells[0])).toEqual(["Black", "White"]);
    expect(tableRows(table)[0].cells[1]).toBe("47.2W × 29.5H × 23.6D in");
    expect(tableRows(table)[1].cells[1]).toBe("39.4W × 0H × 31.5D in");
    expect(within(section).queryByText("130 cm")).not.toBeInTheDocument();
    expect(within(section).queryByText("132 cm")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "White" }));
    expect(tableRows(within(section).getByRole("table"))[1].selection).toBe("selected");
  });

  it("keeps navigation and anchors aligned while a variant lacks its own dimensions", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item, { materials: null, features: null, width: null, depth: null, height: null, foldedWidth: null, foldedDepth: null, foldedHeight: null });
    for (const variant of item.variants) variant.sku!.productWeight = null;
    Object.assign(item.variants[0].sku!, { productWidth: 0, productDepth: null, productHeight: null });
    Object.assign(item.variants[1].sku!, { productWidth: null, productDepth: null, productHeight: null });
    render(<PdpPurchaseProvider product={item}>
      <PdpSectionNavGate product={item} hasDetails={false} />
      <ProductOptionSelector lineId="primary" instanceId="dimension-nav-test" />
      <PdpDetails product={item} />
    </PdpPurchaseProvider>);
    expect(screen.getByRole("link", { name: "Specifications" })).toHaveAttribute("href", "#specifications");
    const section = screen.getByRole("region", { name: "Product information" });
    expect(section).toBeVisible();
    const rows = tableRows(within(section).getByRole("table"));
    expect(rows[0].cells[1]).toBe("0W in · H, D not provided");
    expect(rows[1].cells[1]).toBe("Not provided");

    await user.click(screen.getByRole("button", { name: "White" }));
    expect(screen.getByRole("link", { name: "Specifications" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Product information" })).toBeVisible();
    expect(tableRows(within(section).getByRole("table"))[1].selection).toBe("selected");
  });

  it("conserves mixed detail media around truthful structured sections", () => {
    const { container } = render(
      <PdpPurchaseProvider product={product}>
        <PdpDetails product={product} />
      </PdpPurchaseProvider>,
    );

    expect(contentOrder(container)).toEqual([
      "Description",
      "Why You’ll Love It",
      "featured.jpg",
      "remaining-1.jpg",
      "remaining-2.mp4",
      "Product information",
    ]);

    for (const id of ["details", "specifications"]) {
      const target = container.querySelector(`#${id}`);
      expect(target).not.toBeNull();
      expect(target).toHaveClass("scroll-mt-32");
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

  it("shows four detail media first and expands or folds the rest", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    // Seven media in total: the featured one plus six that the fold governs.
    item.detailBlocks = Array.from({ length: 7 }, (_, index) => ({
      id: `detail-${index + 1}`,
      type: "IMAGE" as const,
      url: `detail-${index + 1}.jpg`,
      altText: `Detail ${index + 1}`,
      sortOrder: index,
    }));
    render(
      <PdpPurchaseProvider product={item}>
        <PdpDetails product={item} />
      </PdpPurchaseProvider>,
    );

    // First four are visible without any interaction.
    for (const index of [1, 2, 3, 4]) {
      expect(screen.getByAltText(`Detail ${index}`)).toBeInTheDocument();
    }
    for (const index of [5, 6, 7]) {
      expect(screen.queryByAltText(`Detail ${index}`)).not.toBeInTheDocument();
    }

    const more = screen.getByRole("button", { name: "See more (3)" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(more).toHaveTextContent("Show less");
    for (const index of [5, 6, 7]) {
      expect(screen.getByAltText(`Detail ${index}`)).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByAltText("Detail 5")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See more (3)" })).toBeInTheDocument();
  });

  it("offers no fold control when the detail media already fit in four", () => {
    render(
      <PdpPurchaseProvider product={product}>
        <PdpDetails product={product} />
      </PdpPurchaseProvider>,
    );

    expect(screen.queryByRole("button", { name: /See more/ })).not.toBeInTheDocument();
  });

  it("shows only real public specification fields and marks the displayed variant", async () => {
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <ProductOptionSelector lineId="primary" instanceId="detail-test" />
        <PdpDetails product={product} />
      </PdpPurchaseProvider>,
    );

    const specifications = screen.getByRole("region", {
      name: "Product information",
    });
    const facts = specifications.querySelector("dl")!;
    expect(facts.textContent).toContain("Powder-coated steel");
    expect(facts.textContent).not.toContain("Weight");
    const table = within(specifications).getByRole("table");
    expect(tableRows(table)).toEqual([
      { selection: null, cells: ["Black", "8.5 kg · Net weight"] },
      { selection: null, cells: ["White", "9.25 kg · Net weight"] },
    ]);
    expect(within(specifications).queryByText(/package/i)).not.toBeInTheDocument();
    expect(within(specifications).queryByText(/assembly/i)).not.toBeInTheDocument();
    expect(
      within(specifications).queryByText(/load capacity/i),
    ).not.toBeInTheDocument();
    expect(within(specifications).queryByText("130 cm")).not.toBeInTheDocument();
    expect(within(specifications).queryByText("132 cm")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "White" }));
    expect(tableRows(within(specifications).getByRole("table"))[1].selection).toBe("selected");
  });
});
