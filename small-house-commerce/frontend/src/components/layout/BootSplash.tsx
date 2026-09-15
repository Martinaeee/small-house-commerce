"use client";

import { useEffect, useState } from "react";
import { BrandWordmark } from "./BrandWordmark";

/**
 * Branded hard-load splash (COSTWAY-style centered lockup on brand cream).
 *
 * Visibility is entirely controlled by the static inline CSS emitted by the
 * root layout (`#boot-splash` rules): the overlay fades in only after
 * a 220ms delay, so a normal fast load never shows it, and the pre-hydration
 * inline script fades it out when parsing finishes / at load / 3s safety.
 *
 * This client component exists only to let React own the node and unmount it
 * safely once hydrated — it never synchronously setState()s outside an
 * effect and the effect's removal is idempotent with the inline script.
 */
export function BootSplash() {
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    // Hydration means the app is interactive; make sure the flag is set even
    // if the inline script somehow did not run.
    document.documentElement.setAttribute("data-splash-done", "");
    const timer = window.setTimeout(() => setAlive(false), 600);
    return () => window.clearTimeout(timer);
  }, []);

  if (!alive) return null;

  return (
    <div
      id="boot-splash"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#faf8f5",
      }}
    >
      <span
        className="boot-splash-bar"
        style={{ position: "absolute", top: 0, left: 0, height: 2, width: "40%" }}
        aria-hidden
      />
      <span className="boot-splash-pulse inline-flex">
        <BrandWordmark className="text-4xl" />
      </span>
    </div>
  );
}
