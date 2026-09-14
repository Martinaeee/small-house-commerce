"use client";

import { useEffect, useRef, useState } from "react";
import { MESSENGER_URL } from "@/lib/siteConfig";

/**
 * Floating Facebook Messenger button (Castlery-style): hides while the page
 * scrolls and fades back shortly after scrolling stops; press-and-drag moves
 * it anywhere inside the viewport; a plain click opens the business Page chat
 * in a new tab. Renders nothing until MESSENGER_URL is configured.
 */
const SIZE = 56;
const MARGIN = 12;
const IDLE_DELAY_MS = 600;
const DRAG_THRESHOLD_PX = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function MessengerChat() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  // A drag-ending click must not open the chat; reset once it has fired.
  const suppressClickRef = useRef(false);

  // Scroll hide/show. capture:true also catches scrolling inside containers.
  // Hidden imperatively (inline opacity) so the result never depends on a
  // transition being ticked while the page scrolls. The fade-back uses a
  // short transition with a forced end-state commit, which also lands
  // immediately on renderers that never advance the animation clock.
  useEffect(() => {
    if (!MESSENGER_URL) return;
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
      idleTimer = setTimeout(show, IDLE_DELAY_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(idleTimer);
      clearTimeout(commitTimer);
    };
  }, []);

  // Keep a dragged button on-screen after resize/rotation.
  useEffect(() => {
    if (!MESSENGER_URL) return;
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
  }, []);

  if (!MESSENGER_URL) return null;

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
    window.open(MESSENGER_URL, "_blank", "noopener,noreferrer");
  };

  return (
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
      style={{
        left: pos ? pos.x : undefined,
        top: pos ? pos.y : undefined,
        right: pos ? undefined : 16,
        bottom: pos ? undefined : 16,
        width: SIZE,
        height: SIZE,
        touchAction: "none",
      }}
      className="fixed z-40 flex items-center justify-center rounded-full bg-cta text-white shadow-lg hover:bg-cta-hover"
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.27 0 0 4.93 0 12c0 3.63 1.86 6.54 4.78 8.5V24l4.38-2.4c.9.25 1.85.38 2.84.38 6.73 0 12-4.93 12-12S18.73 0 12 0zm1.2 16.1l-3.06-3.26-5.99 3.26 6.59-7.01 3.13 3.26 5.88-3.26-6.55 7.01z" />
      </svg>
    </button>
  );
}
