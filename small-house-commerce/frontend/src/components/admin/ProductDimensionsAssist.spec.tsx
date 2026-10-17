import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductDimensionsAssist } from "./ProductDimensionsAssist";

const empty = { width: "", depth: "", height: "", foldedWidth: "", foldedDepth: "", foldedHeight: "" };
function setup(value = empty, disabled = false) {
  const onApply = vi.fn();
  const view = render(<AdminI18nProvider><ProductDimensionsAssist value={value} onApply={onApply} disabled={disabled} /></AdminI18nProvider>);
  return { onApply, ...view };
}
async function parse() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
  await user.type(screen.getByLabelText("粘贴商品尺寸"), "120 x 60 x 75 cm; weight 5kg");
  await user.click(screen.getByRole("button", { name: "解析尺寸" }));
  return user;
}

describe("ProductDimensionsAssist confirmation boundary", () => {
  beforeEach(() => setAdminLang("zh"));

  it("requires an explicit axis order before applying an unlabelled triplet", async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "120x60x75cm");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    expect(screen.getByText("无标签尺寸需要先选择长宽高顺序")).toBeVisible();
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeEnabled();
  });

  it("never applies the positive subset of an invalid dimension triplet", async () => {
    setup();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "0x60x75cm");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeEnabled();
  });

  it("previews LWH product dimensions without applying or accepting weight fields", async () => {
    const { onApply } = setup();
    await parse();
    expect(within(screen.getByRole("status")).getAllByRole("term").map(row => row.textContent)).toEqual(["长", "宽", "高"]);
    expect(within(screen.getByRole("status")).getAllByRole("definition").map(row => row.textContent)).toEqual(["120 cm", "60 cm", "75 cm"]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("fills only empty expanded dimensions and preserves a zero string", async () => {
    const { onApply } = setup({ ...empty, width: "0" });
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ depth: "60", height: "75" });
  });

  it("replaces only the explicitly selected folded target", async () => {
    const { onApply } = setup({ ...empty, width: "99", foldedWidth: "99", foldedDepth: "88", foldedHeight: "77" });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("填写目标"), "folded");
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "120x60x75cm");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    await user.selectOptions(screen.getByLabelText("应用方式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ foldedWidth: "120", foldedDepth: "60", foldedHeight: "75" });
  });

  it("invalidates preview when the target changes", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.selectOptions(screen.getByLabelText("填写目标"), "folded");
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("invalidates preview when pasted input changes", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.clear(screen.getByLabelText("粘贴商品尺寸"));
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("previews folded dimensions in the same LWH axis convention", async () => {
    setup();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("填写目标"), "folded");
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "120x60x75cm");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    expect(within(screen.getByRole("status")).getAllByRole("term").map(row => row.textContent))
      .toEqual(["折叠后长", "折叠后宽", "折叠后高"]);
  });

  it.each(["expanded", "folded"])("keeps English %s LWH labels consistent", async target => {
    setAdminLang("en");
    setup();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Fill target"), target);
    await user.selectOptions(screen.getByLabelText("Dimension order"), "LWH");
    await user.type(screen.getByLabelText("Paste product dimensions"), "120x60x75cm");
    await user.click(screen.getByRole("button", { name: "Parse dimensions" }));
    expect(within(screen.getByRole("status")).getAllByRole("term").map(row => row.textContent))
      .toEqual(target === "expanded" ? ["Length", "Width", "Height"] : ["Folded length", "Folded width", "Folded height"]);
  });

  it("cancels without applying dimensions", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
  });

  it("closes preview after the exact confirmed patch", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ width: "120", depth: "60", height: "75" });
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
  });

  it("blocks parsing while the form is disabled", () => {
    setup(empty, true);
    expect(screen.getByLabelText("粘贴商品尺寸")).toBeDisabled();
    expect(screen.getByLabelText("填写目标")).toBeDisabled();
    expect(screen.getByRole("button", { name: "解析尺寸" })).toBeDisabled();
  });

  it("blocks applying an existing preview if the form becomes disabled", async () => {
    const { onApply, rerender } = setup();
    const user = await parse();
    rerender(<AdminI18nProvider><ProductDimensionsAssist value={empty} onApply={onApply} disabled /></AdminI18nProvider>);
    expect(screen.getByRole("button", { name: "应用解析值" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
