import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_SETTINGS, fetchSiteSettings } from "./site-settings";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchSiteSettings newsletter copy", () => {
  it("uses safe built-in copy when an older payload omits the new fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          messengerUrl: "",
          supportEmail: "support@luwag.ph",
          supportHours: "Mon–Sat, 9am–6pm (PHT)",
        }),
      ),
    );

    await expect(fetchSiteSettings()).resolves.toMatchObject({
      supportPhone: DEFAULT_SITE_SETTINGS.supportPhone,
      newsletterEyebrow: DEFAULT_SITE_SETTINGS.newsletterEyebrow,
      newsletterFormTitle: DEFAULT_SITE_SETTINGS.newsletterFormTitle,
      newsletterEmailPlaceholder:
        DEFAULT_SITE_SETTINGS.newsletterEmailPlaceholder,
      newsletterConsentText: DEFAULT_SITE_SETTINGS.newsletterConsentText,
    });
  });

  it("uses all four copy values returned by the settings endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          supportPhone: "+63 917 123 4567",
          newsletterEyebrow: "Furniture notes",
          newsletterFormTitle: "Ideas by email",
          newsletterEmailPlaceholder: "name@example.com",
          newsletterConsentText: "Useful updates only.",
        }),
      ),
    );

    await expect(fetchSiteSettings()).resolves.toMatchObject({
      supportPhone: "+63 917 123 4567",
      newsletterEyebrow: "Furniture notes",
      newsletterFormTitle: "Ideas by email",
      newsletterEmailPlaceholder: "name@example.com",
      newsletterConsentText: "Useful updates only.",
    });
  });
});
