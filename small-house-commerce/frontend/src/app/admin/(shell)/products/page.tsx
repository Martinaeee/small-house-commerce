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
  type ReactNode,
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
import { ProductQuickView } from "@/components/admin/ProductQuickView";
import { Button } from "@/components/ui/Button";
import {
  ADMIN_PRODUCT_ATTENTION,
  adminApi,
  formatAmount,
  type AdminCategoryNode,
  type AdminProduct,
  type AdminProductAttention,
  type AdminProductCounts,
  type Paged,
  type ProductStatus,
} from "@/lib/admin-api";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";

// ProductStatus union, in declaration order (admin-api.ts).
const PRODUCT_STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "DISABLED"];

// Catalog statuses diverge from the bare statusTone map (spec §12): product
// ACTIVE is GREEN, DRAFT amber, DISABLED red.
function productBadgeTone(status: ProductStatus): "green" | "amber" | "red" {
  if (status === "ACTIVE") return "green";
  if (status === "DRAFT") return "amber";
  return "red";
}

// Translated badge/filter labels; the wire values stay DRAFT/ACTIVE/DISABLED.
const STATUS_LABEL_KEYS: Record<ProductStatus, TKey> = {
  DRAFT: "product_form_status_draft",
  ACTIVE: "product_form_status_active",
  DISABLED: "product_form_status_disabled",
};

// "Needs attention" preset labels; the wire values stay the API's snake_case.
const ATTENTION_LABEL_KEYS: Record<AdminProductAttention, TKey> = {
  missing_media: "products_attention_missing_media",
  no_priced_sku: "products_attention_no_priced_sku",
  incomplete_shipping: "products_attention_incomplete_shipping",
  stale_draft: "products_attention_stale_draft",
};

// The storefront column reports the SAVED status — the only thing a shopper can
// reach — never a form selection that has not been written yet.
const STOREFRONT_BADGE_LABEL_KEYS: Record<ProductStatus, TKey> = {
  ACTIVE: "products_storefront_badge_live",
  DRAFT: "products_storefront_badge_draft",
  DISABLED: "products_storefront_badge_unpublished",
};

/** Distinct ACTIVE SKU prices, ascending. Empty when nothing is sellable. */
function activePrices(row: AdminProduct): number[] {
  const prices = new Set<number>();
  for (const variant of row.variants) {
    const sku = variant.sku;
    if (!sku || sku.status !== "ACTIVE" || sku.price === null) continue;
    const price = Number(sku.price);
    if (Number.isFinite(price)) prices.add(price);
  }
  return [...prices].sort((left, right) => left - right);
}

/** Removable tag for one active list filter. */
function FilterTag({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-cta bg-primary-light/40 px-2.5 py-1 font-medium text-cta">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="flex h-4 w-4 items-center justify-center rounded-full text-cta hover:bg-cta hover:text-white"
      >
        ✕
      </button>
    </span>
  );
}

/** One price, or a "from – to" range when the variants disagree. */
function priceLabel(row: AdminProduct): string {
  const prices = activePrices(row);
  if (prices.length === 0) return "—";
  const lowest = formatAmount(prices[0]);
  const highest = formatAmount(prices[prices.length - 1]);
  return lowest === highest ? lowest : `${lowest} – ${highest}`;
}

/**
 * Sentinel for list rejections that carry no Error message: the visible copy
 * resolves via t() at render, so no English fallback lives in state.
 */
const LOAD_ERROR_FALLBACK = Symbol("products-load-fallback");

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

function ProductsPageContent() {
  const { t } = useAdminI18n();
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
  const rawAttention = searchParams.get("attention");
  const attention = ADMIN_PRODUCT_ATTENTION.includes(
    rawAttention as AdminProductAttention,
  )
    ? (rawAttention as AdminProductAttention)
    : "";
  const page =
    Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10)) || 1;

  const filtersActive = Boolean(search || status || categoryId || attention);

  // Blocked-delete page alert (kept across refetch); declared before the
  // URL-filter callbacks so they can clear it when filters change.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Read-only peek at one product; never a second editing surface.
  const [quickView, setQuickView] = useState<AdminProduct | null>(null);

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
  // Server-aggregated counters: the status totals and every "needs attention"
  // preset. Never derived from the visible page.
  const [counts, setCounts] = useState<AdminProductCounts | null>(null);
  const [error, setError] = useState<
    string | typeof LOAD_ERROR_FALLBACK | null
  >(null);
  // Bumped to force a re-run of the current query (Retry / post-delete truth).
  const queryKey = [
    status,
    search,
    categoryId,
    attention,
    String(page),
    String(nonce),
  ].join("|");
  // Loading is DERIVED: flips true the moment the keyed query changes and
  // flips back false when that exact query settles.
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const loading = fetchedKey !== queryKey;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Counters refresh with the list (nonce bumps on delete/retry). A failure
  // only hides the strip — the table must still render.
  useEffect(() => {
    let active = true;
    adminApi
      .productCounts()
      .then((res) => {
        if (active) setCounts(res);
      })
      .catch(() => {
        // Keep the previous counters rather than flashing zeros.
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  useEffect(() => {
    let active = true;
    adminApi
      .listProducts({
        status: status || undefined,
        search: search || undefined,
        categoryId: categoryId || undefined,
        attention: attention || undefined,
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
          err instanceof Error ? err.message : LOAD_ERROR_FALLBACK,
        );
        setFetchedKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [queryKey, status, search, categoryId, attention, page, pathname, router, searchParams]);
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
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={t("products_title")}
        count={data?.total}
        actions={
          <>
            <details className="relative">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-ink-secondary hover:border-primary hover:text-cta">
                <span aria-hidden>?</span>
                {t("products_help_summary")}
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-ink-secondary shadow-xl">
                <p className="text-sm font-semibold text-ink">
                  {t("products_legend_title")}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>{t("products_legend_status")}</li>
                  <li>{t("products_legend_inventory")}</li>
                  <li>{t("products_legend_collections")}</li>
                </ul>
              </div>
            </details>
            {canManage ? (
              <Link
                href="/admin/products/new"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-cta px-4 text-sm font-semibold text-white hover:bg-cta-hover"
              >
                {t("products_new")}
              </Link>
            ) : null}
          </>
        }
      />

      {/* Status totals are navigation, not dashboard cards. Keep them first so
          the current catalogue scope is obvious before any finer filters. */}
      {counts ? (
        <section
          aria-label={t("products_status_summary_aria")}
          className="mt-5 overflow-x-auto border-b border-border"
        >
          <div className="flex min-w-max items-end gap-1">
            {(
              [
                { value: "", labelKey: "products_status_all", count: counts.status.all },
                { value: "ACTIVE", labelKey: "product_form_status_active", count: counts.status.active },
                { value: "DRAFT", labelKey: "product_form_status_draft", count: counts.status.draft },
                { value: "DISABLED", labelKey: "product_form_status_disabled", count: counts.status.disabled },
              ] as const satisfies readonly { value: string; labelKey: TKey; count: number }[]
            ).map((item) => {
              const selected = status === item.value;
              return (
                <button
                  key={item.value || "all"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    patchParams({ status: item.value || null, page: null })
                  }
                  className={`flex min-w-[8.5rem] items-center justify-between gap-3 border-b-2 px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? "border-cta text-cta"
                      : "border-transparent text-ink-secondary hover:border-primary hover:text-ink"
                  }`}
                >
                  <span>{t(item.labelKey)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      selected
                        ? "bg-primary-light/50 text-cta"
                        : "bg-background text-ink-muted"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Attention presets share the server predicate with their counts. Empty
          presets stay available but recede; actual problems carry amber weight. */}
      {counts || attention ? (
        <section
          aria-label={t("products_attention_aria")}
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <span className="mr-1 text-sm font-semibold text-ink">
            {t("products_attention_title")}
          </span>
          {ADMIN_PRODUCT_ATTENTION.map((key) => {
            const selected = attention === key;
            const count = counts?.attention[key] ?? null;
            const hasIssues = (count ?? 0) > 0;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  patchParams({ attention: selected ? null : key, page: null })
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "border-cta bg-primary-light/40 text-cta"
                    : hasIssues
                      ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400"
                      : "border-border bg-background/50 text-ink-muted opacity-50 hover:opacity-80"
                }`}
              >
                {t(ATTENTION_LABEL_KEYS[key])}
                {count !== null ? (
                  <span className="ml-1.5 font-semibold">{count}</span>
                ) : null}
              </button>
            );
          })}
        </section>
      ) : null}

      {/* Search and categorical filters follow status and attention scope. */}
      <section
        aria-label={t("products_filters_aria")}
        className="mt-4 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="md:min-w-[220px] md:flex-1">
            <Field label={t("products_search_label")} htmlFor="products-search">
              <TextInput
                id="products-search"
                type="search"
                placeholder={t("products_search_placeholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </Field>
          </div>
          <div className="md:w-44">
            <Field label={t("products_status_label")} htmlFor="products-status">
              <Select
                id="products-status"
                value={status}
                onChange={(e) =>
                  patchParams({ status: e.target.value || null, page: null })
                }
              >
                <option value="">{t("products_status_all")}</option>
                {PRODUCT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(STATUS_LABEL_KEYS[value])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="md:min-w-[220px] md:flex-1">
            <Field label={t("products_category_label")} htmlFor="products-category">
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
                <option value="">{t("products_category_all")}</option>
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
            {t("products_clear_filters")}
          </Button>
        </div>
      </section>

      {/* Active filters stay visible with a one-click clear, so a filtered list
          can never look like "the catalogue only has these rows". */}
      {attention || status || categoryId ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-secondary">{t("products_filter_active")}</span>
          {attention ? (
            <FilterTag
              label={t(ATTENTION_LABEL_KEYS[attention])}
              clearLabel={t("products_filter_clear_one", {
                label: t(ATTENTION_LABEL_KEYS[attention]),
              })}
              onClear={() => patchParams({ attention: null, page: null })}
            />
          ) : null}
          {status ? (
            <FilterTag
              label={t(STATUS_LABEL_KEYS[status])}
              clearLabel={t("products_filter_clear_one", {
                label: t(STATUS_LABEL_KEYS[status]),
              })}
              onClear={() => patchParams({ status: null, page: null })}
            />
          ) : null}
          {categoryId ? (
            <FilterTag
              label={categoryNames.get(categoryId) ?? categoryId}
              clearLabel={t("products_filter_clear_one", {
                label: categoryNames.get(categoryId) ?? categoryId,
              })}
              onClear={() => patchParams({ categoryId: null, page: null })}
            />
          ) : null}
          <button
            type="button"
            onClick={clearFilters}
            className="font-semibold text-cta hover:underline"
          >
            {t("products_clear_filters")}
          </button>
        </div>
      ) : null}

      {/* Delete error (page-level alert; dialog closes on failure, §10/§14 #6) */}
      {deleteError && !loading && !error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">{t("products_delete_error_title")}</p>
              <p className="mt-1">{deleteError}</p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              aria-label={t("products_dismiss_error")}
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
          <TableSkeleton rows={6} cols={9} />
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              {t("products_load_error_title")}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {error === LOAD_ERROR_FALLBACK ? t("products_load_failed") : error}
            </p>
            <Button
              variant="secondary"
              size="md"
              onClick={reload}
              className="mt-4"
            >
              {t("common_retry")}
            </Button>
          </div>
        ) : data && data.items.length === 0 ? (
          filtersActive ? (
            <EmptyState
              title={t("products_empty_filtered_title")}
              hint={t("products_empty_filtered_hint")}
              action={
                <Button variant="secondary" size="md" onClick={clearFilters}>
                  {t("products_clear_filters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t("products_empty_title")}
              action={
                canManage ? (
                  <Link
                    href="/admin/products/new"
                    className="inline-flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
                  >
                    {t("products_new")}
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1080px] table-fixed text-sm">
              <caption className="sr-only">{t("products_title")}</caption>
              <colgroup>
                <col className="w-[5.5rem]" />
                <col className="w-[17.25rem]" />
                <col className="w-[5.5rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[12rem]" />
                <col className="w-[5.5rem]" />
                <col className="w-[7rem]" />
                <col className="w-[8rem]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_code")}</th>
                  <th scope="col" className="px-3 py-3">{t("products_col_product")}</th>
                  <th scope="col" className="px-3 py-3">{t("products_col_category")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_skus")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_status")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_price")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_storefront")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("products_col_updated")}</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">{t("common_actions")}</th>
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
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-medium tracking-wide text-ink-secondary">
                        {row.productCode ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          {row.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
                            <img
                              src={row.images[0].url}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-lg border border-border object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <PlaceholderImage
                              label={row.name}
                              className="h-14 w-14 shrink-0 overflow-hidden rounded-lg"
                            />
                          )}
                          <div className="min-w-0">
                            <span
                              className="block max-w-[16rem] truncate font-semibold leading-tight text-ink"
                              title={row.name}
                            >
                              {row.name}
                            </span>
                            <span
                              className="mt-1 block max-w-[16rem] truncate text-xs text-ink-muted"
                              title={row.slug}
                            >
                              {row.slug}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-ink-secondary">
                        {categoryNames.get(row.categoryId) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-ink-secondary">
                        {row.activeOptionNames &&
                        row.activeOptionNames.length > 0 ? (
                          <>
                            <span className="block text-ink">
                              {row.activeOptionNames.join(" × ")}
                            </span>
                            <span className="block text-xs text-ink-muted">
                              {t("products_skus_count", {
                                count: row.variants.length,
                              })}
                            </span>
                          </>
                        ) : (
                          t("products_skus_count", { count: row.variants.length })
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          value={t(STATUS_LABEL_KEYS[row.status])}
                          tone={productBadgeTone(row.status)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                        {priceLabel(row)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge
                          value={t(STOREFRONT_BADGE_LABEL_KEYS[row.status])}
                          tone={productBadgeTone(row.status)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-secondary">
                        {new Date(row.updatedAt).toLocaleDateString("en-PH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-3">
                        {canManage ? (
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setQuickView(row)}
                              aria-label={t("products_action_quick_view_aria", {
                                name: row.name,
                              })}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-secondary hover:border-border hover:bg-background hover:text-cta"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden
                                className="h-4 w-4"
                              >
                                <path
                                  d="M2.8 12s3.2-5.2 9.2-5.2S21.2 12 21.2 12 18 17.2 12 17.2 2.8 12 2.8 12Z"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                />
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="2.4"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                />
                              </svg>
                            </button>
                            <Link
                              href={`/admin/products/${row.id}/edit`}
                              aria-label={t("products_action_edit_aria", {
                                name: row.name,
                              })}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-secondary hover:border-border hover:bg-background hover:text-cta"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden
                                className="h-4 w-4"
                              >
                                <path
                                  d="m14.7 5.3 4 4M4.5 19.5l3.8-.8L19 8a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L5.3 15.7l-.8 3.8Z"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </Link>
                            {/* Destructive and rare actions stay folded away:
                                a product with order history is not disposable. */}
                            <details className="relative">
                              <summary
                                role="button"
                                aria-label={t("products_more_actions")}
                                className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-transparent text-ink-secondary hover:border-border hover:bg-background hover:text-cta"
                              >
                                ⋯
                              </summary>
                              <div className="absolute right-0 z-10 mt-1 flex w-40 flex-col rounded-lg border border-border bg-card p-1 shadow-lg">
                                <Link
                                  href={`/admin/products/${row.id}/reviews`}
                                  className="rounded px-3 py-2 text-sm text-ink hover:bg-primary-light/30"
                                >
                                  {t("products_action_reviews")}
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => openDelete(row)}
                                  disabled={rowBusy}
                                  className="rounded px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-ink-muted"
                                >
                                  {t("common_delete")}
                                </button>
                              </div>
                            </details>
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
        title={t("products_delete_dialog_title")}
        width="sm"
      >
        {deleteTarget ? (
          <form onSubmit={onDeleteSubmit}>
            <p className="text-sm text-ink-secondary">
              {t("products_delete_dialog_body", { name: deleteTarget.name })}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={closeDelete}
                disabled={deletePending}
              >
                {t("common_back")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={deletePending}
                aria-busy={deletePending}
                className="bg-red-600 hover:bg-red-700 active:bg-red-700"
              >
                {deletePending ? t("products_working") : t("common_delete")}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <ProductQuickView
        row={quickView}
        categoryName={
          quickView ? categoryNames.get(quickView.categoryId) : undefined
        }
        onClose={() => setQuickView(null)}
      />
    </div>
  );
}

export default function AdminProductsPage() {
  // useSearchParams requires a Suspense boundary for prerender.
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none px-4 py-6 md:px-8">
          <TableSkeleton rows={6} cols={9} />
        </div>
      }
    >
      <ProductsPageContent />
    </Suspense>
  );
}
