import { describe, expect, it } from "vitest";
import { quickDateRange, quickRangePresets } from "@/lib/quick-date-range";

const at = (iso: string) => new Date(iso);

describe("quick marketing date ranges", () => {
  it("resolves today, yesterday and the two-day range on the Manila day", () => {
    // 2026-11-04 15:59 UTC is still 2026-11-04 in Manila (23:59).
    const late = at("2026-11-04T15:59:00Z");
    expect(quickDateRange("TODAY", late)).toEqual({ from: "2026-11-04", to: "2026-11-04" });
    expect(quickDateRange("YESTERDAY", late)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(quickDateRange("TODAY_AND_YESTERDAY", late)).toEqual({ from: "2026-11-03", to: "2026-11-04" });
    expect(quickDateRange("LAST_7_DAYS", late)).toEqual({ from: "2026-10-29", to: "2026-11-04" });
  });

  it("switches the day at 16:00 UTC, matching the Manila business day", () => {
    const boundary = at("2026-11-04T16:00:00Z");
    expect(quickDateRange("TODAY", boundary)).toEqual({ from: "2026-11-05", to: "2026-11-05" });
    expect(quickDateRange("YESTERDAY", boundary)).toEqual({ from: "2026-11-04", to: "2026-11-04" });
  });

  it("crosses month and year boundaries", () => {
    expect(quickDateRange("TODAY_AND_YESTERDAY", at("2027-01-01T02:00:00Z"))).toEqual({
      from: "2026-12-31",
      to: "2027-01-01",
    });
    expect(quickDateRange("LAST_7_DAYS", at("2026-11-03T02:00:00Z"))).toEqual({
      from: "2026-10-28",
      to: "2026-11-03",
    });
  });

  it("keeps the four short presets in the requested order", () => {
    expect(quickRangePresets).toEqual(["TODAY", "YESTERDAY", "TODAY_AND_YESTERDAY", "LAST_7_DAYS"]);
  });
});
