import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => cache);

import { POST } from "./route";

describe("storefront revalidation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REVALIDATE_SECRET", "test-secret");
  });

  it("invalidates landing pages, the storefront layout and brand-mark route", async () => {
    const response = await POST(new Request("http://localhost/api/internal/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": "test-secret",
      },
      body: JSON.stringify({ tags: ["storefront"] }),
    }));

    expect(response.status).toBe(200);
    expect(cache.revalidateTag).toHaveBeenCalledWith("storefront", { expire: 0 });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/lp/[slug]", "page");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/(storefront)", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/brand-mark");
  });

  it("rejects an unauthorized request without invalidating anything", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revalidate-secret": "wrong-secret",
        },
        body: JSON.stringify({ tags: ["storefront"] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
