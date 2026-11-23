const SUBMISSION_PREFIX = "luwag_checkout_submission:";

/**
 * How long an unresolved submission stays recoverable. Long enough to cover a
 * reload after a lost response; short enough that a much later visit to the
 * same checkout does not silently replay yesterday's attempt.
 */
export const CHECKOUT_SUBMISSION_TTL_MS = 30 * 60 * 1000;

/**
 * F04 budgets. The order request is the only request whose outcome can create
 * an order, so it gets its own response budget: after 15s the page stops
 * saying "placing" and starts confirming; the whole attempt gets 30s before
 * the page offers an explicit retry. A timeout never becomes "order failed".
 */
export const PLACE_ORDER_RESPONSE_BUDGET_MS = 15 * 1000;
export const PLACE_ORDER_RECOVERY_WINDOW_MS = 30 * 1000;
export const ATTEMPT_POLL_INTERVAL_MS = 2 * 1000;

export interface CheckoutSubmission<P = unknown> {
  scope: string;
  /** Idempotency key the one request for this attempt must use. */
  idempotencyKey: string;
  /** Submit-time ads consent; part of the immutable attempt. */
  metaConsent: boolean;
  /** Checkout analytics attempt id, carried for reconciliation. */
  attemptId: string | null;
  startedAt: number;
  /** The exact request body sent the first time. Replays reuse it verbatim. */
  payload: P;
  status: "SUBMITTED" | "ORDERED";
  orderNumber?: string;
}

// Storage may be denied (private mode, quota). The current mount still needs
// to see the attempt it just created, so keep one tab-local copy in memory.
let memory: CheckoutSubmission | null = null;

function storageKey(scope: string): string {
  return `${SUBMISSION_PREFIX}${scope}`;
}

function parse(stored: string | null, now: number | null): CheckoutSubmission | null {
  if (stored === null) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<CheckoutSubmission>;
    if (
      typeof parsed.scope !== "string" ||
      typeof parsed.idempotencyKey !== "string" ||
      typeof parsed.metaConsent !== "boolean" ||
      typeof parsed.startedAt !== "number" ||
      (parsed.status !== "SUBMITTED" && parsed.status !== "ORDERED") ||
      typeof parsed.payload !== "object" ||
      parsed.payload === null ||
      (now !== null && now - parsed.startedAt > CHECKOUT_SUBMISSION_TTL_MS)
    ) {
      return null;
    }
    return parsed as CheckoutSubmission;
  } catch {
    return null;
  }
}

/**
 * Start (or resume) the one submission for this checkout scope. An existing,
 * unexpired attempt wins: its key and payload are the promise that a replay
 * returns the original order, so a retry, a reload or a second click can
 * never replace them with freshly built ones.
 */
export function beginCheckoutSubmission<P>(
  input: Omit<CheckoutSubmission<P>, "status" | "orderNumber">,
  now: number = Date.now(),
): CheckoutSubmission<P> {
  const existing = readCheckoutSubmission<P>(input.scope, now);
  if (existing && existing.status === "SUBMITTED") return existing;
  if (existing && existing.status === "ORDERED") return existing;
  const submission: CheckoutSubmission<P> = { ...input, status: "SUBMITTED" };
  memory = submission as CheckoutSubmission;
  try {
    window.sessionStorage.setItem(storageKey(input.scope), JSON.stringify(submission));
  } catch {
    // Memory above still covers this mount; recovery after a reload is lost.
  }
  return submission;
}

export function readCheckoutSubmission<P = unknown>(
  scope: string,
  now: number = Date.now(),
): CheckoutSubmission<P> | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey(scope));
    // Storage is readable and empty: the attempt is gone (or was never
    // written). Drop any stale module copy so a cleared session cannot
    // resurrect an old payload.
    if (stored === null) {
      if (memory?.scope === scope) memory = null;
      return null;
    }
    return parse(stored, now) as CheckoutSubmission<P> | null;
  } catch {
    // Storage denied (private mode / quota): the in-memory copy keeps this
    // mount working; recovery after a reload is lost.
    if (memory && memory.scope === scope) {
      return parse(JSON.stringify(memory), now) as CheckoutSubmission<P> | null;
    }
    return null;
  }
}

/**
 * Unresolved attempt in this scope, ignoring the TTL. Used only to attach the
 * confirmed order number: the order is real whether or not the attempt window
 * has lapsed, and dropping the number would strand a refresh.
 */
function readSubmissionForUpdate(scope: string): CheckoutSubmission | null {
  try {
    return parse(window.sessionStorage.getItem(storageKey(scope)), null);
  } catch {
    if (memory && memory.scope === scope) {
      return parse(JSON.stringify(memory), null);
    }
    return null;
  }
}

/** The server confirmed the order; keep the number for a reload redirect. */
export function markCheckoutSubmissionOrdered(
  scope: string,
  orderNumber: string,
): void {
  const existing = readSubmissionForUpdate(scope);
  if (!existing) return;
  const updated: CheckoutSubmission = {
    ...existing,
    status: "ORDERED",
    orderNumber,
  };
  memory = updated;
  try {
    window.sessionStorage.setItem(storageKey(scope), JSON.stringify(updated));
  } catch {
    // Memory copy still lets this mount redirect.
  }
}

export function clearCheckoutSubmission(scope: string): void {
  if (memory?.scope === scope) memory = null;
  try {
    window.sessionStorage.removeItem(storageKey(scope));
  } catch {
    // Storage denied; nothing persisted to clear.
  }
}
