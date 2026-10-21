import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredNewsletterCode,
  grantNewsletterCode,
  onNewsletterCodeGranted,
  onNewsletterOfferRequest,
  readStoredNewsletterCode,
  requestNewsletterOffer,
} from "./newsletterOfferChannel";

describe("newsletterOfferChannel", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("lets a shopper ask for the subscribe popup on demand", () => {
    const listener = vi.fn();
    const stop = onNewsletterOfferRequest(listener);

    requestNewsletterOffer();
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    requestNewsletterOffer();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a granted code for the next page load and tells open listeners", () => {
    const listener = vi.fn();
    const stop = onNewsletterCodeGranted(listener);

    grantNewsletterCode("WELCOME59");

    expect(listener).toHaveBeenCalledWith("WELCOME59");
    expect(readStoredNewsletterCode()).toBe("WELCOME59");

    clearStoredNewsletterCode();
    expect(readStoredNewsletterCode()).toBeNull();
    stop();
  });

  it("ignores an empty code", () => {
    grantNewsletterCode(null);
    grantNewsletterCode("   ");

    expect(readStoredNewsletterCode()).toBeNull();
  });
});
