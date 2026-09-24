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
