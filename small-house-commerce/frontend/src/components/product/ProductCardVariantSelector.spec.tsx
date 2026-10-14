import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/lib/api";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductCardVariantSelector } from "./ProductCardVariantSelector";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => tracking);

let resize: (() => void) | undefined;
let width = 144;

beforeEach(() => {
  vi.clearAllMocks();
  width = 144;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const measuredWidth = this.getAttribute("role") === "group" ? width : 44;
    return { x: 0, y: 0, left: 0, top: 0, right: measuredWidth, bottom: 44, width: measuredWidth, height: 44, toJSON: () => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe() {
  const { primaryLine, setPurchaseLocked } = usePdpPurchase();
  return <><output data-testid="selection">{JSON.stringify(primaryLine.selectedValueIds)}</output>
    <button onClick={() => setPurchaseLocked(true)}>Lock purchase</button></>;
}

function renderSelector(product: Product, props: { disabled?: boolean; preview?: boolean } = {}) {
  return render(<PdpPurchaseProvider product={product}>
    <ProductCardVariantSelector lineId="primary" {...props} /><Probe />
  </PdpPurchaseProvider>);
}

function manyValues(): Product {
  const product = cardTestProduct();
  product.options[0]!.values = Array.from({ length: 8 }, (_, i) => ({
    id: `v${i}`, label: `Size ${i}`, position: i, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
  }));
  const source = product.variants[0]!;
  product.variants = product.options[0]!.values.map((value, i) => ({
    ...source, id: `variant-${i}`, name: value.label, combinationKey: `color:${value.id}`, optionValueIds: [value.id],
    sku: { ...source.sku!, id: `sku-${i}`, skuCode: `SKU-${i}` },
  }));
  return product;
}

function twoDimensions(): Product {
  const product = cardTestProduct();
  product.options.push({ id: "size", name: "Size", kind: "SIZE", position: 1, presentation: "TEXT", isMediaDriver: false,
    values: [{ id: "small", label: "Small", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      { id: "large", label: "Large", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] });
  product.variants[0] = { ...product.variants[0]!, combinationKey: "color:red|size:small", optionValueIds: ["red", "small"] };
  product.variants[1] = { ...product.variants[1]!, combinationKey: "color:blue|size:large", optionValueIds: ["blue", "large"] };
  return product;
}

describe("ProductCardVariantSelector", () => {
  it("compact: shows only Color inline even when Size is ordered first", () => {
    const product = twoDimensions();
    product.options[0]!.position = 1;
    product.options[1]!.position = 0;
    renderSelector(product);
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Small" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More options" })).toBeEnabled();
  });

  it("compact: keeps both dimensions selectable in More without guessing a SKU", async () => {
    renderSelector(twoDimensions());
    const user = userEvent.setup();
    const more = screen.queryByRole("button", { name: "More options" });
    expect(more).toBeInTheDocument();
    await user.click(more!);
    const dialog = screen.getByRole("dialog", { name: "Product options" });
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Red" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"red"}');
    expect(within(dialog).getByRole("button", { name: "Large" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Small" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"red","size":"small"}');
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("compact: locks both dimensions while the expanded panel is open", async () => {
    renderSelector(twoDimensions());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("button", { name: "Lock purchase" }));
    const panel = within(screen.getByRole("dialog", { name: "Product options" }));
    for (const label of ["Red", "Blue", "Small", "Large"]) expect(panel.getByRole("button", { name: label })).toBeDisabled();
    expect(panel.getByRole("button", { name: "Done" })).toBeEnabled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("compact: fills the color button itself instead of nesting a color dot", () => {
    const product = cardTestProduct();
    product.options[0]!.presentation = "SWATCH";
    product.options[0]!.values[0]!.swatchHex = "#ff0000";
    renderSelector(product);
    expect(screen.getByRole("button", { name: "Red" })).toHaveStyle({ backgroundColor: "#ff0000" });
  });

  it("compact: disables the always-available More entry in readonly previews", () => {
    renderSelector(twoDimensions(), { preview: true });
    const more = screen.queryByRole("button", { name: "More options" });
    expect(more).toBeInTheDocument();
    expect(more).toBeDisabled();
    expect(screen.queryByRole("group", { name: "Size" })).not.toBeInTheDocument();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });
  it("keeps overflowing choices reachable without wrapping the card row", () => {
    renderSelector(manyValues());
    const group = screen.queryByRole("group", { name: "Color" });
    expect(group).toBeInTheDocument();
    expect(within(group!).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "More Color options" })).toHaveTextContent("+6");
    expect(screen.queryByRole("button", { name: "Size 7" })).not.toBeInTheDocument();
  });

  it("remeasures available width when its observer reports a resize", () => {
    renderSelector(manyValues());
    width = 236;
    act(() => resize?.());
    expect(screen.getByRole("button", { name: "More Color options" })).toHaveTextContent("+4");
    expect(screen.getByRole("button", { name: "Size 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Size 4" })).not.toBeInTheDocument();
  });

  it("uses real two-dimensional compatibility and clears an invalid downstream selection", async () => {
    const product = cardTestProduct();
    product.options.push({ id: "size", name: "Size", kind: "SIZE", position: 1, presentation: "TEXT", isMediaDriver: false,
      values: [{ id: "small", label: "Small", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "large", label: "Large", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] });
    product.variants[0] = { ...product.variants[0]!, combinationKey: "color:red|size:small", optionValueIds: ["red", "small"] };
    product.variants[1] = { ...product.variants[1]!, combinationKey: "color:blue|size:large", optionValueIds: ["blue", "large"] };
    renderSelector(product);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "More options" }));
    let panel = within(screen.getByRole("dialog"));
    expect(panel.getByRole("button", { name: "Large" })).toBeDisabled();
    await user.click(panel.getByRole("button", { name: "Small" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"red","size":"small"}');
    await user.click(panel.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"blue"}');
    await user.click(screen.getByRole("button", { name: "More options" }));
    panel = within(screen.getByRole("dialog"));
    expect(panel.getByRole("button", { name: "Small" })).toBeDisabled();
    expect(panel.getByRole("button", { name: "Large" })).toBeEnabled();
  });

  it("keeps out-of-stock values selectable and marks their state", async () => {
    const product = cardTestProduct();
    product.variants[1]!.sku!.availableInventory = 0;
    renderSelector(product);
    const blue = screen.queryByRole("button", { name: "Blue" });
    expect(blue).toBeInTheDocument();
    expect(blue).toBeEnabled();
    expect(blue).toHaveAttribute("title", "Blue is out of stock");
    await userEvent.click(blue!);
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"blue"}');
  });

  it("does not hide a required single-value dimension on a multiple-SKU product", async () => {
    const product = cardTestProduct();
    product.options[0]!.position = 1;
    product.options.unshift({ id: "material", name: "Material", kind: "MATERIAL", position: 0, presentation: "TEXT", isMediaDriver: false,
      values: [{ id: "oak", label: "Oak", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] });
    product.variants = product.variants.map(row => ({ ...row, combinationKey: `${row.combinationKey}|material:oak`, optionValueIds: [...row.optionValueIds, "oak"] }));
    renderSelector(product);
    expect(screen.queryByRole("button", { name: "Oak" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    const panel = within(screen.getByRole("dialog"));
    await userEvent.click(panel.getByRole("button", { name: "Oak" }));
    await userEvent.click(panel.getByRole("button", { name: "Blue" }));
    expect(screen.getByTestId("selection")).toHaveTextContent('{"material":"oak","color":"blue"}');
  });

  it("omits controls for a single selectable SKU", () => {
    const product = cardTestProduct();
    product.variants = product.variants.slice(0, 1);
    renderSelector(product);
    expect(screen.queryByRole("group", { name: "Color" })).not.toBeInTheDocument();
  });

  it.each([{ disabled: true }, { preview: true }])("disables inline and more actions for %j", props => {
    renderSelector(manyValues(), props);
    const more = screen.queryByRole("button", { name: "More Color options" });
    expect(more).toBeInTheDocument();
    for (const button of within(screen.getByRole("group", { name: "Color" })).getAllByRole("button")) expect(button).toBeDisabled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("locks every option action during a purchase", async () => {
    renderSelector(manyValues());
    await userEvent.click(screen.getByRole("button", { name: "Lock purchase" }));
    expect(screen.queryByRole("button", { name: "More Color options" })).toBeInTheDocument();
    for (const button of within(screen.getByRole("group", { name: "Color" })).getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("shows accessible solid color squares without repeating full chip labels", async () => {
    const product = cardTestProduct();
    product.options[0]!.presentation = "SWATCH";
    product.options[0]!.values[0]!.swatchHex = "#ff0000";
    renderSelector(product);
    const red = screen.queryByRole("button", { name: "Red" });
    expect(red).toBeInTheDocument();
    expect(red).toHaveStyle({ backgroundColor: "#ff0000" });
    expect(within(red!).queryByText("Red")).not.toBeInTheDocument();
    await userEvent.click(red!);
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"red"}');
  });

  it("uses only the option's thumbnail for an IMAGE choice", () => {
    const product = cardTestProduct();
    product.options[0]!.presentation = "IMAGE";
    product.options[0]!.values[1]!.thumbnailUrl = "/uploads/blue-option.webp";
    renderSelector(product);
    const blue = screen.queryByRole("button", { name: "Blue" });
    expect(blue).toBeInTheDocument();
    expect(blue!.querySelector("img")).toHaveAttribute("src", "/uploads/blue-option.webp");
    expect(within(blue!).queryByText("Blue")).not.toBeInTheDocument();
  });

  it("emits engagement only for an actual changed selection", async () => {
    renderSelector(cardTestProduct());
    const red = screen.queryByRole("button", { name: "Red" });
    expect(red).toBeInTheDocument();
    await userEvent.click(red!);
    await userEvent.click(red!);
    expect(screen.getByTestId("selection")).toHaveTextContent('{"color":"red"}');
    expect(tracking.trackCustom.mock.calls.filter(([name]) => name === "option_select")).toHaveLength(1);
    expect(tracking.track).not.toHaveBeenCalled();
  });
});
