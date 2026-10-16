import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import type {
  AdminCatalogGraphDraft,
  AdminVariantDraft,
} from "@/lib/admin-product-graph";
import type { VariantCandidate } from "@/lib/admin-product-graph";
import { buildVariantCandidates } from "@/lib/admin-product-graph";
import { VariantMatrix } from "@/components/admin/VariantMatrix";
import { PhysicalSpecificationGroups } from "@/components/admin/product-form/PhysicalSpecificationGroups";

/**
 * Task 11 — the 30-row candidate matrix: client-side pagination, bulk edits,
 * lazy row materialization with stable client keys, stock input guardrails,
 * and the protected-disable affordances for persisted rows.
 *
 * Task 3 — the matrix is fully localized through the admin i18n provider
 * (zh default, coherent en), keeps its local horizontal scroller without
 * forcing page-level overflow, and translates the raw SKU status enums while
 * the wire values stay ACTIVE/DISABLED.
 */

function makeCandidates(n: number): VariantCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    combinationKey: `k${i}`,
    name: `Variant ${i + 1}`,
    pairs: [],
    exists: false,
    variantId: null,
  }));
}

function draft(overrides: Partial<AdminCatalogGraphDraft> = {}): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1,
    defaultDisplayVariantRef: null,
    options: [],
    variants: [],
    media: [],
    ...overrides,
  };
}

function persistedVariant(index: number, skuCode: string): AdminVariantDraft {
  return {
    id: `variant-${index + 1}`,
    name: `Variant ${index + 1}`,
    position: index,
    combinationKey: `k${index}`,
    optionValueRefs: [],
    sku: {
      id: `sku-${index + 1}`,
      skuCode,
      status: "ACTIVE",
      isBundle: false,
      bundleVersion: 0,
      supplierSku: null,
      supplierCost: null,
      costCurrency: null,
      landedCost: null,
      price: null,
      compareAtPrice: null,
      productWidth: null, productDepth: null, productHeight: null, productWeight: null,
      packageWidth: null,
      packageHeight: null,
      packageDepth: null,
      packageWeight: null,
      volumetricWeight: null,
      onHand: 0,
    },
  };
}

function withProvider(children: ReactNode): ReactNode {
  return <AdminI18nProvider>{children}</AdminI18nProvider>;
}

function Harness({
  candidates,
  initial,
  productDimensions = null,
  pending = false,
}: {
  candidates: VariantCandidate[];
  initial: AdminCatalogGraphDraft;
  productDimensions?: { width: number | null; depth: number | null; height: number | null } | null;
  pending?: boolean;
}) {
  return withProvider(
    <GraphDraftHarness
      initial={initial}
      render={(draft, onChange) => (
        <VariantMatrix candidates={candidates} draft={draft} onChange={onChange} productDimensions={productDimensions} pending={pending} />
      )}
    />,
  );
}

function draftVariants(): AdminVariantDraft[] {
  return (draftJson() as AdminCatalogGraphDraft).variants;
}

describe("VariantMatrix", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function dimensionGraph(count = 2): AdminCatalogGraphDraft {
    const initial = draft({ options: [{
      clientKey: "color", kind: "COLOR", name: "Color", position: 0,
      presentation: "TEXT", isMediaDriver: false, isActive: true,
      values: Array.from({ length: count }, (_, index) => ({
        clientKey: `value-${index}`, label: `Variant ${index + 1}`, position: index,
        swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true,
      })),
    }] });
    initial.variants = buildVariantCandidates(initial).map((candidate, index) => ({
      ...persistedVariant(index, `DIM-${index + 1}`),
      combinationKey: candidate.combinationKey,
      optionValueRefs: [{ clientKey: `value-${index}` }],
    }));
    return initial;
  }

  describe("SKU product dimension editing", () => {
    const parent = { width: 100, depth: 50, height: 70 };
    const dimensions = { productWidth: 120, productDepth: 60, productHeight: 75 };
    function renderDimensions(initial: AdminCatalogGraphDraft, productDimensions: typeof parent | null = parent, pending = false) {
      return render(withProvider(<GraphDraftHarness initial={initial} render={(current, onChange) => <>
        <VariantMatrix candidates={buildVariantCandidates(current)} draft={current} onChange={onChange} productDimensions={productDimensions} pending={pending} />
        <PhysicalSpecificationGroups draft={current} onChange={onChange} section="dimensions" productDimensions={productDimensions} disabled={pending} />
      </>} />));
    }

    it("orders group inputs as LWH and displays inherited product values without copying them", () => {
      const initial = dimensionGraph(1);
      renderDimensions(initial);
      const inputs = screen.getAllByRole("textbox").filter(input => input.getAttribute("aria-label")?.includes("的商品"));
      expect(inputs.map(input => input.getAttribute("aria-label"))).toEqual([
        "Variant 1 的商品长（cm）", "Variant 1 的商品宽（cm）", "Variant 1 的商品高（cm）",
      ]);
      inputs.forEach(input => expect(input).toHaveValue(""));
      for (const value of [100, 50, 70]) expect(screen.getByText(`继承商品：${value} cm`)).toBeVisible();
      expect(draftJson()).toEqual(initial);
    });

    it("edits only dimension overrides and clearing one input restores only that axis", async () => {
      const user = userEvent.setup();
      const initial = dimensionGraph(1);
      Object.assign(initial.variants[0].sku!, { packageWidth: 130, packageDepth: 70, packageHeight: 85, packageWeight: 5, volumetricWeight: 9 });
      renderDimensions(initial);
      await user.type(screen.getByLabelText("Variant 1 的商品长（cm）"), "120");
      await user.type(screen.getByLabelText("Variant 1 的商品宽（cm）"), "60");
      await user.type(screen.getByLabelText("Variant 1 的商品高（cm）"), "75");
      expect(draftVariants()[0]).toEqual({ ...initial.variants[0], sku: { ...initial.variants[0].sku!, ...dimensions } });
      for (const value of [120, 60, 75]) expect(screen.getByText(`${value} cm`)).toBeVisible();
      await user.clear(screen.getByLabelText("Variant 1 的商品长（cm）"));
      expect(draftVariants()[0].sku).toMatchObject({ productWidth: null, productDepth: 60, productHeight: 75 });
      expect(screen.getByText("继承商品：100 cm")).toBeVisible();
    });

    it("clears all three group overrides without changing other SKU fields", async () => {
      const user = userEvent.setup();
      const initial = dimensionGraph(1);
      const inherited = structuredClone(initial.variants[0]);
      Object.assign(initial.variants[0].sku!, dimensions);
      renderDimensions(initial);
      await user.click(screen.getByRole("button", { name: "恢复组内商品尺寸继承" }));
      expect(draftVariants()[0]).toEqual(inherited);
    });

    it("fills empty independent STYLE groups, reports counts, and never materializes an abstract candidate", async () => {
      const user = userEvent.setup();
      const initial = dimensionGraph(3);
      initial.options[0].kind = "STYLE";
      initial.variants.pop();
      Object.assign(initial.variants[1].sku!, dimensions);
      renderDimensions(initial);
      await user.click(screen.getByRole("button", { name: "仅填空尺寸" }));
      expect(draftVariants()).toHaveLength(2);
      expect(draftVariants()[0].sku).toMatchObject({ productWidth: 100, productDepth: 50, productHeight: 70 });
      expect(draftVariants()[1].sku).toMatchObject(dimensions);
      expect(screen.getByText("已更新 1 个 SKU，跳过 1 个")).toBeVisible();
      expect(screen.queryByLabelText("Variant 3 的商品长（cm）")).not.toBeInTheDocument();
    });

    it("applies to eligible SKUs on every page, not just the visible thirty rows", async () => {
      const user = userEvent.setup();
      const initial = dimensionGraph(31);
      renderDimensions(initial);
      await user.click(screen.getByRole("button", { name: "应用商品尺寸到全部已有 SKU" }));
      expect(draftVariants()).toHaveLength(31);
      draftVariants().forEach(row => expect(row.sku).toMatchObject({ productWidth: 100, productDepth: 50, productHeight: 70 }));
      expect(screen.getByText("已更新 31 个 SKU，跳过 0 个")).toBeVisible();
    });

    it("disables group dimensions and bulk actions during save", () => {
      const initial = dimensionGraph(1);
      Object.assign(initial.variants[0].sku!, dimensions);
      renderDimensions(initial, parent, true);
      expect(screen.getByLabelText("Variant 1 的商品长（cm）")).toBeDisabled();
      expect(screen.getByRole("button", { name: "恢复组内商品尺寸继承" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "仅填空尺寸" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "应用商品尺寸到全部已有 SKU" })).toBeDisabled();
    });

    it("does not expose dimension writes for a disabled SKU", () => {
      const initial = dimensionGraph(1);
      initial.variants[0].sku!.status = "DISABLED";
      Object.assign(initial.variants[0].sku!, dimensions);
      renderDimensions(initial);
      expect(screen.queryByLabelText("Variant 1 的商品长（cm）")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "恢复组内商品尺寸继承" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "应用商品尺寸到全部已有 SKU" })).toBeDisabled();
      expect(draftJson()).toEqual(initial);
    });

    it("does not offer a bulk copy when product defaults are absent", () => {
      const initial = dimensionGraph(1);
      renderDimensions(initial, null);
      expect(screen.getByRole("button", { name: "应用商品尺寸到全部已有 SKU" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "仅填空尺寸" })).toBeDisabled();
      expect(screen.getAllByText("继承商品（未设置）")).toHaveLength(3);
    });

    it("preserves a zero-valued product default as an explicit copied override", async () => {
      const user = userEvent.setup();
      const initial = dimensionGraph(1);
      renderDimensions(initial, { ...parent, width: 0 });
      expect(screen.getByText("继承商品：0 cm")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "仅填空尺寸" }));
      expect(draftVariants()[0].sku!.productWidth).toBe(0);
      expect(screen.getByLabelText("Variant 1 的商品长（cm）")).toHaveValue("0");
    });

    it("keeps English group LWH labels and inheritance copy coherent", () => {
      setAdminLang("en");
      const initial = dimensionGraph(1);
      renderDimensions(initial);
      expect(screen.getByLabelText("Product length (cm) for Variant 1")).toHaveValue("");
      expect(screen.getByLabelText("Product width (cm) for Variant 1")).toHaveValue("");
      expect(screen.getByLabelText("Product height (cm) for Variant 1")).toHaveValue("");
      expect(screen.getByText("Inherited: 100 cm")).toBeVisible();
      expect(screen.getByRole("button", { name: "Fill empty dimensions" })).toBeEnabled();
    });
  });

  function retainedDefaultGraph(): AdminCatalogGraphDraft {
    const colors = ["Gray", "Green", "Orange"];
    const rows = colors.map((name, index) => {
      const row = persistedVariant(index, `CH002-${name}`);
      row.id = undefined;
      row.clientKey = `color-${index}`;
      row.name = name;
      row.optionValueRefs = [{ clientKey: `value-${index}` }];
      row.sku = { ...row.sku!, id: undefined, price: 3499, compareAtPrice: 3999, onHand: 6 };
      row.cardMedia = { cover: { type: "IMAGE", url: `/uploads/${name}.webp`, altText: name }, hover: null };
      return row;
    });
    const old = persistedVariant(3, "");
    old.id = undefined;
    old.clientKey = "variant-";
    old.name = "Default";
    old.combinationKey = "";
    old.sku = { ...old.sku!, id: undefined, price: 3499, onHand: 6, packageWeight: 12, packageWidth: 85 };
    return JSON.parse(JSON.stringify(draft({
      defaultDisplayVariantRef: { clientKey: "variant-" },
      options: [{
        clientKey: "color", kind: "COLOR", name: "Color", position: 0,
        presentation: "TEXT", isMediaDriver: true, isActive: true,
        values: colors.map((label, index) => ({ clientKey: `value-${index}`, label, position: index, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true })),
      }],
      variants: [...rows, old],
      media: [
        { clientKey: "shared", url: "/uploads/shared.webp", type: "IMAGE", sortOrder: 0, altText: null, optionValueRef: null, variantRef: null },
        { clientKey: "color-media", url: "/uploads/color.webp", type: "IMAGE", sortOrder: 1, altText: null, optionValueRef: { clientKey: "value-0" }, variantRef: null },
        { clientKey: "old-media", url: "/uploads/default.webp", type: "IMAGE", sortOrder: 2, altText: null, optionValueRef: null, variantRef: { clientKey: "variant-" } },
      ],
    }))) as AdminCatalogGraphDraft;
  }

  it("shows a retained Default in the matrix without allowing it to become another color SKU", () => {
    const initial = retainedDefaultGraph();
    render(<Harness candidates={makeCandidates(3)} initial={initial} />);

    expect(screen.getByLabelText("Default 的库存")).toHaveValue("6");
    expect(screen.getByLabelText("Default 的 SKU 编码")).toBeDisabled();
    expect(screen.getByRole("button", { name: "移除临时款式 Default" })).toBeEnabled();
    expect(screen.getByText(/临时款式.*当前选项/)).toBeInTheDocument();
    const retainedRow = screen.getByLabelText("Default 的库存").closest("tr")!;
    expect(within(retainedRow).getAllByRole("cell")).toHaveLength(screen.getAllByRole("columnheader").length);
    expect(draftJson()).toEqual(initial);
  });

  it("keeps every draft field when removal is cancelled", async () => {
    const user = userEvent.setup();
    const initial = retainedDefaultGraph();
    render(<Harness candidates={makeCandidates(3)} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "移除临时款式 Default" }));
    const dialog = screen.getByRole("dialog", { name: "移除临时款式 Default" });
    expect(dialog).toHaveTextContent("专属媒体关联");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(draftJson()).toEqual(initial);
  });

  it("removes only the confirmed Default and its own media/default reference", async () => {
    const user = userEvent.setup();
    const initial = retainedDefaultGraph();
    render(<Harness candidates={makeCandidates(3)} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "移除临时款式 Default" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认移除" }));

    expect(draftJson()).toEqual({
      ...initial,
      variants: initial.variants.slice(0, 3),
      media: initial.media.slice(0, 2),
      defaultDisplayVariantRef: null,
    });
    expect(screen.queryByLabelText("Default 的库存")).not.toBeInTheDocument();
  });

  it("materializes new SKU dimensions as inherited nulls without changing its identity or stock defaults", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);
    expect(draftVariants()).toEqual([]);
    await user.type(screen.getByLabelText("Variant 1 的 SKU 编码"), "DIM-1");
    expect(draftVariants()).toHaveLength(1);
    expect(draftVariants()[0]).toMatchObject({
      clientKey: "variant-k0",
      combinationKey: "k0",
      sku: {
        skuCode: "DIM-1",
        productWidth: null,
        productDepth: null,
        productHeight: null,
        price: null,
        onHand: 0,
      },
    });
  });

  it("keeps the retained Default accessible on later matrix pages", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(31)} initial={retainedDefaultGraph()} />);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByLabelText("Default 的库存")).toHaveValue("6");
  });

  it("lets the operator inspect the retained packaging before removing Default", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(3)} initial={retainedDefaultGraph()} />);
    await user.click(screen.getByText("查看保留的资料"));
    expect(screen.getByText("12 kg")).toBeVisible();
    expect(screen.getByText("85 cm")).toBeVisible();
  });

  it("does not overwrite Default when bulk-editing real color candidates", async () => {
    const user = userEvent.setup();
    const initial = retainedDefaultGraph();
    render(<Harness candidates={makeCandidates(3)} initial={initial} />);
    await user.type(screen.getByLabelText("批量库存"), "9");
    await user.click(screen.getByRole("button", { name: "本页统一库存" }));
    expect(draftVariants().slice(0, 3).map(row => row.sku?.onHand)).toEqual([9, 9, 9]);
    expect(draftVariants()[3]).toEqual(initial.variants[3]);
  });

  it.each(["persisted", "referenced", "persisted-sku"])("never offers hard removal for a %s identity", (kind) => {
    const initial = retainedDefaultGraph();
    const old = initial.variants[3];
    if (kind === "persisted") old.id = "saved-variant";
    if (kind === "referenced") old.hasReferences = true;
    if (kind === "persisted-sku") old.sku!.id = "saved-sku";
    render(<Harness candidates={makeCandidates(3)} initial={initial} />);
    expect(screen.queryByRole("button", { name: "移除临时款式 Default" })).not.toBeInTheDocument();
    expect(draftJson()).toEqual(initial);
  });

  function skuOf(skuCode: string, overrides: Partial<NonNullable<AdminVariantDraft["sku"]>> = {}) {
    return {
      skuCode, status: "ACTIVE" as const, isBundle: false, bundleVersion: 0, supplierSku: null, supplierCost: null,
      costCurrency: null, landedCost: null, price: 3799, compareAtPrice: null,
      productWidth: null, productDepth: null, productHeight: null, productWeight: null, packageWidth: null, packageHeight: null,
      packageDepth: null, packageWeight: null, volumetricWeight: null, onHand: 4,
      ...overrides,
    };
  }

  /** The operator added Color, filled both colours, then added Style. */
  function staleColorGraph(): { graph: AdminCatalogGraphDraft; candidates: VariantCandidate[] } {
    const values = (prefix: string, labels: string[]) => labels.map((label, index) => ({
      clientKey: `${prefix}-${index}`, label, position: index,
      swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true,
    }));
    const graph = draft({
      options: [
        { clientKey: "color", kind: "COLOR", name: "Color", position: 0, presentation: "SWATCH", isMediaDriver: false, isActive: true, values: values("color", ["White", "Walnut"]) },
        { clientKey: "style", kind: "STYLE", name: "Style", position: 1, presentation: "TEXT", isMediaDriver: false, isActive: true, values: values("style", ["Pneumatic Flip"]) },
      ],
      variants: [
        { clientKey: "row-white", name: "White", position: 0, combinationKey: "stale-white", optionValueRefs: [{ clientKey: "color-0" }], sku: skuOf("TB001-White") },
        { clientKey: "row-walnut", name: "Walnut", position: 1, combinationKey: "stale-walnut", optionValueRefs: [{ clientKey: "color-1" }], sku: skuOf("TB001-Walnut") },
      ],
    });
    return { graph, candidates: buildVariantCandidates(graph) };
  }

  it("lists stale colour-only rows as removable leftovers beside the real combinations", () => {
    const { graph, candidates } = staleColorGraph();
    render(<Harness candidates={candidates} initial={graph} />);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["White / Pneumatic Flip", "Walnut / Pneumatic Flip"]);
    const leftoverCode = screen.getByLabelText("White 的 SKU 编码");
    expect(leftoverCode).toHaveValue("TB001-White");
    expect(leftoverCode).toBeDisabled();
    expect(screen.getByLabelText("Walnut 的库存")).toHaveValue("4");
    expect(screen.getByRole("button", { name: "移除临时款式 White" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "移除临时款式 Walnut" })).toBeEnabled();
    expect(screen.getByLabelText("White / Pneumatic Flip 的 SKU 编码")).toBeEnabled();
    expect(draftJson()).toEqual(graph);
  });

  it("removes only the confirmed stale row and keeps the other one and the combinations", async () => {
    const user = userEvent.setup();
    const { graph, candidates } = staleColorGraph();
    render(<Harness candidates={candidates} initial={graph} />);

    await user.click(screen.getByRole("button", { name: "移除临时款式 White" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认移除" }));

    expect(draftVariants().map((row) => row.clientKey)).toEqual(["row-walnut"]);
    expect(screen.getByRole("button", { name: "移除临时款式 Walnut" })).toBeInTheDocument();
    expect(screen.getByLabelText("White / Pneumatic Flip 的 SKU 编码")).toBeEnabled();
  });

  it("keeps bulk edits off the stale rows", async () => {
    const user = userEvent.setup();
    const { graph, candidates } = staleColorGraph();
    render(<Harness candidates={candidates} initial={graph} />);

    await user.type(screen.getByLabelText("批量库存"), "9");
    await user.click(screen.getByRole("button", { name: "本页统一库存" }));

    const rows = draftVariants();
    expect(rows.filter((row) => row.clientKey?.startsWith("row-")).map((row) => row.sku?.onHand)).toEqual([4, 4]);
    expect(rows.filter((row) => !row.clientKey?.startsWith("row-")).map((row) => row.sku?.onHand)).toEqual([9, 9]);
  });

  it("preserves an existing card pair through edits and never copies it to a new combination", async () => {
    const user = userEvent.setup();
    const row = persistedVariant(0, "SKU-1");
    row.cardMedia = { cover: { type: "IMAGE", url: "/uploads/one.webp", altText: null }, hover: null };
    render(<Harness candidates={makeCandidates(2)} initial={draft({ variants: [row] })} />);
    await user.clear(screen.getByLabelText("Variant 1 的 SKU 编码"));
    await user.type(screen.getByLabelText("Variant 1 的 SKU 编码"), "RENAMED");
    await user.type(screen.getByLabelText("Variant 2 的 SKU 编码"), "NEW");
    expect(draftVariants().find(row => row.id === "variant-1")).toMatchObject({ cardMedia: row.cardMedia, sku: { id: "sku-1", skuCode: "RENAMED" } });
    expect(draftVariants().find(row => row.clientKey)?.cardMedia ?? null).toBeNull();
  });

  it("opens and focuses the persisted requested SKU across matrix pages without timers", () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoView = vi.spyOn(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const candidates = makeCandidates(31);
    const graph = draft({
      variants: [
        persistedVariant(0, "SKU-1"),
        persistedVariant(30, "SKU-31"),
      ],
    });
    const renderMatrix = (requestedSkuCode: string | null) =>
      withProvider(
        <VariantMatrix
          candidates={candidates}
          draft={graph}
          onChange={() => {}}
          requestedSkuCode={requestedSkuCode}
        />,
      );

    const view = render(renderMatrix("SKU-31"));
    expect(screen.getByLabelText("Variant 31 的 SKU 编码")).toHaveFocus();
    expect(screen.getByText("第 2 / 2 页")).toBeVisible();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

    view.rerender(renderMatrix("SKU-1"));
    expect(screen.getByLabelText("Variant 1 的 SKU 编码")).toHaveFocus();
    expect(screen.getByText("第 1 / 2 页")).toBeVisible();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

    view.rerender(renderMatrix("UNKNOWN"));
    expect(screen.getByLabelText("Variant 1 的 SKU 编码")).toHaveFocus();
    expect(screen.getByText("第 1 / 2 页")).toBeVisible();
  });

  it("renders only the current thirty-row matrix page", () => {
    render(withProvider(<VariantMatrix candidates={makeCandidates(31)} />));

    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });

  it("paginates to the remaining rows and back", async () => {
    const user = userEvent.setup();
    render(withProvider(<VariantMatrix candidates={makeCandidates(31)} />));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Variant 31")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "上一页" }));
    expect(screen.getByText("Variant 1")).toBeInTheDocument();
  });

  it("applies bulk price only to the rows on the current page", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(31)} initial={draft()} />);

    await user.type(screen.getByLabelText("批量售价"), "199");
    await user.click(screen.getByRole("button", { name: "本页统一售价" }));

    const rows = draftVariants();
    expect(rows).toHaveLength(30); // page 1 only; row 31 untouched
    expect(rows[0].sku?.price).toBe(199);
    expect(rows[29].sku?.price).toBe(199);
    expect(rows[0].clientKey).toBe("variant-k0");
    expect(rows.find((row) => row.combinationKey === "k30")).toBeUndefined();
  });

  it("materializes a draft row with a SKU on first edit and keeps its client key stable", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    await user.type(screen.getByLabelText("Variant 1 的 SKU 编码"), "SH-001");
    await user.type(screen.getByLabelText("Variant 1 的售价"), "1299");

    const rows = draftVariants();
    expect(rows).toHaveLength(1);
    expect(rows[0].clientKey).toBe("variant-k0");
    expect(rows[0].name).toBe("Variant 1");
    expect(rows[0].sku?.skuCode).toBe("SH-001");
    expect(rows[0].sku?.price).toBe(1299);
    expect(rows[0].sku?.onHand).toBe(0);
  });

  it("edits stock of an existing persisted row without duplicating it", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        candidates={makeCandidates(1)}
        initial={draft({
          variants: [
            {
              id: "variant-1",
              name: "Variant 1",
              position: 0,
              combinationKey: "k0",
              optionValueRefs: [],
              hasReferences: true,
              sku: {
                id: "sku-1",
                skuCode: "SH-001",
                status: "ACTIVE",
                isBundle: false,
                bundleVersion: 0,
                supplierSku: null,
                supplierCost: null,
                costCurrency: null,
                landedCost: null,
                price: 1299,
                compareAtPrice: null,
                productWidth: null, productDepth: null, productHeight: null, productWeight: null,
                packageWidth: null,
                packageHeight: null,
                packageDepth: null,
                packageWeight: null,
                volumetricWeight: null,
                onHand: 4,
              },
            },
          ],
        })}
      />,
    );

    const stock = screen.getByLabelText("Variant 1 的库存");
    await user.clear(stock);
    await user.type(stock, "6");
    const rows = draftVariants();
    expect(rows).toHaveLength(1);
    expect(rows[0].sku?.onHand).toBe(6);
    expect(rows[0].sku?.id).toBe("sku-1");
  });

  it("rejects non-integer stock input with a row warning and no draft change", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        candidates={makeCandidates(1)}
        initial={draft({
          variants: [
            {
              id: "variant-1",
              name: "Variant 1",
              position: 0,
              combinationKey: "k0",
              optionValueRefs: [],
              sku: null,
            },
          ],
        })}
      />,
    );

    await user.type(screen.getByLabelText("Variant 1 的库存"), "x");
    expect(screen.getByText(/库存必须是 0 以上的整数/)).toBeInTheDocument();
    expect(draftVariants()[0].sku).toBeNull();
  });

  it("preserves character-by-character decimal price and compare-at input", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    await user.type(screen.getByLabelText("Variant 1 的售价"), "19.95");
    await user.type(screen.getByLabelText("Variant 1 的划线价"), "29.5");

    expect(screen.getByLabelText("Variant 1 的售价")).toHaveValue("19.95");
    expect(screen.getByLabelText("Variant 1 的划线价")).toHaveValue("29.5");
    expect(draftVariants()[0].sku?.price).toBe(19.95);
    expect(draftVariants()[0].sku?.compareAtPrice).toBe(29.5);
  });

  it("clears an edited decimal when its draft-only row is removed", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    const price = screen.getByLabelText("Variant 1 的售价");
    await user.type(price, "5");
    await user.click(screen.getByRole("button", { name: "移除该行" }));

    expect(draftVariants()).toHaveLength(0);
    expect(price).toHaveValue("");
  });

  it("flags a priced row that still has no SKU code", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    await user.type(screen.getByLabelText("Variant 1 的售价"), "1299");
    expect(screen.getByText(/保存前需要填写 SKU 编码/)).toBeInTheDocument();
  });

  it("offers Remove for draft-only rows but only protected disable for persisted rows", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        candidates={makeCandidates(2)}
        initial={draft({
          variants: [
            {
              id: "variant-1",
              name: "Variant 1",
              position: 0,
              combinationKey: "k0",
              optionValueRefs: [],
              hasReferences: true,
              sku: null,
            },
          ],
        })}
      />,
    );

    const persistedRow = screen.getByText("Variant 1").closest("tr");
    expect(persistedRow).not.toBeNull();
    expect(within(persistedRow!).queryByRole("button", { name: "移除该行" })).not.toBeInTheDocument();
    expect(
      within(persistedRow!).getByText(/有订单\/库存引用/),
    ).toBeInTheDocument();

    const draftRow = screen.getByText("Variant 2").closest("tr");
    await user.click(within(draftRow!).getByRole("button", { name: "移除该行" }));
    const rows = draftVariants();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("variant-1");
  });

  it("toggles SKU status through the row select", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        candidates={makeCandidates(1)}
        initial={draft({
          variants: [
            {
              id: "variant-1",
              name: "Variant 1",
              position: 0,
              combinationKey: "k0",
              optionValueRefs: [],
              sku: {
                id: "sku-1",
                skuCode: "SH-001",
                status: "ACTIVE",
                isBundle: false,
                bundleVersion: 0,
                supplierSku: null,
                supplierCost: null,
                costCurrency: null,
                landedCost: null,
                price: null,
                compareAtPrice: null,
                productWidth: null, productDepth: null, productHeight: null, productWeight: null,
                packageWidth: null,
                packageHeight: null,
                packageDepth: null,
                packageWeight: null,
                volumetricWeight: null,
                onHand: 0,
              },
            },
          ],
        })}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Variant 1 的状态" }),
      "DISABLED",
    );
    expect(draftVariants()[0].sku?.status).toBe("DISABLED");
  });

  it("translates the raw SKU status enums while the option values stay wire values", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    await user.type(screen.getByLabelText("Variant 1 的 SKU 编码"), "SH-001");
    const status = screen.getByRole("combobox", { name: "Variant 1 的状态" });
    expect(screen.getByRole("option", { name: "在售" })).toHaveAttribute("value", "ACTIVE");
    expect(screen.getByRole("option", { name: "停售" })).toHaveAttribute("value", "DISABLED");

    await user.selectOptions(status, "DISABLED");
    expect(draftVariants()[0].sku?.status).toBe("DISABLED");
  });

  it("keeps a local horizontal scroller with an explicit narrow-screen hint", () => {
    render(withProvider(<VariantMatrix candidates={makeCandidates(31)} />));

    expect(screen.getByText(/表格可横向滚动/)).toBeInTheDocument();
    const scroller = screen.getByRole("table").parentElement;
    expect(scroller?.className).toContain("overflow-x-auto");
  });

  it("lets a new SKU choose virtual mode and keeps it out of physical stock controls", async () => {
    setAdminLang("en");
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);
    await user.click(screen.getByRole("checkbox", { name: "Virtual Bundle for Variant 1" }));
    expect(draftVariants()[0].sku).toMatchObject({ isBundle: true, bundleVersion: 0, onHand: 0 });
    expect(screen.queryByLabelText("Stock for Variant 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search component SKUs")).toBeEnabled();
    expect(screen.getByText("Save the product to save these components with its new SKU.")).toBeVisible();
  });

  it.each([true, false])("keeps persisted SKU mode immutable when virtual=%s", async isBundle => {
    setAdminLang("en");
    const row = persistedVariant(0, "SET-1");
    row.sku!.isBundle = isBundle;
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft({ variants: [row] })} />);
    const checkbox = screen.getByRole("checkbox", { name: "Virtual Bundle for Variant 1" });
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveProperty("checked", isBundle);
    await user.click(checkbox);
    expect(draftVariants()[0].sku!.isBundle).toBe(isBundle);
  });

  it("applies bulk stock only to ordinary SKUs without changing virtual drafts", async () => {
    setAdminLang("en");
    const virtual = persistedVariant(0, "SET-1");
    virtual.sku!.isBundle = true;
    const ordinary = persistedVariant(1, "CHAIR-1");
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(2)} initial={draft({ variants: [virtual, ordinary] })} />);
    await user.type(screen.getByLabelText("Bulk stock"), "12");
    await user.click(screen.getByRole("button", { name: "Apply stock to page" }));
    expect(draftVariants()[0]).toEqual(virtual);
    expect(draftVariants()[1].sku!.onHand).toBe(12);
  });

  it("renders a coherent English matrix through the same provider", () => {
    setAdminLang("en");
    render(withProvider(<VariantMatrix candidates={makeCandidates(1)} />));

    expect(screen.getByText("Variant matrix")).toBeInTheDocument();
    expect(screen.getByLabelText("Bulk price")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply price to page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByText("The table scrolls horizontally to show all columns.")).toBeInTheDocument();
  });
});
