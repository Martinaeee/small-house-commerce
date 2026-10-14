"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  ADMIN_FAQ_CATEGORIES,
  type AdminFaqAnswerBlock,
  type AdminFaqAudience,
  type AdminFaqCategory,
} from "@/lib/admin-api";
import { FaqAnswerInput } from "./FaqAnswerInput";
import { FaqAudiencePicker } from "./FaqAudiencePicker";
import { FAQ_CATEGORY_LABEL_KEYS } from "./faq-view";

export interface FaqItemDraft {
  id: string;
  title: string;
  answer: AdminFaqAnswerBlock[];
  enabled: boolean;
  defaultOpen: boolean;
  category: AdminFaqCategory;
  /** Shared-library scope; product questions keep the all-products default. */
  audience: AdminFaqAudience;
  position: number;
}

export function emptyFaqItemDraft(position: number): FaqItemDraft {
  return {
    id: crypto.randomUUID(),
    title: "",
    answer: [{ kind: "paragraph", text: "" }],
    enabled: true,
    defaultOpen: false,
    category: "UNCATEGORIZED",
    audience: { scope: "ALL" },
    position,
  };
}

/**
 * Single-question editor shared by the FAQ management list and the product
 * editor. The parent remounts it per open (keyed), so local state always
 * starts from the passed draft.
 */
export function FaqItemDialog({
  title,
  item,
  showCategory,
  showSort,
  showAudience = false,
  contextLabel,
  saving,
  error,
  onReloadError,
  onCancel,
  onSave,
}: {
  title: string;
  item: FaqItemDraft;
  showCategory: boolean;
  showSort: boolean;
  /** Shared questions pick the products they apply to; product questions never do. */
  showAudience?: boolean;
  contextLabel?: string | null;
  saving: boolean;
  error: string | null;
  /** Set when the error is a version conflict; reloads the list and closes. */
  onReloadError?: (() => void) | null;
  onCancel: () => void;
  onSave: (item: FaqItemDraft) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<FaqItemDraft>(item);
  const [sortText, setSortText] = useState(String(item.position + 1));

  const patch = (partial: Partial<FaqItemDraft>) =>
    setDraft((current) => ({ ...current, ...partial }));

  const sortValue = Number.parseInt(sortText, 10);
  const sortValid = !showSort || (Number.isInteger(sortValue) && sortValue >= 1);
  const audienceValid =
    !showAudience ||
    draft.audience.scope === "ALL" ||
    draft.audience.productIds.length >= 2;
  const canSave =
    draft.title.trim().length > 0 &&
    draft.answer.length > 0 &&
    sortValid &&
    audienceValid;

  const selectSpecific = () =>
    patch({
      audience:
        draft.audience.scope === "PRODUCTS"
          ? draft.audience
          : { scope: "PRODUCTS", productIds: [] },
    });

  const submit = () => {
    if (!canSave || saving) return;
    onSave({
      ...draft,
      title: draft.title.trim(),
      position: showSort ? sortValue - 1 : draft.position,
    });
  };

  return (
    <Dialog open title={title} onClose={onCancel}>
      <div className="space-y-4">
        {contextLabel ? (
          <p className="rounded-lg bg-background px-3 py-2 text-xs text-ink-secondary">
            {contextLabel}
          </p>
        ) : null}
        <Field label={t("faq_dialog_question")} htmlFor="faq-dialog-title">
          <TextInput
            id="faq-dialog-title"
            value={draft.title}
            maxLength={200}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </Field>
        <Field
          label={t("faq_dialog_answer")}
          htmlFor="faq-dialog-answer"
          hint={t("product_faq_answer_hint")}
        >
          <FaqAnswerInput
            id="faq-dialog-answer"
            answer={draft.answer}
            onChange={(answer) => patch({ answer })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {showCategory ? (
            <Field label={t("faq_dialog_category")} htmlFor="faq-dialog-category">
              <Select
                id="faq-dialog-category"
                value={draft.category}
                onChange={(event) =>
                  patch({ category: event.target.value as AdminFaqCategory })
                }
              >
                {ADMIN_FAQ_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(FAQ_CATEGORY_LABEL_KEYS[category])}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("faq_dialog_status")} htmlFor="faq-dialog-status">
            <Select
              id="faq-dialog-status"
              value={draft.enabled ? "enabled" : "disabled"}
              onChange={(event) =>
                patch({ enabled: event.target.value === "enabled" })
              }
            >
              <option value="enabled">{t("faq_status_enabled")}</option>
              <option value="disabled">{t("faq_status_disabled")}</option>
            </Select>
          </Field>
          {showSort ? (
            <Field label={t("faq_dialog_sort")} htmlFor="faq-dialog-sort">
              <TextInput
                id="faq-dialog-sort"
                type="number"
                min={1}
                value={sortText}
                onChange={(event) => setSortText(event.target.value)}
              />
            </Field>
          ) : null}
        </div>
        {showAudience ? (
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium text-ink">
              {t("faq_audience_title")}
            </legend>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="faq-audience"
                  checked={draft.audience.scope === "ALL"}
                  onChange={() => patch({ audience: { scope: "ALL" } })}
                  className="h-4 w-4 border-border accent-cta"
                />
                {t("faq_audience_all")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="faq-audience"
                  checked={draft.audience.scope === "PRODUCTS"}
                  onChange={selectSpecific}
                  className="h-4 w-4 border-border accent-cta"
                />
                {t("faq_audience_specific")}
              </label>
            </div>
            {draft.audience.scope === "PRODUCTS" ? (
              <div className="rounded-lg border border-border bg-background p-3">
                <FaqAudiencePicker
                  ids={draft.audience.productIds}
                  onIdsChange={(productIds) =>
                    patch({ audience: { scope: "PRODUCTS", productIds } })
                  }
                />
                {draft.audience.productIds.length < 2 ? (
                  <p className="mt-3 text-xs text-red-700">
                    {t("faq_audience_min_hint")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.defaultOpen}
            onChange={(event) => patch({ defaultOpen: event.target.checked })}
            className="h-4 w-4 rounded border-border accent-cta"
          />
          {t("faq_dialog_default_open")}
        </label>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700">
            {error}
            {onReloadError ? (
              <Button
                variant="text"
                size="md"
                className="h-auto min-w-0 px-0 text-red-700"
                onClick={onReloadError}
              >
                {t("faq_reload")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={saving}>
            {t("faq_dialog_cancel")}
          </Button>
          <Button size="md" onClick={submit} disabled={!canSave || saving}>
            {saving ? t("faq_dialog_saving") : t("faq_dialog_save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
