"use client";

import { useRef, useState, type ReactNode } from "react";
import { Select, TextInput } from "@/components/admin/Field";
import { ACCEPT_ATTRS } from "@/components/admin/ImageUrlInput";
import { useMediaBatchUpload, type MediaBatchUpload, type UploadedMedia } from "@/components/admin/product-form/useMediaBatchUpload";
import { useAdminI18n } from "@/lib/admin-i18n";

const STATUS_KEYS = {
  waiting: "product_media_batch_waiting",
  uploading: "product_media_batch_active",
  uploaded: "product_media_batch_uploaded",
  failed: "product_media_batch_failed",
} as const;

export function MediaAddRow({ disabled = false, onAddMedia, batchUpload, targetKey = "shared" }: {
  disabled?: boolean;
  onAddMedia: (media: UploadedMedia) => void;
  batchUpload?: MediaBatchUpload;
  targetKey?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const localBatch = useMediaBatchUpload({ disabled });
  const batch = batchUpload ?? localBatch;
  const [urlDraft, setUrlDraft] = useState("");
  const [urlType, setUrlType] = useState<UploadedMedia["type"]>("IMAGE");
  const [expanded, setExpanded] = useState(false);
  const files = batch.results[targetKey] ?? [];
  const busy = batch.uploading;
  const ownBusy = busy && batch.targetKey === targetKey;
  const failures = files.filter((file) => file.status === "failed");
  const successes = files.filter((file) => file.status === "uploaded").length;
  const done = successes + failures.length;
  const currentFile = files.find((file) => file.status === "uploading" || file.status === "waiting");

  async function handleFiles(picked: FileList | null): Promise<void> {
    if (disabled || busy) return;
    setExpanded(false);
    await batch.upload(picked ? Array.from(picked) : [], { key: targetKey, onAddMedia });
    if (fileRef.current) fileRef.current.value = "";
  }
  function addUrl(): void {
    if (disabled || busy || !urlDraft.trim()) return;
    onAddMedia({ url: urlDraft.trim(), type: urlType });
    setUrlDraft("");
  }

  return (
    <div className="mt-3 flex flex-col gap-2" data-media-add={targetKey}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted" onClick={() => fileRef.current?.click()} disabled={disabled || busy} aria-busy={ownBusy}>
          {t("product_media_batch_upload")}
        </button>
        <input ref={fileRef} type="file" multiple accept={`${ACCEPT_ATTRS.image},${ACCEPT_ATTRS.video},.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov`} className="hidden" aria-label={t("product_media_batch_input_aria")} disabled={disabled || busy} onChange={(event) => void handleFiles(event.target.files)} />
        <div className="grid min-w-48 flex-1 grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2">
          <Select aria-label={t("product_media_url_type")} value={urlType} onChange={(event) => setUrlType(event.target.value as UploadedMedia["type"])} disabled={disabled || busy}>
            <option value="IMAGE">{t("product_media_type_image")}</option>
            <option value="VIDEO">{t("product_media_type_video")}</option>
          </Select>
          <TextInput className="min-w-0" aria-label={t("product_media_url_add_aria")} value={urlDraft} placeholder="https://…" onChange={(event) => setUrlDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addUrl();
          }} disabled={disabled || busy} autoComplete="off" />
          <button type="button" className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted" onClick={addUrl} disabled={disabled || busy || !urlDraft.trim()}>{t("product_media_url_add")}</button>
        </div>
      </div>
      {files.length > 0 ? (
        <div className="rounded-lg bg-background px-3 py-2 text-xs text-ink-secondary">
          <div className="flex min-w-0 items-center gap-3">
            <span role="status" className="min-w-0 flex-1 truncate" title={currentFile?.name}>
              {ownBusy
                ? t("product_media_batch_progress", { current: Math.min(done + 1, files.length), total: files.length, name: currentFile?.name ?? "" })
                : failures.length > 0
                  ? t(files[0].operation === "REPLACE" ? "product_media_batch_replace_partial" : "product_media_batch_partial", { success: successes, failed: failures.length })
                  : t(files[0].operation === "REPLACE" ? "product_media_batch_replace_success" : "product_media_batch_success", { count: successes })}
            </span>
            <button type="button" aria-expanded={expanded} className="shrink-0 font-semibold text-cta hover:underline" onClick={() => setExpanded(!expanded)}>{t(expanded ? "product_media_batch_hide_details" : "product_media_batch_details")}</button>
            {!ownBusy ? <button type="button" aria-label={t("product_media_batch_dismiss")} className="shrink-0 px-1 text-base hover:text-ink" onClick={() => batch.dismiss(targetKey)}>×</button> : null}
          </div>
          {expanded ? (
            <ul aria-label={t("product_media_batch_queue")} className="mt-2 max-h-32 overflow-y-auto">
              {files.map((file, index) => <li key={index} className="flex items-center justify-between gap-3 py-0.5"><span className="truncate" title={file.name}>{file.name}</span><span className="shrink-0">{t(STATUS_KEYS[file.status])}</span></li>)}
            </ul>
          ) : null}
          {failures.length > 0 ? (
            <ul role="alert" className="mt-2 max-h-32 overflow-y-auto break-words text-red-700">
              {failures.map((failure, index) => <li key={index}>{t("product_media_batch_failure", { name: failure.name, reason: failure.reason ?? "" })}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
