"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import {
  ProductForm,
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
  type AdminCategoryNode,
  type AdminProduct,
  type CreateProductInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  buildCatalogGraphPatch,
  collectStockBatch,
  deserializeAdminProduct,
  graphFromAdminProduct,
  resolveStockBatchWrites,
  stripUnsavableMedia,
  syncSharedMediaDraft,
  toWireCatalogGraphPatch,
  type AdminCatalogGraphDraft,
  type CatalogGraphPatch,
  type StockBatchWrite,
} from "@/lib/admin-product-graph";

/**
 * Task 10: product edit (/admin/products/:id/edit).
 *
 * Update semantics mirror backend updateProductSchema (product.dto.ts) and
 * ProductsService.update() (products.service.ts): a PATCH carries only changed
 * top-level scalars; `variants`/`images` are whole-list replacements and are
 * sent ONLY when that group changed. Sending untouched groups would trigger
 * deleteMany+recreate (new SKU ids, and 400 "Referenced record does not exist"
 * once an order item/reservation references an SKU — spec §14 gap #5).
 */

// 409 from the backend. Only the product's own slug is a slug problem; every
// other unique column (sku_code, variant name) carries a message that names
// what actually collided, so it is shown verbatim instead of being rewritten
// into a claim about a field the operator never touched.
const GENERIC_CONFLICT_BACKEND = "same unique value";

/**
 * The stock batch settles one entry per requested SKU. An entry that never
 * arrives means that write was never confirmed — it must stay in the failure
 * panel rather than be read as success.
 */
const STOCK_OUTCOME_MISSING =
  "The server did not report an outcome for this stock row.";

const SCALAR_KEYS = [
  "name",
  "slug",
  "description",
  "tagline",
  "categoryId",
  "status",
  "room",
  "internalRole",
  "materials",
  "features",
] as const;

const DIMENSION_KEYS = [
  "width",
  "height",
  "depth",
  "foldedWidth",
  "foldedHeight",
  "foldedDepth",
] as const;

/**
 * Wire numbers arrive as JSON numbers (ints/Floats) and Decimal fields arrive
 * as STRINGS (Prisma Decimal.toJSON()) — both stringify straight through;
 * null/undefined become "".
 */
function toFormNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Maps an admin product row into the all-strings form value. Exported for
 * tests and future reuse. variant.sku becomes a full sku block or null.
 */
export function deserializeProduct(p: AdminProduct): ProductFormValue {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    tagline: p.tagline ?? "",
    categoryId: p.categoryId,
    status: p.status,
    room: p.room ?? "",
    internalRole: p.internalRole ?? "",
    // Copy: ProductForm mutates this array and must never touch the API row.
    solutions: [...p.solutions],
    width: toFormNumber(p.width),
    height: toFormNumber(p.height),
    depth: toFormNumber(p.depth),
    foldedWidth: toFormNumber(p.foldedWidth),
    foldedHeight: toFormNumber(p.foldedHeight),
    foldedDepth: toFormNumber(p.foldedDepth),
    materials: p.materials ?? "",
    features: (p.features ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    // The backend returns these ordered by sortOrder asc, so the list order is
    // the truth. Renumbering repairs rows that were stored sharing a
    // sortOrder — every one of them would otherwise read as the cover.
    images: p.images.map((image, index) => ({
      url: image.url,
      type: image.type ?? "IMAGE",
      altText: image.altText ?? "",
      sortOrder: String(index),
    })),
    detailBlocks: p.detailBlocks.map((block, index) => ({
      type: block.type,
      url: block.url,
      altText: block.altText ?? "",
      sortOrder: String(index),
    })),
    variants: p.variants.map((variant) => ({
      name: variant.name,
      position: String(variant.position),
      sku: variant.sku
        ? {
            skuCode: variant.sku.skuCode,
            status: variant.sku.status,
            price: toFormNumber(variant.sku.price),
            compareAtPrice: toFormNumber(variant.sku.compareAtPrice),
            supplierSku: variant.sku.supplierSku ?? "",
            supplierCost: toFormNumber(variant.sku.supplierCost),
            costCurrency: variant.sku.costCurrency ?? "",
            landedCost: toFormNumber(variant.sku.landedCost),
            productWeight: toFormNumber(variant.sku.productWeight),
            packageWidth: toFormNumber(variant.sku.packageWidth),
            packageHeight: toFormNumber(variant.sku.packageHeight),
            packageDepth: toFormNumber(variant.sku.packageDepth),
            packageWeight: toFormNumber(variant.sku.packageWeight),
            volumetricWeight: toFormNumber(variant.sku.volumetricWeight),
            // Stock round-trips separately from the product payload (it lives
            // in the inventory table); see applyStockChanges below. Read it
            // through toFormNumber so a response without the enrichment
            // degrades to an empty box instead of the string "undefined".
            id: variant.sku.id,
            stock: toFormNumber(variant.sku.onHand),
            reserved: toFormNumber(variant.sku.reserved),
          }
        : null,
    })),
    // Typed option graph draft (Task 10). Legacy payloads project to the
    // synthetic STYLE bridge; graph-aware payloads keep the server rows.
    // graphTyped gates the Task 11 editors: only payloads that actually
    // carried the typed graph may render it (and write it back).
    graph: deserializeAdminProduct(p),
    graphTyped: p.options !== undefined || p.media !== undefined,
  };
}

export function buildSavedPreview(
  product: Pick<AdminProduct, "slug" | "status">,
): { path: string; status: AdminProduct["status"] } {
  return { path: `/products/${product.slug}`, status: product.status };
}

/**
 * SKUs whose on-hand figure the admin changed, matched by SKU id (not by
 * position — variants can be added or removed in the same save).
 */
function collectStockChanges(
  current: ProductFormValue,
  initial: ProductFormValue,
): { skuId: string; onHand: number }[] {
  const previous = new Map<string, string>();
  for (const variant of initial.variants) {
    if (variant.sku?.id) previous.set(variant.sku.id, variant.sku.stock.trim());
  }

  const changes: { skuId: string; onHand: number }[] = [];
  for (const variant of current.variants) {
    const sku = variant.sku;
    if (!sku?.id) continue;
    const next = sku.stock.trim();
    if (previous.get(sku.id) === next) continue;
    changes.push({ skuId: sku.id, onHand: Number(next) });
  }
  return changes;
}

/** Order-insensitive set comparison for the solutions enum array. */
function sameSolutionSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join("|") === [...b].sort().join("|");
}

/** True when the adapter diff carries at least one changed row. */
function hasGraphRows(patch: CatalogGraphPatch): boolean {
  return (
    patch.optionUpserts.length > 0 ||
    patch.variantUpserts.length > 0 ||
    patch.mediaUpserts.length > 0 ||
    patch.retirements.optionIds.length > 0 ||
    patch.retirements.optionValueIds.length > 0 ||
    patch.retirements.mediaIds.length > 0 ||
    patch.defaultDisplayVariant !== undefined
  );
}

/**
 * Builds the partial PATCH from two FULLY serialized create-shaped payloads
 * (deserialized server truth vs. the submitted form). Serializing first means
 * comparisons are canonical (trimmed, blanks -> null, blank image rows dropped,
 * optional SKU numbers omitted), so "1299" vs "1299.00" is NOT a change.
 * Variants/images are deep-compared (both sides come out of the same
 * serializer, so key order is deterministic) and included whole or not at all.
 */
function buildProductPatch(
  current: CreateProductInput,
  initial: CreateProductInput,
): Partial<CreateProductInput> {
  const patch: Record<string, unknown> = {};

  for (const key of SCALAR_KEYS) {
    if (current[key] !== initial[key]) patch[key] = current[key];
  }
  if (!sameSolutionSet(current.solutions, initial.solutions)) {
    patch.solutions = current.solutions;
  }
  // Empty dimension string serializes to null; a value -> blank change is a
  // real change and null is what updateProductSchema expects (nullable).
  for (const key of DIMENSION_KEYS) {
    if (current[key] !== initial[key]) patch[key] = current[key];
  }
  if (JSON.stringify(current.images) !== JSON.stringify(initial.images)) {
    patch.images = current.images;
  }
  if (
    JSON.stringify(current.detailBlocks) !== JSON.stringify(initial.detailBlocks)
  ) {
    patch.detailBlocks = current.detailBlocks;
  }
  if (JSON.stringify(current.variants) !== JSON.stringify(initial.variants)) {
    patch.variants = current.variants;
  }

  return patch as Partial<CreateProductInput>;
}

function BackLink(): ReactNode {
  const { t } = useAdminI18n();
  return (
    <Link
      href="/admin/products"
      className="text-sm font-semibold text-cta hover:underline"
    >
      {t("product_form_back")}
    </Link>
  );
}

export default function EditProductPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { t } = useAdminI18n();

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [landingCount, setLandingCount] = useState<number | null>(null);
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(
    null,
  );
  const [notFound, setNotFound] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Last route id the rendered state belongs to (render-phase reset below).
  const [observedId, setObservedId] = useState(id);
  const queryKey = `${id}|${nonce}`;
  // Loading is DERIVED (order-detail pattern): true until this exact key
  // settles — no synchronous setState in the fetch effect body.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const loading = settledKey !== queryKey;

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Load failure state: an Error rejection carries its message verbatim; a
  // non-Error rejection stores WHICH load failed so the copy resolves via
  // t() at render (no hardcoded English in state).
  const [loadError, setLoadError] = useState<
    | { kind: "message"; text: string }
    | {
        kind: "fallback";
        key: "product_edit_load_failed" | "product_edit_categories_failed";
      }
    | null
  >(null);
  // Phase B rows the batch settled as failed (failed-row-only retry).
  const [stockFailures, setStockFailures] = useState<StockFailureRow[]>([]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Landing-page count for the Single Pages quick link ("落地页 (N)").
  useEffect(() => {
    if (!product) return;
    let active = true;
    adminApi
      .listProductLandingPages(product.id)
      .then((rows) => {
        if (active) setLandingCount(rows.length);
      })
      .catch(() => {
        if (active) setLandingCount(null);
      });
    return () => {
      active = false;
    };
  }, [product]);

  // Product + categories load together; both endpoints require PRODUCT_MANAGE
  // at the backend, so a role lacking it gets a verbatim 403 in the alert.
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      adminApi.getProduct(id),
      adminApi.listCategories(),
    ])
      .then(([productResult, categoriesResult]) => {
        if (!active || !mounted.current) return;
        if (productResult.status === "rejected") {
          // 404 → not-found state; anything else (403/5xx/…) is a load error.
          if (errorStatus(productResult.reason) === 404) {
            setNotFound(true);
          } else {
            setLoadError(
              productResult.reason instanceof Error
                ? { kind: "message", text: productResult.reason.message }
                : { kind: "fallback", key: "product_edit_load_failed" },
            );
          }
        } else if (categoriesResult.status === "rejected") {
          setLoadError(
            categoriesResult.reason instanceof Error
              ? { kind: "message", text: categoriesResult.reason.message }
              : { kind: "fallback", key: "product_edit_categories_failed" },
          );
        } else {
          setProduct(productResult.value);
          setCategories(categoriesResult.value);
          setLoadError(null);
          setNotFound(false);
        }
      })
      .finally(() => {
        if (active && mounted.current) setSettledKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [id, queryKey]);

  // Client-side navigation between product ids does not remount this page.
  // Reset all product-derived state DURING RENDER (React's "adjust state when a
  // prop changed" pattern, same as orders/[id]): the new id must show the
  // skeleton instead of the previous product (whose save would target the OLD
  // id) or a stale not-found/error/notice. On initial mount observedId === id.
  if (id !== observedId) {
    setObservedId(id);
    setProduct(null);
    setCategories(null);
    setLoadError(null);
    setNotFound(false);
    setSettledKey(null);
    setPending(false);
    setError(null);
    setNotice(null);
    setStockFailures([]);
  }

  // M6 (T9 review): this object's IDENTITY is the ProductForm re-sync signal,
  // so it must stay stable across ordinary re-renders — memoized on `product`,
  // not rebuilt inline (which would wipe user input on every render). It only
  // changes identity when new server truth arrives (initial load / after save).
  const initial = useMemo(
    () => (product ? deserializeProduct(product) : null),
    [product],
  );

  const retryLoad = useCallback((): void => {
    setProduct(null);
    setCategories(null);
    setLoadError(null);
    setNotFound(false);
    setSettledKey(null);
    setNonce((n) => n + 1);
  }, []);

  const handleSubmit = useCallback(
    (value: ProductFormValue): void => {
      if (!product || !initial) return;

      // Client validation (ProductForm already ran it; re-run here for the
      // field-error contract and to get the canonical serialized payload).
      const result = serializeFormValue(value, t);
      if (!result.ok) return;
      const initialResult = serializeFormValue(initial, t);
      if (!initialResult.ok) {
        // Server truth should always serialize; refuse rather than send a
        // half-valid PATCH.
        setError(t("product_edit_unserializable"));
        return;
      }

      const stockError = validateStockEntry(value, t);
      if (stockError) {
        setError(stockError);
        return;
      }

      const patch = buildProductPatch(result.value, initialResult.value);
      const stockChanges = collectStockChanges(value, initial);

      // Typed catalog graph write (Task 10/11): diff the hydrated draft
      // against server truth and, when rows changed, attach the patch plus
      // the optimistic revision. Only payloads that actually carried the
      // typed graph may write it — a synthesized legacy projection references
      // server rows by nothing, so sending one would fabricate a second
      // option graph server-side.
      let graphBody: ReturnType<typeof toWireCatalogGraphPatch> | Record<string, never> = {};
      const hasTypedGraph =
        product.options !== undefined || product.media !== undefined;
      let phaseDraft: AdminCatalogGraphDraft | null = null;
      let stockWrites: StockBatchWrite[] = [];
      if (hasTypedGraph && value.graph) {
        const draft = structuredClone(value.graph);
        // URL-less scoped rows are intent-less (blank new rows vanish; a
        // blanked persisted row becomes a retirement), and client-key scopes
        // whose draft row is gone this same save would 400 the patch.
        stripUnsavableMedia(draft);
        syncSharedMediaDraft(draft, result.value.images);
        const graphPatch = buildCatalogGraphPatch(
          graphFromAdminProduct(product),
          draft,
        );
        if (hasGraphRows(graphPatch)) {
          graphBody = toWireCatalogGraphPatch(
            graphPatch,
            product.catalogGraphVersion,
          );
        }
        // On typed products the graph owns shared media AND variants:
        // legacy whole-list keys NEVER go out. The backend ignores `variants`
        // when a graph patch is present and 409s them without one — this is
        // the 409-trap guard (the form also locks those editors).
        delete patch.variants;
        delete patch.images;
        phaseDraft = draft;
        stockWrites = collectStockBatch(draft, deserializeAdminProduct(product));
      } else if (product.catalogGraphVersion > 0) {
        // Graph product without a typed payload (admin GET gap): the backend
        // rejects legacy whole-list writes with CATALOG_GRAPH_VERSION_REQUIRED.
        // The form locks those editors; strip defensively so a stale client
        // can never send a doomed PATCH.
        delete patch.variants;
        delete patch.images;
      }

      const hasStockWrites = phaseDraft
        ? stockWrites.length > 0
        : stockChanges.length > 0;
      if (
        Object.keys(patch).length === 0 &&
        !hasStockWrites &&
        Object.keys(graphBody).length === 0
      ) {
        // Nothing changed: do not PATCH (an empty body is a no-op server-side
        // anyway, but skipping keeps the audit/ledger clean).
        setError(null);
        setNotice(t("product_edit_no_changes"));
        return;
      }

      setPending(true);
      setError(null);
      setNotice(null);
      setStockFailures([]);
      void (async () => {
        let productSaved = false;
        try {
          let saved = product;
          const body = { ...patch, ...graphBody };
          if (Object.keys(body).length > 0) {
            saved = await adminApi.updateProduct(product.id, body);
            productSaved = true;
            if (!mounted.current) return;
            // Adopt the new server truth (trimmed values, recreated SKU ids):
            // the new object re-keys `initial`, resetting ProductForm state.
            setProduct(saved);
          }

          // Phase B — stock. Typed products use the bounded batch endpoint:
          // browser-created SKUs enter the save as client keys and are
          // resolved to real SKU ids through the PATCH response before the
          // batch call. The endpoint settles rows independently, so a failing
          // SKU never rolls back the others — failures surface in the retry
          // panel and ONLY they are sent again.
          const failures: StockFailureRow[] = [];
          let wroteStock = false;
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
                  reason: "Product form",
                })),
              );
              // Match settled results back by skuId, not array position, so
              // an unexpected ordering can never drop or mislabel a failure.
              const attemptBySkuId = new Map(
                resolved.ready.map((row) => [row.skuId, row]),
              );
              const settledSkuIds = new Set(
                results.map((entry) => entry.skuId),
              );
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
              wroteStock = true;
            }
          } else {
            // Legacy per-SKU writes (unchanged): variants added in this save
            // had no SKU id when the form was built, so they are matched back
            // by SKU code.
            const writes = [...stockChanges];
            for (const variant of value.variants) {
              const sku = variant.sku;
              if (!sku || sku.id) continue;
              const raw = sku.stock.trim();
              if (raw === "") continue;
              const created = saved.variants.find(
                (v) => v.sku?.skuCode === sku.skuCode.trim(),
              );
              if (created?.sku) writes.push({ skuId: created.sku.id, onHand: Number(raw) });
            }
            for (const write of writes) {
              await adminApi.setStock({ ...write, reason: "Product form" });
            }
            wroteStock = writes.length > 0;
          }

          if (!mounted.current) return;
          if (failures.length > 0) {
            // Commit the reconciled queue before refreshing server truth. A
            // refresh transport failure must never hide newly failed rows.
            setStockFailures(failures);
            setError(
              productSaved
                ? t("product_edit_stock_partial_saved", { count: failures.length })
                : t("product_edit_stock_partial", { count: failures.length }),
            );
            setProduct(await adminApi.getProduct(product.id));
            if (!mounted.current) return;
            return;
          }
          if (wroteStock) {
            // Re-read so the form shows what the server stored rather than
            // what was typed (the reserved guard can reject a value outright).
            setProduct(await adminApi.getProduct(product.id));
            if (!mounted.current) return;
          }
          setNotice(
            wroteStock ? t("product_edit_saved_stock") : t("product_edit_saved"),
          );
          router.refresh();
        } catch (err: unknown) {
          if (!mounted.current) return;
          // The backend's own message is already specific for a taken SKU code
          // or a duplicated variant name; only its generic wording (or a bare
          // 409) is the slug, which needs the friendly copy.
          const backendMessage =
            err instanceof Error ? err.message : t("product_edit_save_failed");
          const message =
            errorStatus(err) === 409 &&
            backendMessage.includes(GENERIC_CONFLICT_BACKEND)
              ? t("product_save_slug_conflict")
              : backendMessage;
          setError(
            productSaved
              ? t("product_edit_stock_failed_suffix", { message })
              : message,
          );
        } finally {
          if (mounted.current) setPending(false);
        }
      })();
    },
    [product, initial, router, t],
  );

  /**
   * Failed-row-only retry (Phase B): resubmits exactly the rows the batch
   * settled as failed — successful rows are never written twice — then
   * refetches server truth and keeps whichever rows still fail.
   */
  const retryStockFailures = useCallback(async (): Promise<void> => {
    if (stockFailures.length === 0 || !product) return;
    const retryable = stockFailures.filter((failure) => failure.skuId !== "");
    // Rows the save could never address (no real SKU id) are not retryable —
    // but they were never written either, so they must outlive the retry
    // instead of vanishing behind a success notice.
    const unresolved = stockFailures.filter((failure) => failure.skuId === "");
    if (retryable.length === 0) {
      setError(t("product_edit_retry_none"));
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const results = await adminApi.setStockBatch(
        retryable.map((failure) => ({
          skuId: failure.skuId,
          onHand: failure.onHand,
          reason: "Product form",
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
      // Same reconciliation as the save path: a row that was sent but never
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
      // Commit the reconciliation before refreshing. Successful absolute stock
      // writes must leave the retry queue even when the follow-up read fails.
      const remaining = [...unresolved, ...stillFailed];
      if (!mounted.current) return;
      setStockFailures(remaining);
      const fresh = await adminApi.getProduct(product.id);
      if (!mounted.current) return;
      setProduct(fresh);
      if (remaining.length === 0) {
        setNotice(t("product_edit_stock_updated"));
        router.refresh();
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
  }, [stockFailures, product, router, t]);

  const initialLoading =
    loading && product === null && !loadError && !notFound;

  if (initialLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <BackLink />
        <div className="mt-4">
          <TableSkeleton rows={10} cols={3} />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <BackLink />
        <div className="mt-4">
          <EmptyState
            title={t("product_edit_not_found_title")}
            hint={t("product_edit_not_found_hint")}
            action={
              <Link
                href="/admin/products"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-cta/40 px-6 text-base font-semibold text-cta hover:bg-primary-light/40"
              >
                {t("product_form_back")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (!product || !categories || !initial) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <BackLink />
        <div
          role="alert"
          className="mt-4 rounded-xl border border-border bg-card p-6"
        >
          <p className="text-sm font-semibold text-ink">
            {t("product_edit_load_error_title")}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {loadError === null
              ? t("product_unknown_error")
              : loadError.kind === "message"
                ? loadError.text
                : t(loadError.key)}
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
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title={t("product_edit_title")}
        actions={
          <span className="flex items-center gap-4">
            {product && landingCount !== null ? (
              <Link
                href={`/admin/single-pages?productId=${product.id}`}
                className="text-sm font-semibold text-cta hover:underline"
              >
                {t("product_edit_landing_link", { count: landingCount })}
              </Link>
            ) : null}
            <BackLink />
          </span>
        }
      />

      {notice ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      {/* Phase B partial failure: only the failed rows, retried alone. */}
      <StockRetryPanel
        failures={stockFailures}
        onRetry={() => {
          void retryStockFailures();
        }}
        pending={pending}
      />

      <ProductForm
        initial={initial}
        categories={categories}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
        pending={pending}
        error={error}
        savedPreview={buildSavedPreview(product)}
      />

      {/* Whole-list replacement warning, next to Save (spec §8.8 / gap #5). */}
      <p className="mt-3 text-sm text-ink-muted">
        {t("product_edit_replacement_warning")}
      </p>
    </div>
  );
}
