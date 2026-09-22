"use client";

import { useState, type ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "./ImageUrlInput";
import {
  type AdminCatalogGraphDraft,
  type AdminMediaDraft,
} from "@/lib/admin-product-graph";

/**
 * Task 11 — scoped media editor. The gallery tab owns SHARED media (rows are
 * synced into the graph at save time), so shared rows render read-only here
 * with a pointer back to the gallery. This editor manages the two scoped
 * sets:
 *  - option-value media, addressed to the ACTIVE values of the single active
 *    media-driver group (the storefront's value-scope fallback level);
 *  - variant media (the advanced scope), addressed to draft variants by
 *    stable id or client key.
 *
 * Every row carries exactly ONE scope (optionValueRef xor variantRef — the
 * backend's exactly-one-of contract), and each scope set REPLACES rather than
 * merges on resolution. Rows are kept in the draft while the URL is being
 * typed; the save boundary drops URL-less rows (persisted blanks become
 * retirements).
 */

function rowKey(ref: { id?: string; clientKey?: string }): string {
  return ref.id ?? ref.clientKey ?? "";
}

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

export function ProductMediaScopesEditor({
  draft,
  onChange,
  pending = false,
}: {
  draft: AdminCatalogGraphDraft;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  pending?: boolean;
}): ReactNode {
  const shared = draft.media.filter(
    (row) => row.optionValueRef === null && row.variantRef === null,
  );
  const driver = draft.options.find(
    (option) => option.isActive && option.isMediaDriver,
  );
  const [selectedVariant, setSelectedVariant] = useState("");
  const selectedVariantKey =
    selectedVariant ||
    (draft.variants[0] ? rowKey(draft.variants[0]) : "");

  const rowsForValue = (valueKey: string): AdminMediaDraft[] =>
    draft.media
      .filter(
        (row) => row.optionValueRef && rowKey(row.optionValueRef) === valueKey,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const rowsForVariant = (variantKey: string): AdminMediaDraft[] =>
    draft.media
      .filter(
        (row) => row.variantRef && rowKey(row.variantRef) === variantKey,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const addValueMedia = (valueIndex: number): void =>
    onChange((draft) => {
      const value = draft.options
        .find((option) => option.isActive && option.isMediaDriver)
        ?.values[valueIndex];
      if (!value) return;
      draft.media.push({
        clientKey: freshKey("media", draft),
        url: "",
        type: "IMAGE",
        altText: null,
        sortOrder: 0,
        optionValueRef:
          value.id !== undefined
            ? { id: value.id }
            : { clientKey: value.clientKey! },
        variantRef: null,
      });
      renumberScopes(draft);
    });

  const addVariantMedia = (): void =>
    onChange((draft) => {
      const variant = draft.variants.find(
        (item) => rowKey(item) === selectedVariantKey,
      );
      if (!variant) return;
      draft.media.push({
        clientKey: freshKey("media", draft),
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
      renumberScopes(draft);
    });

  const setMedia = (key: string, patch: Partial<AdminMediaDraft>): void =>
    onChange((draft) => {
      const index = draft.media.findIndex(
        (row) => (row.id ?? row.clientKey) === key,
      );
      if (index >= 0) {
        draft.media[index] = { ...draft.media[index]!, ...patch };
      }
    });

  const removeMedia = (key: string): void =>
    onChange((draft) => {
      const index = draft.media.findIndex(
        (row) => (row.id ?? row.clientKey) === key,
      );
      if (index >= 0) draft.media.splice(index, 1);
      renumberScopes(draft);
    });

  const moveMedia = (key: string, delta: -1 | 1): void =>
    onChange((draft) => {
      const row = draft.media.find((item) => (item.id ?? item.clientKey) === key);
      if (!row) return;
      const group = draft.media.filter(
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
      renumberScopes(draft);
    });

  const renderMediaRow = (
    row: AdminMediaDraft,
    scopeLabel: string,
    index: number,
    total: number,
  ): ReactNode => {
    const key = row.id ?? row.clientKey ?? "";
    return (
      <li key={key} className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-sm font-semibold text-cta disabled:text-ink-muted"
            onClick={() => moveMedia(key, -1)}
            disabled={pending || index === 0}
            aria-label={`Move ${scopeLabel} media ${index + 1} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-cta disabled:text-ink-muted"
            onClick={() => moveMedia(key, 1)}
            disabled={pending || index === total - 1}
            aria-label={`Move ${scopeLabel} media ${index + 1} down`}
          >
            ↓
          </button>
          <span className="text-xs font-semibold text-ink-secondary">
            {scopeLabel} media {index + 1}
          </span>
          <select
            aria-label={`Media type for ${scopeLabel} ${index + 1}`}
            className="ml-auto rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            value={row.type}
            onChange={(e) =>
              setMedia(key, {
                type: e.target.value as AdminMediaDraft["type"],
              })
            }
            disabled={pending}
          >
            <option value="IMAGE">IMAGE</option>
            <option value="VIDEO">VIDEO</option>
          </select>
          <button
            type="button"
            className="text-sm font-semibold text-red-700 hover:underline"
            onClick={() => removeMedia(key)}
            disabled={pending}
          >
            Remove
          </button>
        </div>
        <div className="mt-2">
          <ImageUrlInput
            ariaLabel={`Media URL for ${scopeLabel} ${index + 1}`}
            kind={row.type === "VIDEO" ? "video" : "image"}
            value={row.url}
            onChange={(url) => setMedia(key, { url })}
            disabled={pending}
          />
        </div>
        <TextInput
          className="mt-2"
          value={row.altText ?? ""}
          placeholder="Alt text（无障碍/SEO）"
          aria-label={`Alt text for ${scopeLabel} ${index + 1}`}
          maxLength={255}
          onChange={(e) => setMedia(key, { altText: e.target.value || null })}
          autoComplete="off"
        />
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold text-ink">
          Shared media 共享媒体（{shared.length}）
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          共享图片/视频在上方图库编辑，保存时自动同步到商品级媒体；这里只读展示，
          不提供上传入口，避免两处编辑互相覆盖。
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
        <h3 className="text-sm font-semibold text-ink">
          Option-value media 按选项值
        </h3>
        {!driver ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted" role="status">
            需要一个启用的媒体驱动选项组（在选项页勾选「媒体驱动」）才能按值挂媒体；
            前台切换该选项值时整体替换为对应媒体组。
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {driver.values
              .filter((value) => value.isActive)
              .map((value) => {
                const valueIndex = driver.values.indexOf(value);
                const valueKey = value.id ?? value.clientKey ?? "";
                const rows = rowsForValue(valueKey);
                return (
                  <section
                    key={valueKey}
                    className="rounded-lg bg-background p-3"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {value.label}
                      </p>
                      <span className="text-xs text-ink-muted">
                        切换到该值时前台显示此组媒体（替换，不与共享合并）
                      </span>
                      <button
                        type="button"
                        className="ml-auto h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
                        onClick={() => addValueMedia(valueIndex)}
                        disabled={pending}
                      >
                        Add media for {value.label}
                      </button>
                    </div>
                    {rows.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-2">
                        {rows.map((row, index) =>
                          renderMediaRow(
                            row,
                            value.label,
                            index,
                            rows.length,
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">
                        该值暂无专属媒体，前台回退到共享媒体。
                      </p>
                    )}
                  </section>
                );
              })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">
          Variant media 按款式（高级）
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          挂在具体款式上的媒体优先级最高；适合同一颜色下个别款式的细节图/视频。
        </p>
        {draft.variants.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            还没有款式行——先在矩阵里填写候选款式。
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label="Target variant 目标款式">
                <Select
                  aria-label="Variant media target"
                  value={selectedVariantKey}
                  onChange={(e) => setSelectedVariant(e.target.value)}
                  disabled={pending}
                  className="w-64"
                >
                  {draft.variants.map((variant) => (
                    <option key={rowKey(variant)} value={rowKey(variant)}>
                      {variant.name}
                      {variant.id !== undefined ? "" : "（新）"}
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
                Add variant media
              </button>
            </div>
            {selectedVariantKey ? (
              <ul className="mt-2 flex flex-col gap-2">
                {(() => {
                  const target = draft.variants.find(
                    (variant) => rowKey(variant) === selectedVariantKey,
                  );
                  const rows = rowsForVariant(selectedVariantKey);
                  return rows.map((row, index) =>
                    renderMediaRow(
                      row,
                      target?.name ?? "Variant",
                      index,
                      rows.length,
                    ),
                  );
                })()}
              </ul>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
