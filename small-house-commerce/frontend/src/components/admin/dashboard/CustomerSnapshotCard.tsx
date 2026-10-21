"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { CustomerSnapshot } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, ratio } from "./format";

/**
 * New/returning are order-based, not signup-based: "new" is a customer whose
 * FIRST valid order falls inside the period; "returning" is a customer who
 * ordered in the period and had ordered before it. Identical rules govern the
 * repeat rate, so the three numbers always add up.
 */
export function CustomerSnapshotCard({
  snapshot,
  loading,
  canRead,
}: {
  snapshot: CustomerSnapshot | null;
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard title={t("dash_customers")} subtitle={t("dash_repeat_hint")}>
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={2} />
      ) : !snapshot ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <Metric label={t("dash_new_customers")} value={count(snapshot.newCustomers)} />
          <Metric label={t("dash_returning_customers")} value={count(snapshot.returningCustomers)} />
          <Metric label={t("dash_repeat_rate")} value={ratio(snapshot.repeatPurchaseRate, 1)} />
          <Metric
            label={t("dash_subscribers")}
            value={count(snapshot.emailSubscribers)}
            hint={`+${count(snapshot.newEmailSubscribers)}`}
          />
        </dl>
      )}
    </DashboardCard>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="truncate text-[11px] text-ink-muted" title={label}>
        {label}
      </dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums text-ink">
        {value}
        {hint ? <span className="text-[11px] font-normal text-admin-success">{hint}</span> : null}
      </dd>
    </div>
  );
}
