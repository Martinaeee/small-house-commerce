"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminApi, type AdminQuestion } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";

/**
 * "Ask a question" inbox for the FAQ workspace.
 *
 * Submissions stay private until an operator answers one: converting appends
 * the answer to the product's own FAQ list (shared products become
 * "shared + own"), so the storefront keeps one FAQ source of truth.
 */
export function FaqQuestionsSection({
  productId,
  onConverted,
}: {
  productId: string | null;
  /** Lets the workspace re-read product FAQ groups after a new item lands. */
  onConverted?: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [items, setItems] = useState<AdminQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [answerFor, setAnswerFor] = useState<AdminQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi
      .listQuestions({
        status: "PENDING",
        pageSize: 50,
        ...(productId ? { productId } : {}),
      })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setItems([]);
        setError(cause instanceof Error ? cause.message : t("faq_questions_error"));
      });
    return () => {
      active = false;
    };
  }, [productId, nonce, t]);

  const dismiss = useCallback(
    async (question: AdminQuestion) => {
      setBusyId(question.id);
      setError(null);
      setActionNotice(null);
      try {
        await adminApi.dismissQuestion(question.id);
        setItems((current) => (current ?? []).filter((row) => row.id !== question.id));
        setActionNotice(t("faq_questions_dismissed"));
      } catch {
        setError(t("faq_questions_error"));
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  const closeDialog = useCallback(() => {
    if (saving) return;
    setAnswerFor(null);
    setAnswer("");
    setDialogError(null);
  }, [saving]);

  const convert = useCallback(async () => {
    if (!answerFor) return;
    if (!answer.trim()) {
      setDialogError(t("faq_questions_answer_required"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      await adminApi.convertQuestion(answerFor.id, answer.trim());
      setItems((current) => (current ?? []).filter((row) => row.id !== answerFor.id));
      setActionNotice(t("faq_questions_converted"));
      setSaving(false);
      setAnswerFor(null);
      setAnswer("");
      onConverted?.();
    } catch {
      setDialogError(t("faq_questions_error"));
      setSaving(false);
    }
  }, [answer, answerFor, onConverted, t]);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {t("faq_questions_title")}
          <span className="rounded-full bg-primary-light/60 px-2 py-0.5 text-xs font-semibold text-cta">
            {items?.length ?? 0}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <p className="hidden text-xs text-ink-muted sm:block">
            {t("faq_questions_hint")}
          </p>
          <button
            type="button"
            onClick={() => {
              setItems(null);
              setError(null);
              setActionNotice(null);
              setNonce((current) => current + 1);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:border-cta hover:text-cta"
          >
            {t("faq_questions_refresh")}
          </button>
        </div>
      </div>

      {actionNotice ? (
        <p role="status" className="mb-3 rounded-lg border border-border bg-background px-3 py-2 text-sm text-cta">
          {actionNotice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 rounded-lg border border-sale/40 bg-sale/10 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="text-sm text-ink-muted">{t("faq_questions_loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState title={t("faq_questions_empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((question) => (
            <li key={question.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{question.question}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {question.product.name} ·{" "}
                  {question.askerName?.trim() || t("faq_questions_anonymous")}
                  {question.askerEmail ? ` · ${question.askerEmail}` : ""} ·{" "}
                  {new Date(question.createdAt).toLocaleString("en-PH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === question.id}
                  onClick={() => {
                    setActionNotice(null);
                    setDialogError(null);
                    setAnswer("");
                    setAnswerFor(question);
                  }}
                  className="rounded-lg bg-cta px-3 py-1.5 text-xs font-semibold text-cta-foreground hover:bg-cta-hover disabled:opacity-40"
                >
                  {t("faq_questions_convert")}
                </button>
                <button
                  type="button"
                  disabled={busyId === question.id}
                  onClick={() => void dismiss(question)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:border-cta hover:text-cta disabled:opacity-40"
                >
                  {t("faq_questions_dismiss")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={answerFor !== null}
        onClose={closeDialog}
        title={t("faq_questions_convert_title")}
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-background px-3 py-2 text-sm text-ink">
            {answerFor?.question}
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t("faq_questions_answer_label")}
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={4}
              maxLength={8000}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-cta"
            />
          </label>
          <p className="text-xs text-ink-muted">{t("faq_questions_hint")}</p>
          {dialogError ? (
            <p role="alert" className="text-sm text-sale">
              {dialogError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink-secondary hover:border-cta hover:text-cta disabled:opacity-40"
            >
              {t("common_cancel")}
            </button>
            <button
              type="button"
              onClick={() => void convert()}
              disabled={saving}
              className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground hover:bg-cta-hover disabled:opacity-40"
            >
              {t("faq_questions_convert_confirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
