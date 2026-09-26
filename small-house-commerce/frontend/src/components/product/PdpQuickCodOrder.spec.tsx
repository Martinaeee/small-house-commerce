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
          compareAtPrice: null,
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
  await user.type(screen.getByLabelText("Full Name"), "Juan Dela Cruz");
  await user.type(screen.getByLabelText("Phone Number"), "09171234567");
  const province = await chooseFirstOption(user, "psgc-province");
  const city = await chooseFirstOption(user, "psgc-city");
  await user.type(
    screen.getByLabelText("Street / House / Unit"),
    "12 Mabini St",
  );
  return { province, city };
}

beforeEach(() => {
  api.createOrder.mockReset();
  tracking.readAttribution.mockReset();
  events.emitCommerceEvent.mockReset();
  router.push.mockReset();
  sessionStorage.clear();
  tracking.readAttribution.mockReturnValue({
    sourceType: "FACEBOOK",
    aid: "aid-123",
  });
});

describe("PdpQuickCodOrder", () => {
  it("places the order through the real endpoint with the shared selection and attribution", async () => {
    const user = userEvent.setup();
    api.createOrder.mockResolvedValue({
      orderNumber: "PH1001",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
    });
    renderQuickOrder();

    // The summary mirrors the hero's resolved variant, quantity and price.
    const summary = screen.getByTestId("quick-cod-summary");
    expect(within(summary).getByTestId("quick-cod-variant")).toHaveTextContent(
      "Red",
    );
    expect(within(summary).getByTestId("quick-cod-quantity")).toHaveTextContent(
      "1",
    );
    expect(within(summary).getByTestId("quick-cod-total")).toHaveTextContent(
      "₱100.00",
    );

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    await waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(1));
    const payload = api.createOrder.mock.calls[0]?.[0] as {
      customer: Record<string, unknown>;
      items: unknown;
      attribution: unknown;
      preferredDeliveryDate: unknown;
    };
    expect(payload.customer).toMatchObject({
      name: "Juan Dela Cruz",
      phone: "09171234567",
      streetAddress: "12 Mabini St",
      barangay: null,
      landmark: null,
    });
    // The address cascade fed real PSGC names through to the order.
    expect(String(payload.customer.province)).not.toBe("");
    expect(String(payload.customer.city)).not.toBe("");
    expect(payload.items).toEqual([{ skuId: "sku-red", quantity: 1 }]);
    expect(payload.attribution).toEqual({
      sourceType: "FACEBOOK",
      aid: "aid-123",
    });
    expect(payload.preferredDeliveryDate).toBeNull();
    expect(router.push).toHaveBeenCalledWith("/order-success/PH1001");
  });

  it("stashes the Purchase event before navigating to the existing success page", async () => {
    const user = userEvent.setup();
    api.createOrder.mockResolvedValue({
      orderNumber: "PH1002",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
    });
    renderQuickOrder();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const stash = sessionStorage.getItem("luwag_purchase_payload");
    expect(stash).not.toBeNull();
    expect(JSON.parse(stash ?? "{}")).toMatchObject({
      name: "Purchase",
      data: { order_id: "PH1002" },
    });
  });

  it("shows field-level errors and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(api.createOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter your name.")).toBeVisible();
    expect(screen.getByText("Please enter your mobile number.")).toBeVisible();
    expect(screen.getByLabelText("Full Name")).toHaveFocus();
  });

  it("rejects a malformed Philippine mobile number", async () => {
    const user = userEvent.setup();
    renderQuickOrder();

    await user.type(screen.getByLabelText("Full Name"), "Juan");
    await user.type(screen.getByLabelText("Phone Number"), "12345");
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

    await user.type(screen.getByLabelText("Full Name"), "J");
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);

    await user.type(screen.getByLabelText("Phone Number"), "09171234567");
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);
  });

  it("tracks the selected quantity total in InitiateCheckout", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), "red", true);

    await user.click(screen.getByTestId("quantity-probe"));
    await user.click(screen.getByTestId("quantity-probe"));
    await user.type(screen.getByLabelText("Full Name"), "J");

    const checkoutEvent = events.emitCommerceEvent.mock.calls.find(
      ([event]) => event?.name === "InitiateCheckout",
    )?.[0];
    expect(checkoutEvent?.data).toMatchObject({
      contents: [{ id: "sku-red", quantity: 3 }],
      value: 300,
      currency: "PHP",
    });
  });

  it("locks the address and shared purchase controls while the order is in flight", async () => {
    const user = userEvent.setup();
    let resolveOrder: ((value: unknown) => void) | undefined;
    api.createOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrder = resolve;
        }),
    );
    renderQuickOrder(buildProduct(), "red", true);

    await fillRequiredFields(user);
    const submit = screen.getByTestId("quick-cod-submit");
    await user.click(submit);

    expect(api.createOrder).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Placing order…");
    expect(screen.getByTestId("psgc-province")).toBeDisabled();
    expect(screen.getByTestId("psgc-city")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
    expect(screen.getByTestId("quantity-probe")).toBeDisabled();
    expect(screen.getByTestId("quick-cod-quantity")).toHaveTextContent("1");

    resolveOrder?.({
      orderNumber: "PH1003",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });

  it("survives two submits dispatched in the same tick", async () => {
    const user = userEvent.setup();
    api.createOrder.mockImplementation(
      () => new Promise(() => {}),
    );
    renderQuickOrder();

    await fillRequiredFields(user);
    const form = screen.getByTestId("quick-cod-submit").closest("form")!;

    // Two submits before React can re-render the disabled state: only the
    // re-entry guard can stop the second one.
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.createOrder).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server error and keeps the form usable", async () => {
    const user = userEvent.setup();
    api.createOrder.mockRejectedValue(new Error("SKU is out of stock"));
    renderQuickOrder();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));

    expect(await screen.findByTestId("quick-cod-error")).toHaveTextContent(
      "SKU is out of stock",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("quick-cod-submit")).toBeEnabled();
  });

  it("blocks ordering and says why when the combination is out of stock", async () => {
    const user = userEvent.setup();
    const product = buildProduct({ defaultDisplayVariantId: "blue" });
    renderQuickOrder(product, "blue");

    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();
    expect(
      screen.getByText(/This combination is out of stock/),
    ).toBeVisible();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(0);
  });

  it("fires InitiateCheckout on submit after an OOS draft becomes orderable", async () => {
    const user = userEvent.setup();
    api.createOrder.mockResolvedValue({
      orderNumber: "PH1004",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
    });
    const product = buildProduct({ defaultDisplayVariantId: "blue" });
    renderQuickOrder(product, "blue", true);

    await fillRequiredFields(user);
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByTestId("quick-cod-submit"));

    await waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(1));
    expect(
      events.emitCommerceEvent.mock.calls.filter(
        ([event]) => event?.name === "InitiateCheckout",
      ),
    ).toHaveLength(1);
  });

  it("asks for options instead of ordering before a variant is chosen", async () => {
    const user = userEvent.setup();
    renderQuickOrder(buildProduct(), null);

    expect(screen.getByTestId("quick-cod-submit")).toBeDisabled();
    expect(
      screen.getByText("Choose your options above to order this item."),
    ).toBeVisible();

    await fillRequiredFields(user);
    await user.click(screen.getByTestId("quick-cod-submit"));
    expect(api.createOrder).not.toHaveBeenCalled();
    // Nothing to initiate: there is no SKU yet.
    expect(events.emitCommerceEvent).not.toHaveBeenCalled();
  });
});
