"use client";

import { useRef, useState, type ReactNode } from "react";
import { TextInput } from "@/components/admin/Field";
import {
  ACCEPT_ATTRS,
  MAX_IMAGE_BYTES,
  resolveUploadType,
} from "@/components/admin/ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";

type BatchFailure = { name: string; reason: string };

/**
 * One compact row for adding images to the shared gallery: pick several local
 * files at once (sequential uploads through the existing single-file endpoint,
 * failures reported per file and never aborting the batch), or paste a public
 * image URL. Every success appends through `onAddImageUrl` in picker order.
 */
export function MediaAddRow({
  disabled = false,
  onAddImageUrl,
}: {
  disabled?: boolean;
  onAddImageUrl: (url: string) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [urlDraft, setUrlDraft] = useState("");

  async function handleFiles(files: FileList | null): Promise<void> {
    const picked = files ? Array.from(files) : [];
    if (picked.length === 0) return;
    setFailures([]);
    setProgress({ done: 0, total: picked.length });
    // Lazy import keeps the admin API module out of non-upload bundles.
    const { adminApi } = await import("@/lib/admin-api");
    let done = 0;
    for (const file of picked) {
      const contentType = resolveUploadType(file.name, file.type, "image");
      if (!contentType) {
        setFailures((current) => [
          ...current,
          { name: file.name, reason: t("product_media_batch_invalid_type") },
        ]);
      } else if (file.size > MAX_IMAGE_BYTES) {
        setFailures((current) => [
          ...current,
          { name: file.name, reason: t("product_media_batch_too_large") },
        ]);
      } else {
        try {
          const res = await adminApi.uploadImage(file, contentType);
          onAddImageUrl(res.url);
        } catch {
          setFailures((current) => [
            ...current,
            { name: file.name, reason: t("product_media_batch_upload_failed") },
          ]);
        }
      }
      done += 1;
      setProgress({ done, total: picked.length });
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const busy = progress !== null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy
            ? t("product_media_batch_uploading", {
                done: progress.done,
                total: progress.total,
              })
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
            disabled={disabled}
            autoComplete="off"
          />
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted"
            onClick={() => {
              const url = urlDraft.trim();
              if (!url) return;
              onAddImageUrl(url);
              setUrlDraft("");
            }}
            disabled={disabled || urlDraft.trim() === ""}
          >
            {t("product_media_url_add")}
          </button>
        </div>
      </div>
      {failures.length > 0 ? (
        <ul role="alert" className="text-xs text-red-700">
          {failures.map((failure) => (
            <li key={failure.name}>
              {t("product_media_batch_failure", {
                name: failure.name,
                reason: failure.reason,
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
