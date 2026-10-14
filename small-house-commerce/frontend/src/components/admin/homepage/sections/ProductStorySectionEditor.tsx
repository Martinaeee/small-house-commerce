"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { ProductStoryPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import {
  BufferedImageUrlInput,
  BufferedTextInput,
} from "@/components/admin/homepage/BufferedSectionField";
import { SectionProductPicker } from "@/components/admin/homepage/sections/SectionProductPicker";
import { isBannerHref } from "@/lib/banner-href";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^https?:\/\/.+/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//") && value.length > 1))
  );
}

function safeText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

function safePayload(value: unknown): ProductStoryPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  return {
    ...(isMediaUrl(payload.imageUrl) ? { imageUrl: payload.imageUrl } : {}),
    ...(safeText(payload.heading, 120) !== undefined ? { heading: safeText(payload.heading, 120) } : {}),
    ...(safeText(payload.body, 2000) !== undefined ? { body: safeText(payload.body, 2000) } : {}),
    ...(safeText(payload.ctaText, 120) !== undefined ? { ctaText: safeText(payload.ctaText, 120) } : {}),
    ...(isBannerHref(payload.ctaLink) ? { ctaLink: payload.ctaLink } : {}),
    ...(typeof payload.productId === "string" && UUID_PATTERN.test(payload.productId)
      ? { productId: payload.productId }
      : {}),
  };
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
          <BufferedImageUrlInput
            ariaLabel={t("homepage_builder_product_story_image")}
            value={safeString(payload.imageUrl)}
            placeholder={t("homepage_builder_media_url_placeholder")}
            isValid={(value) => value === "" || isMediaUrl(value)}
            onCommit={(value) => updateField("imageUrl", value)}
            labels={{
              upload: t("homepage_builder_media_upload_image"),
              uploading: t("homepage_builder_media_uploading"),
              invalidType: t("homepage_builder_media_image_invalid"),
              tooLarge: t("homepage_builder_media_image_too_large"),
              uploadFailed: t("homepage_builder_media_upload_failed"),
            }}
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
          <BufferedTextInput
            type="text"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_product_story_cta_link")}
            maxLength={2048}
            value={safeString(payload.ctaLink)}
            isValid={(value) => value === "" || isBannerHref(value)}
            commitValidImmediately
            onCommit={(value) => updateField("ctaLink", value)}
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
