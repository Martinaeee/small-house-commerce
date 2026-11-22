"use client";

import { PhasePlaceholder } from "@/components/admin/observability/PhasePlaceholder";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function PageExperiencePage() {
  const { t } = useAdminI18n();
  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PhasePlaceholder
        title={t("health_section_page_experience")}
        subtitle={t("health_page_experience_subtitle")}
        phase="P4"
        t={t}
      />
    </div>
  );
}
