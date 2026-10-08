"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime-input";
import type { CountdownBannerPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { isBannerHref } from "@/lib/banner-href";
import { BannerCtaFields } from "@/components/admin/homepage/sections/BannerCtaFields";

function safePayload(value: unknown): CountdownBannerPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { endsAt: null };
  }
  const payload = value as Record<string, unknown>;
  const endsAt =
    typeof payload.endsAt === "string" &&
    Number.isFinite(Date.parse(payload.endsAt))
      ? payload.endsAt
      : null;
  return {
    ...(typeof payload.ctaText === "string" ? { ctaText: payload.ctaText } : {}),
    ...(isBannerHref(payload.ctaLink) ? { ctaLink: payload.ctaLink } : {}),
    endsAt,
  };
}

export function CountdownBannerSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"COUNTDOWN_BANNER">): ReactNode {
  const { t } = useAdminI18n();
  const payload = safePayload(section.payload);
  const endsAtMs =
    payload.endsAt === null ? null : Date.parse(payload.endsAt);

  // Clock reads follow the HeroSlideCountdown pattern: a lazy initializer for
  // the first value and an interval-only update, so render stays pure and the
  // effect never cascades. The 30 s tick keeps a long-open panel honest.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const expired = endsAtMs !== null && endsAtMs <= nowMs;

  const publishAtMs = section.schedule?.publishAt
    ? Date.parse(section.schedule.publishAt)
    : Number.NaN;
  const beforeSectionStart =
    endsAtMs !== null &&
    endsAtMs > nowMs &&
    Number.isFinite(publishAtMs) &&
    endsAtMs <= publishAtMs;

  const updateField = (
    field: keyof CountdownBannerPayload,
    value: string,
  ): void => {
    onPayloadChange((current) => {
      const next = { ...safePayload(current) } as Record<string, unknown>;
      if (value === "") delete next[field];
      else next[field] = value;
      return next as CountdownBannerPayload;
    });
  };

  const setEndsAt = (value: string): void => {
    onPayloadChange((current) => ({
      ...safePayload(current),
      endsAt: localInputToIso(value),
    }));
  };

  return (
    <section
      data-section-content-editor="COUNTDOWN_BANNER"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_banner_ends_at")}
        <input
          type="datetime-local"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_banner_ends_at")}
          aria-invalid={expired ? "true" : undefined}
          value={payload.endsAt ? isoToLocalInput(payload.endsAt) : ""}
          onChange={(event) => setEndsAt(event.target.value)}
        />
        <span className="text-[11px] font-normal text-ink-muted">
          {t("homepage_builder_banner_ends_at_hint")}
        </span>
      </label>
      {expired ? (
        <p role="status" className="text-xs text-sale">
          {t("homepage_builder_banner_ends_at_past")}
        </p>
      ) : null}
      {beforeSectionStart ? (
        <p role="status" className="text-xs text-sale">
          {t("homepage_builder_banner_ends_at_before_start")}
        </p>
      ) : null}
      <BannerCtaFields
        ctaText={payload.ctaText ?? ""}
        ctaLink={payload.ctaLink ?? ""}
        onChange={updateField}
      />
    </section>
  );
}
