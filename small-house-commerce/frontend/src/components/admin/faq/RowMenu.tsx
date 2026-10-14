"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface RowMenuAction {
  label: string;
  ariaLabel?: string;
  onAction?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
}

const MENU_WIDTH = 160;
const VIEWPORT_GAP = 8;
const TRIGGER_GAP = 4;

/**
 * Compact overflow menu for secondary row and group actions. The popup is
 * portaled to the document body so table scroll containers cannot clip it.
 */
export function RowMenu({
  label,
  actions,
  disabled = false,
}: {
  label: string;
  actions: RowMenuAction[];
  disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  const placeBelowTrigger = () => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      top: bounds.bottom + TRIGGER_GAP,
      left: Math.max(
        VIEWPORT_GAP,
        Math.min(
          bounds.right - MENU_WIDTH,
          window.innerWidth - MENU_WIDTH - VIEWPORT_GAP,
        ),
      ),
    });
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const triggerBounds = trigger.current.getBoundingClientRect();
    const popupBounds = popup.current.getBoundingClientRect();
    const below = triggerBounds.bottom + TRIGGER_GAP;
    const top =
      below + popupBounds.height <= window.innerHeight - VIEWPORT_GAP
        ? below
        : Math.max(
            VIEWPORT_GAP,
            triggerBounds.top - popupBounds.height - TRIGGER_GAP,
          );
    const left = Math.max(
      VIEWPORT_GAP,
      Math.min(
        triggerBounds.right - popupBounds.width,
        window.innerWidth - popupBounds.width - VIEWPORT_GAP,
      ),
    );
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !container.current?.contains(target) &&
        !popup.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-background";

  const menu = open ? (
    <div
      ref={popup}
      className="fixed z-50 min-w-40 rounded-lg border border-border bg-card p-1 shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      {actions.map((action) =>
        action.href ? (
          <Link
            key={action.ariaLabel ?? action.label}
            href={action.href}
            aria-label={action.ariaLabel}
            className={`${itemClass} text-ink-secondary`}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
          >
            <span>{action.label}</span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <button
            key={action.ariaLabel ?? action.label}
            type="button"
            aria-label={action.ariaLabel}
            disabled={disabled || action.disabled}
            className={`${itemClass} ${
              action.destructive ? "text-red-700" : "text-ink-secondary"
            } disabled:opacity-60`}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              action.onAction?.();
            }}
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  ) : null;

  return (
    <div ref={container} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) placeBelowTrigger();
          setOpen((current) => !current);
        }}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-sm text-ink-secondary hover:bg-background hover:text-ink disabled:opacity-60"
      >
        ⋯
      </button>
      {menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}
