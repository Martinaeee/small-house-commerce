"use client";

import type { ReactNode } from "react";
import type { PromoBannerPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { isInAppOrHttps, BannerCtaFields } from "@/components/admin/homepage/sections/BannerCtaFields";

function safePayload(value: unknown): PromoBannerPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const payload = value as Record<string, unknown>;
  return {
    ...(typeof payload.ctaText === "string" ? { ctaText: payload.ctaText } : {}),
    ...(isInAppOrHttps(payload.ctaLink) ? { ctaLink: payload.ctaLink } : {}),
  };
}

export function PromoBannerSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"PROMO_BANNER">): ReactNode {
  const payload = safePayload(section.payload);

  const updateField = (
    field: keyof PromoBannerPayload,
    value: string,
  ): void => {
    onPayloadChange((current) => {
      const next = { ...safePayload(current) } as Record<string, unknown>;
      if (value === "") delete next[field];
      else next[field] = value;
      return next as PromoBannerPayload;
    });
  };

  return (
    <section
      data-section-content-editor="PROMO_BANNER"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <BannerCtaFields
        ctaText={payload.ctaText ?? ""}
        ctaLink={payload.ctaLink ?? ""}
        onChange={updateField}
      />
    </section>
  );
}
