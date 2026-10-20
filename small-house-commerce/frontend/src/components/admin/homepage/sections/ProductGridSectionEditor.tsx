"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { SectionProduct } from "@/lib/homepage-document";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import {
  ProductPickerDialog,
  ProductThumbnail,
  useProductSummaries,
} from "@/components/admin/ProductPicker";

const MAX_PRODUCTS = 24;

type ProductGridEditorProps = SectionPayloadEditorProps<"PRODUCT_GRID"> & {
  onProductsChange?: (
    patch: SectionProduct[] | ((products: SectionProduct[]) => SectionProduct[]),
  ) => void;
};

export function ProductGridSectionEditor({
  section,
  onProductsChange,
}: ProductGridEditorProps): ReactNode {
  const { t } = useAdminI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const products = [...(section.products ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const selectedIds = useMemo(
    () => products.map((product) => product.productId),
    [products],
  );
  const linkedProducts = useProductSummaries(selectedIds);

  const changeProducts = (
    patch: SectionProduct[] | ((products: SectionProduct[]) => SectionProduct[]),
  ): void => {
    onProductsChange?.(patch);
  };

  const addProduct = (productId: string): void => {
    changeProducts((current) => {
      if (current.length >= MAX_PRODUCTS || current.some((row) => row.productId === productId)) {
        return current;
      }
      return [
        ...current,
        { productId, sortOrder: current.length, badge: null },
      ];
    });
  };

  const removeProduct = (productId: string): void => {
    changeProducts((current) =>
      current
        .filter((row) => row.productId !== productId)
        .map((row, index) => ({ ...row, sortOrder: index })),
    );
  };

  const moveProduct = (productId: string, delta: -1 | 1): void => {
    changeProducts((current) => {
      const index = current.findIndex((row) => row.productId === productId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((row, rowIndex) => ({ ...row, sortOrder: rowIndex }));
    });
  };

  const changeBadge = (productId: string, badge: string): void => {
    changeProducts((current) =>
      current.map((row) =>
        row.productId === productId
          ? { ...row, badge: badge === "" ? null : badge }
          : row,
      ),
    );
  };

  return (
    <section
      data-section-content-editor="PRODUCT_GRID"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("homepage_builder_product_grid_products")}
          </h2>
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_product_grid_limit", { max: MAX_PRODUCTS })}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={!onProductsChange || products.length >= MAX_PRODUCTS}
          onClick={() => setPickerOpen(true)}
        >
          {t("homepage_builder_product_grid_add")}
        </button>
      </div>

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_product_grid_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {products.map((product, index) => {
            const linked = linkedProducts.get(product.productId);
            const name = linked?.name ?? product.productId;
            return (
              <div
                key={product.productId}
                data-testid={`product-grid-row-${product.productId}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <ProductThumbnail
                      imageUrl={linked?.imageUrl ?? null}
                      className="h-9 w-9"
                      testId="product-grid-thumb"
                    />
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {name}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_product_grid_move_up", {
                        index: index + 1,
                      })}
                      disabled={index === 0}
                      onClick={() => moveProduct(product.productId, -1)}
                    >
                      {t("homepage_builder_move_up")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_product_grid_move_down", {
                        index: index + 1,
                      })}
                      disabled={index === products.length - 1}
                      onClick={() => moveProduct(product.productId, 1)}
                    >
                      {t("homepage_builder_move_down")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10 disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_product_grid_remove", {
                        name,
                      })}
                      disabled={!onProductsChange || products.length <= 0}
                      onClick={() => removeProduct(product.productId)}
                    >
                      {t("homepage_builder_product_grid_remove", {
                        name,
                      })}
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_product_grid_badge", { name })}
                  <input
                    type="text"
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_product_grid_badge", { name })}
                    maxLength={20}
                    value={product.badge ?? ""}
                    disabled={!onProductsChange}
                    onChange={(event) =>
                      changeBadge(product.productId, event.target.value)
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}

      <ProductPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(product) => addProduct(product.id)}
        selectedIds={selectedIds}
        disabledIds={selectedIds}
        title={t("homepage_builder_product_grid_add")}
        searchLabel={t("homepage_builder_product_grid_search")}
      />
    </section>
  );
}
