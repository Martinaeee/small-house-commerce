"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminPaymentMethodId,
  type AdminPaymentMethodsSettings,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

const METHOD_LABEL_KEYS: Record<AdminPaymentMethodId, TKey> = {
  COD: "payment_settings_method_cod",
  CARD: "payment_settings_method_card",
  GCASH: "payment_settings_method_gcash",
  BPI: "payment_settings_method_bpi",
};

const METHOD_HINT_KEYS: Record<AdminPaymentMethodId, TKey> = {
  COD: "payment_settings_hint_cod",
  CARD: "payment_settings_hint_card",
  GCASH: "payment_settings_hint_gcash",
  BPI: "payment_settings_hint_bpi",
};

type Draft = Partial<Record<AdminPaymentMethodId, boolean>>;

/**
 * The per-method payment switches (design 2026-11-20 §5). Turning a method
 * off stops new payments of that kind on the storefront; existing payments
 * are untouched. The store can never be left without a way to pay.
 */
export function PaymentMethodsSettings() {
  const { t } = useAdminI18n();
  const [state, setState] = useState<AdminPaymentMethodsSettings | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    void (async () => {
      // The await keeps setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; the codebase's convention).
      await Promise.resolve();
      if (!alive) return;
      setLoading(true);
      try {
        const next = await adminApi.getPaymentMethodSettings();
        if (!alive) return;
        setState(next);
        setDraft({});
        setError(null);
      } catch {
        if (!alive) return;
        setError(t("payment_settings_load_failed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  if (loading) {
    return <p className="text-sm text-ink-muted">{t("payment_settings_loading")}</p>;
  }
  if (!state) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-sale">
          {error ?? t("payment_settings_load_failed")}
        </p>
        <Button variant="secondary" onClick={load}>
          {t("payment_settings_retry")}
        </Button>
      </div>
    );
  }

  const enabledOf = (id: AdminPaymentMethodId): boolean =>
    draft[id] ?? state.methods.find((method) => method.id === id)?.enabled ?? false;
  const anyEnabled = state.methods.some((method) => enabledOf(method.id));
  const changed = state.methods.some(
    (method) => enabledOf(method.id) !== method.enabled,
  );

  async function save(): Promise<void> {
    if (!state) return;
    if (!anyEnabled) {
      setError(t("payment_settings_keep_one"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await adminApi.updatePaymentMethodSettings({
        revision: state.revision,
        methods: state.methods.map((method) => ({
          id: method.id,
          enabled: enabledOf(method.id),
        })),
      });
      setState(next);
      setDraft({});
      setSavedAt(new Date().toLocaleTimeString());
    } catch (thrown) {
      setError(
        errorStatus(thrown) === 409
          ? t("payment_settings_conflict")
          : t("payment_settings_save_failed"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[720px] space-y-4">
      <p className="text-sm text-ink-secondary">{t("payment_settings_intro")}</p>
      <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-ink-secondary">
        {t("payment_settings_existing_note")}
      </p>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {state.methods.map((method) => {
          const on = enabledOf(method.id);
          const inputId = `payment-setting-${method.id.toLowerCase()}`;
          return (
            <div
              key={method.id}
              className="flex items-start justify-between gap-4 p-4"
            >
              <label htmlFor={inputId} className="flex cursor-pointer flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">
                  {t(METHOD_LABEL_KEYS[method.id])}
                </span>
                <span className="text-xs text-ink-secondary">
                  {method.ready
                    ? t(METHOD_HINT_KEYS[method.id])
                    : t("payment_settings_not_ready")}
                </span>
              </label>
              <input
                id={inputId}
                type="checkbox"
                role="switch"
                data-testid={inputId}
                className="mt-0.5 h-5 w-5 accent-[var(--color-cta)]"
                checked={on}
                disabled={!method.ready || saving}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    [method.id]: event.target.checked,
                  }))
                }
              />
            </div>
          );
        })}
      </div>

      {!anyEnabled ? (
        <p data-testid="payment-settings-keep-one" className="text-sm text-sale">
          {t("payment_settings_keep_one")}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" data-testid="payment-settings-error" className="text-sm text-sale">
          {error}
        </p>
      ) : null}
      {savedAt !== null ? (
        <p role="status" data-testid="payment-settings-saved" className="text-sm text-admin-success">
          {t("payment_settings_saved")} {savedAt}
        </p>
      ) : null}

      <Button
        onClick={() => void save()}
        disabled={!changed || !anyEnabled || saving}
        data-testid="payment-settings-save"
      >
        {saving ? t("payment_settings_saving") : t("payment_settings_save")}
      </Button>
    </div>
  );
}
