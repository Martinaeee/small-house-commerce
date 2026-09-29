"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { ProductStoryPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { SectionProductPicker } from "@/components/admin/homepage/sections/SectionProductPicker";

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safePayload(value: unknown): ProductStoryPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ProductStoryPayload)
    : {};
}

export function ProductStorySectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"PRODUCT_STORY">): ReactNode {
  const { t } = useAdminI18n();
  const payload = safePayload(section.payload);

  const updateField = (
    field: keyof ProductStoryPayload,
    value: string | undefined,
  ): void => {
    onPayloadChange((current) => {
      const next = { ...safePayload(current) } as Record<string, unknown>;
      if (value === undefined || value === "") delete next[field];
      else next[field] = value;
      return next as ProductStoryPayload;
    });
  };

  return (
    <section
      data-section-content-editor="PRODUCT_STORY"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_product_story_image")}
          <input
            type="url"
            className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_product_story_image")}
            placeholder={t("homepage_builder_media_url_placeholder")}
            maxLength={2048}
            value={safeString(payload.imageUrl)}
            onChange={(event) => updateField("imageUrl", event.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_product_story_heading")}
        <input
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_product_story_heading")}
          maxLength={120}
          value={safeString(payload.heading)}
          onChange={(event) => updateField("heading", event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_product_story_body")}
        <textarea
          className="min-h-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_product_story_body")}
          maxLength={2000}
          value={safeString(payload.body)}
          onChange={(event) => updateField("body", event.target.value)}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_product_story_cta_text")}
          <input
            type="text"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_product_story_cta_text")}
            maxLength={120}
            value={safeString(payload.ctaText)}
            onChange={(event) => updateField("ctaText", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_product_story_cta_link")}
          <input
            type="url"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_product_story_cta_link")}
            maxLength={2048}
            value={safeString(payload.ctaLink)}
            onChange={(event) => updateField("ctaLink", event.target.value)}
          />
        </label>
      </div>
      <SectionProductPicker
        label={t("homepage_builder_product_story_product")}
        value={safeString(payload.productId) || undefined}
        mode="buttons"
        clearLabel={t("homepage_builder_product_story_product_clear")}
        onChange={(productId) => updateField("productId", productId)}
      />
    </section>
  );
}
