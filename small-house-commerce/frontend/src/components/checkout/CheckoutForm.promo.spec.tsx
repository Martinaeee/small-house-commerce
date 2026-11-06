import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAutosave, resolveCheckoutAttempt, writeAutosave, type CheckoutAutosaveSnapshot } from "@/lib/checkoutAutosave";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutForm } from "./CheckoutForm";

const eventsMock = vi.hoisted(() => ({ recordSubmitAttempt: vi.fn(), recordSubmitFailure: vi.fn() }));
vi.mock("@/lib/checkout-events", () => eventsMock);
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
  // Checkout autosave keeps its attempt in localStorage across visits; each
  // test must start with an empty tab or a previous note is restored.
  localStorage.clear();
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

afterEach(() => vi.unstubAllGlobals());

const SAVED: CheckoutAutosaveSnapshot = {
  customer: { name: "Ana", phone: "0917", province: "", city: "", barangay: "", postalCode: "", streetAddress: "", landmark: "" },
  items: [{ skuId: "sku-1", quantity: 1 }],
  preferredDeliveryDate: null,
  promoCodeInput: "OLD10",
  promoCodeApplied: null,
  customerNote: "saved note",
};

describe("CheckoutForm autosave restore races", () => {
  it("does not replace a saved draft with the initial blank form while restore is pending", async () => {
    const attempt = resolveCheckoutAttempt("cart:item-1");
    writeAutosave(attempt, 7, SAVED);
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CheckoutForm itemsParam="item-1" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
    expect(readAutosave(attempt)?.snapshot).toEqual(SAVED);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    await act(async () => {
      finish(new Response(JSON.stringify({ revision: 7, snapshot: SAVED }), { status: 200 }));
    });
    expect(await screen.findByDisplayValue("Ana")).toBeInTheDocument();
    view.unmount();
  });

  it("keeps a promo code typed before the restore returns", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const user = userEvent.setup();
    const view = render(<CheckoutForm itemsParam="item-1" />);
    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "MY10");
    await act(async () => {
      finish(new Response(JSON.stringify({ revision: 7, snapshot: SAVED }), { status: 200 }));
    });
    expect(screen.getByLabelText("Promo code")).toHaveValue("MY10");
    view.unmount();
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
      null,
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

describe("CheckoutForm order notes", () => {
  it("carries the trimmed order note into the checkout draft", async () => {
    const user = userEvent.setup();
    render(<CheckoutForm itemsParam="item-1" />);

    await user.type(
      screen.getByTestId("checkout-notes"),
      "  Please call before delivery  ",
    );
    await user.click(screen.getByTestId("review-order"));

    expect(draftMock.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      undefined,
      null,
      "Please call before delivery",
    );
  });

  it("keeps the note optional: a blank note becomes null", async () => {
    const user = userEvent.setup();
    render(<CheckoutForm itemsParam="item-1" />);

    await user.click(screen.getByTestId("review-order"));

    expect(draftMock.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      undefined,
      null,
      null,
    );
  });

  it("limits the note to the 200 characters the order API accepts", () => {
    render(<CheckoutForm itemsParam="item-1" />);
    expect(screen.getByTestId("checkout-notes")).toHaveAttribute(
      "maxlength",
      "200",
    );
  });
});

describe("CheckoutForm totals summary", () => {
  it("prices shipping as free", () => {
    render(<CheckoutForm itemsParam="item-1" />);

    expect(screen.getByText("Shipping").nextElementSibling).toHaveTextContent(
      "Free",
    );
  });

  it("shows the original price as the subtotal so the savings rows add up", () => {
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
        compareAtTotal: 130,
        subtotal: 100,
        savings: 30,
        discount: 0,
        total: 100,
      },
      total: 100,
    });
    render(<CheckoutForm itemsParam="item-1" />);

    const subtotal = screen.getByText("Subtotal").nextElementSibling;
    expect(subtotal).toHaveTextContent("₱130.00");
    expect(subtotal).not.toHaveTextContent("₱100.00");
    expect(screen.getByTestId("checkout-subtotal-compare")).not.toHaveClass(
      "line-through",
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

describe("CheckoutForm mobile summary order", () => {
  it("records an attempt even when validation fails, with the first invalid field", async () => {
    validationMock.validateCheckoutForm.mockReturnValue({ phone: "Enter a valid mobile number" });
    render(<CheckoutForm itemsParam="item-1" />);
    await userEvent.setup().click(screen.getByTestId("review-order"));
    expect(eventsMock.recordSubmitAttempt).toHaveBeenCalledTimes(1);
    expect(eventsMock.recordSubmitFailure).toHaveBeenCalledWith(expect.objectContaining({
      step: "form", reason: "VALIDATION", field: "phone", items: [{ skuId: "sku-1", quantity: 1, variantName: null }],
    }));
    expect(routerMock.push).not.toHaveBeenCalled();
  });
  it("lifts the totals card above the name field on phones and leaves the desktop grid alone", () => {
    render(<CheckoutForm itemsParam="item-1" />);

    const totals = screen.getByTestId("checkout-totals");
    const delivery = document
      .getElementById("checkout-name")!
      .closest("section")!.parentElement!;
    const summaryRow = totals.parentElement!;

    expect(totals).toHaveClass("order-2", "lg:order-none");
    expect(delivery).toHaveClass("order-3", "lg:order-none");
    expect(summaryRow).toHaveClass("contents", "lg:flex");
    expect(summaryRow).toHaveClass("lg:row-start-2");
    expect(screen.getByTestId("review-order").parentElement).toHaveClass(
      "order-6",
      "lg:order-none",
    );
  });
});
