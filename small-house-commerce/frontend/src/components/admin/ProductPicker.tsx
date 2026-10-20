"use client";

import {
  useCallback,
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

/**
 * What every product chooser needs to show a product: photo, name and the
 * internal code. Sources differ (the full catalogue, a marketing-scoped
 * list), so the chooser works on this shape rather than on one API type.
 */
export type ProductOption = {
  id: string;
  name: string;
  slug?: string;
  productCode?: string | null;
  thumbnailUrl?: string | null;
  price?: string | null;
};

/**
 * Loads products for a search term. Used where the candidate list is scoped
 * by the caller (marketing) instead of the full catalogue.
 */
export type ProductLoader = (search: string) => Promise<ProductOption[]>;

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

/** Maps a catalogue product onto the shape the choosers render. */
export function productOption(product: AdminProduct): ProductOption {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    productCode: product.productCode,
    thumbnailUrl: productThumbnailUrl(product),
    price: productPriceLabel(product),
  };
}

export type ProductSummary = { name: string; imageUrl: string | null };

/**
 * Products resolved by id, cached for the session. Section payloads store
 * product ids only, so a linked product is frequently outside the page the
 * editor happens to have loaded; without this the admin showed a raw uuid.
 */
const summaryCache = new Map<string, ProductSummary>();

/**
 * Resolves product ids to their name and photo.
 *
 * One catalogue page covers the common case; ids outside it are fetched one
 * by one. Results are cached for the session, so re-opening an editor does
 * not re-fetch.
 */
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
    const load = async (): Promise<void> => {
      const page = await adminApi
        .listProducts({ page: 1, pageSize: PAGE_SIZE })
        .then((result) => (Array.isArray(result.items) ? result.items : []))
        .catch(() => [] as AdminProduct[]);
      if (!active) return;
      const known = new Set(page.map((product) => product.id));
      for (const product of page) {
        summaryCache.set(product.id, {
          name: product.name,
          imageUrl: productThumbnailUrl(product),
        });
      }
      const missing = wanted.filter((id) => !known.has(id));
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async (id) => {
            try {
              const product = await adminApi.getProduct(id);
              return [
                id,
                { name: product.name, imageUrl: productThumbnailUrl(product) },
              ] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!active) return;
        for (const entry of fetched) {
          if (entry) summaryCache.set(entry[0], entry[1]);
        }
      }
      if (active) setResolved(new Map(summaryCache));
    };
    void load();
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
  className = "h-10 w-10",
  testId,
}: {
  imageUrl: string | null | undefined;
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
  status,
}: {
  product: ProductOption;
  selected?: boolean;
  disabled?: boolean;
  onSelect: (product: ProductOption) => void;
  testIdPrefix?: string;
  status?: ReactNode;
}): ReactNode {
  const { t } = useAdminI18n();
  const price = product.price ?? null;
  return (
    <button
      type="button"
      data-testid={`${testIdPrefix ?? "product-picker"}-option-${product.slug ?? product.id}`}
      aria-label={product.name}
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
        imageUrl={product.thumbnailUrl ?? null}
        className="aspect-[4/3] w-full rounded-lg"
        testId={`${testIdPrefix ?? "product-picker"}-thumb-${product.slug ?? product.id}`}
      />
      <span className="line-clamp-2 text-sm font-medium text-ink">
        {product.name}
      </span>
      <span className="text-xs text-ink-muted">
        {price ? `${price} · ` : ""}
        {product.productCode ?? t("admin_product_picker_no_code")}
      </span>
      {status ? <span className="text-xs text-ink-muted">{status}</span> : null}
    </button>
  );
}

/**
 * Searches the catalogue. Exposed so that every chooser loads products the
 * same way and can offer the same "search by name or code" behaviour.
 */
export function useProductCatalogue(
  search: string,
  enabled = true,
): {
  products: ProductOption[];
  loading: boolean;
  failed: boolean;
} {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const term = search.trim();

  useEffect(() => {
    if (!enabled) return;
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
          if (active) {
            setProducts(
              (Array.isArray(result.items) ? result.items : []).map(productOption),
            );
          }
        })
        .catch(() => {
          if (!active) return;
          setProducts([]);
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
  }, [term, enabled]);

  return { products, loading, failed };
}

/**
 * The product grid: a search box plus the product cards.
 *
 * Shared by the large modal picker and by the inline variant used inside
 * other admin dialogs - a modal cannot open another modal here, so the
 * inline variant shows the very same cards in place.
 */
export function ProductOptionGrid({
  products,
  loadProducts,
  selectedIds = [],
  disabledIds = [],
  onSelect,
  searchLabel,
  renderStatus,
  testIdPrefix,
  enabled = true,
}: {
  /** A pre-loaded candidate list, filtered in the browser. */
  products?: ProductOption[];
  /** A server-side search, used when the candidate list is scoped. */
  loadProducts?: ProductLoader;
  selectedIds?: string[];
  disabledIds?: string[];
  onSelect: (product: ProductOption) => void;
  searchLabel?: string;
  renderStatus?: (product: ProductOption) => ReactNode;
  testIdPrefix?: string;
  enabled?: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  const [search, setSearch] = useState("");
  const term = search.trim();
  const searchText = searchLabel ?? t("admin_product_picker_search");
  const [remote, setRemote] = useState<{
    term: string;
    items: ProductOption[];
    failed: boolean;
  } | null>(null);
  const usingCatalogue = !loadProducts && !products;
  const catalogue = useProductCatalogue(
    usingCatalogue ? term : "",
    usingCatalogue && enabled,
  );

  useEffect(() => {
    if (!loadProducts || !enabled) return;
    let active = true;
    const timer = setTimeout(() => {
      loadProducts(term)
        .then((items) => {
          if (!active) return;
          setRemote({ term, items, failed: false });
        })
        .catch(() => {
          if (!active) return;
          setRemote({ term, items: [], failed: true });
        });
    }, term ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loadProducts, term, enabled]);

  // The result belongs to the term it was requested for; anything else is stale.
  const remoteState = remote && remote.term === term ? remote : null;

  const visible = useMemo(() => {
    if (loadProducts) return remoteState?.items ?? [];
    if (!products) return catalogue.products;
    if (term === "") return products;
    const needle = term.toLowerCase();
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        (product.productCode ?? "").toLowerCase().includes(needle),
    );
  }, [loadProducts, remoteState, products, catalogue.products, term]);

  const loading = usingCatalogue ? catalogue.loading : Boolean(loadProducts) && !remoteState;
  const failed = usingCatalogue ? catalogue.failed : Boolean(remoteState?.failed);

  return (
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
                disabled={disabledIds.includes(product.id)}
                onSelect={onSelect}
                testIdPrefix={testIdPrefix}
                status={renderStatus?.(product)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Large product page. `products` supplies a pre-loaded candidate list (for
 * places that may only link a subset of the catalogue); `loadProducts` loads
 * the candidates from a scoped source instead of the whole catalogue.
 */
export function ProductPickerDialog({
  open,
  onClose,
  onSelect,
  selectedIds = [],
  disabledIds = [],
  multiple = false,
  title,
  products,
  loadProducts,
  searchLabel,
  renderStatus,
  testIdPrefix,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (product: ProductOption) => void;
  selectedIds?: string[];
  /** Products that cannot be chosen (already used elsewhere). */
  disabledIds?: string[];
  multiple?: boolean;
  title?: string;
  products?: ProductOption[];
  loadProducts?: ProductLoader;
  searchLabel?: string;
  renderStatus?: (product: ProductOption) => ReactNode;
  testIdPrefix?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? t("admin_product_picker_title")}
      width="lg"
    >
      <ProductOptionGrid
        products={products}
        loadProducts={loadProducts}
        selectedIds={selectedIds}
        disabledIds={disabledIds}
        onSelect={(product) => {
          onSelect(product);
          if (!multiple) onClose();
        }}
        searchLabel={searchLabel}
        renderStatus={renderStatus}
        testIdPrefix={testIdPrefix}
        enabled={open}
      />
    </Dialog>
  );
}

type ProductSelection =
  | { kind: "none" }
  | { kind: "current"; name: string; imageUrl: string | null }
  | { kind: "unresolved" };

type PickerIds = {
  current: string;
  thumb: string;
  rawId: string;
  open: string;
  clear: string;
};

const defaultIds: PickerIds = {
  current: "product-picker-current",
  thumb: "product-picker-current-thumb",
  rawId: "product-picker-current-id",
  open: "product-picker-open",
  clear: "product-picker-clear",
};

const scopedIds = (scope: string): PickerIds => ({
  current: `${scope}-current`,
  thumb: `${scope}-thumb`,
  rawId: `${scope}-id`,
  open: `${scope}-open`,
  clear: `${scope}-clear`,
});

/**
 * Resolves the linked product so the operator sees its photo and name.
 *
 * The candidate list is tried first, then a product the caller already
 * knows, and only then the catalogue - section payloads store product ids
 * only, so a linked product is often outside the loaded page.
 */
function useLinkedProduct({
  value,
  products,
  currentOption,
  loading = false,
}: {
  value?: string;
  products?: ProductOption[];
  currentOption?: ProductOption | null;
  /** The candidate list is still loading; the product is looked up later. */
  loading?: boolean;
}): {
  selection: ProductSelection;
  pick: (product: ProductOption) => void;
} {
  const [picked, setPicked] = useState<ProductOption | null>(null);
  const [loaded, setLoaded] = useState<{
    id: string;
    name: string;
    imageUrl: string | null;
  } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const known = useMemo<ProductOption | null>(() => {
    if (!value) return null;
    if (picked && picked.id === value) return picked;
    const fromList = products?.find((product) => product.id === value);
    if (fromList) return fromList;
    if (currentOption && currentOption.id === value) return currentOption;
    return null;
  }, [value, picked, products, currentOption]);

  useEffect(() => {
    if (loading || !value || known) return;
    if (loaded?.id === value || failedId === value) return;
    let active = true;
    adminApi
      .getProduct(value)
      .then((product) => {
        if (!active) return;
        setLoaded({
          id: value,
          name: product.name,
          imageUrl: productThumbnailUrl(product),
        });
      })
      .catch(() => {
        if (!active) return;
        setFailedId(value);
      });
    return () => {
      active = false;
    };
  }, [loading, value, known, loaded, failedId]);

  const selection = useMemo<ProductSelection>(() => {
    if (loading || !value) return { kind: "none" };
    if (known) {
      return {
        kind: "current",
        name: known.name,
        imageUrl: known.thumbnailUrl ?? null,
      };
    }
    if (loaded && loaded.id === value) {
      return { kind: "current", name: loaded.name, imageUrl: loaded.imageUrl };
    }
    if (failedId === value) return { kind: "unresolved" };
    return { kind: "none" };
  }, [loading, value, known, loaded, failedId]);

  const pick = useCallback((product: ProductOption) => {
    setPicked(product);
    setFailedId(null);
  }, []);

  return { selection, pick };
}

/** The linked product: photo and name, or the raw id when it cannot load. */
function LinkedProductBox({
  selection,
  value,
  ids,
  openLabel,
  clearText,
  disabled,
  onOpen,
  onClear,
}: {
  selection: ProductSelection;
  value: string;
  ids: PickerIds;
  openLabel: string;
  clearText: string;
  disabled: boolean;
  onOpen: () => void;
  onClear: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  if (selection.kind === "none") {
    return (
      <button
        type="button"
        data-testid={ids.open}
        disabled={disabled}
        onClick={onOpen}
        className="w-fit rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-ink hover:bg-surface disabled:opacity-60"
      >
        {t("admin_product_picker_choose")}
      </button>
    );
  }
  if (selection.kind === "unresolved") {
    return (
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
          onClick={onOpen}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-60"
        >
          {openLabel}
        </button>
        <button
          type="button"
          data-testid={ids.clear}
          disabled={disabled}
          onClick={onClear}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sale hover:bg-sale/10 disabled:opacity-60"
        >
          {clearText}
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid={ids.current}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-2"
    >
      <ProductThumbnail
        imageUrl={selection.imageUrl}
        className="h-10 w-10"
        testId={ids.thumb}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {selection.name}
      </span>
      <button
        type="button"
        data-testid={ids.open}
        disabled={disabled}
        onClick={onOpen}
        className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-60"
      >
        {openLabel}
      </button>
      <button
        type="button"
        data-testid={ids.clear}
        disabled={disabled}
        onClick={onClear}
        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sale hover:bg-sale/10 disabled:opacity-60"
      >
        {clearText}
      </button>
    </div>
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
  loadProducts,
  currentOption,
  loading = false,
  title,
  searchLabel,
}: {
  label?: string;
  value?: string;
  onChange: (productId: string | undefined) => void;
  clearLabel?: string;
  disabled?: boolean;
  /** Namespaces the test ids so several fields can live in one editor. */
  scope?: string;
  /** Restricts the picker to a pre-loaded candidate list. */
  products?: ProductOption[];
  /** Loads the candidates from a scoped source instead of the catalogue. */
  loadProducts?: ProductLoader;
  /** A product the caller already knows, used when it is not listed. */
  currentOption?: ProductOption | null;
  /** The candidate list is still loading; the linked product is shown later. */
  loading?: boolean;
  title?: string;
  searchLabel?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const { selection, pick } = useLinkedProduct({ value, products, currentOption, loading });
  const ids = scope ? scopedIds(scope) : defaultIds;

  const openLabel = t("admin_product_picker_open");
  const clearText = clearLabel ?? t("admin_product_picker_clear");

  return (
    <div data-testid="product-picker-field" className="flex min-w-0 flex-col gap-1">
      {label ? (
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
      ) : null}
      <LinkedProductBox
        selection={selection}
        value={value ?? ""}
        ids={ids}
        openLabel={openLabel}
        clearText={clearText}
        disabled={disabled}
        onOpen={() => setOpen(true)}
        onClear={() => onChange(undefined)}
      />
      <ProductPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(product) => {
          pick(product);
          onChange(product.id);
          setOpen(false);
        }}
        selectedIds={value ? [value] : []}
        products={products}
        loadProducts={loadProducts}
        title={title}
        searchLabel={searchLabel}
      />
    </div>
  );
}

/**
 * The same linked-product field, but the product grid opens in place.
 *
 * Admin dialogs cannot open another modal on top of themselves, so the
 * product cards are shown inline instead.
 */
export function ProductPickerInline({
  label,
  value,
  onChange,
  clearLabel,
  disabled = false,
  scope,
  products,
  loadProducts,
  currentOption,
  loading = false,
  searchLabel,
}: {
  label?: string;
  value?: string;
  onChange: (productId: string | undefined) => void;
  clearLabel?: string;
  disabled?: boolean;
  scope?: string;
  products?: ProductOption[];
  loadProducts?: ProductLoader;
  currentOption?: ProductOption | null;
  /** The candidate list is still loading; the linked product is shown later. */
  loading?: boolean;
  searchLabel?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const [expanded, setExpanded] = useState(false);
  const { selection, pick } = useLinkedProduct({ value, products, currentOption, loading });
  const ids = scope ? scopedIds(scope) : defaultIds;

  const openLabel = t("admin_product_picker_open");
  const clearText = clearLabel ?? t("admin_product_picker_clear");

  return (
    <div
      data-testid="product-picker-inline"
      className="flex min-w-0 flex-col gap-2"
    >
      {label ? (
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
      ) : null}
      <LinkedProductBox
        selection={selection}
        value={value ?? ""}
        ids={ids}
        openLabel={openLabel}
        clearText={clearText}
        disabled={disabled}
        onOpen={() => setExpanded((current) => !current)}
        onClear={() => onChange(undefined)}
      />
      {expanded ? (
        <ProductOptionGrid
          products={products}
          loadProducts={loadProducts}
          selectedIds={value ? [value] : []}
          onSelect={(product) => {
            pick(product);
            onChange(product.id);
            setExpanded(false);
          }}
          searchLabel={searchLabel}
          testIdPrefix={`${scope ?? "product-picker-inline"}-grid`}
        />
      ) : null}
    </div>
  );
}
