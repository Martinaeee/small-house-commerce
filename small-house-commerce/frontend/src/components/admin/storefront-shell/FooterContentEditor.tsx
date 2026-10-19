"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { newId } from "@/lib/admin-id";
import {
  SHELL_LIMITS,
  type FooterColumn,
  type FooterRow,
  type ShellIssue,
} from "@/lib/storefront-shell-document";
import { OrderedRows, type RowControls } from "./OrderedRows";
import { ShellLinkEditor } from "./ShellLinkEditor";

export type FooterDraft = {
  tagline: string;
  description: string;
  columns: FooterColumn[];
  copyrightBrand: string;
};

export type FooterContentEditorProps = {
  tagline: string;
  description: string;
  columns: readonly FooterColumn[];
  copyrightBrand: string;
  pendingUploads: ReadonlySet<"horizontal" | "square">;
  issues?: readonly ShellIssue[];
  onChange: (next: FooterDraft) => void;
};

const SUPPORT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyLinksColumn(id: string): FooterColumn {
  return {
    id,
    kind: "LINKS",
    title: "Links",
    rows: [
      {
        id: newId(),
        kind: "LINK",
        label: "New link",
        link: { type: "INTERNAL", path: "/" },
      },
    ],
  };
}

function rowFor(kind: FooterRow["kind"], previous: FooterRow): FooterRow {
  if (previous.kind === kind) return previous;
  if (kind === "TEXT") {
    return {
      id: previous.id,
      kind: "TEXT",
      text: previous.kind === "LINK" ? previous.label : previous.text,
    };
  }
  return {
    id: previous.id,
    kind: "LINK",
    label: previous.kind === "TEXT" ? previous.text : previous.label,
    link: { type: "INTERNAL", path: "/" },
  };
}

export function FooterContentEditor({
  tagline,
  description,
  columns,
  copyrightBrand,
  pendingUploads,
  issues = [],
  onChange,
}: FooterContentEditorProps): ReactNode {
  const { t } = useAdminI18n();
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const locked = pendingUploads.size > 0;
  const atColumnLimit = columns.length >= SHELL_LIMITS.maxFooterColumns;

  const emit = (patch: Partial<FooterDraft>) =>
    onChange({ tagline, description, columns: [...columns], copyrightBrand, ...patch });

  const updateColumn = (
    id: string,
    update: (column: FooterColumn) => FooterColumn,
  ) =>
    emit({
      columns: columns.map((column) =>
        column.id === id ? update(column) : column,
      ),
    });

  const moveColumn = (from: number, to: number) => {
    if (locked || to < 0 || to >= columns.length) return;
    const next = [...columns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setAnnouncement(
      t("storefront_shell_footer_column_position", {
        label: moved.title,
        position: to + 1,
        total: columns.length,
      }),
    );
    emit({ columns: next });
  };

  const addressedIssues = useMemo(
    () =>
      issues.filter(
        (issue): issue is ShellIssue & { itemId: string } =>
          typeof issue.itemId === "string" &&
          columns.some(
            (column) =>
              column.id === issue.itemId ||
              (column.kind === "LINKS" &&
                column.rows.some((row) => row.id === issue.itemId)),
          ),
      ),
    [columns, issues],
  );

  return (
    <section className="min-w-0" aria-labelledby="storefront-shell-footer-heading">
      <h2
        id="storefront-shell-footer-heading"
        className="text-lg font-semibold text-ink"
      >
        {t("storefront_shell_tab_footer")}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {t("storefront_shell_footer_hint")}
      </p>

      {addressedIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {addressedIssues.map((issue) => (
            <button
              key={`${issue.code}:${issue.itemId}`}
              type="button"
              onClick={() => rowRefs.current.get(issue.itemId)?.focus()}
              className="block w-full rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-left text-sm text-ink"
            >
              {issue.message}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid min-w-0 gap-4 rounded-xl border border-admin-border bg-admin-surface p-5 lg:grid-cols-3">
        <label className="block min-w-0 text-sm font-medium text-ink">
          {t("storefront_shell_footer_tagline")}
          <input
            type="text"
            value={tagline}
            maxLength={SHELL_LIMITS.tagline}
            aria-label={t("storefront_shell_footer_tagline")}
            onChange={(event) => emit({ tagline: event.target.value })}
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
          />
        </label>
        <label className="block min-w-0 text-sm font-medium text-ink lg:col-span-2">
          {t("storefront_shell_footer_description")}
          <input
            type="text"
            value={description}
            maxLength={SHELL_LIMITS.description}
            aria-label={t("storefront_shell_footer_description")}
            onChange={(event) => emit({ description: event.target.value })}
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
          />
        </label>
        <label className="block min-w-0 text-sm font-medium text-ink">
          {t("storefront_shell_footer_copyright")}
          <input
            type="text"
            value={copyrightBrand}
            maxLength={SHELL_LIMITS.brandName}
            aria-label={t("storefront_shell_footer_copyright")}
            onChange={(event) => emit({ copyrightBrand: event.target.value })}
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
          />
          <span className="mt-1 block text-xs text-ink-muted">
            {t("storefront_shell_footer_copyright_hint")}
          </span>
        </label>
      </div>

      {atColumnLimit ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-admin-warning bg-admin-warning-soft px-3 py-2 text-sm text-ink"
        >
          {t("storefront_shell_footer_column_limit", {
            max: SHELL_LIMITS.maxFooterColumns,
          })}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={locked || atColumnLimit}
          onClick={() =>
            emit({ columns: [...columns, emptyLinksColumn(newId())] })
          }
          className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("storefront_shell_footer_add_column")}
        </button>
        <p className="text-xs text-ink-muted">
          {t("storefront_shell_footer_column_hint", {
            max: SHELL_LIMITS.maxFooterColumns,
          })}
        </p>
      </div>

      <div className="mt-4 space-y-4">
        {columns.map((column, index) => (
          <FooterColumnCard
            key={column.id}
            column={column}
            index={index}
            count={columns.length}
            locked={locked}
            onRef={(node) => {
              if (node) rowRefs.current.set(column.id, node);
              else rowRefs.current.delete(column.id);
            }}
            onRowRef={(rowId, node) => {
              if (node) rowRefs.current.set(rowId, node);
              else rowRefs.current.delete(rowId);
            }}
            onMove={(to) => moveColumn(index, to)}
            onRemove={() =>
              emit({ columns: columns.filter((entry) => entry.id !== column.id) })
            }
            onUpdate={(update) => updateColumn(column.id, update)}
          />
        ))}
      </div>

      <p
        role="status"
        data-testid="footer-column-announcement"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
    </section>
  );
}

function FooterColumnCard({
  column,
  index,
  count,
  locked,
  onRef,
  onRowRef,
  onMove,
  onRemove,
  onUpdate,
}: {
  column: FooterColumn;
  index: number;
  count: number;
  locked: boolean;
  onRef: (node: HTMLElement | null) => void;
  onRowRef: (rowId: string, node: HTMLElement | null) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onUpdate: (update: (column: FooterColumn) => FooterColumn) => void;
}) {
  const { t } = useAdminI18n();
  const contact = column.kind === "CONTACT";
  const emailInvalid =
    contact &&
    column.supportEmail.trim() !== "" &&
    !SUPPORT_EMAIL_PATTERN.test(column.supportEmail.trim());

  return (
    <fieldset
      ref={onRef}
      tabIndex={-1}
      data-testid={`footer-column-${column.id}`}
      className="min-w-0 rounded-xl border border-admin-border bg-admin-surface p-5 focus:outline-none focus:ring-2 focus:ring-admin-primary"
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t("storefront_shell_footer_column", { number: index + 1 })}
      </legend>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded-full border border-admin-border px-2 py-0.5 text-xs text-ink-secondary">
          {contact
            ? t("storefront_shell_footer_kind_contact")
            : t("storefront_shell_footer_kind_links")}
        </span>
        <button
          type="button"
          aria-label={t("storefront_shell_footer_move_up")}
          disabled={locked || index === 0}
          onClick={() => onMove(index - 1)}
          className="rounded-lg border border-admin-border px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t("storefront_shell_footer_move_down")}
          disabled={locked || index === count - 1}
          onClick={() => onMove(index + 1)}
          className="rounded-lg border border-admin-border px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ↓
        </button>
        {contact ? null : (
          <button
            type="button"
            aria-label={t("storefront_shell_footer_remove_column")}
            disabled={locked}
            onClick={onRemove}
            className="ml-auto rounded-lg border border-admin-error px-3 py-1.5 text-sm text-admin-error disabled:opacity-40"
          >
            {t("storefront_shell_footer_remove_column")}
          </button>
        )}
      </div>

      <label className="mt-4 block min-w-0 text-sm font-medium text-ink">
        {t("storefront_shell_footer_column_title")}
        <input
          type="text"
          value={column.title}
          maxLength={SHELL_LIMITS.columnTitle}
          aria-label={t("storefront_shell_footer_column_title")}
          onChange={(event) =>
            onUpdate((current) => ({ ...current, title: event.target.value }))
          }
          className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
        />
      </label>

      {contact && column.kind === "CONTACT" ? (
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 text-sm font-medium text-ink">
            {t("storefront_shell_footer_support_email")}
            <input
              type="email"
              value={column.supportEmail}
              maxLength={SHELL_LIMITS.supportEmail}
              aria-label={t("storefront_shell_footer_support_email")}
              onChange={(event) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, supportEmail: event.target.value }
                    : current,
                )
              }
              className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
            />
            {emailInvalid ? (
              <span className="mt-1 block text-xs text-admin-error">
                {t("storefront_shell_footer_support_email_invalid")}
              </span>
            ) : null}
          </label>
          <label className="block min-w-0 text-sm font-medium text-ink">
            {t("storefront_shell_footer_support_hours")}
            <input
              type="text"
              value={column.supportHours}
              maxLength={SHELL_LIMITS.supportHours}
              aria-label={t("storefront_shell_footer_support_hours")}
              onChange={(event) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, supportHours: event.target.value }
                    : current,
                )
              }
              className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
            />
          </label>
          <label className="block min-w-0 text-sm font-medium text-ink sm:col-span-2">
            {t("storefront_shell_footer_cod_text")}
            <input
              type="text"
              value={column.codText}
              maxLength={SHELL_LIMITS.codText}
              aria-label={t("storefront_shell_footer_cod_text")}
              onChange={(event) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, codText: event.target.value }
                    : current,
                )
              }
              className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
            />
          </label>
          <label className="block min-w-0 text-sm font-medium text-ink sm:col-span-2">
            {t("storefront_shell_footer_track_label")}
            <input
              type="text"
              value={column.trackOrderLabel}
              maxLength={SHELL_LIMITS.trackOrderLabel}
              aria-label={t("storefront_shell_footer_track_label")}
              onChange={(event) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, trackOrderLabel: event.target.value }
                    : current,
                )
              }
              className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2"
            />
          </label>
          <div className="min-w-0 sm:col-span-2">
            <ShellLinkEditor
              label={t("storefront_shell_footer_track_link")}
              link={column.trackOrderLink}
              disabled={locked}
              onLabelChange={(label) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, trackOrderLabel: label }
                    : current,
                )
              }
              onLinkChange={(link) =>
                onUpdate((current) =>
                  current.kind === "CONTACT"
                    ? { ...current, trackOrderLink: link }
                    : current,
                )
              }
            />
          </div>
        </div>
      ) : null}

      {column.kind === "LINKS" ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {t("storefront_shell_footer_rows")}
            </p>
            <button
              type="button"
              disabled={locked || column.rows.length >= SHELL_LIMITS.maxFooterRows}
              onClick={() =>
                onUpdate((current) =>
                  current.kind === "LINKS"
                    ? {
                        ...current,
                        rows: [
                          ...current.rows,
                          {
                            id: newId(),
                            kind: "LINK",
                            label: "New link",
                            link: { type: "INTERNAL", path: "/" },
                          },
                        ],
                      }
                    : current,
                )
              }
              className="rounded-lg border border-admin-border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {t("storefront_shell_footer_add_row")}
            </button>
          </div>

          <div className="mt-3">
            <OrderedRows
              items={column.rows}
              maxItems={SHELL_LIMITS.maxFooterRows}
              disabled={locked}
              labelFor={(row) => (row.kind === "TEXT" ? row.text : row.label)}
              onChange={(rows) =>
                onUpdate((current) =>
                  current.kind === "LINKS" ? { ...current, rows } : current,
                )
              }
              renderItem={(row, rowIndex, controls) => (
                <FooterRowCard
                  row={row}
                  rowIndex={rowIndex}
                  controls={controls}
                  onRef={(node) => onRowRef(row.id, node)}
                  onKindChange={(kind) =>
                    onUpdate((current) =>
                      current.kind === "LINKS"
                        ? {
                            ...current,
                            rows: current.rows.map((entry) =>
                              entry.id === row.id ? rowFor(kind, entry) : entry,
                            ),
                          }
                        : current,
                    )
                  }
                  onUpdate={(update) =>
                    onUpdate((current) =>
                      current.kind === "LINKS"
                        ? {
                            ...current,
                            rows: current.rows.map((entry) =>
                              entry.id === row.id ? update(entry) : entry,
                            ),
                          }
                        : current,
                    )
                  }
                />
              )}
            />
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

function FooterRowCard({
  row,
  rowIndex,
  controls,
  onRef,
  onKindChange,
  onUpdate,
}: {
  row: FooterRow;
  rowIndex: number;
  controls: RowControls;
  onRef: (node: HTMLElement | null) => void;
  onKindChange: (kind: FooterRow["kind"]) => void;
  onUpdate: (update: (row: FooterRow) => FooterRow) => void;
}) {
  const { t } = useAdminI18n();

  return (
    <div
      ref={onRef}
      tabIndex={-1}
      data-testid={`footer-row-${row.id}`}
      className="min-w-0 rounded-lg border border-admin-border p-3 focus:outline-none focus:ring-2 focus:ring-admin-primary"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          {...controls.dragHandleProps}
          aria-label={t("storefront_shell_drag")}
          className="cursor-grab touch-none rounded-lg border border-admin-border px-2 py-1 text-ink-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          ⠿
        </button>
        <select
          aria-label={t("storefront_shell_footer_row_kind")}
          value={row.kind}
          disabled={controls.disabled}
          onChange={(event) =>
            onKindChange(event.target.value as FooterRow["kind"])
          }
          className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1 text-xs text-ink"
        >
          <option value="LINK">
            {t("storefront_shell_footer_row_kind_link")}
          </option>
          <option value="TEXT">
            {t("storefront_shell_footer_row_kind_text")}
          </option>
        </select>
        <button
          type="button"
          aria-label={t("storefront_shell_footer_remove_row")}
          disabled={controls.disabled}
          onClick={controls.remove}
          className="ml-auto rounded-lg border border-admin-error px-2 py-1 text-xs text-admin-error disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 min-w-0">
        {row.kind === "TEXT" ? (
          <input
            type="text"
            value={row.text}
            maxLength={SHELL_LIMITS.footerText}
            aria-label={t("storefront_shell_footer_row_text")}
            disabled={controls.disabled}
            onChange={(event) =>
              onUpdate((current) =>
                current.kind === "TEXT"
                  ? { ...current, text: event.target.value }
                  : current,
              )
            }
            className="block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2 text-sm"
          />
        ) : (
          <ShellLinkEditor
            label={row.label}
            link={row.link}
            disabled={controls.disabled}
            onLabelChange={(label) =>
              onUpdate((current) =>
                current.kind === "LINK" ? { ...current, label } : current,
              )
            }
            onLinkChange={(link) =>
              onUpdate((current) =>
                current.kind === "LINK" ? { ...current, link } : current,
              )
            }
          />
        )}
        <span className="sr-only">{rowIndex + 1}</span>
      </div>
    </div>
  );
}
