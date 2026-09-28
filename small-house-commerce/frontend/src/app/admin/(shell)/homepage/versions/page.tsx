"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { HeroSlider } from "@/components/admin/homepage/HeroCanvas";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { adminApi, type HomepageVersionMeta } from "@/lib/admin-api";
import { heroCss, safeHex } from "@/lib/homepage-styles";
import type {
  HomepageDocument,
  HomepageSection,
} from "@/lib/homepage-document";

/**
 * Homepage version history (Task 17): list / read-only preview / restore /
 * unpublish. RBAC-gated on PRODUCT_MANAGE with a readable permission notice
 * (Ruling 44/⑦ — not a generic load error). The preview renders the version
 * document in place (Ruling 41): HERO through the read-only `HeroSlider` from
 * HeroCanvas (no `edit` prop — no storefront imports), ANNOUNCEMENT as a
 * minimal read-only bar, every other section type as a labelled summary row.
 * `getHomepageVersion` returns `document: unknown`, so a defensive shape check
 * (Ruling 45) guards the render: an unexpected shape yields a readable error
 * state instead of a crash.
 */

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

const STATUS_LABEL: Record<HomepageVersionMeta["status"], TKey> = {
  LIVE: "homepage_builder_version_status_LIVE",
  SCHEDULED: "homepage_builder_version_status_SCHEDULED",
  ENDED: "homepage_builder_version_status_ENDED",
  SUPERSEDED: "homepage_builder_version_status_SUPERSEDED",
};

const STATUS_TONE: Record<HomepageVersionMeta["status"], BadgeTone> = {
  LIVE: "green",
  SCHEDULED: "amber",
  ENDED: "neutral",
  SUPERSEDED: "neutral",
};

const HERO_ELEMENT_KEYS = [
  "eyebrow",
  "heading",
  "subheading",
  "offer",
  "ctaPrimary",
  "ctaSecondary",
  "countdown",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

/** Ruling 45: everything the preview touches must survive a runtime check. */
function isRenderableSlide(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  const elements = value.elements;
  if (!isRecord(elements)) return false;
  return HERO_ELEMENT_KEYS.every((key) => {
    const element = elements[key];
    return isRecord(element) && typeof element.text === "string";
  });
}

function isRenderableSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string") {
    return false;
  }
  if (typeof value.enabled !== "boolean") return false;
  if (!isOptionalString(value.title) || !isOptionalString(value.subtitle)) {
    return false;
  }
  const schedule = value.schedule;
  if (
    schedule !== undefined &&
    (!isRecord(schedule) ||
      !isOptionalString(schedule.publishAt) ||
      !isOptionalString(schedule.unpublishAt))
  ) {
    return false;
  }
  if (value.type === "HERO") {
    const payload = value.payload;
    if (!isRecord(payload) || !Array.isArray(payload.slides)) return false;
    return payload.slides.every(isRenderableSlide);
  }
  return true;
}

function isRenderableAnnouncementItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.text !== "string") {
    return false;
  }
  if (typeof value.enabled !== "boolean") return false;
  return isOptionalString(value.linkLabel);
}

function isRenderableDocument(value: unknown): value is HomepageDocument {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!Array.isArray(value.sections)) return false;
  if (!value.sections.every(isRenderableSection)) return false;
  const announcement = value.announcement;
  if (!isRecord(announcement)) return false;
  if (!Array.isArray(announcement.items)) return false;
  return announcement.items.every(isRenderableAnnouncementItem);
}

function colorOr(value: unknown, fallback: string): string {
  return safeHex(typeof value === "string" ? value : null, fallback);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatScheduleRange(schedule: {
  publishAt?: string | null;
  unpublishAt?: string | null;
}): string {
  return `${formatTimestamp(schedule.publishAt ?? null)} → ${formatTimestamp(
    schedule.unpublishAt ?? null,
  )}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PreviewState =
  | { kind: "loading"; row: HomepageVersionMeta }
  | { kind: "ready"; row: HomepageVersionMeta; document: HomepageDocument }
  | { kind: "invalid"; row: HomepageVersionMeta }
  | { kind: "error"; row: HomepageVersionMeta; message: string };

type PendingAction = {
  kind: "restore" | "unpublish";
  row: HomepageVersionMeta;
};

/** Read-only version render (Ruling 41) — no edit affordances anywhere. */
function VersionDocumentPreview({
  doc,
}: {
  doc: HomepageDocument;
}): ReactNode {
  const { t } = useAdminI18n();
  const hero =
    doc.sections.find(
      (section): section is HeroSection => section.type === "HERO",
    ) ?? null;
  const others = doc.sections.filter((section) => section.type !== "HERO");
  const items = doc.announcement.items.filter((item) => item.enabled);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {t("homepage_builder_version_preview_note")}
      </p>

      {hero ? (
        <div
          data-version-hero
          className="relative h-[420px] overflow-hidden rounded-lg"
        >
          <style>{heroCss(hero.id, hero.payload)}</style>
          <HeroSlider section={hero} />
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          data-version-announcement
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
        >
          <span className="text-xs font-semibold text-ink-secondary">
            {t("homepage_builder_announcement_title")}
          </span>
          {items.map((item) => (
            <span
              key={item.id}
              className="rounded px-2 py-1 text-xs"
              style={{
                background: colorOr(item.backgroundColor, "#E8EEF4"),
                color: colorOr(item.textColor, "#1F2937"),
              }}
            >
              {item.text}
              {item.linkLabel ? ` · ${item.linkLabel}` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {others.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {others.map((section) => (
            <li
              key={section.id}
              data-version-summary={section.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm"
            >
              <span className="rounded bg-admin-neutral-soft px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                {section.type}
              </span>
              <span className="font-medium text-ink">{section.title ?? "—"}</span>
              {section.subtitle ? (
                <span className="text-ink-secondary">{section.subtitle}</span>
              ) : null}
              <Badge
                value={
                  section.enabled
                    ? t("homepage_builder_status_enabled")
                    : t("homepage_builder_status_disabled")
                }
                tone={section.enabled ? "green" : "neutral"}
              />
              {section.schedule?.publishAt || section.schedule?.unpublishAt ? (
                <span className="text-xs text-ink-muted">
                  {t("homepage_builder_version_schedule")}:{" "}
                  {formatScheduleRange(section.schedule)}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-ink-muted">
                {t("homepage_builder_version_summary_only")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function HomepageVersionsPage(): ReactNode {
  const { t } = useAdminI18n();
  const { status, hasPermission } = useAdminAuth();
  const allowed = status === "authed" && hasPermission("PRODUCT_MANAGE");

  const [rows, setRows] = useState<HomepageVersionMeta[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [fetchedNonce, setFetchedNonce] = useState<number | null>(null);
  const loading = fetchedNonce !== nonce;

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    adminApi
      .listHomepageVersions()
      .then((result) => {
        if (!active) return;
        setRows(result);
        setLoadFailed(false);
        setFetchedNonce(nonce);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
        setFetchedNonce(nonce);
      });
    return () => {
      active = false;
    };
  }, [allowed, nonce]);

  const refresh = useCallback(() => setNonce((current) => current + 1), []);

  async function openPreview(row: HomepageVersionMeta): Promise<void> {
    setPreview({ kind: "loading", row });
    try {
      const result = await adminApi.getHomepageVersion(row.id);
      if (isRenderableDocument(result.document)) {
        setPreview({ kind: "ready", row: result, document: result.document });
      } else {
        setPreview({ kind: "invalid", row: result });
      }
    } catch (error: unknown) {
      setPreview({ kind: "error", row, message: errorMessage(error) });
    }
  }

  function requestAction(
    kind: PendingAction["kind"],
    row: HomepageVersionMeta,
  ): void {
    setActionError(null);
    setPendingAction({ kind, row });
  }

  async function confirmAction(): Promise<void> {
    if (!pendingAction) return;
    setActionPending(true);
    setActionError(null);
    try {
      if (pendingAction.kind === "restore") {
        // Restore only writes the draft; publishing stays a separate action.
        await adminApi.restoreHomepageVersion(pendingAction.row.id);
        setRestoreSuccess(true);
      } else {
        await adminApi.unpublishHomepageVersion(pendingAction.row.id);
        refresh();
      }
      setPendingAction(null);
    } catch (error: unknown) {
      setActionError(errorMessage(error));
    } finally {
      setActionPending(false);
    }
  }

  const header = (
    <PageHeader title={t("homepage_builder_versions")} />
  );

  if (status !== "authed") {
    return (
      <div>
        {header}
        <div className="mt-4">
          <TableSkeleton rows={6} cols={6} />
        </div>
      </div>
    );
  }

  if (!hasPermission("PRODUCT_MANAGE")) {
    return (
      <div>
        {header}
        <div className="mt-4">
          <EmptyState
            title={t("homepage_builder_permission_denied")}
            hint={t("homepage_builder_permission_denied_hint")}
          />
        </div>
      </div>
    );
  }

  const confirmTitle =
    pendingAction === null
      ? ""
      : pendingAction.kind === "restore"
        ? t("homepage_builder_version_restore")
        : t("homepage_builder_version_unpublish");

  return (
    <div>
      {header}

      {restoreSuccess ? (
        <p
          role="status"
          className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-admin-success-soft p-3 text-sm font-medium text-admin-success"
        >
          {t("homepage_builder_version_restore_success")}
          <Link
            href="/admin/homepage"
            className="text-cta underline underline-offset-4"
          >
            {t("homepage_builder_version_restore_go_editor")}
          </Link>
        </p>
      ) : null}

      <div className="mt-4">
        {loadFailed ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm font-semibold text-ink">
              {t("homepage_builder_versions_load_error")}
            </p>
            <Button
              variant="secondary"
              size="md"
              className="mt-4"
              onClick={refresh}
            >
              {t("common_retry")}
            </Button>
          </div>
        ) : rows === null || loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("homepage_builder_versions_empty")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_version_number")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_version_time")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_version_created_by")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_version_note")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_version_status")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("homepage_builder_actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-version-row={row.id}
                    className="border-b border-border align-middle last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {t("homepage_builder_version_label", {
                        versionNo: row.versionNo,
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                      {formatTimestamp(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.createdById ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.note ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        value={t(STATUS_LABEL[row.status])}
                        tone={STATUS_TONE[row.status]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40"
                          onClick={() => void openPreview(row)}
                        >
                          {t("homepage_builder_version_preview")}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40"
                          onClick={() => requestAction("restore", row)}
                        >
                          {t("homepage_builder_version_restore")}
                        </button>
                        {row.status === "LIVE" || row.status === "SCHEDULED" ? (
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-xs font-semibold text-sale hover:bg-sale/5"
                            onClick={() => requestAction("unpublish", row)}
                          >
                            {t("homepage_builder_version_unpublish")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm dialog for restore / unpublish */}
      <Dialog
        open={pendingAction !== null}
        onClose={() => {
          if (actionPending) return;
          setPendingAction(null);
          setActionError(null);
        }}
        title={confirmTitle}
      >
        {pendingAction ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-secondary">
              {pendingAction.kind === "restore"
                ? t("homepage_builder_version_restore_confirm")
                : t("homepage_builder_version_unpublish_confirm")}
            </p>
            {actionError ? (
              <p
                role="alert"
                className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
              >
                {t("homepage_builder_error_generic", { message: actionError })}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                disabled={actionPending}
                onClick={() => {
                  setPendingAction(null);
                  setActionError(null);
                }}
              >
                {t("common_cancel")}
              </Button>
              <Button
                size="md"
                disabled={actionPending}
                onClick={() => void confirmAction()}
              >
                {t("common_confirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Read-only version preview dialog */}
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={t("homepage_builder_version_preview_title")}
        width="lg"
      >
        {preview?.kind === "loading" ? (
          <p className="text-sm text-ink-secondary">
            {t("homepage_builder_version_preview_loading")}
          </p>
        ) : null}
        {preview?.kind === "error" ? (
          <p
            role="alert"
            className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
          >
            {t("homepage_builder_error_generic", { message: preview.message })}
          </p>
        ) : null}
        {preview?.kind === "invalid" ? (
          <p
            role="alert"
            className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
          >
            {t("homepage_builder_version_preview_invalid")}
          </p>
        ) : null}
        {preview?.kind === "ready" ? (
          <VersionDocumentPreview doc={preview.document} />
        ) : null}
      </Dialog>
    </div>
  );
}
