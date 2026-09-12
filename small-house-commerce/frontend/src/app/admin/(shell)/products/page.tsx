"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  formatAmount,
  type AdminCategoryNode,
  type AdminProduct,
  type Paged,
  type ProductStatus,
} from "@/lib/admin-api";

// ProductStatus union, in declaration order (admin-api.ts).
const PRODUCT_STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "DISABLED"];

type FlatCategory = { id: string; name: string; depth: number };

// Depth-first flatten of the category tree; filter options render depth as
// indentation and id -> name drives the Category column lookup.
function flattenCategories(
  nodes: AdminCategoryNode[],
  depth = 0,
  acc: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    acc.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      flattenCategories(node.children, depth + 1, acc);
    }
  }
  return acc;
}

// Catalog statuses diverge from the bare statusTone map (spec §12): product
// ACTIVE is GREEN, DRAFT amber, DISABLED red.
function productBadgeTone(status: ProductStatus): "green" | "amber" | "red" {
  if (status === "ACTIVE") return "green";
  if (status === "DRAFT") return "amber";
  return "red";
}

function ProductsPageContent() {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // --- URL params: source of truth -----------------------------------------

  const search = searchParams.get("search")?.trim() ?? "";
  const rawStatus = searchParams.get("status");
  const status = PRODUCT_STATUSES.includes(rawStatus as ProductStatus)
    ? (rawStatus as ProductStatus)
    : "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  const filtersActive = Boolean(search || status || categoryId);

  // Blocked-delete page alert (kept across refetch); declared before the
  // URL-filter callbacks so they can clear it when filters change.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      // Any filter change (committed search, status, category, page) dismisses
      // a stale blocked-delete alert.
      setDeleteError(null);
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
  // 300ms debounce. URL -> input reconciliation happens during render (same
  // pattern as the orders list) so reload / back-forward update the field.
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
        // Any filter change resets to page 1.
        patchParams({ search: value || null, page: null });
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput, search, patchParams]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setDeleteError(null);
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // --- categories (tree -> flat filter options + id/name map) ---------------

  const [categories, setCategories] = useState<AdminCategoryNode[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi
      .listCategories()
      .then((res) => {
        if (active) setCategories(res);
      })
      .catch(() => {
        // The table must still render; the category select just stays empty.
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const flatCategories = useMemo(
    () => flattenCategories(categories),
    [categories],
  );
  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of flatCategories) map.set(cat.id, cat.name);
    return map;
  }, [flatCategories]);

  // --- list data ------------------------------------------------------------

  const [data, setData] = useState<Paged<AdminProduct> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force a re-run of the current query (Retry / post-delete truth).
  const queryKey = [
    status,
    search,
    categoryId,
    String(page),
    String(nonce),
  ].join("|");
  // Loading is DERIVED: flips true the moment the keyed query changes and
  // flips back false when that exact query settles.
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    adminApi
      .listProducts({
        status: status || undefined,
        search: search || undefined,
        categoryId: categoryId || undefined,
        page,
      })
      .then((res) => {
        if (!active) return;
        // Last-item-on-page edge (e.g. optimistic delete of the only row on
        // page 2): the server decides — clamp back to page 1 via the URL.
        if (res.items.length === 0 && res.total > 0 && page > 1) {
          const next = new URLSearchParams(searchParams.toString());
          next.delete("page");
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, {
            scroll: false,
          });
          return;
        }
        setData(res);
        setError(null);
        // NOTE: deleteError is intentionally NOT cleared here — the refetch
        // after a blocked delete must restore the row while keeping the
        // page-level failure alert visible.
        setFetchedKey(queryKey);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // 403 for roles without PRODUCT_MANAGE lands here verbatim
        // ("Missing required permission") — surface as the page error.
        setError(
          err instanceof Error ? err.message : "Failed to load products.",
        );
        setFetchedKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [queryKey, status, search, categoryId, page, pathname, router, searchParams]);

  // --- delete ---------------------------------------------------------------

  // The row object is captured so the dialog can show its name even after the
  // optimistic removal.
  const [deleteTarget, setDeleteTarget] = useState<AdminProduct | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const openDelete = useCallback((product: AdminProduct) => {
    setDeleteError(null);
    setDeleteTarget(product);
  }, []);

  const closeDelete = useCallback(() => {
    // Do not allow dismissal while the mutation is in flight.
    if (deletePending) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, [deletePending]);

  const submitDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeletePending(true);
    setDeleteError(null);
    // Optimistic: remove from the current page immediately (brief Step 2).
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((p) => p.id !== target.id),
            total: Math.max(0, prev.total - 1),
          }
        : prev,
    );
    try {
      await adminApi.deleteProduct(target.id);
      // Success: close the dialog and refetch for server truth; if the row
      // resurfaces the refetch restores it.
      setDeleteTarget(null);
      setDeleteError(null);
      setNonce((n) => n + 1);
    } catch (err) {
      // A blocked delete (order items / reservations incl. RELEASED) returns
      // HTTP 500 with a generic Prisma message — spec §14 gap #6. Never
      // assume 400: show the backend message verbatim as a page alert,
      // close the dialog, refetch, and keep the row (refetch restores it).
      setDeleteTarget(null);
      setDeleteError(
        err instanceof Error ? err.message : "Delete failed.",
      );
      setNonce((n) => n + 1);
    } finally {
      setDeletePending(false);
    }
  }, [deleteTarget]);

  const onDeleteSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitDelete();
  };

  // --- render ---------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="Products"
        count={data?.total}
        actions={
          canManage ? (
            <Link
              href="/admin/products/new"
              className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
            >
              New product
            </Link>
          ) : null
        }
      />

      {/* Filter bar */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="md:min-w-[220px] md:flex-1">
            <Field label="Search" htmlFor="products-search">
              <TextInput
                id="products-search"
                type="search"
                placeholder="Product name or slug"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </Field>
          </div>
          <div className="md:w-44">
            <Field label="Status" htmlFor="products-status">
              <Select
                id="products-status"
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
          <div className="md:min-w-[220px] md:flex-1">
            <Field label="Category" htmlFor="products-category">
              <Select
                id="products-category"
                value={categoryId}
                onChange={(e) =>
                  patchParams({
                    categoryId: e.target.value || null,
                    page: null,
                  })
                }
              >
                <option value="">All categories</option>
                {flatCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {"  ".repeat(cat.depth)}
                    {cat.depth > 0 ? "– " : ""}
                    {cat.name}
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
      </div>

      {/* Delete error (page-level alert; dialog closes on failure, §10/§14 #6) */}
      {deleteError && !loading && !error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">Product could not be deleted.</p>
              <p className="mt-1">{deleteError}</p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              aria-label="Dismiss error"
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-700 hover:bg-red-100"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* Table / states */}
      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              Couldn&apos;t load products.
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
        ) : data && data.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              title="No products found."
              hint="Try clearing the filters."
              action={
                <Button variant="secondary" size="md" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No products yet — create your first product."
              action={
                canManage ? (
                  <Link
                    href="/admin/products/new"
                    className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
                  >
                    New product
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1000px] text-sm">
              <caption className="sr-only">Products</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Slug</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Price</th>
                  <th scope="col" className="px-4 py-3">Variants</th>
                  <th scope="col" className="px-4 py-3">Updated</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => {
                  const rowBusy =
                    deletePending && deleteTarget?.id === row.id;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <PlaceholderImage
                            label={row.name}
                            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg"
                          />
                          <span
                            className="max-w-[220px] truncate font-medium text-ink"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="block max-w-[180px] truncate text-ink-secondary"
                          title={row.slug}
                        >
                          {row.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {categoryNames.get(row.categoryId) ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          value={row.status}
                          tone={productBadgeTone(row.status)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                        {formatAmount(row.variants[0]?.sku?.price ?? null)}
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {row.variants.length}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                        {new Date(row.updatedAt).toLocaleString("en-PH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <div className="flex gap-3">
                            <Link
                              href={`/admin/products/${row.id}/edit`}
                              className="text-sm font-semibold text-cta hover:underline"
                            >
                              Edit
                            </Link>
                            <button
                              type="button"
                              onClick={() => openDelete(row)}
                              disabled={rowBusy}
                              className="text-sm font-semibold text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                            >
                              Delete
                            </button>
                          </div>
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

      {data && !loading && !error ? (
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
        open={deleteTarget !== null}
        onClose={closeDelete}
        title="Delete product"
        width="sm"
      >
        {deleteTarget ? (
          <form onSubmit={onDeleteSubmit}>
            <p className="text-sm text-ink-secondary">
              {`Delete ${deleteTarget.name}? Its variants, SKUs and images are removed. This fails if any order item or reservation references its SKUs.`}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeDelete}
                disabled={deletePending}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={deletePending}
                aria-busy={deletePending}
                className="bg-red-600 hover:bg-red-700 active:bg-red-700"
              >
                {deletePending ? "Working…" : "Delete"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

export default function AdminProductsPage() {
  // useSearchParams requires a Suspense boundary for prerender.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
          <TableSkeleton rows={6} cols={8} />
        </div>
      }
    >
      <ProductsPageContent />
    </Suspense>
  );
}
