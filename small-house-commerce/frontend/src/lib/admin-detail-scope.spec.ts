import { describe, expect, it } from "vitest";
import {
  detailScopeFromValue,
  detailScopeLabel,
  detailScopeValue,
} from "./admin-detail-scope";

const OPTIONS = [
  { value: "", label: "Shared" },
  { value: "option:ov-black", label: "Colour = Black" },
  { value: "variant:v-1", label: "Black / Small" },
];

describe("detail media scope", () => {
  it("parses the select value into an exclusive scope pair", () => {
    expect(detailScopeFromValue("option:ov-black")).toEqual({
      optionValueId: "ov-black",
      variantId: "",
    });
    expect(detailScopeFromValue("variant:v-1")).toEqual({
      optionValueId: "",
      variantId: "v-1",
    });
    expect(detailScopeFromValue("")).toEqual({
      optionValueId: "",
      variantId: "",
    });
  });

  it("round-trips a block back to its select value", () => {
    expect(detailScopeValue({ variantId: "v-1", optionValueId: "" })).toBe(
      "variant:v-1",
    );
    expect(detailScopeValue({ optionValueId: "ov-black", variantId: "" })).toBe(
      "option:ov-black",
    );
    expect(detailScopeValue({})).toBe("");
    // A block never keeps both scopes; variant wins if legacy data has both.
    expect(detailScopeValue({ variantId: "v-1", optionValueId: "ov-black" })).toBe(
      "variant:v-1",
    );
  });

  it("resolves the badge label from the current scope options", () => {
    expect(detailScopeLabel("variant:v-1", OPTIONS)).toBe("Black / Small");
    expect(detailScopeLabel("", OPTIONS)).toBe("Shared");
    expect(detailScopeLabel("variant:gone", OPTIONS)).toBeUndefined();
  });
});
