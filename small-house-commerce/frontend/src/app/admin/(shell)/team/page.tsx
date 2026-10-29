"use client";

import { PageHeader } from "@/components/admin/PageHeader";
import { TeamMembersTable } from "@/components/admin/team/TeamMembersTable";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function TeamAdminPage() {
  const { t } = useAdminI18n();

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader title={t("team_title")} subtitle={t("team_subtitle")} />
      <div className="mt-5">
        <TeamMembersTable />
      </div>
    </div>
  );
}
