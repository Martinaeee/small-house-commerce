"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";

/**
 * Left pane: the homepage module tree (sections + announcement bar).
 *
 * Task 13 replaces the list below with the sortable tree, selection and
 * section actions; the editor shell mounts this component as-is.
 */
export function ModuleTree(): ReactNode {
  const { t } = useAdminI18n();
  const { state, selectedSectionId, setSelectedSectionId } = useHomepageEditor();
  const sections = [...state.document.sections].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  return (
    <div
      data-panel="module-tree"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_modules")}
      </h2>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const active = section.id === selectedSectionId;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => setSelectedSectionId(section.id)}
                aria-pressed={active}
                className={`w-full truncate rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-cta text-cta"
                    : "border-border text-ink hover:border-cta/60"
                }`}
              >
                {section.title ?? section.type}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
