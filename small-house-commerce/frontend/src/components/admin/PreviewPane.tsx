"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Labels are optional so the shared preview remains usable outside the admin provider. */
export interface PreviewPaneLabels {
  desktopDevice: string;
  mobileDevice: string;
  refresh: string;
  savedNote: ReactNode;
  desktopTitle: string;
  mobileTitle: string;
  liveNote: ReactNode;
}

const DEFAULT_LABELS: PreviewPaneLabels = {
  desktopDevice: "电脑 1440×900",
  mobileDevice: "手机 390×844",
  refresh: "刷新预览",
  savedNote: (
    <>
      这里显示的是<strong className="font-semibold text-ink">已保存</strong>
      的真实页面。改完先保存，再点刷新预览。
    </>
  ),
  desktopTitle: "Desktop preview",
  mobileTitle: "Mobile preview",
  liveNote:
    "实时预览：用你正在编辑的内容渲染，和前台是同一个组件，不会出现「预览好看、上线不一样」。",
};

const DEVICES = {
  desktop: {
    labelKey: "desktopDevice",
    width: 1440,
    height: 900,
    scale: 0.42,
  },
  mobile: {
    labelKey: "mobileDevice",
    width: 390,
    height: 844,
    scale: 0.52,
  },
} as const;

export type DeviceName = keyof typeof DEVICES;

export function DeviceFrame({
  device,
  children,
  labels = DEFAULT_LABELS,
  className,
}: {
  device: DeviceName;
  children: ReactNode;
  labels?: Pick<PreviewPaneLabels, "desktopDevice" | "mobileDevice">;
  /** Extra classes on the outer frame (used for responsive visibility). */
  className?: string;
}): ReactNode {
  const d = DEVICES[device];
  const maxWidth = d.width * d.scale;
  const [frameWidth, setFrameWidth] = useState(maxWidth);
  const frameRef = useRef<HTMLDivElement>(null);
  const label = labels[d.labelKey];
  const scale = Math.min(d.scale, frameWidth / d.width);
  const frameHeight = d.height * scale;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateWidth = (nextWidth: number | undefined) => {
      if (!nextWidth || !Number.isFinite(nextWidth)) return;
      setFrameWidth((currentWidth) =>
        Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth,
      );
    };

    updateWidth(frame.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [d.width]);

  return (
    <div
      className={`flex min-w-0 w-full max-w-full flex-col gap-2${className ? ` ${className}` : ""}`}
      style={{ width: maxWidth }}
    >
      <span className="text-xs font-semibold text-ink-secondary">{label}</span>
      <div
        ref={frameRef}
        className="relative min-h-0 w-full overflow-hidden rounded-lg border border-border bg-white"
        style={{ maxWidth, height: frameHeight, aspectRatio: `${d.width} / ${d.height}` }}
      >
        <div
          data-preview-viewport
          className="absolute left-0 top-0"
          style={{
            width: d.width,
            height: d.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function PreviewRow({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex min-w-0 flex-wrap gap-4">{children}</div>;
}

/**
 * The saved storefront page in both frames. There is nobody to revalidate for
 * in dev (no REVALIDATE_SECRET), so the note tells the operator that a save is
 * what makes the preview current — in production the admin write already
 * revalidates the storefront cache.
 */
export function StorefrontPreview({
  path,
  labels = DEFAULT_LABELS,
  preferMobileOnNarrow = false,
}: {
  path: string;
  labels?: PreviewPaneLabels;
  /** Below 720px hide the desktop frame so only the mobile view shows. */
  preferMobileOnNarrow?: boolean;
}): ReactNode {
  const [nonce, setNonce] = useState(0);
  const url = `${path}${path.includes("?") ? "&" : "?"}_preview=${nonce}`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-muted">{labels.savedNote}</p>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-cta hover:border-cta"
        >
          {labels.refresh}
        </button>
      </div>
      <PreviewRow>
        <DeviceFrame
          device="desktop"
          labels={labels}
          className={preferMobileOnNarrow ? "max-[719px]:hidden" : undefined}
        >
          <iframe
            key={`d-${nonce}`}
            src={url}
            title={labels.desktopTitle}
            className="h-full w-full border-0"
            loading="lazy"
          />
        </DeviceFrame>
        <DeviceFrame device="mobile" labels={labels}>
          <iframe
            key={`m-${nonce}`}
            src={url}
            title={labels.mobileTitle}
            className="h-full w-full border-0"
            loading="lazy"
          />
        </DeviceFrame>
      </PreviewRow>
    </div>
  );
}

/** Live preview of the module being edited, rendered at both sizes. */
export function LivePreview({
  children,
  labels = DEFAULT_LABELS,
  preferMobileOnNarrow = false,
}: {
  children: ReactNode;
  labels?: PreviewPaneLabels;
  /** Below 720px hide the desktop frame so only the mobile view shows. */
  preferMobileOnNarrow?: boolean;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-ink-muted">{labels.liveNote}</p>
      <PreviewRow>
        <DeviceFrame
          device="desktop"
          labels={labels}
          className={preferMobileOnNarrow ? "max-[719px]:hidden" : undefined}
        >
          {children}
        </DeviceFrame>
        <DeviceFrame device="mobile" labels={labels}>
          {children}
        </DeviceFrame>
      </PreviewRow>
    </div>
  );
}
