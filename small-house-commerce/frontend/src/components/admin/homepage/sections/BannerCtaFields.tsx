"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { isBannerHref } from "@/lib/banner-href";
import { BufferedTextInput } from "@/components/admin/homepage/BufferedSectionField";

/**
 * The shared CTA row for PROMO_BANNER and COUNTDOWN_BANNER editors: one label
 * and one link. Presentational and controlled — the owning editor routes the
 * changes through its payload updater.
 */
export function BannerCtaFields({
  ctaText,
  ctaLink,
  onChange,
}: {
  ctaText: string;
  ctaLink: string;
  onChange: (field: "ctaText" | "ctaLink", value: string) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_banner_cta_text")}
        <input
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_banner_cta_text")}
          maxLength={120}
          value={ctaText}
          onChange={(event) => onChange("ctaText", event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_banner_cta_link")}
        <BufferedTextInput
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_banner_cta_link")}
          maxLength={2048}
          value={ctaLink}
          isValid={(value) => value === "" || isBannerHref(value)}
          commitValidImmediately
          onCommit={(value) => onChange("ctaLink", value)}
        />
        <span className="text-[11px] font-normal text-ink-muted">
          {t("homepage_builder_banner_cta_link_hint")}
        </span>
      </label>
    </div>
  );
}
