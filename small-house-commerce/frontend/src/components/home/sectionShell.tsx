import Link from "next/link";
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { HomepageSectionStyle } from "@/lib/api";
import type { HomepageDevice } from "@/lib/homepage-document";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function finitePadding(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(240, value))
    : undefined;
}

export function normalizeSectionStyle(value: unknown, includeOverrides = true): HomepageSectionStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const style = value as Record<string, unknown>;
  const paddingTop = finitePadding(style.paddingTop);
  const paddingBottom = finitePadding(style.paddingBottom);
  const normalized: HomepageSectionStyle = {
    ...(typeof style.backgroundColor === "string" && HEX_COLOR.test(style.backgroundColor)
      ? { backgroundColor: style.backgroundColor }
      : {}),
    ...(typeof style.textColor === "string" && HEX_COLOR.test(style.textColor)
      ? { textColor: style.textColor }
      : {}),
    ...(style.contentWidth === "FULL" ||
    style.contentWidth === "STANDARD" ||
    style.contentWidth === "NARROW"
      ? { contentWidth: style.contentWidth }
      : {}),
    ...(paddingTop !== undefined ? { paddingTop } : {}),
    ...(paddingBottom !== undefined ? { paddingBottom } : {}),
  };
  if (includeOverrides && style.overrides && typeof style.overrides === "object" && !Array.isArray(style.overrides)) {
    for (const device of ["tablet", "mobile"] as const) {
      const fields = normalizeSectionStyle((style.overrides as Record<string, unknown>)[device], false);
      if (Object.keys(fields).length > 0) (normalized.overrides ??= {})[device] = fields;
    }
  }
  return normalized;
}

const STYLE_CSS_FIELDS = {
  backgroundColor: "background-color", textColor: "text-color", contentWidth: "content-width",
  paddingTop: "padding-top", paddingBottom: "padding-bottom",
} as const;
const CONTENT_WIDTHS = { FULL: "none", STANDARD: "1200px", NARROW: "840px" } as const;

export function sectionStylePresentation(value: unknown, previewDevice?: HomepageDevice): {
  style: CSSProperties;
  widthClass: string;
  responsiveClass: string;
  textColorClass: string;
} {
  const normalized = normalizeSectionStyle(value);
  const { overrides, ...common } = normalized;
  const style = { ...common, ...(previewDevice && previewDevice !== "desktop" ? overrides?.[previewDevice] : {}) };
  const widthClass =
    style.contentWidth === "FULL"
      ? "max-w-none"
      : style.contentWidth === "NARROW"
        ? "max-w-[840px]"
        : "max-w-[1200px]";
  const textColorClass = style.textColor
    ? "[&_*]:!text-[var(--section-text-color)]"
    : "";
  const inlineStyle: CSSProperties = {
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.textColor
      ? { color: style.textColor, "--section-text-color": style.textColor }
      : {}),
    ...(style.contentWidth !== undefined
      ? { "--hp-config-content-width": CONTENT_WIDTHS[style.contentWidth] }
      : {}),
    ...(style.paddingTop !== undefined ? { paddingTop: style.paddingTop } : {}),
    ...(style.paddingBottom !== undefined ? { paddingBottom: style.paddingBottom } : {}),
  };
  const variables: Record<string, string | number> = {};
  const classes = ["hp-section-frame"];
  for (const device of ["desktop", "tablet", "mobile"] as const) {
    const width = (device === "desktop" ? undefined : overrides?.[device]?.contentWidth) ?? common.contentWidth;
    variables[`--hp-gutter-${device}`] = width === "FULL" ? "0px" : device === "mobile" ? "32px" : "48px";
  }
  if (previewDevice) {
    variables["--hp-section-gutters"] = variables[`--hp-gutter-${previewDevice}`];
  } else {
    for (const device of ["tablet", "mobile"] as const) {
      const fields = overrides?.[device];
      if (!fields) continue;
      for (const key of Object.keys(STYLE_CSS_FIELDS) as (keyof typeof STYLE_CSS_FIELDS)[]) {
        const value = fields[key];
        if (value === undefined) continue;
        const name = `hp-style-${device}-${STYLE_CSS_FIELDS[key]}`;
        classes.push(name);
        variables[`--${name}`] = key === "contentWidth" ? CONTENT_WIDTHS[value as keyof typeof CONTENT_WIDTHS]
          : typeof value === "number" ? `${value}px` : value;
      }
    }
  }
  return { style: { ...inlineStyle, ...variables } as CSSProperties, widthClass, responsiveClass: classes.join(" "), textColorClass };
}

/** Standard horizontal rhythm for homepage sections (mirrors the old page). */
export function SectionShell({
  children,
  className = "",
  bleed = false,
  style,
  previewDevice,
}: {
  children: ReactNode;
  className?: string;
  bleed?: boolean;
  style?: unknown;
  previewDevice?: HomepageDevice;
}) {
  const presentation = sectionStylePresentation(style, previewDevice);

  if (bleed) {
    return (
      <section
        data-homepage-section-shell
        data-homepage-bleed="true"
        className={`${presentation.responsiveClass} ${presentation.textColorClass} ${className}`.trim()}
        style={presentation.style}
      >
        {children}
      </section>
    );
  }
  return (
    <section
      data-homepage-section-shell
      className={`mx-auto ${presentation.widthClass} px-4 py-10 sm:px-6 ${presentation.responsiveClass} ${presentation.textColorClass} ${className}`.trim()}
      style={presentation.style}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
  titleHref,
}: {
  title: string | null;
  subtitle?: string | null;
  action?: ReactNode;
  /** When set, the heading itself becomes this link (storefront only). */
  titleHref?: string;
}) {
  if (!title && !action) return null;
  return (
    <div data-homepage-role="heading-row" className="mb-6 flex items-baseline justify-between gap-4">
      <div>
        {title ? (
          titleHref ? (
            <h2 data-homepage-role="heading" className="text-3xl font-semibold text-ink">
              <SmartLink href={titleHref} className="hover:underline">
                {title}
              </SmartLink>
            </h2>
          ) : (
            <h2 data-homepage-role="heading" className="text-3xl font-semibold text-ink">{title}</h2>
          )
        ) : null}
        {subtitle ? <p data-homepage-role="body" className="mt-1 text-ink-secondary">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** In-app/hash links use next/link; absolute https URLs render as plain anchors. */
export function SmartLink({
  href,
  className,
  children,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
