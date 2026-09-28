"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";

/**
 * Publish workflow panel, rendered inside the shell's publish dialog.
 *
 * Task 17 replaces the placeholder with validation results, the publish
 * schedule form and the warning confirmation flow.
 */
export function PublishPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { state } = useHomepageEditor();

  return (
    <div
      data-panel="publish-panel"
      className="flex min-h-[160px] flex-col gap-3"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_publish_title")}
      </h2>
      <p className="text-xs text-ink-muted">
        {t("homepage_builder_version_label", { versionNo: state.rev })}
      </p>
    </div>
  );
}
