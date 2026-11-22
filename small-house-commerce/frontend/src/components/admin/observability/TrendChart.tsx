"use client";

import type { ObsPoint } from "@/lib/admin-api";

const W = 560;
const H = 200;
const PAD = { left: 8, right: 8, top: 16, bottom: 26 };

/**
 * Line chart for a real daily series. Rules enforced by construction:
 * OK/INCOMPLETE points connect; NO_DATA/UNKNOWN break the line (no
 * interpolation, no zero fill). Today's point is hollow (in progress).
 */
export function TrendChart({
  points,
  seriesState,
  unknownLabel,
  noDataLabel,
  gapLabel,
  statusLabels,
}: {
  points?: ObsPoint[];
  seriesState: "VALUE" | "UNKNOWN";
  unknownLabel: string;
  noDataLabel: string;
  gapLabel: string;
  statusLabels: { ok: string; incomplete: string; noData: string; unknown: string };
}) {
  if (seriesState !== "VALUE" || !points) {
    return <p className="mt-6 text-xs text-admin-muted">{unknownLabel}</p>;
  }
  const drawable = points.filter((p) => p.state === "OK" || p.state === "INCOMPLETE");
  if (drawable.length === 0) {
    return <p className="mt-6 text-xs text-admin-muted">{noDataLabel}</p>;
  }
  const values = drawable.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const runs: ObsPoint[][] = [];
  let run: ObsPoint[] = [];
  points.forEach((p, i) => {
    const drawablePoint = p.state === "OK" || p.state === "INCOMPLETE";
    if (drawablePoint) {
      run.push(p);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
    if (!drawablePoint && run.length === 0) return;
    void i;
  });
  if (run.length > 0) runs.push(run);

  const indexOf = new Map(points.map((p, i) => [p.day, i]));
  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" role="img" aria-label="trend">
        {drawable.length > 0 && [0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-admin-border" strokeDasharray="3 4" />
        ))}
        {runs.map((seg, si) => (
          <g key={si}>
            {seg.length > 1 && (
              <polyline
                fill="none"
                stroke="var(--color-cta, #244c3c)"
                strokeWidth={2}
                points={seg.map((p) => `${x(indexOf.get(p.day) ?? 0)},${y(p.value ?? 0)}`).join(" ")}
              />
            )}
            {seg.map((p) => {
              const cx = x(indexOf.get(p.day) ?? 0);
              const cy = y(p.value ?? 0);
              return p.state === "INCOMPLETE" ? (
                <circle key={p.day} cx={cx} cy={cy} r={4} fill="white" stroke="var(--color-cta, #244c3c)" strokeWidth={2} />
              ) : (
                <circle key={p.day} cx={cx} cy={cy} r={3} fill="var(--color-cta, #244c3c)" />
              );
            })}
          </g>
        ))}
        {labelIndexes.map((i) => {
          const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <text key={i} x={x(i)} y={H - 6} textAnchor={anchor} className="fill-current text-[10px] text-admin-muted">
              {points[i]?.day}
            </text>
          );
        })}
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-admin-muted">
        <span>● {statusLabels.ok}</span>
        <span>○ {statusLabels.incomplete}</span>
        <span>— {gapLabel}</span>
      </p>
    </div>
  );
}
