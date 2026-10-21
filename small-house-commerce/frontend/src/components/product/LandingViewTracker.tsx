"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordMarketingTouch } from "@/lib/tracking";

export function LandingViewTracker({ landingPageId, slug }: { landingPageId: string; slug: string }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (path.replace(/\/$/, "") !== `/lp/${encodeURIComponent(slug)}`) return;
    const key = JSON.stringify([landingPageId, path, search]);
    if (last.current === key) return;
    last.current = key;
    void recordMarketingTouch({ path, search, landingPageId });
  }, [landingPageId, slug, path, search]);
  return null;
}
