"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, resolveUploadType } from "@/components/admin/ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface UploadedMedia {
  url: string;
  type: "IMAGE" | "VIDEO";
}

export interface MediaUploadTarget {
  key: string;
  onAddMedia: (media: UploadedMedia) => void;
  kind?: "image" | "video";
  operation?: "ADD" | "REPLACE";
}

export interface MediaBatchFile {
  operation: "ADD" | "REPLACE";
  name: string;
  status: "waiting" | "uploading" | "uploaded" | "failed";
  reason?: string;
}

export interface MediaBatchUpload {
  results: Readonly<Record<string, readonly MediaBatchFile[]>>;
  targetKey: string | null;
  uploading: boolean;
  upload(files: readonly File[], target: MediaUploadTarget): Promise<void>;
  dismiss(key: string): void;
}

export function useMediaBatchUpload({ disabled = false, isTargetAvailable }: { disabled?: boolean; isTargetAvailable?: (key: string) => boolean }): MediaBatchUpload {
  const { t } = useAdminI18n();
  const [results, setResults] = useState<Record<string, MediaBatchFile[]>>({});
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const guards = useRef({ disabled, isTargetAvailable });

  useEffect(() => { guards.current = { disabled, isTargetAvailable }; }, [disabled, isTargetAvailable]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function upload(picked: readonly File[], target: MediaUploadTarget): Promise<void> {
    if (!mounted.current || guards.current.disabled || inFlight.current || picked.length === 0) return;
    const { key, onAddMedia, kind: fixedKind, operation = "ADD" } = target;
    const stoppedReason = (): string | null => {
      if (guards.current.disabled) return t("product_media_batch_stopped");
      if (guards.current.isTargetAvailable && !guards.current.isTargetAvailable(key)) return t("product_media_batch_target_missing");
      return null;
    };
    inFlight.current = true;
    setUploading(true);
    setTargetKey(key);
    setResults((previous) => ({ ...previous, [key]: picked.map((file) => ({ name: file.name, operation, status: "waiting" })) }));
    const updateFile = (index: number, patch: Partial<MediaBatchFile>): void => {
      if (!mounted.current) return;
      setResults((previous) => ({ ...previous, [key]: previous[key].map((row, i) => i === index ? { ...row, ...patch } : row) }));
    };
    const failRemaining = (reason: string): void => {
      if (!mounted.current) return;
      setResults((previous) => ({ ...previous, [key]: previous[key].map((row) =>
        row.status === "waiting" || row.status === "uploading" ? { ...row, status: "failed", reason } : row,
      ) }));
    };
    try {
      const { adminApi } = await import("@/lib/admin-api");
      for (const [index, file] of picked.entries()) {
        if (!mounted.current) return;
        const stopped = stoppedReason();
        if (stopped) {
          failRemaining(stopped);
          break;
        }
        const kinds = fixedKind ? [fixedKind] : file.type.startsWith("video/") ? ["video", "image"] as const : ["image", "video"] as const;
        const kind = kinds.find((candidate) => resolveUploadType(file.name, file.type, candidate));
        const contentType = kind ? resolveUploadType(file.name, file.type, kind) : null;
        const maximum = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (!contentType || file.size > maximum) {
          updateFile(index, {
            status: "failed",
            reason: t(!contentType ? "product_media_batch_invalid_type" : kind === "video" ? "product_media_batch_video_too_large" : "product_media_batch_too_large"),
          });
          continue;
        }
        updateFile(index, { status: "uploading" });
        try {
          const result = await adminApi.uploadImage(file, contentType);
          if (!mounted.current) return;
          const stopped = stoppedReason();
          if (stopped) {
            failRemaining(stopped);
            break;
          }
          onAddMedia({ url: result.url, type: kind === "video" ? "VIDEO" : "IMAGE" });
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

  function dismiss(key: string): void {
    if (inFlight.current && targetKey === key) return;
    setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([target]) => target !== key)));
  }

  return { results, targetKey, uploading, upload, dismiss };
}
