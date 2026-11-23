import { describe, expect, it } from "vitest";
import { paymentMethodLabel } from "./columns";

/**
 * The payment column reads the method, never the status: an online order
 * shows the channel it is paid through even while its payment is still
 * pending or has failed.
 */
describe("paymentMethodLabel", () => {
  it("names the online channel of a paid SUNRATE order", () => {
    expect(
      paymentMethodLabel({ paymentMethod: "SUNRATE", paymentChannel: "gcash" }),
    ).toBe("GCash");
    expect(
      paymentMethodLabel({ paymentMethod: "SUNRATE", paymentChannel: "card" }),
    ).toBe("Card");
    expect(
      paymentMethodLabel({ paymentMethod: "SUNRATE", paymentChannel: "bpi" }),
    ).toBe("BPI");
  });

  it("reads an online order without a channel as an online payment, never as cash", () => {
    expect(
      paymentMethodLabel({ paymentMethod: "SUNRATE", paymentChannel: null }),
    ).toBe("Online");
  });

  it("reads a cash order as COD", () => {
    expect(paymentMethodLabel({ paymentMethod: "COD", paymentChannel: null })).toBe("COD");
  });

  it("reads an order without a payment record as unknown", () => {
    expect(paymentMethodLabel({ paymentMethod: null, paymentChannel: null })).toBe(
      "Unknown",
    );
  });
});
