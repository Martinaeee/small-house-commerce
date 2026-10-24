"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Admin help affordance: a small question mark that reveals the explanation
 * that used to sit permanently under a field. The text stays in the DOM at all
 * times (screen readers and text queries keep working); it is only visually
 * collapsed while closed.
 */
export function AdminHelpTip({
  text,
  label = "More info",
  id,
  className = "",
}: {
  text: ReactNode;
  /** Accessible name for the question-mark button. */
  label?: string;
  /** Optional id for the tooltip element. */
  id?: string;
  className?: string;
}): ReactNode {
  const autoId = useId();
  const tipId = id ?? `${autoId}-tip`;
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (): void => {
      pinned.current = false;
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        aria-describedby={tipId}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold leading-none text-ink-muted hover:border-cta hover:text-cta focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta"
        onClick={(event) => {
          // The button can live inside a <label>; never forward the click to
          // the labelled control. A hover-opened tip is pinned by the first
          // click; a pinned tip is closed by the next one.
          event.preventDefault();
          event.stopPropagation();
          const nextPinned = !(open && pinned.current);
          pinned.current = nextPinned;
          setOpen(nextPinned);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned.current) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned.current) setOpen(false);
        }}
      >
        ?
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={
          open
            ? "absolute left-0 top-full z-50 mt-1 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-normal leading-relaxed text-ink shadow-lg"
            : "sr-only"
        }
      >
        {text}
      </span>
    </span>
  );
}
