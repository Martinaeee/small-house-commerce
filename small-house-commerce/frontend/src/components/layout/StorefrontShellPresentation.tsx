import type { ReactNode } from "react";
import type { AnnouncementBlockView, Category, Collection } from "@/lib/api";
import { buildNav } from "@/lib/nav";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { AnnouncementBar } from "./AnnouncementBar";
import type { AnnouncementDevice } from "./AnnouncementCountdown";
import { Footer } from "./Footer";
import { Header } from "./Header";

type StorefrontShellPresentationProps = {
  shell: PublicStorefrontShell;
  roots: Category[];
  collections: Collection[];
  mode?: "live" | "preview";
  supportPhone?: string;
  announcement?: AnnouncementBlockView | null;
  announcementDevice?: AnnouncementDevice;
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
  announcement = null,
  announcementDevice,
  showHeader = true,
  showFooter = true,
  children,
}: StorefrontShellPresentationProps) {
  const navItems = buildNav(roots, collections, shell.header.items);

  return (
    <div data-storefront-shell-mode={mode} className="contents">
      {showHeader ? (
        <div className="sticky top-0 z-40">
          <AnnouncementBar
            data={announcement}
            mode={mode}
            device={announcementDevice}
          />
          <Header navItems={navItems} brand={shell.brand} mode={mode} />
        </div>
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
