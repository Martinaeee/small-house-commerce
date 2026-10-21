import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { SubscribeEmailForm } from "./SubscribeEmailForm";

const clipboardMock = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyText: clipboardMock.copyText }));

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function submit(email: string) {
  fireEvent.change(screen.getByTestId("newsletter-subscribe-email"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByTestId("newsletter-subscribe-submit"));
}

describe("SubscribeEmailForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    clipboardMock.copyText.mockReset();
    clipboardMock.copyText.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses theme tokens for both popup and Footer-band variants", () => {
    const popup = render(<SubscribeEmailForm source="POPUP" variant="popup" />);

    expect(screen.getByTestId("newsletter-subscribe-email").className).toContain(
      "bg-newsletter-card",
    );
    expect(screen.getByTestId("newsletter-subscribe-email").className).toContain(
      "text-newsletter-text",
    );
    expect(screen.getByTestId("newsletter-subscribe-submit").className).toContain(
      "bg-newsletter-accent",
    );
    expect(screen.getByTestId("newsletter-subscribe-submit").className).toContain(
      "text-newsletter-foreground",
    );

    popup.unmount();
    render(<SubscribeEmailForm source="FOOTER" variant="band" />);
    expect(screen.getByTestId("newsletter-subscribe-email").className).toContain(
      "text-footer-foreground",
    );
    expect(screen.getByTestId("newsletter-subscribe-submit").className).toContain(
      "bg-footer-foreground",
    );
    expect(screen.getByTestId("newsletter-subscribe-submit").className).toContain(
      "text-footer-background",
    );
  });

  it("reports the real promo code to an external success dialog and resets the form", async () => {
    const onSuccess = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        ok: true,
        promoCode: "WELCOME10",
        offerTitle: "Subscribe and save",
        offerBody: "Welcome to LUWAG.",
      }),
    );

    render(<SubscribeEmailForm source="FOOTER" onSuccess={onSuccess} />);
    submit("shopper@example.com");

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("WELCOME10"));
    expect(screen.queryByTestId("newsletter-success-ticket")).toBeNull();
    expect(screen.getByTestId("newsletter-subscribe-email")).toHaveValue("");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/v1/storefront/newsletter/subscribe");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "shopper@example.com",
      source: "FOOTER",
    });
  });

  it("uses the shared HTTP-safe clipboard fallback for the promo code", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      okResponse({ ok: true, promoCode: "WELCOME10" }),
    );
    render(<SubscribeEmailForm source="POPUP" />);
    submit("shopper@example.com");

    await user.click(await screen.findByTestId("newsletter-copy-code"));

    expect(clipboardMock.copyText).toHaveBeenCalledWith("WELCOME10");
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("shows only a success message when no promo code is live", async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({ ok: true, promoCode: null, offerTitle: "", offerBody: "" }),
    );

    render(<SubscribeEmailForm source="POPUP" />);
    submit("shopper@example.com");

    await waitFor(() =>
      expect(screen.getByTestId("newsletter-subscribe-status")).toHaveTextContent(
        /subscribed/i,
      ),
    );
    expect(screen.queryByTestId("newsletter-subscribe-code")).toBeNull();
  });

  it("does not post an invalid email", async () => {
    render(<SubscribeEmailForm source="FOOTER" />);
    submit("not-an-email");

    await waitFor(() =>
      expect(screen.getByTestId("newsletter-subscribe-status")).toHaveTextContent(
        /valid email/i,
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces a readable failure and keeps the email", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    render(<SubscribeEmailForm source="FOOTER" />);
    submit("shopper@example.com");

    await waitFor(() =>
      expect(screen.getByTestId("newsletter-subscribe-status")).toHaveTextContent(
        /could not/i,
      ),
    );
    expect(screen.getByTestId("newsletter-subscribe-email")).toHaveValue(
      "shopper@example.com",
    );
  });
});
