import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";

/**
 * Phase B partial-failure panel (Task 11 two-phase save). The batch endpoint
 * settles every row independently, so when some rows fail the save must not
 * look lost: the panel lists EXACTLY the failed rows with their target on-hand
 * and the backend message, and "Retry failed rows" resubmits only those rows —
 * successful rows are never sent again.
 */
export interface StockFailureRow {
  skuId: string;
  onHand: number;
  label: string;
  error: string;
}

export function StockRetryPanel({
  failures,
  onRetry,
  pending,
}: {
  failures: StockFailureRow[];
  onRetry: () => void;
  pending: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  if (failures.length === 0) return null;
  // Unresolved rows carry `skuId: ""`, so the id alone cannot key them (two
  // rows can share a label); and with no retryable row left the button would
  // be a dead end — it stays visible but disabled.
  const hasRetryableRow = failures.some((failure) => failure.skuId !== "");
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4"
    >
      <p className="text-sm font-semibold text-ink">
        {t("product_stock_panel_title", { count: failures.length })}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        {t("product_stock_panel_hint")}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {failures.map((failure, index) => (
          <li
            key={`${index}-${failure.skuId}-${failure.label}`}
            className="rounded-lg bg-background px-3 py-2 text-sm"
          >
            <span className="font-semibold text-ink">{failure.label}</span>
            <span className="ml-2 text-ink-muted">
              {t("product_stock_panel_target", { onHand: failure.onHand })}
            </span>
            <p className="mt-0.5 text-xs text-red-700">{failure.error}</p>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="md"
        className="mt-3"
        onClick={onRetry}
        disabled={pending || !hasRetryableRow}
      >
        {t("product_stock_panel_retry")}
      </Button>
    </div>
  );
}
