"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "./Field";
import { ImageUrlInput } from "./ImageUrlInput";
import type { HeroStyleInput } from "@/lib/admin-api";
import type { HeroStyle } from "@/lib/api";

/**
 * Hero appearance editor, shared by the category and collection dialogs —
 * they configure the same HeroStyle row shape and the storefront renders both
 * through one component.
 *
 * The form is all-strings like the rest of the admin forms; serializeHeroStyle
 * turns it into the API payload (or null = "no custom styling, use defaults").
 */

export type HeroBackgroundTypeValue = "SOLID" | "IMAGE";

export interface HeroStyleFormValue {
  /** Blank = use the category/collection name. */
  titleOverride: string;
  /** "" = theme default, otherwise #rrggbb. */
  titleColor: string;
  /** "" = theme default, otherwise desktop px. */
  titleSize: string;
  /** "" = default brand face. */
  titleFont: string;
  backgroundType: HeroBackgroundTypeValue;
  backgroundColor: string;
  backgroundImageUrl: string;
  /** "0"–"24". */
  backgroundBlur: string;
}

/** The payload shape accepted by the category/collection endpoints lives in
 *  lib/admin-api as HeroStyleInput; this form only produces it. */

export function emptyHeroStyleFormValue(): HeroStyleFormValue {
  return {
    titleOverride: "",
    titleColor: "",
    titleSize: "",
    titleFont: "",
    backgroundType: "SOLID",
    backgroundColor: "",
    backgroundImageUrl: "",
    backgroundBlur: "0",
  };
}

export function toHeroStyleFormValue(
  style:
    | {
        titleOverride?: string | null;
        titleColor?: string | null;
        titleSize?: number | null;
        titleFont?: string | null;
        backgroundType?: HeroBackgroundTypeValue | null;
        backgroundColor?: string | null;
        backgroundImageUrl?: string | null;
        backgroundBlur?: number | null;
      }
    | null
    | undefined,
): HeroStyleFormValue {
  if (!style) return emptyHeroStyleFormValue();
  return {
    titleOverride: style.titleOverride ?? "",
    titleColor: style.titleColor ?? "",
    titleSize: style.titleSize === null || style.titleSize === undefined ? "" : String(style.titleSize),
    titleFont: style.titleFont ?? "",
    backgroundType: style.backgroundType ?? "SOLID",
    backgroundColor: style.backgroundColor ?? "",
    backgroundImageUrl: style.backgroundImageUrl ?? "",
    backgroundBlur: String(style.backgroundBlur ?? 0),
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Adapts the all-strings form value into the storefront HeroStyle shape, so
 * the live preview can render the real HeroBanner component rather than a
 * lookalike.
 */
export function heroStyleFromForm(v: HeroStyleFormValue): HeroStyle {
  return {
    titleOverride: v.titleOverride.trim() || null,
    titleColor: v.titleColor.trim() || null,
    titleSize: v.titleSize.trim() ? Number(v.titleSize) : null,
    titleFont: v.titleFont.trim() || null,
    backgroundType: v.backgroundType,
    backgroundColor: v.backgroundColor.trim() || null,
    backgroundImageUrl: v.backgroundImageUrl.trim() || null,
    backgroundBlur: Number(v.backgroundBlur.trim() || "0"),
  };
}

/**
 * Returns `null` when nothing is customised, which makes the API delete the
 * stored row instead of persisting an all-defaults one.
 */
export function serializeHeroStyle(
  v: HeroStyleFormValue,
): { ok: true; value: HeroStyleInput | null } | { ok: false; error: string } {
  const titleOverride = v.titleOverride.trim();
  const titleColor = v.titleColor.trim();
  const titleSize = v.titleSize.trim();
  const titleFont = v.titleFont.trim();
  const backgroundColor = v.backgroundColor.trim();
  const backgroundImageUrl = v.backgroundImageUrl.trim();
  const blur = Number(v.backgroundBlur.trim() || "0");

  if (titleColor && !HEX.test(titleColor)) {
    return { ok: false, error: "标题颜色必须是 #rrggbb 格式。" };
  }
  if (backgroundColor && !HEX.test(backgroundColor)) {
    return { ok: false, error: "背景颜色必须是 #rrggbb 格式。" };
  }
  if (titleSize) {
    const size = Number(titleSize);
    if (!Number.isInteger(size) || size < 16 || size > 96) {
      return { ok: false, error: "标题字号需为 16–96 之间的整数。" };
    }
  }
  if (!Number.isInteger(blur) || blur < 0 || blur > 24) {
    return { ok: false, error: "背景模糊度需为 0–24 之间的整数。" };
  }
  if (v.backgroundType === "IMAGE" && !backgroundImageUrl) {
    return { ok: false, error: "背景类型选了图片，请填写或上传背景图。" };
  }

  const isDefault =
    !titleOverride &&
    !titleColor &&
    !titleSize &&
    !titleFont &&
    v.backgroundType === "SOLID" &&
    !backgroundColor &&
    !backgroundImageUrl &&
    blur === 0;
  if (isDefault) return { ok: true, value: null };

  return {
    ok: true,
    value: {
      titleOverride: titleOverride || null,
      titleColor: titleColor || null,
      titleSize: titleSize ? Number(titleSize) : null,
      titleFont: titleFont || null,
      backgroundType: v.backgroundType,
      backgroundColor: backgroundColor || null,
      backgroundImageUrl: backgroundImageUrl || null,
      backgroundBlur: blur,
    },
  };
}

/** A colour well plus a way back to "theme default" (the empty string). */
function ColorField({
  id,
  label,
  hint,
  value,
  fallback,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  fallback: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-border bg-card"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <TextInput
          aria-label={`${label} hex`}
          value={value}
          placeholder="默认"
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          autoComplete="off"
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-ink-secondary hover:border-cta hover:text-cta disabled:opacity-60"
          onClick={() => onChange("")}
          disabled={disabled || value === ""}
        >
          默认
        </button>
      </div>
    </Field>
  );
}

export function HeroStyleFields({
  value,
  onChange,
  disabled = false,
  idPrefix,
  namePlaceholder,
}: {
  value: HeroStyleFormValue;
  onChange: (patch: Partial<HeroStyleFormValue>) => void;
  disabled?: boolean;
  /** Keeps element ids unique when two editors are mounted at once. */
  idPrefix: string;
  /** The category/collection name, shown as the title's placeholder. */
  namePlaceholder?: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-ink-muted">
        标题默认居中显示。不填任何内容时使用站点默认样式；改了任意一项就会保存为这个页面专属的样式。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="标题文字"
          htmlFor={`${idPrefix}-title`}
          hint="留空则用类目/集合名称。"
        >
          <TextInput
            id={`${idPrefix}-title`}
            value={value.titleOverride}
            placeholder={namePlaceholder ?? ""}
            onChange={(e) => onChange({ titleOverride: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </Field>
        <Field label="字体" htmlFor={`${idPrefix}-font`} hint="品牌字体为 LUWAG 的 Poppins。">
          <Select
            id={`${idPrefix}-font`}
            value={value.titleFont}
            onChange={(e) => onChange({ titleFont: e.target.value })}
            disabled={disabled}
          >
            <option value="">默认（品牌字体）</option>
            <option value="brand">品牌 Poppins</option>
            <option value="sans">系统无衬线</option>
            <option value="serif">衬线</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField
          id={`${idPrefix}-title-color`}
          label="标题颜色"
          hint="留空为默认深色；有背景图时默认白色。"
          value={value.titleColor}
          fallback="#1f1a17"
          onChange={(titleColor) => onChange({ titleColor })}
          disabled={disabled}
        />
        <Field
          label="标题字号（桌面端 px）"
          htmlFor={`${idPrefix}-title-size`}
          hint="16–96，留空为默认。手机端会自适应缩小。"
        >
          <TextInput
            id={`${idPrefix}-title-size`}
            inputMode="numeric"
            value={value.titleSize}
            placeholder="默认"
            onChange={(e) => onChange({ titleSize: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="背景类型" htmlFor={`${idPrefix}-bg-type`}>
        <Select
          id={`${idPrefix}-bg-type`}
          value={value.backgroundType}
          onChange={(e) =>
            onChange({ backgroundType: e.target.value as HeroBackgroundTypeValue })
          }
          disabled={disabled}
        >
          <option value="SOLID">纯色</option>
          <option value="IMAGE">背景图片</option>
        </Select>
      </Field>

      {value.backgroundType === "IMAGE" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="背景图片"
            htmlFor={`${idPrefix}-bg-image`}
            hint="可粘贴网址，或点「上传图片」从电脑选图。建议宽 1600px 以上。"
          >
            <ImageUrlInput
              id={`${idPrefix}-bg-image`}
              value={value.backgroundImageUrl}
              onChange={(backgroundImageUrl) => onChange({ backgroundImageUrl })}
              disabled={disabled}
            />
          </Field>
          <Field
            label="背景模糊度"
            htmlFor={`${idPrefix}-bg-blur`}
            hint="0–24。只模糊背景层，标题保持清晰。"
          >
            <div className="flex items-center gap-3">
              <input
                id={`${idPrefix}-bg-blur`}
                type="range"
                min={0}
                max={24}
                step={1}
                className="w-full accent-[var(--color-cta)]"
                value={value.backgroundBlur}
                onChange={(e) => onChange({ backgroundBlur: e.target.value })}
                disabled={disabled}
              />
              <span className="w-10 shrink-0 text-sm text-ink-secondary">
                {value.backgroundBlur || "0"}
              </span>
            </div>
          </Field>
        </div>
      ) : (
        <ColorField
          id={`${idPrefix}-bg-color`}
          label="背景颜色"
          hint="留空为透明（页面底色）。"
          value={value.backgroundColor}
          fallback="#faf8f5"
          onChange={(backgroundColor) => onChange({ backgroundColor })}
          disabled={disabled}
        />
      )}
    </div>
  );
}
