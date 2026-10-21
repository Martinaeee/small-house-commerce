import Link from "next/link";
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { HomepageSectionStyle } from "@/lib/api";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function finitePadding(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(240, value))
    : undefined;
}

export function normalizeSectionStyle(value: unknown): HomepageSectionStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const style = value as Record<string, unknown>;
  const paddingTop = finitePadding(style.paddingTop);
  const paddingBottom = finitePadding(style.paddingBottom);
  return {
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
}

export function sectionStylePresentation(value: unknown): {
  style: CSSProperties;
  widthClass: string;
  textColorClass: string;
} {
  const style = normalizeSectionStyle(value);
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
    ...(style.paddingTop !== undefined ? { paddingTop: style.paddingTop } : {}),
    ...(style.paddingBottom !== undefined ? { paddingBottom: style.paddingBottom } : {}),
  };
  return { style: inlineStyle, widthClass, textColorClass };
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
  /**
   * Preview device of the admin canvas ("desktop" | "tablet" | "mobile").
   * The live site has no preview frame, so this only annotates the markup —
   * a section that needs device-specific spacing applies it itself.
   */
  previewDevice?: "desktop" | "tablet" | "mobile";
}) {
  const presentation = sectionStylePresentation(style);

  if (bleed) {
    return (
      <section
        className={`${presentation.textColorClass} ${className}`.trim()}
        style={presentation.style}
        data-preview-device={previewDevice}
      >
        {children}
      </section>
    );
  }
  return (
    <section
      className={`mx-auto ${presentation.widthClass} px-4 py-10 sm:px-6 ${presentation.textColorClass} ${className}`.trim()}
      style={presentation.style}
      data-preview-device={previewDevice}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string | null;
  subtitle?: string | null;
  action?: ReactNode;
}) {
  if (!title && !action) return null;
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4">
      <div>
        {title ? <h2 className="text-3xl font-semibold text-ink">{title}</h2> : null}
        {subtitle ? <p className="mt-1 text-ink-secondary">{subtitle}</p> : null}
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
