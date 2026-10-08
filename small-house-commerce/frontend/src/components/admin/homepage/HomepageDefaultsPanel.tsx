"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import {
  SectionStyleFields,
  readSectionStyle,
  type SectionStylePatch,
} from "@/components/admin/homepage/SectionStyleFields";
import { updateDefaults } from "@/lib/homepage-document";

/**
 * Right-pane editor for the homepage-wide default section style. The values
 * live on `document.defaults`; every section inherits them field by field and
 * can override any single field through its own "advanced override" block.
 */
export function HomepageDefaultsPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch } = useHomepageEditor();
  const value = readSectionStyle(state.document.defaults);

  const applyPatch = (patch: SectionStylePatch): void => {
    dispatch({
      type: "mutate",
      mutate: (document) => updateDefaults(document, patch),
    });
  };

  return (
    <div
      data-testid="homepage-defaults-panel"
      data-panel="homepage-defaults"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">
          {t("homepage_builder_defaults_title")}
        </h2>
        <p className="text-xs leading-relaxed text-ink-muted">
          {t("homepage_builder_defaults_hint")}
        </p>
      </header>
      <SectionStyleFields
        value={value}
        onChange={applyPatch}
        inheritText={t("homepage_builder_defaults_unset")}
      />
    </div>
  );
}
