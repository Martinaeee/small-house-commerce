import { describe, expect, it } from "vitest";
import { assertE2EDatabaseUrl, TASK5_APPROVED_DATABASE } from "./e2e-guard";

describe("Task 5 E2E database guard", () => {
  it("accepts the approved loopback database", () => {
    expect(
      assertE2EDatabaseUrl(
        `postgresql://postgres:postgres@localhost:5432/${TASK5_APPROVED_DATABASE}?schema=public`,
      ),
    ).toEqual({ database: TASK5_APPROVED_DATABASE, host: "localhost", port: "5432" });
    expect(
      assertE2EDatabaseUrl(
        `postgresql://postgres:postgres@127.0.0.1:5432/${TASK5_APPROVED_DATABASE}?schema=public`,
      ).host,
    ).toBe("127.0.0.1");
  });

  it("accepts an alternate loopback port only when explicitly approved", () => {
    expect(
      assertE2EDatabaseUrl(
        `postgresql://postgres:postgres@localhost:55439/${TASK5_APPROVED_DATABASE}?schema=public`,
        "55439",
      ),
    ).toEqual({
      database: TASK5_APPROVED_DATABASE,
      host: "localhost",
      port: "55439",
    });
    expect(() =>
      assertE2EDatabaseUrl(
        `postgresql://postgres:postgres@localhost:55439/${TASK5_APPROVED_DATABASE}?schema=public`,
      ),
    ).toThrow(/port must be 5432/);
  });

  it("accepts the Studio database only with its explicit profile and port", () => {
    const url = "postgresql://postgres:postgres@localhost:5556/small_house_homepage_studio_20261016_test?schema=public";
    expect(assertE2EDatabaseUrl(url, "5556", "homepage-studio")).toEqual({
      database: "small_house_homepage_studio_20261016_test",
      host: "localhost",
      port: "5556",
    });
    expect(() => assertE2EDatabaseUrl(url, "5556")).toThrow(/database must be exactly/);
  });

  it.each([
    "postgresql://postgres:postgres@example.com:5556/small_house_homepage_studio_20261016_test",
    "postgresql://postgres:postgres@localhost:5556/small_house",
    "postgresql://postgres:postgres@localhost:5556/small_house_variant_test",
    "postgresql://postgres:postgres@localhost:5546/small_house_homepage_studio_20261016_test",
  ])("rejects an unsafe Studio target %s", (url) => {
    expect(() => assertE2EDatabaseUrl(url, "5556", "homepage-studio")).toThrow();
  });

  it("does not let the Studio profile approve a different port", () => {
    expect(() => assertE2EDatabaseUrl(
      "postgresql://postgres:postgres@localhost:5432/small_house_homepage_studio_20261016_test",
      "5432",
      "homepage-studio",
    )).toThrow(/5556/);
  });

  it.each([
    ["remote host", "postgresql://postgres:postgres@example.com:5432/small_house_variant_test"],
    ["production database", "postgresql://postgres:postgres@localhost:5432/small_house"],
    ["wrong test database", "postgresql://postgres:postgres@localhost:5432/small_house_variant_task2_test"],
    ["wrong port", "postgresql://postgres:postgres@localhost:5433/small_house_variant_test"],
    ["missing URL", undefined],
  ])("rejects %s before setup commands can run", (_label, url) => {
    expect(() => assertE2EDatabaseUrl(url)).toThrow(/Task 5 E2E guard refused DATABASE_URL/);
  });
});
