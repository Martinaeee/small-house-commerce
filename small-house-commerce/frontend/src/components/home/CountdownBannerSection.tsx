"use client";

import type { ReactNode } from "react";
import type { SectionProps } from "./sectionRegistry";
import { SectionShell } from "./sectionShell";
import { BannerCopy, BannerCta, bannerLayoutClass, normalizeBannerCta } from "./BannerBody";
import { CountdownDigits, useDeadlineCountdown } from "./BannerCountdown";

/**
 * COUNTDOWN_BANNER: a timed promo strip that disappears entirely at its
 * deadline. The section is only rendered once the client clock has been read
 * (see `useDeadlineCountdown`), so cached HTML can never flash an expired
 * banner and hydration always matches.
 */
export function CountdownBannerSection({
  section,
  previewDevice,
}: SectionProps): ReactNode {
  const cta = normalizeBannerCta(section.payload);
  const payload = section.payload as Record<string, unknown>;
  const endsAtMs =
    typeof payload.endsAt === "string" ? Date.parse(payload.endsAt) : Number.NaN;
  const unpublishMs = section.schedule?.unpublishAt
    ? Date.parse(section.schedule.unpublishAt)
    : Number.NaN;
  // Half-open on both bounds: whichever of endsAt / schedule end comes first
  // hides the section. A missing/invalid endsAt fails closed.
  const deadlineMs =
    Number.isFinite(endsAtMs) && Number.isFinite(unpublishMs)
      ? Math.min(endsAtMs, unpublishMs)
      : endsAtMs;
  const { active, parts } = useDeadlineCountdown(deadlineMs, {
    hideUntilMounted: true,
    requireDeadline: true,
  });

  if (!active || parts === null) return null;

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <div data-banner-layout className={bannerLayoutClass(previewDevice)}>
        <BannerCopy title={section.title} subtitle={section.subtitle} />
        <div className="flex flex-col items-start gap-3">
          <span role="timer" aria-label="Time left" className="text-xl text-ink">
            <CountdownDigits parts={parts} />
          </span>
          <BannerCta payload={cta} />
        </div>
      </div>
    </SectionShell>
  );
}
