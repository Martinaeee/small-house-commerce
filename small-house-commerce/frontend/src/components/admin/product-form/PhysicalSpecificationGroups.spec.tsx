import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { canonicalCombinationKey, type AdminCatalogGraphDraft, type AdminSkuDraft } from "@/lib/admin-product-graph";
import { PhysicalSpecificationGroups } from "./PhysicalSpecificationGroups";
import { zh } from "@/i18n/zh";

function fixture(conflict = false): AdminCatalogGraphDraft {
  const sku = (index: number): AdminSkuDraft => ({
    id: `sku-${index}`, skuCode: `C-${index}`, status: "ACTIVE", isBundle: false, bundleVersion: 0,
    price: 100 + index, compareAtPrice: null, supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null,
    productWidth: 100 + index, productDepth: null, productHeight: null, productWeight: null,
    packageWidth: conflict && index === 1 ? 90 : 110,
    packageDepth: null, packageHeight: null, packageWeight: null, volumetricWeight: null, onHand: 5 + index,
  });
  return {
    catalogGraphVersion: 1, defaultDisplayVariantRef: null, media: [],
    options: [{ id: "color", kind: "COLOR", name: "Color", position: 0, presentation: "TEXT", isMediaDriver: false, isActive: true,
      values: ["Red", "Blue"].map((label, index) => ({ id: `value-${index}`, label, position: index, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true })),
    }],
    variants: ["Red", "Blue"].map((name, index) => ({
      id: `variant-${index}`, name, position: index,
      combinationKey: canonicalCombinationKey([{ optionId: "color", valueId: `value-${index}` }]),
      optionValueRefs: [{ id: `value-${index}` }], sku: sku(index),
    })),
  };
}
function Harness({ conflict = false, disabled = false }: { conflict?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(() => fixture(conflict));
  return <AdminI18nProvider>
    <PhysicalSpecificationGroups draft={draft} section="shipping" disabled={disabled} onChange={update => setDraft(current => { const next = structuredClone(current); update(next); return next; })} />
    <output data-testid="physical-draft">{JSON.stringify(draft)}</output>
  </AdminI18nProvider>;
}
function saved() { return JSON.parse(screen.getByTestId("physical-draft").textContent!) as AdminCatalogGraphDraft; }

beforeEach(() => setAdminLang("zh"));
afterEach(cleanup);

describe("PhysicalSpecificationGroups", () => {
  it("keeps decimal typing and writes one packaging field across colors without changing commerce fields", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const fields = screen.getAllByLabelText(/外包装长/);
    expect(fields).toHaveLength(1);
    await user.clear(fields[0]);
    await user.type(fields[0], "42.5");
    expect(fields[0]).toHaveValue("42.5");
    expect(saved().variants.map(v => v.sku?.packageWidth)).toEqual([42.5, 42.5]);
    expect(saved().variants.map(v => v.sku?.price)).toEqual([100, 101]);
    expect(saved().variants.map(v => v.sku?.onHand)).toEqual([5, 6]);
  });

  it("previews a chosen source, cancels without changes, then applies only the confirmed shipping fields", async () => {
    const user = userEvent.setup();
    render(<Harness conflict />);
    const initial = saved();
    await user.click(screen.getByRole("button", { name: "使用 Blue 的规格" }));
    expect(saved()).toEqual(initial);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(saved()).toEqual(initial);
    await user.click(screen.getByRole("button", { name: "使用 Blue 的规格" }));
    await user.click(screen.getByRole("button", { name: "应用组资料" }));
    expect(saved().variants.map(v => v.sku?.packageWidth)).toEqual([90, 90]);
    expect(saved().variants.map(v => v.sku?.productWidth)).toEqual([100, 101]);
    expect(saved().variants.map(v => v.sku?.price)).toEqual([100, 101]);
  });

  it("does not treat mixed fields as empty when applying parsed packaging", async () => {
    const user = userEvent.setup();
    render(<Harness conflict />);
    await user.type(screen.getByLabelText(zh.packaging_assist_label), "120 x 60 x 80 cm");
    await user.click(screen.getByRole("button", { name: zh.packaging_assist_parse }));
    expect(saved().variants.map(v => v.sku?.packageDepth)).toEqual([null, null]);
    await user.click(screen.getByRole("button", { name: zh.packaging_assist_apply }));
    expect(saved().variants.map(v => v.sku?.packageWidth)).toEqual([110, 90]);
    expect(saved().variants.map(v => v.sku?.packageDepth)).toEqual([60, 60]);
    expect(saved().variants.map(v => v.sku?.packageHeight)).toEqual([80, 80]);
  });

  it("preserves mixed fields when parsing is cancelled", async () => {
    const user = userEvent.setup();
    render(<Harness conflict />);
    const initial = saved();
    await user.type(screen.getByLabelText(zh.packaging_assist_label), "120 x 60 x 80 cm");
    await user.click(screen.getByRole("button", { name: zh.packaging_assist_parse }));
    await user.click(screen.getByRole("button", { name: zh.packaging_assist_cancel }));
    expect(saved()).toEqual(initial);
  });

  it("locks input and source selection while the product save or upload is pending", () => {
    render(<Harness conflict disabled />);
    expect(screen.getByRole("button", { name: "使用 Red 的规格" })).toBeDisabled();
    expect(screen.getByLabelText(zh.packaging_assist_label)).toBeDisabled();
    expect(screen.getByLabelText(/外包装长/)).toBeDisabled();
  });
});
