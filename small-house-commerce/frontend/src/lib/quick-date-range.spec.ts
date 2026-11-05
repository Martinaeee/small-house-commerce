import { describe, expect, it } from "vitest";
import { monthGrid, presetForRange, quickDateRange, rangePresets, shiftMonth } from "@/lib/quick-date-range";

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

});

describe("calendar presets and grids", () => {
  it("resolves weeks and months like the performance presets", () => {
    const now = at("2026-11-05T02:00:00Z");
    expect(quickDateRange("THIS_WEEK", now)).toEqual({ from: "2026-11-02", to: "2026-11-05" });
    expect(quickDateRange("LAST_WEEK", now)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(quickDateRange("THIS_MONTH", now)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(quickDateRange("LAST_MONTH", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(quickDateRange("LAST_14_DAYS", now)).toEqual({ from: "2026-10-23", to: "2026-11-05" });
    expect(quickDateRange("LAST_28_DAYS", now)).toEqual({ from: "2026-10-09", to: "2026-11-05" });
    expect(quickDateRange("LAST_30_DAYS", now)).toEqual({ from: "2026-10-07", to: "2026-11-05" });
  });

  it("names the preset a concrete range equals", () => {
    expect(presetForRange({ from: "2026-11-04", to: "2026-11-05" }, at("2026-11-05T02:00:00Z"))).toBe("TODAY_AND_YESTERDAY");
    expect(presetForRange({ from: "2026-10-01", to: "2026-10-07" }, at("2026-11-05T02:00:00Z"))).toBeNull();
  });

  it("lays a month out Monday-first with empty lead cells", () => {
    // 2026-11-01 is a Sunday: six leading blanks before it.
    expect(monthGrid("2026-11-01")[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(monthGrid("2026-11-01").flat().filter(Boolean)).toHaveLength(30);
    expect(monthGrid("2026-11-01").every(week => week.length === 7)).toBe(true);
  });

  it("steps months without drifting into the next one", () => {
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("lists every picker preset in order", () => {
    expect(rangePresets).toHaveLength(11);
    expect(rangePresets[0]).toBe("TODAY");
    expect(rangePresets.at(-1)).toBe("LAST_MONTH");
  });
});
