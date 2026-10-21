import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, Product } from "@/lib/api";
import { CheckoutConfirmView } from "./CheckoutConfirmView";

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
  previewPromoCode: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

const useCartMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/cart/CartContext", () => ({ useCart: useCartMock }));

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const draftMock = vi.hoisted(() => ({
  readCheckoutDraft: vi.fn(),
  clearCheckoutDraft: vi.fn(),
}));
vi.mock("@/lib/checkoutDraft", () => draftMock);

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

beforeEach(() => {
  vi.clearAllMocks();
  useCartMock.mockReturnValue({
    removeItems: vi.fn().mockResolvedValue(undefined),
  });
  draftMock.readCheckoutDraft.mockReturnValue(validDraft);
  sessionStorage.clear();
  localStorage.clear();
});

describe("CheckoutConfirmView", () => {
  it("submits the retained credential at the request root without raw URL attribution", async () => {
    localStorage.setItem("sh:marketing-touch", JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH-CREDENTIAL" });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    expect(apiMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({ marketingCredential: "server.credential", attribution: { sourceType: "ORGANIC" } }));
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
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH2001" });
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

  it("applies a live promo code to the totals and the order payload", async () => {
    const user = userEvent.setup();
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 26,
      message: "",
    });
    apiMock.createOrder.mockResolvedValue({
      orderNumber: "PH2001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    await screen.findByText("Confirm your order");

    // The totals keep the strikethrough reference and the real total.
    const totals = screen.getByText("Subtotal").closest("dl");
    expect(totals).not.toBeNull();
    expect(within(totals!).getByText("₱260.00")).toBeInTheDocument(); // 130 × 2 compare-at
    expect(within(totals!).getByText("You save")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "SAVE10");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("confirm-promo-discount")).toBeInTheDocument(),
    );
    expect(apiMock.previewPromoCode).toHaveBeenCalledWith("SAVE10", 200);

    await user.click(screen.getByRole("button", { name: /Place COD order/i }));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalled());
    expect(apiMock.createOrder.mock.calls[0][0].promoCode).toBe("SAVE10");
  });

  it("blocks final submission while a restored promo is still being checked", async () => {
    let resolve!: (value: {
      valid: boolean;
      discountAmount: number;
      message: string;
    }) => void;
    draftMock.readCheckoutDraft.mockReturnValue({
      ...validDraft,
      promoCode: "SAVE10",
    });
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.previewPromoCode.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );

    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);

    const submit = await screen.findByTestId("confirm-place-order");
    await waitFor(() => expect(apiMock.previewPromoCode).toHaveBeenCalled());
    expect(submit).toBeDisabled();
    submit.click();
    expect(apiMock.createOrder).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ valid: true, discountAmount: 20, message: "" });
      await Promise.resolve();
    });
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("restores the draft promo and stores a discounted Purchase value without the code", async () => {
    const user = userEvent.setup();
    draftMock.readCheckoutDraft.mockReturnValue({
      ...validDraft,
      promoCode: "SAVE10",
    });
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.previewPromoCode.mockResolvedValue({
      valid: true,
      discountAmount: 20,
      message: "",
    });
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH-PROMO" });

    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);

    await waitFor(() =>
      expect(screen.getByTestId("confirm-promo-discount")).toHaveTextContent(
        "−₱20.00",
      ),
    );
    expect(apiMock.previewPromoCode).toHaveBeenCalledWith("SAVE10", 200);

    await user.click(screen.getByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalled());

    const stored = JSON.parse(
      sessionStorage.getItem("luwag_purchase_payload") ?? "null",
    ) as { data?: Record<string, unknown> } | null;
    expect(stored?.data?.value).toBe(180);
    expect(JSON.stringify(stored)).not.toContain("SAVE10");
  });

  it("shows the server reason and adds no discount for a rejected code", async () => {
    const user = userEvent.setup();
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.previewPromoCode.mockResolvedValue({
      valid: false,
      discountAmount: 0,
      message: "This promo code has expired.",
    });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);
    await screen.findByText("Confirm your order");

    await user.click(screen.getByRole("button", { name: "Have a promo code?" }));
    await user.type(screen.getByLabelText("Promo code"), "OLD");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(screen.getByTestId("promo-code-message")).toHaveTextContent(
        "This promo code has expired.",
      ),
    );
    expect(screen.queryByTestId("confirm-promo-discount")).toBeNull();
  });
});

describe("CheckoutConfirmView order notes", () => {
  it("sends the order note in the checkout payload", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH-NOTE" });
    draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "Call before delivery" });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalled());
    expect(apiMock.createOrder.mock.calls[0][0]).toMatchObject({ customerNote: "Call before delivery" });
  });

  it("sends null when the shopper left the note empty", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    apiMock.createOrder.mockResolvedValue({ orderNumber: "PH-NO-NOTE" });
    draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: null });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    await userEvent.setup().click(await screen.findByTestId("confirm-place-order"));
    await waitFor(() => expect(apiMock.createOrder).toHaveBeenCalled());
    expect(apiMock.createOrder.mock.calls[0][0]).toMatchObject({ customerNote: null });
  });

  it("shows the note read-only and hides the line when empty", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "Call before delivery" });
    const { unmount } = render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    expect(await screen.findByTestId("confirm-order-notes")).toHaveTextContent("Call before delivery");
    unmount();

    draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: null });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
    await screen.findByTestId("confirm-address");
    expect(screen.queryByTestId("confirm-order-notes")).toBeNull();
  });

  it("renders note markup as literal text", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "<b>bold</b>" });
    render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);

    expect(await screen.findByTestId("confirm-order-notes")).toHaveTextContent("<b>bold</b>");
    expect(document.querySelector("b")).toBeNull();
  });
});
