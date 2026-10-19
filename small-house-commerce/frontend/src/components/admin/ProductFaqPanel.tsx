"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { newId } from "@/lib/admin-id";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { faqApi } from "@/lib/faq-api";
import type {
  AdminFaqItem,
  AdminFaqMode,
  AdminProductFaq,
} from "@/lib/admin-api";
import { ProductFaqSection } from "@/components/product/ProductFaqSection";
import { FaqAnswerInput } from "./faq/FaqAnswerInput";
import {
  audienceAppliesTo,
  copyApplicableSharedItems,
  resolveAdminFaqPreview,
} from "./faq/faq-view";

const EMPTY_FAQ: AdminProductFaq = {
  mode: "SHARED",
  items: [],
  version: 0,
};

function withPositions(items: AdminFaqItem[]): AdminFaqItem[] {
  return items.map((item, position) => ({ ...item, position }));
}

function newItem(position: number): AdminFaqItem {
  return {
    id: newId(),
    title: "",
    answer: [{ kind: "paragraph", text: "" }],
    enabled: true,
    position,
    defaultOpen: false,
  };
}

/**
 * The product editor's FAQ shortcut: this product's mode, the shared questions
 * it will render, and its own questions. The full library lives in FAQ
 * Management; both surfaces write the same ProductFaq row through the product
 * save (or the management page's own save), so there is never a second store.
 */
export function ProductFaqPanel({
  value,
  onChange,
  savedValue,
  productId = null,
}: {
  value?: AdminProductFaq;
  onChange: (value: AdminProductFaq) => void;
  /** Last saved FAQ, for warning before leaving with unsaved changes. */
  savedValue?: AdminProductFaq;
  productId?: string | null;
}): ReactNode {
  const { t } = useAdminI18n();
  const router = useRouter();
  const faq = value ?? EMPTY_FAQ;
  const titleId = "product-faq-title";
  const productTitleId = "product-faq-product-title";
  const appliedTitleId = "product-faq-applied-title";
  const previewTitleId = "product-faq-preview-title";
  const modeId = "product-faq-mode";
  const itemsTitleId = "product-faq-items-title";

  const faqDirty =
    JSON.stringify(faq) !== JSON.stringify(savedValue ?? EMPTY_FAQ);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sharedItems, setSharedItems] = useState<AdminFaqItem[] | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    faqApi
      .getSharedPreview()
      .then((data) => {
        if (!active) return;
        setSharedItems(data.items);
        setSharedError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSharedError(
          err instanceof Error ? err.message : t("faq_product_load_failed"),
        );
      });
    return () => {
      active = false;
    };
  }, [t]);

  const managementHref = productId
    ? `/admin/faq?view=product&product=${encodeURIComponent(productId)}`
    : "/admin/faq";
  const openManagement = () => {
    if (faqDirty) setConfirmOpen(true);
    else router.push(managementHref);
  };

  const modeHint = useMemo(
    () =>
      faq.mode === "SHARED"
        ? t("product_faq_mode_shared_hint")
        : faq.mode === "EXTEND"
          ? t("product_faq_mode_extend_hint")
          : t("product_faq_mode_custom_hint"),
    [faq.mode, t],
  );

  const appliedShared = (sharedItems ?? []).filter(
    (item) => item.enabled && audienceAppliesTo(item, productId),
  );
  const effectivePreview = resolveAdminFaqPreview(
    sharedItems ?? [],
    faq,
    productId,
  );
  const previewLabel = faqDirty
    ? t("product_faq_preview_unsaved")
    : t("product_faq_preview_title");

  const setMode = (mode: AdminFaqMode) => onChange({ ...faq, mode });
  const setItems = (items: AdminFaqItem[]) =>
    onChange({ ...faq, items: withPositions(items) });
  const copySharedItems = () => {
    const copied = copyApplicableSharedItems(
      sharedItems ?? [],
      productId,
      faq.items.length,
    );
    if (copied.length > 0) setItems([...faq.items, ...copied]);
  };
  const updateItem = (index: number, patch: Partial<AdminFaqItem>) => {
    setItems(
      faq.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= faq.items.length) return;
    const items = [...faq.items];
    [items[index], items[target]] = [items[target], items[index]];
    setItems(items);
  };

  return (
    <section className="space-y-5" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {t("product_faq_title")}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
            {t("product_faq_description")}
          </p>
        </div>
        <Button
          variant="text"
          size="md"
          className="h-auto min-w-0 px-0 text-sm font-semibold text-cta"
          onClick={openManagement}
        >
          {t("product_faq_open_management")}
        </Button>
      </div>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        aria-labelledby={productTitleId}
      >
        <h3 id={productTitleId} className="text-sm font-semibold text-ink">
          {t("product_faq_product_title")}
        </h3>
        <p className="text-xs leading-relaxed text-ink-muted">
          {t("product_faq_product_description")}
        </p>
        <Field
          label={t("product_faq_mode_label")}
          htmlFor={modeId}
          hint={modeHint}
        >
          <Select
            id={modeId}
            value={faq.mode}
            onChange={(event) => setMode(event.target.value as AdminFaqMode)}
          >
            <option value="SHARED">{t("product_faq_mode_shared")}</option>
            <option value="EXTEND">{t("product_faq_mode_extend")}</option>
            <option value="CUSTOM">{t("product_faq_mode_custom")}</option>
          </Select>
        </Field>
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        aria-labelledby={appliedTitleId}
      >
        <h3 id={appliedTitleId} className="text-sm font-semibold text-ink">
          {t("product_faq_applied_shared_title")}
        </h3>
        {faq.mode === "CUSTOM" ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              {t("product_faq_applied_shared_custom")}
            </p>
            {sharedError ? (
              <p role="alert" className="text-sm text-red-700">
                {sharedError}
              </p>
            ) : null}
            <Button
              variant="secondary"
              size="md"
              disabled={sharedItems === null || appliedShared.length === 0}
              onClick={copySharedItems}
            >
              {t("product_faq_copy_shared")}
            </Button>
            <p className="text-xs leading-relaxed text-ink-muted">
              {t("product_faq_copy_shared_hint")}
            </p>
          </div>
        ) : sharedError ? (
          <p role="alert" className="text-sm text-red-700">
            {sharedError}
          </p>
        ) : sharedItems === null ? (
          <div
            className="h-12 animate-pulse rounded-lg border border-border bg-card"
            aria-label={t("common_loading")}
          />
        ) : appliedShared.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            {t("product_faq_applied_shared_empty")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-secondary">
            {appliedShared.map((item) => (
              <li key={item.id} className="truncate">
                {item.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        aria-labelledby={previewTitleId}
      >
        <div>
          <h3 id={previewTitleId} className="text-sm font-semibold text-ink">
            {previewLabel}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t("product_faq_preview_description")}
          </p>
        </div>
        {sharedItems === null && faq.mode !== "CUSTOM" ? (
          sharedError ? (
            <p className="text-sm text-red-700">{sharedError}</p>
          ) : (
            <div
              className="h-20 animate-pulse rounded-lg border border-border bg-card"
              aria-label={t("common_loading")}
            />
          )
        ) : effectivePreview.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            {t("product_faq_preview_empty")}
          </p>
        ) : (
          <ProductFaqSection items={effectivePreview} />
        )}
      </section>

      {faq.mode === "SHARED" && faq.items.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-ink-secondary">
          {t("product_faq_shared_empty")}
        </p>
      ) : null}

      <div className="space-y-4" aria-labelledby={itemsTitleId}>
        <div>
          <h3 id={itemsTitleId} className="text-sm font-semibold text-ink">
            {t("product_faq_product_items_title")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t("product_faq_product_items_description")}
          </p>
        </div>
        {faq.items.map((item, index) => (
          <article
            key={item.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <strong className="text-sm text-ink">
                {t("product_faq_item_number", { number: index + 1 })}
              </strong>
              <div className="flex gap-2">
                <Button
                  variant="text"
                  size="md"
                  className="h-auto min-w-0 px-0 text-xs"
                  disabled={index === 0}
                  aria-label={t("product_faq_move_up")}
                  onClick={() => moveItem(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="text"
                  size="md"
                  className="h-auto min-w-0 px-0 text-xs"
                  disabled={index === faq.items.length - 1}
                  aria-label={t("product_faq_move_down")}
                  onClick={() => moveItem(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="text"
                  size="md"
                  className="h-auto min-w-0 px-0 text-xs text-red-700"
                  aria-label={t("product_faq_remove")}
                  onClick={() =>
                    setItems(
                      faq.items.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  {t("product_faq_remove")}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-4">
              <Field
                label={t("product_faq_question_label")}
                htmlFor={`product-faq-title-${item.id}`}
              >
                <TextInput
                  id={`product-faq-title-${item.id}`}
                  value={item.title}
                  maxLength={200}
                  onChange={(event) =>
                    updateItem(index, { title: event.target.value })
                  }
                />
              </Field>
              <Field
                label={t("product_faq_answer_label")}
                hint={t("product_faq_answer_hint")}
                htmlFor={`product-faq-answer-${item.id}`}
              >
                <FaqAnswerInput
                  id={`product-faq-answer-${item.id}`}
                  answer={item.answer}
                  onChange={(answer) => updateItem(index, { answer })}
                />
              </Field>
              <div className="flex flex-wrap gap-5 text-sm text-ink-secondary">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) =>
                      updateItem(index, { enabled: event.target.checked })
                    }
                  />
                  {t("product_faq_enabled")}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.defaultOpen}
                    onChange={(event) =>
                      updateItem(index, { defaultOpen: event.target.checked })
                    }
                  />
                  {t("product_faq_default_open")}
                </label>
              </div>
            </div>
          </article>
        ))}
        <Button
          variant="secondary"
          size="md"
          onClick={() => setItems([...faq.items, newItem(faq.items.length)])}
        >
          {t("product_faq_add")}
        </Button>
      </div>

      {confirmOpen ? (
        <Dialog
          open
          title={t("product_faq_unsaved_title")}
          onClose={() => setConfirmOpen(false)}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {t("product_faq_unsaved_body")}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setConfirmOpen(false)}
              >
                {t("product_faq_unsaved_stay")}
              </Button>
              <Button size="md" onClick={() => router.push(managementHref)}>
                {t("product_faq_unsaved_continue")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
