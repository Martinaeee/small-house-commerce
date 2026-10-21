"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { ShellAssetRef } from "@/lib/storefront-shell-document";
import type { AdminShellAsset } from "@/lib/storefront-shell-api";

export const BRAND_UPLOAD_ACCEPT = ".png,.webp,.jpg,.jpeg";

export type BrandAssetFieldProps = {
  labelKey: TKey;
  hintKey?: TKey;
  assetRef: ShellAssetRef;
  /** Server-projected metadata for the referenced asset, when it exists. */
  asset?: AdminShellAsset;
  onAssetRefChange: (assetRef: ShellAssetRef) => void;
  onUpload: (file: File) => Promise<AdminShellAsset>;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
  fallback?: ReactNode;
};

/**
 * One brand slot (horizontal logo or square mark), laid out as a single
 * full-width row: thumbnail, purpose copy and one-line actions. The field owns
 * the hidden input, the selected filename, the retry error and the local
 * preview object URL; the parent owns the pending lock and the document
 * reference. The input is cleared only after a success or an explicit remove so
 * a failed upload keeps the file the operator chose.
 */
export function BrandAssetField({
  labelKey,
  hintKey,
  assetRef,
  asset,
  onAssetRefChange,
  onUpload,
  onPendingChange,
  disabled = false,
  fallback,
}: BrandAssetFieldProps): ReactNode {
  const { t } = useAdminI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const releaseObjectUrl = () => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      releaseObjectUrl();
    };
  }, []);

  const runUpload = async (file: File) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setFailure(null);
    onPendingChange?.(true);
    try {
      const uploaded = await onUpload(file);
      if (!mountedRef.current || generationRef.current !== generation) return;
      onAssetRefChange({ assetId: uploaded.id });
      setPendingFile(null);
      setPreviewUrl(null);
      releaseObjectUrl();
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (mountedRef.current && generationRef.current === generation) {
        onPendingChange?.(false);
      }
    }
  };

  const onSelect = (file: File | null) => {
    if (!file) return;
    releaseObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setPendingFile(file);
    void runUpload(file);
  };

  const remove = () => {
    generationRef.current += 1;
    releaseObjectUrl();
    setPendingFile(null);
    setPreviewUrl(null);
    setFailure(null);
    if (inputRef.current) inputRef.current.value = "";
    onAssetRefChange(null);
  };

  const shownUrl = previewUrl ?? asset?.url ?? null;

  return (
    <fieldset className="min-w-0 rounded-xl border border-admin-border bg-admin-surface p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t(labelKey)}
      </legend>

      <div className="mt-3 flex min-w-0 flex-wrap items-start gap-4">
        <div className="flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-admin-border bg-admin-canvas px-2">
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only draft preview of a local object URL or the server-projected brand asset; not a storefront LCP image.
            <img
              src={shownUrl}
              alt=""
              className="max-h-16 max-w-32 object-contain"
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-ink-muted">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m5 16 4.5-4.5 3 3L16 11l3 3" />
                <circle cx="9" cy="9.5" r="1" />
              </svg>
              {t("storefront_shell_brand_no_asset")}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 basis-56">
          {hintKey ? (
            <p className="text-xs text-ink-secondary">{t(hintKey)}</p>
          ) : null}

          {asset ? (
            <p className="mt-1 text-xs text-ink-secondary">
              {t("storefront_shell_brand_asset_meta", {
                width: asset.width,
                height: asset.height,
                mime: asset.mimeType,
              })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">
              {t("storefront_shell_brand_empty_hint")}
            </p>
          )}

          {pendingFile && previewUrl ? (
            <p className="mt-1 truncate text-xs text-ink-muted">
              {pendingFile.name}
            </p>
          ) : null}

          {failure ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p role="alert" className="text-xs text-admin-error">
                {failure}
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (pendingFile) void runUpload(pendingFile);
                }}
                className="rounded-lg border border-admin-border px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-ink"
              >
                {t("storefront_shell_brand_retry")}
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-admin-primary px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-admin-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assetRef !== null
                ? t("storefront_shell_brand_replace")
                : t("storefront_shell_brand_choose")}
            </button>
            {assetRef !== null ? (
              <button
                type="button"
                disabled={disabled}
                onClick={remove}
                className="rounded-lg border border-admin-error px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-admin-error disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("storefront_shell_brand_remove")}
              </button>
            ) : null}
          </div>

          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={BRAND_UPLOAD_ACCEPT}
            aria-label={t(labelKey)}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
            className="sr-only"
          />

          {fallback}
        </div>
      </div>
    </fieldset>
  );
}
