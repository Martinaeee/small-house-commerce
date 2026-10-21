import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SITE_SETTINGS,
  fetchSiteSettings,
} from "./site-settings";

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSiteSettings support phone", () => {
  it("keeps the public support phone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          messengerUrl: "",
          supportEmail: "support@luwag.ph",
          supportPhone: "+63 917 123 4567",
          supportHours: "Mon–Sat",
        }),
      ),
    );

    await expect(fetchSiteSettings()).resolves.toMatchObject({
      supportPhone: "+63 917 123 4567",
    });
  });

  it("falls back to an empty phone when the field or endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect(DEFAULT_SITE_SETTINGS.supportPhone).toBe("");
    await expect(fetchSiteSettings()).resolves.toMatchObject({
      supportPhone: "",
    });
  });
});
