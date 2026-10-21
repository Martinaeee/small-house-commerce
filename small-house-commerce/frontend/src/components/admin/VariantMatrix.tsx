"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { inputClsCompact } from "@/components/admin/Field";
import { DecimalInput } from "@/components/admin/DecimalInput";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  applyProductDimensionsToVariants,
  entityRowKey,
  findSupersededVariantRows,
  variantDisplayName,
  type AdminCatalogGraphDraft,
  type AdminSkuDraft,
  type AdminVariantDraft,
  type EntityRef,
  type ProductDimensionValues,
  type VariantCandidate,
} from "@/lib/admin-product-graph";
import { SkuPackagingAssist } from "./SkuPackagingAssist";
import { BundleComponentsEditor } from "./BundleComponentsEditor";

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
    productWidth: null,
    productHeight: null,
    productDepth: null,
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
  requestedSkuCode = null,
  productDimensions,
  productId,
  onBundleSavingChange,
}: {
  productId?: string | null;
  onBundleSavingChange?: (saving: boolean) => void;
  candidates: readonly VariantCandidate[];
  draft?: AdminCatalogGraphDraft | null;
  onChange?: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
  /** Materialized row the problem rail asked to highlight. */
  highlightKey?: string | null;
  /** Persisted SKU code requested by an internal search result. */
  requestedSkuCode?: string | null;
  /** Product-level dimensions used by the two matrix bulk actions. */
  productDimensions?: ProductDimensionValues;
}): ReactNode {
  const { t } = useAdminI18n();
  const requestedVariant =
    requestedSkuCode === null
      ? undefined
      : draft?.variants.find(
          (variant) => variant.sku?.skuCode === requestedSkuCode,
        );
  const requestedCombinationKey = requestedVariant?.combinationKey ?? null;
  const requestedIndex =
    requestedCombinationKey === null
      ? -1
      : candidates.findIndex(
          (candidate) =>
            candidate.combinationKey === requestedCombinationKey,
        );
  const requestedPage =
    requestedIndex < 0
      ? null
      : Math.floor(requestedIndex / MATRIX_PAGE_SIZE) + 1;
  const requestedIdentity = `${requestedSkuCode ?? ""}\u0000${requestedCombinationKey ?? ""}`;
  const [page, setPage] = useState(requestedPage ?? 1);
  const [syncedRequestIdentity, setSyncedRequestIdentity] =
    useState(requestedIdentity);
  if (requestedIdentity !== syncedRequestIdentity) {
    setSyncedRequestIdentity(requestedIdentity);
    if (requestedPage !== null) setPage(requestedPage);
  }
  const skuInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [dimensionsMessage, setDimensionsMessage] = useState<string | null>(null);
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
  const leftovers = draft ? findSupersededVariantRows(draft) : [];
  const [confirmRemoval, setConfirmRemoval] = useState<AdminVariantDraft | null>(null);

  useLayoutEffect(() => {
    if (
      requestedCombinationKey === null ||
      requestedPage === null ||
      current !== requestedPage
    ) {
      return;
    }
    const input = skuInputRefs.current.get(requestedCombinationKey);
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: "center" });
  }, [
    current,
    requestedCombinationKey,
    requestedIdentity,
    requestedPage,
  ]);

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
    setDimensionsMessage(null);
    const value = Number(raw);
    pageRows.forEach((candidate) => {
      if (kind === "stock" && rowFor(candidate)?.sku?.isBundle) return;
      editSku(
        candidate,
        kind === "price" ? { price: value } : { onHand: value },
      );
    });
  };

  const applyDimensions = (mode: "all-materialized" | "empty-only"): void => {
    if (!productDimensions || !editable || !draft) return;
    setBulkError(null);
    const preview: AdminCatalogGraphDraft = {
      ...draft,
      variants: draft.variants.map((variant) => ({
        ...variant,
        sku: variant.sku ? { ...variant.sku } : null,
      })),
    };
    const result = applyProductDimensionsToVariants(
      preview,
      productDimensions,
      mode,
    );
    onChange?.((nextDraft) => {
      applyProductDimensionsToVariants(nextDraft, productDimensions, mode);
    });
    setDimensionsMessage(
      `${t("product_matrix_dimensions_applied", {
        count: result.changedCount,
      })} ${
        result.skippedCount > 0
          ? t("product_matrix_dimensions_skipped", {
              count: result.skippedCount,
            })
          : ""
      }`.trim(),
    );
  };

  const hasProductDimensions =
    productDimensions !== undefined &&
    (productDimensions.width !== null ||
      productDimensions.height !== null ||
      productDimensions.depth !== null);

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
            className={`${inputClsCompact} w-32`}
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
            className={`${inputClsCompact} w-32`}
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
          {productDimensions ? (
            <>
              <button
                type="button"
                className="h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                onClick={() => applyDimensions("all-materialized")}
                disabled={!editable || !hasProductDimensions}
              >
                {t("product_matrix_apply_dimensions")}
              </button>
              <button
                type="button"
                className="h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                onClick={() => applyDimensions("empty-only")}
                disabled={!editable || !hasProductDimensions}
              >
                {t("product_matrix_fill_dimensions")}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {bulkError ? (
        <p role="alert" className="text-xs text-red-700">
          {bulkError}
        </p>
      ) : null}
      {dimensionsMessage ? (
        <p role="status" className="text-xs text-ink-secondary">
          {dimensionsMessage}
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
                  <th className="py-2 pr-3">{t("product_matrix_col_product_width")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_product_height")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_product_depth")}</th>
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
                          ref={(node) => {
                            if (node) {
                              skuInputRefs.current.set(
                                candidate.combinationKey,
                                node,
                              );
                            } else {
                              skuInputRefs.current.delete(
                                candidate.combinationKey,
                              );
                            }
                          }}
                          aria-label={t("product_matrix_sku_code_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-36`}
                          value={sku?.skuCode ?? ""}
                          onChange={(e) =>
                            editSku(candidate, { skuCode: e.target.value })
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <label className="mb-1 flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={sku?.isBundle ?? false}
                            onChange={(event) => editSku(candidate, { isBundle: event.target.checked, status: event.target.checked ? "DISABLED" : "ACTIVE", onHand: 0 })}
                            disabled={!editable || Boolean(sku?.id)} />
                          {t("bundle_virtual")}
                        </label>
                        {sku?.isBundle && !sku.id ? <p className="max-w-48 text-xs text-ink-muted">{t("bundle_save_sku_first")}</p> : null}
                        <DecimalInput
                          aria-label={t("product_matrix_price_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-28`}
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
                          className={`${inputClsCompact} w-28`}
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
                        <DecimalInput
                          aria-label={t("product_matrix_product_width_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-24`}
                          inputMode="decimal"
                          value={sku?.productWidth ?? null}
                          placeholder={productDimensions?.width?.toString()}
                          onValueChange={(productWidth) =>
                            editSku(candidate, { productWidth })
                          }
                          onValidityChange={(valid) =>
                            setWarning(
                              candidate.combinationKey,
                              valid ? null : t("product_matrix_warning_dimension"),
                            )
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                        {sku?.productWidth == null ? (
                          <span className="block text-[10px] text-ink-muted">
                            {t("product_matrix_dimension_inherited")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="block text-[10px] text-ink-muted underline"
                            onClick={() => editSku(candidate, { productWidth: null })}
                            disabled={!editable}
                          >
                            {t("product_matrix_clear_product_width", {
                              name: candidate.name,
                            })}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <DecimalInput
                          aria-label={t("product_matrix_product_height_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-24`}
                          inputMode="decimal"
                          value={sku?.productHeight ?? null}
                          placeholder={productDimensions?.height?.toString()}
                          onValueChange={(productHeight) =>
                            editSku(candidate, { productHeight })
                          }
                          onValidityChange={(valid) =>
                            setWarning(
                              candidate.combinationKey,
                              valid ? null : t("product_matrix_warning_dimension"),
                            )
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                        {sku?.productHeight == null ? (
                          <span className="block text-[10px] text-ink-muted">
                            {t("product_matrix_dimension_inherited")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="block text-[10px] text-ink-muted underline"
                            onClick={() => editSku(candidate, { productHeight: null })}
                            disabled={!editable}
                          >
                            {t("product_matrix_clear_product_height", {
                              name: candidate.name,
                            })}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <DecimalInput
                          aria-label={t("product_matrix_product_depth_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-24`}
                          inputMode="decimal"
                          value={sku?.productDepth ?? null}
                          placeholder={productDimensions?.depth?.toString()}
                          onValueChange={(productDepth) =>
                            editSku(candidate, { productDepth })
                          }
                          onValidityChange={(valid) =>
                            setWarning(
                              candidate.combinationKey,
                              valid ? null : t("product_matrix_warning_dimension"),
                            )
                          }
                          disabled={!editable}
                          autoComplete="off"
                        />
                        {sku?.productDepth == null ? (
                          <span className="block text-[10px] text-ink-muted">
                            {t("product_matrix_dimension_inherited")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="block text-[10px] text-ink-muted underline"
                            onClick={() => editSku(candidate, { productDepth: null })}
                            disabled={!editable}
                          >
                            {t("product_matrix_clear_product_depth", {
                              name: candidate.name,
                            })}
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          aria-label={t("product_matrix_stock_aria", {
                            name: candidate.name,
                          })}
                          className={`${inputClsCompact} w-24`}
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
                          disabled={!editable || Boolean(sku?.isBundle)}
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {sku ? (
                          <select
                            aria-label={t("product_matrix_status_aria", {
                              name: candidate.name,
                            })}
                            className={`${inputClsCompact} w-32`}
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
                        {sku ? (
                          <details className="text-left">
                            <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                              {t("product_matrix_packaging_assist")}
                            </summary>
                            <SkuPackagingAssist
                              value={{
                                packageWidth: sku.packageWidth,
                                packageHeight: sku.packageHeight,
                                packageDepth: sku.packageDepth,
                                packageWeight: sku.packageWeight,
                              }}
                              onApply={(patch) => editSku(candidate, patch)}
                              disabled={!editable}
                            />
                          </details>
                        ) : null}
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
                {leftovers.map((variant) => {
                  const name = variantDisplayName(draft!, variant);
                  const sku = variant.sku ?? null;
                  const rowKey = entityRowKey(variant);
                  const details = ([
                    ["supplierCost", "product_sku_supplier_cost", sku?.costCurrency ?? ""],
                    ["landedCost", "product_sku_landed_cost", sku?.costCurrency ?? ""],
                    ["productWeight", "product_sku_product_weight", "kg"],
                    ["packageWidth", "product_sku_package_width", "cm"],
                    ["packageHeight", "product_sku_package_height", "cm"],
                    ["packageDepth", "product_sku_package_depth", "cm"],
                    ["packageWeight", "product_sku_package_weight", "kg"],
                    ["volumetricWeight", "product_sku_volumetric_weight", "kg"],
                  ] as const).filter(([key]) => sku?.[key] != null);
                  return (
                    <tr key={`leftover:${rowKey}`} id={`pf-row-${rowKey}`} className="border-b border-border/60 bg-amber-50 align-middle">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-ink">{name}</span>
                        <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs text-amber-900">
                          {t("product_matrix_temporary")}
                        </span>
                        <p className="mt-1 max-w-xs text-xs text-amber-800">
                          {t("product_matrix_leftover_note")}
                        </p>
                        {details.length > 0 || variant.cardMedia?.cover || variant.cardMedia?.hover ? (
                          <details className="mt-2 max-w-xs text-xs text-ink-secondary">
                            <summary className="cursor-pointer font-semibold">{t("product_matrix_leftover_details")}</summary>
                            <dl className="mt-2 space-y-1">
                              {details.map(([key, label, unit]) => (
                                <div key={key} className="flex flex-wrap gap-x-2">
                                  <dt>{t(label)}</dt>
                                  <dd>{`${sku?.[key]} ${unit}`.trim()}</dd>
                                </div>
                              ))}
                            </dl>
                            {(["cover", "hover"] as const).map(slot => {
                              const image = variant.cardMedia?.[slot];
                              if (!image) return null;
                              return (
                                <div key={slot} className="mt-2">
                                  <p>{t(slot === "cover" ? "product_card_cover" : "product_card_hover")}</p>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- preserved admin media accepts uploaded URLs. */}
                                  <img src={image.url} alt={image.altText ?? name} className="mt-1 h-20 w-20 object-contain" />
                                  <p className="break-all select-all">{image.url}</p>
                                </div>
                              );
                            })}
                          </details>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <input className={`${inputClsCompact} w-36`} aria-label={t("product_matrix_sku_code_aria", { name })} value={sku?.skuCode ?? ""} disabled readOnly />
                      </td>
                      <td className="py-2 pr-3 text-sm text-ink">{sku?.price ?? "—"}</td>
                      <td className="py-2 pr-3 text-sm text-ink">{sku?.compareAtPrice ?? "—"}</td>
                      <td className="py-2 pr-3 text-sm text-ink">{sku?.productWidth ?? "—"}</td>
                      <td className="py-2 pr-3 text-sm text-ink">{sku?.productHeight ?? "—"}</td>
                      <td className="py-2 pr-3 text-sm text-ink">{sku?.productDepth ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <input className={`${inputClsCompact} w-24`} aria-label={t("product_matrix_stock_aria", { name })} value={sku === null ? "" : String(sku.onHand)} disabled readOnly />
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-muted">
                        {sku ? t(`product_sku_status_${sku.status}`) : t("product_matrix_no_sku")}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
                          aria-label={`${t("product_matrix_remove_leftover")} ${name}`}
                          disabled={!editable}
                          onClick={() => setConfirmRemoval(variant)}
                        >
                          {t("product_matrix_remove_leftover")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {productId ? pageRows.map(candidate => {
        const sku = rowFor(candidate)?.sku;
        if (!sku?.id || !sku.isBundle) return null;
        return <details key={sku.id} open className="min-w-0 rounded-lg border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">{candidate.name} / {sku.skuCode} — {t("bundle_virtual")}</summary>
          <BundleComponentsEditor productId={productId} skuId={sku.id} draft={sku.bundleDraft} definition={sku.bundleDefinition} expectedVersion={sku.bundleVersion}
            onDefinitionChange={definition => onChange?.(draft => {
              const target = draft.variants.find(variant => variant.sku?.id === sku.id)?.sku;
              if (target && definition.version >= Math.max(target.bundleVersion ?? 0, target.bundleDefinition?.version ?? 0)) {
                target.bundleDefinition = definition;
                target.bundleVersion = definition.version;
              }
            })}
            onChange={bundleDraft => editSku(candidate, { bundleDraft })} disabled={pending}
            onSavingChange={onBundleSavingChange} />
        </details>;
      }) : null}

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
      <Dialog
        open={confirmRemoval !== null}
        onClose={() => setConfirmRemoval(null)}
        title={`${t("product_matrix_remove_leftover")} ${confirmRemoval && draft ? variantDisplayName(draft, confirmRemoval) : ""}`.trim()}
        initialFocus="first"
      >
        <p className="text-sm text-ink-secondary">{t("product_matrix_remove_leftover_body")}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="rounded-lg border border-border px-4 py-2" onClick={() => setConfirmRemoval(null)}>
            {t("common_cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-50"
            disabled={!editable}
            onClick={() => {
              const target = confirmRemoval;
              if (!editable || !target) return;
              const targetKey = entityRowKey(target);
              onChange?.(draft => {
                const index = draft.variants.findIndex(
                  row => entityRowKey(row) === targetKey && findSupersededVariantRows(draft).includes(row),
                );
                if (index < 0) return;
                draft.variants.splice(index, 1);
                draft.media = draft.media.filter(
                  media => entityRowKey(media.variantRef ?? {}) !== targetKey,
                );
                if (
                  draft.defaultDisplayVariantRef &&
                  entityRowKey(draft.defaultDisplayVariantRef) === targetKey
                ) {
                  draft.defaultDisplayVariantRef = null;
                }
              });
              setConfirmRemoval(null);
            }}
          >
            {t("product_matrix_confirm_remove")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
