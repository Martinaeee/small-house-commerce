import type { ReactNode } from "react";

/**
 * Local placeholder artwork. The backend image fields exist; until real
 * photography lands, every card renders this gradient block with the
 * product name as the visual anchor.
 */
export function PlaceholderImage({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}): ReactNode {
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center bg-gradient-to-br from-primary-light via-background to-primary/40 ${className}`}
    >
      <span className="px-4 text-center text-sm font-medium text-cta/70">{label}</span>
    </div>
  );
}
