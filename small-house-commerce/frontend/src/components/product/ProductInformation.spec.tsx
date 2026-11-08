import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDesktopViewport } from "@/test/desktop-viewport";
import type { Product, StorefrontProductVariant } from "@/lib/api";
import { PdpPurchaseProvider } from "./PdpPurchaseProvider";
import { ProductInformation } from "./ProductInformation";

function sku(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku",
    skuCode: "SKU",
    status: "ACTIVE" as const,
    price: 100,
    compareAtPrice: null,
    availableInventory: 3,
    ...overrides,
  };
}

function variant(
  id: string,
  name: string,
  values: [string, string][],
  skuOverrides: Record<string, unknown> = {},
): StorefrontProductVariant {
  return {
    id,
    name,
    position: 0,
    combinationKey: values
      .map(([optionId, valueId]) => `${optionId}:${valueId}`)
      .sort()
      .join("|"),
    optionValueIds: values.map(([, valueId]) => valueId),
    sku: sku({ id: `${id}-sku`, skuCode: id.toUpperCase(), ...skuOverrides }),
  };
}

const COLOR = {
  id: "o-color",
  kind: "COLOR" as const,
  name: "Color",
  position: 0,
  presentation: "TEXT" as const,
  isMediaDriver: false,
  values: [
    { id: "black", label: "Black", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
    { id: "white", label: "White", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
  ],
};
const STYLE = {
  id: "o-style",
  kind: "STYLE" as const,
  name: "Style",
  position: 1,
  presentation: "TEXT" as const,
  isMediaDriver: false,
  values: [
    { id: "short", label: "3-Tier", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
    { id: "tall", label: "4-Tier", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
  ],
};

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "test-product",
    name: "Modular Storage Shelf",
    slug: "modular-storage-shelf",
    description: null,
    tagline: null,
    categoryId: "category",
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: null,
    solutions: [],
    materials: "Solid oak",
    width: 94,
    height: 93,
    depth: 43,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    features: null,
    catalogGraphVersion: 1,
    options: [COLOR, STYLE],
    variants: [
      variant("bs", "Black / 3-Tier", [["o-color", "black"], ["o-style", "short"]], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 4, packageWeight: 5 }),
      variant("ws", "White / 3-Tier", [["o-color", "white"], ["o-style", "short"]], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 4, packageWeight: 5 }),
      variant("bt", "Black / 4-Tier", [["o-color", "black"], ["o-style", "tall"]], { productWidth: 141, productDepth: 60, productHeight: 120, productWeight: 4, packageWeight: 5 }),
      variant("wt", "White / 4-Tier", [["o-color", "white"], ["o-style", "tall"]], { productWidth: 141, productDepth: 60, productHeight: 120, productWeight: 4, packageWeight: 5 }),
    ],
    defaultDisplayVariantId: "bs",
    effectiveCoverMedia: null,
    images: [],
    ...overrides,
  };
}

function renderInfo(source: Product, initialVariantId?: string) {
  return render(
    <PdpPurchaseProvider
      product={source}
      initialVariantId={initialVariantId ?? null}
    >
      <ProductInformation product={source} />
    </PdpPurchaseProvider>,
  );
}

function section() {
  return screen.getByRole("region", { name: "Product information" });
}

function tableRows(scope: HTMLElement) {
  return [...scope.querySelectorAll("tbody tr")].map((row) => ({
    members: row.getAttribute("data-members"),
    selection: row.getAttribute("data-selection"),
    cells: [...row.querySelectorAll("th, td")].map((cell) =>
      cell.textContent?.replace(/\s+/g, " ").trim(),
    ),
  }));
}

describe("ProductInformation", () => {
  beforeEach(() => { installDesktopViewport(); });

  it("places the compact mobile facts and size guide at the specifications anchor", () => {
    installDesktopViewport(false);
    const source = product({ width: 80, depth: 40, height: null });
    source.variants.forEach((entry) => Object.assign(entry.sku!, {
      productWidth: 80, productDepth: 40, productHeight: null,
    }));
    renderInfo(source);

    const region = section();
    expect(region).toHaveAttribute("id", "specifications");
    expect(within(region).getByRole("button", { name: /Size guide/i })).toBeInTheDocument();
    expect(within(region).queryByText("Shared details shown once. Differences are listed below.")).toBeNull();
    expect(within(region).queryByText("Product name")).toBeNull();
    const facts = region.querySelector("dl")!;
    expect(within(facts).getByText("Available colors")).toBeInTheDocument();
    expect(facts).toHaveTextContent("Black / White");
    expect(facts).toHaveTextContent("Solid oak");
    expect(facts).toHaveTextContent("80W × 40D cm");
    expect(facts).not.toHaveTextContent("H not provided");
    expect(facts).toHaveTextContent("4 kg");
    expect(within(region).queryByRole("table")).toBeNull();
  });

  it("opens the existing size guide from the mobile specifications header", async () => {
    installDesktopViewport(false);
    const user = userEvent.setup();
    renderInfo(product());

    const trigger = within(section()).getByRole("button", { name: /Size guide/i });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Product details" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("preserves every mobile variant difference under the compact shared facts", async () => {
    installDesktopViewport(false);
    const user = userEvent.setup();
    renderInfo(product(), "bt");

    const region = section();
    expect(within(region).getByRole("button", { name: /Size guide/i })).toBeInTheDocument();
    // Differences start folded; open them before reading the variant rows.
    await user.click(within(region).getByRole("button", { name: /specifications/i }));
    const rows = tableRows(region);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.join(" ")).toContain("94W × 93H × 43D cm");
    expect(rows[1].cells.join(" ")).toContain("141W × 120H × 60D cm");
    expect(rows[1].selection).toBe("selected");
  });

  it("folds and unfolds the mobile difference tables on demand", async () => {
    installDesktopViewport(false);
    const user = userEvent.setup();
    renderInfo(product(), "bt");

    const region = section();
    const toggle = within(region).getByRole("button", { name: /specifications/i });
    // Starts folded; the shared facts still carry the key parameters.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(region).queryByRole("table")).toBeNull();
    expect(region.querySelector("dl")).toHaveTextContent("Solid oak");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(region).getByRole("table")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(region).queryByRole("table")).toBeNull();
  });

  it("omits missing mobile facts rather than adding empty rows", () => {
    installDesktopViewport(false);
    const source = product({ options: [COLOR], materials: null, width: null, depth: null, height: null });
    source.variants = [variant("black", "Black", [["o-color", "black"]]), variant("white", "White", [["o-color", "white"]])];
    renderInfo(source);

    const region = section();
    expect(within(region).getByRole("button", { name: /Size guide/i })).toBeInTheDocument();
    expect(within(region).queryByText("Materials")).toBeNull();
    expect(within(region).queryByText("Dimensions")).toBeNull();
    expect(within(region).queryByText("Not provided")).toBeNull();
  });

  it("renders nothing when no public specification field carries a value", () => {
    const empty = product({
      name: "Bare product",
      options: [],
      width: null,
      height: null,
      depth: null,
      materials: null,
    });
    empty.variants = [variant("plain", "Default", [], {})];
    empty.defaultDisplayVariantId = "plain";

    const { container } = renderInfo(empty);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every shared fact once and lists the real differences by their owning option", () => {
    renderInfo(product());

    const region = section();
    expect(region).toHaveAttribute("id", "specifications");
    expect(region).toHaveClass("scroll-mt-32");
    expect(
      within(region).getByText("Shared details shown once. Differences are listed below."),
    ).toBeInTheDocument();

    for (const [label, value] of [
      ["Product name", "Modular Storage Shelf"],
      ["Available colors", "Black / White"],
      ["Weight", "4 kg · Net weight"],
      ["Materials", "Solid oak"],
    ]) {
      expect(within(region).getByText(label)).toBeInTheDocument();
      expect(within(region).getAllByText(value)).toHaveLength(1);
    }

    expect(region.querySelector('dl [data-field="variant"]')).toBeNull();
    const table = within(region).getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Style", "Dimensions"]);
    expect(tableRows(table)).toEqual([
      { members: "bs,ws", selection: null, cells: ["3-Tier", "94W × 93H × 43D cm"] },
      { members: "bt,wt", selection: null, cells: ["4-Tier", "141W × 120H × 60D cm"] },
    ]);
  });

  it("marks the difference row that describes the current selection", () => {
    const { unmount } = renderInfo(product(), "bt");
    const selected = tableRows(section());
    expect(selected[1].selection).toBe("selected");
    expect(selected[1].cells.join(" | ")).toContain("Selected");
    expect(selected[0].selection).toBeNull();
    unmount();

    renderInfo(product(), "bs");
    expect(tableRows(section())[0].selection).toBe("selected");
  });

  it("keeps a partially missing field out of the shared facts and marks the missing rows", () => {
    const source = product();
    const weights: (number | null)[] = [4, 5, 6, null];
    source.variants.forEach((entry, index) => {
      Object.assign(entry.sku!, {
        productWeight: weights[index],
        packageWeight: null,
      });
    });

    renderInfo(source);

    const region = section();
    const facts = region.querySelector("dl")!;
    expect(facts.textContent).not.toContain("Weight");
    expect(facts.textContent).not.toContain("4 kg");
    const tables = within(region).getAllByRole("table");
    const weight = tables.find((table) =>
      [...table.querySelectorAll("th")].some(
        (cell) => cell.textContent?.trim() === "Weight",
      ),
    )!;
    expect(
      within(weight).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Color / Style", "Weight"]);
    expect(tableRows(weight)).toEqual([
      { members: "bs", selection: null, cells: ["Black / 3-Tier", "4 kg · Net weight"] },
      { members: "ws", selection: null, cells: ["White / 3-Tier", "5 kg · Net weight"] },
      { members: "bt", selection: null, cells: ["Black / 4-Tier", "6 kg · Net weight"] },
      { members: "wt", selection: null, cells: ["White / 4-Tier", "Not provided"] },
    ]);
  });

  it("hides a field that is missing everywhere instead of leaving an empty block", () => {
    renderInfo(product({ materials: null }));

    const region = section();
    expect(within(region).queryByText("Materials")).not.toBeInTheDocument();
    expect(within(region).queryAllByText("Not provided")).toHaveLength(0);
  });

  it("renders no difference table when every variant carries equal facts", () => {
    const source = product();
    source.variants.forEach((entry) =>
      Object.assign(entry.sku!, {
        productWidth: 94,
        productDepth: 43,
        productHeight: 93,
      }),
    );

    renderInfo(source);

    const region = section();
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
    expect(within(region).getByText("94W × 93H × 43D cm")).toBeInTheDocument();
  });

  it("uses the real material value as the owner column instead of repeating it", () => {
    const MATERIAL = {
      ...STYLE,
      id: "o-material",
      kind: "MATERIAL" as const,
      name: "Material",
      values: [
        { id: "oak", label: "Oak", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "bamboo", label: "Bamboo", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ],
    };
    const source = product({
      options: [COLOR, MATERIAL],
      variants: [
        variant("b-oak", "Black / Oak", [["o-color", "black"], ["o-material", "oak"]], { productWidth: 94, productDepth: 43, productHeight: 93 }),
        variant("w-oak", "White / Oak", [["o-color", "white"], ["o-material", "oak"]], { productWidth: 94, productDepth: 43, productHeight: 93 }),
        variant("b-bamboo", "Black / Bamboo", [["o-color", "black"], ["o-material", "bamboo"]], { productWidth: 141, productDepth: 60, productHeight: 120 }),
        variant("w-bamboo", "White / Bamboo", [["o-color", "white"], ["o-material", "bamboo"]], { productWidth: 141, productDepth: 60, productHeight: 120 }),
      ],
    });

    renderInfo(source);

    const table = within(section()).getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Dimensions", "Materials"]);
    expect(tableRows(table)).toEqual([
      { members: "b-oak,w-oak", selection: null, cells: ["94W × 93H × 43D cm", "Oak"] },
      { members: "b-bamboo,w-bamboo", selection: null, cells: ["141W × 120H × 60D cm", "Bamboo"] },
    ]);
  });

  it("keeps Bundle facts component-specific without the parent product's sizes", () => {
    const source = product({
      name: "Dining Set",
      width: 999,
      height: 999,
      depth: 999,
      options: [],
      variants: [
        variant("bundle", "Dining Set", [], {
          specificationSource: "BUNDLE_COMPONENTS",
          productWidth: 999,
          productDepth: 999,
          productHeight: 999,
          packageWeight: 99,
          bundleComponents: [
            { productName: "Chair", variantName: "Oak", quantity: 2, width: 45, depth: 50, height: 80, foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Solid oak" },
            { productName: "Table", variantName: "White", quantity: 1, width: 120, depth: 60, height: 75, foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: null, materials: "Solid oak" },
          ],
        }),
      ],
      defaultDisplayVariantId: "bundle",
    });

    renderInfo(source);

    const region = section();
    const text = (region.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/999/);
    expect(text).not.toMatch(/393\.3/);
    expect(text).toContain("Chair / Oak × 2 45W × 80H × 50D cm");
    expect(text).toContain("Table / White × 1 120W × 75H × 60D cm");
    const weight = within(region).getByRole("table");
    expect(weight.textContent).toContain("4 kg · Net weight / per item");
    expect(weight.textContent).toContain("Not provided");
    expect(weight.textContent).not.toMatch(/99 kg|8 kg|12 kg/);
  });
});
