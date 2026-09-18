"use client";

import { useState, type ReactNode } from "react";

/**
 * Admin preview panes.
 *
 * `DeviceFrame` is the shared shell: a fixed-size viewport rendered at a
 * fraction of its real size, so a merchant sees the storefront layout at the
 * two sizes that matter without leaving the back office.
 *
 * Live previews render the SAME components the storefront uses (HeroBanner,
 * ProductDetailBody) with the form's current values, so what the merchant sees
 * while editing cannot drift from what ships. Anything that needs real data
 * (a full PDP, the homepage) is previewed as the saved page in an iframe.
 */

const DEVICES = {
  desktop: { label: "电脑 1440×900", width: 1440, height: 900, scale: 0.42 },
  mobile: { label: "手机 390×844", width: 390, height: 844, scale: 0.52 },
} as const;

export type DeviceName = keyof typeof DEVICES;

export function DeviceFrame({
  device,
  children,
}: {
  device: DeviceName;
  children: ReactNode;
}): ReactNode {
  const d = DEVICES[device];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-secondary">{d.label}</span>
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-white"
        style={{ width: d.width * d.scale, height: d.height * d.scale }}
      >
        <div
          style={{
            width: d.width,
            height: d.height,
            transform: `scale(${d.scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Both device frames side by side, wrapping on narrow screens. */
export function PreviewRow({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex flex-wrap gap-4">{children}</div>;
}

/**
 * The saved storefront page in both frames. There is nobody to revalidate for
 * in dev (no REVALIDATE_SECRET), so the note tells the operator that a save is
 * what makes the preview current — in production the admin write already
 * revalidates the storefront cache.
 */
export function StorefrontPreview({ path }: { path: string }): ReactNode {
  const [nonce, setNonce] = useState(0);
  const url = `${path}${path.includes("?") ? "&" : "?"}_preview=${nonce}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-muted">
          这里显示的是<strong className="font-semibold text-ink">已保存</strong>
          的真实页面。改完先保存，再点刷新预览。
        </p>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-cta hover:border-cta"
        >
          刷新预览
        </button>
      </div>
      <PreviewRow>
        <DeviceFrame device="desktop">
          <iframe
            key={`d-${nonce}`}
            src={url}
            title="Desktop preview"
            className="h-full w-full border-0"
            loading="lazy"
          />
        </DeviceFrame>
        <DeviceFrame device="mobile">
          <iframe
            key={`m-${nonce}`}
            src={url}
            title="Mobile preview"
            className="h-full w-full border-0"
            loading="lazy"
          />
        </DeviceFrame>
      </PreviewRow>
    </div>
  );
}

/** Live preview of the module being edited, rendered at both sizes. */
export function LivePreview({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-muted">
        实时预览：用你正在编辑的内容渲染，和前台是同一个组件，不会出现「预览好看、上线不一样」。
      </p>
      <PreviewRow>
        <DeviceFrame device="desktop">{children}</DeviceFrame>
        <DeviceFrame device="mobile">{children}</DeviceFrame>
      </PreviewRow>
    </div>
  );
}
