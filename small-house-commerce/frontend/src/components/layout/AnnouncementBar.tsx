"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import type { AnnouncementBlockView, AnnouncementItemView } from "@/lib/api";
import { parseAnnouncementRichText } from "@/lib/announcement-rich-text";
import type { AnnouncementCountdownConfig, Schedule } from "@/lib/homepage-document";
import { safeHex } from "@/lib/homepage-styles";
import { requestNewsletterOffer } from "@/components/newsletter/newsletterOfferChannel";
import {
  AnnouncementCountdown,
  type AnnouncementDevice,
} from "./AnnouncementCountdown";
import { AnnouncementRichText } from "./AnnouncementRichText";

const MIN_ROTATION_MS = 2000;
const DEFAULT_ROTATION_MS = 5000;
const DEFAULT_BACKGROUND = "#244c3c";
const DEFAULT_TEXT_COLOR = "#FFFFFF";
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

function rotationIntervalMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ROTATION_MS;
  }
  return Math.max(Math.round(value), MIN_ROTATION_MS);
}

function isRenderableItem(item: unknown): item is AnnouncementItemView {
  if (item === null || typeof item !== "object") return false;
  const candidate = item as Partial<AnnouncementItemView>;
  return candidate.enabled === true && typeof candidate.text === "string";
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scheduleIsActive(schedule: Schedule | undefined, nowMs: number): boolean {
  if (!schedule) return true;
  const publishAt = schedule.publishAt === null ? -Infinity : timestamp(schedule.publishAt);
  const unpublishAt =
    schedule.unpublishAt === null ? Infinity : timestamp(schedule.unpublishAt);
  if (publishAt === null || unpublishAt === null) return false;
  return publishAt <= nowMs && nowMs < unpublishAt;
}

function countdownOf(item: AnnouncementItemView): AnnouncementCountdownConfig | null {
  const value = item.countdown;
  if (!value || typeof value !== "object") return null;
  if (value.endsAt !== null && timestamp(value.endsAt) === null) return null;
  if (value.color !== null && typeof value.color !== "string") return null;
  if (value.fontFamily !== "SANS" && value.fontFamily !== "POPPINS") return null;
  if (value.fontSize !== "SM" && value.fontSize !== "MD" && value.fontSize !== "LG") {
    return null;
  }
  if (![400, 500, 600, 700, 800].includes(value.fontWeight)) return null;
  return value;
}

function itemIsActive(item: AnnouncementItemView, nowMs: number | null): boolean {
  if (nowMs === null) return true;
  if (!scheduleIsActive(item.schedule, nowMs)) return false;
  const countdown = countdownOf(item);
  const deadline = countdown?.endsAt ? timestamp(countdown.endsAt) : null;
  return deadline === null || nowMs < deadline;
}

function itemDeadlines(item: AnnouncementItemView): number[] {
  const deadlines: number[] = [];
  const publishAt = timestamp(item.schedule?.publishAt);
  if (publishAt !== null) deadlines.push(publishAt);
  const unpublishAt = timestamp(item.schedule?.unpublishAt);
  if (unpublishAt !== null) deadlines.push(unpublishAt);
  const countdown = countdownOf(item);
  const countdownEnd = timestamp(countdown?.endsAt);
  if (countdownEnd !== null) deadlines.push(countdownEnd);
  return deadlines;
}

function useAnnouncementClock(items: AnnouncementItemView[]): number | null {
  const deadlineKey = items
    .flatMap(itemDeadlines)
    .sort((left, right) => left - right)
    .join(",");
  const countdownKey = items
    .map((item) => countdownOf(item)?.endsAt ?? "")
    .join(",");
  const [clock, setClock] = useState<{
    deadlineKey: string;
    nowMs: number;
  } | null>(null);

  useEffect(() => {
    const deadlines = deadlineKey
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    if (deadlines.length === 0) return undefined;

    const syncClock = (): void => {
      setClock({ deadlineKey, nowMs: Date.now() });
    };
    const initialSyncId = setTimeout(syncClock, 0);
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const futureCountdowns = countdownKey
      .split(",")
      .filter(Boolean)
      .map(timestamp)
      .filter(
        (deadline): deadline is number =>
          deadline !== null && deadline > startedAt,
      );
    const latestCountdownDeadline =
      futureCountdowns.length > 0 ? Math.max(...futureCountdowns) : null;
    if (latestCountdownDeadline !== null) {
      intervalId = setInterval(syncClock, 1000);
    }

    const deadlineIds = new Set<ReturnType<typeof setTimeout>>();
    const scheduleDeadline = (deadline: number): void => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        syncClock();
        if (
          deadline === latestCountdownDeadline &&
          intervalId !== undefined
        ) {
          clearInterval(intervalId);
          intervalId = undefined;
        }
        return;
      }
      const id = setTimeout(() => {
        deadlineIds.delete(id);
        scheduleDeadline(deadline);
      }, Math.min(remaining, MAX_SAFE_TIMEOUT_MS));
      deadlineIds.add(id);
    };
    [...new Set(deadlines)]
      .filter((deadline) => deadline > startedAt)
      .forEach(scheduleDeadline);
    document.addEventListener("visibilitychange", syncClock);
    return () => {
      clearTimeout(initialSyncId);
      if (intervalId !== undefined) clearInterval(intervalId);
      deadlineIds.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", syncClock);
    };
  }, [countdownKey, deadlineKey]);

  return clock?.deadlineKey === deadlineKey ? clock.nowMs : null;
}

function Separator(): ReactElement {
  return <span aria-hidden="true"> · </span>;
}

/**
 * The subscribe popup is an action, not a URL: an item may point at it
 * instead of a page. The trigger is a real button so it is reachable by
 * keyboard and announced as an action.
 */
function SubscribeTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      data-announcement-subscribe
      onClick={() => requestNewsletterOffer()}
      className={`cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}

/** True when the item points at the subscribe popup instead of a page. */
function isSubscribeItem(item: AnnouncementItemView): boolean {
  return item.link?.type === "SUBSCRIBE";
}

/** Opens the subscribe popup on demand. */
function openSubscribe(): void {
  requestNewsletterOffer();
}

function RichItem({
  item,
  countdown,
  nowMs,
  device,
  mode,
  wholeBarLink = false,
}: {
  item: AnnouncementItemView;
  countdown: AnnouncementCountdownConfig | null;
  nowMs: number | null;
  device: AnnouncementDevice;
  mode: "live" | "preview";
  /** The bar itself is the anchor, so the label must not nest another one. */
  wholeBarLink?: boolean;
}): ReactElement {
  const timer = countdown ? (
    <AnnouncementCountdown config={countdown} nowMs={nowMs} device={device} />
  ) : null;
  const hasTimer = timer !== null;
  const subscribe = isSubscribeItem(item);
  // A subscribe item has no href; its label is the trigger that opens the
  // popup. A normal item needs both a resolved href and a label - unless the
  // whole bar carries the link, in which case the label is just a suffix.
  const hasCta = subscribe
    ? Boolean(item.linkLabel)
    : Boolean(item.linkHref && item.linkLabel);
  const cta = hasCta ? (
    mode === "live" ? (
      subscribe ? (
        <SubscribeTrigger className="underline underline-offset-2">
          {item.linkLabel}
        </SubscribeTrigger>
      ) : wholeBarLink ? (
        <span className="underline underline-offset-2">{item.linkLabel}</span>
      ) : (
        <a href={item.linkHref!} className="underline underline-offset-2">
          {item.linkLabel}
        </a>
      )
    ) : (
      <span className="underline underline-offset-2">{item.linkLabel}</span>
    )
  ) : null;

  return (
    <span className="inline-flex max-w-full items-center justify-center">
      <AnnouncementRichText content={item.content} />
      {hasTimer ? <Separator /> : null}
      {timer}
      {hasCta ? <Separator /> : null}
      {cta}
    </span>
  );
}

function LegacyItem({
  item,
  countdown,
  nowMs,
  device,
  mode,
}: {
  item: AnnouncementItemView;
  countdown: AnnouncementCountdownConfig | null;
  nowMs: number | null;
  device: AnnouncementDevice;
  mode: "live" | "preview";
}): ReactElement {
  const timer = countdown ? (
    <AnnouncementCountdown config={countdown} nowMs={nowMs} device={device} />
  ) : null;
  const subscribe = isSubscribeItem(item);
  const body = (
    <>
      <span>{item.text}</span>
      {timer ? <Separator /> : null}
      {timer}
      {subscribe ? (
        item.linkLabel ? (
          <>
            {" "}
            {mode === "live" ? (
              <SubscribeTrigger className="underline underline-offset-2">
                {item.linkLabel}
              </SubscribeTrigger>
            ) : (
              <span className="underline underline-offset-2">
                {item.linkLabel}
              </span>
            )}
          </>
        ) : null
      ) : item.linkHref && item.linkLabel ? (
        <>
          {" "}
          <span className="underline underline-offset-2">{item.linkLabel}</span>
        </>
      ) : null}
    </>
  );

  if (mode === "live" && item.linkHref) {
    return (
      <a href={item.linkHref} className="inline-flex items-center justify-center">
        {body}
      </a>
    );
  }
  return <span className="inline-flex items-center justify-center">{body}</span>;
}

export function AnnouncementBar({
  data,
  mode = "live",
  device,
}: {
  data: AnnouncementBlockView | null;
  mode?: "live" | "preview";
  device?: AnnouncementDevice;
}): ReactNode {
  const sourceItems = useMemo(
    () => (Array.isArray(data?.items) ? data.items : []).filter(isRenderableItem),
    [data],
  );
  const nowMs = useAnnouncementClock(sourceItems);
  const items = useMemo(
    () => sourceItems.filter((item) => itemIsActive(item, nowMs)),
    [nowMs, sourceItems],
  );
  const rotationMs = rotationIntervalMs(data?.rotationMs);
  const reducedMotion = usePrefersReducedMotion();
  const mobileViewport = useMobileViewport();
  const resolvedDevice = device ?? (mobileViewport ? "mobile" : "desktop");
  const [activeIndex, setActiveIndex] = useState(0);
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (reducedMotion || items.length < 2) {
      hoveredRef.current = false;
      return undefined;
    }
    const id = setInterval(() => {
      if (hoveredRef.current) return;
      setActiveIndex((current) => (current + 1) % items.length);
    }, rotationMs);
    return () => clearInterval(id);
  }, [items.length, reducedMotion, rotationMs]);

  if (!data || !data.enabled || items.length === 0) return null;

  const item = reducedMotion ? items[0] : items[activeIndex % items.length];
  const countdown = countdownOf(item);
  const rich = parseAnnouncementRichText(item.content) !== null;
  // A subscribe item without a label opens the popup from the whole line, so
  // the bar itself becomes the trigger.
  const wholeBarTriggersSubscribe =
    mode === "live" && isSubscribeItem(item) && !item.linkLabel;
  // A rich item with a page link turns the whole line into that link (the
  // copy itself is the affordance, exactly like a legacy item).
  const wholeBarHref =
    mode === "live" && rich && !isSubscribeItem(item) && item.linkHref
      ? item.linkHref
      : null;

  return (
    <div
      data-announcement-bar
      data-announcement-item-id={item.id}
      data-item-id={item.id}
      className="bg-cta px-4 py-2 text-center text-xs font-medium text-cta-foreground sm:text-sm"
      style={{
        backgroundColor: safeHex(item.backgroundColor, DEFAULT_BACKGROUND),
        color: safeHex(item.textColor, DEFAULT_TEXT_COLOR),
      }}
      role={wholeBarTriggersSubscribe ? "button" : undefined}
      tabIndex={wholeBarTriggersSubscribe ? 0 : undefined}
      onClick={wholeBarTriggersSubscribe ? openSubscribe : undefined}
      onKeyDown={
        wholeBarTriggersSubscribe
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openSubscribe();
            }
          : undefined
      }
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
    >
      {rich ? (
        wholeBarHref ? (
          <a
            href={wholeBarHref}
            data-announcement-whole-link
            className="inline-flex max-w-full items-center justify-center"
          >
            <RichItem
              item={item}
              countdown={countdown}
              nowMs={nowMs}
              device={resolvedDevice}
              mode={mode}
              wholeBarLink
            />
          </a>
        ) : (
          <RichItem
            item={item}
            countdown={countdown}
            nowMs={nowMs}
            device={resolvedDevice}
            mode={mode}
          />
        )
      ) : (
        <LegacyItem
          item={item}
          countdown={countdown}
          nowMs={nowMs}
          device={resolvedDevice}
          mode={mode}
        />
      )}
    </div>
  );
}

function subscribeMedia(query: string, onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(query);
  const handleChange = (): void => onChange();
  media.addEventListener?.("change", handleChange);
  return () => media.removeEventListener?.("change", handleChange);
}

function mediaSnapshot(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia("(prefers-reduced-motion: reduce)", onChange),
    () => mediaSnapshot("(prefers-reduced-motion: reduce)"),
    () => false,
  );
}

function useMobileViewport(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia("(max-width: 639px)", onChange),
    () => mediaSnapshot("(max-width: 639px)"),
    () => false,
  );
}
