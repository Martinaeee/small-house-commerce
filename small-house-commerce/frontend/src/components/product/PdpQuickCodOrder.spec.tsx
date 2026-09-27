import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product, ProductMediaSet } from "@/lib/api";
import {
  PdpPurchaseProvider,
  usePdpPurchase,
} from "./PdpPurchaseProvider";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { PdpQuickCodOrder } from "./PdpQuickCodOrder";

const api = vi.hoisted(() => ({ createOrder: vi.fn() }));
const tracking = vi.hoisted(() => ({ readAttribution: vi.fn() }));
const events = vi.hoisted(() => ({ emitCommerceEvent: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
const checkoutDraft = vi.hoisted(() => ({
  readCheckoutDraft: vi.fn(),
  writeCheckoutDraft: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, createOrder: api.createOrder } };
});
vi.mock("@/lib/tracking", () => ({
  readAttribution: tracking.readAttribution,
}));
vi.mock("@/lib/commerce-events", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/commerce-events")
  >("@/lib/commerce-events");
  return { ...actual, emitCommerceEvent: events.emitCommerceEvent };
});
vi.mock("@/lib/checkoutDraft", () => checkoutDraft);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: router.push, replace: vi.fn() }),
}));

const sharedMedia: ProductMediaSet = {
  resolvedScope: "SHARED",
  media: [
    {
      id: "shared-1",
      url: "/shared.jpg",
      type: "IMAGE",
      altText: "Chair",
      sortOrder: 0,
    },
  ],
  catalogGraphVersion: 7,
};

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
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
    materials: null,
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    features: null,
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
          {
            id: "red",
            label: "Red",
            position: 0,
            swatchHex: "#ff0000",
            thumbnailUrl: null,
            thumbnailAlt: null,
          },
          {
            id: "blue",
            label: "Blue",
            position: 1,
            swatchHex: "#0000ff",
            thumbnailUrl: null,
            thumbnailAlt: null,
          },
        ],
      },
    ],
    variants: [
      {
        id: "red",
        name: "Red",
        position: 0,
        combinationKey: "color:red",
        optionValueIds: ["red"],
        sku: {
          id: "sku-red",
          skuCode: "RED",
          status: "ACTIVE",
          price: 100,
          compareAtPrice: 130,
          availableInventory: 5,
        },
      },
      {
        id: "blue",
        name: "Blue",
        position: 1,
        combinationKey: "color:blue",
        optionValueIds: ["blue"],
        sku: {
          id: "sku-blue",
          skuCode: "BLUE",
          status: "ACTIVE",
          price: 120,
          compareAtPrice: null,
          availableInventory: 0,
        },
      },
    ],
    defaultDisplayVariantId: "red",
    effectiveCoverMedia: sharedMedia.media[0],
    images: sharedMedia.media,
    initialMediaSet: sharedMedia,
    availableMediaScopes: { optionValueIds: [], variantIds: [] },
    detailBlocks: [],
    ...overrides,
  };
}

function PurchaseControlsProbe() {
  const {
    primaryLine,
    purchaseLocked,
    setQuantity,
  } = usePdpPurchase();
  return (
    <>
      <ProductOptionSelector
        lineId={primaryLine.clientLineId}
        instanceId="quick-cod-test"
      />
      <button
        type="button"
        data-testid="quantity-probe"
        disabled={purchaseLocked}
        onClick={() =>
          setQuantity(primaryLine.clientLineId, primaryLine.quantity + 1)
        }
      >
        Increase probe quantity
      </button>
    </>
  );
}

function renderQuickOrder(
  product: Product = buildProduct(),
  initialVariantId: string | null = "red",
  withControls = false,
) {
  return render(
    <PdpPurchaseProvider product={product} initialVariantId={initialVariantId}>
      {withControls ? <PurchaseControlsProbe /> : null}
      <PdpQuickCodOrder />
    </PdpPurchaseProvider>,
  );
}

/** Picks the first option offered by a PSGC searchable select. */
async function chooseFirstOption(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
): Promise<string> {
  await user.click(screen.getByTestId(testId));
  const options = await screen.findAllByRole("option");
  const label = options[0]?.textContent ?? "";
  await user.click(options[0]!);
  return label;
}

/** Fills the five required fields through the real controls. */
async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
): Promise<{ province: string; city: string }> {
  await user.type(screen.getByLabelText("Full Name *"), "Juan Dela Cruz");
  await user.type(screen.getByLabelText("Mobile Number *"), "09171234567");
  const province = await chooseFirstOption(user, "psgc-province");
  const city = await chooseFirstOption(user, "psgc-city");
  await user.type(
    screen.getByLabelText("Full Address *"),
    "12 Mabini St",
  );
  return { province, city };
}

beforeEach(() => {
  api.createOrder.mockReset();
  tracking.readAttribution.mockReset();
  events.emitCommerceEvent.mockReset();
  router.push.mockReset();
  checkoutDraft.readCheckoutDraft.mockReset();
  checkoutDraft.writeCheckoutDraft.mockReset();
  checkoutDraft.readCheckoutDraft.mockReturnValue(null);
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  tracking.readAttribution.mockReturnValue({
    sourceType: "FACEBOOK",
    aid: "aid-123",
  });
});

describe("PdpQuickCodOrder", () => {
  it("writes the shared checkout draft and opens review without creating an order", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/products/chair?aid=aid-123&utm_source=facebook",
    );
    renderQuickOrder();

    // The item list starts from the hero's resolved variant and quantity.
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("1");
    expect(screen.getByTestId("quick-cod-row-qty-blue")).toHaveTextContent("0");
    expect(screen.getByTestId("quick-cod-total")).toHaveTextContent("₱100.00");

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Postal Code"), "1100");
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Juan Dela Cruz",
        phone: "09171234567",
        postalCode: "1100",
        streetAddress: "12 Mabini St",
        barangay: "",
        landmark: "",
      }),
      expect.any(String),
      {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "?aid=aid-123&utm_source=facebook",
        items: [{ skuId: "sku-red", quantity: 1 }],
      },
    );
    expect(router.push).toHaveBeenCalledWith(
      "/checkout/confirm?aid=aid-123&utm_source=facebook",
    );
  });

  it("shows the same delivery fields as the normal checkout", () => {
    renderQuickOrder();

    expect(screen.getByRole("button", { name: "Use my location" })).toBeVisible();
    expect(screen.getByLabelText("Postal Code")).toBeVisible();
    expect(screen.getByLabelText("Landmark")).toBeVisible();
    expect(screen.getByLabelText("Preferred delivery date (optional)")).toBeVisible();
    expect(
      screen.getByText("We use your mobile number for delivery updates."),
    ).toBeVisible();
    expect(screen.getByText("Choose a preferred date (optional).")).toBeVisible();
    expect(screen.getByTestId("quick-cod-submit")).toHaveTextContent("REVIEW ORDER");
  });

  it("carries several styles with their own quantities into checkout review", async () => {
    const user = userEvent.setup();
    const base = buildProduct();
    const product = buildProduct({
      variants: base.variants.map((variant) =>
        variant.id === "blue" && variant.sku
          ? { ...variant, sku: { ...variant.sku, availableInventory: 7 } }
          : variant,
      ),
    });
    renderQuickOrder(product, null);

    // Nothing is chosen yet: the basket starts empty.
    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();
    expect(screen.getByText("Select at least one item to order.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    await user.click(screen.getByRole("button", { name: "Increase Blue quantity" }));
    await user.click(screen.getByRole("button", { name: "Increase Blue quantity" }));

    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("1");
    expect(screen.getByTestId("quick-cod-row-qty-blue")).toHaveTextContent("2");
    // 100 + 120×2
    expect(screen.getByTestId("quick-cod-total")).toHaveTextContent("₱340.00");

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "",
        items: [
          { skuId: "sku-red", quantity: 1 },
          { skuId: "sku-blue", quantity: 2 },
        ],
      },
    );
    expect(router.push).toHaveBeenCalledWith("/checkout/confirm");
  });

  it("shows the compare-at strikethrough and a saving that is never deducted", () => {
    renderQuickOrder();

    expect(screen.getByTestId("quick-cod-compare-total")).toHaveTextContent(
      "₱130.00",
    );
    expect(screen.getByTestId("quick-cod-subtotal")).toHaveTextContent(
      "₱100.00",
    );
    expect(screen.getByTestId("quick-cod-save")).toHaveTextContent("−₱30.00");
    // The total is the selling-price subtotal — the saving is reference only.
    expect(screen.getByTestId("quick-cod-total")).toHaveTextContent("₱100.00");
  });

  it("does not stash Purchase before the shopper confirms the order", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("luwag_purchase_payload")).toBeNull();
    expect(router.push).toHaveBeenCalledWith("/checkout/confirm");
  });

  it("shows field-level errors and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter your name.")).toBeVisible();
    expect(screen.getByText("Please enter your mobile number.")).toBeVisible();
    expect(screen.getByLabelText("Full Name *")).toHaveFocus();
  });

  it("rejects a malformed Philippine mobile number", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await user.type(screen.getByLabelText("Full Name *"), "Juan");
    await user.type(screen.getByLabelText("Mobile Number *"), "12345");
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(
      screen.getByText("Please enter a valid Philippine mobile number."),
    ).toBeVisible();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it("fires InitiateCheckout on the first edit rather than on mount, and only once", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    expect(events.emitCommerceEvent).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Full Name *"), "J");
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);

    await user.type(screen.getByLabelText("Mobile Number *"), "09171234567");
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);
  });

  it("tracks the selected quantity total in InitiateCheckout", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), "red", true);

    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    await user.type(screen.getByLabelText("Full Name *"), "J");

    const checkoutEvent = events.emitCommerceEvent.mock.calls.find(
      ([event]) => event?.name === "InitiateCheckout",
    )?.[0];
    expect(checkoutEvent?.data).toMatchObject({
      contents: [{ id: "sku-red", quantity: 3 }],
      value: 300,
      currency: "PHP",
    });
  });

  it("locks the address, item list and shared controls while opening review", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), "red", true);

    await fillRequiredFields(user);
    const submit = screen.getByTestId("quick-cod-submit");
    await user.click(submit);

    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Opening review…");
    expect(screen.getByTestId("psgc-province")).toBeDisabled();
    expect(screen.getByTestId("psgc-city")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
    expect(screen.getByTestId("quantity-probe")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Increase Red quantity" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Decrease Red quantity" }),
    ).toBeDisabled();
    expect(router.push).toHaveBeenCalledWith("/checkout/confirm");
  });

  it("survives two review submits dispatched in the same tick", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await fillRequiredFields(user);
    const form = screen.getByTestId("quick-cod-submit").closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("restores a matching PDP draft when the shopper returns from review", async () => {
    checkoutDraft.readCheckoutDraft.mockReturnValue({
      customer: {
        name: "Maria Santos",
        phone: "09181234567",
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "Diliman",
        postalCode: "1101",
        streetAddress: "24 Luna St",
        landmark: "Blue gate",
      },
      preferredDeliveryDate: "2026-10-05",
      savedAt: "2026-09-27T00:00:00.000Z",
      selection: {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "",
        items: [{ skuId: "sku-red", quantity: 2 }],
      },
    });

    renderQuickOrder();

    await waitFor(() =>
      expect(screen.getByLabelText("Full Name *")).toHaveValue("Maria Santos"),
    );
    expect(screen.getByLabelText("Postal Code")).toHaveValue("1101");
    expect(screen.getByLabelText("Landmark")).toHaveValue("Blue gate");
    expect(screen.getByLabelText("Preferred delivery date (optional)")).toHaveValue(
      "2026-10-05",
    );
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("2");
  });

  it("marks an out-of-stock style unorderable without blocking the in-stock ones", async () => {
    const user = userEvent.setup();
    const product = buildProduct({ defaultDisplayVariantId: "blue" });
    renderQuickOrder(product, null);

    expect(screen.getByTestId("quick-cod-row-blue")).toHaveTextContent(
      "Out of stock",
    );
    expect(
      screen.getByRole("button", { name: "Increase Blue quantity" }),
    ).toBeDisabled();
    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();
    expect(screen.getByText("Select at least one item to order.")).toBeVisible();

    // The in-stock style still orders normally.
    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        items: [{ skuId: "sku-red", quantity: 1 }],
      }),
    );
  });

  it("fires InitiateCheckout when the first item is added after the form was already touched", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), null);

    await fillRequiredFields(user);
    // No items yet: the form touch alone must not fire a checkout.
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);

    await user.click(screen.getByTestId("quick-cod-submit"));
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(checkoutDraft.writeCheckoutDraft).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/checkout/confirm");
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);
  });

  it("starts with an empty basket when the hero has no combination yet", () => {
    renderQuickOrder(buildProduct(), null);

    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("0");
    expect(screen.getByTestId("quick-cod-row-qty-blue")).toHaveTextContent("0");
    expect(screen.getByTestId("quick-cod-total")).toHaveTextContent("₱0.00");
    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();
    expect(screen.getByText("Select at least one item to order.")).toBeVisible();
  });

  it("mirrors the hero selection until the basket is edited, then leaves it alone", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), null, true);

    // Hero unresolved: the basket starts empty.
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("0");

    const heroSelector = document.querySelector(
      '[data-selector-instance="quick-cod-test"]',
    );
    expect(heroSelector).toBeInstanceOf(HTMLElement);

    // The hero resolves -> the basket mirrors the combination.
    await user.click(
      within(heroSelector as HTMLElement).getByRole("button", { name: "Red" }),
    );
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("1");

    // The shopper edits the basket -> later hero changes no longer overwrite
    // their basket.
    await user.click(screen.getByRole("button", { name: "Increase Red quantity" }));
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("2");

    await user.click(
      within(heroSelector as HTMLElement).getByRole("button", { name: "Blue" }),
    );
    expect(screen.getByTestId("quick-cod-row-qty-red")).toHaveTextContent("2");
    expect(screen.getByTestId("quick-cod-row-qty-blue")).toHaveTextContent("0");
  });

  it("asks for at least one item instead of ordering an empty basket", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), null);

    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));
    expect(api.createOrder).not.toHaveBeenCalled();
    // Nothing to initiate: there is no item yet.
    expect(events.emitCommerceEvent).not.toHaveBeenCalled();
  });
});
