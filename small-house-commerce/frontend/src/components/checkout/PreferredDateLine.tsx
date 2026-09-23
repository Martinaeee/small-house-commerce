"use client";

import { useEffect, useState } from "react";

/**
 * Success-page preferred-date line (spec §3.5). The success page is a server
 * component keyed only on the order-number URL segment and never refetches the
 * order, so the picked date is carried over from the confirm step via
 * sessionStorage — the same fault-tolerant pattern as the tab-scoped
 * purchase payload. Renders
 * nothing when no date was chosen or storage is unavailable (spec §5.3).
 *
 * The sessionStorage read happens in a deferred effect, never during render:
 * SSR and the first client render both produce null, so there is no hydration
 * mismatch on a hard refresh with a stashed date (§5.2 scenario 5).
 */
export function PreferredDateLine() {
  const [preferredDate, setPreferredDate] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      // sessionStorage is browser-only; the await also keeps the setState out
      // of the effect's synchronous body (react-hooks/set-state-in-effect;
      // same convention as CheckoutConfirmView/AuthProvider/CartContext).
      await Promise.resolve();
      if (!alive) return;
      try {
        const raw = sessionStorage.getItem("lastPreferredDate") ?? "";
        // 仅接受合法 yyyy-MM-dd，防手改存储触发 Intl 抛错
        setPreferredDate(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "");
      } catch {
        setPreferredDate("");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
    <p className="mt-3 text-sm text-ink-secondary" data-testid="success-preferred-date">
      {`Preferred delivery date: ${formatted}`}
    </p>
  );
}
