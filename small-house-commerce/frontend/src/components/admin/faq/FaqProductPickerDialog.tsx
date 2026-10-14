"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminProduct } from "@/lib/admin-api";

/**
 * Step 1 of the product FAQ flow: pick a product by name or code. The list
 * loads immediately so the dialog is usable without typing, and a search box
 * queries the full catalogue instead of filtering the visible page.
 */
export function FaqProductPickerDialog({
  onSelect,
  onClose,
  selecting,
  error,
}: {
  onSelect: (product: AdminProduct) => void;
  onClose: () => void;
  selecting: boolean;
  error: string | null;
}): ReactNode {
  const { t } = useAdminI18n();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const initialRequest = ++requestId.current;
    let active = true;
    adminApi
      .listProducts({ page: 1, pageSize: 50 })
      .then((result) => {
        if (active && requestId.current === initialRequest) setProducts(result.items);
      })
      .catch((err: unknown) => {
        if (active && requestId.current === initialRequest) {
          setLoadError(err instanceof Error ? err.message : t("faq_product_load_failed"));
        }
      })
      .finally(() => {
        if (active && requestId.current === initialRequest) setLoading(false);
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, [t]);

  const search = (value: string) => {
    const currentRequest = ++requestId.current;
    setQuery(value);
    setLoading(true);
    setLoadError(null);
    adminApi
      .listProducts({
        ...(value.trim() ? { search: value.trim() } : {}),
        page: 1,
        pageSize: 50,
      })
      .then((result) => {
        if (currentRequest === requestId.current) setProducts(result.items);
      })
      .catch((err: unknown) => {
        if (currentRequest === requestId.current) {
          setLoadError(err instanceof Error ? err.message : t("faq_product_load_failed"));
        }
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
  };

  return (
    <Dialog open title={t("faq_picker_title")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">{t("faq_picker_step", { step: 1 })}</p>
        <Field label={t("faq_product_search")} htmlFor="faq-picker-search">
          <TextInput
            id="faq-picker-search"
            type="search"
            value={query}
            onChange={(event) => search(event.target.value)}
          />
        </Field>
        {error ? (
          <div role="alert" className="rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" className="rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" aria-label={t("common_loading")} />
        ) : products.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-4 text-sm text-ink-secondary">
            {t("faq_product_picker_empty")}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  disabled={selecting}
                  onClick={() => onSelect(product)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-background disabled:opacity-60"
                >
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
                    <img
                      src={product.images[0].url}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <PlaceholderImage
                      label={product.name}
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-lg"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {product.name}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {product.productCode ?? t("faq_picker_no_code")} · /{product.slug}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose} disabled={selecting}>
            {t("faq_dialog_cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
