import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

const METHODS = [
  { id: "COD" as const, enabled: true },
  { id: "CARD" as const, enabled: true },
  { id: "GCASH" as const, enabled: false },
  { id: "BPI" as const, enabled: true },
];

describe("PaymentMethodSelector", () => {
  it("lists only the methods the server offers", () => {
    render(
      <PaymentMethodSelector methods={METHODS} value="COD" onChange={() => undefined} />,
    );

    expect(screen.getByTestId("payment-method-cod")).toBeInTheDocument();
    expect(screen.getByTestId("payment-method-card")).toBeInTheDocument();
    expect(screen.getByTestId("payment-method-bpi")).toBeInTheDocument();
    // The server says GCash is off: it is not offered.
    expect(screen.queryByTestId("payment-method-gcash")).toBeNull();
  });

  it("marks the chosen method as selected", () => {
    render(
      <PaymentMethodSelector methods={METHODS} value="CARD" onChange={() => undefined} />,
    );

    expect(screen.getByTestId("payment-method-card")).toBeChecked();
    expect(screen.getByTestId("payment-method-cod")).not.toBeChecked();
  });

  it("reports the method the shopper picks", async () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodSelector methods={METHODS} value="COD" onChange={onChange} />,
    );

    await userEvent.setup().click(screen.getByTestId("payment-method-bpi"));

    expect(onChange).toHaveBeenCalledWith("BPI");
  });

  it("offers nothing when no method is on", () => {
    render(
      <PaymentMethodSelector
        methods={[{ id: "COD", enabled: false }]}
        value="COD"
        onChange={() => undefined}
      />,
    );

    expect(screen.queryByTestId("payment-method-cod")).toBeNull();
  });
});
