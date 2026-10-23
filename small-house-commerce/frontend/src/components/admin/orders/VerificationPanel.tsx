"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminVerificationItem,
  type AdminVerificationLibraryItem,
  type AdminVerificationState,
  type AdminVerificationTemplates,
  type VerificationItemStatus,
  type VerificationPriority,
} from "@/lib/admin-api";

/**
 * The manual COD verification surfaces of the order workbench:
 *   - VerificationDrawer: the checklist a handler works through
 *   - AssignTasksDialog: 核实问题 → 负责人 → 备注, one row per task
 *
 * Both talk to the stage-1A endpoints. Finishing a task never confirms the
 * order - the confirmation is a separate action the server checks.
 */

const STATUS_KEY: Record<VerificationItemStatus, TKey> = {
  PENDING: "verify_status_pending",
  DONE: "verify_status_done",
  PROBLEM: "verify_status_problem",
  SKIPPED: "verify_status_skipped",
  INVALIDATED: "verify_status_invalidated",
};

const STATUS_TONE: Record<VerificationItemStatus, string> = {
  PENDING: "bg-admin-warning-soft text-admin-warning",
  DONE: "bg-admin-success-soft text-admin-success",
  PROBLEM: "bg-admin-error-soft text-admin-error",
  SKIPPED: "bg-admin-neutral-soft text-ink-secondary",
  INVALIDATED: "bg-admin-info-soft text-admin-info",
};

const PRIORITY_KEY: Record<VerificationPriority, TKey> = {
  NORMAL: "orders_priority_normal",
  HIGH: "orders_priority_high",
  URGENT: "orders_priority_urgent",
};

const CATEGORY_ORDER = [
  "CUSTOMER_INFO",
  "PRODUCT_INFO",
  "SHIPPING_ADDRESS",
  "COD_PAYMENT",
  "DELIVERY_SCHEDULE",
  "RISK_REVIEW",
  "OTHER",
];

const CATEGORY_KEY: Record<string, TKey> = {
  CUSTOMER_INFO: "verify_category_customer_info",
  PRODUCT_INFO: "verify_category_product_info",
  SHIPPING_ADDRESS: "verify_category_shipping_address",
  COD_PAYMENT: "verify_category_cod_payment",
  DELIVERY_SCHEDULE: "verify_category_delivery_schedule",
  RISK_REVIEW: "verify_category_risk_review",
  OTHER: "verify_category_other",
};

interface StaffOption {
  id: string;
  name: string | null;
}

/* ------------------------------------------------------------------ */
/* The drawer: the checklist a handler works through                    */
/* ------------------------------------------------------------------ */

export function VerificationDrawer({
  orderId,
  orderNumber,
  staff,
  onClose,
  onChanged,
}: {
  orderId: string | null;
  orderNumber: string;
  staff: StaffOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useAdminI18n();
  const [state, setState] = useState<AdminVerificationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignNonce, setAssignNonce] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setState(await adminApi.orderVerification(orderId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common_request_failed"));
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    void adminApi
      .orderVerification(orderId)
      .then((result) => {
        if (!active) return;
        setState(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : t("common_request_failed"));
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [orderId, onClose]);

  const items = useMemo(() => {
    const list = state?.items ?? [];
    // The open work first, the finished ones below.
    return [...list].sort((a, b) => {
      const rank = (i: AdminVerificationItem) =>
        i.status === "PENDING" ? 0 : i.status === "PROBLEM" ? 1 : i.status === "INVALIDATED" ? 2 : 3;
      return rank(a) - rank(b);
    });
  }, [state]);

  const done = items.filter((i) => i.status === "DONE" || i.status === "SKIPPED").length;
  const open = items.filter((i) => i.status === "PENDING" || i.status === "PROBLEM");
  const assignment = state?.assignment ?? null;

  const save = useCallback(
    async (item: AdminVerificationItem, patch: Parameters<typeof adminApi.setVerificationResult>[2]) => {
      setBusy(true);
      try {
        await adminApi.setVerificationResult(orderId!, item.itemKey, { ...patch, rev: item.rev });
        await load();
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common_request_failed"));
      } finally {
        setBusy(false);
      }
    },
    [orderId, load, onChanged],
  );

  if (!orderId) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${t("verify_drawer_title")} ${orderNumber}`}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(96vw,42rem)] flex-col border-l border-border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {t("verify_drawer_title")} · {orderNumber}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              {items.length
                ? `${t("orders_verify_progress")} ${done}/${items.length}`
                : t("orders_not_assigned")}
              {open.length ? ` · ${open.length} ${t("orders_verify_open_unit")}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-lg text-ink-muted" aria-label={t("verify_drawer_close")}>
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p role="alert" className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
              {error}
            </p>
          ) : null}

          <div
            className={`mb-4 rounded-lg border px-3 py-2.5 text-[13px] ${
              open.length
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : items.length
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-border bg-card text-ink-secondary"
            }`}
          >
            {items.length === 0 ? (
              <p>{t("orders_not_assigned")}</p>
            ) : open.length ? (
              <p>
                <span className="font-semibold">{t("verify_drawer_open")}：</span>
                {open.map((i) => i.titleSnapshot).join("、")} ——{" "}
                {t("verify_drawer_open_hint")}
              </p>
            ) : (
              <p>{t("verify_drawer_done")}</p>
            )}
          </div>

          {assignment ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-[11.5px] text-ink-secondary">
              <span>
                {t("verify_drawer_owner_label")}
                <b className="text-ink">
                  {staff.find((s) => s.id === assignment.assigneeId)?.name ?? t("verify_assign_unassigned")}
                </b>
              </span>
              <span>
                {t("verify_drawer_priority_label")}
                <b className="text-ink">{t(PRIORITY_KEY[assignment.priority])}</b>
              </span>
              {assignment.nextFollowUpAt ? (
                <span>
                  {t("verify_drawer_followup_label")}<b className="text-ink">{formatWhen(assignment.nextFollowUpAt)}</b>
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                className="ml-auto text-[11.5px] font-semibold text-cta hover:underline"
              >
                {t("verify_drawer_assign")}
              </button>
            </div>
          ) : null}

          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[.06em] text-ink-muted">
                <th className="py-2 pr-2">{t("verify_drawer_question")}</th>
                <th className="py-2 pr-2">{t("verify_drawer_staff")}</th>
                <th className="py-2 pr-2">{t("verify_drawer_note")}</th>
                <th className="py-2 pr-2">{t("verify_drawer_status")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const events = (state?.events ?? []).filter((e) => e.itemId === item.id);
                return (
                  <tr key={item.id} className="border-b border-border align-top">
                    <td className="py-2 pr-2">
                      <div className="text-ink">{item.titleSnapshot}</div>
                      <div className="mt-0.5 text-[11.5px] text-ink-muted">
                        {CATEGORY_KEY[item.category] ? t(CATEGORY_KEY[item.category]) : item.category}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-[11.5px] text-ink-secondary">
                      {staff.find((s) => s.id === item.assigneeId)?.name ?? "—"}
                      {item.operatorId && item.operatorId !== item.assigneeId ? (
                        <div className="meta">
                          {t("verify_drawer_done_by", {
                            name: staff.find((s) => s.id === item.operatorId)?.name ?? "—",
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <TextInput
                        aria-label={`${item.titleSnapshot} ${t("verify_drawer_note")}`}
                        defaultValue={item.note ?? ""}
                        placeholder={item.result ?? t("verify_drawer_note")}
                        onBlur={(e) => {
                          if (e.target.value !== (item.note ?? "")) {
                            void save(item, { status: item.status, note: e.target.value });
                          }
                        }}
                      />
                      {item.nextFollowUpAt ? (
                        <p className="mt-1 text-[11.5px] text-admin-warning">
                          {t("verify_drawer_redial", { when: formatWhen(item.nextFollowUpAt) })}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        aria-label={`${item.titleSnapshot} ${t("verify_drawer_status")}`}
                        value={item.status}
                        disabled={busy}
                        onChange={(e) => {
                          const status = e.target.value as VerificationItemStatus;
                          if (status === "DONE" && !item.result && !item.note) {
                            setError(t("verify_drawer_need_result"));
                            return;
                          }
                          if (status === "SKIPPED" && !item.skippedReason) {
                            setError(t("verify_drawer_need_reason"));
                            return;
                          }
                          void save(item, { status });
                        }}
                      >
                        {(Object.keys(STATUS_KEY) as VerificationItemStatus[]).map((value) => (
                          <option key={value} value={value}>
                            {t(STATUS_KEY[value])}
                          </option>
                        ))}
                      </Select>
                      {events.length ? (
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                          className="mt-1 text-[11.5px] text-ink-muted hover:underline"
                        >
                           {t("verify_drawer_events", { count: events.length })}
                        </button>
                      ) : null}
                      {expanded === item.id ? (
                        <ul className="mt-1 space-y-0.5 border-l border-border pl-2 text-[11.5px] text-ink-muted">
                          {events.map((e) => (
                            <li key={e.id}>
                              {formatWhen(e.createdAt)} · {e.type}
                              {e.note ? ` — ${e.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2 text-right text-[11.5px]">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[item.status]}`}
                      >
                        {t(STATUS_KEY[item.status])}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[13px] text-ink-muted">
                    {t("verify_drawer_empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center gap-3 border-t border-border bg-card px-5 py-3">
          <Button type="button" variant="secondary" size="md" onClick={() => setAssignOpen(true)}>
            {t("verify_drawer_assign_cta")}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy}
            title={t("verify_drawer_confirm_hint")}
            onClick={async () => {
              if (!orderId) return;
              setBusy(true);
              try {
                await adminApi.confirmOrder(orderId);
                onChanged();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : t("common_request_failed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("verify_drawer_confirm")}
          </Button>
        </footer>
      </aside>

      <AssignTasksDialog
        key={`${orderId}-${assignNonce}-${state?.assignment?.id ?? "none"}`}
        open={assignOpen}
        orderId={orderId}
        staff={staff}
        current={state}
        onClose={() => setAssignOpen(false)}
        onSaved={async () => {
          setAssignOpen(false);
          setAssignNonce((n) => n + 1);
          await load();
          onChanged();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The three column assignment dialog                                   */
/* ------------------------------------------------------------------ */

/** The rows of the dialog: the checklist that is already on the order. */
function draftFrom(current: AdminVerificationState | null): DraftRow[] {
  return (current?.items ?? []).map((item) => ({
    key: item.itemKey,
    title: item.titleSnapshot,
    category: item.category,
    assigneeId: item.assigneeId ?? "",
    note: item.note ?? "",
    // A finished question keeps its conclusion and its history when the
    // checklist is edited.
    existing: {
      status: item.status,
      result: item.result,
      operatorId: item.operatorId,
      completedAt: item.completedAt,
    },
  }));
}

interface DraftRow {
  key: string;
  title: string;
  category: string;
  assigneeId: string;
  note: string;
  existing: {
    status: VerificationItemStatus;
    result: string | null;
    operatorId: string | null;
    completedAt: string | null;
  } | null;
}

export function AssignTasksDialog({
  open,
  orderId,
  staff,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  orderId: string | null;
  staff: StaffOption[];
  current: AdminVerificationState | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useAdminI18n();
  const [templates, setTemplates] = useState<AdminVerificationTemplates | null>(null);
  // The draft starts from the checklist that is already on the order: an item
  // that carries a conclusion keeps it.
  const [rows, setRows] = useState<DraftRow[]>(() => draftFrom(current));
  const [owner, setOwner] = useState(() => current?.assignment?.assigneeId ?? "");
  const [priority, setPriority] = useState<VerificationPriority>(
    () => current?.assignment?.priority ?? "NORMAL",
  );
  const [note, setNote] = useState(() => current?.assignment?.note ?? "");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void adminApi
      .verificationTemplates()
      .then((result) => {
        if (active) setTemplates(result);
      })
      .catch(() => {
        if (active) setTemplates(null);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const grouped = useMemo(() => {
    const library = templates?.library ?? [];
    const filtered = library.filter(
      (l) =>
        !query ||
        l.title.toLowerCase().includes(query.toLowerCase()) ||
        l.category.toLowerCase().includes(query.toLowerCase()),
    );
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: filtered.filter((l) => l.category === category),
    })).filter((group) => group.items.length > 0);
  }, [templates, query]);

  /**
   * Add a library item to the checklist, or take it out again.
   *
   * An item that already carries a conclusion stays: its result and its
   * history are facts, so the operator removes it the same way the draft
   * does - with the warning that says so.
   */
  const toggleLibraryItem = useCallback(
    (item: AdminVerificationLibraryItem) => {
      const existing = rows.find((r) => r.key === item.key);
      if (existing) {
        if (existing.existing) {
          setNotice(t("verify_assign_remove_blocked"));
          return;
        }
        setRows((prev) => prev.filter((r) => r.key !== item.key));
        return;
      }
      setRows((prev) => [
        ...prev,
        {
          key: item.key,
          title: item.title,
          category: item.category,
          assigneeId: "",
          note: "",
          existing: null,
        },
      ]);
    },
    [rows, t],
  );

  const applyTemplate = useCallback(
    (items: string[]) => {
      setRows((prev) => {
        const next = [...prev];
        for (const key of items) {
          const definition = (templates?.library ?? []).find((l) => l.key === key);
          if (!definition || next.some((r) => r.key === key)) continue;
          next.push({
            key: definition.key,
            title: definition.title,
            category: definition.category,
            assigneeId: "",
            note: "",
            existing: null,
          });
        }
        return next;
      });
      setPickerOpen(null);
    },
    [templates],
  );

  if (!open || !orderId) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.assignVerification(orderId, {
        assigneeId: owner || null,
        priority,
        note: note || null,
        itemKeys: rows.map((r) => r.key),
        itemAssignees: rows.map((r) => ({
          itemKey: r.key,
          assigneeId: r.assigneeId || null,
        })),
        itemNotes: rows.map((r) => ({
          itemKey: r.key,
          note: r.note.trim() ? r.note.trim() : null,
        })),
        customItems: rows
          .filter((r) => !(templates?.library ?? []).some((l) => l.key === r.key))
          .map((r) => ({ key: r.key, title: r.title })),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common_request_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("verify_assign_title")}
      width="lg"
      initialFocus="first"
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg bg-admin-warning-soft px-3 py-2 text-[13px] text-admin-warning">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label={t("verify_assign_owner")} htmlFor="assign-owner">
              <Select id="assign-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">{t("verify_assign_unassigned")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? "—"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label={t("verify_assign_priority")} htmlFor="assign-priority">
              <Select
                id="assign-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as VerificationPriority)}
              >
                {(Object.keys(PRIORITY_KEY) as VerificationPriority[]).map((value) => (
                  <option key={value} value={value}>
                    {t(PRIORITY_KEY[value])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-40">
            <Field label={t("verify_assign_bulk")} htmlFor="assign-bulk">
              <Select
                id="assign-bulk"
                value=""
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  setRows((prev) => prev.map((r) => ({ ...r, assigneeId: value })));
                }}
              >
                <option value="">{t("verify_assign_bulk_choose")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? "—"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="min-w-48 flex-1">
            <Field label={t("verify_assign_note")} htmlFor="assign-note">
              <TextInput
                id="assign-note"
                value={note}
                placeholder={t("verify_assign_note_placeholder")}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {templates?.system.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{t("verify_assign_templates")}</span>
            {templates.system.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t.items)}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11.5px] text-ink-secondary hover:bg-background"
              >
                {t.name} ({t.items.length})
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  {
                    key: `custom:${Date.now()}`,
                    title: "",
                    category: "OTHER",
                    assigneeId: "",
                    note: "",
                    existing: null,
                  },
                ])
              }
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold text-ink-secondary hover:bg-background"
            >
              {t("verify_assign_add")}
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-card text-left text-[11px] font-semibold uppercase tracking-[.06em] text-ink-muted">
                <th className="w-[34%] px-3 py-2">{t("verify_assign_question")}</th>
                <th className="w-[20%] px-3 py-2">{t("verify_assign_staff")}</th>
                <th className="w-[30%] px-3 py-2">{t("verify_drawer_note")}</th>
                <th className="w-[16%] px-3 py-2">{t("verify_assign_state")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} className="border-b border-border align-top last:border-b-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerOpen(pickerOpen === index ? null : index)}
                        className="flex-1 truncate rounded-lg border border-border bg-background px-2 py-1.5 text-left text-ink hover:bg-card"
                      >
                        {row.title}
                      </button>
                    </div>
                    <div className="mt-1 text-[11.5px] text-ink-muted">
                      {CATEGORY_KEY[row.category] ? t(CATEGORY_KEY[row.category]) : row.category}
                    </div>
                    {pickerOpen === index ? (
                      <div className="mt-2 w-[min(30rem,70vw)] rounded-lg border border-border bg-card p-2 shadow-lg">
                        <TextInput
                          aria-label={t("verify_assign_search_aria")}
                          value={query}
                          placeholder={t("verify_assign_search")}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <div className="mt-2 max-h-56 overflow-y-auto">
                          {grouped.map((group) => (
                            <div key={group.category} className="mb-2">
                              <p className="px-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-ink-muted">
                                {CATEGORY_KEY[group.category] ? t(CATEGORY_KEY[group.category]) : group.category}
                              </p>
                              {group.items.map((item) => (
                                <label
                                  key={item.key}
                                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-background"
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={item.title}
                                    checked={rows.some((r) => r.key === item.key)}
                                    onChange={() => toggleLibraryItem(item)}
                                    className="h-3.5 w-3.5 accent-cta"
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    {item.title}
                                  </span>
                                </label>
                              ))}
                            </div>
                          ))}
                          {grouped.length === 0 ? (
                            <p className="px-2 py-2 text-[12.5px] text-ink-muted">{t("verify_assign_no_match")}</p>
                          ) : null}
                        </div>
                        <div className="mt-2 flex gap-2 border-t border-border pt-2">
                          <TextInput
                            aria-label={t("verify_assign_custom_aria")}
                            value={custom}
                            placeholder={t("verify_assign_custom")}
                            onChange={(e) => setCustom(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              const title = custom.trim();
                              if (!title) return;
                              setRows((prev) => [
                                ...prev,
                                {
                                  key: `custom:${Date.now()}`,
                                  title,
                                  category: "OTHER",
                                  assigneeId: "",
                                  note: "",
                                  existing: null,
                                },
                              ]);
                              setCustom("");
                              setPickerOpen(null);
                            }}
                          >
                            {t("verify_assign_add")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      aria-label={`${row.title} ${t("verify_drawer_staff")}`}
                      value={row.assigneeId}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, assigneeId: e.target.value } : r,
                          ),
                        )
                      }
                    >
                      <option value="">{t("verify_assign_unassigned")}</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name ?? "—"}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <textarea
                      aria-label={`${row.title} ${t("verify_drawer_note")}`}
                      value={row.note}
                      rows={2}
                      placeholder={t("verify_assign_row_note")}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, note: e.target.value } : r)),
                        )
                      }
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-ink"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.existing ? (
                      <div>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_TONE[row.existing.status]}`}
                        >
                          {t(STATUS_KEY[row.existing.status])}
                        </span>
                        {row.existing.result ? (
                          <div className="mt-1 text-[11.5px] text-ink-secondary">
                            {row.existing.result}
                          </div>
                        ) : null}
                        <div className="mt-1 text-[11.5px] text-ink-muted">
                          {row.existing.operatorId
                            ? (staff.find((s) => s.id === row.existing?.operatorId)?.name ?? "—")
                            : "—"}
                          {row.existing.completedAt
                            ? ` · ${formatWhen(row.existing.completedAt)}`
                            : ""}
                        </div>
                        <div className="mt-1 text-[11px] leading-snug text-ink-muted">
                          {t("verify_assign_keep_result")}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-ink-muted">{t("verify_assign_pending")}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (row.existing) setNotice(t("verify_assign_remove_warning"));
                        setRows((prev) => prev.filter((_, i) => i !== index));
                      }}
                      className="mt-2 block text-[11.5px] text-ink-muted hover:text-red-700 hover:underline"
                    >
                      {t("verify_assign_remove")}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[13px] text-ink-muted">
                    {t("verify_assign_pick_hint")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-[11.5px] text-ink-muted">
          {t("verify_assign_explain")}
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={saving}>
            {t("common_cancel")}
          </Button>
          <Button type="button" variant="primary" size="md" onClick={() => void save()} disabled={saving}>
            {saving ? "…" : t("verify_assign_save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
