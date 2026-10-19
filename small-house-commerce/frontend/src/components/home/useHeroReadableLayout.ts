"use client";

import { useEffect, type RefObject } from "react";
import type { HomepageHeroPayload } from "@/lib/api";
import type { HeroElementKey, HomepageDevice } from "@/lib/homepage-document";
import { fitHeroBoxes, flowHeroBoxes, heroTargetHeight, type HeroBox } from "@/lib/homepage-hero-layout";

export function useHeroReadableLayout(
  rootRef: RefObject<HTMLDivElement | null>,
  payload: HomepageHeroPayload | null,
  previewDevice?: HomepageDevice,
  previewViewportHeight?: number,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const win = root.ownerDocument.defaultView;
    if (!win) return;
    let disposed = false;
    let pending = 0;
    const posterRatios = new Map<string, number | null>();
    const posterImages: HTMLImageElement[] = [];
    const visibleHeight = (node: HTMLElement): number =>
      win.getComputedStyle(node).display === "none" ? 0 : node.offsetHeight;
    const percentage = (styles: CSSStyleDeclaration, key: string, fallback: number): number => {
      const value = Number.parseFloat(styles.getPropertyValue(key));
      return Number.isFinite(value) ? value : fallback;
    };
    const schedule = (): void => {
      if (!disposed && !pending) pending = win.requestAnimationFrame(measure);
    };
    const mediaRatio = (slide: HTMLElement): number | null => {
      for (const wrapper of slide.querySelectorAll<HTMLElement>("[data-hero-media], [data-hero-mobile-media]")) {
        if (win.getComputedStyle(wrapper).display === "none") continue;
        const image = wrapper.querySelector("img");
        if (image?.naturalWidth && image.naturalHeight) return image.naturalWidth / image.naturalHeight;
        const video = wrapper.querySelector("video");
        if (video?.videoWidth && video.videoHeight) return video.videoWidth / video.videoHeight;
        const poster = video?.getAttribute("poster");
        if (poster) {
          if (!posterRatios.has(poster)) {
            posterRatios.set(poster, null);
            const image = root.ownerDocument.createElement("img");
            image.referrerPolicy = "no-referrer";
            image.onload = () => {
              if (disposed || !image.naturalWidth || !image.naturalHeight) return;
              posterRatios.set(poster, image.naturalWidth / image.naturalHeight);
              schedule();
            };
            posterImages.push(image);
            image.src = poster;
          }
          return posterRatios.get(poster) ?? null;
        }
      }
      return null;
    };
    function measure(): void {
      pending = 0;
      if (disposed || !root || !win || root.clientWidth <= 0) return;
      const device = previewDevice ?? (win.innerWidth < 768 ? "mobile" : win.innerWidth < 1024 ? "tablet" : "desktop");
      const display = payload?.display;
      const automatic = ((device === "desktop" ? undefined : display?.overrides?.[device]?.contentLayout) ?? display?.contentLayout) === "AUTO";
      const mode = (device === "desktop" ? undefined : display?.overrides?.[device]?.heightMode) ?? display?.heightMode ?? (automatic ? "BANNER" : undefined);
      if (mode !== "SCREEN" && mode !== "BANNER" && mode !== "NATURAL") {
        delete root.dataset.readableReady;
        delete root.dataset.heroHeightMode;
        return;
      }
      const shell = root.closest(".storefront-app");
      const shellTop = [...(shell?.querySelectorAll<HTMLElement>("header, [data-announcement-bar]") ?? [])]
        .reduce((height, node) => height + visibleHeight(node), 0);
      const shellBottom = [...(shell?.querySelectorAll<HTMLElement>("[data-homepage-bottom-chrome]") ?? [])]
        .reduce((height, node) => height + visibleHeight(node), 0);
      const width = root.clientWidth;
      const padding = device === "mobile" ? 20 : device === "tablet" ? 28
        : Math.max(0, (width - 1336) / 2) + Math.min(48, Math.max(24, width * .0333));
      const copyWidth = Math.max(0, Math.min(device === "desktop" ? 544 : width, width - padding * 2));
      const viewportHeight = previewViewportHeight ?? win.visualViewport?.height ?? win.innerHeight;
      let height = 0;
      for (const slide of root.querySelectorAll<HTMLElement>("[data-slide]")) {
        const target = heroTargetHeight({ mode, device, width, viewportHeight, shellTop, shellBottom, mediaRatio: mediaRatio(slide) });
        const styles = win.getComputedStyle(slide);
        const elements = new Map<HeroElementKey, HTMLElement>();
        const boxes: HeroBox[] = [];
        for (const element of slide.querySelectorAll<HTMLElement>("[data-hero-element]")) {
          if (!element.textContent?.trim()) continue;
          const key = element.dataset.heroElement as HeroElementKey;
          const preferredWidth = automatic ? copyWidth : width * percentage(styles, `--el-${key}-w`, 100) / 100;
          element.style.setProperty("--hp-safe-min-w", key.startsWith("cta") ? "fit-content" : "min-content");
          element.style.setProperty("--hp-safe-w", automatic && key.startsWith("cta") ? "fit-content" : `${Math.max(0, Math.min(preferredWidth, width - 32))}px`);
          const measuredWidth = Math.max(0, Math.min(Number.parseFloat(win.getComputedStyle(element).width), width - 32));
          element.style.setProperty("--hp-safe-min-w", "0px");
          element.style.setProperty("--hp-safe-w", `${measuredWidth}px`);
          elements.set(key, element);
          boxes.push({ key, left: width * percentage(styles, `--el-${key}-x`, 0) / 100,
            top: target * percentage(styles, `--el-${key}-y`, 0) / 100,
            width: measuredWidth, height: element.offsetHeight });
        }
        const layout = automatic ? flowHeroBoxes(boxes, { width, height: target, padding, device })
          : fitHeroBoxes(boxes, { width, height: target, padding: 16, gap: 12 });
        if (layout.boxes.length > 0) {
          const left = Math.max(0, Math.min(...layout.boxes.map((box) => box.left)) - 24);
          const top = Math.max(0, Math.min(...layout.boxes.map((box) => box.top)) - 24);
          const right = Math.min(width, Math.max(...layout.boxes.map((box) => box.left + box.width)) + 24);
          const bottom = Math.min(layout.height, Math.max(...layout.boxes.map((box) => box.top + box.height)) + 24);
          slide.style.setProperty("--hp-copy-left", `${left}px`);
          slide.style.setProperty("--hp-copy-top", `${top}px`);
          slide.style.setProperty("--hp-copy-width", `${right - left}px`);
          slide.style.setProperty("--hp-copy-height", `${bottom - top}px`);
        }
        for (const box of layout.boxes) {
          const element = elements.get(box.key)!;
          element.style.setProperty("--hp-safe-x", `${box.left}px`);
          element.style.setProperty("--hp-safe-y", `${box.top}px`);
          element.style.setProperty("--hp-safe-w", `${box.width}px`);
        }
        height = Math.max(height, layout.height);
      }
      root.style.setProperty("--hp-readable-height", `${Math.ceil(height)}px`);
      root.dataset.heroHeightMode = mode;
      root.dataset.readableReady = "true";
    }
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(root);
    for (const node of root.querySelectorAll<HTMLElement>("[data-hero-element]")) resize?.observe(node);
    const shell = root.closest(".storefront-app");
    for (const node of shell?.querySelectorAll<HTMLElement>("header, [data-announcement-bar], [data-homepage-bottom-chrome]") ?? []) {
      resize?.observe(node);
    }
    // Canvas drag previews update a sibling stylesheet, not the saved document.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root.closest("[data-hero-canvas]") ?? root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("load", schedule, true);
    root.addEventListener("loadedmetadata", schedule, true);
    win.addEventListener("resize", schedule);
    win.visualViewport?.addEventListener("resize", schedule);
    void root.ownerDocument.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      win.cancelAnimationFrame(pending);
      resize?.disconnect();
      mutations.disconnect();
      for (const image of posterImages) image.onload = null;
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("loadedmetadata", schedule, true);
      win.removeEventListener("resize", schedule);
      win.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [rootRef, payload, previewDevice, previewViewportHeight]);
}
