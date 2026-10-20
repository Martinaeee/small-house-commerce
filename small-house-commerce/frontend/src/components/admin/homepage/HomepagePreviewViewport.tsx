"use client";

import { useState, type ReactNode } from "react";
import { DeviceFrame } from "@/components/admin/PreviewPane";

const VIEWPORTS = {
  desktop: { device: "desktop", title: "Desktop homepage draft preview", label: "电脑", stage: "电脑视口" },
  tablet: { device: "tablet", title: "Tablet homepage draft preview", label: "平板", stage: "平板视口（最大 768px）" },
  mobile: { device: "mobile", title: "Mobile homepage draft preview", label: "手机", stage: "手机视口（最大 390px）" },
} as const;

type PreviewView = keyof typeof VIEWPORTS;

export function HomepagePreviewViewport({ view: initialView, src }: {
  view: PreviewView;
  src: string;
}): ReactNode {
  // Device switching only resizes this wrapper's stage; the signed content URL
  // is never re-signed, rewritten or re-requested.
  const [view, setView] = useState<PreviewView>(initialView);
  const viewport = VIEWPORTS[view];
  return <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-surface" data-preview-view={view}>
    <div data-draft-preview-banner className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2">
      <a href="/admin/homepage" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-cta hover:underline">
        <span aria-hidden="true">←</span>
        返回装修工作台
      </a>
      <span className="min-w-0 flex-1 truncate text-center text-xs font-medium text-ink-muted">
        草稿预览 · 未发布 · {viewport.stage}
      </span>
      <div role="group" aria-label="预览设备" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-background p-0.5">
        {(Object.keys(VIEWPORTS) as PreviewView[]).map((device) => (
          <button
            key={device}
            type="button"
            aria-pressed={view === device}
            onClick={() => setView(device)}
            className="min-h-7 rounded-md px-2.5 text-xs font-semibold text-ink-muted aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-sm"
          >
            {VIEWPORTS[device].label}
          </button>
        ))}
      </div>
    </div>
    {/* The draft renders in the same device frame the builder canvas uses
        (1440×900 / 768×1024 / 390×844), so the preview shows the same
        geometry a shopper gets: a hero that fills the device viewport instead
        of the browser window, which cropped the hero image differently. */}
    <div data-preview-stage className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
      <DeviceFrame
        device={viewport.device}
        flat
        scrollable
        fitAvailable
      >
        <iframe
          src={src}
          title={viewport.title}
          referrerPolicy="no-referrer"
          className="block h-full w-full border-0 bg-white"
        />
      </DeviceFrame>
    </div>
  </div>;
}
