"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import {
  LANDING_VISIT_SESSION_KEY,
  persistLandingPage,
} from "@/lib/tracking";

/**
 * Mounts only on /lp/<slug>. Persists the LP id for checkout attribution
 * (last LP wins) and fires the idempotent session-scoped view beacon.
 * StrictMode double-invocation is guarded by the fired ref and, on the
 * server, by the (landingPageId, visitKey) unique constraint.
 */
export function LandingViewTracker({
  landingPageId,
  slug,
}: {
  landingPageId: string;
  slug: string;
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    persistLandingPage(landingPageId);

    let visitKey = window.sessionStorage.getItem(LANDING_VISIT_SESSION_KEY);
    if (!visitKey) {
      visitKey = crypto.randomUUID();
      window.sessionStorage.setItem(LANDING_VISIT_SESSION_KEY, visitKey);
    }
    void api.recordLandingPageView(slug, visitKey).catch(() => {
      /* best-effort: never block the page on analytics */
    });
  }, [landingPageId, slug]);

  return null;
}
