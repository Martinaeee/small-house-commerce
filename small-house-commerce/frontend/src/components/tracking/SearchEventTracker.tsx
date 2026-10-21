"use client";

import { useEffect, useRef } from "react";
import { trackFirstParty } from "@/lib/analytics";

/**
 * Records the searched term (dashboard §18).
 *
 * The term is stored as the event subject so the operator can see what
 * shoppers are looking for; the analytics table is the only place it lands.
 */
export function SearchEventTracker({ term }: { term: string }) {
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const value = term.trim();
    if (!value || sent.current === value) return;
    sent.current = value;
    trackFirstParty("SEARCH", { entityId: value.slice(0, 120) });
  }, [term]);

  return null;
}
