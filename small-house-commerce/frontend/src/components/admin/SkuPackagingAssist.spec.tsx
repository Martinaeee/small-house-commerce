import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { SkuPackagingAssist } from "./SkuPackagingAssist";

const empty = { packageWidth: null, packageDepth: null, packageHeight: null, packageWeight: null };
function setup(value: Parameters<typeof SkuPackagingAssist>[0]["value"] = empty, disabled = false) {
  const onApply = vi.fn();
  const view = render(<AdminI18nProvider><SkuPackagingAssist value={value} onApply={onApply} disabled={disabled} /></AdminI18nProvider>);
  return { onApply, ...view };
}
async function parse(input = "120 x 60 x 75 cm; 5 kg") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("粘贴包装信息"), input);
  await user.click(screen.getByRole("button", { name: "解析包装信息" }));
  return user;
}

describe("SkuPackagingAssist confirmation boundary", () => {
  beforeEach(() => setAdminLang("zh"));

  it("previews normalized LWH and weight without applying pasted values", async () => {
    const { onApply } = setup();
    await parse();
    const rows = within(screen.getByRole("status")).getAllByRole("term");
    expect(rows.map(row => row.textContent)).toEqual(["长", "宽", "高", "重量"]);
    expect(within(screen.getByRole("status")).getAllByRole("definition").map(row => row.textContent))
      .toEqual(["120 cm", "60 cm", "75 cm", "5 kg"]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("fills only null fields and preserves explicit zero", async () => {
    const { onApply } = setup({ ...empty, packageWidth: 0, packageWeight: 0 });
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ packageDepth: 60, packageHeight: 75 }, "fill-empty");
  });

  it("fills empty legacy strings without replacing zero or unfinished manual input", async () => {
    const { onApply } = setup({ packageWidth: "0", packageDepth: "", packageHeight: "unfinished", packageWeight: "  " });
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ packageDepth: 60, packageWeight: 5 }, "fill-empty");
  });

  it("replaces only parsed fields when replacement is explicitly selected", async () => {
    const { onApply } = setup({ packageWidth: 99, packageDepth: 88, packageHeight: 77, packageWeight: 9 });
    const user = await parse("weight: 5 kg");
    await user.selectOptions(screen.getByLabelText("应用模式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ packageWeight: 5 }, "replace");
    expect(onApply.mock.calls[0][0]).not.toHaveProperty("volumetricWeight");
  });

  it("never applies while the input is merely being edited", async () => {
    const { onApply } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("粘贴包装信息"), "120x60x75cm");
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("invalidates preview when input changes", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.clear(screen.getByLabelText("粘贴包装信息"));
    await user.type(screen.getByLabelText("粘贴包装信息"), "130x70x85cm");
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cancels without any draft mutation", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closes preview after confirmation", async () => {
    const { onApply } = setup();
    const user = await parse();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ packageWidth: 120, packageDepth: 60, packageHeight: 75, packageWeight: 5 }, "fill-empty");
    expect(screen.queryByRole("button", { name: "应用解析值" })).not.toBeInTheDocument();
  });

  it("does not apply an empty result or a volumetric weight", async () => {
    const { onApply } = setup();
    const user = await parse("volumetric weight: 8 kg");
    expect(screen.getByRole("button", { name: "应用解析值" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("disables parsing while the owning form is disabled", () => {
    setup(empty, true);
    expect(screen.getByLabelText("粘贴包装信息")).toBeDisabled();
    expect(screen.getByRole("button", { name: "解析包装信息" })).toBeDisabled();
  });

  it("blocks confirmation if the form becomes disabled after preview", async () => {
    const { onApply, rerender } = setup();
    const user = await parse();
    rerender(<AdminI18nProvider><SkuPackagingAssist value={empty} onApply={onApply} disabled /></AdminI18nProvider>);
    expect(screen.getByRole("button", { name: "应用解析值" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("uses distinct input and mode IDs for separate SKU rows", async () => {
    const user = userEvent.setup();
    render(<AdminI18nProvider>{[1, 2].map(key => <SkuPackagingAssist key={key} value={empty} onApply={vi.fn()} />)}</AdminI18nProvider>);
    const inputs = screen.getAllByLabelText("粘贴包装信息");
    expect(new Set(inputs.map(input => input.id)).size).toBe(2);
    expect(inputs.every(input => input.id !== "")).toBe(true);
    for (const [index, input] of inputs.entries()) {
      await user.type(input, "120x60x75cm");
      await user.click(screen.getAllByRole("button", { name: "解析包装信息" })[index]);
    }
    const modes = screen.getAllByLabelText("应用模式");
    expect(new Set(modes.map(mode => mode.id)).size).toBe(2);
    expect(modes.every(mode => mode.id !== "")).toBe(true);
  });
});
