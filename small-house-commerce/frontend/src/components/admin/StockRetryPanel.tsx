import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

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
  if (failures.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4"
    >
      <p className="text-sm font-semibold text-ink">
        {failures.length} 项库存写入失败（其余已保存）
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        修正数量后点下方按钮，只会重试失败的行；已成功的行不会再次写入。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {failures.map((failure) => (
          <li
            key={`${failure.skuId}-${failure.label}`}
            className="rounded-lg bg-background px-3 py-2 text-sm"
          >
            <span className="font-semibold text-ink">{failure.label}</span>
            <span className="ml-2 text-ink-muted">目标库存 {failure.onHand}</span>
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
        disabled={pending}
      >
        Retry failed rows（重试失败行）
      </Button>
    </div>
  );
}
