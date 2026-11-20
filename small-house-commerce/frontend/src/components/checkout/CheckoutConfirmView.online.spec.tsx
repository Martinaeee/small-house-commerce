import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, Product } from "@/lib/api";
import { CheckoutConfirmView } from "./CheckoutConfirmView";
import { clearPaymentSession, readPaymentSession } from "@/lib/paymentSession";

/**
 * The online payment path of the confirmation step: the chosen method rides
 * in the payload, and an online order does not end on the success page — the
 * shopper still has to pay.
 */

const apiMock = vi.hoisted(() => ({
  getProductBySlug: vi.fn(),
  createOrder: vi.fn(),
  checkoutAttemptStatus: vi.fn(),
  previewPromoCode: vi.fn(),
  getPaymentMethods: vi.fn(),
}));
vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), api: apiMock }));
const eventsMock = vi.hoisted(() => ({
  recordSubmitAttempt: vi.fn(),
  recordSubmitFailure: vi.fn(),
  checkoutFailureReason: vi.fn(() => "STOCK"),
  clearSubmitAttempt: vi.fn(),
}));
vi.mock("@/lib/checkout-events", () => eventsMock);

const useCartMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/cart/CartContext", () => ({ useCart: useCartMock }));

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const draftMock = vi.hoisted(() => ({
  readCheckoutDraft: vi.fn(),
  clearCheckoutDraft: vi.fn(),
  checkoutDraftStorageBlocked: vi.fn(() => false),
}));
vi.mock("@/lib/checkoutDraft", () => draftMock);

const consentMock = vi.hoisted(() => ({ hasAdsConsent: vi.fn(() => false) }));
vi.mock("@/lib/consent", () => ({ hasAdsConsent: consentMock.hasAdsConsent }));

const product: Product = {
  id: "product-1",
  name: "Chair",
  slug: "chair",
  description: null,
  tagline: null,
  categoryId: "category-1",
  ratingAverage: null,
  reviewCount: 0,
  room: null,
  internalRole: null,
  solutions: [],
  width: null,
  height: null,
  depth: null,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  catalogGraphVersion: 7,
  options: [],
  defaultDisplayVariantId: "red-small",
  effectiveCoverMedia: {
    id: "cover",
    url: "/cover.jpg",
    type: "IMAGE",
    altText: "Cover",
    sortOrder: 0,
  },
  images: [],
  variants: [
    {
      id: "red-small",
      name: "Red / Small",
      position: 0,
      combinationKey: "color:red",
      optionValueIds: ["red"],
      sku: {
        id: "sku-red-small",
        skuCode: "RED-SMALL",
        status: "ACTIVE",
        price: 100,
        compareAtPrice: 130,
        availableInventory: 4,
      },
    },
  ],
} as unknown as Product;

function item(): CartItem {
  return {
    itemId: "item-1",
    skuId: "sku-red-small",
    skuCode: "RED-SMALL",
    productName: "Chair",
    productSlug: "chair",
    variantName: "Red / Small",
    quantity: 1,
    unitPrice: 100,
    compareAtPrice: 130,
    lineTotal: 100,
    availableInventory: 4,
    unavailable: false,
    optionValues: [],
    thumbnail: {
      url: "/red-thumb.jpg",
      type: "IMAGE",
      altText: "Red chair",
      resolvedScope: "OPTION_VALUE",
    },
  } as unknown as CartItem;
}

function draft(paymentMethod: string | undefined) {
  return {
    customer: {
      name: "Juan Dela Cruz",
      phone: "0917 123 4567",
      province: "Metro Manila",
      city: "Quezon City",
      barangay: "Diliman",
      postalCode: "1100",
      streetAddress: "123 Test Street",
      landmark: "",
    },
    savedAt: "2026-09-22T00:00:00.000Z",
    preferredDeliveryDate: null,
    ...(paymentMethod ? { paymentMethod } : {}),
  };
}

const assignMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  assignMock.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: assignMock, href: "https://luwag.shop/checkout/confirm" },
  });
  consentMock.hasAdsConsent.mockReturnValue(false);
  useCartMock.mockReturnValue({ removeItems: vi.fn().mockResolvedValue(undefined) });
  apiMock.getProductBySlug.mockResolvedValue(product);
  apiMock.checkoutAttemptStatus.mockResolvedValue({ state: "PENDING" });
  apiMock.getPaymentMethods.mockResolvedValue({
    codEnabled: true,
    revision: 1,
    methods: [
      { id: "COD", enabled: true },
      { id: "CARD", enabled: true },
      { id: "GCASH", enabled: true },
      { id: "BPI", enabled: false },
    ],
  });
  draftMock.readCheckoutDraft.mockReturnValue(draft("GCASH"));
  // The session lives in a module-level variable: each test starts empty.
  clearPaymentSession();
  sessionStorage.clear();
  localStorage.clear();
});

describe("CheckoutConfirmView online payment", () => {
  it("submits the chosen payment method in the payload", async () => {
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
      payment: {
        attemptId: "attempt-1",
        channel: "gcash",
        env: "test",
        payUrl: "https://test.xunhuiacq.com/b2c-cashier/#/cashier?key=abc",
      },
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalled());
    expect(apiMock.createOrder.mock.calls[0]![0].paymentMethod).toBe("GCASH");
  });

  it("sends the shopper to the gateway instead of the success page", async () => {
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
      payment: {
        attemptId: "attempt-1",
        channel: "gcash",
        env: "test",
        payUrl: "https://test.xunhuiacq.com/b2c-cashier/#/cashier?key=abc",
      },
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(
        "https://test.xunhuiacq.com/b2c-cashier/#/cashier?key=abc",
      ),
    );
    expect(routerMock.push).not.toHaveBeenCalledWith("/order-success/PH3001");
  });

  it("keeps the card session in memory and waits on the payment page", async () => {
    draftMock.readCheckoutDraft.mockReturnValue(draft("CARD"));
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3002",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
      payment: {
        attemptId: "attempt-2",
        channel: "card",
        env: "production",
        paySession: "ps_secret",
      },
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/payment-return/PH3002"),
    );
    expect(readPaymentSession()).toEqual({
      paySession: "ps_secret",
      env: "production",
      orderNumber: "PH3002",
    });
    // The session is never written to the browser's storage.
    expect(sessionStorage.getItem("luwag_pay_session")).toBeNull();
  });

  it("waits on the payment page when the attempt has no session yet", async () => {
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3003",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
      payment: { attemptId: "attempt-3", channel: "gcash", env: "test" },
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/payment-return/PH3003"),
    );
    expect(readPaymentSession()).toBeNull();
  });

  it("asks the shopper to choose again when the method was switched off", async () => {
    apiMock.getPaymentMethods.mockResolvedValue({
      codEnabled: true,
      revision: 2,
      methods: [
        { id: "COD", enabled: true },
        { id: "GCASH", enabled: false },
      ],
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    expect(await screen.findByTestId("confirm-payment-method-closed")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-place-order")).toBeDisabled();
  });

  it("keeps the cash order on the success page", async () => {
    draftMock.readCheckoutDraft.mockReturnValue(draft(undefined));
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3004",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH3004"),
    );
    expect(apiMock.createOrder.mock.calls[0]![0].paymentMethod).toBe("COD");
  });
});
