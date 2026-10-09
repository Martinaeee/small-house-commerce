"use client";

import { useRef, useState, type FocusEventHandler } from "react";
import { inputClsCompact } from "./Field";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const ACCEPTED_TYPES = {
  image: {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  },
  video: {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  },
} as const;

export const ACCEPT_ATTRS = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/webm,video/quicktime",
} as const;

type Kind = keyof typeof ACCEPTED_TYPES;

export type ImageUrlInputLabels = {
  upload: string;
  uploading: string;
  invalidType: string;
  tooLarge: string;
  uploadFailed: string;
};

const DEFAULT_LABELS: Record<Kind, ImageUrlInputLabels> = {
  image: {
    upload: "上传图片",
    uploading: "上传中…",
    invalidType: "仅支持 JPG / PNG / WebP 图片",
    tooLarge: "图片不能超过 5MB",
    uploadFailed: "上传失败，请重试",
  },
  video: {
    upload: "上传视频",
    uploading: "上传中…",
    invalidType: "仅支持 MP4 / WebM / MOV 视频",
    tooLarge: "视频不能超过 100MB",
    uploadFailed: "上传失败，请重试",
  },
};

/**
 * The MIME type to upload a picked file as, or null when the file is not one
 * of the accepted types for this field.
 *
 * `File.type` cannot be trusted alone: browsers report "" for files whose
 * extension the OS has no mapping for (videos copied off Android/SD cards are
 * the common case) and application/octet-stream for others. Rejecting those
 * before the upload made the picker look broken for perfectly good MP4s, so
 * the extension is consulted as a fallback and the MIME is only honoured when
 * it agrees with this field's kind.
 */
export function resolveUploadType(
  fileName: string,
  fileType: string,
  kind: Kind,
): string | null {
  const accepted: Record<string, string> = ACCEPTED_TYPES[kind];
  if (fileType in accepted) return fileType;

  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (kind === "image" && ext === "jpeg") return "image/jpeg";
  for (const [mime, knownExt] of Object.entries(accepted)) {
    if (knownExt === ext) return mime;
  }
  return null;
}

/**
 * Media field for admin forms: paste a public URL, or pick a local file and
 * POST the bytes to the backend, which stores them on the upload volume and
 * returns the site-relative /uploads/… URL. No third-party storage required.
 * `kind="video"` switches the picker, size cap (100 MB) and thumbnail to
 * video mode for gallery/detail video entries.
 */
export function ImageUrlInput({
  id,
  ariaLabel,
  value,
  onChange,
  onUpload,
  onBlur,
  disabled = false,
  placeholder = "https://…",
  kind = "image",
  problemFocus = false,
  labels,
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (url: string) => void;
  onUpload?: (file: File) => Promise<void>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  disabled?: boolean;
  placeholder?: string;
  kind?: "image" | "video";
  /** Preferred focus target when the sticky problem rail jumps to this row. */
  problemFocus?: boolean;
  /** Optional localized copy for admin builder surfaces. */
  labels?: Partial<ImageUrlInputLabels>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVideo = kind === "video";
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const copy = { ...DEFAULT_LABELS[kind], ...labels };

  async function handleFile(file: File | undefined) {
    if (!file || disabled || uploading) return;
    setError(null);
    const contentType = resolveUploadType(file.name, file.type, kind);
    if (!contentType) {
      setError(copy.invalidType);
      return;
    }
    if (file.size > maxBytes) {
      setError(copy.tooLarge);
      return;
    }
    setUploading(true);
    try {
      if (onUpload) {
        await onUpload(file);
      } else {
        const { adminApi } = await import("@/lib/admin-api");
        const res = await adminApi.uploadImage(file, contentType);
        onChange(res.url);
      }
    } catch {
      setError(copy.uploadFailed);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {value ? (
          isVideo ? (
            <video
              src={value}
              muted
              playsInline
              preload="metadata"
              className="h-9 w-9 shrink-0 rounded-lg border border-border bg-black object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only external R2/URL thumbs; no optimizer domain allowlist.
            <img
              src={value}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
              referrerPolicy="no-referrer"
            />
          )
        ) : null}
        <input
          id={id}
          aria-label={ariaLabel}
          data-problem-focus={problemFocus || undefined}
          className={`${inputClsCompact} min-w-0 flex-1`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            // A failed file pick must leave no stale alert once the operator pastes a URL.
            setError(null);
            onChange(e.target.value);
          }}
          onBlur={onBlur}
          disabled={disabled || uploading}
          autoComplete="off"
        />
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted disabled:border-border"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? copy.uploading : copy.upload}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTRS[kind]}
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>
      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
