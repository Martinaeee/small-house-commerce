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
  const retryRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const sendRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    revisionRef.current = readAutosaveRevision(attempt);
    lastQueuedRef.current = "";
    bodyRef.current = "";
    stoppedRef.current = false;
    inFlightRef.current = false;
    backoffRef.current = 0;
    return () => {
      generationRef.current += 1;
      stoppedRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (retryRef.current) window.clearTimeout(retryRef.current);
      timerRef.current = retryRef.current = null;
    };
  }, [attempt]);

  const send = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current || retryRef.current) return;
    const sentBody = bodyRef.current;
    if (!sentBody) return;
    const generation = generationRef.current;
    let succeeded = false;
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [CHECKOUT_DRAFT_HEADER]: attempt.token,
        },
        body: sentBody,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (generation !== generationRef.current) return;
      if (res.status === 410) {
        stoppedRef.current = true;
        setStatus("expired");
        return;
      }
      if (res.status === 409) {
        const conflict = await res.json().catch(() => ({})) as { currentRevision?: number };
        if (Number.isInteger(conflict.currentRevision)) {
          revisionRef.current = Math.max(revisionRef.current, conflict.currentRevision!);
        }
        // Do not overwrite the winning tab automatically or claim this one
        // was saved. A subsequent shopper edit starts above the known version.
        setStatus("conflict");
        return;
      }
      if (res.status === 429) {
        const retrySeconds = Number(res.headers.get("Retry-After"));
        const delay = Math.max(15_000, Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0);
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          sendRef.current();
        }, delay);
        setStatus("offline");
        return;
      }
      if (res.status >= 400 && res.status < 500) {
        stoppedRef.current = true;
        setStatus("unavailable");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string };
      if (generation !== generationRef.current) return;
      if (body.status === "CONVERTED") {
        stoppedRef.current = true;
        setStatus("converted");
        return;
      }
      backoffRef.current = 0;
      succeeded = true;
      if (sentBody === bodyRef.current) setStatus("saved");
    } catch {
      if (stoppedRef.current || generation !== generationRef.current) return;
      setStatus("offline");
      const delay = BACKOFF_MS[Math.min(backoffRef.current++, BACKOFF_MS.length - 1)];
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        sendRef.current();
      }, delay);
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false;
        // A newer change whose debounce fired during the request is still
        // pending. Drain it instead of waiting for another keystroke.
        if (succeeded && sentBody !== bodyRef.current && timerRef.current === null) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            sendRef.current();
          }, 0);
        }
      }
    }
  }, [attempt]);

  useEffect(() => {
    sendRef.current = () => void send();
  }, [send]);

  const serialized = JSON.stringify({ hasUserInput, ...snapshot });
  useEffect(() => {
    if (!active || serialized === lastQueuedRef.current) return;
    lastQueuedRef.current = serialized;
    revisionRef.current = Math.max(revisionRef.current, readAutosaveRevision(attempt)) + 1;
    writeAutosave(attempt, revisionRef.current, snapshotRef.current);
    bodyRef.current = JSON.stringify({ revision: revisionRef.current, ...JSON.parse(serialized) });
    if (stoppedRef.current) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void send();
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [active, attempt, serialized, send]);

  useEffect(() => {
    if (!active) return;
    const flush = () => {
      if (stoppedRef.current || bodyRef.current === "") return;
      void fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json", [CHECKOUT_DRAFT_HEADER]: attempt.token },
        body: bodyRef.current,
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [active, attempt]);

  const flush = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    void send();
  }, [send]);

  return { status, flush };
}
