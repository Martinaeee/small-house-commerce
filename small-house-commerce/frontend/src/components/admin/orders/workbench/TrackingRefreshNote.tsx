"use client";

export interface TrackingRefreshFeedback {
  ok: boolean;
  message: string;
}

/**
 * The one-line result of an on-demand tracking refresh. Rendered next to the
 * shipment it belongs to so a refused carrier or a carrier error cannot be
 * mistaken for a silent no-op.
 */
export function TrackingRefreshNote({
  feedback,
}: {
  feedback: TrackingRefreshFeedback | null;
}) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.ok ? "status" : "alert"}
      className={
        feedback.ok
          ? "mt-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800"
          : "mt-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-800"
      }
    >
      {feedback.message}
    </p>
  );
}
