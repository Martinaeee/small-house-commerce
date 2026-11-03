import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import CheckoutDraftDetailPage from "./page";

const getCheckoutDraft = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "draft-1" }),
}));
vi.mock("@/lib/admin-api", () => ({
  adminApi: { getCheckoutDraft: (...args: unknown[]) => getCheckoutDraft(...args) },
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));

describe("CheckoutDraftDetailPage", () => {
  beforeEach(() => {
    setAdminLang("zh");
    getCheckoutDraft.mockReset();
    getCheckoutDraft.mockResolvedValue({
      id: "draft-1",
      status: "CONVERTED",
      hasUserInput: true,
      contactName: "Ana",
      contactPhone: "0917",
      itemCount: 1,
      firstItemName: "Oak Chair",
      firstItemThumbnail: null,
      orderId: "order-1",
      orderNumber: "PH100020",
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:05:00.000Z",
      expiresAt: "2026-12-03T00:00:00.000Z",
      snapshot: {
        customer: {
          name: "Ana",
          phone: "0917",
          province: "Bulacan",
          city: "Meycauayan",
          barangay: "",
          postalCode: "",
          streetAddress: "1 Main St",
          landmark: "",
        },
        items: [{ skuId: "sku-1", quantity: 1 }],
        preferredDeliveryDate: null,
        promoCodeInput: "",
        promoCodeApplied: null,
        customerNote: "Call first",
      },
      productSnapshot: [
        {
          skuId: "sku-1",
          skuCode: "SH-1",
          productName: "Oak Chair",
          productSlug: "oak-chair",
          variantName: "Natural",
          thumbnailUrl: null,
          unitPrice: "1299",
          quantity: 1,
        },
      ],
    });
  });

  it("shows the saved fields and the converted order link", async () => {
    render(
      <AdminI18nProvider>
        <CheckoutDraftDetailPage />
      </AdminI18nProvider>,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText(/1 Main St/)).toBeInTheDocument();
    expect(screen.getByText("Call first")).toBeInTheDocument();
    expect(screen.getByText(/PH100020/)).toBeInTheDocument();
  });
});
