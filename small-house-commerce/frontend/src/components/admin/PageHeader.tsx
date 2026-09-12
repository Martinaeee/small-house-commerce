import type { ReactNode } from "react";

export function PageHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-xl font-semibold text-ink">
        {title}
        {typeof count === "number" ? (
          <span className="ml-1 font-normal text-ink-muted">({count})</span>
        ) : null}
      </h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
