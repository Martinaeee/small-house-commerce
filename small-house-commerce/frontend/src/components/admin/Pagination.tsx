import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
}): ReactNode {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <nav
      className="flex items-center justify-center gap-4"
      aria-label="Pagination"
    >
      <Button
        variant="secondary"
        size="md"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        Prev
      </Button>
      <span className="text-sm text-ink-secondary" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="secondary"
        size="md"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        Next
      </Button>
    </nav>
  );
}
