import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function Harness({
  candidates,
  initial,
}: {
  candidates: VariantCandidate[];
  initial: AdminCatalogGraphDraft;
}) {
  return (
    <GraphDraftHarness
      initial={initial}
      render={(draft, onChange) => (
        <VariantMatrix candidates={candidates} draft={draft} onChange={onChange} />
      )}
    />
  );
}

function draftVariants(): AdminVariantDraft[] {
  return (draftJson() as AdminCatalogGraphDraft).variants;
}

describe("VariantMatrix", () => {
  it("renders only the current thirty-row matrix page", () => {
    render(<VariantMatrix candidates={makeCandidates(31)} />);

    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("paginates to the remaining rows and back", async () => {
    const user = userEvent.setup();
    render(<VariantMatrix candidates={makeCandidates(31)} />);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Variant 31")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Variant 1")).toBeInTheDocument();
  });

  it("applies bulk price only to the rows on the current page", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(31)} initial={draft()} />);

    await user.type(screen.getByLabelText("Bulk price"), "199");
    await user.click(screen.getByRole("button", { name: "Apply price to page" }));

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

    await user.type(screen.getByLabelText("SKU code for Variant 1"), "SH-001");
    await user.type(screen.getByLabelText("Price for Variant 1"), "1299");

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

    const stock = screen.getByLabelText("Stock for Variant 1");
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

    await user.type(screen.getByLabelText("Stock for Variant 1"), "x");
    expect(screen.getByText(/whole number/)).toBeInTheDocument();
    expect(draftVariants()[0].sku).toBeNull();
  });

  it("flags a priced row that still has no SKU code", async () => {
    const user = userEvent.setup();
    render(<Harness candidates={makeCandidates(1)} initial={draft()} />);

    await user.type(screen.getByLabelText("Price for Variant 1"), "1299");
    expect(screen.getByText(/SKU code is required/)).toBeInTheDocument();
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
    expect(within(persistedRow!).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(
      within(persistedRow!).getByText(/有订单\/库存引用/),
    ).toBeInTheDocument();

    const draftRow = screen.getByText("Variant 2").closest("tr");
    await user.click(within(draftRow!).getByRole("button", { name: "Remove" }));
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
      screen.getByRole("combobox", { name: "Status for Variant 1" }),
      "DISABLED",
    );
    expect(draftVariants()[0].sku?.status).toBe("DISABLED");
  });
});
