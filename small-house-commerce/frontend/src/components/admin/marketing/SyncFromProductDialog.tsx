"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";
import type { LandingContent } from "@/lib/marketing-content";

type Comparison = Awaited<ReturnType<typeof marketingApi.source>>;
export function SyncFromProductDialog({ pageId, content, busy, error, onClose, onSync }: {
  pageId: string; content: LandingContent; busy: boolean; error?: string | null; onClose: () => void;
  onSync: (sourceKeys: string[], insertBeforeId?: string | null) => void;
}) {
  const { t } = useAdminI18n();
  const [source, setSource] = useState<Comparison | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [position, setPosition] = useState("");
  useEffect(() => {
    let alive = true;
    void marketingApi.source(pageId).then((result) => { if (alive) setSource(result); }).catch((reason: unknown) => { if (alive) setLoadError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [pageId]);
  const currentKeys = new Set(content.blocks.map((block) => block.sourceKey));
  const restoring = selected.some((key) => !currentKeys.has(key));
  return <Dialog open title={t("marketing_sync")} onClose={() => { if (!busy) onClose(); }}>
    <p className="mb-4 text-sm text-ink-muted">{t("marketing_sync_hint")}</p>
    {(loadError || error) && <p role="alert" className="mb-3 text-sm text-red-700">{loadError || error}</p>}
    {!source && !loadError && <p>{t("marketing_loading")}</p>}
    <div className="space-y-2">
      {source?.content.blocks.filter((block) => block.sourceKey).map((block) => <label key={block.sourceKey} className="flex items-start gap-3 rounded-lg border border-admin-border p-3 text-sm">
        <input type="checkbox" className="mt-0.5" disabled={busy} checked={selected.includes(block.sourceKey!)} onChange={(event) => setSelected((keys) => event.target.checked ? [...keys, block.sourceKey!] : keys.filter((key) => key !== block.sourceKey))} />
        <span>{t(`marketing_block_${block.type}`)}{block.type === "hero" && <span className="ml-1 text-ink-muted">· {block.props.title}</span>}</span>
      </label>)}
    </div>
    {restoring && <label className="mt-4 block space-y-2 text-sm">{t("marketing_sync_position")}
      <select className="w-full rounded-lg border border-admin-border p-2" value={position} disabled={busy} onChange={(event) => setPosition(event.target.value)}>
        <option value="">{t("marketing_sync_choose")}</option>
        {content.blocks.map((block, index) => <option key={block.id} value={block.id}>{index + 1} · {t(`marketing_block_${block.type}`)}</option>)}
        <option value="__end__">{t("marketing_sync_end")}</option>
      </select>
    </label>}
    <div className="mt-5 flex justify-end">
      <button type="button" className="rounded-lg bg-admin-primary px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || !selected.length || (restoring && !position)} onClick={() => onSync(selected, restoring ? position === "__end__" ? null : position : undefined)}>{t("marketing_sync_selected")}</button>
    </div>
  </Dialog>;
}
