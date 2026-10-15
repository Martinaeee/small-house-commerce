"use client";

import Link from "next/link";
import type { MarketingPageRow } from "@/lib/marketing-api";
import { useAdminI18n } from "@/lib/admin-i18n";

export function PublishBar({ page, canManage, busy, unsaved, canPublish, onSave, onPublish, onDisable }: {
  page: MarketingPageRow; canManage: boolean; busy: boolean; unsaved: boolean; canPublish: boolean;
  onSave: () => void; onPublish: () => void; onDisable: () => void;
}) {
  const { t } = useAdminI18n();
  return <div className="sticky top-0 z-20 -mx-4 border-b border-admin-border bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <nav aria-label={t("marketing_editor_navigation")} className="mb-2 flex flex-wrap gap-3 text-xs">
          <Link className="font-medium text-admin-primary hover:underline" href="/admin/marketing"><span aria-hidden="true">← </span>{t("marketing_back_pages")}</Link>
          <Link className="font-medium text-admin-primary hover:underline" href={`/admin/marketing/compare?${new URLSearchParams({ productId: page.productId })}`}>{t("marketing_back_compare")}<span aria-hidden="true"> →</span></Link>
        </nav>
        <p className="text-sm font-semibold text-admin-text">{page.productName} <span className="ml-2 font-mono text-xs text-admin-muted">{page.productCode}</span></p>
        <p className="text-xs text-admin-muted">{page.ownerName ?? t("marketing_unassigned")}{page.aid && ` · ${page.aid}`} · {t(`marketing_status_${page.effectiveStatus}`)}</p>
        <p className="break-all font-mono text-xs text-admin-muted">/lp/{page.slug}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && <>
          <button type="button" className="h-9 rounded-lg border border-admin-border px-3 text-sm disabled:opacity-40" disabled={busy} onClick={onSave}>{t("marketing_save")}</button>
          <button type="button" className="h-9 rounded-lg bg-admin-primary px-3 text-sm text-white disabled:opacity-40" disabled={busy || unsaved || !canPublish} onClick={onPublish}>{t(page.publishedRevision ? "marketing_update_publish" : "marketing_publish")}</button>
          {page.status !== "DRAFT" && <button type="button" className="h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700 disabled:opacity-40" disabled={busy || page.status === "DISABLED"} onClick={onDisable}>{t("marketing_disable")}</button>}
        </>}
      </div>
    </div>
    {unsaved && <p className="mt-2 text-xs font-medium text-amber-700">{t("marketing_unsaved")}</p>}
    {!unsaved && page.hasUnpublishedChanges && <p className="mt-2 text-xs font-medium text-amber-700">{t(page.publishedRevision > 0 ? "marketing_unpublished_live" : "marketing_unpublished")}</p>}
  </div>;
}
