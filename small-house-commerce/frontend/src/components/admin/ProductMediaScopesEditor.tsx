"use client";

import { useState, type ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
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

export function ProductMediaScopesEditor({
  draft,
  onChange,
  pending = false,
}: {
  draft: AdminCatalogGraphDraft;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  const shared = draft.media.filter(
    (row) => row.optionValueRef === null && row.variantRef === null,
  );
  const activeDriver = draft.options.find(
    (option) => option.isActive && option.isMediaDriver,
  );
  const [selectedVariant, setSelectedVariant] = useState("");
  const variantSelections = draft.variants.map((variant) => ({
    key: variantSemanticKey(draft, variant),
    variant,
  }));
  const selectedVariantEntry =
    variantSelections.find((entry) => entry.key === selectedVariant) ??
    variantSelections[0];
  const selectedVariantSemanticKey = selectedVariantEntry?.key ?? "";
  const selectedVariantRow = selectedVariantEntry?.variant;
  const selectedVariantKey = selectedVariantRow ? rowKey(selectedVariantRow) : "";
  const selectedDriverKey = activeDriver ? rowKey(activeDriver) : "";

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
          current.id !== undefined ? { id: current.id } : { clientKey: current.clientKey! },
        variantRef: null,
      });
      renumberScopes(next);
    });

  const addVariantMedia = (): void =>
    onChange((next) => {
      const variant = next.variants.find(
        (item) =>
          variantSemanticKey(next, item) === selectedVariantSemanticKey,
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
      <li key={key} className="rounded-lg border border-border bg-card p-3">
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
          onChange={(event) => setMedia(key, { altText: event.target.value || null })}
          autoComplete="off"
          disabled={pending}
        />
      </li>
    );
  };

  const activeScopes: OptionValueScope[] = activeDriver
    ? activeDriver.values
        .filter((value) => value.isActive)
        .map((value) => ({
          option: activeDriver,
          value,
          rows: rowsForValue(rowKey(value)),
        }))
    : [];

  const inactiveScopes: OptionValueScope[] = draft.options.flatMap((option) =>
    option.values.flatMap((value) => {
      const rows = rowsForValue(rowKey(value));
      const isCurrentActiveValue =
        activeDriver !== undefined &&
        rowKey(activeDriver) === rowKey(option) &&
        value.isActive;
      return rows.length > 0 && !isCurrentActiveValue
        ? [{ option, value, rows }]
        : [];
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold text-ink">
          {t("product_media_shared_title")} ({t("product_media_shared_count", { count: shared.length })})
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {t("product_media_shared_description")}
        </p>
        {shared.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {shared.map((row) => (
              <li
                key={row.id ?? row.clientKey}
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
        <h3 className="text-sm font-semibold text-ink">{t("product_media_option_title")}</h3>
        <div className="mt-2 max-w-md">
          <Field label={t("product_media_option_selector")}>
            <Select
              aria-label={t("product_media_option_selector")}
              value={selectedDriverKey}
              onChange={(event) => setDriver(event.target.value)}
              disabled={pending}
            >
              <option value="">{t("product_media_no_option_switch")}</option>
              {draft.options
                .filter((option) => option.isActive)
                .map((option) => (
                  <option key={rowKey(option)} value={rowKey(option)}>
                    {option.name || t("product_media_option_title")}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {!activeDriver ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted" role="status">
            {t("product_media_choose_option")}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {activeScopes.map(({ value, rows }) => {
              const scopeLabel = value.label || t("product_media_option_title");
              return (
                <section
                  key={rowKey(value)}
                  className="rounded-lg bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{value.label}</p>
                    <span className="text-xs text-ink-muted">
                      {t("product_media_replace_description")}
                    </span>
                    <button
                      type="button"
                      className="ml-auto h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                      onClick={() => addValueMedia(value)}
                      disabled={pending}
                    >
                      {t("product_media_add_value", { name: value.label })}
                    </button>
                  </div>
                  {rows.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-2">
                      {rows.map((row, index) =>
                        renderMediaRow(row, scopeLabel, index, rows.length),
                      )}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">
                      {t("product_media_no_value_media")}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      {inactiveScopes.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {t("product_media_inactive_title")}
          </summary>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t("product_media_inactive_description")}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {inactiveScopes.map(({ option, value, rows }) => {
              const key = rowKey(value);
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {t("product_media_scope_source", {
                        option: option.name || t("product_media_option_title"),
                        value: value.label,
                      })}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {t("product_media_inactive_count", { count: rows.length })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-sm font-semibold text-red-700 hover:underline"
                    onClick={() => removeScope("option", key)}
                    disabled={pending}
                  >
                    {t("product_media_remove_scope")}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold text-ink">{t("product_media_exact_title")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {t("product_media_exact_description")}
        </p>
        {draft.variants.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {t("product_media_variant_empty")}
          </p>
        ) : (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              {t("product_media_exact_title")}
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label={t("product_media_target_variant")}>
                <Select
                  aria-label={t("product_media_target_variant")}
                  value={selectedVariantSemanticKey}
                  onChange={(event) => setSelectedVariant(event.target.value)}
                  disabled={pending}
                  className="w-64"
                >
                  {variantSelections.map(({ key, variant }) => (
                    <option key={rowKey(variant)} value={key}>
                      {variant.name}
                      {variant.id !== undefined ? "" : ` ${t("product_media_new")}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <button
                type="button"
                className="mb-1 h-11 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                onClick={addVariantMedia}
                disabled={pending}
              >
                {t("product_media_add_variant")}
              </button>
            </div>
            {selectedVariantKey ? (
              <ul className="mt-2 flex flex-col gap-2">
                {(() => {
                  const target = draft.variants.find(
                    (variant) => rowKey(variant) === selectedVariantKey,
                  );
                  const rows = rowsForVariant(selectedVariantKey);
                  return rows.length > 0 ? (
                    rows.map((row, index) =>
                      renderMediaRow(
                        row,
                        target?.name ?? t("product_media_exact_title"),
                        index,
                        rows.length,
                      ),
                    )
                  ) : (
                    <li className="text-xs text-ink-muted">
                      {t("product_media_exact_empty")}
                    </li>
                  );
                })()}
              </ul>
            ) : null}
          </details>
        )}
      </section>
    </div>
  );
}
