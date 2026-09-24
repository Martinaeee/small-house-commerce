"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  ProductForm,
  emptyProductFormValue,
  serializeFormValue,
  validateStockEntry,
  type ProductFormValue,
} from "@/components/admin/ProductForm";
import {
  StockRetryPanel,
  type StockFailureRow,
} from "@/components/admin/StockRetryPanel";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCatalogGraph,
  type AdminCategoryNode,
  type AdminProduct,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  buildCatalogGraphPatch,
  collectStockBatch,
  resolveStockBatchWrites,
  stripUnsavableMedia,
  syncSharedMediaDraft,
  toWireCatalogGraphPatch,
  type AdminCatalogGraphDraft,
  type StockBatchWrite,
} from "@/lib/admin-product-graph";

/**
 * New product (/admin/products/new) — Task 11 two-phase save.
 *
 * The create endpoint predates the catalog graph, so a typed draft (the
 * options/matrix editors ran) saves in two phases: POST /admin/products with
 * legacy scalars only (variants/images deliberately EMPTY so the graph patch
 * is the single writer and cannot duplicate rows), then PATCH the graph with
 * the created product's version 0 baseline. Stock is Phase B: the graph PATCH
 * response carries the created SKU ids, which the client-key stock writes are
 * resolved against before the bounded batch call.
 *
 * Products that never touch the typed editors keep the plain legacy create:
 * no draft rows exist, so nothing graph-shaped is sent and the product stays
 * on catalogGraphVersion 0.
 */

const EMPTY_GRAPH_BASELINE: AdminCatalogGraph = {
  catalogGraphVersion: 0,
  defaultDisplayVariantId: null,
  options: [],
  variants: [],
  media: [],
};

/** Stock baseline for the created product: nothing persisted yet. */
const EMPTY_DRAFT_BASELINE: AdminCatalogGraphDraft = {
  catalogGraphVersion: 0,
  defaultDisplayVariantRef: null,
  options: [],
  variants: [],
  media: [],
};

/**
 * Sentinel for category rejections that carry no Error message: the visible
 * copy resolves via t() at render, so no English fallback lives in state.
 */
const LOAD_ERROR_FALLBACK = Symbol("categories-load-fallback");

/**
 * The stock batch settles one entry per requested SKU. An entry that never
 * arrives means that write was never confirmed — it must stay in the failure
 * panel rather than be read as success.
 */
const STOCK_OUTCOME_MISSING =
  "The server did not report an outcome for this stock row.";

export default function NewProductPage(): ReactNode {
  const router = useRouter();
  const { t } = useAdminI18n();

  const [initial] = useState<ProductFormValue>(() =>
    emptyProductFormValue(),
  );
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<
    string | typeof LOAD_ERROR_FALLBACK | null
  >(null);
  const [nonce, setNonce] = useState(0);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase B rows the batch settled as failed (failed-row-only retry).
  const [stockFailures, setStockFailures] = useState<StockFailureRow[]>([]);
  // Created-product id held so the retry panel can refetch/navigate.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    adminApi
      .listCategories()
      .then((res) => {
        if (active) {
          setCategories(res);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCategories([]);
        setLoadError(
          err instanceof Error ? err.message : LOAD_ERROR_FALLBACK,
        );
      });
    return () => {
      active = false;
    };
  }, [nonce]);
  // Reset lives in the event handler (not the effect body, which would
  // cascade-render): retry flips back to the skeleton then refetches.
  const retryLoad = (): void => {
    setCategories(null);
    setLoadError(null);
    setNonce((n) => n + 1);
  };

  /**
   * Failed-row-only retry (Phase B): resubmits exactly the failed rows. On
   * success the operator finally lands on the edit page (the product row and
   * its graph already exist since Phase A).
   */
  const retryStockFailures = useCallback(async (): Promise<void> => {
    if (stockFailures.length === 0) return;
    const retryable = stockFailures.filter((failure) => failure.skuId !== "");
    // Rows the save could never address (no real SKU id) are not retryable —
    // but they were never written either, so they must outlive the retry
    // instead of being dropped by a navigation that implies success.
    const unresolved = stockFailures.filter((failure) => failure.skuId === "");
    if (retryable.length === 0) {
      setError(t("product_new_retry_none"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const results = await adminApi.setStockBatch(
        retryable.map((failure) => ({
          skuId: failure.skuId,
          onHand: failure.onHand,
          reason: "New product",
        })),
      );
      const attemptBySkuId = new Map(
        retryable.map((failure) => [failure.skuId, failure]),
      );
      const settledSkuIds = new Set(results.map((entry) => entry.skuId));
      const stillFailed: StockFailureRow[] = [];
      for (const entry of results) {
        if (entry.ok) continue;
        const attempt = attemptBySkuId.get(entry.skuId);
        stillFailed.push({
          skuId: entry.skuId,
          onHand: attempt?.onHand ?? 0,
          label: attempt?.label ?? entry.skuId,
          error: entry.error,
        });
      }
      // Same reconciliation as the create path: a row that was sent but never
      // settled was not written, so it stays failed.
      for (const row of retryable) {
        if (settledSkuIds.has(row.skuId)) continue;
        stillFailed.push({
          skuId: row.skuId,
          onHand: row.onHand,
          label: row.label,
          error: STOCK_OUTCOME_MISSING,
        });
      }
      if (!mounted.current) return;
      // Unresolved rows stay in the panel: the retry settled only the rows it
      // could address, so the save is not complete while they remain.
      const remaining = [...unresolved, ...stillFailed];
      setStockFailures(remaining);
      if (remaining.length === 0) {
        if (createdId) router.push(`/admin/products/${createdId}/edit`);
      } else {
        setError(t("product_save_stock_still_failed", { count: remaining.length }));
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(
        err instanceof Error ? err.message : t("product_save_retry_failed"),
      );
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [stockFailures, createdId, router, t]);

  const handleSubmit = (v: ProductFormValue): void => {
    // Once POST succeeds, this page is recovery-only. Re-submitting would either
    // 409 on the same slug or create a duplicate after the operator edits it;
    // the persisted row must be continued from its edit-page link instead.
    if (createdId !== null) return;
    const stockError = validateStockEntry(v, t);
    if (stockError) {
      setError(stockError);
      return;
    }
    // The form already validated; serialize is pure, so re-running it here
    // cannot fail — it yields the CreateProductInput payload.
    const result = serializeFormValue(v, t);
    if (!result.ok) return;

    // Typed rows = the operator used the options/matrix editors. A gallery
    // only (no options/variants/scoped rows) stays on the plain legacy
    // create: the graph patch would otherwise re-create the same shared
    // media rows the create call just wrote.
    let phaseDraft: AdminCatalogGraphDraft | null = null;
    let createPayload = result.value;
    if (v.graphTyped && v.graph) {
      const draft = structuredClone(v.graph);
      stripUnsavableMedia(draft);
      syncSharedMediaDraft(draft, result.value.images);
      const hasTypedRows =
        draft.options.length > 0 ||
        draft.variants.length > 0 ||
        draft.media.some(
          (row) => row.optionValueRef !== null || row.variantRef !== null,
        );
      if (hasTypedRows) {
        phaseDraft = draft;
        // The graph patch owns shared media and variants for this save;
        // sending them through the legacy create as well would duplicate rows.
        createPayload = { ...result.value, images: [], variants: [] };
      }
    }

    setPending(true);
    setError(null);
    setStockFailures([]);
    setCreatedId(null);
    void (async () => {
      // Null until createProduct resolves: the catch uses it to tell a
      // create-time slug conflict apart from a post-create phase failure.
      let created: AdminProduct | null = null;
      try {
        created = await adminApi.createProduct(createPayload);
        if (!mounted.current) return;
        // The product row EXISTS from here on (with empty images/variants
        // when the typed flow runs). Point at it immediately so ANY later
        // failure — Phase A graph PATCH included — leaves the operator a
        // continue-on-edit escape instead of a re-submit that 409s on slug.
        setCreatedId(created.id);
        let stockWrites: StockBatchWrite[] = [];
        let saved = created;
        if (phaseDraft) {
          // Phase A — the created product's graph is empty; diff the draft
          // against that baseline and adopt the graph snapshot response.
          const graphPatch = buildCatalogGraphPatch(EMPTY_GRAPH_BASELINE, phaseDraft);
          saved = await adminApi.updateProduct(created.id, {
            ...toWireCatalogGraphPatch(graphPatch, created.catalogGraphVersion),
          });
          if (!mounted.current) return;
          stockWrites = collectStockBatch(phaseDraft, EMPTY_DRAFT_BASELINE);
        }

        // Phase B — bounded stock batch with real SKU ids resolved from the
        // save response. Failures settle per row; only they are retried.
        // Results are matched back by skuId, not position, so an unexpected
        // ordering can never drop or mislabel a failure.
        const failures: StockFailureRow[] = [];
        if (phaseDraft) {
          const resolved = resolveStockBatchWrites(stockWrites, phaseDraft, saved);
          for (const row of resolved.unresolved) {
            failures.push({
              skuId: "",
              onHand: row.onHand,
              label: row.label,
              error: row.error,
            });
          }
          if (resolved.ready.length > 0) {
            const results = await adminApi.setStockBatch(
              resolved.ready.map((row) => ({
                skuId: row.skuId,
                onHand: row.onHand,
                reason: "New product",
              })),
            );
            const attemptBySkuId = new Map(
              resolved.ready.map((row) => [row.skuId, row]),
            );
            const settledSkuIds = new Set(results.map((entry) => entry.skuId));
            for (const entry of results) {
              if (entry.ok) continue;
              const attempt = attemptBySkuId.get(entry.skuId);
              failures.push({
                skuId: entry.skuId,
                onHand: attempt?.onHand ?? 0,
                label: attempt?.label ?? entry.skuId,
                error: entry.error,
              });
            }
            // A requested row the response never settled is reconciled by
            // skuId membership (not by array length), so a dropped or
            // duplicated entry can never make an unwritten row read as saved.
            for (const row of resolved.ready) {
              if (settledSkuIds.has(row.skuId)) continue;
              failures.push({
                skuId: row.skuId,
                onHand: row.onHand,
                label: row.label,
                error: STOCK_OUTCOME_MISSING,
              });
            }
          }
        }
        if (!mounted.current) return;

        if (failures.length > 0) {
          // Keep the operator here: the product + graph exist, only stock
          // rows failed. The panel retries exactly those rows.
          setStockFailures(failures);
          setError(
            t("product_new_stock_partial", { count: failures.length }),
          );
          setPending(false);
          return;
        }

        router.push(`/admin/products/${created.id}/edit`);
      } catch (err: unknown) {
        if (!mounted.current) return;
        const message =
          err instanceof Error ? err.message : t("product_new_create_failed");
        if (created) {
          // Post-create failure (Phase A graph PATCH / batch transport): the
          // product exists — surface the backend message verbatim; the
          // continue-on-edit link below is the way forward.
          setError(t("product_new_later_step_failed", { message }));
          setPending(false);
          return;
        }
        // POST /admin/products 409s (products.service rethrowKnown, Prisma
        // P2002): the unique violation here is the typed slug, so spec §8.7
        // maps 409 to the slug-specific alert; other messages stay verbatim.
        setError(
          errorStatus(err) === 409
            ? t("product_save_slug_conflict")
            : message,
        );
        setPending(false);
      }
    })();
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title={t("product_new_title")}
        actions={
          <Link
            href="/admin/products"
            className="text-sm font-semibold text-cta hover:underline"
          >
            {t("product_form_back")}
          </Link>
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-border bg-card p-6"
        >
          <p className="text-sm font-semibold text-ink">
            {t("product_new_categories_error_title")}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {loadError === LOAD_ERROR_FALLBACK
              ? t("product_unknown_error")
              : loadError}
          </p>
          <Button
            variant="secondary"
            size="md"
            onClick={retryLoad}
            className="mt-4"
          >
            {t("common_retry")}
          </Button>
        </div>
      ) : categories === null ? (
        <div className="mt-4 space-y-4" aria-hidden>
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      ) : categories.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={t("product_new_no_categories_title")}
            hint={t("product_new_no_categories_hint")}
            action={
              <Link
                href="/admin/categories"
                className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
              >
                {t("product_new_go_categories")}
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* The created product exists even when a later phase failed —
              always offer the way to it, so a partial save can never strand
              the operator into re-submitting this form (slug 409). */}
          {createdId ? (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {t("product_new_partial_success")}{" "}
              <Link
                href={`/admin/products/${createdId}/edit`}
                className="font-semibold underline"
              >
                {t("product_new_continue_edit")}
              </Link>
            </div>
          ) : null}
          {stockFailures.length > 0 ? (
            <div className="mt-4">
              <StockRetryPanel
                failures={stockFailures}
                onRetry={() => {
                  void retryStockFailures();
                }}
                pending={pending}
              />
            </div>
          ) : null}
          <ProductForm
            initial={initial}
            categories={categories}
            onSubmit={handleSubmit}
            submitLabel="Create product"
            pending={pending}
            error={error}
            savedPreview={null}
          />
        </>
      )}
    </div>
  );
}
