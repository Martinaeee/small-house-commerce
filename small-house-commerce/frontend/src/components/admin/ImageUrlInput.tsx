"use client";

import { useRef, useState } from "react";
import { inputCls } from "./Field";

const MAX_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Image field for admin forms: paste a public URL, or pick a local file and
 * POST the bytes to the backend, which stores them on the upload volume and
 * returns the site-relative /uploads/… URL. No third-party storage required.
 */
export function ImageUrlInput({
  id,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  placeholder = "https://…",
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const ext = ACCEPTED_TYPES[file.type];
    if (!ext) {
      setError("仅支持 JPG / PNG / WebP 图片");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("图片不能超过 5MB");
      return;
    }
    setUploading(true);
    try {
      // Lazy import keeps the admin API module out of any non-upload bundle path.
      const { adminApi } = await import("@/lib/admin-api");
      const res = await adminApi.uploadImage(file);
      onChange(res.url);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "图片上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only external R2/URL thumbs; no optimizer domain allowlist.
          <img
            src={value}
            alt=""
            className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover"
            referrerPolicy="no-referrer"
          />
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
          {uploading ? "上传中…" : "上传图片"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
