import { describe, expect, it } from "vitest";
import {
  daysBetween,
  isCustomRangeValid,
  manilaDay,
  presetRange,
} from "./observability-period";

const NOW = new Date("2026-11-10T02:00:00.000Z"); // 10:00 Manila, 2026-11-10

describe("observability period presets", () => {
  it("uses the Manila calendar day", () => {
    expect(manilaDay(new Date("2026-11-10T15:59:00Z"))).toBe("2026-11-10");
    expect(manilaDay(new Date("2026-11-10T16:00:00Z"))).toBe("2026-11-11");
  });

  it("maps the fixed presets", () => {
    expect(presetRange("TODAY", null, NOW)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(presetRange("YESTERDAY", null, NOW)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
    expect(presetRange("LAST_7", null, NOW)).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(presetRange("LAST_14", null, NOW)).toEqual({ from: "2026-10-28", to: "2026-11-10" });
    expect(presetRange("LAST_30", null, NOW)).toEqual({ from: "2026-10-12", to: "2026-11-10" });
  });

  it("rejects custom ranges beyond 90 days or inverted", () => {
    expect(presetRange("CUSTOM", { from: "2026-08-01", to: "2026-11-10" }, NOW)).toBeNull();
    expect(presetRange("CUSTOM", { from: "2026-11-10", to: "2026-11-01" }, NOW)).toBeNull();
    expect(presetRange("CUSTOM", { from: "2026-10-01", to: "2026-11-10" }, NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-11-10",
    });
    expect(isCustomRangeValid("2026-10-01", "2026-11-10")).toBe(true);
    expect(isCustomRangeValid("", "2026-11-10")).toBe(false);
    expect(daysBetween("2026-11-04", "2026-11-10")).toBe(7);
  });
});
