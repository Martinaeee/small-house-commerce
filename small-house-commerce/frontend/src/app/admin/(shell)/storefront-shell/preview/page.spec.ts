import { describe, expect, it, vi } from "vitest";
import { metadata } from "./page";

vi.mock("@/lib/fonts", () => ({
  poppins: { variable: "--font-poppins", className: "font-poppins" },
}));

describe("saved storefront shell preview route", () => {
  it("is never indexed and never followed", () => {
    expect(metadata).toEqual({ robots: { index: false, follow: false } });
  });
});
