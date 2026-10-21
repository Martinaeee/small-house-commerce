"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Field, TextInput } from "@/components/admin/Field";
import { Pagination } from "@/components/admin/Pagination";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { useAdminI18n } from "@/lib/admin-i18n";
import { faqApi } from "@/lib/faq-api";
import type { AdminFaqProductCandidate } from "@/lib/admin-api";

/**
 * The "selected products" branch of a shared question's audience: searchable
 * catalogue picker plus chips of the current selection. Selection is owned by
 * the dialog; this component only reports id changes. The catalogue rows come
 * from the shared-FAQ read-only endpoint, so an FAQ operator needs no product
 * editing permission to assign questions.
 */
export function FaqAudiencePicker({
  ids,
  onIdsChange,
}: {
  ids: string[];
  onIdsChange: (ids: string[]) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<AdminFaqProductCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Map<string, AdminFaqProductCandidate>>(new Map());
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [initialIds] = useState(ids);
  const requestId = useRef(0);

  const mergeCatalog = useCallback((items: AdminFaqProductCandidate[]) =>
    setCatalog((current) => {
      const next = new Map(current);
      for (const item of items) next.set(item.id, item);
      return next;
    }), []);

  const loadPage = useCallback((searchText: string, nextPage: number, request: number) => {
    return faqApi.listProducts({
      ...(searchText.trim() ? { search: searchText.trim() } : {}),
      page: nextPage, pageSize: 20,
    }).then((result) => {
      if (request !== requestId.current) return;
      mergeCatalog(result.items);
      setProducts(result.items);
      setTotal(result.total);
      setPage(nextPage);
    }).catch((err: unknown) => {
      if (request === requestId.current) {
        setLoadError(err instanceof Error ? err.message : t("faq_product_load_failed"));
      }
    }).finally(() => {
      if (request === requestId.current) setLoading(false);
    });
  }, [mergeCatalog, t]);

  useEffect(() => {
    const request = ++requestId.current;
    void loadPage("", 1, request);
    return () => { requestId.current += 1; };
  }, [loadPage]);

  // Hydrate names independently of the paged results. Existing selections can
  // span the whole catalogue; small batches avoid oversized URLs.
  useEffect(() => {
    let active = true;
    const batches: string[][] = [];
    for (let index = 0; index < initialIds.length; index += 100) {
      batches.push(initialIds.slice(index, index + 100));
    }
    void Promise.all(batches.map((batch) => faqApi.listProducts({ ids: batch, page: 1, pageSize: 100 })))
      .then((pages) => {
        if (active) mergeCatalog(pages.flatMap((result) => result.items));
      })
      .catch(() => {
        // IDs remain visible and removable if names cannot be loaded.
      });
    return () => { active = false; };
  }, [initialIds, mergeCatalog]);

  const search = (value: string) => {
    setQuery(value);
    setLoading(true);
    setLoadError(null);
    void loadPage(value, 1, ++requestId.current);
  };

  const changePage = (nextPage: number) => {
    setLoading(true);
    setLoadError(null);
    void loadPage(query, nextPage, ++requestId.current);
  };

  const toggle = (product: AdminFaqProductCandidate) => {
    if (ids.includes(product.id)) {
      onIdsChange(ids.filter((id) => id !== product.id));
    } else {
      onIdsChange([...ids, product.id]);
    }
  };

  return (
    <div className="space-y-3">
      <Field
        label={t("faq_product_search")}
        htmlFor="faq-audience-picker-search"
      >
        <TextInput
          id="faq-audience-picker-search"
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
        />
      </Field>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      <div
        role="group"
        aria-label={t("faq_audience_selected_list_label")}
        className="flex max-h-32 flex-wrap gap-2 overflow-y-auto"
      >
        {ids.map((id) => {
          const product = catalog.get(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-xs text-ink"
            >
              <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border">
                {product?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
                  <img
                    src={product.thumbnailUrl}
                    alt=""
                    className="h-5 w-5 object-cover"
                  />
                ) : (
                  <PlaceholderImage
                    label={product?.name ?? id}
                    className="h-5 w-5"
                  />
                )}
              </span>
              <span className="max-w-40 truncate">
                {product?.name ?? id}
              </span>
              <button
                type="button"
                aria-label={t("faq_audience_remove", {
                  name: product?.name ?? id,
                })}
                onClick={() =>
                  onIdsChange(ids.filter((current) => current !== id))
                }
                className="rounded-full px-1 text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      <p className="text-xs text-ink-muted">
        {t("faq_audience_selected_count", { count: ids.length })}
      </p>

      <p className="text-xs leading-relaxed text-ink-muted">
        {t("faq_audience_custom_notice")}
      </p>

      {loading ? (
        <div
          className="h-24 animate-pulse rounded-xl border border-border bg-card"
          aria-label={t("common_loading")}
        />
      ) : products.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-ink-secondary">
          {t("faq_audience_empty")}
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {products.map((product) => (
            <li key={product.id}>
              <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-background">
                <input
                  type="checkbox"
                  checked={ids.includes(product.id)}
                  onChange={() => toggle(product)}
                  aria-label={product.name}
                  className="h-4 w-4 rounded border-border accent-cta"
                />
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-border">
                  {product.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail.
                    <img
                      src={product.thumbnailUrl}
                      alt=""
                      className="h-9 w-9 object-cover"
                    />
                  ) : (
                    <PlaceholderImage
                      label={product.name}
                      className="h-9 w-9"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {product.name}
                  </span>
                  {product.faqMode === "CUSTOM" ? (
                    <span className="text-xs text-ink-muted">{t("faq_mode_badge_custom")}</span>
                  ) : null}
                  <span className="block text-xs text-ink-muted">
                    {product.productCode ?? t("faq_picker_no_code")} · /{product.slug}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!loading && total > 20 ? (
        <Pagination page={page} pageSize={20} total={total} onChange={changePage} />
      ) : null}
    </div>
  );
}