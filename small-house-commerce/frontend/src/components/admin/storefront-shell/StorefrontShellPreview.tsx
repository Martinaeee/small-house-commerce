"use client";

import { type CSSProperties, type ReactNode } from "react";
import type { Category, Collection } from "@/lib/api";
import { themeCssVariables } from "@/lib/storefront-theme";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { StorefrontShellPresentation } from "@/components/layout/StorefrontShellPresentation";

export type StorefrontShellPreviewDevice = "desktop" | "tablet" | "mobile";

/**
 * Which shell part the canvas focuses on. `full` shows the whole composition
 * (header, page content and footer), `header`/`footer` keep only the part the
 * operator is currently editing so the canvas is not dominated by empty space.
 */
export type StorefrontShellPreviewParts = "full" | "header" | "footer";

export type StorefrontShellPreviewProps = {
  shell: PublicStorefrontShell;
  device: StorefrontShellPreviewDevice;
  parts?: StorefrontShellPreviewParts;
  roots?: Category[];
  collections?: Collection[];
  /** Caps the canvas height so a sticky editor column can scroll inside it. */
  bounded?: boolean;
  children?: ReactNode;
};

const DEVICE_WIDTHS: Record<StorefrontShellPreviewDevice, string> = {
  desktop: "1200px",
  tablet: "768px",
  mobile: "390px",
};

/** Light neutral skeleton — clearly a placeholder, never fake storefront copy. */
function PreviewContentPlaceholder({ compact }: { compact: boolean }) {
  const block = (alpha: number) =>
    `color-mix(in srgb, var(--color-ink) ${alpha}%, transparent)`;

  return (
    <div
      data-testid="preview-content-placeholder"
      aria-hidden
      className={compact ? "px-6 py-7" : "px-6 py-9"}
    >
      <div className="mx-auto max-w-3xl space-y-3">
        <div
          className="h-5 w-2/5 rounded"
          style={{ backgroundColor: block(12) }}
        />
        <div
          className="h-3 w-3/5 rounded"
          style={{ backgroundColor: block(8) }}
        />
        <div
          className="h-3 w-1/2 rounded"
          style={{ backgroundColor: block(8) }}
        />
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((cell) => (
            <div
              key={cell}
              className="h-16 rounded-lg"
              style={{ backgroundColor: block(6) }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Inert storefront preview. It renders the shared Header/Footer presentation in
 * `preview` mode inside a fixed-width canvas and applies the theme variables
 * inline, so no provider, customer island, analytics observer or storefront
 * route is ever mounted here.
 */
export function StorefrontShellPreview({
  shell,
  device,
  parts = "full",
  roots = [],
  collections = [],
  bounded = false,
  children,
}: StorefrontShellPreviewProps): ReactNode {
  const variables = themeCssVariables(shell.theme, shell.derivedTheme);

  return (
    <div className="min-w-0">
      <div
        className="mx-auto min-w-0"
        // The device width is a fixed target, not a floor: on a narrow editor
        // column the wrapper has to shrink or the whole admin page scrolls
        // sideways.
        style={{ width: DEVICE_WIDTHS[device], maxWidth: "100%" }}
      >
        <div
          data-testid="storefront-shell-preview-canvas"
          data-device={device}
          style={
            {
              ...variables,
              width: DEVICE_WIDTHS[device],
              maxWidth: "100%",
              ...(bounded ? { maxHeight: "calc(100vh - 10.5rem)" } : {}),
            } as CSSProperties
          }
          className="storefront-app mx-auto min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-admin-border bg-admin-canvas"
        >
          <StorefrontShellPresentation
            shell={shell}
            roots={roots}
            collections={collections}
            mode="preview"
            showHeader={parts !== "footer"}
            showFooter={parts !== "header"}
          >
            {children ?? <PreviewContentPlaceholder compact={parts !== "full"} />}
          </StorefrontShellPresentation>
        </div>
      </div>
    </div>
  );
}
