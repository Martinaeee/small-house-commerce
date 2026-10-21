import Link from "next/link";
import type { ReactNode } from "react";
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
    "text-sm text-footer-secondary transition hover:text-footer-foreground";
  return mode === "live" ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className="text-sm text-footer-secondary">{children}</span>
  );
}

function ContactColumn({
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
    <div data-footer-column-id={column.id}>
      <p className="text-sm font-semibold text-footer-foreground">{column.title}</p>
      <ul className="mt-4 flex flex-col gap-2.5 text-sm text-footer-secondary">
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
              className="transition hover:text-white"
            >
              {column.supportEmail}
            </a>
          ) : (
            <span>{column.supportEmail}</span>
          )}
        </li>
      </ul>
    </div>
  );
}

/**
 * Shared shell-driven Footer. Legacy inputs remain as a temporary compatibility
 * adapter until the storefront layout switches to the published shell in Task 9.
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

  return (
    <footer className="mt-16 bg-footer-background text-footer-foreground">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-12 xl:grid-cols-4">
          <div>
            <BrandWordmark
              brand={shell?.brand}
              variant="horizontal"
              className="text-lg"
              tone="onDark"
            />
            <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-footer-muted">
              {footer.tagline}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-6 text-footer-secondary">
              {footer.description}
            </p>
          </div>

          {footer.columns.map((column) =>
            column.kind === "LINKS" ? (
              <nav
                key={column.id}
                data-footer-column-id={column.id}
                aria-label={column.title}
              >
                <p className="text-sm font-semibold text-footer-foreground">{column.title}</p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {column.rows.map((row) => (
                    <li key={row.id}>
                      {row.kind === "LINK" ? (
                        <ShellLink href={row.href} mode={mode}>
                          {row.label}
                        </ShellLink>
                      ) : (
                        <span className="text-sm text-footer-secondary">{row.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <ContactColumn
                key={column.id}
                column={column}
                mode={mode}
                supportPhone={supportPhone}
              />
            ),
          )}

          {mode === "live" ? <SubscribeBand /> : null}
        </div>
      </div>

      <div className="border-t border-footer-border/40">
        <p className="mx-auto max-w-[1200px] px-4 py-5 text-xs text-footer-muted sm:px-6">
          © {new Date().getFullYear()} {footer.copyrightBrand}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
