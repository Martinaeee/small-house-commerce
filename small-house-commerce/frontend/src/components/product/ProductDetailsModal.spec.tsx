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

  it("lists the real variant sizes in inches and marks the current selection", () => {
    const { dialog } = renderModal(product(), "bt");

    expect(within(dialog()).getByText("Product size")).toBeVisible();
    const table = within(dialog()).getByRole("table");
    expect(
      within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim()),
    ).toEqual(["Variant", "Dimensions (in)"]);
    expect(tableRows(table)).toEqual([
      { selection: null, cells: ["3-Tier", "37W × 36.6H × 16.9D in"] },
      { selection: "selected", cells: ["4-Tier Selected", "55.5W × 47.2H × 23.6D in"] },
    ]);
    expect(
      within(dialog()).getByText("Measurements may vary slightly. Measure your doorway before delivery."),
    ).toBeVisible();
  });

  it("shows the folded size in inches as its own labelled block", () => {
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
      "7.9 in",
      "Folded height",
      "3.1 in",
      "Folded depth",
      "3.9 in",
    ]);
    expect(within(dialog()).queryByText(/package/i)).not.toBeInTheDocument();
  });

  it("keeps Bundle facts component-specific without the parent product's sizes", () => {
    const source = product({
      name: "Dining Set",
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
    expect(text).toContain("Chair / Oak × 2 17.7W × 31.5H × 19.7D in");
    expect(text).toContain("Table / White × 1 47.2W × 29.5H × 23.6D in");
    expect(within(dialog()).getByText("Folded size")).toBeVisible();
    const folded = dialog().querySelector('[data-block="folded"]')!;
    expect(folded.textContent).toContain("Chair / Oak × 2");
    expect(
      [...folded.querySelectorAll("dt, dd")].map((node) => node.textContent?.trim()),
    ).toEqual([
      "Width",
      "19.7 in",
      "Folded height",
      "4.7 in",
      "Folded depth",
      "15.7 in",
    ]);
  });

  it("omits an empty Details block instead of leaving a blank disclosure", () => {
    const source = product({ description: null, options: [], variants: [variant("plain", "Default", [])] });
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
    expect(within(dialog()).getByText("Metro Manila 3–5 days, provinces 5–7 days")).toBeVisible();
    expect(within(dialog()).getByText("Cash on Delivery")).toBeVisible();
    expect(within(dialog()).queryByText(/warranty of|guarantee/i)).not.toBeInTheDocument();
  });
});
