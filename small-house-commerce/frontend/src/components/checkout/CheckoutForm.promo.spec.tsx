import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutForm } from "./CheckoutForm";

const apiMock = vi.hoisted(() => ({
  previewPromoCode: vi.fn(),
}));
const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
const draftMock = vi.hoisted(() => ({
  readCheckoutDraft: vi.fn(),
  writeCheckoutDraft: vi.fn(),
}));
const checkoutLinesMock = vi.hoisted(() => vi.fn());
const validationMock = vi.hoisted(() => ({
  validateCheckoutForm: vi.fn(),
  validatePreferredDate: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, previewPromoCode: apiMock.previewPromoCode },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/lib/checkoutDraft", () => draftMock);
vi.mock("./useCheckoutLines", () => ({
  useCheckoutLines: checkoutLinesMock,
}));
vi.mock("@/lib/checkoutValidation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/checkoutValidation")>(
    "@/lib/checkoutValidation",
  );
  return {
    ...actual,
    validateCheckoutForm: validationMock.validateCheckoutForm,
    validatePreferredDate: validationMock.validatePreferredDate,
  };
});
const siteSettingsMock = vi.hoisted(() => ({
  current: {
    messengerUrl: null as string | null,
    supportEmail: "help@example.com",
    supportHours: "Mon-Fri",
    newsletterOfferAvailable: false,
    newsletterOfferTitle: "",
  },
}));
vi.mock("@/components/site/SiteSettingsProvider", () => ({
  useSiteSettings: () => siteSettingsMock.current,
}));
vi.mock("./PsgcAddressSelects", () => ({
  PsgcAddressSelects: () => null,
}));
vi.mock("@/lib/commerce-events", () => ({
  emitCommerceEvent: vi.fn(),
  initiateCheckoutEvent: vi.fn(() => ({ name: "InitiateCheckout" })),
  INITIATE_CHECKOUT_FIRED_KEY: "test_initiate_checkout",
}));

beforeEach(() => {
  vi.clearAllMocks();
  siteSettingsMock.current = {
    messengerUrl: null,
    supportEmail: "help@example.com",
    supportHours: "Mon-Fri",
    newsletterOfferAvailable: false,
    newsletterOfferTitle: "",
  };
  sessionStorage.clear();
  draftMock.readCheckoutDraft.mockReturnValue(null);
  validationMock.validateCheckoutForm.mockReturnValue({});
  validationMock.validatePreferredDate.mockReturnValue(null);
  checkoutLinesMock.mockReturnValue({
    isBuyNow: false,
    cartLoading: false,
    product: null,
    productError: null,
    cartBlocked: false,
    buyNowMatchedSku: true,
    ready: true,
    lines: [],
    orderItems: [{ skuId: "sku-1", quantity: 1 }],
    totals: {
      compareAtTotal: 100,
      subtotal: 100,
      savings: 0,
      discount: 0,
      total: 100,
    },
    total: 100,
  });
});

describe("CheckoutForm promo code", () => {
  it("carries only a server-approved promo code into the checkout draft", async () => {
    const user = userEvent.setup();
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 10,
      message: "",
    });
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), " save10 ");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(apiMock.previewPromoCode).toHaveBeenCalledWith("save10", 100),
    );

    await user.click(screen.getByTestId("review-order"));
    expect(draftMock.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      undefined,
      "SAVE10",
    );
    expect(routerMock.push).toHaveBeenCalledWith(
      "/checkout/confirm?items=item-1",
    );
  });

  it("blocks review while a promo preview is still pending", async () => {
    let resolve!: (value: {
      valid: boolean;
      discountAmount: number;
      message: string;
    }) => void;
    apiMock.previewPromoCode.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "SAVE10");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const review = screen.getByTestId("review-order");
    expect(review).toBeDisabled();
    await user.click(review);
    expect(draftMock.writeCheckoutDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ valid: true, discountAmount: 10, message: "" });
      await Promise.resolve();
    });
    await waitFor(() => expect(review).toBeEnabled());
  });
});

describe("CheckoutForm totals summary", () => {
  it("prices shipping as free", () => {
    render(<CheckoutForm itemsParam="item-1" />);

    expect(screen.getByText("Shipping").nextElementSibling).toHaveTextContent(
      "Free",
    );
  });

  it("shows the promo discount in the summary and lowers the total", async () => {
    const user = userEvent.setup();
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 10,
      message: "",
    });
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "save10");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByTestId("checkout-promo-discount")).toHaveTextContent(
      "−₱10.00",
    );
    expect(
      screen.getByText("Total (COD)").nextElementSibling,
    ).toHaveTextContent("₱90.00");
  });

  it("drops the promo discount again when the code is cleared", async () => {
    const user = userEvent.setup();
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 10,
      message: "",
    });
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "save10");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByTestId("checkout-promo-discount")).toBeTruthy();

    await user.clear(screen.getByLabelText("Promo code"));
    await user.type(screen.getByLabelText("Promo code"), "x");

    expect(screen.queryByTestId("checkout-promo-discount")).toBeNull();
    expect(
      screen.getByText("Total (COD)").nextElementSibling,
    ).toHaveTextContent("₱100.00");
  });

  it("shows the configured subscribe offer beneath the promo field", () => {
    siteSettingsMock.current = {
      messengerUrl: null,
      supportEmail: "help@example.com",
      supportHours: "Mon-Fri",
      newsletterOfferAvailable: true,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    };
    render(<CheckoutForm itemsParam="item-1" />);

    expect(screen.getByTestId("newsletter-offer-prompt")).toHaveTextContent(
      "Subscribe and get ₱99 off your first order",
    );
  });

  it("hides the subscribe offer when the backend has no live promo code", () => {
    siteSettingsMock.current = {
      messengerUrl: null,
      supportEmail: "help@example.com",
      supportHours: "Mon-Fri",
      newsletterOfferAvailable: false,
      newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
    };
    render(<CheckoutForm itemsParam="item-1" />);

    expect(screen.queryByTestId("newsletter-offer-prompt")).toBeNull();
  });
});
