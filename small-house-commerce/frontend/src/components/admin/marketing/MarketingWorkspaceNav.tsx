"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";

export function MarketingWorkspaceNav({ active, productId, unsaved }: { active: "pages" | "compare" | "optimizers"; productId?: string; unsaved?: boolean }) {
  const { t } = useAdminI18n();
  const suffix = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  const entries = [
    { id: "pages", label: t("marketing_nav_pages"), href: `/admin/marketing${suffix}` },
    { id: "compare", label: t("marketing_nav_compare"), href: `/admin/marketing/compare${suffix}` },
    { id: "optimizers", label: t("marketing_nav_optimizers"), href: `/admin/marketing/optimizers${suffix}` },
  ] as const;
  return <nav aria-label={t("marketing_views_label")} className="flex gap-1 overflow-x-auto whitespace-nowrap">
    {entries.map((entry) => <Link
      key={entry.id}
      href={entry.href}
      aria-current={active === entry.id ? "page" : undefined}
      className={`border-b-2 px-4 py-3 text-sm ${active === entry.id ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`}
      onClick={(event) => { if (unsaved && !window.confirm(t("marketing_discard_confirm"))) event.preventDefault(); }}
    >{entry.label}</Link>)}
  </nav>;
}
