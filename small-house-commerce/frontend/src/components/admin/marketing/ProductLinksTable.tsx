"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { CampaignLinkProductGroup } from "@/lib/marketing-api";
import { ProductThumb } from "./ReportColumns";

const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs";
export function ProductLinksTable({ groups, canCreate, onOpen, onCreate }: {
  groups: CampaignLinkProductGroup[]; canCreate: boolean;
  onOpen: (productId: string) => void; onCreate: (productId: string) => void;
}) {
  const { t } = useAdminI18n();
  return <div className="rounded-xl border border-admin-border bg-white">
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="bg-slate-50 text-xs text-admin-muted"><tr>{[t("link_builder_product"), t("marketing_links"), t("marketing_post_last_post"), t("common_actions")].map(key => <th key={key} className="whitespace-nowrap px-3 py-2">{key}</th>)}</tr></thead>
      <tbody className="divide-y divide-admin-border">
        {groups.map(group => <tr key={group.product.id}>
          <td className="px-3 py-3"><div className="flex items-center gap-2"><ProductThumb url={group.product.thumbnailUrl} label={group.product.name} /><div><p className="font-medium">{group.product.name}</p><p className="text-xs text-admin-muted">{group.product.productCode ?? "—"}</p></div></div></td>
          <td className="px-3 py-3"><p>{t("marketing_post_count", { count: String(group.recordCount) })}</p><p className="text-xs text-admin-muted">{t("marketing_post_facebook_count", { count: String(group.postCount) })}</p></td>
          <td className="px-3 py-3"><p>{group.lastPostDate ?? t("marketing_post_unregistered")}</p></td>
          <td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-1"><button type="button" className={buttonClass} onClick={() => onOpen(group.product.id)}>{t("marketing_post_view_records")}</button>{canCreate && <button type="button" className={buttonClass} onClick={() => onCreate(group.product.id)}>{t("marketing_post_add")}</button>}</div></td>
        </tr>)}
      </tbody>
    </table>
    <div className="divide-y divide-admin-border md:hidden">
      {groups.map(group => <article key={group.product.id} className="space-y-2 p-3">
        <div className="flex min-w-0 items-start gap-2"><ProductThumb url={group.product.thumbnailUrl} label={group.product.name} /><div className="min-w-0"><p className="break-words font-medium">{group.product.name}</p><p className="text-xs text-admin-muted">{group.product.productCode ?? "—"}</p></div></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>{t("marketing_post_count", { count: String(group.recordCount) })}</span><span className="text-admin-muted">{t("marketing_post_facebook_count", { count: String(group.postCount) })}</span><span>{t("marketing_post_last_post")}: {group.lastPostDate ?? t("marketing_post_unregistered")}</span></div>
        <div className="flex flex-wrap gap-1"><button type="button" className={buttonClass} onClick={() => onOpen(group.product.id)}>{t("marketing_post_view_records")}</button>{canCreate && <button type="button" className={buttonClass} onClick={() => onCreate(group.product.id)}>{t("marketing_post_add")}</button>}</div>
      </article>)}
    </div>
  </div>;
}
