"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Admin modal dialog (design spec §12): fixed overlay, no portal.
 * - role="dialog" aria-modal
 * - Esc / backdrop click -> onClose
 * - Tab cycles within the panel (lightweight focus trap)
 * - initial focus on the primary (last) action button, else the close button
 * - body scroll lock while open; focus returns to the trigger on close
 */

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const widthCls = {
  sm: "w-[min(92vw,24rem)]",
  md: "w-[min(92vw,32rem)]",
} as const;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: "sm" | "md";
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = "md",
}: DialogProps): ReactNode | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    // Capture the trigger so focus can be restored on close.
    if (document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = (): HTMLElement[] => {
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.getAttribute("aria-hidden") !== "true" &&
          el.offsetParent !== null,
      );
    };

    // Initial focus: primary (last) button, else first focusable, else the panel.
    const candidates = focusables();
    const buttons = candidates.filter((el) => el.tagName === "BUTTON");
    (buttons[buttons.length - 1] ?? candidates[0] ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel?.contains(active);
      if (event.shiftKey) {
        if (active === first || active === panel || !inside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || active === panel || !inside) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
    // onClose is read through onCloseRef so a new callback identity does not
    // tear down/re-run this effect (focus capture, scroll lock, listener).
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Clicking the backdrop (sibling of the panel) closes the dialog. */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        aria-hidden="true"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl -translate-x-1/2 -translate-y-1/2 ${widthCls[width]}`}
      >
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-primary-light/40 hover:text-ink"
        >
          ✕
        </button>
        <h2 className="pr-10 text-lg font-semibold text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </>
  );
}
