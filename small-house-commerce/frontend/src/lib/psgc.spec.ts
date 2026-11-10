import { describe, expect, it } from "vitest";
import {
  ISABELA_CITY,
  listMunicipalities,
  listProvinces,
  matchPsgcName,
} from "./psgc";
import { lookupPostalCode } from "./postalCodes";

/**
 * F08: Isabela City is a PSGC independent city inside Basilan, listed as its
 * own province-level row. It must stay selectable, resolve to its own
 * barangays/postal code, and never be mistaken for the Region II province
 * "Isabela" or the Negros Occidental municipality of the same name.
 */
describe("Isabela City address support", () => {
  it("keeps Isabela City in the province list while hiding other empty provinces", () => {
    const provinces = listProvinces();
    expect(provinces).toContain(ISABELA_CITY);
    expect(provinces).toContain("Isabela");
    // No other province-level row is left with zero cities.
    expect(
      provinces.filter((province) => listMunicipalities(province).length === 0),
    ).toEqual([]);
  });

  it("offers the city for its own province row and inside Basilan", () => {
    expect(listMunicipalities(ISABELA_CITY)).toEqual([ISABELA_CITY]);
    expect(listMunicipalities("Basilan")).toContain(ISABELA_CITY);
    // Region II's Isabela must not gain the Basilan city.
    expect(listMunicipalities("Isabela")).not.toContain(ISABELA_CITY);
  });

  it("matches the city a map reports instead of the same-named province", () => {
    expect(matchPsgcName(listProvinces(), "Isabela City")).toBe(ISABELA_CITY);
    expect(matchPsgcName(listProvinces(), "Isabela")).toBe("Isabela");
    expect(matchPsgcName(listMunicipalities("Basilan"), "Isabela City")).toBe(
      ISABELA_CITY,
    );
    expect(
      matchPsgcName(listMunicipalities("Negros Occidental"), "Isabela"),
    ).toBe("Isabela");
  });

  it("resolves the complete Basilan → Isabela City → 7300 postal combination", () => {
    for (const province of [ISABELA_CITY, "Basilan"]) {
      expect(lookupPostalCode(province, ISABELA_CITY)).toEqual({
        auto: "7300",
        options: [],
      });
    }
    // The Region II province keeps its own codes; the names never cross.
    expect(lookupPostalCode("Isabela", "Isabela")).toEqual({
      auto: null,
      options: [],
    });
  });
});
