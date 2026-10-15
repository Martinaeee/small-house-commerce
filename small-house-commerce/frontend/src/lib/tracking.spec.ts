import { beforeEach, describe, expect, it } from "vitest";
import { readAttribution } from "./tracking";

const KEY = "sh:marketing-touch";

describe("server credential checkout contract", () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); });

  it("does not derive checkout ownership from raw URL or legacy landing-page storage", () => {
    window.localStorage.setItem("sh:lp", "00000000-0000-7000-8000-000000000003");
    window.history.replaceState({}, "", "/products/chair?aid=forged&ad_id=forged-ad&utm_source=forged");
    expect(readAttribution()).toEqual({});
  });

  it("reads the retained server credential after navigating to an ordinary page", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    window.history.replaceState({}, "", "/checkout/confirm");
    expect(readAttribution()).toEqual({ marketingCredential: "server.credential" });
  });

  it("ignores malformed or expired stored credentials", () => {
    for (const value of ["not-json", JSON.stringify({ credential: 123, expiresAt: "2099-01-01T00:00:00Z" }), JSON.stringify({ credential: "expired.credential", expiresAt: "2000-01-01T00:00:00Z" })]) {
      window.localStorage.setItem(KEY, value);
      expect(readAttribution()).toEqual({});
    }
  });
});
