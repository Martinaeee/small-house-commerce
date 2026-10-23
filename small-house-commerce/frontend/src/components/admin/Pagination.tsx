import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  labels,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
  /**
   * The words of the pager. A surface that speaks another language passes
   * them in; `{page}` and `{total}` are replaced with the numbers. Without
   * them the pager keeps its English default.
   */
  labels?: { prev: string; next: string; page: string };
}): ReactNode {
  if (total === 0) return null;

  const totalPages =
    pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const prev = labels?.prev ?? "Prev";
  const next = labels?.next ?? "Next";
  const pageText = (labels?.page ?? "Page {page} of {total}")
    .replace("{page}", String(page))
    .replace("{total}", String(totalPages));

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
        {prev}
      </Button>
      <span className="text-sm text-ink-secondary" aria-live="polite">
        {pageText}
      </span>
      <Button
        variant="secondary"
        size="md"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        {next}
      </Button>
    </nav>
  );
}
