export const funnelPercent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const funnelField =
  "h-9 rounded-lg border border-admin-border bg-white px-3 text-sm";
export const funnelButton =
  "rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40";
