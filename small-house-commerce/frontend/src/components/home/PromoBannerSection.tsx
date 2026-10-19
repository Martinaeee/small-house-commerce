"use client";

import type { ReactNode } from "react";
import type { SectionProps } from "./sectionRegistry";
import { SectionShell } from "./sectionShell";
import { BannerCopy, BannerCta, bannerLayoutClass, normalizeBannerCta } from "./BannerBody";
import { useDeadlineCountdown } from "./BannerCountdown";

/**
 * PROMO_BANNER: a standing promo strip with one optional CTA. Static copy is
 * server-rendered; only the schedule end is evaluated at runtime, so a cached
 * page still drops the banner when its `unpublishAt` has passed.
 */
export function PromoBannerSection({
  section,
  previewDevice,
}: SectionProps): ReactNode {
  const cta = normalizeBannerCta(section.payload);
  const unpublishMs = section.schedule?.unpublishAt
    ? Date.parse(section.schedule.unpublishAt)
    : Number.NaN;
  const { active } = useDeadlineCountdown(unpublishMs, {
    hideUntilMounted: false,
    requireDeadline: false,
  });

  if (!active) return null;

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <div data-banner-layout className={bannerLayoutClass(previewDevice)}>
        <BannerCopy title={section.title} subtitle={section.subtitle} />
        <BannerCta payload={cta} />
      </div>
    </SectionShell>
  );
}
