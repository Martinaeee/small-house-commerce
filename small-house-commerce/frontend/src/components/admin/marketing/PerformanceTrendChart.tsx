"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function PerformanceTrendChart({ points, unit }: { points: Array<{ key: string; label: string; value: number | null }>; unit: string }) {
  return <div className="h-64 min-w-0" aria-label={unit}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={points} accessibilityLayer>
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Line type="linear" dataKey="value" connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
