import type { ReactNode } from "react";

export function PageHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
          {typeof count === "number" ? (
            <>
              {" "}
              <span className="font-normal text-ink-muted">({count})</span>
            </>
          ) : null}
        </h1>
        {subtitle ? (
          <p
            data-page-header="subtitle"
            className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-secondary"
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-page-header="actions"
          className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
