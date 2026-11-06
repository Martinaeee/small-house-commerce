"use client";

import { flushAnalytics, trackFirstParty } from "./analytics";

/**
 * First-party funnel events for the checkout submit controls.
 *
 * The funnel report answers "why did a shopper who reached checkout not
 * order": an attempt says the browser let a submit through, a failure says
 * why it did not become an order. Failures carry the shopper's snapshot
 * (name, phone, address, note, idempotency key) because the operator needs
 * to see exactly what was rejected — that data already lives in the order
 * and draft tables, and only the session-timeline endpoint ever returns it.
 *
 * Nothing here may throw: analytics must never break a purchase.
 */

export type FailureReason = "VALIDATION" | "STOCK" | "NETWORK" | "SERVER" | "UNKNOWN";
export type SubmitStep = "form" | "confirm";

export interface CheckoutItemSnapshot {
  skuId: string;
  quantity: number;
  variantName?: string | null;
}

export interface CustomerSnapshot {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay?: string | null;
  postalCode?: string | null;
  streetAddress: string;
  landmark?: string | null;
  note?: string | null;
}

const ATTEMPT_KEY = "luwag_checkout_attempt";
const METADATA_CAP = 4096;
const MESSAGE_CAP = 200;

interface AttemptRecord {
  id: string;
  scope: string;
  retry: number;
}

function defaultScope(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

function readAttempt(): AttemptRecord | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AttemptRecord>;
    if (typeof parsed.id !== "string" || typeof parsed.scope !== "string") return null;
    return { id: parsed.id, scope: parsed.scope, retry: Number(parsed.retry ?? 0) };
  } catch {
    return null;
  }
}

function writeAttempt(record: AttemptRecord): void {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(record));
  } catch {
    /* private mode: the attempt simply does not persist */
  }
}

/**
 * One attempt id per checkout flow. A different checkout URL starts a new
 * attempt (and a new retry count); a refresh on the same flow keeps both,
 * so a reload followed by a submit is still the same shopper.
 */
export function checkoutAttemptId(scope: string = defaultScope()): string {
  const stored = readAttempt();
  if (stored && stored.scope === scope) return stored.id;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  writeAttempt({ id, scope, retry: 0 });
  return id;
}

/** Counts submits inside one attempt; a new scope resets it to 0. */
function nextRetry(scope: string): number {
  const stored = readAttempt();
  const retry = stored && stored.scope === scope ? stored.retry + 1 : 1;
  writeAttempt({ id: stored && stored.scope === scope ? stored.id : checkoutAttemptId(scope), scope, retry });
  return retry;
}

/**
 * A stock rejection is a stock rejection whatever its message says; a thrown
 * transport error is a network fault even though the page shows a generic
 * "please try again".
 */
export function checkoutFailureReason(error: unknown): FailureReason {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    const code = String((error as { code?: unknown }).code ?? "");
    if (["INSUFFICIENT_STOCK", "SKU_UNAVAILABLE", "SKU_NOT_PRICED"].includes(code)) return "STOCK";
    if (status >= 500) return "SERVER";
    if (status === 400) return "VALIDATION";
    return "UNKNOWN";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "NETWORK";
  if (error instanceof TypeError) return "NETWORK";
  return "UNKNOWN";
}

const PHONE_SHAPE = /(?:\+?\d[\d\s-]{7,}\d)/g;
const EMAIL_SHAPE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

function scrub(message: string): string {
  return message.replace(PHONE_SHAPE, "***").replace(EMAIL_SHAPE, "***").slice(0, MESSAGE_CAP);
}

function trim(value: string | null | undefined, cap: number): string | null {
  if (!value) return null;
  return value.length > cap ? value.slice(0, cap) : value;
}

function basePayload(step: SubmitStep, items: readonly CheckoutItemSnapshot[]) {
  const scope = defaultScope();
  return {
    entityId: items.map((item) => item.skuId).join(",").slice(0, 120) || null,
    metadata: {
      step,
      attemptId: checkoutAttemptId(scope),
      retry: nextRetry(scope),
      skuIds: items.map((item) => item.skuId),
      quantities: items.map((item) => item.quantity),
    } satisfies Record<string, unknown>,
  };
}

export function recordSubmitAttempt(input: { step: SubmitStep; items: readonly CheckoutItemSnapshot[] }): void {
  try {
    trackFirstParty("CHECKOUT_SUBMIT_ATTEMPT", basePayload(input.step, input.items));
    flushAnalytics();
  } catch {
    /* analytics never breaks checkout */
  }
}

export function recordSubmitFailure(input: {
  step: SubmitStep;
  reason: FailureReason;
  error: unknown;
  items: readonly CheckoutItemSnapshot[];
  customer: CustomerSnapshot;
  idempotencyKey: string;
  /** First invalid checkout field for form-step validation failures. */
  field?: string;
}): void {
  try {
    const payload = basePayload(input.step, input.items);
    const status = input.error && typeof input.error === "object" && "status" in input.error
      ? Number((input.error as { status: unknown }).status)
      : null;
    const metadata: Record<string, unknown> = {
      ...payload.metadata,
      reason: input.reason,
      field: input.field ?? null,
      httpStatus: Number.isFinite(status) ? status : null,
      message: scrub(input.error instanceof Error ? input.error.message : ""),
      variantNames: input.items.map((item) => item.variantName ?? null),
      idempotencyKey: input.idempotencyKey,
      customer: {
        name: trim(input.customer.name, 120),
        phone: trim(input.customer.phone, 32),
        province: trim(input.customer.province, 120),
        city: trim(input.customer.city, 120),
        barangay: trim(input.customer.barangay ?? null, 120),
        postalCode: trim(input.customer.postalCode ?? null, 16),
        streetAddress: trim(input.customer.streetAddress, 300),
        landmark: trim(input.customer.landmark ?? null, 300),
        note: trim(input.customer.note ?? null, 200),
      },
    };
    // The server drops metadata wholesale above 4096 bytes, so shrink the
    // longest free-text fields first — a recorded failure beats a perfect one.
    for (let guard = 0; guard < 6 && JSON.stringify(metadata).length > METADATA_CAP; guard += 1) {
      const customer = metadata.customer as Record<string, string | null>;
      if (customer.note) customer.note = null;
      else if (customer.landmark) customer.landmark = null;
      else if (customer.streetAddress && customer.streetAddress.length > 150) {
        customer.streetAddress = customer.streetAddress.slice(0, 150);
      } else if (metadata.message) metadata.message = String(metadata.message).slice(0, 80);
      else break;
    }
    trackFirstParty("CHECKOUT_SUBMIT_FAILED", { ...payload, metadata });
    flushAnalytics();
  } catch {
    /* analytics never breaks checkout */
  }
}
