import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { NewsletterPopup } from "./NewsletterPopup";

vi.mock("@/components/layout/BrandWordmark", () => ({
  BrandWordmark: () => <span aria-label="LUWAG">luwag</span>,
}));

const SEEN_KEY = "luwag_newsletter_popup_seen";

function renderPopup(patch: Partial<SiteSettings> = {}) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...patch }}>
      <NewsletterPopup />
    </SiteSettingsProvider>,
  );
}

const live = {
  newsletterPopupEnabled: true,
  newsletterOfferAvailable: true,
  newsletterPopupDelaySeconds: 5,
  newsletterOfferTitle: "Subscribe and save",
  newsletterEyebrow: "Member furniture notes",
  newsletterFormTitle: "Join by email",
  newsletterEmailPlaceholder: "you@example.com",
  newsletterConsentText: "Useful updates only. Unsubscribe anytime.",
};

describe("NewsletterPopup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not open while disabled or without a live offer", () => {
    renderPopup({ newsletterPopupEnabled: false, newsletterOfferAvailable: true });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId("newsletter-popup")).toBeNull();
  });

  it("does not open when a promotion is configured but not live", () => {
    renderPopup({ ...live, newsletterOfferAvailable: false });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId("newsletter-popup")).toBeNull();
  });

  it("opens after the configured delay when enabled with a live offer", () => {
    renderPopup(live);
    expect(screen.queryByTestId("newsletter-popup")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("newsletter-popup")).toBeInTheDocument();
    expect(screen.getByText("Member furniture notes")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Join by email" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("newsletter-subscribe-email")).toHaveAttribute(
      "placeholder",
      "you@example.com",
    );
    expect(
      screen.getByText("Useful updates only. Unsubscribe anytime."),
    ).toBeInTheDocument();
    expect(screen.getByText("Subscribe and save")).toBeInTheDocument();
    const ticket = screen.getByTestId("newsletter-offer-ticket");
    expect(ticket).toHaveTextContent("Subscribe and save");
    expect(screen.getAllByTestId("newsletter-offer-ticket")).toHaveLength(1);
    expect(screen.queryByText("$5 off")).toBeNull();
  });

  it("stays closed for a browser that has already seen it", () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    renderPopup(live);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId("newsletter-popup")).toBeNull();
  });

  it("does not open later when another subscribe entry marks the browser seen", () => {
    renderPopup(live);
    window.localStorage.setItem(SEEN_KEY, "1");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.queryByTestId("newsletter-popup")).toBeNull();
  });

  it("records the seen key on close so a reload never reopens it", () => {
    renderPopup(live);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    fireEvent.click(screen.getByTestId("newsletter-popup-close"));

    expect(screen.queryByTestId("newsletter-popup")).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("records the seen key on a successful subscribe", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, promoCode: "WELCOME10" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderPopup(live);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // The popup is open; real timers let waitFor poll the async submit.
    vi.useRealTimers();

    fireEvent.change(screen.getByTestId("newsletter-subscribe-email"), {
      target: { value: "shopper@example.com" },
    });
    fireEvent.click(screen.getByTestId("newsletter-subscribe-submit"));

    await waitFor(() =>
      expect(window.localStorage.getItem(SEEN_KEY)).toBe("1"),
    );
    const successDialog = screen.getByTestId("newsletter-success-dialog");
    expect(successDialog).toHaveTextContent("Thank You!");
    expect(successDialog).toHaveTextContent(
      "You have successfully subscribed to the newsletter.",
    );
    expect(successDialog).toHaveTextContent("WELCOME10");
    expect(screen.queryByTestId("newsletter-offer-ticket")).toBeNull();
  });
});
