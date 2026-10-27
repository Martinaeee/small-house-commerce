"use client";

import type { CSSProperties, ReactNode, SyntheticEvent } from "react";

import type { AnnouncementBlockView, Category, Collection } from "@/lib/api";
import type { SiteSettings } from "@/lib/site-settings";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { themeCssVariables } from "@/lib/storefront-theme";
import { StorefrontShellPresentation } from "@/components/layout/StorefrontShellPresentation";
import type { AnnouncementDevice } from "@/components/layout/AnnouncementCountdown";

function preventPreviewAction(event: SyntheticEvent): void {
  const target = event.target;
  if (
    event.type === "submit" ||
    (target instanceof Element && target.closest("a") !== null)
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function PreviewFixedChrome({ device }: { device?: AnnouncementDevice }) {
  const responsive = device === undefined;
  const mobile = device === "mobile";
  const showMobileTab = mobile || responsive;
  return (
    <>
      <span data-preview-cart-drawer="closed" hidden aria-hidden="true" />
      <span
        data-preview-messenger
        aria-hidden="true"
        className={`pointer-events-none absolute right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#0084ff] text-sm font-bold text-white shadow-lg ${
          responsive ? "bottom-20 md:bottom-4" : mobile ? "bottom-20" : "bottom-4"
        }`}
      >
        M
      </span>
      <span
        data-preview-back-to-top
        aria-hidden="true"
        className={`pointer-events-none absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-cta shadow-md ${
          responsive ? "bottom-36 md:bottom-20" : mobile ? "bottom-36" : "bottom-20"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="h-5 w-5"
        >
          <path d="M12 19V5" strokeLinecap="round" />
          <path d="M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {showMobileTab ? (
        <div
          data-preview-mobile-tab-bar
          data-homepage-bottom-chrome
          aria-hidden="true"
          className={`pointer-events-none sticky bottom-0 z-10 mt-auto border-t border-border bg-card pb-[env(safe-area-inset-bottom)] ${
            responsive ? "md:hidden" : ""
          }`}
        >
          <div className="grid grid-cols-4">
            {["Home", "Categories", "Search", "Account"].map((label) => (
              <span
                key={label}
                className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-secondary"
              >
                <span className="h-5 w-5 rounded border border-current opacity-60" />
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function PreviewStorefrontShell({
  shell,
  roots,
  collections,
  settings,
  announcement,
  device,
  children,
}: {
  shell: PublicStorefrontShell;
  roots: Category[];
  collections: Collection[];
  settings: SiteSettings;
  announcement: AnnouncementBlockView | null;
  device?: AnnouncementDevice;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      data-storefront-preview-shell
      data-storefront-shell-mode="preview"
      data-device={device ?? "responsive"}
      className="storefront-app storefront-theme relative flex min-h-full flex-col overflow-x-hidden bg-background"
      style={
        themeCssVariables(shell.theme, shell.derivedTheme) as CSSProperties
      }
      onClickCapture={preventPreviewAction}
      onAuxClickCapture={preventPreviewAction}
      onContextMenuCapture={preventPreviewAction}
      onDragStartCapture={preventPreviewAction}
      onSubmitCapture={preventPreviewAction}
    >
      <StorefrontShellPresentation
        shell={shell}
        roots={roots}
        collections={collections}
        mode="preview"
        announcement={announcement}
        announcementDevice={device}
        supportPhone={settings.supportPhone}
      >
        {children}
      </StorefrontShellPresentation>
      <PreviewFixedChrome device={device} />
    </div>
  );
}
