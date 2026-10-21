"use client";

import { useEffect, useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";

export type StorefrontShellFailure = {
  operation: "load" | "save" | "validate" | "publish" | "upload";
  message: string;
};

export type StorefrontShellPublishBarProps = {
  version: number | null;
  unsaved: boolean;
  hasUnpublishedChanges: boolean;
  pendingUploads: ReadonlySet<"horizontal" | "square">;
  saving: boolean;
  validating: boolean;
  publishing: boolean;
  publishedRevision: number;
  publishedAt: string | null;
  updatedAt: string | null;
  conflict: { currentVersion?: number } | null;
  failure: StorefrontShellFailure | null;
  onSave: () => void;
  onPublish: () => void;
  onReload: () => void;
  onRetry: () => void;
  onRestoreDefaults: () => void;
};

/** Display-only local timestamp; the ISO value stays the source of truth. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function StorefrontShellPublishBar({
  version,
  unsaved,
  hasUnpublishedChanges,
  pendingUploads,
  saving,
  validating,
  publishing,
  publishedRevision,
  publishedAt,
  updatedAt,
  conflict,
  failure,
  onSave,
  onPublish,
  onReload,
  onRetry,
  onRestoreDefaults,
}: StorefrontShellPublishBarProps) {
  const { t } = useAdminI18n();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const uploading = pendingUploads.size > 0;
  const status = uploading
    ? "storefront_shell_status_uploading"
    : saving
      ? "storefront_shell_status_saving"
      : publishing
        ? "storefront_shell_status_publishing"
        : validating
          ? "storefront_shell_status_validating"
          : unsaved
            ? "storefront_shell_status_unsaved"
            : hasUnpublishedChanges
              ? "storefront_shell_status_pending_publish"
              : "storefront_shell_status_published";
  const busy = uploading || saving || publishing;
  const saveDisabled = !unsaved || saving || publishing || uploading;
  const publishDisabled =
    unsaved ||
    !hasUnpublishedChanges ||
    saving ||
    publishing ||
    uploading ||
    version === null;
  const statusTone =
    uploading || saving || publishing || validating
      ? "bg-admin-primary"
      : unsaved
        ? "bg-admin-warning"
        : hasUnpublishedChanges
          ? "bg-admin-primary"
          : "bg-admin-success";

  useEffect(() => {
    if (!restoreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRestoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [restoreOpen]);

  return (
    <div
      data-testid="storefront-shell-publish-bar"
      className="sticky top-14 z-20 border-b border-admin-border bg-admin-surface px-4 py-3 shadow-sm sm:px-6"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${statusTone}`}
            />
            <span className="min-w-0">{t(status)}</span>
          </p>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-4 text-xs text-ink-secondary">
            <span data-testid="shell-published-revision">
              {publishedRevision > 0
                ? `${t("storefront_shell_published_revision", {
                    revision: publishedRevision,
                  })}${publishedAt !== null ? ` · ${formatTime(publishedAt)}` : ""}`
                : t("storefront_shell_never_published")}
            </span>
            {version !== null ? (
              <span data-testid="shell-version">
                {t("storefront_shell_version")} {version}
              </span>
            ) : null}
            {updatedAt !== null ? (
              <span data-testid="shell-last-saved">
                {t("storefront_shell_last_saved", {
                  time: formatTime(updatedAt),
                })}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setRestoreOpen(true)}
            className="rounded-lg border border-admin-border px-3 py-2 text-sm font-medium whitespace-nowrap text-ink hover:bg-admin-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("storefront_shell_restore_defaults")}
          </button>
          <button
            type="button"
            disabled={saveDisabled}
            onClick={onSave}
            className="rounded-lg border border-admin-primary px-4 py-2 text-sm font-semibold whitespace-nowrap text-admin-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("storefront_shell_saving") : t("storefront_shell_save")}
          </button>
          <button
            type="button"
            disabled={publishDisabled}
            onClick={onPublish}
            className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold whitespace-nowrap text-white hover:bg-admin-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {publishing
              ? t("storefront_shell_publishing")
              : t("storefront_shell_publish")}
          </button>
        </div>
      </div>

      {restoreOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setRestoreOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="storefront-shell-restore-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-admin-border bg-admin-surface p-5 shadow-xl"
          >
            <h2
              id="storefront-shell-restore-title"
              className="text-base font-semibold text-ink"
            >
              {t("storefront_shell_restore_dialog_title")}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {t("storefront_shell_restore_dialog_body")}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setRestoreOpen(false)}
                className="rounded-lg border border-admin-border px-4 py-2 text-sm font-medium whitespace-nowrap text-ink hover:bg-admin-surface-secondary"
              >
                {t("storefront_shell_restore_dialog_cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRestoreOpen(false);
                  onRestoreDefaults();
                }}
                className="rounded-lg bg-admin-error px-4 py-2 text-sm font-semibold whitespace-nowrap text-white"
              >
                {t("storefront_shell_restore_dialog_confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="mx-auto mt-3 flex max-w-[1600px] items-center justify-between gap-3 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-sm text-ink"
        >
          <span>{t("storefront_shell_conflict")}</span>
          <button
            type="button"
            onClick={onReload}
            className="font-semibold text-admin-primary underline"
          >
            {t("storefront_shell_reload")}
          </button>
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="mx-auto mt-3 flex max-w-[1600px] items-center justify-between gap-3 rounded-lg border border-admin-error bg-admin-error-soft px-3 py-2 text-sm text-admin-error"
        >
          <span>{failure.message}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">
            {t("storefront_shell_retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
