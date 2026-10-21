"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { LandingContentView } from "@/components/product/LandingContentView";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";

type Preview = Awaited<ReturnType<typeof marketingApi.getPreview>> & { pageId: string; accountId: string };
export default function MarketingPreview({ pageId }: { pageId: string }) {
  const { status, admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status !== "authed" || !admin) return;
    let alive = true;
    void marketingApi.getPreview(pageId).then((result) => {
      if (alive) { setPreview({ ...result, pageId, accountId: admin.id }); setError(null); }
    }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [pageId, status, admin]);
  if (status !== "authed" || !admin) return null;
  if (error) return <p role="alert" className="p-6 text-red-700">{error}</p>;
  if (!preview || preview.pageId !== pageId || preview.accountId !== admin.id) return <p className="p-6">{t("marketing_loading")}</p>;
  return <div className="min-w-0">
    <p className="sticky top-0 z-20 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{t("marketing_preview_notice")}</p>
    <LandingContentView content={preview.content} approvedContent={preview.content} product={preview.product} preview />
  </div>;
}
