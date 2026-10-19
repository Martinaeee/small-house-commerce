import type { ReactNode } from "react";
import { isBannerHref } from "@/lib/banner-href";
import { SmartLink } from "./sectionShell";
import type { SectionPreviewDevice } from "./sectionRegistry";

/** Shared visual skeleton for PROMO_BANNER and COUNTDOWN_BANNER sections. */

export type BannerCtaPayload = {
  ctaText?: string;
  ctaLink?: string;
};

export function normalizeBannerCta(payload: unknown): BannerCtaPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    ...(typeof record.ctaText === "string" ? { ctaText: record.ctaText } : {}),
    ...(isBannerHref(record.ctaLink) ? { ctaLink: record.ctaLink } : {}),
  };
}

/**
 * Row layout on tablet/desktop, stacked on mobile. Without a preview device
 * (the real storefront) the same switch happens via responsive classes.
 */
export function bannerLayoutClass(device?: SectionPreviewDevice): string {
  if (device === "mobile") return "flex flex-col items-start gap-3";
  if (device === "tablet" || device === "desktop") {
    return "flex flex-row items-center justify-between gap-6";
  }
  return "flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between md:gap-6";
}

/** Banner copy: title/subtitle only (payload never duplicates headings). */
export function BannerCopy({
  title,
  subtitle,
}: {
  title: string | null;
  subtitle: string | null;
}): ReactNode {
  if (!title && !subtitle) return null;
  return (
    <div className="min-w-0">
      {title ? (
        <p data-homepage-role="heading" className="text-lg font-semibold text-ink">{title}</p>
      ) : null}
      {subtitle ? (
        <p data-homepage-role="body" className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
      ) : null}
    </div>
  );
}

/** The single optional CTA; needs both a label and a link to render. */
export function BannerCta({ payload }: { payload: BannerCtaPayload }): ReactNode {
  if (!payload.ctaText || !payload.ctaLink) return null;
  return (
    <SmartLink
      data-homepage-role="action"
      href={payload.ctaLink}
      className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-cta-foreground hover:bg-cta-hover"
    >
      {payload.ctaText}
    </SmartLink>
  );
}
