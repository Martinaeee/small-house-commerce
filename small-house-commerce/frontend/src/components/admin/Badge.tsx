import type { ReactNode } from "react";

/**
 * Admin status badges (design spec §12).
 * Color is enhancement only — the raw enum text is always rendered.
 */

export type BadgeTone = "green" | "amber" | "red" | "neutral";

const GREEN_STATUSES = new Set([
  "CONFIRMED",
  "SIGNED",
  "PAID",
  "COLLECTED",
  "SETTLED",
  "CONSUMED",
  "RELEASED",
]);

const AMBER_STATUSES = new Set([
  "NEW",
  "PENDING",
  "QUESTION",
  "ABNORMAL",
  "SHIPPING",
  "NEEDS_REVIEW",
  "COD_PENDING",
  "ONLINE_PENDING",
  "DRAFT",
  "ACTIVE",
]);

const RED_STATUSES = new Set([
  "CANCELLED",
  "DENIED",
  "REJECTED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISABLED",
]);

export function statusTone(value: string): BadgeTone {
  if (GREEN_STATUSES.has(value)) return "green";
  if (AMBER_STATUSES.has(value)) return "amber";
  if (RED_STATUSES.has(value)) return "red";
  return "neutral";
}

const toneCls: Record<BadgeTone, string> = {
  green: "bg-admin-success-soft text-admin-success",
  amber: "bg-admin-warning-soft text-admin-warning",
  red: "bg-admin-error-soft text-admin-error",
  neutral: "bg-admin-neutral-soft text-ink-secondary",
};

export function Badge({
  value,
  tone,
}: {
  value: string;
  tone?: BadgeTone;
}): ReactNode {
  const resolved = tone ?? statusTone(value);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${toneCls[resolved]}`}
    >
      {value}
    </span>
  );
}
