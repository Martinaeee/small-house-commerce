/**
 * The card payment session, held in memory only.
 *
 * The session is a short-lived capability for one checkout: it must never
 * reach sessionStorage, localStorage, a cookie or the URL, and it dies with
 * the tab. The checkout page hands it to the payment return page, which is a
 * separate client navigation in the same JS context — the same pattern the
 * checkout draft uses for the fields that survive that step.
 */
export interface PaymentSession {
  paySession: string;
  /** The gateway environment the session belongs to; never guessed. */
  env: "test" | "production";
  orderNumber: string;
}

let session: PaymentSession | null = null;

export function storePaymentSession(value: PaymentSession): void {
  session = value;
}

export function readPaymentSession(): PaymentSession | null {
  return session;
}

export function clearPaymentSession(): void {
  session = null;
}
