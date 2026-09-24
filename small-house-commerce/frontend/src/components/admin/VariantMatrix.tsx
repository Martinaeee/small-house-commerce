"use client";

import { useState, type ReactNode } from "react";
import { inputCls } from "@/components/admin/Field";
import { DecimalInput } from "@/components/admin/DecimalInput";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  type AdminCatalogGraphDraft,
  type AdminSkuDraft,
  type AdminVariantDraft,
  type EntityRef,
  type VariantCandidate,
} from "@/lib/admin-product-graph";

/**
 * Task 11 — the candidate matrix. Renders the Cartesian candidates of the
 * active option groups (thirty rows per client-side page) and edits them
 * through the catalog graph draft.
 *
 * Rows materialize LAZILY: a candidate without a draft row stays abstract
 * until the operator edits or bulk-applies onto it, so untouched candidates
 * never enter the save payload and simple products keep the legacy path.
 * Materialized rows carry a deterministic client key (`variant-<key>`) that
 * survives re-renders and is what Phase B's stock mapping resolves against.
 *
 * Persisted rows are protected: they have no hard Remove (deleting is the
 * server's reconcile decision — deactivate the option value instead), and
 * rows the server flags as referenced say so explicitly.
 */

export const MATRIX_PAGE_SIZE = 30;

const NUM_RE = /^\d+$/;
const PRICE_RE = /^\d+(\.\d*)?$/;

function emptySkuDraft(): AdminSkuDraft {
  return {
    skuCode: "",
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
  };
}

/** Resolves each candidate pair's value into a patch-ready entity ref. */
function valueRefsFor(
  draft: AdminCatalogGraphDraft,
  pairs: readonly { optionId: string; valueId: string }[],
): EntityRef[] {
  const valueByKey = new Map(
    draft.options.flatMap((option) =>
      option.values.map((value) => [value.id ?? value.clientKey ?? "", value]),
    ),
  );
  return pairs.map(({ valueId }) => {
    const value = valueByKey.get(valueId);
    return value?.id !== undefined
      ? { id: value.id }
      : { clientKey: value?.clientKey ?? valueId };
  });
}

function findOrCreateRow(
  draft: AdminCatalogGraphDraft,
  candidate: VariantCandidate,
): AdminVariantDraft {
  const existing = draft.variants.find(
    (row) => row.combinationKey === candidate.combinationKey,
  );
  if (existing) return existing;
  const row: AdminVariantDraft = {
    clientKey: `variant-${candidate.combinationKey}`,
    name: candidate.name,
    position: draft.variants.reduce(
      (max, current) => Math.max(max, current.position + 1),
      0,
    ),
    combinationKey: candidate.combinationKey,
    optionValueRefs: valueRefsFor(draft, candidate.pairs),
    sku: null,
  };
  draft.variants.push(row);
  return row;
}

export function VariantMatrix({
  candidates,
  draft = null,
  onChange,
  pending = false,
  highlightKey = null,
}: {
  candidates: readonly VariantCandidate[];
  draft?: AdminCatalogGraphDraft | null;
  onChange?: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
  /** Materialized row the problem rail asked to highlight. */
  highlightKey?: string | null;
}): ReactNode {
  const { t } = useAdminI18n();
  const [page, setPage] = useState(1);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [rowWarnings, setRowWarnings] = useState<Record<string, string>>({});

  const totalPages = Math.max(
    1,
    Math.ceil(candidates.length / MATRIX_PAGE_SIZE),
  );
  const current = Math.min(page, totalPages);
  const pageRows = candidates.slice(
    (current - 1) * MATRIX_PAGE_SIZE,
    current * MATRIX_PAGE_SIZE,
  );
  const editable = onChange !== undefined && draft !== null && !pending;

  const rowFor = (candidate: VariantCandidate): AdminVariantDraft | undefined =>
    draft?.variants.find(
      (row) => row.combinationKey === candidate.combinationKey,
    );

  const editSku = (
    candidate: VariantCandidate,
    patch: Partial<AdminSkuDraft>,
  ): void =>
    onChange?.((draft) => {
      const row = findOrCreateRow(draft, candidate);
      row.sku = { ...emptySkuDraft(), ...(row.sku ?? {}), ...patch };
    });

  const setWarning = (key: string, message: string | null): void =>
    setRowWarnings((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const applyBulk = (kind: "price" | "stock"): void => {
    const raw = (kind === "price" ? bulkPrice : bulkStock).trim();
    const valid = kind === "price" ? PRICE_RE.test(raw) : NUM_RE.test(raw);
    if (!valid) {
      setBulkError(
        kind === "price"
          ? t("product_matrix_bulk_price_error")
          : t("product_matrix_bulk_stock_error"),
      );
      return;
    }
    setBulkError(null);
    const value = Number(raw);
    pageRows.forEach((candidate) => {
      editSku(
        candidate,
        kind === "price" ? { price: value } : { onHand: value },
      );
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-ink">
          {t("product_matrix_title")}
          <span className="ml-2 font-normal text-ink-muted">
            {t("product_matrix_summary", {
              count: candidates.length,
              pageSize: MATRIX_PAGE_SIZE,
            })}
          </span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            aria-label={t("product_matrix_bulk_price_aria")}
            className={`${inputCls} w-32`}
            inputMode="decimal"
            value={bulkPrice}
            placeholder={t("product_matrix_bulk_price_placeholder")}
            onChange={(e) => setBulkPrice(e.target.value)}
            disabled={!editable}
            autoComplete="off"
          />
          <button
            type="button"
            className="h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
            onClick={() => applyBulk("price")}
            disabled={!editable}
          >
            {t("product_matrix_apply_price")}
          </button>
          <input
            aria-label={t("product_matrix_bulk_stock_aria")}
            className={`${inputCls} w-32`}
            inputMode="numeric"
            value={bulkStock}
            placeholder={t("product_matrix_bulk_stock_placeholder")}
            onChange={(e) => setBulkStock(e.target.value)}
            disabled={!editable}
            autoComplete="off"
          />
          <button
            type="button"
            className="h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
            onClick={() => applyBulk("stock")}
            disabled={!editable}
          >
            {t("product_matrix_apply_stock")}
          </button>
        </div>
      </div>
      {bulkError ? (
        <p role="alert" className="text-xs text-red-700">
          {bulkError}
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("product_matrix_empty")}</p>
      ) : (
        <>
          {/* Local horizontal scroller only — the page never overflows; the
              hint names the narrow-screen access pattern explicitly. */}
          <p className="text-xs text-ink-muted md:hidden">
            {t("product_matrix_scroll_hint")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 pr-3">{t("product_matrix_col_variant")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_sku_code")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_price")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_compare_at")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_stock")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_status")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((candidate) => {
                  const row = rowFor(candidate);
                  const persisted = row?.id !== undefined;
                  const sku = row?.sku ?? null;
                  const warning = rowWarnings[candidate.combinationKey];
                  const missingCode = sku !== null && !sku.skuCode.trim();
                  const rowKeyValue = row ? (row.id ?? row.clientKey ?? "") : "";
                  return (
                    <tr
                      key={candidate.combinationKey}
                      id={rowKeyValue ? `pf-row-${rowKeyValue}` : undefined}
                      className={`border-b border-border/60 align-middle ${
                        rowKeyValue && highlightKey === rowKeyValue
                          ? "ring-2 ring-sale ring-offset-2"
                          : ""
                      }`}
                    >
                      <td className="py-2 pr-3">
                        <span className="font-medium text-ink">
                          {candidate.name}
                        </span>
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                            persisted
                              ? "bg-primary-light/60 text-ink-secondary"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {persisted
                            ? t("product_matrix_persisted")
                            : t("product_matrix_new")}
                        </span>
                        {row?.hasReferences ? (
                          <span className="ml-1 text-xs text-ink-muted">
                            {t("product_matrix_has_references")}
                          </span>
                        ) : null}
                        {warning ? (
                          <p className="text-xs text-red-700" role="status">
                            {warning}
                          </p>
                        ) : null}
                        {missingCode ? (
                          <p className="text-xs text-red-700" role="status">
                            {t("product_matrix_missing_code")}
                          </p>
                        ) : null}
                        {persisted ? (
                          <p className="text-xs text-ink-muted">
                            {t("product_matrix_persisted_note")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          aria-label={t("product_matrix_sku_code_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputCls} w-36`}
                          value={sku?.skuCode ?? ""}
                          onChange={(e) =>
                            editSku(candidate, { skuCode: e.target.value })
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <DecimalInput
                          aria-label={t("product_matrix_price_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputCls} w-28`}
                          inputMode="decimal"
                          value={sku?.price ?? null}
                          onValueChange={(price) => {
                            editSku(candidate, { price });
                            setWarning(candidate.combinationKey, null);
                          }}
                          onValidityChange={(valid) =>
                            setWarning(
                              candidate.combinationKey,
                              valid ? null : t("product_matrix_warning_price"),
                            )
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <DecimalInput
                          aria-label={t("product_matrix_compare_at_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputCls} w-28`}
                          inputMode="decimal"
                          value={sku?.compareAtPrice ?? null}
                          onValueChange={(compareAtPrice) => {
                            editSku(candidate, { compareAtPrice });
                            setWarning(candidate.combinationKey, null);
                          }}
                          onValidityChange={(valid) =>
                            setWarning(
                              candidate.combinationKey,
                              valid
                                ? null
                                : t("product_matrix_warning_compare_at"),
                            )
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          aria-label={t("product_matrix_stock_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputCls} w-24`}
                          inputMode="numeric"
                          value={sku === null ? "" : String(sku.onHand)}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") {
                              editSku(candidate, { onHand: 0 });
                              setWarning(candidate.combinationKey, null);
                            } else if (NUM_RE.test(raw)) {
                              editSku(candidate, { onHand: Number(raw) });
                              setWarning(candidate.combinationKey, null);
                            } else {
                              setWarning(
                                candidate.combinationKey,
                                t("product_matrix_warning_stock"),
                              );
                            }
                          }}
                          disabled={!editable}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {sku ? (
                          <select
                            aria-label={t("product_matrix_status_aria", {
                              name: candidate.name,
                            })}
                            className={`${inputCls} w-32`}
                            value={sku.status}
                            onChange={(e) =>
                              editSku(candidate, {
                                status: e.target.value as AdminSkuDraft["status"],
                              })
                            }
                            disabled={!editable}
                          >
                            <option value="ACTIVE">
                              {t("product_sku_status_ACTIVE")}
                            </option>
                            <option value="DISABLED">
                              {t("product_sku_status_DISABLED")}
                            </option>
                          </select>
                        ) : (
                          <span className="text-xs text-ink-muted">
                            {t("product_matrix_no_sku")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {!persisted && editable ? (
                          <button
                            type="button"
                            className="text-sm font-semibold text-red-700 hover:underline"
                            onClick={() =>
                              onChange?.((draft) => {
                                const index = draft.variants.findIndex(
                                  (item) =>
                                    item.combinationKey ===
                                    candidate.combinationKey,
                                );
                                if (index >= 0) draft.variants.splice(index, 1);
                              })
                            }
                          >
                            {t("product_matrix_remove")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={() => setPage(current - 1)}
          disabled={current <= 1}
        >
          {t("product_matrix_previous")}
        </button>
        <span className="text-sm text-ink-secondary">
          {t("product_matrix_page_status", { current, total: totalPages })}
        </span>
        <button
          type="button"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={() => setPage(current + 1)}
          disabled={current >= totalPages}
        >
          {t("product_matrix_next")}
        </button>
      </div>
    </div>
  );
}
