"use client";

import { useState } from "react";

/**
 * Success-page preferred-date line (spec §3.5). The success page is a server
 * component keyed only on the order-number URL segment and never refetches the
 * order, so the picked date is carried over from the confirm step via
 * sessionStorage — the same fault-tolerant pattern as lastOrderTotal. Renders
 * nothing when no date was chosen or storage is unavailable (spec §5.3).
 */
export function PreferredDateLine() {
  // Lazy initializer keeps the storage read out of the effect body
  // (react-hooks/set-state-in-effect) and is StrictMode-safe.
  const [preferredDate] = useState(() => {
    try {
      return sessionStorage.getItem("lastPreferredDate") ?? "";
    } catch {
      return "";
    }
  });

  if (!preferredDate) return null;

  // UTC-midnight convention (spec §3.2, ruling D-1): formatting in Asia/Manila
  // renders the same calendar day the buyer picked.
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${preferredDate}T00:00:00Z`));

  return (
    <p className="text-sm text-ink-secondary" data-testid="success-preferred-date">
      {`Preferred delivery date: ${formatted}`}
    </p>
  );
}
