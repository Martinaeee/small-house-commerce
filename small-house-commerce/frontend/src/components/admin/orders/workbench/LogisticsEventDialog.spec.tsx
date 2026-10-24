import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminShipment } from "@/lib/admin-api";
import { LogisticsEventDialog } from "./LogisticsEventDialog";

const api = vi.hoisted(() => ({
  recordLogisticsEvent: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

const shipment = {
  id: "ship-1",
  carrier: "LBC",
  trackingNumber: "TRACK-1",
  status: "SHIPPING",
  shippingCost: null,
  shippedAt: "2026-10-23T08:00:00.000Z",
  signedAt: null,
  createdAt: "2026-10-23T08:00:00.000Z",
  items: [],
  events: [],
} as unknown as AdminShipment;

function renderWithI18n(node: React.ReactNode) {
  return render(<AdminI18nProvider>{node}</AdminI18nProvider>);
}

beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.recordLogisticsEvent.mockResolvedValue({ id: "ev-1" });
});

describe("LogisticsEventDialog", () => {
  it("records the chosen state with the carrier wording and dedupe id", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithI18n(
      <LogisticsEventDialog
        orderId="order-1"
        shipment={shipment}
        onClose={() => {}}
        onDone={onDone}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Event status" }));
    await user.click(screen.getByRole("option", { name: "Delivery failed" }));
    await user.type(screen.getByLabelText("City (optional)"), "Quezon City");
    await user.type(screen.getByLabelText("Carrier wording (optional)"), "Recipient not home");
    await user.type(screen.getByLabelText("External event id (optional, dedupes)"), "LBC-9");
    await user.click(screen.getByRole("button", { name: "Record event" }));

    await waitFor(() =>
      expect(api.recordLogisticsEvent).toHaveBeenCalledWith(
        "order-1",
        "ship-1",
        expect.objectContaining({
          normalizedStatus: "FAILED_DELIVERY",
          city: "Quezon City",
          externalStatus: "Recipient not home",
          externalEventId: "LBC-9",
          eventTime: expect.any(String),
        }),
      ),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the server refusal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.recordLogisticsEvent.mockRejectedValue(new Error("Shipment not found for this order"));
    renderWithI18n(
      <LogisticsEventDialog
        orderId="order-1"
        shipment={shipment}
        onClose={onClose}
        onDone={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Record event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Shipment not found for this order");
    expect(onClose).not.toHaveBeenCalled();
  });
});
