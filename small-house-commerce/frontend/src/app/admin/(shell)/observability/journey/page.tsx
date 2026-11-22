"use client";

import { PhasePlaceholder } from "@/components/admin/observability/PhasePlaceholder";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function JourneyDiagnosticsPage() {
  const { t } = useAdminI18n();
  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PhasePlaceholder
        title={t("health_section_journey")}
        subtitle={t("health_journey_subtitle")}
        phase="P5"
        t={t}
      />
    </div>
  );
}
