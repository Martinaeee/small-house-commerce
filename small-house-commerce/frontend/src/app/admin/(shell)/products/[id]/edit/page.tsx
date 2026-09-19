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
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCategoryNode,
  type AdminProduct,
  type CreateProductInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

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

// POST/PATCH 409 from rethrowKnown (Prisma P2002); on this form the unique
// column is the slug — same UI mapping as the create page (spec §8.7).
const SLUG_CONFLICT_UI = "A product with this slug already exists.";

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
    images: p.images.map((image) => ({
      url: image.url,
      altText: image.altText ?? "",
      sortOrder: String(image.sortOrder),
    })),
    detailBlocks: p.detailBlocks.map((block) => ({
      type: block.type,
      url: block.url,
      altText: block.altText ?? "",
      sortOrder: String(block.sortOrder),
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
            // in the inventory table); see applyStockChanges below.
            id: variant.sku.id,
            stock: String(variant.sku.onHand),
            reserved: String(variant.sku.reserved),
          }
        : null,
    })),
  };
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
  return (
    <Link
      href="/admin/products"
      className="text-sm font-semibold text-cta hover:underline"
    >
      Back to products
    </Link>
  );
}

export default function EditProductPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [landingCount, setLandingCount] = useState<number | null>(null);
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
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
                ? productResult.reason.message
                : "Failed to load product.",
            );
          }
        } else if (categoriesResult.status === "rejected") {
          setLoadError(
            categoriesResult.reason instanceof Error
              ? categoriesResult.reason.message
              : "Failed to load categories.",
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
      const result = serializeFormValue(value);
      if (!result.ok) return;
      const initialResult = serializeFormValue(initial);
      if (!initialResult.ok) {
        // Server truth should always serialize; refuse rather than send a
        // half-valid PATCH.
        setError("This product has data the form cannot edit. Reload the page and try again.");
        return;
      }

      const stockError = validateStockEntry(value);
      if (stockError) {
        setError(stockError);
        return;
      }

      const patch = buildProductPatch(result.value, initialResult.value);
      const stockChanges = collectStockChanges(value, initial);
      if (Object.keys(patch).length === 0 && stockChanges.length === 0) {
        // Nothing changed: do not PATCH (an empty body is a no-op server-side
        // anyway, but skipping keeps the audit/ledger clean).
        setError(null);
        setNotice("No changes to save.");
        return;
      }

      setPending(true);
      setError(null);
      setNotice(null);
      void (async () => {
        let productSaved = false;
        try {
          let saved = product;
          if (Object.keys(patch).length > 0) {
            saved = await adminApi.updateProduct(product.id, patch);
            productSaved = true;
            if (!mounted.current) return;
            // Adopt the new server truth (trimmed values, recreated SKU ids):
            // the new object re-keys `initial`, resetting ProductForm state.
            setProduct(saved);
          }

          // Stock is written through the inventory API (audit trail + the
          // reserved guard). Variants added in this save had no SKU id when the
          // form was built, so they are matched back by SKU code.
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

          if (!mounted.current) return;
          if (writes.length > 0) {
            // Re-read so the form shows what the server stored rather than what
            // was typed (the reserved guard can reject a value outright).
            setProduct(await adminApi.getProduct(product.id));
            if (!mounted.current) return;
          }
          setNotice(writes.length > 0 ? "Product saved, stock updated." : "Product saved.");
          router.refresh();
        } catch (err: unknown) {
          if (!mounted.current) return;
          // 409 → slug-specific wording. Everything else stays verbatim,
          // including the §14-gap-#5 "Referenced record does not exist" 400.
          const message =
            errorStatus(err) === 409
              ? SLUG_CONFLICT_UI
              : err instanceof Error
                ? err.message
                : "Failed to save product.";
          setError(
            productSaved ? `Product saved, but the stock update failed: ${message}` : message,
          );
        } finally {
          if (mounted.current) setPending(false);
        }
      })();
    },
    [product, initial, router],
  );

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
            title="Product not found."
            hint="It may have been deleted."
            action={
              <Link
                href="/admin/products"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-cta/40 px-6 text-base font-semibold text-cta hover:bg-primary-light/40"
              >
                Back to products
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
            Couldn&apos;t load product.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {loadError ?? "Unknown error."}
          </p>
          <Button
            variant="secondary"
            size="md"
            onClick={retryLoad}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="Edit product"
        actions={
          <span className="flex items-center gap-4">
            {product && landingCount !== null ? (
              <Link
                href={`/admin/single-pages?productId=${product.id}`}
                className="text-sm font-semibold text-cta hover:underline"
              >
                落地页 ({landingCount})
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

      <ProductForm
        initial={initial}
        categories={categories}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
        pending={pending}
        error={error}
      />

      {/* Whole-list replacement warning, next to Save (spec §8.8 / gap #5). */}
      <p className="mt-3 text-sm text-ink-muted">
        Variants and images are saved as a full replacement.
      </p>
    </div>
  );
}
