"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  registerViewportPlayback,
  type ViewportPlaybackMode,
  type ViewportPlaybackRegistration,
} from "@/lib/viewport-video-coordinator";

export type VideoPlaybackMode = ViewportPlaybackMode | "LIGHTBOX";

interface NetworkInformationLike {
  saveData?: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

function connection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as NavigatorWithConnection).connection;
}

function autoplayAllowedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return !reduced && connection()?.saveData !== true;
}

function subscribeAutoplayPreference(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const network = connection();
  media?.addEventListener("change", onChange);
  network?.addEventListener?.("change", onChange);
  return () => {
    media?.removeEventListener("change", onChange);
    network?.removeEventListener?.("change", onChange);
  };
}

export function ViewportVideo({
  src,
  mode,
  ariaLabel,
  className,
  poster,
  controls,
}: {
  src: string;
  mode: VideoPlaybackMode;
  ariaLabel: string;
  className?: string;
  poster?: string;
  controls?: boolean;
}): ReactNode {
  const reactId = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const registrationRef = useRef<ViewportPlaybackRegistration | null>(null);
  const intersectionRatioRef = useRef(0);
  const [sourceEnabled, setSourceEnabled] = useState(mode === "LIGHTBOX");
  const autoplayAllowed = useSyncExternalStore(
    subscribeAutoplayPreference,
    autoplayAllowedSnapshot,
    () => false,
  );
  const autoplayMode = mode === "LIGHTBOX" ? null : mode;

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !autoplayMode) return;
    const registration = registerViewportPlayback({
      id: `${reactId}:${src}`,
      element,
      mode: autoplayMode,
    });
    registrationRef.current = registration;
    registration.update({
      eligible: sourceEnabled && autoplayAllowed,
      intersectionRatio: intersectionRatioRef.current,
    });
    return () => {
      registrationRef.current = null;
      registration.unregister();
    };
  }, [autoplayAllowed, autoplayMode, reactId, sourceEnabled, src]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !autoplayMode) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setSourceEnabled(true));
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.isIntersecting ? entry.intersectionRatio : 0;
        intersectionRatioRef.current = ratio;
        if (entry?.isIntersecting) setSourceEnabled(true);
        registrationRef.current?.update({
          eligible: sourceEnabled && autoplayAllowed,
          intersectionRatio: ratio,
        });
      },
      { rootMargin: "320px 0px", threshold: [0, 0.25, 0.6] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [autoplayAllowed, autoplayMode, sourceEnabled]);

  const attachSource = mode === "LIGHTBOX" || sourceEnabled;
  const showControls =
    controls ?? (mode === "CONTENT" || mode === "LIGHTBOX");

  return (
    <video
      ref={videoRef}
      src={attachSource ? src : undefined}
      muted={mode !== "LIGHTBOX"}
      playsInline
      controls={showControls}
      loop={mode === "TEASER" || mode === "HERO"}
      preload={mode === "LIGHTBOX" || !autoplayAllowed ? "none" : "metadata"}
      poster={poster || undefined}
      aria-label={ariaLabel}
      className={className}
      data-video-mode={mode}
    />
  );
}
