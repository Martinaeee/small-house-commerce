"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminProduct } from "@/lib/admin-api";

export type ProductPickerMode = "select" | "buttons";

const SEARCH_DEBOUNCE_MS = 250;

export function SectionProductPicker({
  label,
  value,
  onChange,
  mode = "select",
  clearLabel,
}: {
  label: string;
  value?: string;
  onChange: (productId: string | undefined) => void;
  mode?: ProductPickerMode;
  clearLabel?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const term = search.trim();
    const timer = setTimeout(() => {
      setLoading(true);
      adminApi
        .listProducts({ search: term || undefined, page: 1, pageSize: 20 })
        .then((result) => {
          if (active) setProducts(Array.isArray(result.items) ? result.items : []);
        })
        .catch(() => {
          if (active) setProducts([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, term === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_product_search")}
        <input
          type="search"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_product_search")}
          placeholder={t("homepage_builder_product_search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {mode === "buttons" ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">{label}</span>
          {loading ? (
            <p className="text-xs text-ink-muted">{t("homepage_builder_product_loading")}</p>
          ) : products.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="rounded-lg border border-border px-2 py-1.5 text-left text-sm text-ink hover:bg-surface disabled:cursor-not-allowed"
                  aria-label={product.name}
                  aria-pressed={value === product.id}
                  onClick={() => onChange(product.id)}
                >
                  {product.name}
                </button>
              ))}
              {value ? (
                <button
                  type="button"
                  className="rounded-lg px-2 py-1.5 text-xs text-sale hover:bg-sale/10"
                  onClick={() => onChange(undefined)}
                >
                  {clearLabel ?? t("homepage_builder_product_story_product_clear")}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">{t("homepage_builder_product_no_results")}</p>
          )}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {label}
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={label}
            value={value ?? ""}
            disabled={loading}
            onChange={(event) => onChange(event.target.value || undefined)}
          >
            <option value="">
              {loading ? t("homepage_builder_product_loading") : t("homepage_builder_product_no_results")}
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function useProductOptions(search = ""): {
  products: AdminProduct[];
  loading: boolean;
} {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const term = search.trim();
    const timer = setTimeout(() => {
      setLoading(true);
      adminApi
        .listProducts({ search: term || undefined, page: 1, pageSize: 20 })
        .then((result) => {
          if (active) setProducts(Array.isArray(result.items) ? result.items : []);
        })
        .catch(() => {
          if (active) setProducts([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, term === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  return { products, loading };
}
