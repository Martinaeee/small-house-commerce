import type { ReactNode } from "react";
import type { Category, Collection } from "@/lib/api";
import { buildNav } from "@/lib/nav";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { Footer } from "./Footer";
import { Header } from "./Header";

type StorefrontShellPresentationProps = {
  shell: PublicStorefrontShell;
  roots: Category[];
  collections: Collection[];
  mode?: "live" | "preview";
  supportPhone?: string;
  /** Preview-only focus switches; the live storefront always renders both. */
  showHeader?: boolean;
  showFooter?: boolean;
  children: ReactNode;
};

/**
 * One landmark/ordering path for the published storefront and the admin's inert
 * preview. Data fetching, providers and theme variables remain outside.
 */
export function StorefrontShellPresentation({
  shell,
  roots,
  collections,
  mode = "live",
  supportPhone = "",
  showHeader = true,
  showFooter = true,
  children,
}: StorefrontShellPresentationProps) {
  const navItems = buildNav(roots, collections, shell.header.items);

  return (
    <div data-storefront-shell-mode={mode} className="contents">
      {showHeader ? (
        <Header navItems={navItems} brand={shell.brand} mode={mode} />
      ) : null}
      <main id="main-content" className="flex-1">{children}</main>
      {showFooter ? (
        <Footer
          shell={shell}
          mode={mode}
          supportPhone={supportPhone}
        />
      ) : null}
    </div>
  );
}
