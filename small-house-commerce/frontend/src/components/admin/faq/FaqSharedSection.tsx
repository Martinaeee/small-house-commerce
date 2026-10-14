"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/admin/Badge";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  ADMIN_FAQ_CATEGORIES,
  type AdminFaqCategory,
  type AdminFaqItem,
} from "@/lib/admin-api";
import {
  FAQ_CATEGORY_LABEL_KEYS,
  answerSummary,
  faqCategoryOf,
  formatUpdatedAt,
  itemMatchesFilters,
  type FaqRowFilters,
} from "./faq-view";
import { RowMenu } from "./RowMenu";

/**
 * Shared questions as a lightweight category accordion. Rows stay read-only and
 * dense; editing and destructive actions remain behind dialogs and More menus.
 */
export function FaqSharedSection({
  items,
  usage,
  loading,
  error,
  saving,
  filters,
  categoryFilter,
  canEdit,
  onEdit,
  onDuplicate,
  onMove,
  onToggle,
  onDelete,
  onReload,
}: {
  items: AdminFaqItem[];
  usage: { productCount: number } | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  filters: FaqRowFilters;
  categoryFilter: AdminFaqCategory | "all";
  canEdit: boolean;
  onEdit: (item: AdminFaqItem) => void;
  onDuplicate: (item: AdminFaqItem) => void;
  onMove: (item: AdminFaqItem, direction: -1 | 1) => void;
  onToggle: (item: AdminFaqItem) => void;
  onDelete: (item: AdminFaqItem) => void;
  onReload: () => void;
}): ReactNode {
  const { t, lang } = useAdminI18n();
  const [openCategories, setOpenCategories] = useState<
    ReadonlySet<AdminFaqCategory>
  >(new Set(ADMIN_FAQ_CATEGORIES));
  const onToggleCategory = (category: AdminFaqCategory) =>
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const visible = items.filter((item) => itemMatchesFilters(item, filters));
  const groups = ADMIN_FAQ_CATEGORIES.filter(
    (category) => categoryFilter === "all" || category === categoryFilter,
  )
    .map((category) => ({
      category,
      items: visible.filter((item) => faqCategoryOf(item) === category),
    }))
    .filter((group) => group.items.length > 0);

  const isMoveDisabled = (item: AdminFaqItem, direction: -1 | 1) => {
    const siblings = items.filter(
      (candidate) => faqCategoryOf(candidate) === faqCategoryOf(item),
    );
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    return (
      saving ||
      index < 0 ||
      (direction === -1 ? index === 0 : index === siblings.length - 1)
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="faq-shared-section-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h2
            id="faq-shared-section-title"
            className="text-base font-semibold text-ink"
          >
            {t("faq_shared_section_title")}
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {t("faq_shared_section_description")}
          </p>
        </div>
        <dl className="flex shrink-0 divide-x divide-border text-right">
          <div data-testid="faq-shared-question-count" className="pr-4">
            <dt className="text-[12.5px] font-medium text-ink-muted">
              {t("faq_metric_questions")}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold leading-none text-ink">
              {items.length}
            </dd>
          </div>
          <div data-testid="faq-shared-product-count" className="pl-4">
            <dt className="text-[12.5px] font-medium text-ink-muted">
              {t("faq_metric_applied_products")}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold leading-none text-ink">
              {usage?.productCount ?? 0}
            </dd>
          </div>
        </dl>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-y border-sale/30 bg-sale/5 p-4 text-sm text-red-700"
        >
          {error}
          <Button
            variant="text"
            size="md"
            className="h-auto min-w-0 px-0 text-red-700"
            onClick={onReload}
          >
            {t("faq_reload")}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div
          className="h-24 animate-pulse border-y border-border bg-card"
          aria-label={t("common_loading")}
        />
      ) : items.length === 0 ? (
        <p className="border-y border-border bg-background p-4 text-sm text-ink-secondary">
          {t("faq_empty_shared")}
        </p>
      ) : groups.length === 0 ? (
        <p className="border-y border-border bg-background p-4 text-sm text-ink-secondary">
          {t("faq_empty_filtered")}
        </p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {groups.map((group) => (
            <details
              key={group.category}
              open={openCategories.has(group.category)}
              className="group"
            >
              <summary
                className="flex cursor-pointer items-center justify-between gap-3 px-2 py-2.5 hover:bg-background/80"
                onClick={(event) => {
                  event.preventDefault();
                  onToggleCategory(group.category);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="text-xs text-ink-muted transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                  <span className="truncate text-sm font-semibold text-ink">
                    {t(FAQ_CATEGORY_LABEL_KEYS[group.category])}
                  </span>
                </span>
                <span className="rounded-full bg-background px-2 py-0.5 text-[12.5px] font-medium text-ink-muted">
                  {t("faq_shared_category_count", {
                    count: group.items.length,
                  })}
                </span>
              </summary>
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-t border-border bg-background/50 text-left text-[12.5px] font-semibold text-ink-muted">
                      <th className="px-3 py-2 font-semibold">
                        {t("faq_dialog_question")}
                      </th>
                      <th className="w-24 px-2 py-2 font-semibold">
                        {t("faq_dialog_status")}
                      </th>
                      <th className="w-36 px-2 py-2 font-semibold">
                        {t("faq_filter_updated")}
                      </th>
                      <th className="w-48 px-3 py-2 text-right font-semibold">
                        {t("faq_row_more")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr
                        key={item.id}
                        className="h-14 border-t border-border/80 align-middle hover:bg-background/40"
                      >
                        <td className="max-w-0 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 truncate text-sm font-medium text-ink">
                              {item.title}
                            </span>
                            <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-ink-muted">
                              {item.audience?.scope === "PRODUCTS"
                                ? t("faq_audience_selected_count", { count: item.audience.productIds.length })
                                : t("faq_audience_all")}
                            </span>
                          </div>
                          <span className="mt-0.5 block truncate text-[12.5px] leading-4 text-ink-muted">
                            {answerSummary(item.answer)}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            value={
                              item.enabled
                                ? t("faq_status_enabled")
                                : t("faq_status_disabled")
                            }
                            tone={item.enabled ? "green" : "neutral"}
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-[12.5px] text-ink-secondary">
                          {formatUpdatedAt(
                            item.updatedAt,
                            lang,
                            t("faq_updated_unknown"),
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-sm font-semibold text-ink-secondary hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`${t("faq_row_move_up")} — ${item.title}`}
                                  disabled={isMoveDisabled(item, -1)}
                                  onClick={() => onMove(item, -1)}
                                >
                                  <span aria-hidden="true">↑</span>
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-sm font-semibold text-ink-secondary hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`${t("faq_row_move_down")} — ${item.title}`}
                                  disabled={isMoveDisabled(item, 1)}
                                  onClick={() => onMove(item, 1)}
                                >
                                  <span aria-hidden="true">↓</span>
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap px-2 text-xs font-semibold text-cta underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted"
                                  aria-label={`${t("faq_row_edit")} — ${item.title}`}
                                  disabled={saving}
                                  onClick={() => onEdit(item)}
                                >
                                  {t("faq_row_edit")}
                                </button>
                                <RowMenu
                                  label={`${t("faq_row_more")} — ${item.title}`}
                                  disabled={saving}
                                  actions={[
                                    {
                                      label: t("faq_row_duplicate"),
                                      ariaLabel: `${t("faq_row_duplicate")} — ${item.title}`,
                                      onAction: () => onDuplicate(item),
                                    },
                                    {
                                      label: item.enabled
                                        ? t("faq_row_disable")
                                        : t("faq_row_enable"),
                                      ariaLabel: `${item.enabled ? t("faq_row_disable") : t("faq_row_enable")} — ${item.title}`,
                                      onAction: () => onToggle(item),
                                    },
                                    {
                                      label: t("faq_row_delete"),
                                      ariaLabel: `${t("faq_row_delete")} — ${item.title}`,
                                      destructive: true,
                                      onAction: () => onDelete(item),
                                    },
                                  ]}
                                />
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
