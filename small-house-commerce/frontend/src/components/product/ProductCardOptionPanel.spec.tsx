import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { ProductCardOptionPanel } from "./ProductCardOptionPanel";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => tracking);
const dialogPrototype = HTMLDialogElement.prototype;
const originalShow = Object.getOwnPropertyDescriptor(dialogPrototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, "close");

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(dialogPrototype, "showModal", { configurable: true, value(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button, input")?.focus();
  } });
  Object.defineProperty(dialogPrototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});

afterEach(() => {
  for (const [key, descriptor] of [["showModal", originalShow], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(dialogPrototype, key, descriptor);
    else Reflect.deleteProperty(dialogPrototype, key);
  }
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

function Harness({ count = 12, disabled = false, hideTrigger = false }: { count?: number; disabled?: boolean; hideTrigger?: boolean }) {
  const product = cardTestProduct();
  const option = product.options[0]!;
  option.values = Array.from({ length: count }, (_, i) => ({
    id: `long-${i}`, label: `Performance Multi Twill, Cream with finish ${i}`, position: i,
    swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
  }));
  const source = product.variants[0]!;
  const variants = option.values.map((value, i) => ({ ...source, id: `variant-${i}`, name: value.label,
    optionValueIds: [value.id], combinationKey: `color:${value.id}`,
    sku: { ...source.sku!, id: `sku-${i}`, skuCode: `LONG-${i}`, availableInventory: i === count - 1 ? 0 : 4 },
  }));
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("long-0");
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <><div><button aria-pressed="true">Selected inline option</button>
    {!hideTrigger ? <button ref={triggerRef} onClick={() => setOpen(true)}>More Color options</button> : null}</div>
    <ProductCardOptionPanel open={open} variants={variants} productOptions={[option]}
      selectedValueIds={{ color: selected }} disabled={disabled} triggerRef={triggerRef}
      onSelect={(_optionId, valueId) => { setSelected(valueId); setOpen(false); }} onClose={() => setOpen(false)} />
    <output data-testid="panel-selection">{selected}</output></>;
}

describe("ProductCardOptionPanel", () => {
  it("uses native modal dismissal and restores the more trigger focus and previous scroll setting", async () => {
    document.body.style.overflow = "clip";
    const user = userEvent.setup();
    render(<Harness />);
    const more = screen.getByRole("button", { name: "More Color options" });
    await user.click(more);
    expect(screen.queryByRole("dialog", { name: "Color options" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    expect(document.body.style.overflow).toBe("clip");
  });

  it("searches full labels without clearing the selection and lets an empty search be cleared", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More Color options" }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search options" });
    await user.type(search, "not a fabric");
    expect(screen.getByText("No matching options")).toBeInTheDocument();
    expect(screen.getByTestId("panel-selection")).toHaveTextContent("long-0");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "Performance Multi Twill, Cream with finish 11" })).toBeEnabled();
    await user.type(search, "finish 11");
    expect(screen.queryByRole("button", { name: "Performance Multi Twill, Cream with finish 0" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Performance Multi Twill, Cream with finish 11" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-selection")).toHaveTextContent("long-11");
  });

  it("does not add a search field for a small group", async () => {
    render(<Harness count={11} />);
    await userEvent.click(screen.getByRole("button", { name: "More Color options" }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance Multi Twill, Cream with finish 10" })).toHaveTextContent("Out of stock");
  });

  it("disables options if purchasing becomes locked while the panel is open", async () => {
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "More Color options" }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    view.rerender(<Harness disabled />);
    for (const value of within(screen.getByRole("dialog")).getAllByRole("button", { name: /^Performance/ })) expect(value).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close options" })).toBeEnabled();
  });

  it("closes on a backdrop click without emitting commercial events", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More Color options" }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"), { clientX: -1, clientY: -1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More Color options" })).toHaveFocus();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("returns focus to the selected inline option if resizing removed the more trigger", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More Color options" }));
    view.rerender(<Harness hideTrigger />);
    expect(screen.queryByRole("button", { name: "More Color options" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Selected inline option" })).toHaveFocus();
  });

  it("restores body scroll when an open panel is unmounted", async () => {
    document.body.style.overflow = "auto";
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "More Color options" }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});
