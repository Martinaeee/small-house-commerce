"use client";

import { useRef, useState, type ReactNode } from "react";
import { TextInput } from "@/components/admin/Field";
import { ACCEPT_ATTRS } from "@/components/admin/ImageUrlInput";
import { useMediaBatchUpload, type MediaBatchUpload } from "@/components/admin/product-form/useMediaBatchUpload";
import { useAdminI18n } from "@/lib/admin-i18n";

const STATUS_KEYS = {
  waiting: "product_media_batch_waiting",
  uploading: "product_media_batch_active",
  uploaded: "product_media_batch_uploaded",
  failed: "product_media_batch_failed",
} as const;

/** One compact row; product forms pass their persistent batch task. */
export function MediaAddRow({
  disabled = false,
  onAddImageUrl,
  batchUpload,
}: {
  disabled?: boolean;
  onAddImageUrl: (url: string) => void;
  batchUpload?: MediaBatchUpload;
}): ReactNode {
  const { t } = useAdminI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const localBatch = useMediaBatchUpload({ disabled, onAddImageUrl });
  const batch = batchUpload ?? localBatch;
  const [urlDraft, setUrlDraft] = useState("");
  const busy = batch.uploading;
  const failures = batch.files.filter((file) => file.status === "failed");
  const done = batch.files.filter((file) => file.status === "uploaded" || file.status === "failed").length;

  async function handleFiles(files: FileList | null): Promise<void> {
    await batch.upload(files ? Array.from(files) : []);
    if (fileRef.current) fileRef.current.value = "";
  }
  function addUrl(): void {
    if (disabled || busy) return;
    const url = urlDraft.trim();
    if (!url) return;
    onAddImageUrl(url);
    setUrlDraft("");
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          aria-busy={busy}
        >
          {busy
            ? t("product_media_batch_uploading", { done, total: batch.files.length })
            : t("product_media_batch_upload")}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRS.image}
          className="hidden"
          aria-label={t("product_media_batch_input_aria")}
          disabled={disabled || busy}
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <TextInput
            aria-label={t("product_media_url_add_aria")}
            value={urlDraft}
            placeholder="https://…"
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addUrl();
            }}
            disabled={disabled || busy}
            autoComplete="off"
          />
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted"
            onClick={addUrl}
            disabled={disabled || busy || urlDraft.trim() === ""}
          >
            {t("product_media_url_add")}
          </button>
        </div>
      </div>
      {batch.files.length > 0 ? (
        <ul aria-label={t("product_media_batch_queue")} className="max-h-24 overflow-y-auto text-xs text-ink-secondary">
          {batch.files.map((file, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-0.5">
              <span className="truncate">{file.name}</span>
              <span className="shrink-0">{t(STATUS_KEYS[file.status])}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {failures.length > 0 ? (
        <ul role="alert" className="text-xs text-red-700">
          {failures.map((failure, index) => (
            <li key={index}>
              {t("product_media_batch_failure", { name: failure.name, reason: failure.reason ?? "" })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
