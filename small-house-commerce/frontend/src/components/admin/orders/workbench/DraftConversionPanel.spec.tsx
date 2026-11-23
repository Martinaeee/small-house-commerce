import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminCheckoutDraftDetail } from "@/lib/admin-api";
import { DraftConversionPanel } from "./DraftConversionPanel";
const api = vi.hoisted(() => ({
  checkoutDraftRisk: vi.fn(),
  convertCheckoutDraft: vi.fn(),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
const draft = {
  id: "draft-1",
  clientRevision: 4,
  status: "OPEN",
  snapshot: {
    customer: {
      name: "Ana",
      phone: "09171234567",
      province: "Bulacan",
      city: "Malolos",
      barangay: "San Juan",
      postalCode: "3000",
      streetAddress: "1 Main St",
      landmark: "",
    },
    items: [{ skuId: "sku-1", quantity: 1 }],
    preferredDeliveryDate: null,
    customerNote: "Call first",
  },
} as AdminCheckoutDraftDetail;
beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.checkoutDraftRisk.mockResolvedValue({
    validPhone: true,
    requiresReview: true,
    classification: "RPT",
    reason: "Active previous order",
    orders: [{ id: "old", orderNumber: "PH100001", riskFlags: [] }],
  });
});
function setup(canConvert = true) {
  const converted = vi.fn();
  render(
    <AdminI18nProvider>
      <DraftConversionPanel
        draft={draft}
        canConvert={canConvert}
        onConverted={converted}
      />
    </AdminI18nProvider>,
  );
  return converted;
}
describe("draft conversion panel", () => {
  it("shows the customer's risk on the draft and requires an explicit review before converting", async () => {
    const converted = setup();
    expect(
      await screen.findByText("Active previous order"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Convert and confirm order" }),
    );
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", {
      name: "Convert and confirm order",
    });
    expect(submit).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    api.convertCheckoutDraft.mockResolvedValue({ id: "new-order" });
    await userEvent.click(submit);
    expect(api.convertCheckoutDraft).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({
        expectedRevision: 4,
        riskReviewed: true,
        customer: expect.objectContaining({ phone: "09171234567" }),
        preferredDeliveryDate: null,
      }),
    );
    expect(converted).toHaveBeenCalledWith("new-order");
  });
  it("keeps conversion disabled when the risk lookup fails and offers a retry", async () => {
    api.checkoutDraftRisk.mockRejectedValue(new Error("offline"));
    setup();
    await screen.findByText("Risk check failed. Retry before converting.");
    await userEvent.click(
      screen.getByRole("button", { name: "Convert and confirm order" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Convert and confirm order",
      }),
    ).toBeDisabled();
  });
  it("shows risk information without offering a write action to a view-only operator", async () => {
    setup(false);
    await screen.findByText("Active previous order");
    expect(
      screen.queryByRole("button", { name: "Convert and confirm order" }),
    ).not.toBeInTheDocument();
  });
});
