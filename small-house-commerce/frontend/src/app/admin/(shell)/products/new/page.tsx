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
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
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

export default function NewProductPage(): ReactNode {
  const router = useRouter();

  const [initial] = useState<ProductFormValue>(() =>
    emptyProductFormValue(),
  );
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
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
          err instanceof Error
            ? err.message
            : "Couldn't load categories.",
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
    if (retryable.length === 0) {
      setError("Nothing to retry — save the product again.");
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
      const stillFailed: StockFailureRow[] = [];
      results.forEach((entry, index) => {
        const attempt = retryable[index];
        if (!entry.ok && attempt) {
          stillFailed.push({ ...attempt, error: entry.error });
        }
      });
      if (!mounted.current) return;
      setStockFailures(stillFailed);
      if (stillFailed.length === 0) {
        if (createdId) router.push(`/admin/products/${createdId}/edit`);
      } else {
        setError(`${stillFailed.length} stock update(s) still failed.`);
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to retry stock updates.",
      );
    } finally {
      if (mounted.current) setPending(false);
    }
  }, [stockFailures, createdId, router]);

  const handleSubmit = (v: ProductFormValue): void => {
    const stockError = validateStockEntry(v);
    if (stockError) {
      setError(stockError);
      return;
    }
    // The form already validated; serialize is pure, so re-running it here
    // cannot fail — it yields the CreateProductInput payload.
    const result = serializeFormValue(v);
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
      syncSharedMediaDraft(draft, v.images);
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
      try {
        const created = await adminApi.createProduct(createPayload);
        if (!mounted.current) return;
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
            results.forEach((entry, index) => {
              const attempt = resolved.ready[index];
              if (!entry.ok && attempt) {
                failures.push({
                  skuId: entry.skuId,
                  onHand: attempt.onHand,
                  label: attempt.label,
                  error: entry.error,
                });
              }
            });
          }
        }
        if (!mounted.current) return;

        if (failures.length > 0) {
          // Keep the operator here: the product + graph exist, only stock
          // rows failed. The panel retries exactly those rows.
          setCreatedId(created.id);
          setStockFailures(failures);
          setError(
            `Product created, but ${failures.length} stock update(s) failed — fix the values and retry below (only failed rows are sent again).`,
          );
          setPending(false);
          return;
        }

        router.push(`/admin/products/${created.id}/edit`);
      } catch (err: unknown) {
        if (!mounted.current) return;
        // POST /admin/products 409s (products.service rethrowKnown, Prisma
        // P2002): the unique violation here is the typed slug, so spec §8.7
        // maps 409 to the slug-specific alert; other messages stay verbatim.
        setError(
          errorStatus(err) === 409
            ? "A product with this slug already exists."
            : err instanceof Error
              ? err.message
              : "Failed to create product.",
        );
        setPending(false);
      }
    })();
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="New product"
        actions={
          <Link
            href="/admin/products"
            className="text-sm font-semibold text-cta hover:underline"
          >
            Back to products
          </Link>
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-border bg-card p-6"
        >
          <p className="text-sm font-semibold text-ink">
            Couldn&apos;t load categories.
          </p>
          <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
          <Button
            variant="secondary"
            size="md"
            onClick={retryLoad}
            className="mt-4"
          >
            Retry
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
            title="No categories yet."
            hint="Every product needs a category — create one before adding products."
            action={
              <Link
                href="/admin/categories"
                className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
              >
                Go to categories
              </Link>
            }
          />
        </div>
      ) : (
        <>
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
          />
        </>
      )}
    </div>
  );
}
