import { describe, expect, it, beforeEach } from "vitest";
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
import { VariantMatrix } from "@/components/admin/VariantMatrix";

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

function withProvider(children: ReactNode): ReactNode {
  return <AdminI18nProvider>{children}</AdminI18nProvider>;
}

function Harness({
  candidates,
  initial,
}: {
  candidates: VariantCandidate[];
  initial: AdminCatalogGraphDraft;
}) {
  return withProvider(
    <GraphDraftHarness
      initial={initial}
      render={(draft, onChange) => (
        <VariantMatrix candidates={candidates} draft={draft} onChange={onChange} />
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
                supplierSku: null,
                supplierCost: null,
                costCurrency: null,
                landedCost: null,
                price: 1299,
                compareAtPrice: null,
                productWeight: null,
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
                supplierSku: null,
                supplierCost: null,
                costCurrency: null,
                landedCost: null,
                price: null,
                compareAtPrice: null,
                productWeight: null,
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
