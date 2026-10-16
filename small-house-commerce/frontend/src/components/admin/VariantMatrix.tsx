"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { inputClsCompact } from "@/components/admin/Field";
import { DecimalInput } from "@/components/admin/DecimalInput";
import { Dialog } from "@/components/admin/Dialog";
import { BundleComponentsEditor } from "@/components/admin/BundleComponentsEditor";
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
  type ProductDimensionApplyResult,
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
const PRODUCT_DIMENSION_FIELDS = [
  { skuKey: "productWidth", productKey: "width", labelKey: "product_sku_product_width" },
  { skuKey: "productDepth", productKey: "depth", labelKey: "product_sku_product_depth" },
  { skuKey: "productHeight", productKey: "height", labelKey: "product_sku_product_height" },
] as const;

function emptySkuDraft(): AdminSkuDraft {
  return {
    skuCode: "",
    status: "ACTIVE",
    isBundle: false,
    bundleVersion: 0,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price: null,
    compareAtPrice: null,
    productWidth: null,
    productDepth: null,
    productHeight: null,
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
  productDimensions = null,
  productId = null,
  onBundleSavingChange,
}: {
  candidates: readonly VariantCandidate[];
  productId?: string | null;
  onBundleSavingChange?: (skuKey: string, saving: boolean) => void;
  draft?: AdminCatalogGraphDraft | null;
  onChange?: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
  productDimensions?: { width: number | null; depth: number | null; height: number | null } | null;
  /** Materialized row the problem rail asked to highlight. */
  highlightKey?: string | null;
  /** Persisted SKU code requested by an internal search result. */
  requestedSkuCode?: string | null;
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
  const [dimensionResult, setDimensionResult] = useState<ProductDimensionApplyResult | null>(null);
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
  // Rows an earlier option setup left behind. They are shown on every page so a
  // rail jump always finds them, and they never join the sellable candidate
  // list or the bulk operations.
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

  const canApplyDimensions = editable && productDimensions !== null &&
    Object.values(productDimensions).some(value => value !== null) &&
    candidates.some(candidate => rowFor(candidate)?.sku?.status === "ACTIVE");

  const applyDimensions = (mode: "all" | "empty-only"): void => {
    if (!draft || !productDimensions || !canApplyDimensions) return;
    const result = applyProductDimensionsToVariants(structuredClone(draft), productDimensions, mode);
    onChange?.(next => { applyProductDimensionsToVariants(next, productDimensions, mode); });
    setDimensionResult(result);
  };

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
      if (kind === "stock" && rowFor(candidate)?.sku?.isBundle) return;
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
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold disabled:text-ink-muted"
          disabled={!canApplyDimensions}
          onClick={() => applyDimensions("all")}
        >
          {t("product_matrix_dimensions_apply")}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold disabled:text-ink-muted"
          disabled={!canApplyDimensions}
          onClick={() => applyDimensions("empty-only")}
        >
          {t("product_matrix_dimensions_fill")}
        </button>
        <p className="w-full text-xs text-ink-muted">{t("product_matrix_dimensions_hint")}</p>
        {dimensionResult ? (
          <p role="status" className="text-xs text-ink-secondary">
            {t("product_matrix_dimensions_result", {
              changed: dimensionResult.changedCount,
              skipped: dimensionResult.skippedCount,
            })}
          </p>
        ) : null}
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
            <table className={`w-full text-sm ${pageRows.some(candidate => rowFor(candidate)?.sku?.isBundle) ? "min-w-[1440px]" : "min-w-[880px]"}`}>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 pr-3">{t("product_matrix_col_variant")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_sku_code")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_price")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_compare_at")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_stock")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_status")}</th>
                  <th className="py-2 pr-3">{t("product_matrix_col_dimensions")}</th>
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
                        <label className="mt-2 flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            aria-label={t("bundle_mode_aria", { name: candidate.name })}
                            checked={sku?.isBundle ?? false}
                            disabled={!editable || sku?.id !== undefined}
                            onChange={event => editSku(candidate, {
                              isBundle: event.target.checked,
                              onHand: 0,
                              bundleDraft: undefined,
                              bundleDefinition: undefined,
                            })}
                          />
                          {t("bundle_mode_label")}
                        </label>
                        {sku?.id ? <p className="text-xs text-ink-muted">{t("bundle_mode_immutable")}</p> : null}
                        {sku?.isBundle && (!sku.id || productId) ? (
                          <BundleComponentsEditor
                            productId={productId}
                            skuId={sku.id}
                            draft={sku.bundleDraft}
                            definition={sku.bundleDefinition}
                            expectedVersion={sku.bundleVersion}
                            onChange={bundleDraft => editSku(candidate, { bundleDraft })}
                            onDefinitionChange={definition => editSku(candidate, { bundleDefinition: definition, bundleVersion: definition.version })}
                            disabled={!editable}
                            onSavingChange={saving => onBundleSavingChange?.(sku.id ?? rowKeyValue, saving)}
                          />
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
                        {sku?.isBundle ? <p className="text-xs text-ink-muted">{t("bundle_virtual_stock")}</p> : <input
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
                          disabled={!editable}
                          autoComplete="off"
                        />}
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
                      <td className="py-2 pr-3">
                        <div className="grid min-w-80 grid-cols-3 gap-2">
                          {PRODUCT_DIMENSION_FIELDS.map(({ skuKey, productKey, labelKey }) => {
                            const inherited = sku?.[skuKey] === null;
                            const parentValue = productDimensions?.[productKey] ?? null;
                            return (
                              <label key={skuKey} className="text-xs text-ink-secondary">
                                <span className="mb-1 block">{t(labelKey)}</span>
                                <DecimalInput
                                  aria-label={t("product_matrix_dimension_aria", { name: candidate.name, dimension: t(labelKey) })}
                                  value={sku?.[skuKey] ?? null}
                                  placeholder={parentValue === null ? "" : String(parentValue)}
                                  inputMode="decimal"
                                  onValueChange={value => {
                                    if (value !== null && !Number.isFinite(value)) {
                                      setWarning(candidate.combinationKey, t("product_matrix_dimension_error"));
                                      return;
                                    }
                                    editSku(candidate, { [skuKey]: value });
                                    setWarning(candidate.combinationKey, null);
                                  }}
                                  onValidityChange={valid => setWarning(candidate.combinationKey, valid ? null : t("product_matrix_dimension_error"))}
                                  disabled={!editable || sku?.status !== "ACTIVE"}
                                  autoComplete="off"
                                />
                                {sku ? (
                                  <span className="mt-1 block text-ink-muted">
                                    {inherited
                                      ? parentValue === null
                                        ? t("product_matrix_dimension_unset")
                                        : t("product_matrix_dimension_inherited", { value: parentValue })
                                      : t("product_matrix_dimension_overridden")}
                                  </span>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="mt-1 min-h-11 text-xs font-semibold text-primary disabled:text-ink-muted"
                          aria-label={t("product_matrix_dimensions_clear_aria", { name: candidate.name })}
                          disabled={!editable || sku?.status !== "ACTIVE" || PRODUCT_DIMENSION_FIELDS.every(({ skuKey }) => sku[skuKey] === null)}
                          onClick={() => editSku(candidate, { productWidth: null, productDepth: null, productHeight: null })}
                        >
                          {t("product_matrix_dimensions_clear")}
                        </button>
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
                      <td className="py-2 pr-3">
                        <input className={`${inputClsCompact} w-24`} aria-label={t("product_matrix_stock_aria", { name })} value={sku === null ? "" : String(sku.onHand)} disabled readOnly />
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-muted">
                        {sku ? t(`product_sku_status_${sku.status}`) : t("product_matrix_no_sku")}
                      </td>
                      <td />
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
