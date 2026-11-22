"use client";

/** Horizontal bar list with count + share (share computed only from real denominators). */
export function BarList({
  items,
  total,
  emptyLabel,
}: {
  items: Array<{ label: string; value: number }>;
  total?: number;
  emptyLabel: string;
}) {
  const denominator = total ?? items.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="mt-3 space-y-2.5">
      {items.length === 0 ? (
        <p className="text-xs text-admin-muted">{emptyLabel}</p>
      ) : (
        items.map((item) => {
          const share = denominator > 0 ? (item.value / denominator) * 100 : null;
          return (
            <div key={item.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-admin-ink">{item.label}</span>
                <span className="shrink-0 text-admin-muted">
                  {item.value}
                  {share === null ? "" : ` · ${share.toFixed(1)}%`}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-admin-muted/10">
                <div
                  className="h-full rounded-full bg-cta/60"
                  style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
