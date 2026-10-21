"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/admin/Badge";
import { Pagination } from "@/components/admin/Pagination";
import { Button } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { AdminFaqItem, AdminFaqProductGroup } from "@/lib/admin-api";
import {
  FAQ_MODE_BADGE_KEYS,
  answerSummary,
  formatUpdatedAt,
  itemMatchesFilters,
  type FaqRowFilters,
} from "./faq-view";
import { RowMenu } from "./RowMenu";

/**
 * Product-specific questions grouped by product. Product identity, counts and
 * mode remain scannable while secondary navigation and row actions stay in More.
 */
export function FaqProductSection({
  groups,
  total,
  page,
  pageSize,
  loading,
  error,
  filters,
  savingIds,
  canEdit,
  onAdd,
  onEditItem,
  onDuplicateItem,
  onToggleItem,
  onDeleteItem,
  onSettings,
  onPage,
  onReload,
}: {
  groups: AdminFaqProductGroup[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  filters: FaqRowFilters;
  savingIds: ReadonlySet<string>;
  canEdit: boolean;
  onAdd: (group: AdminFaqProductGroup) => void;
  onEditItem: (group: AdminFaqProductGroup, item: AdminFaqItem) => void;
  onDuplicateItem: (group: AdminFaqProductGroup, item: AdminFaqItem) => void;
  onToggleItem: (group: AdminFaqProductGroup, item: AdminFaqItem) => void;
  onDeleteItem: (group: AdminFaqProductGroup, item: AdminFaqItem) => void;
  onSettings: (group: AdminFaqProductGroup) => void;
  onPage: (page: number) => void;
  onReload: () => void;
}): ReactNode {
  const { t, lang } = useAdminI18n();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (productId: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  const questionCount = groups.reduce(
    (count, group) => count + group.faq.items.length,
    0,
  );

  return (
    <section className="space-y-3" aria-labelledby="faq-product-section-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h2
            id="faq-product-section-title"
            className="text-base font-semibold text-ink"
          >
            {t("faq_product_section_title")}
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {t("faq_product_section_description")}
          </p>
        </div>
        <dl className="flex shrink-0 divide-x divide-border text-right">
          <div data-testid="faq-product-count" className="pr-4">
            <dt className="text-[12.5px] font-medium text-ink-muted">
              {t("faq_metric_products")}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold leading-none text-ink">
              {total}
            </dd>
          </div>
          <div data-testid="faq-product-question-count" className="pl-4">
            <dt className="text-[12.5px] font-medium text-ink-muted">
              {t("faq_metric_questions")}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold leading-none text-ink">
              {questionCount}
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
      ) : groups.length === 0 ? (
        <p className="border-y border-border bg-background p-4 text-sm text-ink-secondary">
          {t("faq_empty_product")}
        </p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {groups.map((group) => {
            const saving = savingIds.has(group.product.id);
            const rows = group.faq.items.filter((item) =>
              itemMatchesFilters(item, filters),
            );
            return (
              <details
                key={group.product.id}
                open={openGroups.has(group.product.id)}
                className="group"
              >
                <summary
                  className="flex cursor-pointer flex-wrap items-center gap-3 px-2 py-3 hover:bg-background/70"
                  onClick={(event) => {
                    event.preventDefault();
                    toggleGroup(group.product.id);
                  }}
                >
                  {group.product.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
                    <img
                      src={group.product.thumbnailUrl}
                      alt={group.product.thumbnailAlt ?? ""}
                      className="h-11 w-11 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <PlaceholderImage
                      label={group.product.name}
                      className="h-11 w-11 shrink-0 overflow-hidden rounded-md"
                    />
                  )}
                  <span className="min-w-44 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {group.product.name}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-muted">
                      {group.product.productCode ?? t("faq_picker_no_code")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      value={t("faq_shared_category_count", {
                        count: group.faq.items.length,
                      })}
                      tone="neutral"
                    />
                    <Badge
                      value={t(FAQ_MODE_BADGE_KEYS[group.faq.mode])}
                      tone="neutral"
                    />
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {canEdit ? (
                      <>
                        <Button
                          size="md"
                          className="h-10 min-w-0 px-4 text-sm"
                          aria-label={`${t("faq_add_product_faq")} — ${group.product.name}`}
                          disabled={saving}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onAdd(group);
                          }}
                        >
                          + {t("faq_add_faq")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="md"
                          className="h-10 min-w-0 px-4 text-sm"
                          aria-label={`${t("faq_faq_settings")} — ${group.product.name}`}
                          disabled={saving}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onSettings(group);
                          }}
                        >
                          {t("faq_faq_settings")}
                        </Button>
                      </>
                    ) : null}
                    <RowMenu
                      label={`${t("faq_row_more")} — ${group.product.name}`}
                      actions={[
                        {
                          label: t("faq_open_product"),
                          ariaLabel: `${t("faq_open_product")} — ${group.product.name}`,
                          href: `/admin/products/${group.product.id}/edit`,
                        },
                      ]}
                    />
                  </span>
                </summary>
                <div className="border-t border-border bg-card/40">
                  {rows.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-ink-secondary">
                      {t("faq_empty_filtered")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-[720px] w-full table-fixed text-sm">
                        <thead>
                          <tr className="bg-background/50 text-left text-[12.5px] font-semibold text-ink-muted">
                            <th className="px-3 py-2 font-semibold">
                              {t("faq_dialog_question")}
                            </th>
                            <th className="w-24 px-2 py-2 font-semibold">
                              {t("faq_dialog_status")}
                            </th>
                            <th className="w-36 px-2 py-2 font-semibold">
                              {t("faq_filter_updated")}
                            </th>
                            <th className="w-28 px-3 py-2 text-right font-semibold">
                              {t("faq_row_more")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((item) => (
                            <tr
                              key={item.id}
                              className="h-14 border-t border-border/80 align-middle hover:bg-background/40"
                            >
                              <td className="max-w-0 px-3 py-2">
                                <span className="block truncate text-sm font-medium text-ink">
                                  {item.title}
                                </span>
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
                                        className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap px-2 text-xs font-semibold text-cta underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted"
                                        aria-label={`${t("faq_row_edit")} — ${item.title}`}
                                        disabled={saving}
                                        onClick={() => onEditItem(group, item)}
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
                                            onAction: () => onDuplicateItem(group, item),
                                          },
                                          {
                                            label: item.enabled
                                              ? t("faq_row_disable")
                                              : t("faq_row_enable"),
                                            ariaLabel: `${item.enabled ? t("faq_row_disable") : t("faq_row_enable")} — ${item.title}`,
                                            onAction: () =>
                                              onToggleItem(group, item),
                                          },
                                          {
                                            label: t("faq_row_delete"),
                                            ariaLabel: `${t("faq_row_delete")} — ${item.title}`,
                                            destructive: true,
                                            onAction: () =>
                                              onDeleteItem(group, item),
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
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {total > pageSize ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onChange={onPage}
        />
      ) : null}
    </section>
  );
}
