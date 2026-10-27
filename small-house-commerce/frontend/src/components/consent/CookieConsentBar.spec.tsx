import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CookieConsentBar } from "./CookieConsentBar";
import {
  CONSENT_STORAGE_KEY,
  openConsentSettings,
  readConsentChoice,
} from "@/lib/consent";

describe("CookieConsentBar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks an undecided visitor and links the privacy policy", async () => {
    render(<CookieConsentBar />);

    expect(
      await screen.findByRole("region", { name: "Your privacy choices" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    ).toBe("/privacy");
    expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Essential only" })).toBeTruthy();
  });

  it("records acceptance and hides", async () => {
    render(<CookieConsentBar />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept all" }));

    expect(readConsentChoice()).toBe("granted");
    expect(
      window.localStorage.getItem(CONSENT_STORAGE_KEY),
    ).toBe("granted");
    expect(
      screen.queryByRole("region", { name: "Your privacy choices" }),
    ).toBeNull();
  });

  it("records refusal and hides", async () => {
    render(<CookieConsentBar />);
    fireEvent.click(await screen.findByRole("button", { name: "Essential only" }));

    expect(readConsentChoice()).toBe("denied");
    expect(
      screen.queryByRole("region", { name: "Your privacy choices" }),
    ).toBeNull();
  });

  it("stays hidden for a visitor who already decided", () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
    render(<CookieConsentBar />);
    expect(
      screen.queryByRole("region", { name: "Your privacy choices" }),
    ).toBeNull();
  });

  it("reopens when the footer asks it to, so a choice can be changed", () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<CookieConsentBar />);
    expect(
      screen.queryByRole("region", { name: "Your privacy choices" }),
    ).toBeNull();

    act(() => openConsentSettings());

    expect(
      screen.getByRole("region", { name: "Your privacy choices" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Essential only" }));
    expect(readConsentChoice()).toBe("denied");
  });
});
