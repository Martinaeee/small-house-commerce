"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type PaymentMethodId, type PaymentMethodOption } from "@/lib/api";

export interface PaymentMethodSelectorProps {
  /** The methods the server currently offers, in its order. */
  methods: PaymentMethodOption[];
  value: PaymentMethodId;
  onChange: (method: PaymentMethodId) => void;
  disabled?: boolean;
}

const LABELS: Record<PaymentMethodId, string> = {
  COD: "Cash on Delivery",
  CARD: "Credit or Debit Card",
  GCASH: "GCash",
  BPI: "BPI Bank Transfer",
};

const HINTS: Record<PaymentMethodId, string> = {
  COD: "Pay when your order arrives.",
  CARD: "Pay online with your card.",
  GCASH: "Pay online with your GCash wallet.",
  BPI: "Pay online through BPI Bank Transfer.",
};

/**
 * The payment choices. Only the methods the server offers are shown, so a
 * method that was switched off is gone before the shopper can pick it.
 */
export function PaymentMethodSelector({
  methods,
  value,
  onChange,
  disabled = false,
}: PaymentMethodSelectorProps) {
  const offered = methods.filter((method) => method.enabled);
  return (
    <fieldset
      data-testid="payment-method-selector"
      disabled={disabled}
      className="rounded-lg border border-border bg-card p-5"
    >
      <legend className="text-sm font-medium text-ink">Payment method</legend>
      <div className="mt-3 flex flex-col gap-3">
        {offered.map((method) => (
          <label
            key={method.id}
            className="flex cursor-pointer items-start gap-3 text-sm text-ink"
          >
            <input
              type="radio"
              name="payment-method"
              className="mt-0.5 h-4 w-4 accent-[var(--color-cta)]"
              data-testid={`payment-method-${method.id.toLowerCase()}`}
              value={method.id}
              checked={value === method.id}
              onChange={() => onChange(method.id)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{LABELS[method.id]}</span>
              <span className="text-xs text-ink-secondary">{HINTS[method.id]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface PaymentMethodsState {
  methods: PaymentMethodOption[];
  /** Whether cash on delivery may still be chosen. */
  codEnabled: boolean;
  loading: boolean;
  /** Set when the methods could not be read; the shopper must retry. */
  error: string | null;
  reload: () => void;
}

/**
 * Reads the payment methods the server offers. A failure is reported, never
 * papered over: falling back to "cash only" would quietly contradict what
 * the server accepts.
 */
export function usePaymentMethods(): PaymentMethodsState {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [codEnabled, setCodEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void api
      .getPaymentMethods()
      .then((response) => {
        if (!alive) return;
        setMethods(response.methods);
        setCodEnabled(response.codEnabled);
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        setError("We could not load the payment methods. Check your connection and try again.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { methods, codEnabled, loading, error, reload };
}
