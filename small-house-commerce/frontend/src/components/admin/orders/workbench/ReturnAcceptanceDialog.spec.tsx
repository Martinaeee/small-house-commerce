import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminOrderDetail, AdminOrderListRow } from "@/lib/admin-api";
import { ReturnAcceptanceDialog } from "./ReturnAcceptanceDialog";

const api = vi.hoisted(() => ({
  acceptReturn: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

const row = {
  id: "order-1",
  orderNumber: "PH100050",
  orderStatus: "SHIPPING",
  items: [
    {
      id: "line-1",
      productNameSnapshot: "Foldable Desk",
      skuCodeSnapshot: "SKU-FD-140",
      quantity: 3,
    },
    {
      id: "line-2",
      productNameSnapshot: "Rattan Chair",
      skuCodeSnapshot: "SKU-RC-01",
      quantity: 2,
    },
  ],
} as unknown as AdminOrderListRow;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...row,
    shipments: [
      {
        id: "ship-1",
        carrier: "LBC",
        status: "SHIPPING",
        items: [
          { id: "si-1", orderItemId: "line-1", quantity: 2 },
          { id: "si-2", orderItemId: "line-2", quantity: 2 },
        ],
        events: [],
      },
    ],
    returnAcceptances: [
      {
        id: "ra-old",
        shipmentId: "ship-1",
        receivedAt: "2026-10-23T10:00:00.000Z",
        items: [{ id: "rai-old", orderItemId: "line-1", quantityGood: 1, quantityDamaged: 0 }],
      },
    ],
    ...overrides,
  } as unknown as AdminOrderDetail;
}

function renderWithI18n(node: React.ReactNode) {
  return render(<AdminI18nProvider>{node}</AdminI18nProvider>);
}

beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.acceptReturn.mockResolvedValue({ id: "ra-new" });
});

describe("ReturnAcceptanceDialog", () => {
  it("accepts the good units left after earlier returns and ignores unshipped lines", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithI18n(
      <ReturnAcceptanceDialog
        orderId="order-1"
        detail={detail()}
        onClose={() => {}}
        onDone={onDone}
      />,
    );

    // line-1 shipped 2 and 1 was already accepted => 1 left; line-2 left 2.
    expect(screen.queryByText("SKU-FD-140")).toBeTruthy();
    await user.type(screen.getByLabelText("Reason (optional)"), "Carrier returned the box");
    await user.click(screen.getByRole("button", { name: "Confirm acceptance" }));

    await waitFor(() =>
      expect(api.acceptReturn).toHaveBeenCalledWith("order-1", {
        shipmentId: "ship-1",
        reason: "Carrier returned the box",
        items: [
          { orderItemId: "line-1", quantityGood: 1, quantityDamaged: 0, conditionNote: undefined },
          { orderItemId: "line-2", quantityGood: 2, quantityDamaged: 0, conditionNote: undefined },
        ],
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("splits good and damaged units and refuses an empty line", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ReturnAcceptanceDialog orderId="order-1" detail={detail()} onClose={() => {}} onDone={() => {}} />,
    );

    const good = screen.getByLabelText(/Good SKU-FD-140/);
    const damaged = screen.getByLabelText(/Damaged SKU-FD-140/);
    await user.clear(good);
    await user.type(good, "0");
    await user.type(damaged, "1");
    await user.type(screen.getByLabelText(/Damaged note SKU-FD-140/), "Cracked frame");
    const submit = screen.getByRole("button", { name: "Confirm acceptance" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(api.acceptReturn).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({
          items: expect.arrayContaining([
            { orderItemId: "line-1", quantityGood: 0, quantityDamaged: 1, conditionNote: "Cracked frame" },
          ]),
        }),
      ),
    );
  });

  it("keeps a return scoped to its selected box when two boxes contain the same order line", async () => {
    const user = userEvent.setup();
    const current = detail();
    current.shipments[0].trackingNumber = "TRACK-1";
    current.shipments.push({
      ...current.shipments[0],
      id: "ship-2",
      trackingNumber: "TRACK-2",
      items: [{ ...current.shipments[0].items[0], id: "si-3", quantity: 1 }],
    });
    renderWithI18n(
      <ReturnAcceptanceDialog orderId="order-1" detail={current} onClose={() => {}} onDone={() => {}} />,
    );

    expect(screen.getByLabelText("Good SKU-FD-140")).toHaveValue(1);
    await user.click(screen.getByRole("combobox", { name: "Shipment" }));
    await user.click(screen.getByRole("option", { name: "LBC · TRACK-2" }));
    expect(screen.queryByText("SKU-RC-01")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Good SKU-FD-140")).toHaveValue(1);
    await user.click(screen.getByRole("button", { name: "Confirm acceptance" }));

    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledWith("order-1", {
      shipmentId: "ship-2",
      reason: undefined,
      items: [{ orderItemId: "line-1", quantityGood: 1, quantityDamaged: 0, conditionNote: undefined }],
    }));
  });

  it("does not offer already signed or returned boxes for RTO acceptance", () => {
    const current = detail({ returnAcceptances: [] });
    current.shipments = [
      { ...current.shipments[0], id: "signed", status: "SIGNED" },
      { ...current.shipments[0], id: "returned", status: "RETURNED" },
      { ...current.shipments[0], id: "mixed", status: "PARTIALLY_RETURNED" },
    ];
    renderWithI18n(
      <ReturnAcceptanceDialog orderId="order-1" detail={current} onClose={() => {}} onDone={() => {}} />,
    );

    expect(screen.queryByLabelText("Good SKU-FD-140")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm acceptance" })).toBeDisabled();
    expect(api.acceptReturn).not.toHaveBeenCalled();
  });

  it("preserves another box's edited quantities when switching back", async () => {
    const user = userEvent.setup();
    const current = detail();
    current.shipments[0].trackingNumber = "TRACK-1";
    current.shipments.push({ ...current.shipments[0], id: "ship-2", trackingNumber: "TRACK-2" });
    renderWithI18n(
      <ReturnAcceptanceDialog orderId="order-1" detail={current} onClose={() => {}} onDone={() => {}} />,
    );
    await user.clear(screen.getByLabelText("Good SKU-RC-01"));
    await user.type(screen.getByLabelText("Good SKU-RC-01"), "1");
    await user.click(screen.getByRole("combobox", { name: "Shipment" }));
    await user.click(screen.getByRole("option", { name: "LBC · TRACK-2" }));
    expect(screen.getByLabelText("Good SKU-RC-01")).toHaveValue(2);
    await user.click(screen.getByRole("combobox", { name: "Shipment" }));
    await user.click(screen.getByRole("option", { name: "LBC · TRACK-1" }));
    expect(screen.getByLabelText("Good SKU-RC-01")).toHaveValue(1);
  });

  it("shows the server refusal and stays open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.acceptReturn.mockRejectedValue(new Error("Only shipped orders can receive a return (current: SIGNED)"));
    renderWithI18n(
      <ReturnAcceptanceDialog orderId="order-1" detail={detail()} onClose={onClose} onDone={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm acceptance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only shipped orders can receive a return",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
