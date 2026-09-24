"use client";

import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "./ImageUrlInput";
import {
  freshClientKey,
  validateAdminCatalogGraph,
  type AdminCatalogGraphDraft,
  type AdminOptionDraft,
  type AdminOptionValueDraft,
  type EntityRef,
} from "@/lib/admin-product-graph";

const OPTION_KINDS: AdminOptionDraft["kind"][] = [
  "COLOR",
  "SIZE",
  "MATERIAL",
  "STYLE",
];
const PRESENTATIONS: AdminOptionDraft["presentation"][] = [
  "TEXT",
  "SWATCH",
  "IMAGE",
];

const KIND_LABEL_KEYS: Record<AdminOptionDraft["kind"], TKey> = {
  COLOR: "product_options_kind_COLOR",
  SIZE: "product_options_kind_SIZE",
  MATERIAL: "product_options_kind_MATERIAL",
  STYLE: "product_options_kind_STYLE",
};
const PRESENTATION_LABEL_KEYS: Record<AdminOptionDraft["presentation"], TKey> = {
  TEXT: "product_options_presentation_TEXT",
  SWATCH: "product_options_presentation_SWATCH",
  IMAGE: "product_options_presentation_IMAGE",
};

function refKey(ref: EntityRef): string {
  return ref.id ?? ref.clientKey ?? "";
}

function pruneRemovedValues(
  draft: AdminCatalogGraphDraft,
  values: AdminOptionValueDraft[],
): void {
  const valueKeys = new Set(values.map(refKey));
  const removedVariantKeys = new Set(
    draft.variants
      .filter((variant) =>
        variant.optionValueRefs.some((ref) => valueKeys.has(refKey(ref))),
      )
      .map(refKey),
  );

  draft.variants = draft.variants.filter(
    (variant) => !removedVariantKeys.has(refKey(variant)),
  );
  draft.media = draft.media.filter(
    (row) =>
      !(row.optionValueRef && valueKeys.has(refKey(row.optionValueRef))) &&
      !(row.variantRef && removedVariantKeys.has(refKey(row.variantRef))),
  );
  if (
    draft.defaultDisplayVariantRef &&
    removedVariantKeys.has(refKey(draft.defaultDisplayVariantRef))
  ) {
    draft.defaultDisplayVariantRef = null;
  }
}

function renumberOptions(draft: AdminCatalogGraphDraft): void {
  draft.options.forEach((option, index) => {
    option.position = index;
    option.values.forEach((value, valueIndex) => {
      value.position = valueIndex;
    });
  });
}

export function ProductOptionsEditor({
  draft,
  onChange,
  pending = false,
  highlightKey = null,
}: {
  draft: AdminCatalogGraphDraft;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
  /** Row the problem rail asked to highlight (option or option-value key). */
  highlightKey?: string | null;
}): React.ReactNode {
  const { t } = useAdminI18n();
  const validation = validateAdminCatalogGraph(draft, t);
  const activeCount = validation.activeOptionCount;
  const atGroupCap = activeCount >= 2;
  const structuralErrors = validation.errors.filter((_, index) => {
    const code = validation.issues[index]?.code;
    return code === "active_option_limit" || code === "candidate_limit";
  });

  const mutate = (fn: (draft: AdminCatalogGraphDraft) => void): void =>
    onChange((next) => {
      fn(next);
      renumberOptions(next);
    });

  const setOption = (index: number, patch: Partial<AdminOptionDraft>): void =>
    mutate((next) => {
      next.options[index] = { ...next.options[index]!, ...patch };
    });

  const setValue = (
    optionIndex: number,
    valueIndex: number,
    patch: Partial<AdminOptionValueDraft>,
  ): void =>
    mutate((next) => {
      const value = next.options[optionIndex]!.values[valueIndex]!;
      next.options[optionIndex]!.values[valueIndex] = { ...value, ...patch };
    });

  const moveOption = (index: number, delta: -1 | 1): void =>
    mutate((next) => {
      const target = index + delta;
      if (target < 0 || target >= next.options.length) return;
      const options = [...next.options];
      [options[index], options[target]] = [options[target]!, options[index]!];
      next.options = options;
    });

  const moveValue = (optionIndex: number, valueIndex: number, delta: -1 | 1): void =>
    mutate((next) => {
      const values = next.options[optionIndex]!.values;
      const target = valueIndex + delta;
      if (target < 0 || target >= values.length) return;
      const reordered = [...values];
      [reordered[valueIndex], reordered[target]] = [
        reordered[target]!,
        reordered[valueIndex]!,
      ];
      next.options[optionIndex]!.values = reordered;
    });

  const addOption = (): void =>
    mutate((next) => {
      next.options.push({
        clientKey: freshClientKey("option", next),
        kind: "COLOR",
        name: "",
        position: next.options.length,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: [],
      });
    });

  const removeOption = (index: number): void =>
    mutate((next) => {
      const option = next.options[index]!;
      if (option.id !== undefined) return;
      pruneRemovedValues(next, option.values);
      next.options.splice(index, 1);
    });

  const addValue = (optionIndex: number): void =>
    mutate((next) => {
      const option = next.options[optionIndex]!;
      option.values.push({
        clientKey: freshClientKey("value", next),
        label: "",
        position: option.values.length,
        swatchHex: null,
        thumbnailUrl: null,
        thumbnailAlt: null,
        isActive: true,
      });
    });

  const removeValue = (optionIndex: number, valueIndex: number): void =>
    mutate((next) => {
      const value = next.options[optionIndex]!.values[valueIndex]!;
      if (value.id !== undefined) return;
      pruneRemovedValues(next, [value]);
      next.options[optionIndex]!.values.splice(valueIndex, 1);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-ink">
          {t("product_options_title")}
          <span className="ml-2 font-normal text-ink-muted">
            {t("product_options_candidate_summary", {
              count: validation.candidateCount,
            })}
          </span>
        </p>
        <button
          type="button"
          className="ml-auto h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={addOption}
          disabled={pending || atGroupCap}
        >
          {t("product_options_add_group")}
        </button>
      </div>
      {atGroupCap ? (
        <p className="text-xs text-ink-muted" role="status">
          {t("product_options_active_cap_notice")}
        </p>
      ) : null}
      {structuralErrors.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          <ul className="list-disc space-y-1 pl-5">
            {structuralErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.options.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("product_options_no_groups")}</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {draft.options.map((option, optionIndex) => {
          const persisted = option.id !== undefined;
          const canActivate = option.isActive || !atGroupCap;
          const groupNumber = optionIndex + 1;
          const optionKey = option.id ?? option.clientKey ?? "";
          return (
            <li
              key={option.id ?? option.clientKey}
              id={`pf-row-${optionKey}`}
              className={`rounded-lg bg-background p-4 ${
                highlightKey === optionKey
                  ? "ring-2 ring-sale ring-offset-2"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-sm font-semibold text-cta disabled:text-ink-muted"
                  onClick={() => moveOption(optionIndex, -1)}
                  disabled={pending || optionIndex === 0}
                  aria-label={t("product_options_move_group_up", {
                    number: groupNumber,
                  })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="text-sm font-semibold text-cta disabled:text-ink-muted"
                  onClick={() => moveOption(optionIndex, 1)}
                  disabled={pending || optionIndex === draft.options.length - 1}
                  aria-label={t("product_options_move_group_down", {
                    number: groupNumber,
                  })}
                >
                  ↓
                </button>
                <span className="text-sm font-semibold text-ink">
                  {t("product_options_group", { number: groupNumber })}
                  {persisted ? "" : ` ${t("product_options_new")}`}
                </span>
                <label className="ml-auto flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={option.isActive}
                    disabled={pending || !canActivate}
                    title={!canActivate ? t("product_options_active_cap_notice") : undefined}
                    onChange={(event) =>
                      setOption(optionIndex, { isActive: event.target.checked })
                    }
                    className="h-4 w-4 accent-cta"
                    aria-label={`${t("product_options_aria_option")} ${groupNumber} ${t(
                      "product_options_aria_enabled",
                    )}`}
                  />
                  {t("product_options_enabled")}
                </label>
                {!persisted ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-red-700 hover:underline"
                    onClick={() => removeOption(optionIndex)}
                    disabled={pending}
                  >
                    {t("product_options_remove_group")}
                  </button>
                ) : null}
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-4">
                <Field
                  label={t("product_options_name")}
                  htmlFor={`pf-option-${optionIndex}-name`}
                >
                  <TextInput
                    id={`pf-option-${optionIndex}-name`}
                    value={option.name}
                    aria-label={`${t("product_options_aria_option")} ${groupNumber} ${t(
                      "product_options_aria_name",
                    )}`}
                    onChange={(event) =>
                      setOption(optionIndex, { name: event.target.value })
                    }
                    autoComplete="off"
                  />
                </Field>
                <Field label={t("product_options_type")}>
                  <Select
                    value={option.kind}
                    aria-label={`${t("product_options_aria_option")} ${groupNumber} ${t(
                      "product_options_aria_type",
                    )}`}
                    onChange={(event) =>
                      setOption(optionIndex, {
                        kind: event.target.value as AdminOptionDraft["kind"],
                      })
                    }
                    disabled={pending}
                  >
                    {OPTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(KIND_LABEL_KEYS[kind])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("product_options_display_style")}>
                  <Select
                    value={option.presentation}
                    aria-label={`${t("product_options_aria_option")} ${groupNumber} ${t(
                      "product_options_aria_display_style",
                    )}`}
                    onChange={(event) =>
                      setOption(optionIndex, {
                        presentation: event.target
                          .value as AdminOptionDraft["presentation"],
                      })
                    }
                    disabled={pending}
                  >
                    {PRESENTATIONS.map((presentation) => (
                      <option key={presentation} value={presentation}>
                        {t(PRESENTATION_LABEL_KEYS[presentation])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end pb-1 text-xs text-ink-muted">
                  {persisted
                    ? t("product_options_group_persisted_help")
                    : t("product_options_group_new_help")}
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold text-ink-secondary">
                  {t("product_options_values")} ({t("product_options_values_enabled_count", {
                    count: option.values.filter((value) => value.isActive).length,
                  })})
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {option.values.map((value, valueIndex) => {
                    const valuePersisted = value.id !== undefined;
                    const showSwatch = option.presentation === "SWATCH";
                    const showThumbnail = option.presentation === "IMAGE";
                    const valueNumber = valueIndex + 1;
                    const valueName = value.label || `${t("product_options_values")} ${valueNumber}`;
                    const missingSwatch =
                      showSwatch &&
                      !/^#[0-9a-fA-F]{6}$/.test(value.swatchHex?.trim() ?? "") &&
                      !value.thumbnailUrl?.trim();
                    const valueKey = value.id ?? value.clientKey ?? "";
                    return (
                      <li
                        key={value.id ?? value.clientKey}
                        id={`pf-row-${valueKey}`}
                        className={`rounded-lg border border-border bg-card p-3 ${
                          highlightKey === valueKey
                            ? "ring-2 ring-sale ring-offset-2"
                            : ""
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="text-sm font-semibold text-cta disabled:text-ink-muted"
                            onClick={() => moveValue(optionIndex, valueIndex, -1)}
                            disabled={pending || valueIndex === 0}
                            aria-label={t("product_options_move_value_up", {
                              number: valueNumber,
                            })}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-sm font-semibold text-cta disabled:text-ink-muted"
                            onClick={() => moveValue(optionIndex, valueIndex, 1)}
                            disabled={pending || valueIndex === option.values.length - 1}
                            aria-label={t("product_options_move_value_down", {
                              number: valueNumber,
                            })}
                          >
                            ↓
                          </button>
                          <TextInput
                            style={{ width: "min(16rem, 100%)" }}
                            value={value.label}
                            placeholder={t("product_options_value_label_placeholder")}
                            aria-label={`${t("product_options_aria_value")} ${valueNumber} ${t(
                              "product_options_aria_label",
                            )}`}
                            onChange={(event) =>
                              setValue(optionIndex, valueIndex, {
                                label: event.target.value,
                              })
                            }
                            autoComplete="off"
                          />
                          <label className="flex items-center gap-1 text-xs font-medium text-ink">
                            <input
                              type="checkbox"
                              checked={value.isActive}
                              disabled={pending}
                              onChange={(event) =>
                                setValue(optionIndex, valueIndex, {
                                  isActive: event.target.checked,
                                })
                              }
                              className="h-4 w-4 accent-cta"
                              aria-label={`${t("product_options_aria_value")} ${valueNumber} ${t(
                                "product_options_aria_enabled",
                              )}`}
                            />
                            {t("product_options_value_enabled")}
                          </label>
                          {!valuePersisted ? (
                            <button
                              type="button"
                              className="text-sm font-semibold text-red-700 hover:underline"
                              onClick={() => removeValue(optionIndex, valueIndex)}
                              disabled={pending}
                            >
                              {t("product_options_remove_value")}
                            </button>
                          ) : null}
                        </div>

                        {showSwatch ? (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <input
                              type="color"
                              value={
                                /^#[0-9a-fA-F]{6}$/.test(value.swatchHex ?? "")
                                  ? value.swatchHex!
                                  : "#ffffff"
                              }
                              aria-label={`${t("product_options_aria_value")} ${valueNumber} ${t(
                                "product_options_aria_swatch",
                              )}`}
                              onChange={(event) =>
                                setValue(optionIndex, valueIndex, {
                                  swatchHex: event.target.value,
                                })
                              }
                              className="h-9 w-12 cursor-pointer rounded border border-border"
                            />
                            <TextInput
                              style={{ width: "10rem" }}
                              value={value.swatchHex ?? ""}
                              placeholder="#ff0000"
                              aria-label={`${t("product_options_aria_value")} ${valueNumber} ${t(
                                "product_options_aria_swatch",
                              )}`}
                              onChange={(event) =>
                                setValue(optionIndex, valueIndex, {
                                  swatchHex: event.target.value || null,
                                })
                              }
                              autoComplete="off"
                            />
                            {missingSwatch ? (
                              <p className="text-xs text-sale" role="status">
                                {t("product_options_swatch_fallback")}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {showThumbnail ? (
                          <div className="mt-2">
                            <Field
                              label={t("product_options_selector_thumbnail")}
                              htmlFor={`pf-option-${optionIndex}-value-${valueIndex}-thumb`}
                              hint={t("product_options_thumbnail_fallback")}
                            >
                              <ImageUrlInput
                                id={`pf-option-${optionIndex}-value-${valueIndex}-thumb`}
                                ariaLabel={`${t("product_options_aria_thumbnail")} ${value.label || `${t(
                                  "product_options_aria_value",
                                )} ${valueNumber}`}`}
                                kind="image"
                                value={value.thumbnailUrl ?? ""}
                                onChange={(url) =>
                                  setValue(optionIndex, valueIndex, {
                                    thumbnailUrl: url || null,
                                  })
                                }
                                disabled={pending}
                              />
                            </Field>
                            <TextInput
                              className="mt-2"
                              value={value.thumbnailAlt ?? ""}
                              placeholder={t("product_options_thumbnail_alt")}
                              aria-label={`${valueName} ${t("product_options_thumbnail_alt")}`}
                              maxLength={255}
                              onChange={(event) =>
                                setValue(optionIndex, valueIndex, {
                                  thumbnailAlt: event.target.value || null,
                                })
                              }
                              autoComplete="off"
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="mt-2 h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                  onClick={() => addValue(optionIndex)}
                  disabled={pending}
                >
                  {t("product_options_add_value")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
