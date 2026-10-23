import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product, StorefrontProductVariant } from "@/lib/api";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductDetailsModal } from "./ProductDetailsModal";

const commerce = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("@/lib/commerce-events", () => ({
  emitCommerceEvent: commerce.emit,
  optionSelectEvent: (input: Record<string, unknown>) => input,
}));

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
    id: "modal-product",
    name: "Modular Storage Shelf",
    slug: "modular-storage-shelf",
    description: "A compact furniture piece for flexible small-space living.",
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

function SelectionProbe() {
  const { primaryLine } = usePdpPurchase();
  return <output data-testid="selection">{JSON.stringify(primaryLine.selectedValueIds)}</output>;
}

function renderModal(source: Product, initialVariantId?: string, preview = false) {
  const onClose = vi.fn();
  const view = render(
    <PdpPurchaseProvider product={source} initialVariantId={initialVariantId ?? null}>
      <SelectionProbe />
      <ProductDetailsModal product={source} onClose={onClose} preview={preview} />
    </PdpPurchaseProvider>,
  );
  return { onClose, view, dialog: () => screen.getByRole("dialog", { name: "Product details" }) };
}

function tableRows(scope: HTMLElement) {
  return [...scope.querySelectorAll("tbody tr")].map((row) => ({
    selection: row.getAttribute("data-selection"),
    cells: [...row.querySelectorAll("th, td")].map((cell) =>
      [...cell.childNodes]
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
        .join(" "),
    ),
  }));
}

describe("ProductDetailsModal", () => {
  it("includes the shared product name and material without repeating size or weight facts", async () => {
    const user = userEvent.setup();
    const { dialog } = renderModal(product(), "bs");
    await user.click(within(dialog()).getByText("Details"));

    expect(dialog().querySelector('[data-field="productName"]')).toHaveTextContent("Modular Storage Shelf");
    expect(dialog().querySelector('[data-field="materials"]')).toHaveTextContent("Solid oak");
    expect(within(dialog()).getAllByText("Solid oak", { exact: true })).toHaveLength(1);
    expect(within(dialog()).getAllByText("4 kg · Net weight", { exact: true })).toHaveLength(1);
    expect(within(dialog()).getAllByText("94W × 93H × 43D cm", { exact: true })).toHaveLength(1);
    expect(dialog().querySelector('[data-field="variant"]')).toBeNull();
    expect(within(dialog()).getAllByRole("button", { name: "Black" })).toHaveLength(1);
    expect(dialog().querySelector('#specifications')).toBeNull();
  });

  it("shows real MATERIAL option facts without repeating the material as its own owner", async () => {
    const material = {
      ...STYLE, id: "o-material", kind: "MATERIAL" as const, name: "材质",
      values: [
        { ...STYLE.values[0], id: "oak", label: "Oak" },
        { ...STYLE.values[1], id: "bamboo", label: "Bamboo" },
      ],
    };
    const source = product({
      materials: "UNRELATED PARENT MATERIAL", options: [COLOR, material],
      variants: [
        variant("oak", "Black / Oak", [["o-color", "black"], ["o-material", "oak"]]),
        variant("oak-white", "White / Oak", [["o-color", "white"], ["o-material", "oak"]]),
        variant("bamboo-black", "Black / Bamboo", [["o-color", "black"], ["o-material", "bamboo"]]),
        variant("bamboo", "White / Bamboo", [["o-color", "white"], ["o-material", "bamboo"]]),
      ],
      defaultDisplayVariantId: "oak",
    });
    const user = userEvent.setup();
    const { dialog } = renderModal(source, "oak");
    await user.click(within(dialog()).getByText("Details"));
    const table = within(dialog()).getByRole("table", { name: "Materials by Material" });
    expect(tableRows(table)).toEqual([
      { selection: "selected", cells: ["Oak Selected"] },
      { selection: null, cells: ["Bamboo"] },
    ]);
    expect(dialog().textContent).not.toContain("UNRELATED PARENT MATERIAL");
  });

  it("marks a missing material binding instead of borrowing the product material", async () => {
    const material = {
      ...STYLE, id: "o-material", kind: "MATERIAL" as const, name: "Material",
      values: [{ ...STYLE.values[0], id: "oak", label: "Oak" }],
    };
    const source = product({
      materials: "DO NOT BORROW", options: [COLOR, material],
      variants: [
        variant("known", "Black / Oak", [["o-color", "black"], ["o-material", "oak"]]),
        variant("missing", "White / unknown", [["o-color", "white"]]),
      ],
      defaultDisplayVariantId: "known",
    });
    const user = userEvent.setup();
    const { dialog } = renderModal(source, "known");
    await user.click(within(dialog()).getByText("Details"));
    const cells = [...dialog().querySelectorAll('td[data-field="materials"], th[data-field="materials"]')];
    expect(cells).toHaveLength(2);
    expect(cells.map(cell => cell.textContent)).toEqual(["Oak", "Not provided"]);
    expect(dialog().querySelector('dl [data-field="materials"]')).toBeNull();
    expect(dialog().textContent).not.toContain("DO NOT BORROW");
  });

  it("keeps sparse available colors scoped to their real style", async () => {
    const source = product();
    source.variants = source.variants.filter(row => row.id !== "wt");
    const user = userEvent.setup();
    const { dialog } = renderModal(source, "bt");
    await user.click(within(dialog()).getByText("Details"));
    const table = within(dialog()).getByRole("table", { name: "Available colors by Style" });
    expect(tableRows(table)).toEqual([
      { selection: null, cells: ["3-Tier", "Black / White"] },
      { selection: "selected", cells: ["4-Tier Selected", "Black"] },
    ]);
    expect(within(dialog()).getByRole("group", { name: "Color" })).toBeVisible();
  });

  it("opens Details when material is present but every dimension is absent", () => {
    const source = product({
      width: null, depth: null, height: null, description: null, options: [],
      variants: [variant("plain", "Default", [])], defaultDisplayVariantId: "plain",
    });
    const { dialog } = renderModal(source, "plain");
    expect(within(dialog()).getByText("Solid oak", { exact: true })).toBeVisible();
    expect(within(dialog()).queryByText("Product size", { exact: true })).not.toBeInTheDocument();
    expect(within(dialog()).queryByText("Dimensions", { exact: true })).not.toBeInTheDocument();
    expect(dialog().querySelector('[data-field="weight"]')).toBeNull();
  });

  it("keeps equal numeric Net and Gross weights as different facts", async () => {
    const source = product();
    source.variants.forEach(row => Object.assign(row.sku!, row.id.endsWith("s")
      ? { productWeight: 4, packageWeight: 4 }
      : { productWeight: null, packageWeight: 4 }));
    const { dialog } = renderModal(source, "bt");
    await userEvent.setup().click(within(dialog()).getByText("Details"));
    const table = within(dialog()).getByRole("table", { name: "Weight by Style" });
    expect(tableRows(table)).toEqual([
      { selection: null, cells: ["3-Tier", "4 kg · Net weight"] },
      { selection: "selected", cells: ["4-Tier Selected", "4 kg · Gross weight"] },
    ]);
    expect(dialog().querySelector('dl [data-field="weight"]')).toBeNull();
  });

  it("omits entirely missing material and weight fields without placeholder headings", async () => {
    const source = product({ materials: null });
    source.variants.forEach(row => Object.assign(row.sku!, { productWeight: null, packageWeight: null }));
    const { dialog } = renderModal(source, "bs");
    await userEvent.setup().click(within(dialog()).getByText("Details"));
    expect(dialog().querySelector('[data-field="materials"]')).toBeNull();
    expect(dialog().querySelector('[data-field="weight"]')).toBeNull();
    expect(within(dialog()).queryByRole("heading", { name: "Materials" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("heading", { name: "Weight" })).not.toBeInTheDocument();
    expect(dialog().querySelector('[data-field="productName"]')).toHaveTextContent(source.name);
  });

  it("does not offer colors that have no selectable SKU binding", async () => {
    const source = product({
      options: [{ ...COLOR, values: [...COLOR.values, { ...COLOR.values[0], id: "green", label: "Green", position: 2 }] }, STYLE],
    });
    const user = userEvent.setup();
    const { dialog } = renderModal(source, "bs");
    await user.click(within(dialog()).getByText("Details"));
    const picker = within(dialog()).getByRole("group", { name: "Color" });
    expect(within(picker).queryByRole("button", { name: "Green" })).not.toBeInTheDocument();
    expect(within(picker).getAllByRole("button")).toHaveLength(2);
  });

  it("preserves close, Escape and body scroll-lock lifecycle", () => {
    document.body.style.overflow = "auto";
    const { onClose, view } = renderModal(product());
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close product details" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("lists the real variant sizes in centimetres and marks the current selection", () => {
    const { dialog } = renderModal(product(), "bt");

    expect(within(dialog()).getByText("Product size")).toBeVisible();
    const table = within(dialog()).getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Variant", "Dimensions (cm)"]);
    expect(tableRows(table)).toEqual([
      { selection: null, cells: ["3-Tier", "94W × 93H × 43D cm"] },
      { selection: "selected", cells: ["4-Tier Selected", "141W × 120H × 60D cm"] },
    ]);
    expect(
      within(dialog()).getByText("Measurements may vary slightly. Measure your doorway before delivery."),
    ).toBeVisible();
  });

  it("shows the folded size in centimetres as its own labelled block", () => {
    const source = product({
      foldedWidth: 20,
      foldedHeight: 8,
      foldedDepth: 10,
    });
    const { dialog } = renderModal(source, "bs");

    expect(within(dialog()).getByText("Folded size")).toBeVisible();
    const folded = dialog().querySelector('[data-block="folded"]')!;
    expect(
      [...folded.querySelectorAll("dt, dd")].map((node) => node.textContent?.trim()),
    ).toEqual([
      "Width",
      "20 cm",
      "Folded height",
      "8 cm",
      "Folded depth",
      "10 cm",
    ]);
    expect(within(dialog()).queryByText(/package/i)).not.toBeInTheDocument();
  });

  it("keeps Bundle facts component-specific without the parent product's sizes", async () => {
    const source = product({
      name: "Dining Set",
      materials: "PARENT MATERIAL MUST NOT APPEAR",
      width: 999,
      height: 999,
      depth: 999,
      foldedWidth: 999,
      options: [],
      variants: [
        variant("bundle", "Dining Set", [], {
          specificationSource: "BUNDLE_COMPONENTS",
          productWidth: 999,
          productDepth: 999,
          productHeight: 999,
          packageWeight: 99,
          bundleComponents: [
            { productName: "Chair", variantName: "Oak", quantity: 2, width: 45, depth: 50, height: 80, foldedWidth: 50, foldedDepth: 40, foldedHeight: 12, productWeight: 4, materials: "Solid oak" },
            { productName: "Table", variantName: "White", quantity: 1, width: 120, depth: 60, height: 75, foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: null, materials: "Solid oak" },
          ],
        }),
      ],
      defaultDisplayVariantId: "bundle",
    });
    const { dialog } = renderModal(source, "bundle");

    const text = (dialog().textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/999/);
    expect(text).not.toMatch(/393\.3/);
    expect(text).toContain("Chair / Oak × 2 45W × 80H × 50D cm");
    expect(text).toContain("Table / White × 1 120W × 75H × 60D cm");
    expect(within(dialog()).getByText("Folded size")).toBeVisible();
    const folded = dialog().querySelector('[data-block="folded"]')!;
    expect(folded.textContent).toContain("Chair / Oak × 2");
    expect(
      [...folded.querySelectorAll("dt, dd")].map((node) => node.textContent?.trim()),
    ).toEqual([
      "Width",
      "50 cm",
      "Folded height",
      "12 cm",
      "Folded depth",
      "40 cm",
    ]);
    await userEvent.setup().click(within(dialog()).getByText("Details"));
    expect(dialog().querySelector('[data-field="materials"]')).toHaveTextContent("Chair / Oak × 2 Solid oak");
    expect(dialog().querySelector('[data-field="materials"]')).toHaveTextContent("Table / White × 1 Solid oak");
    expect(dialog().querySelector('[data-field="weight"]')).toHaveTextContent("4 kg · Net weight / per item");
    expect(dialog().querySelector('[data-field="weight"]')).toHaveTextContent("Not provided");
    expect(dialog().textContent).not.toContain("PARENT MATERIAL MUST NOT APPEAR");
    expect(dialog().textContent).not.toContain("99 kg");
  });

  it("omits an empty Details block instead of leaving a blank disclosure", () => {
    const source = product({ name: "", materials: null, description: null, options: [], variants: [variant("plain", "Default", [])] });
    const { dialog } = renderModal(source);
    expect(within(dialog()).queryByText("Details")).not.toBeInTheDocument();
    expect(within(dialog()).getByText("Product size")).toBeVisible();
  });

  it("adds the real weight to the Details section", async () => {
    const user = userEvent.setup();
    const { dialog } = renderModal(product(), "bs");

    await user.click(within(dialog()).getByText("Details"));
    expect(within(dialog()).getByRole("heading", { name: "Weight" })).toBeVisible();
    const row = dialog().querySelector('[data-field="weight"]')!;
    expect(row.querySelector("dt")?.textContent).toBe("Weight");
    expect(row.querySelector("dd")?.textContent).toBe("4 kg · Net weight");
    expect(within(dialog()).queryByText(/package|gross/i)).not.toBeInTheDocument();
  });

  it("lists every real weight when the variants differ instead of following one SKU", async () => {
    const user = userEvent.setup();
    const source = product();
    const weights: (number | null)[] = [4, 5, 6, null];
    source.variants.forEach((entry, index) => {
      Object.assign(entry.sku!, {
        productWeight: weights[index],
        packageWeight: null,
      });
    });
    const { dialog } = renderModal(source, "bs");

    await user.click(within(dialog()).getByText("Details"));
    const table = within(dialog()).getAllByRole("table").find((candidate) =>
      [...candidate.querySelectorAll("th")].some(
        (cell) => cell.textContent?.trim() === "Weight",
      ),
    )!;
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Color / Style", "Weight"]);
    expect(tableRows(table)).toEqual([
      { selection: "selected", cells: ["Black / 3-Tier Selected", "4 kg · Net weight"] },
      { selection: null, cells: ["White / 3-Tier", "5 kg · Net weight"] },
      { selection: null, cells: ["Black / 4-Tier", "6 kg · Net weight"] },
      { selection: null, cells: ["White / 4-Tier", "Not provided"] },
    ]);
  });

  it("changes the shared selection from the color picker without closing the modal", async () => {
    const user = userEvent.setup();
    const { onClose, dialog } = renderModal(product(), "bs");

    await user.click(within(dialog()).getByText("Details"));
    const picker = within(dialog()).getByRole("group", { name: "Color" });
    expect(within(picker).getByRole("button", { name: "Black" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(picker).getByRole("button", { name: "White" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(within(picker).getByRole("button", { name: "White" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("selection")).toHaveTextContent('"o-color":"white"');
    expect(within(dialog()).getByText("Selected configuration: White / 3-Tier")).toBeVisible();
    expect(tableRows(within(dialog()).getByRole("table"))[0].selection).toBe("selected");
    expect(commerce.emit).toHaveBeenCalledWith(
      expect.objectContaining({ optionValueId: "white", selectionSource: "USER" }),
    );
  });

  it("keeps later options and disables only what the earlier choices rule out", async () => {
    const user = userEvent.setup();
    const source = product();
    source.options = [
      { ...STYLE, position: 0 },
      { ...COLOR, position: 1 },
    ];
    source.variants = [
      variant("bs", "Black / 3-Tier", [["o-style", "short"], ["o-color", "black"]]),
      variant("ws", "White / 3-Tier", [["o-style", "short"], ["o-color", "white"]]),
      variant("bt", "Black / 4-Tier", [["o-style", "tall"], ["o-color", "black"]]),
    ];
    const { dialog } = renderModal(source, "bt");

    await user.click(within(dialog()).getByText("Details"));
    const picker = within(dialog()).getByRole("group", { name: "Color" });
    expect(within(picker).getByRole("button", { name: "Black" })).toBeEnabled();
    expect(within(picker).getByRole("button", { name: "White" })).toBeDisabled();
    expect(within(picker).getByRole("button", { name: "White" })).toHaveAttribute(
      "title",
      "White is unavailable with your current options",
    );
  });

  it("uses English option-kind labels even when the internal option name is Chinese", async () => {
    const source = product({ options: [{ ...COLOR, name: "颜色" }, { ...STYLE, name: "款式" }] });
    const user = userEvent.setup();
    const { dialog } = renderModal(source);
    await user.click(within(dialog()).getByText("Details"));
    expect(within(dialog()).getByRole("group", { name: "Color" })).toBeVisible();
    expect(within(dialog()).getByText("Choose a color to complete your selection.")).toBeVisible();
    expect(dialog().textContent).not.toMatch(/颜色|款式/);
  });

  it("invalidates an incompatible later style and keeps the modal open", async () => {
    const user = userEvent.setup();
    const source = product();
    source.variants = source.variants.filter((row) => row.id !== "wt");
    const { onClose, dialog } = renderModal(source, "bt");
    await user.click(within(dialog()).getByText("Details"));
    const picker = within(dialog()).getByRole("group", { name: "Color" });
    expect(within(picker).getByRole("button", { name: "White" })).toBeEnabled();
    await user.click(within(picker).getByRole("button", { name: "White" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"o-color":"white"}');
    expect(within(dialog()).getByText("Choose a style to complete your selection.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().querySelector('[data-selection="selected"]')).toBeNull();
  });

  it("does not emit an event for a preview color change", async () => {
    commerce.emit.mockClear();
    const user = userEvent.setup();
    const { dialog } = renderModal(product(), "bs", true);
    await user.click(within(dialog()).getByText("Details"));
    await user.click(within(dialog()).getByRole("button", { name: "White" }));
    expect(commerce.emit).not.toHaveBeenCalled();
    expect(screen.getByTestId("selection")).toHaveTextContent('"o-color":"white"');
  });

  it("keeps only the real delivery and payment promises", async () => {
    const user = userEvent.setup();
    const { dialog } = renderModal(product(), "bs");
    await user.click(within(dialog()).getByText("Delivery, warranty and returns"));
    expect(within(dialog()).getByText("Delivery as fast as 7 days")).toBeVisible();
    expect(within(dialog()).getByText("Cash on Delivery")).toBeVisible();
    expect(within(dialog()).queryByText(/warranty of|guarantee/i)).not.toBeInTheDocument();
  });
});
