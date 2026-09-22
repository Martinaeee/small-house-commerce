"use client";

import { useState, type ReactNode } from "react";
import { inputCls } from "@/components/admin/Field";
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
}: {
  candidates: readonly VariantCandidate[];
  draft?: AdminCatalogGraphDraft | null;
  onChange?: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
}): ReactNode {
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
          ? "Bulk price must be a number of 0 or more."
          : "Bulk stock must be a whole number of 0 or more.",
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
          Variant matrix 款式矩阵
          <span className="ml-2 font-normal text-ink-muted">
            {candidates.length} 个候选 · 每页 {MATRIX_PAGE_SIZE} 行 · 保存只提交修改过的行
          </span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            aria-label="Bulk price"
            className={`${inputCls} w-32`}
            inputMode="decimal"
            value={bulkPrice}
            placeholder="统一售价 ₱"
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
            Apply price to page
          </button>
          <input
            aria-label="Bulk stock"
            className={`${inputCls} w-32`}
            inputMode="numeric"
            value={bulkStock}
            placeholder="统一库存"
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
            Apply stock to page
          </button>
        </div>
      </div>
      {bulkError ? (
        <p role="alert" className="text-xs text-red-700">
          {bulkError}
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          没有候选款式：启用选项组并至少添加一个值后，这里会列出全部组合。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-secondary">
                <th className="py-2 pr-3">Variant 款式</th>
                <th className="py-2 pr-3">SKU code</th>
                <th className="py-2 pr-3">Price ₱</th>
                <th className="py-2 pr-3">Compare-at ₱</th>
                <th className="py-2 pr-3">Stock 库存</th>
                <th className="py-2 pr-3">Status</th>
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
                return (
                  <tr
                    key={candidate.combinationKey}
                    className="border-b border-border/60 align-middle"
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
                        {persisted ? "已有" : "新"}
                      </span>
                      {row?.hasReferences ? (
                        <span className="ml-1 text-xs text-ink-muted">
                          有订单/库存引用
                        </span>
                      ) : null}
                      {warning ? (
                        <p className="text-xs text-red-700" role="status">
                          {warning}
                        </p>
                      ) : null}
                      {missingCode ? (
                        <p className="text-xs text-red-700" role="status">
                          SKU code is required before saving.
                        </p>
                      ) : null}
                      {persisted ? (
                        <p className="text-xs text-ink-muted">
                          已保存款式不在此删除——停用对应选项值后由系统停用/清理。
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        aria-label={`SKU code for ${candidate.name}`}
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
                      <input
                        aria-label={`Price for ${candidate.name}`}
                        className={`${inputCls} w-28`}
                        inputMode="decimal"
                        value={sku?.price === null || sku === null ? "" : String(sku.price)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            editSku(candidate, { price: null });
                            setWarning(candidate.combinationKey, null);
                          } else if (PRICE_RE.test(raw)) {
                            editSku(candidate, { price: Number(raw) });
                            setWarning(candidate.combinationKey, null);
                          } else {
                            setWarning(
                              candidate.combinationKey,
                              "Price must be a number of 0 or more.",
                            );
                          }
                        }}
                        disabled={!editable}
                        autoComplete="off"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        aria-label={`Compare-at for ${candidate.name}`}
                        className={`${inputCls} w-28`}
                        inputMode="decimal"
                        value={
                          sku?.compareAtPrice === null || sku === null
                            ? ""
                            : String(sku.compareAtPrice)
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            editSku(candidate, { compareAtPrice: null });
                            setWarning(candidate.combinationKey, null);
                          } else if (PRICE_RE.test(raw)) {
                            editSku(candidate, { compareAtPrice: Number(raw) });
                            setWarning(candidate.combinationKey, null);
                          } else {
                            setWarning(
                              candidate.combinationKey,
                              "Compare-at price must be a number of 0 or more.",
                            );
                          }
                        }}
                        disabled={!editable}
                        autoComplete="off"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        aria-label={`Stock for ${candidate.name}`}
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
                              "Stock must be a whole number of 0 or more.",
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
                          aria-label={`Status for ${candidate.name}`}
                          className={`${inputCls} w-32`}
                          value={sku.status}
                          onChange={(e) =>
                            editSku(candidate, {
                              status: e.target.value as AdminSkuDraft["status"],
                            })
                          }
                          disabled={!editable}
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="DISABLED">DISABLED</option>
                        </select>
                      ) : (
                        <span className="text-xs text-ink-muted">无 SKU</span>
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
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={() => setPage(current - 1)}
          disabled={current <= 1}
        >
          Previous page
        </button>
        <span className="text-sm text-ink-secondary">
          Page {current} / {totalPages}
        </span>
        <button
          type="button"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={() => setPage(current + 1)}
          disabled={current >= totalPages}
        >
          Next page
        </button>
      </div>
    </div>
  );
}
