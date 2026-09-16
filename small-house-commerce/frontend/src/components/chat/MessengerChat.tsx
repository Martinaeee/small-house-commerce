"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

/**
 * Floating Facebook Messenger button (Castlery-style):
 * - hides while the page scrolls and fades back shortly after scrolling stops;
 * - press-and-drag moves it anywhere inside the viewport (5px click threshold);
 * - after 45s without interaction (tab visible, no dialog open) it shows a
 *   one-shot "Have questions? / Chat now" nudge, dismissible for the session;
 * - a plain click opens the business Page chat in a new tab.
 * Renders nothing (nudge included) until a Messenger URL is configured.
 */
const SIZE = 56;
const MARGIN = 12;
const SCROLL_IDLE_DELAY_MS = 600;
const NUDGE_DELAY_MS = 45_000;
const DRAG_THRESHOLD_PX = 5;
const NUDGE_DISMISS_KEY = "luwag_chat_nudge_dismissed";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function readNudgeDismissed(): boolean {
  try {
    return sessionStorage.getItem(NUDGE_DISMISS_KEY) === "1";
  } catch {
    // Storage unavailable (private mode etc.): the in-memory refs still apply.
    return false;
  }
}

function writeNudgeDismissed(): void {
  try {
    sessionStorage.setItem(NUDGE_DISMISS_KEY, "1");
  } catch {
    // Ignore: memory fallback (firedRef/dismissedRef) covers this tab.
  }
}

export function MessengerChat() {
  const { messengerUrl } = useSiteSettings();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  // A drag-ending click must not open the chat; reset once it has fired.
  const suppressClickRef = useRef(false);
  // Seeded from sessionStorage so a dismissal earlier in this tab never revives.
  const firedRef = useRef(readNudgeDismissed());
  const dismissedRef = useRef(readNudgeDismissed());

  const dismissNudge = useCallback(() => {
    firedRef.current = true;
    dismissedRef.current = true;
    writeNudgeDismissed();
    setNudgeVisible(false);
  }, []);

  const openChat = useCallback(() => {
    window.open(messengerUrl, "_blank", "noopener,noreferrer");
  }, [messengerUrl]);

  // Scroll hide/show. capture:true also catches scrolling inside containers.
  // Hidden imperatively (inline opacity) so the result never depends on a
  // transition being ticked while the page scrolls. The fade-back uses a
  // short transition with a forced end-state commit, which also lands
  // immediately on renderers that never advance the animation clock.
  useEffect(() => {
    if (!messengerUrl) return;
    const el = buttonRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(commitTimer);
      el.style.transition = "";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    };
    const show = () => {
      el.style.pointerEvents = "";
      el.style.transition = "opacity 180ms ease-out";
      void el.offsetWidth; // commit the before-change style first
      el.style.opacity = "1";
      // Guarantee the visible end state even if the transition isn't ticked.
      commitTimer = setTimeout(() => {
        el.style.transition = "";
      }, 240);
    };
    const onScroll = () => {
      if (dragRef.current) return;
      hide();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(show, SCROLL_IDLE_DELAY_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(idleTimer);
      clearTimeout(commitTimer);
    };
  }, [messengerUrl]);

  // Keep a dragged button on-screen after resize/rotation.
  useEffect(() => {
    if (!messengerUrl) return;
    const onResize = () =>
      setPos((p) =>
        p
          ? {
              x: clamp(p.x, MARGIN, window.innerWidth - SIZE - MARGIN),
              y: clamp(p.y, MARGIN, window.innerHeight - SIZE - MARGIN),
            }
          : p,
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [messengerUrl]);

  // One-shot 45s inactivity nudge. Setup/cleanup are symmetric so StrictMode
  // dev replay (mount -> cleanup -> mount) simply re-arms the same timer.
  useEffect(() => {
    if (!messengerUrl) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (firedRef.current || dismissedRef.current || document.hidden) return;
      timer = setTimeout(() => {
        if (firedRef.current || dismissedRef.current || document.hidden) return;
        // Cart drawer / pickers / mobile menu are role="dialog" — never compete.
        if (document.querySelector("[role='dialog']")) {
          schedule();
          return;
        }
        firedRef.current = true;
        setNudgeVisible(true);
      }, NUDGE_DELAY_MS);
    };

    // Any of these counts as activity and restarts the 45s window.
    const onActivity = () => schedule();
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        schedule();
      }
    };

    schedule();
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("scroll", onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [messengerUrl]);

  // Esc dismisses the nudge. Capture + stopPropagation so a drawer that
  // opened behind the nudge doesn't also react to the same keypress.
  useEffect(() => {
    if (!nudgeVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismissNudge();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [nudgeVisible, dismissNudge]);

  if (!messengerUrl) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    setPos({
      x: clamp(drag.originX + dx, MARGIN, window.innerWidth - SIZE - MARGIN),
      y: clamp(drag.originY + dy, MARGIN, window.innerHeight - SIZE - MARGIN),
    });
  };

  const onPointerUp = () => {
    if (dragRef.current?.moved) suppressClickRef.current = true;
    dragRef.current = null;
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    openChat();
  };

  // When the FAB sits in the left half (dragged), anchor the card to its left.
  const nudgeSideClass =
    pos && typeof window !== "undefined" && pos.x + SIZE / 2 < window.innerWidth / 2
      ? "left-0"
      : "right-0";

  return (
    <div
      data-testid="messenger-chat-anchor"
      className="fixed z-40"
      style={{
        left: pos ? pos.x : undefined,
        top: pos ? pos.y : undefined,
        right: pos ? undefined : 16,
        bottom: pos ? undefined : 16,
        width: SIZE,
        height: SIZE,
      }}
    >
      {nudgeVisible ? (
        <div
          role="status"
          data-testid="chat-nudge"
          className={`absolute bottom-full mb-3 w-60 rounded-xl border border-border bg-card p-3 shadow-xl ${nudgeSideClass}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Have questions?</p>
            <button
              type="button"
              aria-label="Dismiss"
              data-testid="chat-nudge-dismiss"
              onClick={dismissNudge}
              className="-mr-1 -mt-1 rounded p-0.5 text-ink-muted hover:text-ink"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            data-testid="chat-nudge-cta"
            onClick={() => {
              dismissNudge();
              openChat();
            }}
            className="mt-1 text-sm font-semibold text-cta hover:underline"
          >
            Chat now
          </button>
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Chat with us on Messenger"
        title="Chat with us on Messenger"
        data-testid="messenger-chat"
        style={{ width: SIZE, height: SIZE, touchAction: "none" }}
        className="flex h-full w-full items-center justify-center rounded-full bg-cta text-white shadow-lg hover:bg-cta-hover"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.27 0 0 4.93 0 12c0 3.63 1.86 6.54 4.78 8.5V24l4.38-2.4c.9.25 1.85.38 2.84.38 6.73 0 12-4.93 12-12S18.73 0 12 0zm1.2 16.1l-3.06-3.26-5.99 3.26 6.59-7.01 3.13 3.26 5.88-3.26-6.55 7.01z" />
        </svg>
      </button>
    </div>
  );
}
