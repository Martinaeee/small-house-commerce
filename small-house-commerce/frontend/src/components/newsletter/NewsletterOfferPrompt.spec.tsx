import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { NewsletterOfferPrompt } from "./NewsletterOfferPrompt";
import {
  grantNewsletterCode,
  onNewsletterOfferRequest,
} from "./newsletterOfferChannel";

function renderPrompt(
  patch: Partial<SiteSettings> = {},
  appliedCode: string | null = null,
) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...patch }}>
      <NewsletterOfferPrompt appliedCode={appliedCode} />
    </SiteSettingsProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
});

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

  it("shows a check instead of Get code once the subscriber code is on the order", async () => {
    grantNewsletterCode("WELCOME99");
    renderPrompt(
      {
        newsletterOfferAvailable: true,
        newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
      },
      "welcome99",
    );

    expect(
      await screen.findByTestId("newsletter-offer-applied"),
    ).toHaveTextContent("Applied");
    expect(screen.queryByText("Get code")).toBeNull();
    expect(screen.getByTestId("newsletter-offer-prompt").tagName).toBe("DIV");
    expect(screen.getByTestId("newsletter-offer-prompt")).toHaveTextContent(
      "Your subscriber discount is included in the order total.",
    );
  });

  it("keeps offering the code when another promo is on the order", async () => {
    grantNewsletterCode("WELCOME99");
    renderPrompt(
      {
        newsletterOfferAvailable: true,
        newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
      },
      "SAVE10",
    );

    expect(await screen.findByText("Get code")).toBeInTheDocument();
    expect(screen.queryByTestId("newsletter-offer-applied")).toBeNull();
  });
});
