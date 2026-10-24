"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { SubscribeBand } from "@/components/newsletter/SubscribeBand";
import type {
  PublicStorefrontShell,
  ResolvedFooterView,
} from "@/lib/storefront-shell-api";
import { BrandWordmark } from "./BrandWordmark";

type FooterProps = {
  shell?: PublicStorefrontShell;
  mode?: "live" | "preview";
  collections?: { id: string; slug: string; name: string }[];
  supportEmail?: string;
  supportPhone?: string;
  supportHours?: string;
};

function legacyFooter(
  collections: NonNullable<FooterProps["collections"]>,
  supportEmail: string,
  supportHours: string,
): ResolvedFooterView {
  return {
    tagline: "Small-space furniture, made roomy",
    description:
      "Furniture for Filipino condos and rentals. Cash on delivery, nationwide.",
    columns: [
      {
        id: "legacy-shop",
        kind: "LINKS",
        title: "Shop",
        rows: collections.map((collection) => ({
          id: collection.id,
          kind: "LINK" as const,
          label: collection.name,
          href: `/collections/${collection.slug}`,
        })),
      },
      {
        id: "legacy-contact",
        kind: "CONTACT",
        title: "Contact",
        supportEmail,
        supportHours,
        codText: "Cash on Delivery nationwide",
        trackOrderLabel: "Track Order",
        trackOrderHref: "/track-order",
      },
    ],
    copyrightBrand: "LUWAG Living",
    socials: [],
    legal: [],
    payments: [],
  };
}

function ShellLink({
  href,
  mode,
  children,
}: {
  href: string;
  mode: "live" | "preview";
  children: ReactNode;
}) {
  const className =
    "text-[14px] leading-[1.85] text-footer-secondary transition hover:text-footer-foreground";
  return mode === "live" ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

function ContactRows({
  column,
  mode,
  supportPhone,
}: {
  column: Extract<ResolvedFooterView["columns"][number], { kind: "CONTACT" }>;
  mode: "live" | "preview";
  supportPhone: string;
}) {
  const phone = supportPhone.trim();
  const phoneHref = phone.replace(/[()\-\s]/g, "");

  return (
    <ul className="flex flex-col gap-1 text-[14px] leading-[1.85] text-footer-secondary">
      {column.trackOrderHref ? (
        <li>
          <ShellLink href={column.trackOrderHref} mode={mode}>
            {column.trackOrderLabel}
          </ShellLink>
        </li>
      ) : null}
      <li>{column.codText}</li>
      {phone ? (
        <li>
          {mode === "live" ? (
            <a
              href={`tel:${phoneHref}`}
              className="transition hover:text-footer-foreground"
            >
              {phone}
            </a>
          ) : (
            <span>{phone}</span>
          )}
        </li>
      ) : null}
      <li>{column.supportHours}</li>
      <li>
        {mode === "live" ? (
          <a
            href={`mailto:${column.supportEmail}`}
            className="transition hover:text-footer-foreground"
          >
            {column.supportEmail}
          </a>
        ) : (
          <span>{column.supportEmail}</span>
        )}
      </li>
    </ul>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-4 w-4 text-footer-muted transition-transform lg:hidden ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/**
 * One footer column. Phones get an accordion (the column title is the
 * toggle); from `lg` up the rows are always visible and the toggle is inert,
 * so the same markup serves both layouts.
 */
function FooterColumn({
  column,
  mode,
  supportPhone,
  open,
  onToggle,
}: {
  column: ResolvedFooterView["columns"][number];
  mode: "live" | "preview";
  supportPhone: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();

  return (
    <div
      data-footer-column-id={column.id}
      className="border-b border-footer-border/70 lg:border-0"
    >
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={mode === "preview"}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 py-4 text-left disabled:cursor-default lg:pointer-events-none lg:py-0 lg:pb-4"
        >
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-footer-foreground">
            {column.title}
          </span>
          <Chevron open={open} />
        </button>
      </h3>
      <div id={panelId} className={open ? "pb-5" : "hidden pb-5 lg:block"}>
        {column.kind === "LINKS" ? (
          <ul className="flex flex-col gap-1">
            {column.rows.map((row) => (
              <li key={row.id}>
                {row.kind === "LINK" ? (
                  <ShellLink href={row.href} mode={mode}>
                    {row.label}
                  </ShellLink>
                ) : (
                  <span className="text-[14px] leading-[1.85] text-footer-secondary">
                    {row.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <ContactRows
            column={column}
            mode={mode}
            supportPhone={supportPhone}
          />
        )}
      </div>
    </div>
  );
}

const SOCIAL_ICONS: Record<string, ReactNode> = {
  FACEBOOK: (
    <path
      fill="currentColor"
      d="M9.2 21v-8H6.6v-3h2.6V8.1c0-2.6 1.6-4 4-4 1.1 0 2.1.1 2.4.1v2.8h-1.6c-1.3 0-1.6.6-1.6 1.5V10h3.1l-.4 3h-2.7v8z"
    />
  ),
  INSTAGRAM: (
    <path
      fill="currentColor"
      d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.2A4.8 4.8 0 1 1 7.2 12 4.8 4.8 0 0 1 12 7.2zm0 2A2.8 2.8 0 1 0 14.8 12 2.8 2.8 0 0 0 12 9.2zM16.8 6a1.1 1.1 0 1 1-1.1-1.1A1.1 1.1 0 0 1 16.8 6z"
    />
  ),
  TIKTOK: (
    <path
      fill="currentColor"
      d="M14 3h2.4a4.8 4.8 0 0 0 4 4.2v2.5a7 7 0 0 1-4-1.3v5.7a4.8 4.8 0 1 1-4.8-4.8h.5v2.5h-.5a2.3 2.3 0 1 0 2.4 2.3z"
    />
  ),
  YOUTUBE: (
    <path
      fill="currentColor"
      d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"
    />
  ),
};

const SOCIAL_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

/**
 * Shared shell-driven Footer. The newsletter sits in its own band above the
 * link rows; phones fold every column into an accordion while tablets and
 * desktops keep the full grid. Social icons, legal links and payment labels
 * render only when the operator configured them.
 */
export function Footer({
  shell,
  mode = "live",
  collections = [],
  supportEmail = "",
  supportPhone = "",
  supportHours = "",
}: FooterProps) {
  const footer =
    shell?.footer ?? legacyFooter(collections, supportEmail, supportHours);
  const [openColumn, setOpenColumn] = useState<string | null>(null);

  return (
    <footer className="mt-16 bg-footer-background text-footer-foreground">
      {mode === "live" ? <SubscribeBand /> : null}

      <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        <div
          data-testid="footer-column-grid"
          className="grid grid-cols-1 gap-x-8 lg:grid-cols-[1.35fr_repeat(3,minmax(0,1fr))]"
        >
          <div className="flex items-center justify-between gap-6 pb-4 lg:block lg:pb-0">
            <div>
              <BrandWordmark
                brand={shell?.brand}
                variant="horizontal"
                className="text-lg"
                assetClassName="h-9 w-auto max-w-[200px]"
                tone="onDark"
              />
              <p className="mt-5 hidden max-w-[26ch] text-[15px] font-medium leading-[1.5] text-footer-foreground lg:block">
                {footer.tagline}
              </p>
              <p className="mt-2 hidden max-w-[36ch] text-[13.5px] leading-[1.8] text-footer-secondary lg:block">
                {footer.description}
              </p>
            </div>
            {footer.socials.length > 0 ? (
              <ul className="socials flex items-center gap-4 lg:mt-6">
                {footer.socials.map((social) => (
                  <li key={social.id}>
                    {mode === "live" ? (
                      <a
                        href={social.href}
                        aria-label={SOCIAL_LABELS[social.network]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-footer-foreground opacity-90 transition hover:opacity-60"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          aria-hidden="true"
                        >
                          {SOCIAL_ICONS[social.network]}
                        </svg>
                      </a>
                    ) : (
                      <span
                        aria-label={SOCIAL_LABELS[social.network]}
                        className="inline-flex text-footer-foreground opacity-90"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          aria-hidden="true"
                        >
                          {SOCIAL_ICONS[social.network]}
                        </svg>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {footer.columns.map((column) => (
            <FooterColumn
              key={column.id}
              column={column}
              mode={mode}
              supportPhone={supportPhone}
              open={openColumn === column.id}
              onToggle={() =>
                setOpenColumn((current) =>
                  current === column.id ? null : column.id,
                )
              }
            />
          ))}
        </div>
      </div>

      <div className="border-t border-footer-border/70">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 text-[13px] text-footer-muted sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <p>
            © {new Date().getFullYear()} {footer.copyrightBrand}. All rights
            reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {footer.legal.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-4">
                {footer.legal.map((link) => (
                  <li key={link.id}>
                    {mode === "live" ? (
                      <Link
                        href={link.href}
                        className="transition hover:text-footer-foreground"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <span>{link.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {footer.payments.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-2">
                {footer.payments.map((payment) => (
                  <li
                    key={payment}
                    className="rounded-md border border-footer-border px-3 py-1.5 text-[11px] font-medium tracking-[0.06em] text-footer-secondary"
                  >
                    {payment}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
