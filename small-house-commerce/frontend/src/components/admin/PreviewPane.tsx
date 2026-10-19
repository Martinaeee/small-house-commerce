"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Labels are optional so the shared preview remains usable outside the admin provider. */
export interface PreviewPaneLabels {
  desktopDevice: string;
  /** Tablet frame label (homepage builder switcher); shared previews use desktop/mobile only. */
  tabletDevice?: string;
  mobileDevice: string;
  refresh: string;
  savedNote: ReactNode;
  desktopTitle: string;
  mobileTitle: string;
  liveNote: ReactNode;
}

const DEFAULT_LABELS: PreviewPaneLabels = {
  desktopDevice: "电脑 1440×900",
  tabletDevice: "平板 768×1024",
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
  tablet: {
    labelKey: "tabletDevice",
    width: 768,
    height: 1024,
    scale: 0.5,
  },
  mobile: {
    labelKey: "mobileDevice",
    width: 390,
    height: 844,
    scale: 0.52,
  },
} as const;

export type DeviceName = keyof typeof DEVICES;

/** Editor default language is Chinese; the editor passes its own localized copy. */
const DEFAULT_METRICS_TEMPLATE = "缩放编辑预览 · {width}px · {scale}%";

export interface DeviceFrameMetrics {
  width: number;
  height: number;
  scale: number;
}

export function DeviceFrame({
  device,
  children,
  labels = DEFAULT_LABELS,
  className,
  scrollable = false,
  flat = false,
  showMetrics = false,
  metricsTemplate = DEFAULT_METRICS_TEMPLATE,
  fitAvailable = false,
  onMetricsChange,
}: {
  device: DeviceName;
  children: ReactNode;
  labels?: Pick<PreviewPaneLabels, "desktopDevice" | "mobileDevice" | "tabletDevice">;
  className?: string;
  scrollable?: boolean;
  flat?: boolean;
  showMetrics?: boolean;
  metricsTemplate?: string;
  fitAvailable?: boolean;
  onMetricsChange?: (metrics: DeviceFrameMetrics) => void;
}): ReactNode {
  const d = DEVICES[device];
  const maxWidth = d.width * d.scale;
  const [frameWidth, setFrameWidth] = useState(maxWidth);
  const [available, setAvailable] = useState<{ width: number; height: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const label = labels[d.labelKey] ?? DEFAULT_LABELS[d.labelKey];
  const scaleCap = flat && device === "desktop" ? 1 : d.scale;
  const scale = fitAvailable && available
    ? Math.min(1, available.width / d.width, available.height / d.height)
    : Math.min(scaleCap, frameWidth / d.width);
  const frameHeight = d.height * scale;
  const viewportLeft = flat && !fitAvailable ? Math.max(0, (frameWidth - d.width * scale) / 2) : 0;

  useEffect(() => {
    if (fitAvailable) return;
    const frame = frameRef.current;
    if (!frame) return;
    const updateWidth = (nextWidth: number | undefined) => {
      if (!nextWidth || !Number.isFinite(nextWidth)) return;
      setFrameWidth((currentWidth) => Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth);
    };
    updateWidth(frame.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => updateWidth(entries[0]?.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [d.width, fitAvailable]);

  useEffect(() => {
    if (!fitAvailable) return;
    const host = hostRef.current;
    if (!host) return;
    const updateSize = (width: number | undefined, height: number | undefined): void => {
      if (!width || !height || width < 0 || height < 0 || !Number.isFinite(width) || !Number.isFinite(height)) return;
      setAvailable((current) => current && Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current : { width, height });
    };
    const rect = host.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => updateSize(entries[0]?.contentRect.width, entries[0]?.contentRect.height));
    observer.observe(host);
    return () => observer.disconnect();
  }, [fitAvailable]);

  useEffect(() => {
    onMetricsChange?.({ width: d.width, height: d.height, scale });
  }, [d.width, d.height, scale, onMetricsChange]);

  const frame = <div
    ref={frameRef}
    data-preview-frame={flat ? "flat" : "device"}
    className={`relative min-h-0 w-full overflow-hidden${flat ? "" : " rounded-lg border border-border bg-white"}`}
    style={{
      maxWidth: fitAvailable || flat ? "100%" : maxWidth,
      width: fitAvailable ? d.width * scale : undefined,
      height: frameHeight,
      aspectRatio: `${d.width} / ${d.height}`,
      flexShrink: fitAvailable ? 0 : undefined,
    }}
  >
    <div data-preview-viewport className={scrollable ? "relative left-0 top-0" : "absolute left-0 top-0"}
      style={{ left: viewportLeft, width: d.width, height: d.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {children}
    </div>
  </div>;

  return <div
    className={`flex min-w-0 w-full max-w-full flex-col${fitAvailable ? " h-full min-h-0" : ""}${flat ? " gap-0" : " gap-2"}${className ? ` ${className}` : ""}`}
    style={{ width: fitAvailable || flat ? "100%" : maxWidth }}
  >
    {flat ? null : <span className="text-xs font-semibold text-ink-secondary">{label}</span>}
    {showMetrics ? <span data-preview-metrics className="text-xs font-medium text-ink-muted">
      {metricsTemplate.replace("{width}", String(d.width)).replace("{scale}", String(Math.round(scale * 100)))}
    </span> : null}
    {fitAvailable ? <div ref={hostRef} data-preview-host className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">{frame}</div> : frame}
  </div>;
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
          scrollable
        >
          <div data-preview-scroll className="h-full overflow-y-auto overscroll-contain">
            {children}
          </div>
        </DeviceFrame>
        <DeviceFrame device="mobile" labels={labels} scrollable>
          <div data-preview-scroll className="h-full overflow-y-auto overscroll-contain">
            {children}
          </div>
        </DeviceFrame>
      </PreviewRow>
    </div>
  );
}
