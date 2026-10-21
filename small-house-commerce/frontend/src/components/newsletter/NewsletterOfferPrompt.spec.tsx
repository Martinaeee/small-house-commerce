import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { NewsletterOfferPrompt } from "./NewsletterOfferPrompt";
import { onNewsletterOfferRequest } from "./newsletterOfferChannel";

function renderPrompt(patch: Partial<SiteSettings> = {}) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...patch }}>
      <NewsletterOfferPrompt />
    </SiteSettingsProvider>,
  );
}

describe("NewsletterOfferPrompt", () => {
  it("shows the configured offer as a prominent, clickable line", () => {
    renderPrompt({
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    });

    const prompt = screen.getByTestId("newsletter-offer-prompt");
    expect(prompt).toHaveTextContent(
      "Subscribe and get ₱99 off your first order",
    );
    expect(prompt.tagName).toBe("BUTTON");
  });

  it("asks for the subscribe popup when the shopper taps it", () => {
    const listener = vi.fn();
    const stop = onNewsletterOfferRequest(listener);
    renderPrompt({
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    });

    fireEvent.click(screen.getByTestId("newsletter-offer-prompt"));

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays hidden when the backend has no live promo code", () => {
    renderPrompt({
      newsletterOfferAvailable: false,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    });

    expect(screen.queryByTestId("newsletter-offer-prompt")).toBeNull();
  });

  it("stays hidden when the offer copy is blank", () => {
    renderPrompt({
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "   ",
    });

    expect(screen.queryByTestId("newsletter-offer-prompt")).toBeNull();
  });
});
