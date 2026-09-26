"use client";

import { useState, type ReactNode } from "react";
import { Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "./ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  entityRowKey as rowKey,
  freshClientKey,
  type AdminCatalogGraphDraft,
  type AdminMediaDraft,
  type AdminOptionDraft,
  type AdminOptionValueDraft,
  type AdminVariantDraft,
} from "@/lib/admin-product-graph";
import {
  impactedSkuCount,
  summarizeAdminMedia,
  summarizeVariantMediaResolution,
} from "@/lib/admin-product-media-summary";

/** Renumbers every scoped set's sortOrder from its list order (0-based). */
function renumberScopes(draft: AdminCatalogGraphDraft): void {
  const groups = new Map<string, AdminMediaDraft[]>();
  for (const row of draft.media) {
    if (row.optionValueRef === null && row.variantRef === null) continue;
    const key = row.optionValueRef
      ? `v:${rowKey(row.optionValueRef)}`
      : `t:${rowKey(row.variantRef!)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder);
    group.forEach((row, index) => {
      row.sortOrder = index;
    });
  }
}

interface OptionValueScope {
  option: AdminOptionDraft;
  value: AdminOptionValueDraft;
  rows: AdminMediaDraft[];
  active: boolean;
}

function variantSemanticKey(
  draft: AdminCatalogGraphDraft,
  variant: AdminVariantDraft,
): string {
  const values = variant.optionValueRefs
    .map((ref) => {
      for (const option of draft.options) {
        const value = option.values.find(
          (candidate) => rowKey(candidate) === rowKey(ref),
        );
        if (value) {
          return [
            option.position,
            option.kind,
            option.name.trim(),
            value.position,
            value.label.trim(),
          ].join(":");
        }
      }
      return `unresolved:${rowKey(ref)}`;
    })
    .sort();

  return values.length > 0
    ? values.join("|")
    : `variant:${variant.position}:${variant.name.trim()}`;
}

interface SharedSummaryMediaRow
  extends Pick<AdminMediaDraft, "url" | "type" | "altText"> {
  id?: string;
  clientKey?: string;
}

export function ProductMediaScopesEditor({
  draft,
  sharedMedia = null,
  onChange,
  pending = false,
  highlightKey = null,
}: {
  draft: AdminCatalogGraphDraft;
  sharedMedia?: readonly SharedSummaryMediaRow[] | null;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
  /** Media row the problem rail asked to highlight. */
  highlightKey?: string | null;
}): ReactNode {
  const { t } = useAdminI18n();
  const persistedShared = draft.media.filter(
    (row) => row.optionValueRef === null && row.variantRef === null,
  );
  const shared: readonly SharedSummaryMediaRow[] =
    sharedMedia ?? persistedShared;
  const activeOptions = draft.options.filter((option) => option.isActive);
  const activeDriver = activeOptions.find((option) => option.isMediaDriver);
  const [selectedVariant, setSelectedVariant] = useState("");
  const variantSelections = draft.variants.map((variant) => ({
    key: variantSemanticKey(draft, variant),
    variant,
  }));
  const selectedVariantSemanticKey = variantSelections.some(
    (entry) => entry.key === selectedVariant,
  )
    ? selectedVariant
    : "";
  const highlightedMedia = highlightKey
    ? draft.media.find((row) => rowKey(row) === highlightKey)
    : undefined;
  const highlightedValueKey = highlightedMedia?.optionValueRef
    ? rowKey(highlightedMedia.optionValueRef)
    : "";
  const highlightedVariantKey = highlightedMedia?.variantRef
    ? rowKey(highlightedMedia.variantRef)
    : "";
  const highlightedVariantSemanticKey = highlightedVariantKey
    ? (variantSelections.find(
        ({ variant }) => rowKey(variant) === highlightedVariantKey,
      )?.key ?? "")
    : "";
  const openVariantSemanticKey =
    highlightedVariantSemanticKey || selectedVariantSemanticKey;

  const rowsForValue = (valueKey: string): AdminMediaDraft[] =>
    draft.media
      .filter(
        (row) => row.optionValueRef && rowKey(row.optionValueRef) === valueKey,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const rowsForVariant = (variantKey: string): AdminMediaDraft[] =>
    draft.media
      .filter((row) => row.variantRef && rowKey(row.variantRef) === variantKey)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const setDriver = (optionKey: string): void =>
    onChange((next) => {
      next.options.forEach((option) => {
        option.isMediaDriver = false;
      });
      if (!optionKey) return;
      const option = next.options.find(
        (candidate) => candidate.isActive && rowKey(candidate) === optionKey,
      );
      if (option) option.isMediaDriver = true;
    });

  const addValueMedia = (value: AdminOptionValueDraft): void =>
    onChange((next) => {
      const current = next.options
        .find((option) => option.isActive && option.isMediaDriver)
        ?.values.find((candidate) => rowKey(candidate) === rowKey(value));
      if (!current) return;
      next.media.push({
        clientKey: freshClientKey("media", next),
        url: "",
        type: "IMAGE",
        altText: null,
        sortOrder: 0,
        optionValueRef:
          current.id !== undefined
            ? { id: current.id }
            : { clientKey: current.clientKey! },
        variantRef: null,
      });
      renumberScopes(next);
    });

  const addVariantMedia = (): void =>
    onChange((next) => {
      const variant = next.variants.find(
        (item) =>
          variantSemanticKey(next, item) === openVariantSemanticKey,
      );
      if (!variant) return;
      next.media.push({
        clientKey: freshClientKey("media", next),
        url: "",
        type: "IMAGE",
        altText: null,
        sortOrder: 0,
        optionValueRef: null,
        variantRef:
          variant.id !== undefined
            ? { id: variant.id }
            : { clientKey: variant.clientKey! },
      });
      renumberScopes(next);
    });

  const setMedia = (key: string, patch: Partial<AdminMediaDraft>): void =>
    onChange((next) => {
      const index = next.media.findIndex((row) => rowKey(row) === key);
      if (index >= 0) next.media[index] = { ...next.media[index]!, ...patch };
    });

  const removeMedia = (key: string): void =>
    onChange((next) => {
      const index = next.media.findIndex((row) => rowKey(row) === key);
      if (index >= 0) next.media.splice(index, 1);
      renumberScopes(next);
    });

  const removeScope = (scope: "option" | "variant", key: string): void =>
    onChange((next) => {
      next.media = next.media.filter((row) => {
        const ref = scope === "option" ? row.optionValueRef : row.variantRef;
        return !ref || rowKey(ref) !== key;
      });
      renumberScopes(next);
    });

  const moveMedia = (key: string, delta: -1 | 1): void =>
    onChange((next) => {
      const row = next.media.find((item) => rowKey(item) === key);
      if (!row) return;
      const group = next.media.filter(
        (item) =>
          (item.optionValueRef !== null) === (row.optionValueRef !== null) &&
          (item.variantRef !== null) === (row.variantRef !== null) &&
          rowKey(row.optionValueRef ?? row.variantRef!) ===
            rowKey(item.optionValueRef ?? item.variantRef!),
      );
      const ordered = [...group].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.indexOf(row);
      const target = ordered[index + delta];
      if (!target) return;
      const rowOrder = row.sortOrder;
      row.sortOrder = target.sortOrder;
      target.sortOrder = rowOrder;
      renumberScopes(next);
    });

  const renderMediaRow = (
    row: AdminMediaDraft,
    scopeLabel: string,
    index: number,
    total: number,
  ): ReactNode => {
    const key = rowKey(row);
    return (
      <li
        key={key}
        id={`pf-row-${key}`}
        className={`rounded-lg border border-border bg-card p-3 ${
          highlightKey === key ? "ring-2 ring-sale ring-offset-2" : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="text-sm font-semibold text-cta disabled:text-ink-muted"
            onClick={() => moveMedia(key, -1)}
            disabled={pending || index === 0}
            aria-label={t("product_media_move_up", {
              scope: scopeLabel,
              number: index + 1,
            })}
          >
            ↑
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-cta disabled:text-ink-muted"
            onClick={() => moveMedia(key, 1)}
            disabled={pending || index === total - 1}
            aria-label={t("product_media_move_down", {
              scope: scopeLabel,
              number: index + 1,
            })}
          >
            ↓
          </button>
          <span className="text-xs font-semibold text-ink-secondary">
            {scopeLabel} {index + 1}
          </span>
          <Select
            aria-label={t("product_media_media_type", {
              scope: scopeLabel,
              number: index + 1,
            })}
            className="ml-auto w-auto py-1.5 text-sm"
            value={row.type}
            onChange={(event) =>
              setMedia(key, {
                type: event.target.value as AdminMediaDraft["type"],
              })
            }
            disabled={pending}
          >
            <option value="IMAGE">{t("product_media_type_image")}</option>
            <option value="VIDEO">{t("product_media_type_video")}</option>
          </Select>
          <button
            type="button"
            className="text-sm font-semibold text-red-700 hover:underline"
            onClick={() => removeMedia(key)}
            disabled={pending}
          >
            {t("product_media_remove")}
          </button>
        </div>
        <div className="mt-2">
          <ImageUrlInput
            ariaLabel={t("product_media_url", {
              scope: scopeLabel,
              number: index + 1,
            })}
            kind={row.type === "VIDEO" ? "video" : "image"}
            value={row.url}
            onChange={(url) => setMedia(key, { url })}
            problemFocus={highlightKey === key}
            disabled={pending}
          />
        </div>
        <TextInput
          className="mt-2"
          value={row.altText ?? ""}
          placeholder={t("product_media_alt_placeholder")}
          aria-label={t("product_media_alt", {
            scope: scopeLabel,
            number: index + 1,
          })}
          maxLength={255}
          onChange={(event) =>
            setMedia(key, { altText: event.target.value || null })
          }
          autoComplete="off"
          disabled={pending}
        />
      </li>
    );
  };

  const currentScopeKeys = new Set<string>();
  const activeScopes: OptionValueScope[] = activeDriver
    ? activeDriver.values
        .filter((value) => value.isActive)
        .map((value) => {
          currentScopeKeys.add(rowKey(value));
          return {
            option: activeDriver,
            value,
            rows: rowsForValue(rowKey(value)),
            active: true,
          };
        })
    : [];
  const legacyScopes: OptionValueScope[] = draft.options.flatMap((option) =>
    option.values.flatMap((value) => {
      const key = rowKey(value);
      const rows = rowsForValue(key);
      return rows.length > 0 && !currentScopeKeys.has(key)
        ? [{ option, value, rows, active: false }]
        : [];
    }),
  );
  const optionScopes = [...activeScopes, ...legacyScopes];

  const summaryPills = (rows: readonly AdminMediaDraft[]): ReactNode => {
    const summary = summarizeAdminMedia(rows);
    return (
      <span className="flex flex-wrap gap-1.5 text-xs text-ink-secondary">
        <span className="rounded-full bg-card px-2 py-0.5">
          {t("product_media_summary_rows", { count: summary.rowCount })}
        </span>
        <span className="rounded-full bg-card px-2 py-0.5">
          {t("product_media_summary_usable", { count: summary.usableCount })}
        </span>
        <span className="rounded-full bg-card px-2 py-0.5">
          {t("product_media_summary_images", { count: summary.imageCount })}
        </span>
        <span className="rounded-full bg-card px-2 py-0.5">
          {t("product_media_summary_videos", { count: summary.videoCount })}
        </span>
        <span className="rounded-full bg-card px-2 py-0.5">
          {t("product_media_summary_alt", {
            complete: summary.altCompleteCount,
            total: summary.rowCount,
          })}
        </span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold text-ink">
          {t("product_media_shared_title")} (
          {t("product_media_shared_count", { count: shared.length })})
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {t("product_media_shared_description")}
        </p>
        {shared.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {shared
              .filter((row) => row.url.trim() !== "")
              .map((row, index) => (
              <li
                key={row.id ?? row.clientKey ?? `shared-${index}-${row.url}`}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                {row.type === "VIDEO" ? (
                  <video
                    src={row.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-16 w-16 object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnails; no optimizer domain allowlist.
                  <img
                    src={row.url}
                    alt={row.altText ?? ""}
                    className="h-16 w-16 object-cover"
                    referrerPolicy="no-referrer"
                  />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">
          {t("product_media_driver_title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {t("product_media_driver_hint")}
        </p>
        <div
          role="group"
          aria-label={t("product_media_driver_aria")}
          className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          <button
            type="button"
            aria-label={t("product_media_driver_shared")}
            aria-pressed={activeDriver === undefined}
            onClick={() => setDriver("")}
            disabled={pending}
            className={`rounded-xl border p-3 text-left transition-colors ${
              activeDriver === undefined
                ? "border-cta bg-primary-light/35 ring-1 ring-cta"
                : "border-border bg-card hover:border-primary"
            }`}
          >
            <span className="block text-sm font-semibold text-ink">
              {t("product_media_driver_shared")}
            </span>
            <span className="mt-1 block text-xs text-ink-muted">
              {t("product_media_driver_sku_count", {
                count: impactedSkuCount(draft, null),
              })}
            </span>
          </button>
          {activeOptions.map((option) => {
            const selected = rowKey(option) === rowKey(activeDriver ?? {});
            const name = option.name || t("product_media_option_title");
            return (
              <button
                type="button"
                aria-label={name}
                aria-pressed={selected}
                key={rowKey(option)}
                onClick={() => setDriver(rowKey(option))}
                disabled={pending}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? "border-cta bg-primary-light/35 ring-1 ring-cta"
                    : "border-border bg-card hover:border-primary"
                }`}
              >
                <span className="block text-sm font-semibold text-ink">
                  {name}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {t("product_media_driver_sku_count", {
                    count: impactedSkuCount(draft, option),
                  })}
                </span>
              </button>
            );
          })}
        </div>
        {activeDriver === undefined ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {t("product_media_driver_shared_note")}
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">
          {t("product_media_option_title")}
        </h3>
        {optionScopes.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted" role="status">
            {t("product_media_choose_option")}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {optionScopes.map(({ option, value, rows, active }) => {
              const valueKey = rowKey(value);
              const optionName = option.name || t("product_media_option_title");
              const valueName = value.label || t("product_media_option_title");
              const summary = summarizeAdminMedia(rows);
              return (
                <details
                  key={valueKey}
                  open={highlightedValueKey === valueKey || undefined}
                  onToggle={(event) => {
                    if (
                      !event.currentTarget.open ||
                      highlightedValueKey !== valueKey
                    ) {
                      return;
                    }
                    const details = event.currentTarget;
                    queueMicrotask(() => {
                      details
                        .querySelector<HTMLElement>("[data-problem-focus]")
                        ?.focus();
                    });
                  }}
                  className="rounded-xl border border-border bg-background"
                >
                  <summary
                    aria-label={t("product_media_scope_summary_aria", {
                      option: optionName,
                      value: valueName,
                    })}
                    className="cursor-pointer list-none p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {valueName}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-admin-success-soft text-admin-success"
                            : "bg-admin-warning-soft text-admin-warning"
                        }`}
                      >
                        {active
                          ? t("product_media_scope_active")
                          : t("product_media_scope_inactive")}
                      </span>
                    </span>
                    <span className="mt-2 block">{summaryPills(rows)}</span>
                    <span className="mt-2 block text-xs leading-relaxed text-ink-muted">
                      {summary.usableCount > 0
                        ? t("product_media_scope_replaces")
                        : t("product_media_scope_fallback")}
                    </span>
                  </summary>
                  <div className="border-t border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs leading-relaxed text-ink-muted">
                        {t("product_media_replace_description")}
                      </p>
                      {active ? (
                        <button
                          type="button"
                          className="ml-auto h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                          onClick={() => addValueMedia(value)}
                          disabled={pending}
                        >
                          {t("product_media_add_value", { name: valueName })}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ml-auto text-sm font-semibold text-red-700 hover:underline"
                          onClick={() => removeScope("option", valueKey)}
                          disabled={pending}
                        >
                          {t("product_media_remove_scope")}
                        </button>
                      )}
                    </div>
                    {rows.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-2">
                        {rows.map((row, index) =>
                          renderMediaRow(row, valueName, index, rows.length),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs text-ink-muted">
                        {t("product_media_no_value_media")}
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">
          {t("product_media_exact_title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {t("product_media_exact_description")}
        </p>
        {variantSelections.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {t("product_media_variant_empty")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {variantSelections.map(({ key, variant }) => {
              const variantKey = rowKey(variant);
              const rows = rowsForVariant(variantKey);
              const resolution = summarizeVariantMediaResolution(
                draft,
                variant,
                shared,
              );
              let sourceLabel: string;
              if (resolution.source === "EXACT") {
                sourceLabel = t("product_media_exact_source_exact", {
                  count: resolution.count,
                });
              } else if (
                resolution.source === "OPTION_VALUE" &&
                resolution.optionValueRef
              ) {
                const resolvedValue = draft.options
                  .flatMap((option) => option.values)
                  .find(
                    (value) =>
                      rowKey(value) === rowKey(resolution.optionValueRef!),
                  );
                sourceLabel = t("product_media_exact_source_value", {
                  value:
                    resolvedValue?.label || t("product_media_option_title"),
                  count: resolution.count,
                });
              } else {
                sourceLabel = t("product_media_exact_source_shared", {
                  count: resolution.count,
                });
              }
              return (
                <li key={key}>
                  <details
                    open={openVariantSemanticKey === key}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setSelectedVariant((current) =>
                        isOpen ? key : current === key ? "" : current,
                      );
                      if (
                        isOpen &&
                        highlightedVariantSemanticKey === key
                      ) {
                        const details = event.currentTarget;
                        queueMicrotask(() => {
                          details
                            .querySelector<HTMLElement>(
                              "[data-problem-focus]",
                            )
                            ?.focus();
                        });
                      }
                    }}
                    className="rounded-xl border border-border bg-background"
                  >
                    <summary
                      aria-label={t("product_media_exact_summary_aria", {
                        variant: variant.name,
                      })}
                      className="cursor-pointer list-none p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {variant.name}
                          {variant.id === undefined
                            ? ` ${t("product_media_new")}`
                            : ""}
                        </span>
                        <span className="text-xs font-semibold text-ink-secondary">
                          {sourceLabel}
                        </span>
                      </span>
                    </summary>
                    <div className="border-t border-border p-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                          onClick={addVariantMedia}
                          disabled={pending}
                        >
                          {t("product_media_add_variant")}
                        </button>
                      </div>
                      {rows.length > 0 ? (
                        <ul className="mt-3 flex flex-col gap-2">
                          {rows.map((row, index) =>
                            renderMediaRow(
                              row,
                              variant.name || t("product_media_exact_title"),
                              index,
                              rows.length,
                            ),
                          )}
                        </ul>
                      ) : (
                        <p className="mt-3 text-xs text-ink-muted">
                          {t("product_media_exact_empty")}
                        </p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
