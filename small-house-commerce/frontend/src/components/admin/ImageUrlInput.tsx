"use client";

import { useRef, useState } from "react";
import { inputCls } from "./Field";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

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

const ACCEPT_ATTRS = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/webm,video/quicktime",
} as const;

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
  disabled = false,
  placeholder = "https://…",
  kind = "image",
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  placeholder?: string;
  kind?: "image" | "video";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVideo = kind === "video";
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const typeLabel = isVideo ? "MP4 / WebM / MOV 视频" : "JPG / PNG / WebP 图片";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!(file.type in ACCEPTED_TYPES[kind])) {
      setError(`仅支持 ${typeLabel}`);
      return;
    }
    if (file.size > maxBytes) {
      setError(isVideo ? "视频不能超过 100MB" : "图片不能超过 5MB");
      return;
    }
    setUploading(true);
    try {
      // Lazy import keeps the admin API module out of any non-upload bundle path.
      const { adminApi } = await import("@/lib/admin-api");
      const res = await adminApi.uploadImage(file);
      onChange(res.url);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "上传失败，请重试");
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
              className="h-11 w-11 shrink-0 rounded-lg border border-border bg-black object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only external R2/URL thumbs; no optimizer domain allowlist.
            <img
              src={value}
              alt=""
              className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover"
              referrerPolicy="no-referrer"
            />
          )
        ) : null}
        <input
          id={id}
          aria-label={ariaLabel}
          className={`${inputCls} min-w-0 flex-1`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            // A failed file pick must leave no stale alert once the operator pastes a URL.
            setError(null);
            onChange(e.target.value);
          }}
          disabled={disabled || uploading}
          autoComplete="off"
        />
        <button
          type="button"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted disabled:border-border"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? "上传中…" : isVideo ? "上传视频" : "上传图片"}
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
