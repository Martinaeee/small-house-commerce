import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, Product } from "@/lib/api";
import { CheckoutConfirmView } from "./CheckoutConfirmView";
import { ApiTimeoutError } from "@/lib/api";
import {
  ATTEMPT_POLL_INTERVAL_MS,
  PLACE_ORDER_RECOVERY_WINDOW_MS,
  beginCheckoutSubmission,
} from "@/lib/checkout-submission";
import { checkoutQueryString } from "./checkoutItems";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";

/**
 * Confirmation-step contract tests (plan Task 18): checkout lines render
 * their structured option pairs and enriched thumbnail, and selections that
 * never resolved to real, available SKUs are blocked from confirmation —
 * the same dead ends the form page enforces, mirrored before PLACE COD
 * ORDER can fire. The hook runs for real; only the module boundaries
 * (api client, cart context, router, draft storage) are mocked.
 */

const apiMock = vi.hoisted(() => ({
  getProductBySlug: vi.fn(),
  createOrder: vi.fn(),
  checkoutAttemptStatus: vi.fn(),
  previewPromoCode: vi.fn(),
}));
vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), api: apiMock }));
const eventsMock = vi.hoisted(() => ({
  recordSubmitAttempt: vi.fn(), recordSubmitFailure: vi.fn(),
  checkoutFailureReason: vi.fn(() => "STOCK"), clearSubmitAttempt: vi.fn(),
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

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};

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
  options: [
    {
      id: "color",
      kind: "COLOR",
      name: "Color",
      position: 0,
      presentation: "SWATCH",
      isMediaDriver: true,
      values: [
        { id: "red", label: "Red", position: 0, swatchHex: "#ff0000", thumbnailUrl: "/red-thumb.jpg", thumbnailAlt: "Red fabric" },
        { id: "blue", label: "Blue", position: 1, swatchHex: "#0000ff", thumbnailUrl: null, thumbnailAlt: null },
      ],
    },
    {
      id: "size",
      kind: "SIZE",
      name: "Size",
      position: 1,
      presentation: "TEXT",
      isMediaDriver: false,
      values: [
        { id: "small", label: "Small", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "large", label: "Large", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ],
    },
  ],
  defaultDisplayVariantId: "red-small",
  effectiveCoverMedia: cover,
  images: [],
  variants: [
    {
      id: "red-small",
      name: "Red / Small",
      position: 0,
      combinationKey: "color:red|size:small",
      optionValueIds: ["red", "small"],
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
};

function item(overrides: Partial<CartItem> = {}): CartItem {
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
    optionValues: [
      { optionId: "color", optionName: "Color", optionValueId: "red", label: "Red" },
      { optionId: "size", optionName: "Size", optionValueId: "small", label: "Small" },
    ],
    thumbnail: {
      url: "/red-thumb.jpg",
      type: "IMAGE",
      altText: "Red chair",
      resolvedScope: "OPTION_VALUE",
    },
    ...overrides,
  };
}

const validDraft = {
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
};

function storedIdempotencyKeys(): string[] {
  return Object.keys(window.sessionStorage).filter((key) =>
    key.startsWith("luwag_checkout_idem:"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  consentMock.hasAdsConsent.mockReturnValue(false);
  useCartMock.mockReturnValue({
    removeItems: vi.fn().mockResolvedValue(undefined),
  });
  draftMock.readCheckoutDraft.mockReturnValue(validDraft);
  apiMock.checkoutAttemptStatus.mockResolvedValue({ state: "PENDING" });
  sessionStorage.clear();
  localStorage.clear();
});

describe("CheckoutConfirmView order notes", () => {
  it("records a failed submit with the actual key and customer snapshot", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    // A 4xx answer proves the backend created nothing for this attempt; only
    // that outcome is reported as a failure (a timeout or offline error now
    // stays unknown and goes through result recovery instead).
    apiMock.createOrder.mockRejectedValueOnce(
      Object.assign(new Error("Insufficient stock"), {
        status: 422,
        code: "INSUFFICIENT_STOCK",
      }),
    );
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(eventsMock.recordSubmitFailure).toHaveBeenCalled());
    expect(eventsMock.recordSubmitAttempt).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("luwag_support_order_completed")).toBeNull();
    expect(eventsMock.recordSubmitFailure).toHaveBeenCalledWith(expect.objectContaining({
      step: "confirm", reason: "STOCK", idempotencyKey: apiMock.createOrder.mock.calls[0][0].idempotencyKey,
      customer: expect.objectContaining(validDraft.customer),
    }));
  });
  it("reuses one idempotency key and consent snapshot when a timed-out submission is retried", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({
        orderNumber: "PH2001",
        orderStatus: "NEW",
        confirmationStatus: "UNCONFIRMED",
        grandTotal: 100,
      });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    const button = await screen.findByTestId("confirm-place-order");
    await userEvent.setup().click(button);
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(1));
    // The timeout keeps the attempt: the retry must replay the original order
    // under both the same key and the same submit-time consent.
    expect(storedIdempotencyKeys()).toHaveLength(1);
    consentMock.hasAdsConsent.mockReturnValue(true);
    await userEvent.setup().click(button);
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));

    const first = apiMock.createOrder.mock.calls[0]![0];
    const second = apiMock.createOrder.mock.calls[1]![0];
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,120}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.metaConsent).toBe(false);
    expect(second.metaConsent).toBe(false);
    const purchasePayload = JSON.parse(
      sessionStorage.getItem("luwag_purchase_payload")!,
    );
    expect(purchasePayload.consent).toBe(false);
    // The successful retry ends the attempt and clears the stored key.
    expect(storedIdempotencyKeys()).toHaveLength(0);
  });

  it("keeps the key when the submission fails and does not clear it", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockRejectedValueOnce(new Error("409: already submitted"));
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    const button = await screen.findByTestId("confirm-place-order");
    await userEvent.setup().click(button);
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(1));

    const key = apiMock.createOrder.mock.calls[0]![0].idempotencyKey;
    expect(storedIdempotencyKeys()).toHaveLength(1);
    expect(
      JSON.parse(sessionStorage.getItem(storedIdempotencyKeys()[0]!)!),
    ).toEqual({ key, metaConsent: false });
  });

  it("does not carry a failed selection's key into a different selection", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ orderNumber: "PH2002", grandTotal: 100 });
    const view = render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(1));

    // Same confirm route, new quantity: the in-memory retry key belongs to the
    // old scope and must not leak into the new checkout.
    view.rerender(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));

    const firstKey = apiMock.createOrder.mock.calls[0]![0].idempotencyKey;
    const secondKey = apiMock.createOrder.mock.calls[1]![0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("clears the Buy Now key only after success so the next purchase gets a new key", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder
      .mockResolvedValueOnce({ orderNumber: "PH2001", grandTotal: 100 })
      .mockResolvedValueOnce({ orderNumber: "PH2002", grandTotal: 100 });
    const first = render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    const firstKey = apiMock.createOrder.mock.calls[0]![0].idempotencyKey;
    // Clearing the key must not consume the success-page Purchase snapshot.
    expect(sessionStorage.getItem("luwag_purchase_payload")).not.toBeNull();
    expect(storedIdempotencyKeys()).toHaveLength(0);
    first.unmount();

    // A second purchase from the same Buy Now scope must create a new key.
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));
    const secondKey = apiMock.createOrder.mock.calls[1]![0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("clears the Quick COD key after success so the next purchase gets a new key", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder
      .mockResolvedValueOnce({ orderNumber: "PH2001", grandTotal: 100 })
      .mockResolvedValueOnce({ orderNumber: "PH2002", grandTotal: 100 });
    draftMock.readCheckoutDraft.mockReturnValue({
      ...validDraft,
      selection: {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "?aid=aid-123",
        items: [{ skuId: "sku-red-small", quantity: 1 }],
      },
    });
    const first = render(<CheckoutConfirmView />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    const firstKey = apiMock.createOrder.mock.calls[0]![0].idempotencyKey;
    expect(storedIdempotencyKeys()).toHaveLength(0);
    first.unmount();

    render(<CheckoutConfirmView />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));
    const secondKey = apiMock.createOrder.mock.calls[1]![0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("clears the cart key after success so the next purchase gets a new key", async () => {
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems: vi.fn().mockResolvedValue(undefined),
    });
    apiMock.createOrder
      .mockResolvedValueOnce({ orderNumber: "PH2001", grandTotal: 100 })
      .mockResolvedValueOnce({ orderNumber: "PH2002", grandTotal: 100 });
    const first = render(<CheckoutConfirmView itemsParam="item-1" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    const firstKey = apiMock.createOrder.mock.calls[0]![0].idempotencyKey;
    expect(storedIdempotencyKeys()).toHaveLength(0);
    first.unmount();

    render(<CheckoutConfirmView itemsParam="item-1" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));
    const secondKey = apiMock.createOrder.mock.calls[1]![0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("shows the order note and submits it with the order", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "PENDING",
      grandTotal: 100,
    });
    draftMock.readCheckoutDraft.mockReturnValue({
      ...validDraft,
      customerNote: "Please call before delivery",
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    expect(await screen.findByTestId("confirm-notes")).toHaveTextContent(
      "Order notes: Please call before delivery",
    );

    await userEvent
      .setup()
      .click(screen.getByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(apiMock.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          customerNote: "Please call before delivery",
        }),
      ),
    );
  });

  it("sends no note when the shopper left it empty", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "PENDING",
      grandTotal: 100,
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent
      .setup()
      .click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(apiMock.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ customerNote: null }),
      ),
    );
  });
});

describe("CheckoutConfirmView", () => {
  it("submits a valid stored marketing credential at the order root", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "PENDING",
      grandTotal: 100,
    });
    localStorage.setItem("sh:marketing-touch", JSON.stringify({
      credential: "server.credential",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        marketingCredential: "server.credential",
        attribution: { sourceType: "ORGANIC" },
        items: [{ skuId: "sku-red-small", quantity: 1 }],
      }),
    ));
  });
  it("clears the revealed subscribe code once the order is placed", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    localStorage.setItem("luwag_newsletter_promo_code", "WELCOME59");

    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await screen.findByText("Confirm your order");
    await userEvent.setup().click(screen.getByTestId("confirm-place-order"));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    // The code is spent with this order; a later order must not inherit it.
    expect(localStorage.getItem("luwag_newsletter_promo_code")).toBeNull();
  });

  it("blocks confirmation when the Buy Now skuId matches no variant of its product", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(<CheckoutConfirmView skuId="sku-unknown" qty="1" slug="chair" />);

    expect(await screen.findByText("We couldn't confirm this order.")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-place-order")).toBeNull();
    // A dead end stays put — it must not bounce to the form page.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("blocks confirmation when the cart selection contains unavailable items", async () => {
    useCartMock.mockReturnValue({
      cart: { items: [item({ unavailable: true })] },
      loading: false,
      removeItems: vi.fn().mockResolvedValue(undefined),
    });
    render(<CheckoutConfirmView itemsParam="item-1" />);

    expect(await screen.findByText("We couldn't confirm this order.")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-place-order")).toBeNull();
  });

  it("navigates to success while the cart cleanup is still pending", async () => {
    let finishCleanup!: () => void;
    const cleanupPending = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const removeItems = vi.fn(() => cleanupPending);
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems,
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    const view = render(<CheckoutConfirmView itemsParam="item-1" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(removeItems).toHaveBeenCalled());
    expect(sessionStorage.getItem("luwag_support_order_completed")).toBe("1");

    // F02: the order exists; the success page must not wait on a slow or hung
    // cart cleanup. Cleanup may then empty the selection in the background.
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    useCartMock.mockReturnValue({
      cart: { items: [] },
      loading: false,
      removeItems,
    });
    view.rerender(<CheckoutConfirmView itemsParam="item-1" />);

    finishCleanup();
  });

  it("retries a failed cart cleanup without creating a second order", async () => {
    const removeItems = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cart cleanup failed"))
      .mockResolvedValue(undefined);
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems,
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    render(<CheckoutConfirmView itemsParam="item-1" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    await waitFor(() => expect(removeItems).toHaveBeenCalledTimes(2));
    expect(apiMock.createOrder).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after a bounded number of attempts and keeps the order", async () => {
    const removeItems = vi.fn().mockRejectedValue(new Error("Cart cleanup failed"));
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems,
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    render(<CheckoutConfirmView itemsParam="item-1" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    await waitFor(() => expect(removeItems).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(apiMock.createOrder).toHaveBeenCalledTimes(1);
  });

  it("re-opens the placed order instead of submitting again when the shopper returns to the same confirmation", async () => {
    // Cleanup keeps failing, so the cart still holds the item and the shopper
    // can navigate back to the same confirmation URL. That must never create
    // a second order: the completed-attempt marker redirects to the receipt.
    const removeItems = vi.fn().mockRejectedValue(new Error("Cart cleanup failed"));
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems,
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    const first = render(<CheckoutConfirmView itemsParam="item-1" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"));
    // Cleanup exhausts its retries and leaves the cart intact: the marker
    // stays, because this URL still describes a resubmittable purchase.
    await waitFor(() => expect(removeItems).toHaveBeenCalledTimes(3));
    first.unmount();

    render(<CheckoutConfirmView itemsParam="item-1" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith("/order-success/PH2001"),
    );
    expect(apiMock.createOrder).toHaveBeenCalledTimes(1);
  });

  it("navigates to success when cart cleanup fails after order creation", async () => {
    useCartMock.mockReturnValue({
      cart: { items: [item()] },
      loading: false,
      removeItems: vi.fn().mockRejectedValue(new Error("Cart cleanup failed")),
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 100 });
    render(<CheckoutConfirmView itemsParam="item-1" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("luwag_support_order_completed")).toBe("1");
  });

  it("renders the confirm UI with the resolved Buy Now selection", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);

    expect(await screen.findByText("Confirm your order")).toBeInTheDocument();
    // Structured option pairs from the product graph, the enriched cover
    // thumbnail, and an enabled PLACE COD ORDER.
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Chair");
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Color: Red · Size: Small");
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Qty 2");
    expect(screen.getByAltText("Cover")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-place-order")).toBeEnabled();
  });

  it("posts the order only once when final confirmation is triggered twice in the same tick", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockImplementation(() => new Promise(() => {}));
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    const submit = await screen.findByTestId("confirm-place-order");
    await act(async () => {
      submit.click();
      submit.click();
      await Promise.resolve();
    });

    expect(apiMock.createOrder).toHaveBeenCalledTimes(1);
  });

  it("reviews and submits every PDP inline item through the existing confirmation step", async () => {
    const user = userEvent.setup();
    const removeItems = vi.fn().mockResolvedValue(undefined);
    useCartMock.mockReturnValue({ cart: null, loading: false, removeItems });
    const directProduct: Product = {
      ...product,
      variants: [
        product.variants[0],
        {
          id: "blue-large",
          name: "Blue / Large",
          position: 1,
          combinationKey: "color:blue|size:large",
          optionValueIds: ["blue", "large"],
          sku: {
            id: "sku-blue-large",
            skuCode: "BLUE-LARGE",
            status: "ACTIVE",
            price: 120,
            compareAtPrice: 150,
            availableInventory: 6,
          },
        },
      ],
    };
    apiMock.getProductBySlug.mockResolvedValue(directProduct);
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001", grandTotal: 340 });
    draftMock.readCheckoutDraft.mockReturnValue({
      ...validDraft,
      selection: {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "?aid=aid-123&utm_source=facebook",
        items: [
          { skuId: "sku-red-small", quantity: 1 },
          { skuId: "sku-blue-large", quantity: 2 },
        ],
      },
    });

    render(<CheckoutConfirmView />);

    expect(await screen.findByText("Confirm your order")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("confirm-items")).toHaveTextContent(
        "Color: Red · Size: Small",
      ),
    );
    expect(screen.getByTestId("confirm-items")).toHaveTextContent(
      "Color: Blue · Size: Large",
    );
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Qty 2");
    expect(
      screen.getAllByRole("link", { name: "Edit" })[0],
    ).toHaveAttribute(
      "href",
      "/products/chair?aid=aid-123&utm_source=facebook#quick-cod-order",
    );

    await user.click(screen.getByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(apiMock.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            { skuId: "sku-red-small", quantity: 1 },
            { skuId: "sku-blue-large", quantity: 2 },
          ],
        }),
      ),
    );
    expect(removeItems).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001");
  });

  it("applies only the discount returned by the server promo preview", async () => {
    const user = userEvent.setup();
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 59,
      message: "Promo code applied.",
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    await screen.findByText("Confirm your order");

    // The subtotal shows the original reference price; the saving row below
    // subtracts it, so the rows add up to the total.
    const totals = screen.getByText("Subtotal").closest("dl");
    expect(totals).not.toBeNull();
    expect(within(totals!).getByText("₱260.00")).toBeInTheDocument(); // 130 × 2 compare-at
    expect(within(totals!).getByTestId("confirm-subtotal-compare")).not.toHaveClass(
      "line-through",
    );
    expect(within(totals!).getByText("You save")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "welcome59");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(apiMock.previewPromoCode).toHaveBeenCalledWith("welcome59", 200),
    );
    expect(await screen.findByTestId("confirm-promo-discount")).toHaveTextContent(
      "−₱59.00",
    );
    expect(screen.getByText("Total (COD)").nextElementSibling).toHaveTextContent(
      "₱141.00",
    );
  });

  it("stashes the server's final grand total, not the checkout preview, for Purchase", async () => {
    const user = userEvent.setup();
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 137,
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    expect(await screen.findByText("Confirm your order")).toBeInTheDocument();

    // The preview is 2 × ₱100 = ₱200; the server's authoritative final total
    // deliberately differs (for example, the promo cap applied in the order
    // transaction). The success-page Purchase must use the server amount.
    await user.click(screen.getByTestId("confirm-place-order"));
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"),
    );

    const payload = JSON.parse(sessionStorage.getItem("luwag_purchase_payload")!);
    expect(payload.eventId).toBe("purchase-PH2001");
    expect(payload.data).toEqual({
      content_type: "product",
      order_id: "PH2001",
      content_ids: ["sku-red-small"],
      contents: [{ id: "sku-red-small", quantity: 2 }],
      value: 137,
      currency: "PHP",
    });
    expect(payload.data.value).not.toBe(200);
    // The same consent value the backend received rides with the payload, so
    // the success page can hold the browser event to the submit-time choice.
    expect(payload.consent).toBe(false);
  });

  it("stashes the submit-time consent snapshot with the Purchase payload", async () => {
    consentMock.hasAdsConsent.mockReturnValue(true);
    const user = userEvent.setup();
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    expect(await screen.findByText("Confirm your order")).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-place-order"));
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH2001"),
    );

    const payload = JSON.parse(sessionStorage.getItem("luwag_purchase_payload")!);
    expect(payload.consent).toBe(true);
    expect(apiMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ metaConsent: true }),
    );
  });
});

describe("CheckoutConfirmView summary details", () => {
  it("prices shipping as free", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await screen.findByText("Confirm your order");

    expect(screen.getByText("Shipping").nextElementSibling).toHaveTextContent(
      "Free",
    );
  });

  it("shows the configured subscribe offer beneath the promo field", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(
      <SiteSettingsProvider
        settings={{
          ...DEFAULT_SITE_SETTINGS,
          newsletterOfferAvailable: true,
          newsletterOfferTitle: "Subscribe and get ₱99 off your first order",
        }}
      >
        <CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />
      </SiteSettingsProvider>,
    );
    await screen.findByText("Confirm your order");

    expect(screen.getByTestId("newsletter-offer-prompt")).toHaveTextContent(
      "₱99",
    );
  });
});

/**
 * F04: a lost or late order response must never be reported as "order
 * failed". The page keeps one durable attempt (key + payload) and asks the
 * backend whether that attempt produced an order before it lets the shopper
 * do anything else.
 */
describe("CheckoutConfirmView result recovery", () => {
  const SCOPE = "/checkout?skuId=sku-red-small&slug=chair";
  const KEY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  function seedSubmission(overrides: Record<string, unknown> = {}) {
    sessionStorage.setItem(
      "luwag_checkout_submission:" + SCOPE,
      JSON.stringify({
        scope: SCOPE,
        idempotencyKey: KEY,
        metaConsent: false,
        attemptId: "attempt-1",
        startedAt: Date.now(),
        payload: {
          customer: validDraft.customer,
          items: [{ skuId: "sku-red-small", quantity: 1 }],
          idempotencyKey: KEY,
          metaConsent: false,
        },
        status: "SUBMITTED",
        ...overrides,
      }),
    );
  }

  it("does not report a network failure as an order failure", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    fireEvent.click(await screen.findByTestId("confirm-place-order"));

    await waitFor(() =>
      expect(screen.getByTestId("confirm-checking")).toBeInTheDocument(),
    );
    expect(eventsMock.recordSubmitFailure).not.toHaveBeenCalled();
    // The local diagnostic carries only the transport kind and status.
    const diagnostic = warn.mock.calls.find(
      ([message]) => message === "[checkout] order outcome unknown",
    )?.[1];
    expect(diagnostic).toEqual({ kind: "NETWORK", httpStatus: null });
    expect(JSON.stringify(diagnostic)).not.toContain(validDraft.customer.phone);
    expect(JSON.stringify(diagnostic)).not.toContain(KEY);
    expect(screen.getByTestId("confirm-place-order")).toBeDisabled();
    warn.mockRestore();
  });

  it("re-opens the order when the attempt already succeeded, without a second submission", async () => {
    apiMock.checkoutAttemptStatus.mockResolvedValue({
      state: "ORDERED",
      orderNumber: "PH3001",
      orderStatus: "NEW",
      grandTotal: 100,
      placedAt: "2026-11-09T06:00:00.000Z",
      items: [{ skuId: "sku-red-small", quantity: 1 }],
    });
    seedSubmission();

    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH3001"),
    );
    expect(apiMock.createOrder).not.toHaveBeenCalled();
    expect(apiMock.checkoutAttemptStatus).toHaveBeenCalledWith(KEY);
    expect(eventsMock.recordSubmitFailure).not.toHaveBeenCalled();
  });

  it("keeps confirming for the recovery window, then offers a retry that replays the same attempt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiMock.getProductBySlug.mockResolvedValue(product);
      apiMock.createOrder.mockRejectedValueOnce(new ApiTimeoutError());

      render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
      fireEvent.click(await screen.findByTestId("confirm-place-order"));

      await waitFor(() =>
        expect(screen.getByTestId("confirm-checking")).toBeInTheDocument(),
      );
      // The same key is polled, not a new key minted.
      expect(apiMock.checkoutAttemptStatus).toHaveBeenCalledWith(
        apiMock.createOrder.mock.calls[0]![0].idempotencyKey,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLACE_ORDER_RECOVERY_WINDOW_MS + ATTEMPT_POLL_INTERVAL_MS);
      });

      expect(screen.getByTestId("confirm-unknown")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-place-order")).toHaveTextContent(
        "TRY AGAIN",
      );
      // A timeout is never recorded as a failure.
      expect(eventsMock.recordSubmitFailure).not.toHaveBeenCalled();

      apiMock.createOrder.mockResolvedValueOnce({
        orderNumber: "PH3002",
        orderStatus: "NEW",
        confirmationStatus: "UNCONFIRMED",
        grandTotal: 100,
      });
      fireEvent.click(screen.getByTestId("confirm-place-order"));

      await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(2));
      expect(apiMock.createOrder.mock.calls[1]![0].idempotencyKey).toBe(
        apiMock.createOrder.mock.calls[0]![0].idempotencyKey,
      );
      expect(apiMock.createOrder.mock.calls[1]![0]).toEqual(
        apiMock.createOrder.mock.calls[0]![0],
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/** F05: a blocked browser store must not silently bounce the shopper. */
describe("CheckoutConfirmView storage fallback", () => {
  it("explains the blocked storage instead of redirecting to an empty form", async () => {
    draftMock.readCheckoutDraft.mockReturnValue(null);
    draftMock.checkoutDraftStorageBlocked.mockReturnValue(true);

    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    expect(
      await screen.findByTestId("confirm-storage-blocked"),
    ).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Back to checkout" }),
    ).toHaveAttribute("href", "/checkout?skuId=sku-red-small&slug=chair");
  });
});

/**
 * auto=1 (checkout form PLACE ORDER): the address and the summary were
 * already reviewed on the form, so this page places the order on arrival —
 * once, and never when a durable attempt already exists.
 */
describe("CheckoutConfirmView auto placement", () => {
  it("places the order on arrival instead of asking for a second confirmation", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH3101",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      grandTotal: 100,
    });
    render(
      <CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" autoPlace />,
    );

    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalledTimes(1));
    expect(routerMock.push).toHaveBeenCalledWith("/order-success/PH3101");
    // No review screen is rendered and the submission never re-fires.
    expect(screen.queryByText("Confirm your order")).toBeNull();
    expect(
      screen.getByTestId("confirm-place-order"),
    ).toBeDisabled();
    expect(apiMock.createOrder).toHaveBeenCalledTimes(1);
    expect(eventsMock.recordSubmitAttempt).toHaveBeenCalledTimes(1);
  });

  it("leaves a stored attempt to its recovery path instead of resubmitting", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    const href = `/checkout${checkoutQueryString({
      skuId: "sku-red-small",
      qty: "1",
      slug: "chair",
    })}`;
    beginCheckoutSubmission({
      scope: href,
      idempotencyKey: "stored-auto-key",
      metaConsent: false,
      attemptId: null,
      startedAt: Date.now(),
      payload: {} as never,
    });

    render(
      <CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" autoPlace />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("confirm-place-order")).toBeDisabled(),
    );
    expect(apiMock.createOrder).not.toHaveBeenCalled();
    // The recovery loop polls the read-only attempt status instead.
    expect(apiMock.checkoutAttemptStatus).toHaveBeenCalledWith("stored-auto-key");
  });
});
