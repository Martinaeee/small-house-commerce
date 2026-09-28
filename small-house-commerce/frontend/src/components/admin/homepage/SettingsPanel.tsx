"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";

/**
 * Right pane: element and section settings.
 *
 * Task 14 replaces the placeholder with the grouped settings panels
 * (Content / Typography / Position / Responsive / Style) driven by the
 * editor context selection.
 */
export function SettingsPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { selectedSectionId, selectedSlideId, selectedElementKey } =
    useHomepageEditor();
  const selection = selectedElementKey ?? selectedSlideId ?? selectedSectionId;

  return (
    <div
      data-panel="settings-panel"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_settings")}
      </h2>
      <p data-selection className="truncate text-xs text-ink-muted">
        {selection ?? "—"}
      </p>
    </div>
  );
}
