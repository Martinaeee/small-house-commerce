import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutForm } from "./CheckoutForm";

/**
 * The payment choice on the form page: the server owns which methods exist,
 * and a shopper must never be told "cash on delivery" when cash on delivery
 * was switched off.
 */

const eventsMock = vi.hoisted(() => ({ recordSubmitAttempt: vi.fn(), recordSubmitFailure: vi.fn() }));
vi.mock("@/lib/checkout-events", () => eventsMock);
const apiMock = vi.hoisted(() => ({
  previewPromoCode: vi.fn(),
  getPaymentMethods: vi.fn(),
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
    api: {
      ...actual.api,
      previewPromoCode: apiMock.previewPromoCode,
      getPaymentMethods: apiMock.getPaymentMethods,
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/lib/checkoutDraft", () => draftMock);
vi.mock("./useCheckoutLines", () => ({ useCheckoutLines: checkoutLinesMock }));
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
vi.mock("./PsgcAddressSelects", () => ({ PsgcAddressSelects: () => null }));
vi.mock("@/lib/commerce-events", () => ({
  emitCommerceEvent: vi.fn(),
  initiateCheckoutEvent: vi.fn(() => ({ name: "InitiateCheckout" })),
  INITIATE_CHECKOUT_FIRED_KEY: "test_initiate_checkout",
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  draftMock.readCheckoutDraft.mockReturnValue(null);
  validationMock.validateCheckoutForm.mockReturnValue({});
  validationMock.validatePreferredDate.mockReturnValue(null);
  apiMock.getPaymentMethods.mockResolvedValue({
    codEnabled: true,
    revision: 1,
    methods: [
      { id: "COD", enabled: true },
      { id: "CARD", enabled: true },
      { id: "GCASH", enabled: false },
      { id: "BPI", enabled: false },
    ],
  });
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
    totals: { compareAtTotal: 100, subtotal: 100, savings: 0, discount: 0, total: 100 },
    total: 100,
  });
});

describe("CheckoutForm payment method", () => {
  it("renders cash on delivery selected by default and lists only the enabled methods", async () => {
    render(<CheckoutForm itemsParam="item-1" />);

    expect(await screen.findByTestId("payment-method-cod")).toBeChecked();
    expect(screen.getByTestId("payment-method-card")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-method-gcash")).toBeNull();
    expect(screen.getByText("Total (COD)")).toBeInTheDocument();
  });

  it("hides cash on delivery and its label when the server switched it off", async () => {
    apiMock.getPaymentMethods.mockResolvedValue({
      codEnabled: false,
      revision: 2,
      methods: [
        { id: "COD", enabled: false },
        { id: "CARD", enabled: true },
      ],
    });
    render(<CheckoutForm itemsParam="item-1" />);

    // The card option only exists once the server answered.
    await waitFor(() =>
      expect(screen.getByTestId("payment-method-card")).toBeInTheDocument(),
    );
    // The total no longer promises cash on delivery.
    await waitFor(() => expect(screen.getByText("Total")).toBeInTheDocument());
    expect(screen.queryByText("Total (COD)")).toBeNull();
    expect(screen.queryByTestId("payment-method-cod")).toBeNull();
  });

  it("disables review and shows a retry hint when the methods cannot be read", async () => {
    apiMock.getPaymentMethods.mockRejectedValue(new Error("offline"));
    render(<CheckoutForm itemsParam="item-1" />);

    expect(await screen.findByTestId("payment-methods-error")).toBeInTheDocument();
    expect(screen.getByTestId("review-order")).toBeDisabled();
  });

  it("carries the chosen payment method into the checkout draft", async () => {
    const user = userEvent.setup();
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(await screen.findByTestId("payment-method-card"));
    await user.click(screen.getByTestId("review-order"));

    expect(draftMock.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      undefined,
      null,
      null,
      "CARD",
    );
  });

  it("retries the methods when the shopper asks for it", async () => {
    apiMock.getPaymentMethods.mockRejectedValueOnce(new Error("offline"));
    render(<CheckoutForm itemsParam="item-1" />);

    expect(await screen.findByTestId("payment-methods-error")).toBeInTheDocument();
    apiMock.getPaymentMethods.mockResolvedValue({
      codEnabled: true,
      revision: 1,
      methods: [{ id: "COD", enabled: true }],
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByTestId("payment-methods-error")).toBeNull());
    expect(screen.getByTestId("review-order")).toBeEnabled();
  });
});
