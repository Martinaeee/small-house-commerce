"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { installAnalyticsFlushHooks, trackFirstParty } from "@/lib/analytics";

/**
 * One `page_view` per storefront route.
 *
 * Mounted once in the storefront layout so every page (not just the
 * homepage) is counted; the dashboard's conversion rate divides ordering
 * sessions by all sessions, which needs the denominator.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    installAnalyticsFlushHooks();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackFirstParty("PAGE_VIEW", { entityId: pathname });
  }, [pathname]);

  return null;
}
