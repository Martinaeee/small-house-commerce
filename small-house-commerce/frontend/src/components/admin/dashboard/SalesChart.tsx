"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/lib/dashboard-api";

/**
 * Revenue bars with an order-count line, exactly as the brief asks.
 *
 * Colours are literal hex values of the admin tokens
 * (`--color-admin-primary` #1f5a47, `--color-admin-warning` #9a5512) because
 * SVG presentation attributes do not resolve CSS variables in every browser.
 */
export default function SalesChart({
  points,
  revenueLabel,
  ordersLabel,
}: {
  points: DailyPoint[];
  revenueLabel: string;
  ordersLabel: string;
}) {
  return (
    <div className="h-64 min-w-0 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e5e8e3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fontSize: 11, fill: "#666666" }}
          />
          <YAxis
            yAxisId="revenue"
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fontSize: 11, fill: "#999999" }}
            tickFormatter={(value: number) =>
              value >= 1000 ? `₱${Math.round(value / 1000)}k` : `₱${value}`
            }
          />
          <YAxis
            yAxisId="orders"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#999999" }}
          />
          <Tooltip
            cursor={{ fill: "rgba(31, 90, 71, 0.06)" }}
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : Number(value ?? 0);
              return name === revenueLabel
                ? [`₱${numeric.toLocaleString("en-PH")}`, revenueLabel]
                : [`${numeric}`, ordersLabel];
            }}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ borderRadius: 8, borderColor: "#e5e8e3", fontSize: 12 }}
          />
          <Bar
            yAxisId="revenue"
            dataKey="revenue"
            name={revenueLabel}
            fill="#1f5a47"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
          <Line
            yAxisId="orders"
            type="monotone"
            dataKey="orders"
            name={ordersLabel}
            stroke="#9a5512"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
