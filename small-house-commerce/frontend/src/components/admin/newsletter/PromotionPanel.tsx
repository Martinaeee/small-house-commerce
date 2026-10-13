"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/admin/Field";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminNewsletterPromotion,
  type NewsletterDiscountType,
  type NewsletterPromotionInput,
  type NewsletterPromotionUsage,
} from "@/lib/admin-api";

interface PromotionForm {
  code: string;
  discountType: NewsletterDiscountType;
  discountValue: string;
  minSpend: string;
  maxUses: string;
  perCustomerLimit: string;
  validFrom: string;
  validUntil: string;
}

const EMPTY_FORM: PromotionForm = {
  code: "",
  discountType: "PERCENT",
  discountValue: "10",
  minSpend: "0",
  maxUses: "",
  perCustomerLimit: "1",
  validFrom: "",
  validUntil: "",
};

const AVAILABILITY_KEYS: Partial<
  Record<NewsletterPromotionUsage["availability"], TKey>
> = {
  SCHEDULED: "newsletter_offer_status_SCHEDULED",
  EXPIRED: "newsletter_offer_status_EXPIRED",
  EXHAUSTED: "newsletter_offer_status_EXHAUSTED",
};

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formFromPromotion(row: AdminNewsletterPromotion): PromotionForm {
  return {
    code: row.code,
    discountType: row.discountType,
    discountValue: String(Number(row.discountValue)),
    minSpend: String(Number(row.minSpend)),
    maxUses: row.maxUses === null ? "" : String(row.maxUses),
    perCustomerLimit:
      row.perCustomerLimit === null ? "" : String(row.perCustomerLimit),
    validFrom: isoToLocalInput(row.validFrom),
    validUntil: isoToLocalInput(row.validUntil),
  };
}

function positiveIntegerOrNull(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function validatePromotion(form: PromotionForm): {
  input?: NewsletterPromotionInput;
  error?: TKey;
} {
  const code = form.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) {
    return { error: "newsletter_promo_code_invalid" };
  }

  const discountValue = Number(form.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { error: "newsletter_promo_value_invalid" };
  }
  if (form.discountType === "PERCENT" && discountValue > 100) {
    return { error: "newsletter_promo_percent_invalid" };
  }

  const minSpend = Number(form.minSpend);
  if (!Number.isFinite(minSpend) || minSpend < 0) {
    return { error: "newsletter_promo_min_spend_invalid" };
  }

  const maxUses = positiveIntegerOrNull(form.maxUses);
  if (maxUses === undefined) {
    return { error: "newsletter_promo_max_uses_invalid" };
  }
  const perCustomerLimit = positiveIntegerOrNull(form.perCustomerLimit);
  if (perCustomerLimit === undefined) {
    return { error: "newsletter_promo_per_customer_invalid" };
  }

  const validFrom = localInputToIso(form.validFrom);
  const validUntil = localInputToIso(form.validUntil);
  if (form.validFrom && !validFrom) {
    return { error: "newsletter_promo_start_invalid" };
  }
  if (form.validUntil && !validUntil) {
    return { error: "newsletter_promo_end_invalid" };
  }
  if (
    validFrom &&
    validUntil &&
    new Date(validUntil).getTime() <= new Date(validFrom).getTime()
  ) {
    return { error: "newsletter_promo_window_invalid" };
  }

  return {
    input: {
      code,
      discountType: form.discountType,
      discountValue,
      minSpend,
      maxUses,
      perCustomerLimit,
      validFrom,
      validUntil,
    },
  };
}

export function PromotionPanel() {
  const { t } = useAdminI18n();
  const [promotions, setPromotions] = useState<AdminNewsletterPromotion[] | null>(
    null,
  );
  const [usage, setUsage] = useState<Record<string, NewsletterPromotionUsage>>(
    {},
  );
  const [mode, setMode] = useState<"edit" | "new">("edit");
  const [form, setForm] = useState<PromotionForm>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await adminApi.listNewsletterPromotions();
      setPromotions(rows);
      const active = rows.find((row) => row.status === "ACTIVE");
      if (active) setForm(formFromPromotion(active));
      const usages = await Promise.all(
        rows.map(async (row) => {
          try {
            return await adminApi.getNewsletterPromotionUsage(row.id);
          } catch {
            return null;
          }
        }),
      );
      setUsage(
        Object.fromEntries(
          usages
            .filter((row): row is NewsletterPromotionUsage => row !== null)
            .map((row) => [row.promotionId, row]),
        ),
      );
    } catch (cause) {
      setPromotions([]);
      setError(
        cause instanceof Error ? cause.message : t("newsletter_promo_load_failed"),
      );
    }
  }, [t]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const active = promotions?.find((row) => row.status === "ACTIVE") ?? null;
  const history = promotions?.filter((row) => row.status === "ARCHIVED") ?? [];

  function update<K extends keyof PromotionForm>(
    key: K,
    value: PromotionForm[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setSaved(false);
  }

  function beginNewRound(): void {
    setMode("new");
    setForm(EMPTY_FORM);
    setError(null);
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const parsed = validatePromotion(form);
    if (!parsed.input) {
      setError(
        t(parsed.error ?? "newsletter_promo_check_settings"),
      );
      return;
    }

    setPending(true);
    setError(null);
    setSaved(false);
    try {
      if (mode === "new" || !active) {
        await adminApi.createNewsletterPromotion(parsed.input);
      } else {
        await adminApi.updateNewsletterPromotion(active.id, parsed.input);
      }
      setMode("edit");
      setSaved(true);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("newsletter_promo_save_failed"),
      );
    } finally {
      setPending(false);
    }
  }

  if (promotions === null) {
    return (
      <div
        className="h-72 animate-pulse rounded-xl border border-border bg-card"
        aria-label={t("newsletter_promo_loading")}
      />
    );
  }

  const showForm = mode === "new" || active !== null;
  const activeUsage = active ? usage[active.id] : undefined;
  const availabilityKey = activeUsage
    ? AVAILABILITY_KEYS[activeUsage.availability]
    : undefined;

  return (
    <div className="space-y-5">
      {!active ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          {t("newsletter_no_active_offer")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-ink-muted">
              {t("newsletter_current_promotion")}
            </p>
            <p className="mt-1 font-semibold text-ink">{active.code}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-ink-muted">
              {t("newsletter_usage_effective")}
            </p>
            <p className="mt-1 font-semibold text-ink">
              {activeUsage?.effective ?? "—"}
              {active.maxUses === null ? "" : ` / ${active.maxUses}`}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-ink-muted">
              {t("newsletter_usage_released")}
            </p>
            <p className="mt-1 font-semibold text-ink">
              {activeUsage?.released ?? "—"}
            </p>
          </div>
        </div>
      )}

      {availabilityKey ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {t(availabilityKey)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={beginNewRound}>
          {t("newsletter_start_round")}
        </Button>
        {mode === "new" && active ? (
          <Button
            type="button"
            variant="text"
            onClick={() => {
              setMode("edit");
              setForm(formFromPromotion(active));
              setError(null);
            }}
          >
            {t("newsletter_cancel")}
          </Button>
        ) : null}
      </div>

      {mode === "new" ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {t("newsletter_round_warning")}
        </p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("newsletter_promo_code")} htmlFor="newsletter-promo-code">
              <TextInput
                id="newsletter-promo-code"
                value={form.code}
                onChange={(event) => update("code", event.target.value.toUpperCase())}
                maxLength={32}
                autoComplete="off"
              />
            </Field>

            <Field label={t("newsletter_promo_type")} htmlFor="newsletter-promo-type">
              <select
                id="newsletter-promo-type"
                value={form.discountType}
                onChange={(event) =>
                  update(
                    "discountType",
                    event.target.value as NewsletterDiscountType,
                  )
                }
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-ink"
              >
                <option value="PERCENT">{t("newsletter_promo_percent")}</option>
                <option value="FIXED">{t("newsletter_promo_fixed")}</option>
              </select>
            </Field>

            <Field label={t("newsletter_promo_value")} htmlFor="newsletter-promo-value">
              <TextInput
                id="newsletter-promo-value"
                type="number"
                min="0.01"
                step="0.01"
                value={form.discountValue}
                onChange={(event) => update("discountValue", event.target.value)}
              />
            </Field>

            <Field label={t("newsletter_promo_min_spend")} htmlFor="newsletter-promo-min-spend">
              <TextInput
                id="newsletter-promo-min-spend"
                type="number"
                min="0"
                step="0.01"
                value={form.minSpend}
                onChange={(event) => update("minSpend", event.target.value)}
              />
            </Field>

            <Field
              label={t("newsletter_promo_max_uses")}
              htmlFor="newsletter-promo-max-uses"
            >
              <TextInput
                id="newsletter-promo-max-uses"
                type="number"
                min="1"
                step="1"
                value={form.maxUses}
                onChange={(event) => update("maxUses", event.target.value)}
              />
            </Field>

            <Field
              label={t("newsletter_promo_per_customer")}
              htmlFor="newsletter-promo-per-customer"
            >
              <TextInput
                id="newsletter-promo-per-customer"
                type="number"
                min="1"
                step="1"
                value={form.perCustomerLimit}
                onChange={(event) =>
                  update("perCustomerLimit", event.target.value)
                }
              />
            </Field>

            <Field
              label={t("newsletter_promo_valid_from")}
              htmlFor="newsletter-promo-valid-from"
            >
              <TextInput
                id="newsletter-promo-valid-from"
                type="datetime-local"
                value={form.validFrom}
                onChange={(event) => update("validFrom", event.target.value)}
              />
            </Field>

            <Field
              label={t("newsletter_promo_valid_until")}
              htmlFor="newsletter-promo-valid-until"
            >
              <TextInput
                id="newsletter-promo-valid-until"
                type="datetime-local"
                value={form.validUntil}
                onChange={(event) => update("validUntil", event.target.value)}
              />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="mt-4 text-sm font-medium text-cta">
              {t("newsletter_promo_saved")}
            </p>
          ) : null}

          <Button type="submit" className="mt-5" disabled={pending}>
            {pending
              ? t("newsletter_promo_saving")
              : mode === "new"
                ? t("newsletter_promo_create_round")
                : t("newsletter_promo_save")}
          </Button>
        </form>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold text-ink">
          {t("newsletter_history_title")}
        </h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {t("newsletter_history_empty")}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2">{t("newsletter_promo_code")}</th>
                  <th className="px-3 py-2">{t("newsletter_history_rule")}</th>
                  <th className="px-3 py-2">{t("newsletter_usage_effective")}</th>
                  <th className="px-3 py-2">{t("newsletter_usage_released")}</th>
                  <th className="px-3 py-2">{t("newsletter_history_archived_at")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-3 font-mono font-medium">{row.code}</td>
                    <td className="px-3 py-3">
                      {row.discountType === "PERCENT"
                        ? `${Number(row.discountValue)}%`
                        : `₱${Number(row.discountValue).toFixed(2)}`}
                    </td>
                    <td className="px-3 py-3">{usage[row.id]?.effective ?? "—"}</td>
                    <td className="px-3 py-3">{usage[row.id]?.released ?? "—"}</td>
                    <td className="px-3 py-3">
                      {row.archivedAt
                        ? new Date(row.archivedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
