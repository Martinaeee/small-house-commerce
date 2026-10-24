import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type {
  AdminOrderDetail,
  AdminOrderListRow,
} from "@/lib/admin-api";
import { FulfillmentDialog } from "./FulfillmentDialog";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  handoverSummary: vi.fn(),
  recordHandover: vi.fn(),
  shipOrder: vi.fn(),
  signShipment: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

const row = {
  id: "order-1",
  orderNumber: "PH100004",
  orderStatus: "CONFIRMED",
  confirmationStatus: "CONFIRMED",
  handoverCompletedAt: null,
  items: [
    {
      id: "line-1",
      productNameSnapshot: "Foldable Desk",
      skuCodeSnapshot: "SKU-FD-140",
      variantSnapshot: "Walnut",
      quantity: 2,
      unitPrice: "1499",
      lineTotal: "2998",
    },
  ],
} as unknown as AdminOrderListRow;

function order(overrides: Record<string, unknown> = {}) {
  return {
    ...row,
    items: [
      {
        id: "line-1",
        productNameSnapshot: "Foldable Desk",
        skuCodeSnapshot: "SKU-FD-140",
        variantSnapshot: "Walnut",
        optionSnapshot: null,
        quantity: 2,
        unitPrice: "1499",
        unitDiscount: "0",
        unitCostSnapshot: null,
        lineTotal: "2998",
      },
    ],
    shipments: [],
    ...overrides,
  } as unknown as AdminOrderDetail;
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    handedOver: [],
    outstanding: [{ orderItemId: "line-1", quantity: 2, skuCodeSnapshot: "SKU-FD-140" }],
    rejected: 0,
    withdrawn: 0,
    complete: false,
    events: [],
    ...overrides,
  };
}

function renderWithI18n(node: React.ReactNode) {
  return render(<AdminI18nProvider>{node}</AdminI18nProvider>);
}

beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.getOrder.mockResolvedValue(order());
  api.handoverSummary.mockResolvedValue(summary());
  api.recordHandover.mockResolvedValue({ id: "ho-1" });
  api.shipOrder.mockResolvedValue({ shipmentId: "ship-1", orderStatus: "SHIPPING", confirmationStatus: "CONFIRMED" });
  api.signShipment.mockResolvedValue({ shipmentId: "ship-1", orderStatus: "SIGNED" });
});

describe("FulfillmentDialog", () => {
  it("records a full handover with the outstanding quantities", async () => {
    const onDone = vi.fn();
    renderWithI18n(
      <FulfillmentDialog kind="handover" row={row} onClose={() => {}} onDone={onDone} />,
    );

    expect(await screen.findByText("SKU-FD-140")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Record event" }));

    await waitFor(() =>
      expect(api.recordHandover).toHaveBeenCalledWith("order-1", {
        type: "HANDED_OVER",
        reason: null,
        note: null,
        items: [{ orderItemId: "line-1", quantity: 2 }],
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("requires a reason before a withdrawal can be recorded", async () => {
    renderWithI18n(
      <FulfillmentDialog kind="handover" row={row} onClose={() => {}} onDone={() => {}} />,
    );

    await screen.findByText("SKU-FD-140");
    await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
    await userEvent.click(screen.getByRole("option", { name: "Customer withdrew" }));
    const submit = screen.getByRole("button", { name: "Record event" });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Reason/), "客户行使撤回权");
    await userEvent.click(submit);

    await waitFor(() =>
      expect(api.recordHandover).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({
          type: "WITHDRAWN",
          reason: "客户行使撤回权",
        }),
      ),
    );
  });

  it("opens event choices inside the dialog and keeps the selected event", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <FulfillmentDialog kind="handover" row={row} onClose={() => {}} onDone={() => {}} />,
    );
    await screen.findByText("SKU-FD-140");
    const trigger = screen.getByRole("combobox", { name: "Event" });
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "Event" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Handed over to the warehouse" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("option", { name: "Warehouse rejected" }));
    expect(trigger).toHaveTextContent("Warehouse rejected");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record event" })).toBeDisabled();
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Warehouse rejected" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByLabelText(/Reason/));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps the edited quantities when the same event is picked again", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <FulfillmentDialog kind="handover" row={row} onClose={() => {}} onDone={() => {}} />,
    );
    await screen.findByText("SKU-FD-140");
    const quantity = screen.getByLabelText(/Quantity now SKU-FD-140/);
    await user.clear(quantity);
    await user.type(quantity, "1");
    const trigger = screen.getByRole("combobox", { name: "Event" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Handed over to the warehouse" }));
    await user.click(screen.getByRole("button", { name: "Record event" }));

    await waitFor(() =>
      expect(api.recordHandover).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({ items: [{ orderItemId: "line-1", quantity: 1 }] }),
      ),
    );
  });

  it("lets the keyboard select an event and Escape only dismisses the open choices", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithI18n(
      <FulfillmentDialog kind="handover" row={row} onClose={onClose} onDone={() => {}} />,
    );
    await screen.findByText("SKU-FD-140");
    const trigger = screen.getByRole("combobox", { name: "Event" });
    trigger.focus();
    await user.keyboard("{ArrowDown}{End}{Enter}");
    expect(trigger).toHaveTextContent("Customer withdrew");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ships the remaining quantity with the carrier", async () => {
    api.getOrder.mockResolvedValue(
      order({
        shipments: [
          {
            id: "ship-old",
            carrier: "LBC",
            trackingNumber: "OLD-1",
            status: "SHIPPING",
            shippingCost: null,
            shippedAt: "2026-10-22T10:00:00.000Z",
            signedAt: null,
            createdAt: "2026-10-22T10:00:00.000Z",
            items: [{ id: "si-1", orderItemId: "line-1", quantity: 1 }],
          },
        ],
      }),
    );
    renderWithI18n(
      <FulfillmentDialog kind="ship" row={row} onClose={() => {}} onDone={() => {}} />,
    );

    expect(await screen.findByText("Left to ship")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Carrier"), "LBC");
    await userEvent.click(screen.getByRole("button", { name: "Create shipment" }));

    await waitFor(() =>
      expect(api.shipOrder).toHaveBeenCalledWith("order-1", {
        carrier: "LBC",
        trackingNumber: undefined,
        items: [{ orderItemId: "line-1", quantity: 1 }],
      }),
    );
  });

  it("reloads the order after signing instead of assuming every box is signed", async () => {
    const first = order({
      orderStatus: "SHIPPING",
      shipments: [
        {
          id: "ship-1",
          carrier: "LBC",
          trackingNumber: "TRACK-1",
          status: "SHIPPING",
          shippingCost: null,
          shippedAt: "2026-10-22T10:00:00.000Z",
          signedAt: null,
          createdAt: "2026-10-22T10:00:00.000Z",
          items: [{ id: "si-1", orderItemId: "line-1", quantity: 1 }],
        },
      ],
    });
    const after = order({
      orderStatus: "PARTIALLY_RETURNED",
      shipments: [
        {
          ...first.shipments[0],
          status: "PARTIALLY_RETURNED",
          signedAt: "2026-10-24T09:00:00.000Z",
        },
      ],
    });
    api.getOrder.mockReset();
    api.getOrder.mockResolvedValueOnce(first).mockResolvedValue(after);
    renderWithI18n(
      <FulfillmentDialog kind="sign" row={row} onClose={() => {}} onDone={() => {}} />,
    );

    expect(await screen.findByText(/TRACK-1/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(api.signShipment).toHaveBeenCalledWith("order-1", "ship-1"));
    await waitFor(() => expect(api.getOrder).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No shipment is waiting for a signature")).toBeTruthy();
  });

  it("marks a partly returned box as having goods still to sign", async () => {
    api.getOrder.mockResolvedValue(
      order({
        orderStatus: "SHIPPING",
        shipments: [
          {
            id: "ship-1",
            carrier: "LBC",
            trackingNumber: "TRACK-1",
            status: "SHIPPING",
            shippingCost: null,
            shippedAt: "2026-10-22T10:00:00.000Z",
            signedAt: null,
            createdAt: "2026-10-22T10:00:00.000Z",
            items: [{ id: "si-1", orderItemId: "line-1", quantity: 2 }],
          },
        ],
        returnAcceptances: [
          {
            id: "ra-1",
            shipmentId: "ship-1",
            receivedAt: "2026-10-24T08:00:00.000Z",
            items: [{ id: "rai-1", orderItemId: "line-1", quantityGood: 1, quantityDamaged: 0 }],
          },
        ],
      }),
    );
    renderWithI18n(
      <FulfillmentDialog kind="sign" row={row} onClose={() => {}} onDone={() => {}} />,
    );

    expect(await screen.findByText("1 returned · 1 left to sign")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign the remaining goods" }));
    await waitFor(() => expect(api.signShipment).toHaveBeenCalledWith("order-1", "ship-1"));
  });

  it("signs the boxes that are still in transit", async () => {
    api.getOrder.mockResolvedValue(
      order({
        orderStatus: "SHIPPING",
        shipments: [
          {
            id: "ship-1",
            carrier: "LBC",
            trackingNumber: "TRACK-1",
            status: "SHIPPING",
            shippingCost: null,
            shippedAt: "2026-10-22T10:00:00.000Z",
            signedAt: null,
            createdAt: "2026-10-22T10:00:00.000Z",
            items: [{ id: "si-1", orderItemId: "line-1", quantity: 2 }],
          },
        ],
      }),
    );
    renderWithI18n(
      <FulfillmentDialog kind="sign" row={row} onClose={() => {}} onDone={() => {}} />,
    );

    expect(await screen.findByText(/TRACK-1/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(api.signShipment).toHaveBeenCalledWith("order-1", "ship-1"));
  });
});
