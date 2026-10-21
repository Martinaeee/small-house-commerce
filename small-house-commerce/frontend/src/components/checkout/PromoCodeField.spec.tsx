import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { PromoCodeField } from "./PromoCodeField";
import {
  grantNewsletterCode,
} from "@/components/newsletter/newsletterOfferChannel";

describe("PromoCodeField", () => {
  beforeEach(() => {
    vi.spyOn(api, "previewPromoCode");
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function open() {
    fireEvent.click(screen.getByRole("button", { name: "Have a promo code?" }));
  }

  it("reports the discount for a valid code", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 25,
      message: "",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={250} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: " welcome10 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
        /save/i,
      ),
    );
    expect(api.previewPromoCode).toHaveBeenCalledWith("welcome10", 250);
    expect(onApplied).toHaveBeenCalledWith({
      code: "WELCOME10",
      discountAmount: 25,
    });
  });

  it("surfaces the server reason and clears any earlier discount", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: false,
      discountAmount: 0,
      message: "This promo code has expired.",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={250} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "OLD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
        "This promo code has expired.",
      ),
    );
    expect(onApplied).toHaveBeenCalledWith(null);
  });

  it("asks for a code without calling the API when the field is empty", async () => {
    render(<PromoCodeField subtotal={250} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
        /enter a code/i,
      ),
    );
    expect(api.previewPromoCode).not.toHaveBeenCalled();
  });

  it("revalidates a promo code restored after mount", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 25,
      message: "",
    });
    const onApplied = vi.fn();

    const { rerender } = render(
      <PromoCodeField subtotal={250} initialCode="" onApplied={onApplied} />,
    );
    rerender(
      <PromoCodeField
        subtotal={250}
        initialCode=" welcome10 "
        onApplied={onApplied}
      />,
    );

    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith({
        code: "WELCOME10",
        discountAmount: 25,
      }),
    );
    expect(api.previewPromoCode).toHaveBeenCalledWith("welcome10", 250);

    open();
    expect(screen.getByLabelText("Promo code")).toHaveValue(" welcome10 ");
  });

  it("revalidates an initial code under React Strict Mode", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 25,
      message: "",
    });
    const onApplied = vi.fn();

    render(
      <StrictMode>
        <PromoCodeField
          subtotal={250}
          initialCode="SAVE10"
          onApplied={onApplied}
        />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith({
        code: "SAVE10",
        discountAmount: 25,
      }),
    );
    expect(api.previewPromoCode).toHaveBeenCalledWith("SAVE10", 250);
  });

  it("clears an applied promo as soon as the shopper edits its code", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 25,
      message: "",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={250} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "WELCOME10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onApplied).toHaveBeenLastCalledWith({
        code: "WELCOME10",
        discountAmount: 25,
      }),
    );

    onApplied.mockClear();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "" },
    });

    expect(onApplied).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(api.previewPromoCode).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenLastCalledWith(null);
  });

  it("ignores an older preview response that resolves after a newer code", async () => {
    let resolveOld!: (value: {
      valid: boolean;
      discountAmount: number;
      message: string;
    }) => void;
    let resolveNew!: typeof resolveOld;
    vi.mocked(api.previewPromoCode)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={250} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "OLD10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "NEW10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    resolveNew({
      valid: false,
      discountAmount: 0,
      message: "This promo code has expired.",
    });
    await waitFor(() =>
      expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
        "This promo code has expired.",
      ),
    );
    resolveOld({ valid: true, discountAmount: 25, message: "" });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
      "This promo code has expired.",
    );
    expect(onApplied).toHaveBeenLastCalledWith(null);
  });

  it("rechecks the current code for a changed subtotal without clearing the input", async () => {
    vi.mocked(api.previewPromoCode)
      .mockResolvedValueOnce({ valid: true, discountAmount: 10, message: "" })
      .mockResolvedValueOnce({ valid: true, discountAmount: 20, message: "" });
    const onApplied = vi.fn();

    const { rerender } = render(
      <PromoCodeField subtotal={100} onApplied={onApplied} />,
    );
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onApplied).toHaveBeenLastCalledWith({
        code: "SAVE10",
        discountAmount: 10,
      }),
    );

    rerender(<PromoCodeField subtotal={200} onApplied={onApplied} />);

    await waitFor(() =>
      expect(api.previewPromoCode).toHaveBeenLastCalledWith("SAVE10", 200),
    );
    expect(screen.getByLabelText("Promo code")).toHaveValue("SAVE10");
    expect(onApplied).toHaveBeenLastCalledWith({
      code: "SAVE10",
      discountAmount: 20,
    });
  });

  it("reports preview activity so checkout cannot advance mid-request", async () => {
    let resolve!: (value: {
      valid: boolean;
      discountAmount: number;
      message: string;
    }) => void;
    vi.mocked(api.previewPromoCode).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onCheckingChange = vi.fn();

    render(
      <PromoCodeField
        subtotal={250}
        onCheckingChange={onCheckingChange}
      />,
    );
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onCheckingChange).toHaveBeenLastCalledWith(true);

    resolve({ valid: true, discountAmount: 25, message: "" });
    await waitFor(() =>
      expect(onCheckingChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("applies a code granted by a subscription while the field is open", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 59,
      message: "",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={2500} onApplied={onApplied} />);
    act(() => {
      grantNewsletterCode("WELCOME59");
    });

    await waitFor(() =>
      expect(api.previewPromoCode).toHaveBeenCalledWith("WELCOME59", 2500),
    );
    expect(onApplied).toHaveBeenCalledWith({
      code: "WELCOME59",
      discountAmount: 59,
    });
    expect(screen.getByLabelText("Promo code")).toHaveValue("WELCOME59");
  });

  it("applies a code granted on an earlier page load", async () => {
    grantNewsletterCode("WELCOME59");
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 59,
      message: "",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={2500} onApplied={onApplied} />);

    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith({
        code: "WELCOME59",
        discountAmount: 59,
      }),
    );
  });

  it("keeps a code the shopper typed themselves", async () => {
    vi.mocked(api.previewPromoCode).mockResolvedValue({
      valid: true,
      discountAmount: 20,
      message: "",
    });
    const onApplied = vi.fn();

    render(<PromoCodeField subtotal={250} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Promo code"), {
      target: { value: "SAVE10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith({
        code: "SAVE10",
        discountAmount: 20,
      }),
    );

    act(() => {
      grantNewsletterCode("WELCOME59");
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Promo code")).toHaveValue("SAVE10"),
    );
    expect(onApplied).toHaveBeenLastCalledWith({
      code: "SAVE10",
      discountAmount: 20,
    });
  });
});