"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@/components/admin/Dialog";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminProduct } from "@/lib/admin-api";

/**
 * Shared product picker for every admin place that links a product.
 *
 * Operators could not tell which product a link pointed at: the old controls
 * showed a bare name (or a raw id when the product was outside the loaded
 * page). Every entry point now shows the product photo, name, price and
 * internal code, and the current selection is displayed the same way.
 */

const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 50;

export function productThumbnailUrl(product: AdminProduct): string | null {
  const images = product.images ?? [];
  const image = images.find((entry) => entry.type === "IMAGE") ?? images[0];
  return image?.url ?? null;
}

export function productPriceLabel(product: AdminProduct): string | null {
  for (const variant of product.variants ?? []) {
    const price = variant.sku?.price;
    if (price) return `₱${price}`;
  }
  return null;
}

export type ProductSummary = { name: string; imageUrl: string | null };

/**
 * Products resolved by id, cached for the session. Section payloads store
 * product ids only, so a linked product is frequently outside the page the
 * editor happens to have loaded; without this the admin showed a raw uuid.
 */
const summaryCache = new Map<string, ProductSummary>();

/** Resolves product ids to their name and photo, fetching the missing ones. */
export function useProductSummaries(ids: string[]): Map<string, ProductSummary> {
  const key = ids.filter(Boolean).join(",");
  const [resolved, setResolved] = useState<Map<string, ProductSummary>>(
    () => new Map(),
  );

  useEffect(() => {
    const wanted = ids.filter(
      (id) => id && !summaryCache.has(id) && !resolved.has(id),
    );
    if (wanted.length === 0) return;
    let active = true;
    void Promise.all(
      wanted.map(async (id) => {
        try {
          const product = await adminApi.getProduct(id);
          return [id, { name: product.name, imageUrl: productThumbnailUrl(product) }] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      for (const entry of entries) {
        if (entry) summaryCache.set(entry[0], entry[1]);
      }
      setResolved(new Map(summaryCache));
    });
    return () => {
      active = false;
    };
    // `key` captures the id list; `resolved` is read for the cache check only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const merged = new Map<string, ProductSummary>(summaryCache);
    for (const [id, summary] of resolved) merged.set(id, summary);
    return merged;
  }, [resolved]);
}

/** Product photo, or a neutral block when the product has no image yet. */
export function ProductThumbnail({
  imageUrl,
  name,
  className = "h-10 w-10",
  testId,
}: {
  imageUrl: string | null;
  name: string;
  className?: string;
  testId?: string;
}): ReactNode {
  if (!imageUrl) {
    return <PlaceholderImage label="" className={`${className} shrink-0 rounded-lg`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
    <img
      data-testid={testId}
      src={imageUrl}
      alt=""
      className={`${className} shrink-0 rounded-lg object-cover`}
    />
  );
}

/** One product in a picker grid: photo, name, price and internal code. */
export function ProductCard({
  product,
  selected = false,
  disabled = false,
  onSelect,
  testIdPrefix,
}: {
  product: AdminProduct;
  selected?: boolean;
  disabled?: boolean;
  onSelect: (product: AdminProduct) => void;
  testIdPrefix?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const thumbnail = productThumbnailUrl(product);
  const price = productPriceLabel(product);
  return (
    <button
      type="button"
      data-testid={`${testIdPrefix ?? "product-picker"}-option-${product.slug}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(product)}
      className={`flex w-full flex-col gap-1 rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-cta bg-primary-light/40"
          : "border-border hover:border-primary"
      }`}
    >
      <ProductThumbnail
        imageUrl={thumbnail}
        name={product.name}
        className="aspect-[4/3] w-full rounded-lg"
        testId={`${testIdPrefix ?? "product-picker"}-thumb-${product.slug}`}
      />
      <span className="line-clamp-2 text-sm font-medium text-ink">
        {product.name}
      </span>
      <span className="text-xs text-ink-muted">
        {price ? `${price} · ` : ""}
        {product.productCode ?? t("admin_product_picker_no_code")}
      </span>
    </button>
  );
}

/**
 * Large product page. `products` supplies a pre-loaded candidate list (for
 * places that may only link a subset of the catalogue); without it the whole
 * catalogue is searched server-side.
 */
export function ProductPickerDialog({
  open,
  onClose,
  onSelect,
  selectedIds = [],
  multiple = false,
  title,
  products,
  searchLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (product: AdminProduct) => void;
  selectedIds?: string[];
  multiple?: boolean;
  title?: string;
  products?: AdminProduct[];
  searchLabel?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const [search, setSearch] = useState("");
  const [catalogue, setCatalogue] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const term = search.trim();
  const searchText = searchLabel ?? t("admin_product_picker_search");

  useEffect(() => {
    if (!open || products) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      adminApi
        .listProducts({
          ...(term ? { search: term } : {}),
          page: 1,
          pageSize: PAGE_SIZE,
        })
        .then((result) => {
          if (active) setCatalogue(Array.isArray(result.items) ? result.items : []);
        })
        .catch(() => {
          if (!active) return;
          setCatalogue([]);
          setFailed(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, term ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, products, term]);

  const visible = useMemo(() => {
    if (!products) return catalogue;
    if (term === "") return products;
    const needle = term.toLowerCase();
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.productCode ?? "").toLowerCase().includes(needle),
    );
  }, [products, catalogue, term]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? t("admin_product_picker_title")}
      width="lg"
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {searchText}
          <input
            type="search"
            value={search}
            aria-label={searchText}
            placeholder={searchText}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
        {loading ? (
          <p className="text-sm text-ink-muted">{t("admin_product_picker_loading")}</p>
        ) : failed ? (
          <p role="alert" className="text-sm text-sale">
            {t("admin_product_picker_failed")}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("admin_product_picker_empty")}</p>
        ) : (
          <ul
            data-testid="product-picker-list"
            className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4"
          >
            {visible.map((product) => (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  selected={selectedIds.includes(product.id)}
                  onSelect={(picked) => {
                    onSelect(picked);
                    if (!multiple) onClose();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Compact field for a single linked product: shows the product photo and
 * name, and opens the large picker to change it.
 */
export function ProductPickerField({
  label,
  value,
  onChange,
  clearLabel,
  disabled = false,
  scope,
  products,
  title,
}: {
  label: string;
  value?: string;
  onChange: (productId: string | undefined) => void;
  clearLabel?: string;
  disabled?: boolean;
  /** Namespaces the test ids so several fields can live in one editor. */
  scope?: string;
  /** Restricts the picker to a pre-loaded candidate list. */
  products?: AdminProduct[];
  title?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ProductSummary | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const ids = scope
    ? {
        current: `${scope}-current`,
        thumb: `${scope}-thumb`,
        rawId: `${scope}-id`,
        open: `${scope}-open`,
        clear: `${scope}-clear`,
      }
    : {
        current: "product-picker-current",
        thumb: "product-picker-current-thumb",
        rawId: "product-picker-current-id",
        open: "product-picker-open",
        clear: "product-picker-clear",
      };

  useEffect(() => {
    if (!value) {
      setCurrent(null);
      setUnresolved(false);
      return;
    }
    const fromList = products?.find((product) => product.id === value);
    if (fromList) {
      setCurrent({
        name: fromList.name,
        imageUrl: productThumbnailUrl(fromList),
      });
      setUnresolved(false);
      return;
    }
    let active = true;
    setCurrent(null);
    setUnresolved(false);
    adminApi
      .getProduct(value)
      .then((product) => {
        if (!active) return;
        setCurrent({ name: product.name, imageUrl: productThumbnailUrl(product) });
      })
      .catch(() => {
        if (!active) return;
        setCurrent(null);
        setUnresolved(true);
      });
    return () => {
      active = false;
    };
  }, [value, products]);

  const openLabel = t("admin_product_picker_open");
  const clearText = clearLabel ?? t("admin_product_picker_clear");

  return (
    <div data-testid="product-picker-field" className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      {value && current ? (
        <div
          data-testid={ids.current}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-2"
        >
          <ProductThumbnail
            imageUrl={current.imageUrl}
            name={current.name}
            className="h-10 w-10"
            testId={ids.thumb}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{current.name}</span>
          <button
            type="button"
            data-testid={ids.open}
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-60"
          >
            {openLabel}
          </button>
          <button
            type="button"
            data-testid={ids.clear}
            disabled={disabled}
            onClick={() => onChange(undefined)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sale hover:bg-sale/10 disabled:opacity-60"
          >
            {clearText}
          </button>
        </div>
      ) : value && unresolved ? (
        <div
          data-testid={ids.current}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-2"
        >
          <span
            data-testid={ids.rawId}
            className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted"
          >
            {value}
          </span>
          <span className="shrink-0 text-xs text-sale">
            {t("admin_product_picker_unresolved")}
          </span>
          <button
            type="button"
            data-testid={ids.open}
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-60"
          >
            {openLabel}
          </button>
          <button
            type="button"
            data-testid={ids.clear}
            disabled={disabled}
            onClick={() => onChange(undefined)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sale hover:bg-sale/10 disabled:opacity-60"
          >
            {clearText}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid={ids.open}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="w-fit rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-ink hover:bg-surface disabled:opacity-60"
        >
          {t("admin_product_picker_choose")}
        </button>
      )}
      <ProductPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(product) => {
          onChange(product.id);
          setOpen(false);
        }}
        selectedIds={value ? [value] : []}
        products={products}
        title={title}
      />
    </div>
  );
}
