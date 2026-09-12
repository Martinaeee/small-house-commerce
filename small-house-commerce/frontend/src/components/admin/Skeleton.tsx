import type { ReactNode } from "react";

/**
 * Fixed-height pulsing placeholders sized to real table rows (h-12)
 * so replacing them with data causes no layout shift.
 */
export function TableSkeleton({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}): ReactNode {
  return (
    <div
      className="flex flex-col gap-3"
      role="status"
      aria-label="Loading"
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3" aria-hidden="true">
          {Array.from({ length: cols }, (_, col) => (
            <div
              key={col}
              className="h-12 flex-1 animate-pulse rounded bg-border"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
