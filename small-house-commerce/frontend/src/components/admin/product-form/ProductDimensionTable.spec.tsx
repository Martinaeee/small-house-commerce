import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { dimensionFixture } from "@/lib/admin-dimension-import.test-utils";
import type { ProductFormValue } from "../ProductForm";
import { ProductDimensionTable } from "./ProductDimensionTable";

function Harness({ initial = dimensionFixture(), disabled = false }: { initial?: ProductFormValue; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <AdminI18nProvider><ProductDimensionTable value={value} onChange={setValue} disabled={disabled} /><output data-testid="dimension-form">{JSON.stringify(value)}</output></AdminI18nProvider>;
}
function saved(): ProductFormValue { return JSON.parse(screen.getByTestId("dimension-form").textContent!); }
beforeEach(() => setAdminLang("zh"));
afterEach(cleanup);

describe("ProductDimensionTable", () => {
  it("shows one row per physical group and keeps inheritance separate from color sharing", () => {
    render(<Harness />);
    const table = screen.getByRole("table", { name: "变体尺寸" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByText("继承尺寸")).toHaveLength(2);
    expect(within(table).getAllByText("2 个 SKU 共用")).toHaveLength(2);
  });
  it("previews every affected color, cancels without writes, then applies only on confirmation", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const before = saved();
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    let dialog = screen.getByRole("dialog", { name: "批量导入尺寸" });
    await user.type(within(dialog).getByLabelText("粘贴尺寸表"), "S-0\t800x400x900mm");
    await user.selectOptions(within(dialog).getByLabelText("尺寸顺序"), "LWH");
    await user.click(within(dialog).getByRole("button", { name: "解析尺寸" }));
    expect(within(dialog).getByText("S-1", { exact: false })).toBeVisible();
    expect(saved()).toEqual(before);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(saved()).toEqual(before);
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    dialog = screen.getByRole("dialog", { name: "批量导入尺寸" });
    await user.type(within(dialog).getByLabelText("粘贴尺寸表"), "S-0\t800x400x900mm");
    await user.selectOptions(within(dialog).getByLabelText("尺寸顺序"), "LWH");
    await user.click(within(dialog).getByRole("button", { name: "解析尺寸" }));
    expect(within(dialog).getByRole("button", { name: "应用到选中变体" })).toBeDisabled();
    await user.click(within(dialog).getByLabelText("我已核对尺寸、覆盖值及全部受影响 SKU"));
    await user.click(within(dialog).getByRole("button", { name: "应用到选中变体" }));
    expect(saved().graph!.variants.map(row => row.sku!.productWidth)).toEqual([80, 80, null, null]);
    expect(saved().graph!.variants.map(row => row.sku!.price)).toEqual([100, 101, 102, 103]);
  });
  it("blocks a selected invalid row rather than applying the valid subset", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const before = saved();
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("粘贴尺寸表"), "S-0\t120x60x75cm\nMISSING\t80x40x90cm");
    await user.selectOptions(within(dialog).getByLabelText("尺寸顺序"), "LWH");
    await user.click(within(dialog).getByRole("button", { name: "解析尺寸" }));
    expect(within(dialog).getByText("未匹配到唯一的变体或 SKU")).toBeVisible();
    await user.click(within(dialog).getByLabelText("我已核对尺寸、覆盖值及全部受影响 SKU"));
    expect(within(dialog).getByRole("button", { name: "应用到选中变体" })).toBeDisabled();
    expect(saved()).toEqual(before);
  });
  it("gives the convention controls concise accessible names", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "尺寸顺序" })).toBeVisible();
    expect(within(dialog).getByRole("combobox", { name: "未标单位时使用" })).toBeVisible();
  });
  it("retains oversized pasted text and blocks parsing instead of silently truncating it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("粘贴尺寸表");
    const text = `S-0\t${" ".repeat(100_000)}120x60x75cm`;
    await user.click(input);
    await user.paste(text);
    expect(input).toHaveValue(text);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("100000");
    expect(within(dialog).getByRole("button", { name: "解析尺寸" })).toBeDisabled();
  });
  it("rejects overly wide tables without creating thousands of mapping controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("粘贴尺寸表"));
    await user.paste(Array.from({ length: 21 }, (_, index) => `列${index}`).join("\t"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("20");
    expect(within(dialog).getAllByRole("combobox").length).toBeLessThanOrEqual(4);
    expect(within(dialog).getByRole("button", { name: "解析尺寸" })).toBeDisabled();
  });
  it("treats unknown prototype-named factory headers as ignored columns without crashing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "批量导入" }));
    const dialog = screen.getByRole("dialog");
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.message); event.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      await user.click(within(dialog).getByLabelText("粘贴尺寸表"));
      await user.paste("SKU\tconstructor\t长(cm)\t宽(cm)\t高(cm)\nS-0\tunused\t120\t60\t75");
      expect(errors).toEqual([]);
      expect(within(dialog).getByLabelText("第 2 列")).toHaveValue("ignore");
      await user.click(within(dialog).getByRole("button", { name: "解析尺寸" }));
      expect(errors).toEqual([]);
      await user.click(within(dialog).getByLabelText("我已核对尺寸、覆盖值及全部受影响 SKU"));
      await user.click(within(dialog).getByRole("button", { name: "应用到选中变体" }));
      expect(saved().graph!.variants.map(row => row.sku!.productWidth)).toEqual([120, 120, null, null]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
  it("edits only touched fields and lets a row edit be cancelled", async () => {
    const user = userEvent.setup();
    const initial = dimensionFixture();
    initial.graph!.variants[0].sku!.productWidth = 100;
    render(<Harness initial={initial} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.type(screen.getByLabelText("3-Tier 高（cm）"), "80");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(saved()).toEqual(initial);
    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.type(screen.getByLabelText("3-Tier 高（cm）"), "80");
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(saved().graph!.variants.slice(0, 2).map(row => row.sku!.productWidth)).toEqual([100, null]);
    expect(saved().graph!.variants.slice(0, 2).map(row => row.sku!.productHeight)).toEqual([80, 80]);
  });
  it("requires an explicit confirmation before clearing only group dimension overrides", async () => {
    const user = userEvent.setup();
    const initial = dimensionFixture();
    initial.graph!.variants.slice(0, 2).forEach(row => Object.assign(row.sku!, { productWidth: 120, productDepth: 60, productHeight: 75 }));
    render(<Harness initial={initial} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    await user.click(within(row).getByRole("button", { name: "使用默认尺寸" }));
    expect(saved()).toEqual(initial);
    await user.click(screen.getByRole("button", { name: "确认使用默认尺寸" }));
    expect(saved().graph!.variants[0].sku).toMatchObject({ productWidth: null, productDepth: null, productHeight: null, packageWidth: 130, productWeight: 4 });
    expect(saved().foldedWidth).toBe("30");
  });
  it("disables all dimension mutations during a save or upload", () => {
    render(<Harness disabled />);
    expect(screen.getByRole("button", { name: "批量导入" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "独立填写" }).every(button => button.hasAttribute("disabled"))).toBe(true);
  });
});
