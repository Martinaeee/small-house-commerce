"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

/**
 * Floating multi-channel support control (Castlery-style):
 * - zero configured channels renders nothing; one channel is a direct action;
 * - multiple channels expand above/below the draggable FAB;
 * - hides while the page scrolls and fades back shortly after scrolling stops;
 * - press-and-drag moves it anywhere inside the viewport (5px click threshold);
 * - after 45s without interaction (tab visible, no dialog open) it shows a
 *   one-shot nudge, dismissible for the session.
 */
const SIZE = 56;
const MARGIN = 12;
const SCROLL_IDLE_DELAY_MS = 600;
const NUDGE_DELAY_MS = 45_000;
const DRAG_THRESHOLD_PX = 5;
const NUDGE_DISMISS_KEY = "luwag_chat_nudge_dismissed";

// Minimum space above the FAB for the nudge card (~88px tall); below this the
// card flips below the FAB so it can never render off-screen and consume the
// one-shot invisibly.
const NUDGE_CARD_RESERVE_PX = 128;
const CHANNEL_STACK_RESERVE_PX = 190;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

type SupportChannelKind = "MESSENGER" | "EMAIL" | "PHONE";

interface SupportChannel {
  kind: SupportChannelKind;
  label: string;
  directLabel: string;
  nudgeLabel: string;
  href: string;
  target?: "_blank";
}

function supportChannels({
  messengerUrl,
  supportEmail,
  supportPhone,
}: {
  messengerUrl: string;
  supportEmail: string;
  supportPhone: string;
}): SupportChannel[] {
  const channels: SupportChannel[] = [];
  const messenger = messengerUrl.trim();
  const email = supportEmail.trim();
  const phone = supportPhone.trim();
  if (messenger) {
    channels.push({
      kind: "MESSENGER",
      label: "Messenger",
      directLabel: "Contact us on Messenger",
      nudgeLabel: "Chat now",
      href: messenger,
      target: "_blank",
    });
  }
  if (email) {
    channels.push({
      kind: "EMAIL",
      label: "Email",
      directLabel: "Email support",
      nudgeLabel: "Email us",
      href: `mailto:${email}`,
    });
  }
  if (phone) {
    channels.push({
      kind: "PHONE",
      label: "Call",
      directLabel: "Call support",
      nudgeLabel: "Call us",
      href: `tel:${phone.replace(/[()\-\s]/g, "")}`,
    });
  }
  return channels;
}

function ChannelIcon({ kind, className = "h-5 w-5" }: {
  kind: SupportChannelKind | "MULTI";
  className?: string;
}) {
  if (kind === "MESSENGER") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.27 0 0 4.93 0 12c0 3.63 1.86 6.54 4.78 8.5V24l4.38-2.4c.9.25 1.85.38 2.84.38 6.73 0 12-4.93 12-12S18.73 0 12 0zm1.2 16.1l-3.06-3.26-5.99 3.26 6.59-7.01 3.13 3.26 5.88-3.26-6.55 7.01z" />
      </svg>
    );
  }
  if (kind === "EMAIL") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "PHONE") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M7.2 3.8 9.7 7l-2 2.2c1.2 2.8 3.3 4.9 6.1 6.1l2.2-2 3.2 2.5-.8 3.4c-.2.8-.9 1.3-1.7 1.3C9.4 20.5 3.5 14.6 3.5 7.3c0-.8.5-1.5 1.3-1.7l2.4-.8Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" strokeLinejoin="round" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
}

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

// role="dialog" includes drawers that stay mounted while closed: the mobile
// menu renders off-screen inside an inert, aria-hidden container (and is
// display:none at lg widths). Only an actually open, visible dialog suppresses
// the nudge.
function hasOpenDialog(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']")).some((el) => {
    if (el.closest("[aria-hidden='true'], [inert]")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  });
}

export function MessengerChat() {
  const { messengerUrl, supportEmail, supportPhone } = useSiteSettings();
  const channels = useMemo(
    () => supportChannels({ messengerUrl, supportEmail, supportPhone }),
    [messengerUrl, supportEmail, supportPhone],
  );
  const channelKey = channels.map(({ kind, href }) => `${kind}:${href}`).join("|");
  const hasChannels = channels.length > 0;
  const multipleChannels = channels.length > 1;
  const primaryChannel = channels[0] ?? null;
  const fabRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [openChannelKey, setOpenChannelKey] = useState<string | null>(null);
  const channelsOpen = multipleChannels && openChannelKey === channelKey;
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  // A drag-ending click must not perform an action; reset once it has fired.
  const suppressClickRef = useRef(false);
  // Seeded once from sessionStorage so a dismissal earlier in this tab never
  // revives. Lazy initializer reads storage once total; useRef then just takes
  // the boolean (render-phase ref writes are banned by react-hooks/refs).
  const [initiallyDismissed] = useState(() => readNudgeDismissed());
  const firedRef = useRef(initiallyDismissed);
  const dismissedRef = useRef(initiallyDismissed);

  const setFabRef = useCallback((node: HTMLElement | null) => {
    fabRef.current = node;
  }, []);

  const dismissNudge = useCallback(() => {
    firedRef.current = true;
    dismissedRef.current = true;
    writeNudgeDismissed();
    setNudgeVisible(false);
  }, []);

  // Scroll hide/show. capture:true also catches scrolling inside containers.
  // Hidden imperatively (inline opacity) so the result never depends on a
  // transition being ticked while the page scrolls. The fade-back uses a
  // short transition with a forced end-state commit, which also lands
  // immediately on renderers that never advance the animation clock.
  useEffect(() => {
    if (!hasChannels) return;
    const el = fabRef.current;
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
      void el.offsetWidth;
      el.style.opacity = "1";
      commitTimer = setTimeout(() => {
        el.style.transition = "";
      }, 240);
    };
    const onScroll = () => {
      if (dragRef.current) return;
      hide();
      setOpenChannelKey(null);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(show, SCROLL_IDLE_DELAY_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(idleTimer);
      clearTimeout(commitTimer);
    };
  }, [hasChannels, channelKey]);

  // Keep a dragged button on-screen after resize/rotation.
  useEffect(() => {
    if (!hasChannels) return;
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
  }, [hasChannels, channelKey]);

  // One-shot 45s inactivity nudge. Setup/cleanup are symmetric so StrictMode
  // dev replay (mount -> cleanup -> mount) simply re-arms the same timer.
  useEffect(() => {
    if (!hasChannels) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (firedRef.current || dismissedRef.current || document.hidden) return;
      timer = setTimeout(() => {
        if (firedRef.current || dismissedRef.current || document.hidden) return;
        if (hasOpenDialog()) {
          schedule();
          return;
        }
        firedRef.current = true;
        writeNudgeDismissed();
        setNudgeVisible(true);
      }, NUDGE_DELAY_MS);
    };

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
  }, [hasChannels, channelKey]);

  // Escape explicitly collapses the channel stack or dismisses the nudge.
  useEffect(() => {
    if (!nudgeVisible && !channelsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (channelsOpen) {
        setOpenChannelKey(null);
        window.setTimeout(() => fabRef.current?.focus(), 0);
      }
      if (nudgeVisible) dismissNudge();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [channelsOpen, nudgeVisible, dismissNudge]);

  if (!hasChannels || !primaryChannel) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
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

  const consumeSuppressedClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  const nudgeSideClass =
    pos && typeof window !== "undefined" && pos.x + SIZE / 2 < window.innerWidth / 2
      ? "left-0"
      : "right-0";
  const nudgeVerticalClass =
    pos && pos.y <= NUDGE_CARD_RESERVE_PX ? "top-full mt-3" : "bottom-full mb-3";
  const stackVerticalClass =
    pos && pos.y <= CHANNEL_STACK_RESERVE_PX ? "top-full mt-3" : "bottom-full mb-3";

  const fabClassName =
    "flex h-full w-full items-center justify-center rounded-full bg-cta text-white shadow-lg transition hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2";

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
          className={`absolute ${nudgeVerticalClass} w-60 rounded-xl border border-border bg-card p-3 shadow-xl ${nudgeSideClass}`}
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
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {multipleChannels ? (
            <button
              type="button"
              data-testid="chat-nudge-cta"
              onClick={() => {
                dismissNudge();
                setOpenChannelKey(channelKey);
              }}
              className="mt-1 text-sm font-semibold text-cta hover:underline"
            >
              Choose how to contact us
            </button>
          ) : (
            <a
              data-testid="chat-nudge-cta"
              href={primaryChannel.href}
              target={primaryChannel.target}
              rel={primaryChannel.target ? "noopener noreferrer" : undefined}
              onClick={dismissNudge}
              className="mt-1 inline-block text-sm font-semibold text-cta hover:underline"
            >
              {primaryChannel.nudgeLabel}
            </a>
          )}
        </div>
      ) : null}

      {multipleChannels ? (
        <button
          ref={setFabRef}
          type="button"
          onClick={() => {
            if (consumeSuppressedClick()) return;
            dismissNudge();
            setOpenChannelKey((open) =>
              open === channelKey ? null : channelKey,
            );
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Contact support"
          title="Contact support"
          aria-expanded={channelsOpen}
          aria-controls="support-channel-options"
          data-testid="messenger-chat"
          style={{ width: SIZE, height: SIZE, touchAction: "none" }}
          className={fabClassName}
        >
          <ChannelIcon kind="MULTI" className="h-7 w-7" />
        </button>
      ) : (
        <a
          ref={setFabRef}
          href={primaryChannel.href}
          target={primaryChannel.target}
          rel={primaryChannel.target ? "noopener noreferrer" : undefined}
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.preventDefault();
              return;
            }
            dismissNudge();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label={primaryChannel.directLabel}
          title={primaryChannel.directLabel}
          data-testid="messenger-chat"
          style={{ width: SIZE, height: SIZE, touchAction: "none" }}
          className={fabClassName}
        >
          <ChannelIcon kind={primaryChannel.kind} className="h-7 w-7" />
        </a>
      )}

      {multipleChannels && channelsOpen ? (
        <div
          id="support-channel-options"
          data-testid="support-channel-stack"
          className={`absolute ${stackVerticalClass} ${nudgeSideClass} w-52 rounded-xl border border-border bg-card p-2 shadow-xl`}
        >
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Contact us
            </p>
            <button
              type="button"
              aria-label="Close support options"
              onClick={() => {
                setOpenChannelKey(null);
                fabRef.current?.focus();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-background hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1" role="group" aria-label="Support channels">
            {channels.map((channel) => (
              <a
                key={channel.kind}
                href={channel.href}
                target={channel.target}
                rel={channel.target ? "noopener noreferrer" : undefined}
                onClick={() => setOpenChannelKey(null)}
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-ink transition hover:bg-background hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              >
                <ChannelIcon kind={channel.kind} />
                {channel.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
