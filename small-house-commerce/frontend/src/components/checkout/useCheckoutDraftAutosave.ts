"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHECKOUT_DRAFT_HEADER,
  readAutosaveRevision,
  writeAutosave,
  type CheckoutAttempt,
  type CheckoutAutosaveSnapshot,
  type CheckoutAutosaveStatus,
} from "@/lib/checkoutAutosave";

const DEBOUNCE_MS = 600;
const BACKOFF_MS = [2_000, 5_000, 15_000];
const ENDPOINT = "/api/v1/storefront/checkout-drafts/current";

export function useCheckoutDraftAutosave({
  attempt,
  snapshot,
  active,
  hasUserInput,
}: {
  attempt: CheckoutAttempt;
  snapshot: CheckoutAutosaveSnapshot;
  active: boolean;
  hasUserInput: boolean;
}): { status: CheckoutAutosaveStatus; flush: () => void } {
  const [status, setStatus] = useState<CheckoutAutosaveStatus>("idle");
  const revisionRef = useRef(0);
  const lastQueuedRef = useRef("");
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  const backoffRef = useRef(0);
  const bodyRef = useRef("");
  const snapshotRef = useRef(snapshot);
  const timerRef = useRef<number | null>(null);
  // Late retries go through a ref: the retry timer must not close over a
  // binding declared after it.
  const sendRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    revisionRef.current = readAutosaveRevision(attempt);
  }, [attempt]);

  const send = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current) return;
    if (bodyRef.current === "") return;
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [CHECKOUT_DRAFT_HEADER]: attempt.token,
        },
        body: bodyRef.current,
        cache: "no-store",
      });
      if (res.status === 410) {
        stoppedRef.current = true;
        setStatus("expired");
        return;
      }
      // A newer client revision already won (another tab or a retry).
      if (res.status === 409) {
        setStatus("saved");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string };
      if (body.status === "CONVERTED") {
        stoppedRef.current = true;
        setStatus("converted");
        return;
      }
      backoffRef.current = 0;
      setStatus("saved");
    } catch {
      if (stoppedRef.current) return;
      setStatus("offline");
      const delay = BACKOFF_MS[Math.min(backoffRef.current, BACKOFF_MS.length - 1)];
      backoffRef.current += 1;
      window.setTimeout(() => {
        if (!stoppedRef.current) sendRef.current();
      }, delay);
    } finally {
      inFlightRef.current = false;
    }
  }, [attempt]);

  useEffect(() => {
    sendRef.current = () => void send();
  }, [send]);

  // Serialize during render so the debounce effect can key on the VALUES: a
  // re-render carrying an identical snapshot (a restore landing mid-debounce,
  // an unrelated state change) must not tear down the pending timer and leave
  // the change unsent.
  const serialized = JSON.stringify({
    hasUserInput,
    customer: snapshot.customer,
    items: snapshot.items,
    preferredDeliveryDate: snapshot.preferredDeliveryDate,
    promoCodeInput: snapshot.promoCodeInput,
    promoCodeApplied: snapshot.promoCodeApplied,
    customerNote: snapshot.customerNote,
  });

  useEffect(() => {
    if (!active || stoppedRef.current) return;
    if (serialized === lastQueuedRef.current) return;
    lastQueuedRef.current = serialized;
    revisionRef.current += 1;
    writeAutosave(attempt, revisionRef.current, snapshotRef.current);
    bodyRef.current = JSON.stringify({
      revision: revisionRef.current,
      ...JSON.parse(serialized),
    });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void send();
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [active, attempt, serialized, send]);

  useEffect(() => {
    if (!active) return;
    const flush = () => {
      if (stoppedRef.current || bodyRef.current === "" || inFlightRef.current) return;
      void fetch(ENDPOINT, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [CHECKOUT_DRAFT_HEADER]: attempt.token,
        },
        body: bodyRef.current,
        keepalive: true,
      }).catch(() => undefined);
      writeAutosave(attempt, revisionRef.current, snapshotRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [active, attempt]);

  const flush = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void send();
  }, [send]);

  return { status, flush };
}
