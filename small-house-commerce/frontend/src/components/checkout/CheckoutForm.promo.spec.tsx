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
vi.mock("@/components/site/SiteSettingsProvider", () => ({
  useSiteSettings: () => ({
    messengerUrl: null,
    supportEmail: "help@example.com",
    supportHours: "Mon-Fri",
  }),
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
