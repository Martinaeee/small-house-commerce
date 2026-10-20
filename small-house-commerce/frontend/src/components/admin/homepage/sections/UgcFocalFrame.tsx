"use client";

import { useRef, type ReactNode } from "react";

/**
 * Lets the operator choose which part of the photo stays visible.
 *
 * The storefront crops every photo into a fixed box, so the operator drags
 * the photo inside a preview of that box. The focal point is stored as a
 * percentage and rendered as `object-position`, so the storefront crop and
 * the preview always agree.
 */
export function UgcFocalFrame({
  imageUrl,
  focalX,
  focalY,
  aspect,
  label,
  hint,
  resetLabel,
  onChange,
  onReset,
  testId,
}: {
  imageUrl?: string;
  focalX: number;
  focalY: number;
  /** CSS aspect ratio of the box the photo is cropped into. */
  aspect: string;
  label: string;
  hint: string;
  resetLabel: string;
  onChange: (focal: { focalX: number; focalY: number }) => void;
  onReset: () => void;
  testId?: string;
}): ReactNode {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pointTo = (clientX: number, clientY: number): void => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    onChange({
      focalX: Math.min(100, Math.max(0, Math.round(x))),
      focalY: Math.min(100, Math.max(0, Math.round(y))),
    });
  };

  const nudge = (event: React.KeyboardEvent): void => {
    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange({
      focalX: Math.min(100, Math.max(0, focalX + delta[0])),
      focalY: Math.min(100, Math.max(0, focalY + delta[1])),
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div
        ref={frameRef}
        data-testid={testId}
        role="group"
        tabIndex={0}
        aria-label={label}
        style={{ aspectRatio: aspect }}
        onPointerDown={(event) => {
          dragging.current = true;
          pointTo(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          pointTo(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={nudge}
        className="relative w-full max-w-56 cursor-crosshair overflow-hidden rounded-lg border border-border bg-surface"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an already-uploaded shared asset.
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: `${focalX}% ${focalY}%` }}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cta/60"
          style={{ left: `${focalX}%`, top: `${focalY}%` }}
        />
      </div>
      <p className="text-xs text-ink-muted">{hint}</p>
      <button
        type="button"
        onClick={onReset}
        className="w-fit rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface"
      >
        {resetLabel}
      </button>
    </div>
  );
}
