"use client";

import { PageHeader } from "@/components/admin/PageHeader";
import { PaymentMethodsSettings } from "@/components/admin/settings/PaymentMethodsSettings";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function PaymentSettingsPage() {
  const { t } = useAdminI18n();
  return (
    <>
      <PageHeader title={t("payment_settings_title")} />
      <PaymentMethodsSettings />
    </>
  );
}
