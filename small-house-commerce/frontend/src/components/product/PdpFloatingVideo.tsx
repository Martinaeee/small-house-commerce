"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useDesktopViewport } from "./useDesktopViewport";
import styles from "./PdpMobile.module.css";

/**
 * JD-style mini player: once the hero gallery leaves the phone viewport, the
 * product's first shared video keeps playing in a small floating window.
 * Shoppers can drag it out of the way or close it for the session; the admin
 * media tab decides which video by ordering the shared videos.
 */
export function PdpFloatingVideo({
  videoUrl,
  productName,
}: {
  videoUrl: string;
  productName: string;
}): ReactNode {
  const desktop = useDesktopViewport();
  const trimmed = videoUrl.trim();
  const storageKey = trimmed
    ? `luwag:pdp-floating-video-dismissed:${trimmed}`
    : "";
  const [dismissed, setDismissed] = useState(() => {
    if (!trimmed || typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    if (desktop || !trimmed || dismissed) {
      const timer = window.setTimeout(() => setVisible(false), 0);
      return () => window.clearTimeout(timer);
    }
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const gallery = document.querySelector("[data-pdp-gallery]");
    if (!gallery) {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0.05 },
    );
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [desktop, dismissed, trimmed]);

  useEffect(() => {
    if (!visible) return;
    const video = videoRef.current;
    if (!video) return;
    // The mount can land before the element is ready; retry the muted
    // autoplay once it is on screen. A policy rejection is silent.
    const attempt = video.play();
    if (attempt) attempt.catch(() => undefined);
  }, [visible]);

  if (desktop || !trimmed || dismissed || !visible) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Private mode: the window still closes for this page view.
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    el.setPointerCapture?.(event.pointerId);
    setPos({ left: rect.left, top: rect.top });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const el = frameRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    // Keep 70px clear at the bottom for the fixed purchase bar.
    const left = Math.min(
      Math.max(8, drag.left + event.clientX - drag.startX),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(70, drag.top + event.clientY - drag.startY),
      window.innerHeight - height - 70,
    );
    setPos({ left, top });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    frameRef.current?.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      ref={frameRef}
      data-testid="pdp-floating-video"
      data-dragged={pos ? "true" : "false"}
      className={styles.floatingVideo}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      aria-label="Product video"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <video
        ref={videoRef}
        src={trimmed}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        title={productName}
        aria-label={`${productName} video`}
      />
      <button
        type="button"
        className={styles.floatingClose}
        aria-label="Close product video"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
