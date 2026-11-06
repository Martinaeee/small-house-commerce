"use client";

import { flushAnalytics, trackFirstParty } from "./analytics";

export type FailureReason =
  "VALIDATION" | "STOCK" | "NETWORK" | "SERVER" | "UNKNOWN";
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
export interface SubmitOccurrence {
  attemptId: string;
  retry: number;
}
const ATTEMPT_KEY = "luwag_checkout_attempt";
let memory: { id: string; scope: string; retry: number } | null = null;

function defaultScope(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname.replace(/^\/checkout\/confirm$/, "/checkout")}${window.location.search}`;
}
function readAttempt(): typeof memory {
  try {
    const value = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? "null");
    if (
      value &&
      typeof value.id === "string" &&
      typeof value.scope === "string" &&
      Number.isSafeInteger(value.retry)
    )
      return value;
    return null;
  } catch {
    return memory;
  }
}
function writeAttempt(record: NonNullable<typeof memory>): void {
  memory = record;
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable */
  }
}
export function checkoutAttemptId(scope = defaultScope()): string {
  const stored = readAttempt();
  if (stored?.scope === scope) return stored.id;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeAttempt({ id, scope, retry: 0 });
  return id;
}
export function clearSubmitAttempt(): void {
  memory = null;
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* storage unavailable */
  }
}
function nextOccurrence(scope = defaultScope()): SubmitOccurrence {
  const attemptId = checkoutAttemptId(scope);
  const retry = (readAttempt()?.retry ?? 0) + 1;
  writeAttempt({ id: attemptId, scope, retry });
  return { attemptId, retry };
}
export function checkoutFailureReason(error: unknown): FailureReason {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const code = "code" in error ? error.code : null;
    if (
      ["INSUFFICIENT_STOCK", "SKU_UNAVAILABLE", "SKU_NOT_PRICED"].includes(
        String(code),
      )
    )
      return "STOCK";
    if (status >= 500) return "SERVER";
    if (status === 400 || status === 422) return "VALIDATION";
    return "UNKNOWN";
  }
  if (
    error instanceof DOMException &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return "NETWORK";
  if (error instanceof TypeError) return "NETWORK";
  return "UNKNOWN";
}
function scrub(message: string): string {
  return message
    .replace(/(?:\+?\d[\d\s-]{7,}\d)/g, "***")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***")
    .slice(0, 200);
}
function payload(
  step: SubmitStep,
  items: readonly CheckoutItemSnapshot[],
  occurrence: SubmitOccurrence,
) {
  return {
    entityId:
      items
        .map((i) => i.skuId)
        .join(",")
        .slice(0, 120) || null,
    metadata: {
      step,
      ...occurrence,
      skuIds: items.map((i) => i.skuId),
      quantities: items.map((i) => i.quantity),
    },
  };
}
/** One click, one occurrence; a following failure reuses this exact pair. */
export function recordSubmitAttempt(input: {
  step: SubmitStep;
  items: readonly CheckoutItemSnapshot[];
  scope?: string;
}): SubmitOccurrence | undefined {
  try {
    const occurrence = nextOccurrence(input.scope);
    trackFirstParty(
      "CHECKOUT_SUBMIT_ATTEMPT",
      payload(input.step, input.items, occurrence),
    );
    flushAnalytics();
    return occurrence;
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
  field?: string;
  occurrence?: SubmitOccurrence;
}): void {
  try {
    const base = payload(
      input.step,
      input.items,
      input.occurrence ?? nextOccurrence(),
    );
    const status =
      input.error && typeof input.error === "object" && "status" in input.error
        ? Number(input.error.status)
        : null;
    const customerKeys = [
      "name",
      "phone",
      "province",
      "city",
      "barangay",
      "postalCode",
      "streetAddress",
      "landmark",
      "note",
    ] as const;
    const customer = Object.fromEntries(
      customerKeys.map((key) => {
        const value = input.customer[key];
        return [
          key,
          typeof value === "string"
            ? value.slice(0, key === "note" ? 200 : key === "phone" ? 32 : 300)
            : null,
        ];
      }),
    );
    const metadata: Record<string, unknown> = {
      ...base.metadata,
      reason: input.reason,
      field: input.field ?? null,
      httpStatus: Number.isFinite(status) ? status : null,
      message: scrub(input.error instanceof Error ? input.error.message : ""),
      variantNames: input.items.map((i) => i.variantName?.slice(0, 80) ?? null),
      customer,
      idempotencyKey: input.idempotencyKey,
    };
    // Keep IDs and the full retry key. Bounded text, never an unbounded loop.
    // Server accepts up to 16 KiB for failure snapshots; aim for 4 KiB here.
    const bytes = () =>
      new TextEncoder().encode(JSON.stringify(metadata)).length;
    if (bytes() > 4096)
      metadata.variantNames = input.items.map(
        (i) => i.variantName?.slice(0, 16) ?? null,
      );
    if (bytes() > 4096) metadata.variantNames = [];
    trackFirstParty("CHECKOUT_SUBMIT_FAILED", { ...base, metadata });
    flushAnalytics();
  } catch {
    /* analytics never breaks checkout */
  }
}
