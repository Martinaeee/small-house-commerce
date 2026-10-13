"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { PromotionPanel } from "@/components/admin/newsletter/PromotionPanel";
import { SubscribersTable } from "@/components/admin/newsletter/SubscribersTable";
import { BackInStockTable } from "@/components/admin/newsletter/BackInStockTable";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function NewsletterAdminPage() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canWrite = hasPermission("NEWSLETTER_WRITE");
  const canManagePromotions = hasPermission("SYSTEM_SETTINGS_EDIT");
  const [tab, setTab] = useState<
    "subscribers" | "back-in-stock" | "promotions"
  >("subscribers");

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title={t("newsletter_title")}
        subtitle={t("newsletter_subtitle")}
      />

      <div
        className="mt-5 flex flex-wrap gap-2 border-b border-border pb-3"
        role="tablist"
        aria-label={t("newsletter_title")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "subscribers"}
          onClick={() => setTab("subscribers")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "subscribers"
              ? "bg-cta text-white"
              : "bg-card text-ink hover:bg-background"
          }`}
        >
          {t("newsletter_tab_subscribers")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "back-in-stock"}
          onClick={() => setTab("back-in-stock")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "back-in-stock"
              ? "bg-cta text-white"
              : "bg-card text-ink hover:bg-background"
          }`}
        >
          {t("newsletter_tab_back_in_stock")}
        </button>
        {canManagePromotions ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "promotions"}
            onClick={() => setTab("promotions")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "promotions"
                ? "bg-cta text-white"
                : "bg-card text-ink hover:bg-background"
            }`}
          >
            {t("newsletter_tab_promotions")}
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        {tab === "promotions" && canManagePromotions ? (
          <PromotionPanel />
        ) : tab === "back-in-stock" ? (
          <BackInStockTable canWrite={canWrite} />
        ) : (
          <SubscribersTable canWrite={canWrite} />
        )}
      </div>
    </div>
  );
}
