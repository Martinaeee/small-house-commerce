"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Field, Textarea, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import type { ProductStatus } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { SITE_URL } from "@/lib/product-jsonld";

export interface SavedProductLinkContext {
  path: string;
  status: ProductStatus;
  variants?: readonly {
    id: string;
    name: string;
    skuStatus: "ACTIVE" | "DISABLED" | null;
  }[];
}

interface ProductSeoLinksPanelProps {
  productName: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  fallbackDescription: string;
  savedProduct: SavedProductLinkContext | null;
  onSeoTitleChange(value: string): void;
  onMetaDescriptionChange(value: string): void;
}

function absoluteStorefrontUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

function variantUrl(productUrl: string, variantId: string): string {
  const url = new URL(productUrl);
  url.searchParams.set("variant", variantId);
  return url.toString();
}

export function ProductSeoLinksPanel({
  productName,
  slug,
  seoTitle,
  metaDescription,
  fallbackDescription,
  savedProduct,
  onSeoTitleChange,
  onMetaDescriptionChange,
}: ProductSeoLinksPanelProps): ReactNode {
  const { t } = useAdminI18n();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const canonical = absoluteStorefrontUrl(
    `/products/${encodeURIComponent(slug.trim() || "your-slug")}`,
  );
  const previewTitle = seoTitle.trim() || productName.trim() || t("product_seo_preview_name_fallback");
  const previewDescription =
    metaDescription.trim() ||
    fallbackDescription.trim() ||
    t("product_seo_preview_desc_fallback");
  const productUrl = savedProduct
    ? absoluteStorefrontUrl(savedProduct.path)
    : null;
  const variants = useMemo(
    () =>
      savedProduct?.variants?.filter(
        (variant) => variant.id.trim() !== "" && variant.skuStatus === "ACTIVE",
      ) ?? [],
    [savedProduct],
  );

  const copy = async (key: string, value: string): Promise<void> => {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    setCopiedKey(null);
    setCopyFailedKey(null);

    if (!(await copyText(value))) {
      setCopyFailedKey(key);
      return;
    }

    setCopiedKey(key);
    copiedTimer.current = setTimeout(() => {
      setCopiedKey(null);
      copiedTimer.current = null;
    }, 1500);
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Field
          label={t("product_seo_title_label")}
          htmlFor="pf-seo-title"
          hint={t("product_seo_title_count", { count: seoTitle.length })}
        >
          <TextInput
            id="pf-seo-title"
            value={seoTitle}
            maxLength={200}
            onChange={(event) => onSeoTitleChange(event.target.value)}
          />
        </Field>
        <Field
          label={t("product_seo_meta_label")}
          htmlFor="pf-meta-description"
          hint={t("product_seo_description_count", {
            count: metaDescription.length,
          })}
        >
          <Textarea
            id="pf-meta-description"
            value={metaDescription}
            maxLength={300}
            rows={4}
            onChange={(event) => onMetaDescriptionChange(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-ink-muted">{t("product_seo_field_limits")}</p>

      <Field
        label={t("product_seo_canonical_label")}
        htmlFor="pf-canonical"
      >
        <TextInput id="pf-canonical" value={canonical} readOnly />
      </Field>

      <div>
        <p className="text-xs font-semibold text-ink-secondary">
          {t("product_seo_preview_title")}
        </p>
        <div className="mt-2 max-w-xl rounded-lg bg-background p-4">
          <p className="truncate text-sm font-semibold text-[#1a0dab]">
            {previewTitle} | LUWAG Living
          </p>
          <p className="truncate text-xs text-[#006621]">{canonical}</p>
          <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">
            {previewDescription.slice(0, 160)}
          </p>
        </div>
      </div>

      <section aria-labelledby="product-links-heading" className="border-t border-border pt-6">
        <h3 id="product-links-heading" className="text-lg font-semibold text-ink">
          {t("product_links_title")}
        </h3>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("product_links_hint")}
        </p>

        {productUrl && savedProduct ? (
          <div className="mt-4 space-y-5">
            {savedProduct.status !== "ACTIVE" ? (
              <p className="rounded-lg bg-admin-warning-bg px-3 py-2 text-sm text-admin-warning-text">
                {t("product_links_not_public")}
              </p>
            ) : null}
            <div>
              <p className="text-sm font-medium text-ink">
                {t("product_links_main_label")}
              </p>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-background px-3 py-2 text-xs text-ink-secondary">
                  {productUrl}
                </code>
                <Button
                  variant="secondary"
                  size="md"
                  className="h-10 min-w-0 px-4 text-sm"
                  onClick={() => void copy("product", productUrl)}
                >
                  {copiedKey === "product"
                    ? t("product_links_copied")
                    : t("product_links_copy_product")}
                </Button>
              </div>
              {copyFailedKey === "product" ? (
                <p role="alert" className="mt-2 text-xs font-medium text-admin-error">
                  {t("common_copy_failed_manual")}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-sm font-medium text-ink">
                {t("product_links_variants_title")}
              </p>
              {variants.length > 0 ? (
                <ul className="mt-2 space-y-3">
                  {variants.map((variant) => {
                    const url = variantUrl(productUrl, variant.id);
                    const key = `variant:${variant.id}`;
                    return (
                      <li key={variant.id} className="rounded-lg border border-border p-3">
                        <p className="text-sm font-medium text-ink">{variant.name}</p>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <code className="min-w-0 flex-1 break-all text-xs text-ink-secondary">
                            {url}
                          </code>
                          <Button
                            variant="secondary"
                            size="md"
                            className="h-10 min-w-0 px-4 text-sm"
                            onClick={() => void copy(key, url)}
                          >
                            {copiedKey === key
                              ? t("product_links_copied")
                              : t("product_links_copy_variant")}
                          </Button>
                        </div>
                        {copyFailedKey === key ? (
                          <p
                            role="alert"
                            className="mt-2 text-xs font-medium text-admin-error"
                          >
                            {t("common_copy_failed_manual")}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">
                  {t("product_links_no_variants")}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-background px-3 py-3 text-sm text-ink-muted">
            {t("product_links_unsaved")}
          </p>
        )}
      </section>
    </div>
  );
}
