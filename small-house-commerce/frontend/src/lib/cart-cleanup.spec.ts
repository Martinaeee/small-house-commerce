import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { removeCartLines } from "./cart-cleanup";

describe("removeCartLines", () => {
  it("removes every line and reports no failures", async () => {
    const removed: string[] = [];
    const failed = await removeCartLines(async (id) => {
      removed.push(id);
    }, ["line-a", "line-b"]);

    expect(removed).toEqual(["line-a", "line-b"]);
    expect(failed).toEqual([]);
  });

  it("keeps going after one failing line and reports only that line", async () => {
    const removed: string[] = [];
    const failed = await removeCartLines(async (id) => {
      if (id === "line-b") throw new ApiError("boom", 500, null);
      removed.push(id);
    }, ["line-a", "line-b", "line-c"]);

    // Partial success: the healthy lines are gone, the failed one is retried
    // by the caller instead of blocking the rest.
    expect(removed).toEqual(["line-a", "line-c"]);
    expect(failed).toEqual(["line-b"]);
  });

  it("treats a 404 as already removed so a retry can converge", async () => {
    const failed = await removeCartLines(async (id) => {
      throw new ApiError("not found", 404, null);
    }, ["line-a"]);

    expect(failed).toEqual([]);
  });

  it("reports lines that are not ApiErrors as failures", async () => {
    const failed = await removeCartLines(async () => {
      throw new TypeError("Failed to fetch");
    }, ["line-a"]);
    expect(failed).toEqual(["line-a"]);
  });
});
