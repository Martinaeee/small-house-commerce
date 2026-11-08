"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./StorefrontHeaderChrome.module.css";

export function StorefrontHeaderChrome({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const header = root?.querySelector("header");
    if (!root || !header) return;
    const measure = () => {
      const height = Math.max(0, header.getBoundingClientRect().top - root.getBoundingClientRect().top);
      root.style.setProperty("--announcement-height", `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <div ref={ref} className={`${styles.chrome} sticky top-0 z-40`}>{children}</div>;
}
