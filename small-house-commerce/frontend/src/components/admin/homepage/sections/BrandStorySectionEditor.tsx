"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { BrandStoryPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import {
  BufferedImageUrlInput,
  BufferedTextarea,
  BufferedTextInput,
} from "@/components/admin/homepage/BufferedSectionField";

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^https?:\/\/.+/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//") && value.length > 1))
  );
}

function isInAppOrHttps(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    ((value.startsWith("/") && !value.startsWith("//")) ||
      value.startsWith("#") ||
      /^https:\/\/.+/.test(value))
  );
}

function safeText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

function safePayload(value: unknown): BrandStoryPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  return {
    ...(isMediaUrl(payload.imageUrl) ? { imageUrl: payload.imageUrl } : {}),
    ...(safeText(payload.imageAlt, 120) !== undefined
      ? { imageAlt: safeText(payload.imageAlt, 120) }
      : {}),
    ...(safeText(payload.eyebrow, 120) !== undefined
      ? { eyebrow: safeText(payload.eyebrow, 120) }
      : {}),
    ...(safeText(payload.heading, 120) !== undefined
      ? { heading: safeText(payload.heading, 120) }
      : {}),
    ...(safeText(payload.body, 3000) !== undefined
      ? { body: safeText(payload.body, 3000) }
      : {}),
    ...(safeText(payload.ctaText, 120) !== undefined
      ? { ctaText: safeText(payload.ctaText, 120) }
      : {}),
    ...(isInAppOrHttps(payload.ctaLink) ? { ctaLink: payload.ctaLink } : {}),
  };
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * BRAND_STORY edits the split layout: one brand image plus the brand copy.
 * The bullets of the old shared text block are not exposed here any more —
 * they belong to CONFIDENCE — but they stay in the payload so a published
 * section is not emptied by the next save.
 */
export function BrandStorySectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"BRAND_STORY">): ReactNode {
  const { t } = useAdminI18n();
  const payload = safePayload(section.payload);

  const updateField = (
    field: keyof BrandStoryPayload,
    value: string | undefined,
  ): void => {
    onPayloadChange((current) => {
      const next = { ...safePayload(current) } as Record<string, unknown>;
      if (value === undefined || value === "") delete next[field];
      else next[field] = value;
      return next as BrandStoryPayload;
    });
  };

  return (
    <div
      data-section-content-editor="BRAND_STORY"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_brand_story_image")}
          <BufferedImageUrlInput
            ariaLabel={t("homepage_builder_brand_story_image")}
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
        {t("homepage_builder_brand_story_image_alt")}
        <BufferedTextInput
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_brand_story_image_alt")}
          maxLength={120}
          value={safeString(payload.imageAlt)}
          onCommit={(value) => updateField("imageAlt", value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_brand_story_eyebrow")}
        <BufferedTextInput
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_brand_story_eyebrow")}
          maxLength={120}
          value={safeString(payload.eyebrow)}
          onCommit={(value) => updateField("eyebrow", value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_brand_story_heading")}
        <BufferedTextarea
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_brand_story_heading")}
          maxLength={120}
          rows={2}
          value={safeString(payload.heading)}
          onCommit={(value) => updateField("heading", value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_brand_story_body")}
        <BufferedTextarea
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_brand_story_body")}
          maxLength={3000}
          rows={5}
          value={safeString(payload.body)}
          onCommit={(value) => updateField("body", value)}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_brand_story_cta_text")}
          <BufferedTextInput
            type="text"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_brand_story_cta_text")}
            maxLength={120}
            value={safeString(payload.ctaText)}
            onCommit={(value) => updateField("ctaText", value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_brand_story_cta_link")}
          <BufferedTextInput
            type="text"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_brand_story_cta_link")}
            maxLength={2048}
            value={safeString(payload.ctaLink)}
            isValid={(value) => value === "" || isInAppOrHttps(value)}
            commitValidImmediately
            onCommit={(value) => updateField("ctaLink", value)}
          />
        </label>
      </div>
    </div>
  );
}
