"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, resolveUploadType } from "@/components/admin/ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface MediaBatchFile {
  name: string;
  status: "waiting" | "uploading" | "uploaded" | "failed";
  reason?: string;
}

export interface MediaBatchUpload {
  files: readonly MediaBatchFile[];
  uploading: boolean;
  upload(files: readonly File[]): Promise<void>;
}

/** The product form owns this task so tab changes do not dispose its queue. */
export function useMediaBatchUpload({
  disabled = false,
  onAddImageUrl,
}: {
  disabled?: boolean;
  onAddImageUrl: (url: string) => void;
}): MediaBatchUpload {
  const { t } = useAdminI18n();
  const [files, setFiles] = useState<MediaBatchFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const callbacks = useRef({ disabled, onAddImageUrl });

  useEffect(() => {
    callbacks.current = { disabled, onAddImageUrl };
  }, [disabled, onAddImageUrl]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const updateFile = (index: number, patch: Partial<MediaBatchFile>): void => {
    if (!mounted.current) return;
    setFiles((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const failRemaining = (reason: string): void => {
    if (!mounted.current) return;
    setFiles((rows) => rows.map((row) =>
      row.status === "waiting" || row.status === "uploading"
        ? { ...row, status: "failed", reason }
        : row,
    ));
  };

  async function upload(picked: readonly File[]): Promise<void> {
    if (!mounted.current || callbacks.current.disabled || inFlight.current || picked.length === 0) return;
    inFlight.current = true;
    setUploading(true);
    setFiles(picked.map((file) => ({ name: file.name, status: "waiting" })));
    try {
      const { adminApi } = await import("@/lib/admin-api");
      for (const [index, file] of picked.entries()) {
        if (!mounted.current) return;
        if (callbacks.current.disabled) {
          failRemaining(t("product_media_batch_stopped"));
          break;
        }
        const contentType = resolveUploadType(file.name, file.type, "image");
        if (!contentType || file.size > MAX_IMAGE_BYTES) {
          updateFile(index, {
            status: "failed",
            reason: t(!contentType ? "product_media_batch_invalid_type" : "product_media_batch_too_large"),
          });
          continue;
        }
        updateFile(index, { status: "uploading" });
        try {
          const result = await adminApi.uploadImage(file, contentType);
          if (!mounted.current) return;
          if (callbacks.current.disabled) {
            failRemaining(t("product_media_batch_stopped"));
            break;
          }
          callbacks.current.onAddImageUrl(result.url);
          updateFile(index, { status: "uploaded" });
        } catch {
          if (!mounted.current) return;
          updateFile(index, { status: "failed", reason: t("product_media_batch_upload_failed") });
        }
      }
    } catch {
      failRemaining(t("product_media_batch_upload_failed"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setUploading(false);
    }
  }

  return { files, uploading, upload };
}
