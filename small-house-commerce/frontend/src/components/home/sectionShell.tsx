import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Standard horizontal rhythm for homepage sections (mirrors the old page). */
export function SectionShell({
  children,
  className = "",
  bleed = false,
}: {
  children: ReactNode;
  className?: string;
  bleed?: boolean;
}) {
  if (bleed) {
    return <section className={className}>{children}</section>;
  }
  return (
    <section className={`mx-auto max-w-[1200px] px-4 py-10 sm:px-6 ${className}`.trim()}>
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
