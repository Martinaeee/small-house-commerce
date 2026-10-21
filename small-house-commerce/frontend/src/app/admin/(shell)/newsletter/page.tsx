"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { PromotionPanel } from "@/components/admin/newsletter/PromotionPanel";
import { SubscribersTable } from "@/components/admin/newsletter/SubscribersTable";
import { BackInStockTable } from "@/components/admin/newsletter/BackInStockTable";
import { useAdminI18n } from "@/lib/admin-i18n";

type NewsletterTab = "subscribers" | "back-in-stock" | "promotions";

export default function NewsletterAdminPage() {
  // useSearchParams needs a Suspense boundary for prerender.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
          <TableSkeleton rows={6} cols={4} />
        </div>
      }
    >
      <NewsletterAdminContent />
    </Suspense>
  );
}

function NewsletterAdminContent() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canWrite = hasPermission("NEWSLETTER_WRITE");
  const canManagePromotions = hasPermission("SYSTEM_SETTINGS_EDIT");
  const [tab, setTab] = useState<NewsletterTab>("subscribers");

  // Deep link support for the dashboard's "Create discount" shortcut. The
  // requested tab is applied while rendering (the pattern the orders filter
  // bar uses), so a later manual tab switch is not undone.
  const requested = useSearchParams().get("tab");
  const [appliedTab, setAppliedTab] = useState<string | null>(null);
  if (requested !== appliedTab) {
    if (requested === "promotions" && canManagePromotions) setTab("promotions");
    else if (requested === "back-in-stock") setTab("back-in-stock");
    else if (requested === "subscribers") setTab("subscribers");
    setAppliedTab(requested);
  }

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
