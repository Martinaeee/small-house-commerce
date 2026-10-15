"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordMarketingTouch } from "@/lib/tracking";

export function MarketingTouchObserver() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([path, search]);
    if (last.current === key) return;
    last.current = key;
    if (path.startsWith("/lp/")) return;
    void recordMarketingTouch({ path, search });
  }, [path, search]);
  return null;
}
