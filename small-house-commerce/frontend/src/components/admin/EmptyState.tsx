import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
