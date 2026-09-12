"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  formatAmount,
  type AdminProduct,
  type Paged,
  type ProductStatus,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

// Spec §8.5 / §14 gap #1: there is NO stock GET endpoint. The SKU list is
// sourced from GET /admin/products and live On Hand / Reserved / Available
// render only for SKUs adjusted during this page session (from the adjust
// response). No movement history in V1.

const PRODUCT_STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "DISABLED"];

// Backend DTO bounds (inventory adjust zod schema).
const MAX_QTY = 1_000_000;
const MAX_REASON = 255;

// A code-like term (contains a "-" or "_", no spaces) is treated as a SKU
// code: the products endpoint only matches product name/slug, so for SKU
// searches we fetch the unfiltered page-set and narrow rows client-side
// (spec §8.5 documented limitation).
const SKU_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*[-_][A-Za-z0-9_-]*$/;
const INTEGER_RE = /^[+-]?\d+$/;

// GET /admin/products returns 403 when the role lacks PRODUCT_MANAGE (the
// route is class-gated; INVENTORY_VIEW alone is insufficient — see task-7
// report "Newly discovered gap"). Retry cannot fix a permission denial.

interface SkuRow {
  productId: string;
  productName: string;
  productStatus: ProductStatus;
  variantId: string;
  variantName: string;
  skuId: string;
  skuCode: string;
  skuStatus: "ACTIVE" | "DISABLED";
  price: string | null;
}

interface SessionStock {
  onHand: number;
  reserved: number;
  available: number;
}

interface AdjustTarget {
  skuId: string;
  skuCode: string;
}

// One table row per variant that HAS a SKU; variants without a SKU (sku=null)
// are skipped.
function flattenProducts(products: AdminProduct[]): SkuRow[] {
  const rows: SkuRow[] = [];
  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.sku) continue;
      rows.push({
        productId: product.id,
        productName: product.name,
        productStatus: product.status,
        variantId: variant.id,
        variantName: variant.name,
        skuId: variant.sku.id,
        skuCode: variant.sku.skuCode,
        skuStatus: variant.sku.status,
        price: variant.sku.price,
      });
    }
  }
  return rows;
}

function isSkuQuery(term: string): boolean {
  return SKU_CODE_RE.test(term);
}

function signedQty(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function InventoryPageContent() {
  const { hasPermission } = useAdminAuth();
  const canAdjust = hasPermission("INVENTORY_ADJUST");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // --- URL params: source of truth (same pattern as orders list) -----------

  const search = searchParams.get("search")?.trim() ?? "";
  const rawStatus = searchParams.get("status");
  const status = PRODUCT_STATUSES.includes(rawStatus as ProductStatus)
    ? (rawStatus as ProductStatus)
    : "";
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  const skuQuery = isSkuQuery(search);
  // SKU-code terms are NOT sent to the server (name/slug match only); they
  // filter the loaded page-set client-side below.
  const serverSearch = skuQuery ? "" : search;
  const filtersActive = Boolean(search || status);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Search box keeps instant local state; changes sync to the URL after a
  // 300ms debounce. URL -> input reconciliation happens during render.
  const [searchInput, setSearchInput] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      const value = searchInput.trim();
      if (value !== search) {
        patchParams({ search: value || null, page: null });
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput, search, patchParams]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // --- list data ------------------------------------------------------------

  const [data, setData] = useState<Paged<AdminProduct> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set from the HTTP status (403), not the message body.
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nonce, setNonce] = useState(0);

  const queryKey = [
    status,
    serverSearch,
    String(page),
    String(nonce),
  ].join("|");
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listProducts({
        status: status || undefined,
        search: serverSearch || undefined,
        page,
      })
      .then((res) => {
        if (!active) return;
        setData(res);
        setError(null);
        setPermissionDenied(false);
        setFetchedKey(queryKey);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPermissionDenied(errorStatus(err) === 403);
        setError(err instanceof Error ? err.message : "Failed to load SKUs.");
        setFetchedKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [queryKey, status, serverSearch, page]);

  // --- session stock (spec §8.5: adjusted rows only) ------------------------

  const [sessionStock, setSessionStock] = useState<Record<string, SessionStock>>(
    {},
  );

  const allRows = useMemo(
    () => (data ? flattenProducts(data.items) : []),
    [data],
  );
  const rows = useMemo(() => {
    if (!skuQuery) return allRows;
    const needle = search.toLowerCase();
    return allRows.filter((row) => row.skuCode.toLowerCase().includes(needle));
  }, [allRows, skuQuery, search]);

  // --- adjust dialog --------------------------------------------------------

  const [dialog, setDialog] = useState<AdjustTarget | null>(null);
  const [qtyInput, setQtyInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SessionStock | null>(null);
  const [pending, setPending] = useState(false);

  // Carried pattern: guard late setState from an in-flight adjust after
  // unmount (navigation while the request is in flight).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openAdjust = useCallback((row: SkuRow) => {
    setDialog({ skuId: row.skuId, skuCode: row.skuCode });
    setQtyInput("");
    setReasonInput("");
    setQtyError(null);
    setReasonError(null);
    setServerError(null);
    setNotice(null);
    setPending(false);
  }, []);

  const closeDialog = useCallback(() => {
    // No dismissal while the mutation is in flight.
    if (pending) return;
    setDialog(null);
    setServerError(null);
    setNotice(null);
    setQtyError(null);
    setReasonError(null);
  }, [pending]);

  const parsedQty = useMemo<number | null>(() => {
    const raw = qtyInput.trim();
    if (!INTEGER_RE.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }, [qtyInput]);

  const trimmedReason = reasonInput.trim();
  const confirmationReady =
    parsedQty !== null &&
    parsedQty !== 0 &&
    Math.abs(parsedQty) <= MAX_QTY &&
    trimmedReason.length > 0 &&
    trimmedReason.length <= MAX_REASON;

  const submitAdjust = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!dialog || pending) return;

      // A new attempt clears the previous backend message, even if client
      // validation blocks this submit.
      setServerError(null);

      // Client validation mirrors the backend zod DTO for fast feedback
      // (spec §9); the backend stays the authority.
      let nextQtyError: string | null = null;
      let nextReasonError: string | null = null;
      if (parsedQty === null) {
        nextQtyError = "Enter a whole number.";
      } else if (parsedQty === 0) {
        nextQtyError = "Adjustment quantity must not be zero";
      } else if (Math.abs(parsedQty) > MAX_QTY) {
        nextQtyError = `Quantity must be between −${MAX_QTY.toLocaleString("en-US")} and ${MAX_QTY.toLocaleString("en-US")}.`;
      }
      if (trimmedReason.length === 0) {
        nextReasonError = "Reason is required.";
      } else if (trimmedReason.length > MAX_REASON) {
        nextReasonError = `Reason must be ${MAX_REASON} characters or fewer.`;
      }
      setQtyError(nextQtyError);
      setReasonError(nextReasonError);
      if (nextQtyError || nextReasonError || parsedQty === null) return;

      setPending(true);
      setServerError(null);
      try {
        const result = await adminApi.adjustStock({
          skuId: dialog.skuId,
          quantity: parsedQty,
          reason: trimmedReason,
        });
        if (!mountedRef.current) return;
        // Only rows adjusted this session carry stock figures (gap #1).
        setSessionStock((prev) => ({
          ...prev,
          [dialog.skuId]: result,
        }));
        setNotice(result);
      } catch (err) {
        if (!mountedRef.current) return;
        // 400 (zero / negative-on-hand / missing negative row): keep the
        // dialog open and show the backend message verbatim.
        setServerError(
          err instanceof Error ? err.message : "Adjustment failed.",
        );
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [dialog, pending, parsedQty, trimmedReason],
  );

  // --- render ---------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader title="Inventory" />

      {/* Filter bar */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="md:min-w-[220px] md:flex-1">
            <Field label="Search" htmlFor="inventory-search">
              <TextInput
                id="inventory-search"
                type="search"
                placeholder="Product name — or a SKU code on this page"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Product status" htmlFor="inventory-status">
              <Select
                id="inventory-status"
                value={status}
                onChange={(e) =>
                  patchParams({ status: e.target.value || null, page: null })
                }
              >
                <option value="">All statuses</option>
                {PRODUCT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={clearFilters}
            disabled={!filtersActive && searchInput === ""}
          >
            Clear filters
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Product-name search covers the whole catalog; a SKU-code search
          filters the SKUs on the loaded page only.
        </p>
      </div>

      {/* Table / states */}
      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : permissionDenied ? (
          <EmptyState
            title="You don't have access to the SKU list."
            hint="Inventory viewing in V1 requires catalog access. Ask a Super Admin to assign product management, or open this page from an adjustment link."
          />
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              Couldn&apos;t load SKUs.
            </p>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <Button
              variant="secondary"
              size="md"
              onClick={reload}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No SKUs found."
            hint={filtersActive ? "Try clearing the filters." : undefined}
            action={
              filtersActive ? (
                <Button variant="secondary" size="md" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1000px] text-sm">
              <caption className="sr-only">SKU inventory</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">SKU Code</th>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Variant</th>
                  <th scope="col" className="px-4 py-3">Price</th>
                  <th scope="col" className="px-4 py-3">SKU Status</th>
                  <th scope="col" className="px-4 py-3">Product Status</th>
                  <th scope="col" className="px-4 py-3">Stock</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const stock = sessionStock[row.skuId];
                  const rowBusy = pending && dialog?.skuId === row.skuId;
                  return (
                    <tr
                      key={`${row.variantId}-${row.skuId}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                        {row.skuCode}
                      </td>
                      <td className="px-4 py-3 text-ink">{row.productName}</td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {row.variantName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                        {formatAmount(row.price)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          value={row.skuStatus}
                          tone={row.skuStatus === "ACTIVE" ? "green" : "red"}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          value={row.productStatus}
                          tone={
                            row.productStatus === "ACTIVE" ? "green" : undefined
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {stock ? (
                          <div className="text-xs text-ink-secondary">
                            <div>
                              On hand{" "}
                              <span className="font-semibold text-ink">
                                {stock.onHand}
                              </span>
                            </div>
                            <div className="text-ink-muted">
                              Reserved {stock.reserved} · Available{" "}
                              {stock.available}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canAdjust ? (
                          <button
                            type="button"
                            onClick={() => openAdjust(row)}
                            disabled={rowBusy}
                            className="text-sm font-semibold text-cta hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                          >
                            Adjust
                          </button>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Honest-limitation hint (gap #1): stock is not fetched. */}
      {!loading && !error && rows.length > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          Stock levels appear in a row after you adjust that SKU during this
          session; V1 has no stock-level or movement-history view.
        </p>
      ) : null}

      {data && !loading && !error && !permissionDenied ? (
        <div className="mt-6">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(nextPage) =>
              patchParams({ page: nextPage === 1 ? null : String(nextPage) })
            }
          />
        </div>
      ) : null}

      <Dialog
        open={dialog !== null}
        onClose={closeDialog}
        title="Adjust stock"
        width="sm"
      >
        {dialog ? (
          notice ? (
            <div>
              <p className="text-sm text-ink-secondary">
                SKU <span className="font-semibold">{dialog.skuCode}</span>
              </p>
              <p
                role="status"
                className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800"
              >
                Updated — on hand {notice.onHand}, reserved {notice.reserved},
                available {notice.available}
              </p>
              <div className="mt-6 flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={closeDialog}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitAdjust} noValidate>
              <div className="flex flex-col gap-4">
                <Field label="SKU" htmlFor="adjust-sku">
                  <TextInput
                    id="adjust-sku"
                    value={dialog.skuCode}
                    readOnly
                  />
                </Field>
                <Field label="Quantity" htmlFor="adjust-quantity" error={qtyError ?? undefined}>
                  <TextInput
                    id="adjust-quantity"
                    type="number"
                    step={1}
                    min={-MAX_QTY}
                    max={MAX_QTY}
                    inputMode="numeric"
                    placeholder="Positive to add, negative to remove"
                    value={qtyInput}
                    disabled={pending}
                    onChange={(e) => {
                      setQtyInput(e.target.value);
                      if (qtyError) setQtyError(null);
                    }}
                  />
                </Field>
                <Field label="Reason" htmlFor="adjust-reason" error={reasonError ?? undefined}>
                  <TextInput
                    id="adjust-reason"
                    type="text"
                    maxLength={MAX_REASON}
                    placeholder="Why is stock being adjusted?"
                    value={reasonInput}
                    disabled={pending}
                    onChange={(e) => {
                      setReasonInput(e.target.value);
                      if (reasonError) setReasonError(null);
                    }}
                  />
                </Field>
              </div>

              {confirmationReady && parsedQty !== null ? (
                <p className="mt-4 text-sm text-ink-secondary">
                  Adjust stock for {dialog.skuCode} by {signedQty(parsedQty)}?
                  Reason: {trimmedReason}.
                </p>
              ) : null}

              {serverError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
                >
                  {serverError}
                </p>
              ) : null}

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={closeDialog}
                  disabled={pending}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={pending}
                >
                  {pending ? "Working…" : "Adjust"}
                </Button>
              </div>
            </form>
          )
        ) : null}
      </Dialog>
    </div>
  );
}

export default function AdminInventoryPage() {
  // useSearchParams requires a Suspense boundary for prerender.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
          <TableSkeleton rows={6} cols={8} />
        </div>
      }
    >
      <InventoryPageContent />
    </Suspense>
  );
}
