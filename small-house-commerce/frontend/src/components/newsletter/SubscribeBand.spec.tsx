import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { SubscribeBand } from "./SubscribeBand";

const clipboardMock = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyText: clipboardMock.copyText }));

function renderBand(patch: Partial<SiteSettings> = {}) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...patch }}>
      <SubscribeBand />
    </SiteSettingsProvider>,
  );
}

describe("SubscribeBand", () => {
  beforeEach(() => {
    clipboardMock.copyText.mockReset();
    clipboardMock.copyText.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the offer copy and the form when a promotion is live", () => {
    renderBand({
      newsletterBandEnabled: true,
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and save",
      newsletterOfferBody: "Enjoy a welcome discount.",
      newsletterEyebrow: "Furniture notes",
      newsletterFormTitle: "Ideas by email",
      newsletterEmailPlaceholder: "name@example.com",
      newsletterConsentText: "Occasional updates. Unsubscribe whenever you like.",
    });

    expect(screen.getByTestId("newsletter-band")).toBeInTheDocument();
    expect(screen.getByTestId("newsletter-band-offer")).toHaveTextContent(
      "Subscribe and save",
    );
    expect(screen.getByText("Furniture notes")).toBeInTheDocument();
    expect(screen.getByText("Ideas by email")).toBeInTheDocument();
    expect(screen.getByTestId("newsletter-subscribe-email")).toHaveAttribute(
      "placeholder",
      "name@example.com",
    );
    expect(
      screen.getByText("Occasional updates. Unsubscribe whenever you like."),
    ).toBeInTheDocument();
    expect(screen.getByText("Subscribe and save")).toBeInTheDocument();
    expect(screen.getByText("Enjoy a welcome discount.")).toBeInTheDocument();
    expect(
      screen.getByTestId("newsletter-subscribe-email"),
    ).toBeInTheDocument();
  });

  it("uses the band palette for the newsletter copy", () => {
    renderBand({
      newsletterBandEnabled: true,
      newsletterOfferAvailable: false,
    });

    const band = screen.getByTestId("newsletter-band");
    expect(band.className).toContain("bg-footer-band");
    expect(band.className).toContain("text-footer-band-ink");
    expect(screen.getByTestId("newsletter-eyebrow").className).toContain(
      "text-footer-band-soft",
    );
    const headline = screen.getByRole("heading", {
      name: "Make more room for good ideas",
    });
    expect(headline.className).toContain("uppercase");
    expect(headline.className).toContain("font-bold");
    expect(
      screen.getByText(
        "New arrivals, home ideas and special offers — straight to your inbox.",
      ),
    ).toHaveClass("text-footer-band-soft");
    // The form title stays available to assistive technology, the consent
    // line stays visible.
    expect(screen.getByTestId("newsletter-form-title").className).toContain(
      "sr-only",
    );
    expect(
      screen.getByText(DEFAULT_SITE_SETTINGS.newsletterConsentText),
    ).toHaveClass("text-footer-band-soft");
  });

  it("opens the shared success dialog after subscribing from the band", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, promoCode: "WELCOME10" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderBand({
      newsletterBandEnabled: true,
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and save",
    });

    fireEvent.change(screen.getByTestId("newsletter-subscribe-email"), {
      target: { value: "shopper@example.com" },
    });
    fireEvent.click(screen.getByTestId("newsletter-subscribe-submit"));

    const dialog = await screen.findByTestId("newsletter-success-dialog");
    expect(dialog).toHaveTextContent("Thank You!");
    expect(dialog).toHaveTextContent("WELCOME10");
    fireEvent.click(screen.getByTestId("newsletter-copy-code"));
    await waitFor(() =>
      expect(clipboardMock.copyText).toHaveBeenCalledWith("WELCOME10"),
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close success message" }));
    await waitFor(() =>
      expect(screen.queryByTestId("newsletter-success-dialog")).toBeNull(),
    );
    expect(screen.getByTestId("newsletter-subscribe-email")).toHaveValue("");
  });

  it("renders a plain subscribe box with no offer claim when none is live", () => {
    renderBand({
      newsletterBandEnabled: true,
      newsletterOfferAvailable: false,
      newsletterOfferTitle: "Subscribe and save",
      newsletterOfferBody: "Enjoy a welcome discount.",
    });

    expect(screen.getByTestId("newsletter-band")).toBeInTheDocument();
    // The copy is configured but the promotion is not live: promising it would
    // be a lie, so neither the title nor the body may render.
    expect(screen.queryByText("Subscribe and save")).toBeNull();
    expect(screen.queryByText("Enjoy a welcome discount.")).toBeNull();
    expect(
      screen.getByTestId("newsletter-subscribe-email"),
    ).toBeInTheDocument();
  });

  it("renders nothing when the band is disabled", () => {
    renderBand({ newsletterBandEnabled: false });

    expect(screen.queryByTestId("newsletter-band")).toBeNull();
  });

  it("does not fetch on render", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderBand({ newsletterBandEnabled: true, newsletterOfferAvailable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
