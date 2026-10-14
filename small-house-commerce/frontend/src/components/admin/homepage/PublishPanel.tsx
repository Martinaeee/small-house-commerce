"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Field, TextInput } from "@/components/admin/Field";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { ANNOUNCEMENT_SELECTION_ID } from "@/components/admin/homepage/ModuleTree";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { errorStatus } from "@/lib/admin-auth";
import { adminApi, type PublishIssue } from "@/lib/admin-api";

/**
 * Publish workflow panel, rendered inside the shell's publish dialog (Task 17).
 *
 * Flow on mount: persist a dirty draft through the editor's own save path
 * (`save` prop) → `validateHomepage()` → render the issues. A failed save
 * aborts the flow with a readable error and keeps the dialog open. Publish
 * blocks on ERRORs; WARNINGs require one explicit confirmation click (the
 * button copy turns into the confirm copy, then the next click publishes with
 * `confirmWarnings`). A 422 never parses `AdminApiError.details` (Ruling 42) —
 * validation is re-run and the fresh issues are rendered in place.
 */

type ValidationResult = { errors: PublishIssue[]; warnings: PublishIssue[] };

type PanelError =
  | { kind: "save_failed" }
  | { kind: "invalid_date" }
  | { kind: "unpublish_before" }
  | { kind: "generic"; message: string };

/**
 * `datetime-local` yields local wall-clock ("YYYY-MM-DDTHH:mm"); the publish
 * API requires an offset ISO string (Task 11 carry). Empty input maps to null
 * ("immediate", Ruling 43); unparseable input maps to the "invalid" sentinel
 * so callers can block submission with a readable message.
 */
export function datetimeLocalToIso(value: string): string | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "invalid";
  return parsed.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PublishPanel({
  onClose,
  save,
  onPublished,
}: {
  /** Closes the shell's publish dialog (jump-to-issue and cancel). */
  onClose: () => void;
  /**
   * The editor's save path: persists the draft when dirty and resolves to
   * whether the server now holds the latest document.
   */
  save: () => Promise<boolean>;
  onPublished?: (result: { versionNo: number; publishAt: string }) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    setSelectedSectionId,
    setSelectedSlideId,
    setSelectedElementKey,
  } = useHomepageEditor();

  const [checking, setChecking] = useState(true);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [confirmedWarnings, setConfirmedWarnings] = useState(false);
  const [noteOverride, setNoteOverride] = useState<string | null>(null);
  const [publishAtInput, setPublishAtInput] = useState("");
  const [unpublishAtInput, setUnpublishAtInput] = useState("");
  const [error, setError] = useState<PanelError | null>(null);
  const [rejected, setRejected] = useState(false);
  const [success, setSuccess] = useState<{
    versionNo: number;
    publishAt: string;
  } | null>(null);
  const [pending, setPending] = useState(false);

  // Auto summary ("Hero: N slides; Announcement: M items"), editable through
  // the note input; the input keeps whatever the operator typed, including "".
  const noteDefault = useMemo(() => {
    const doc = state.document;
    const hero = doc.sections.find((section) => section.type === "HERO");
    const slides =
      hero && hero.type === "HERO" ? hero.payload.slides.length : 0;
    return t("homepage_builder_publish_note_default", {
      slides,
      items: doc.announcement.items.length,
    });
  }, [state.document, t]);
  const note = noteOverride ?? noteDefault;

  // Save first, then validate. The save runs through the editor's save path,
  // so a 409/error surfaces exactly like a manual save; the flow aborts here.
  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await save();
      if (!active) return;
      if (!saved) {
        setError({ kind: "save_failed" });
        setChecking(false);
        return;
      }
      try {
        const result = await adminApi.validateHomepage();
        if (!active) return;
        setValidation(result);
      } catch (err: unknown) {
        if (!active) return;
        setError({ kind: "generic", message: errorMessage(err) });
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [save]);

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const blocked = errors.length > 0;
  const warningsUnconfirmed = warnings.length > 0 && !confirmedWarnings;
  // A failed pre-publish save aborted the flow before validation, so the
  // server draft may not match what the operator sees: no publishing from here.
  const saveFailed = error?.kind === "save_failed";

  const errorText = useMemo((): string | null => {
    if (!error) return null;
    switch (error.kind) {
      case "save_failed":
        return t("homepage_builder_publish_save_failed");
      case "invalid_date":
        return t("homepage_builder_publish_invalid_date");
      case "unpublish_before":
        return t("homepage_builder_publish_unpublish_before");
      case "generic":
        return t("homepage_builder_error_generic", { message: error.message });
    }
  }, [error, t]);

  const jumpToIssue = useCallback(
    (issue: PublishIssue): void => {
      setSelectedElementKey(null);
      if (issue.announcementItemId) {
        setSelectedSectionId(ANNOUNCEMENT_SELECTION_ID);
        setSelectedSlideId(null);
      } else {
        if (issue.sectionId) setSelectedSectionId(issue.sectionId);
        if (issue.slideId) setSelectedSlideId(issue.slideId);
      }
      onClose();
      if (issue.announcementItemId) {
        const itemId = issue.announcementItemId;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const target = document.querySelector(
              `[data-item-id="${itemId}"]`,
            );
            target?.scrollIntoView({ block: "center", behavior: "smooth" });
          }),
        );
      }
    },
    [onClose, setSelectedElementKey, setSelectedSectionId, setSelectedSlideId],
  );

  const handlePublish = useCallback(async (): Promise<void> => {
    setError(null);
    setRejected(false);
    if (checking || pending || blocked) return;
    if (error?.kind === "save_failed") return;

    const publishAt = datetimeLocalToIso(publishAtInput);
    if (publishAt === "invalid") {
      setError({ kind: "invalid_date" });
      return;
    }
    const unpublishAt = datetimeLocalToIso(unpublishAtInput);
    if (unpublishAt === "invalid") {
      setError({ kind: "invalid_date" });
      return;
    }
    if (
      publishAt !== null &&
      unpublishAt !== null &&
      new Date(unpublishAt) <= new Date(publishAt)
    ) {
      setError({ kind: "unpublish_before" });
      return;
    }

    if (warningsUnconfirmed) {
      // Explicit risk confirmation: this click only acknowledges the warnings;
      // the button re-arms as the plain publish action for the next click.
      setConfirmedWarnings(true);
      return;
    }

    setPending(true);
    try {
      const result = await adminApi.publishHomepage({
        note: note.trim() === "" ? null : note.trim(),
        publishAt,
        unpublishAt,
        confirmWarnings: confirmedWarnings,
      });
      setSuccess(result);
      setValidation(null);
      setConfirmedWarnings(false);
      setNoteOverride(null);
      setPublishAtInput("");
      setUnpublishAtInput("");
      onPublished?.(result);
    } catch (err: unknown) {
      if (errorStatus(err) === 422) {
        // Ruling 42: AdminApiError.details does not expose the issues — re-run
        // the server check and render the returned issues without closing.
        setRejected(true);
        setConfirmedWarnings(false);
        try {
          const fresh = await adminApi.validateHomepage();
          setValidation(fresh);
        } catch {
          // Keep the previous results; the banner still explains the rejection.
        }
      } else {
        setError({ kind: "generic", message: errorMessage(err) });
      }
    } finally {
      setPending(false);
    }
  }, [
    blocked,
    checking,
    confirmedWarnings,
    error,
    note,
    onPublished,
    pending,
    publishAtInput,
    unpublishAtInput,
    warningsUnconfirmed,
  ]);

  function issueRow(issue: PublishIssue): ReactNode {
    const jumpable = Boolean(
      issue.sectionId || issue.slideId || issue.announcementItemId,
    );
    return (
      <li
        key={`${issue.severity}-${issue.code}-${issue.sectionId ?? ""}-${
          issue.slideId ?? ""
        }-${issue.announcementItemId ?? ""}`}
        data-issue-code={issue.code}
        className="flex items-start gap-2"
      >
        <span className="flex-1 text-sm text-ink">{issue.message}</span>
        {jumpable ? (
          <button
            type="button"
            onClick={() => jumpToIssue(issue)}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40"
          >
            {t(
              issue.announcementItemId
                ? "homepage_builder_validation_jump_announcement"
                : "homepage_builder_validation_jump",
            )}
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <div
      data-panel="publish-panel"
      className="flex min-h-[200px] flex-col gap-4"
    >
      {checking ? (
        <p className="text-sm text-ink-secondary">
          {t("homepage_builder_publish_checking")}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
        >
          {errorText}
        </p>
      ) : null}

      {rejected ? (
        <p
          role="alert"
          className="rounded-lg border border-sale/40 bg-sale/5 p-3 text-sm text-red-700"
        >
          {t("homepage_builder_publish_rejected")}
        </p>
      ) : null}

      {success ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-admin-success-soft p-3 text-sm font-medium text-admin-success"
        >
          {t("homepage_builder_publish_success", {
            versionNo: success.versionNo,
          })}{" "}
          {formatTimestamp(success.publishAt)}
        </p>
      ) : null}

      {validation && (errors.length > 0 || warnings.length > 0) ? (
        <section
          aria-label={t("homepage_builder_validation_title")}
          className="flex flex-col gap-3"
        >
          <h3 className="text-sm font-semibold text-ink">
            {t("homepage_builder_validation_title")}
          </h3>

          {errors.length > 0 ? (
            <div className="rounded-lg border border-sale/40 bg-sale/5 p-3">
              <p className="text-sm font-semibold text-admin-error">
                {t("homepage_builder_validation_errors", {
                  count: errors.length,
                })}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {errors.map(issueRow)}
              </ul>
              <p
                role="alert"
                className="mt-2 text-xs font-medium text-admin-error"
              >
                {t("homepage_builder_validation_blocked", {
                  count: errors.length,
                })}
              </p>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-lg border border-admin-warning/40 bg-admin-warning-soft p-3">
              <p className="text-sm font-semibold text-admin-warning">
                {t("homepage_builder_validation_warnings", {
                  count: warnings.length,
                })}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {warnings.map(issueRow)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <Field label={t("homepage_builder_publish_note")}>
        <TextInput
          value={note}
          onChange={(event) => setNoteOverride(event.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("homepage_builder_publish_at")}>
          <TextInput
            type="datetime-local"
            value={publishAtInput}
            onChange={(event) => setPublishAtInput(event.target.value)}
          />
        </Field>
        <Field label={t("homepage_builder_publish_unpublish_at")}>
          <TextInput
            type="datetime-local"
            value={unpublishAtInput}
            onChange={(event) => setUnpublishAtInput(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/admin/homepage/versions"
          className="mr-auto text-sm font-semibold text-cta hover:underline"
        >
          {t("homepage_builder_versions")}
        </Link>
        <Button variant="secondary" size="md" onClick={onClose}>
          {t("common_cancel")}
        </Button>
        <Button
          size="md"
          disabled={checking || pending || blocked || saveFailed}
          onClick={() => void handlePublish()}
        >
          {warningsUnconfirmed
            ? t("homepage_builder_publish_confirm_warnings")
            : t("homepage_builder_publish")}
        </Button>
      </div>
    </div>
  );
}
