"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "./ImageUrlInput";
import {
  validateAdminCatalogGraph,
  type AdminCatalogGraphDraft,
  type AdminOptionDraft,
  type AdminOptionValueDraft,
} from "@/lib/admin-product-graph";

/**
 * Task 11 — typed option group editor (zero-to-two active groups).
 *
 * Global constraints are enforced in the UI, not just at save time:
 *  - third-option blocking: a third group cannot be activated (and none can
 *    be added) while two are active;
 *  - candidate cap: the live candidate count is shown and a >100 product of
 *    active values renders as a validation alert;
 *  - one media driver: other groups' media-driver switch locks while an
 *    active driver exists;
 *  - protected disable: persisted rows can only be deactivated (hard removal
 *    is the server's reconcile decision); draft-only rows remove outright.
 *
 * Positions are the array index within each list and are renumbered on every
 * structural change (add/remove/move), so display order and stored positions
 * cannot drift.
 */

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

const KIND_LABELS: Record<AdminOptionDraft["kind"], string> = {
  COLOR: "COLOR — 颜色",
  SIZE: "SIZE — 尺寸",
  MATERIAL: "MATERIAL — 材质",
  STYLE: "STYLE — 款式",
};
const PRESENTATION_LABELS: Record<AdminOptionDraft["presentation"], string> = {
  TEXT: "TEXT — 文字按钮",
  SWATCH: "SWATCH — 色块",
  IMAGE: "IMAGE — 缩略图",
};

/** A request-local unique client key for a browser-created row. */
function freshKey(prefix: string, draft: AdminCatalogGraphDraft): string {
  // Row identity spans BOTH id and clientKey spaces (rows are addressed by
  // `id ?? clientKey`), so a fresh key must dodge every id too — not just the
  // other client keys.
  const used = new Set<string>();
  for (const option of draft.options) {
    if (option.id) used.add(option.id);
    if (option.clientKey) used.add(option.clientKey);
    for (const value of option.values) {
      if (value.id) used.add(value.id);
      if (value.clientKey) used.add(value.clientKey);
    }
  }
  for (const variant of draft.variants) {
    if (variant.id) used.add(variant.id);
    if (variant.clientKey) used.add(variant.clientKey);
  }
  for (const media of draft.media) {
    if (media.id) used.add(media.id);
    if (media.clientKey) used.add(media.clientKey);
  }
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
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
}: {
  draft: AdminCatalogGraphDraft;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
}): ReactNode {
  const validation = validateAdminCatalogGraph(draft);
  const activeCount = validation.activeOptionCount;
  const atGroupCap = activeCount >= 2;
  const hasActiveDriver = draft.options.some(
    (option) => option.isActive && option.isMediaDriver,
  );
  // Only the structural blockers render as live alerts; label noise is left
  // to the save-time validation so half-typed rows don't scream.
  const structuralErrors = validation.errors.filter(
    (error) =>
      error.includes("at most two active option groups") ||
      error.includes("the limit is 100") ||
      error.includes("produce"),
  );

  const mutate = (fn: (draft: AdminCatalogGraphDraft) => void): void =>
    onChange((draft) => {
      fn(draft);
      renumberOptions(draft);
    });

  const setOption = (index: number, patch: Partial<AdminOptionDraft>): void =>
    mutate((draft) => {
      draft.options[index] = { ...draft.options[index]!, ...patch };
    });

  const setValue = (
    optionIndex: number,
    valueIndex: number,
    patch: Partial<AdminOptionValueDraft>,
  ): void =>
    mutate((draft) => {
      const value = draft.options[optionIndex]!.values[valueIndex]!;
      draft.options[optionIndex]!.values[valueIndex] = { ...value, ...patch };
    });

  const moveOption = (index: number, delta: -1 | 1): void =>
    mutate((draft) => {
      const j = index + delta;
      if (j < 0 || j >= draft.options.length) return;
      const next = [...draft.options];
      [next[index], next[j]] = [next[j]!, next[index]!];
      draft.options = next;
    });

  const moveValue = (
    optionIndex: number,
    valueIndex: number,
    delta: -1 | 1,
  ): void =>
    mutate((draft) => {
      const values = draft.options[optionIndex]!.values;
      const j = valueIndex + delta;
      if (j < 0 || j >= values.length) return;
      const next = [...values];
      [next[valueIndex], next[j]] = [next[j]!, next[valueIndex]!];
      draft.options[optionIndex]!.values = next;
    });

  const addOption = (): void =>
    mutate((draft) => {
      draft.options.push({
        clientKey: freshKey("option", draft),
        kind: "COLOR",
        name: "",
        position: draft.options.length,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: [],
      });
    });

  const removeOption = (index: number): void =>
    mutate((draft) => {
      const option = draft.options[index]!;
      if (option.id !== undefined) {
        // Persisted group: never hard-removed from the client — deactivation
        // is the reversible path (the server retires on the next diff).
        option.isActive = false;
        return;
      }
      draft.options.splice(index, 1);
    });

  const addValue = (optionIndex: number): void =>
    mutate((draft) => {
      const option = draft.options[optionIndex]!;
      option.values.push({
        clientKey: freshKey("value", draft),
        label: "",
        position: option.values.length,
        swatchHex: null,
        thumbnailUrl: null,
        thumbnailAlt: null,
        isActive: true,
      });
    });

  const removeValue = (optionIndex: number, valueIndex: number): void =>
    mutate((draft) => {
      const value = draft.options[optionIndex]!.values[valueIndex]!;
      if (value.id !== undefined) {
        // Protected disable: a persisted value deactivates; only the server
        // decides whether an unreferenced row is actually deleted.
        value.isActive = false;
        return;
      }
      draft.options[optionIndex]!.values.splice(valueIndex, 1);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-ink">
          Option groups 选项组
          <span className="ml-2 font-normal text-ink-muted">
            候选款式：{validation.candidateCount}（最多 100，最多 2 个启用组）
          </span>
        </p>
        <button
          type="button"
          className="ml-auto h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
          onClick={addOption}
          disabled={pending || atGroupCap}
        >
          Add option group
        </button>
      </div>
      {atGroupCap ? (
        <p className="text-xs text-ink-muted" role="status">
          最多同时启用两个选项组——先停用一个组才能启用第三个。
        </p>
      ) : null}
      {structuralErrors.length > 0 ? (
        <div role="alert" className="rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700">
          <ul className="list-disc space-y-1 pl-5">
            {structuralErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.options.length === 0 ? (
        <p className="text-sm text-ink-muted">
          还没有选项组。无选项时商品只有一个「Default」候选款式；添加选项组可生成颜色/尺寸组合。
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {draft.options.map((option, optionIndex) => {
          const persisted = option.id !== undefined;
          const canActivate = option.isActive || !atGroupCap;
          const driverLocked =
            option.isActive && hasActiveDriver && !option.isMediaDriver;
          return (
            <li
              key={option.id ?? option.clientKey}
              className="rounded-lg bg-background p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-sm font-semibold text-cta disabled:text-ink-muted"
                  onClick={() => moveOption(optionIndex, -1)}
                  disabled={pending || optionIndex === 0}
                  aria-label={`Move option ${optionIndex + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="text-sm font-semibold text-cta disabled:text-ink-muted"
                  onClick={() => moveOption(optionIndex, 1)}
                  disabled={pending || optionIndex === draft.options.length - 1}
                  aria-label={`Move option ${optionIndex + 1} down`}
                >
                  ↓
                </button>
                <span className="text-sm font-semibold text-ink">
                  Group {optionIndex + 1}
                  {persisted ? "" : "（新）"}
                </span>
                <label className="ml-auto flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={option.isMediaDriver}
                    disabled={pending || driverLocked}
                    onChange={(e) =>
                      setOption(optionIndex, { isMediaDriver: e.target.checked })
                    }
                    className="h-4 w-4 accent-cta"
                    aria-label={`Option ${optionIndex + 1} media driver`}
                  />
                  媒体驱动（按值切换图片）
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={option.isActive}
                    disabled={pending || !canActivate}
                    title={
                      !canActivate
                        ? "最多同时启用两个选项组"
                        : undefined
                    }
                    onChange={(e) =>
                      setOption(optionIndex, { isActive: e.target.checked })
                    }
                    className="h-4 w-4 accent-cta"
                    aria-label={`Option ${optionIndex + 1} active`}
                  />
                  启用
                </label>
                <button
                  type="button"
                  className="text-sm font-semibold text-red-700 hover:underline"
                  onClick={() => removeOption(optionIndex)}
                  disabled={pending}
                  title={
                    persisted
                      ? "已保存的选项组只能停用（数据保留，可重新启用）"
                      : undefined
                  }
                >
                  {persisted ? "Deactivate（停用）" : "Remove"}
                </button>
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-4">
                <Field label="Group name 名称" htmlFor={`pf-option-${optionIndex}-name`}>
                  <TextInput
                    id={`pf-option-${optionIndex}-name`}
                    value={option.name}
                    aria-label={`Option ${optionIndex + 1} name`}
                    onChange={(e) =>
                      setOption(optionIndex, { name: e.target.value })
                    }
                    autoComplete="off"
                  />
                </Field>
                <Field label="Kind 类型">
                  <Select
                    value={option.kind}
                    aria-label={`Option ${optionIndex + 1} kind`}
                    onChange={(e) =>
                      setOption(optionIndex, {
                        kind: e.target.value as AdminOptionDraft["kind"],
                      })
                    }
                  >
                    {OPTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABELS[kind]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Presentation 展示">
                  <Select
                    value={option.presentation}
                    aria-label={`Option ${optionIndex + 1} presentation`}
                    onChange={(e) =>
                      setOption(optionIndex, {
                        presentation: e.target
                          .value as AdminOptionDraft["presentation"],
                      })
                    }
                  >
                    {PRESENTATIONS.map((presentation) => (
                      <option key={presentation} value={presentation}>
                        {PRESENTATION_LABELS[presentation]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end pb-1 text-xs text-ink-muted">
                  {persisted
                    ? "已保存组：停用后可重新启用；删除由系统在保存时处理。"
                    : "新组：保存后创建。"}
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold text-ink-secondary">
                  Values 选项值（{option.values.filter((v) => v.isActive).length} 启用）
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {option.values.map((value, valueIndex) => {
                    const valuePersisted = value.id !== undefined;
                    const showSwatch = option.presentation === "SWATCH";
                    const showThumbnail = option.presentation === "IMAGE";
                    const missingThumbnail =
                      showThumbnail && !value.thumbnailUrl?.trim();
                    const missingSwatch =
                      showSwatch &&
                      !value.swatchHex?.trim() &&
                      !value.thumbnailUrl?.trim();
                    return (
                      <li
                        key={value.id ?? value.clientKey}
                        className="rounded-lg border border-border bg-card p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="text-sm font-semibold text-cta disabled:text-ink-muted"
                            onClick={() => moveValue(optionIndex, valueIndex, -1)}
                            disabled={pending || valueIndex === 0}
                            aria-label={`Move value ${valueIndex + 1} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-sm font-semibold text-cta disabled:text-ink-muted"
                            onClick={() => moveValue(optionIndex, valueIndex, 1)}
                            disabled={pending || valueIndex === option.values.length - 1}
                            aria-label={`Move value ${valueIndex + 1} down`}
                          >
                            ↓
                          </button>
                          <TextInput
                            style={{ width: "min(16rem, 100%)" }}
                            value={value.label}
                            placeholder="如 Red / 3-Tier"
                            aria-label={`Value ${valueIndex + 1} label`}
                            onChange={(e) =>
                              setValue(optionIndex, valueIndex, {
                                label: e.target.value,
                              })
                            }
                            autoComplete="off"
                          />
                          <label className="flex items-center gap-1 text-xs font-medium text-ink">
                            <input
                              type="checkbox"
                              checked={value.isActive}
                              disabled={pending}
                              onChange={(e) =>
                                setValue(optionIndex, valueIndex, {
                                  isActive: e.target.checked,
                                })
                              }
                              className="h-4 w-4 accent-cta"
                              aria-label={`Value ${valueIndex + 1} active`}
                            />
                            启用
                          </label>
                          <button
                            type="button"
                            className="text-sm font-semibold text-red-700 hover:underline"
                            onClick={() => removeValue(optionIndex, valueIndex)}
                            disabled={pending}
                            title={
                              valuePersisted
                                ? "已保存的选项值只能停用（历史引用的值由系统停用保留）"
                                : undefined
                            }
                          >
                            {valuePersisted ? "Deactivate（停用）" : "Remove"}
                          </button>
                        </div>

                        {showSwatch ? (
                          <div className="mt-2 flex items-center gap-3">
                            <input
                              type="color"
                              value={
                                /^#[0-9a-fA-F]{6}$/.test(value.swatchHex ?? "")
                                  ? value.swatchHex!
                                  : "#ffffff"
                              }
                              aria-label={`Value ${valueIndex + 1} swatch color`}
                              onChange={(e) =>
                                setValue(optionIndex, valueIndex, {
                                  swatchHex: e.target.value,
                                })
                              }
                              className="h-9 w-12 cursor-pointer rounded border border-border"
                            />
                            <TextInput
                              style={{ width: "10rem" }}
                              value={value.swatchHex ?? ""}
                              placeholder="#ff0000"
                              aria-label={`Value ${valueIndex + 1} swatch hex`}
                              onChange={(e) =>
                                setValue(optionIndex, valueIndex, {
                                  swatchHex: e.target.value || null,
                                })
                              }
                              autoComplete="off"
                            />
                            {missingSwatch ? (
                              <p className="text-xs text-sale" role="status">
                                SWATCH 值建议填写色块颜色或缩略图，否则前台回退为文字。
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {showThumbnail ? (
                          <div className="mt-2">
                            <Field
                              label="Thumbnail 缩略图"
                              htmlFor={`pf-option-${optionIndex}-value-${valueIndex}-thumb`}
                            >
                              <ImageUrlInput
                                id={`pf-option-${optionIndex}-value-${valueIndex}-thumb`}
                                ariaLabel={`Thumbnail for ${value.label || `Value ${valueIndex + 1}`}`}
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
                              placeholder="Thumbnail alt text（无障碍）"
                              aria-label={`Thumbnail alt for ${value.label || `Value ${valueIndex + 1}`}`}
                              maxLength={255}
                              onChange={(e) =>
                                setValue(optionIndex, valueIndex, {
                                  thumbnailAlt: e.target.value || null,
                                })
                              }
                              autoComplete="off"
                            />
                            {missingThumbnail ? (
                              <p className="mt-1 text-xs text-sale" role="status">
                                IMAGE 展示的选项值建议上传缩略图，缺失时前台回退为文字。
                              </p>
                            ) : null}
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
                  Add value
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
