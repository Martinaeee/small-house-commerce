"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";

/**
 * Middle pane body: the live hero canvas rendered inside the device frame.
 *
 * Task 16 replaces the placeholder with the real editable canvas (element
 * selection, drag, snapping, safe-area overlays); the shell mounts this
 * component unchanged inside `DeviceFrame`.
 */
export function HeroCanvas(): ReactNode {
  const { t } = useAdminI18n();
  const { state } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slides = hero && hero.type === "HERO" ? hero.payload.slides : [];

  return (
    <div
      data-panel="hero-canvas"
      className="flex h-full w-full flex-col items-center justify-center gap-2 bg-primary-light/20 p-8 text-center"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_preview")}
      </h2>
      {hero ? (
        <p className="text-xs text-ink-muted">{hero.title ?? hero.type}</p>
      ) : null}
      <ul className="flex flex-wrap justify-center gap-1">
        {slides.map((slide) => (
          <li
            key={slide.id}
            data-slide={slide.id}
            className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-secondary"
          >
            {slide.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
