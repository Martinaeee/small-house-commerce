import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { NewsletterOfferNote } from "./NewsletterOfferNote";

function renderWith(overrides: Partial<SiteSettings>) {
  const settings: SiteSettings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return render(
    <SiteSettingsProvider settings={settings}>
      <NewsletterOfferNote />
    </SiteSettingsProvider>,
  );
}

describe("NewsletterOfferNote", () => {
  it("shows the configured subscribe offer next to the promo field", () => {
    renderWith({
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    });

    expect(screen.getByTestId("newsletter-offer-note")).toHaveTextContent(
      "Subscribe and get ₱99 off your first order",
    );
  });

  it("stays hidden when no promo code is live, even if copy is configured", () => {
    renderWith({
      newsletterOfferAvailable: false,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    });

    expect(screen.queryByTestId("newsletter-offer-note")).toBeNull();
  });

  it("stays hidden when the offer copy is blank", () => {
    renderWith({ newsletterOfferAvailable: true, newsletterOfferTitle: "  " });

    expect(screen.queryByTestId("newsletter-offer-note")).toBeNull();
  });
});
