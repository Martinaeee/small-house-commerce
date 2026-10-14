import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminFaqCategory, AdminFaqItem } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { FaqSharedSection } from "./FaqSharedSection";

function faqItem(
  id: string,
  title: string,
  category: AdminFaqCategory,
  position: number,
): AdminFaqItem {
  return {
    id,
    title,
    answer: [{ kind: "paragraph", text: `${title} answer` }],
    enabled: true,
    position,
    defaultOpen: false,
    category,
  };
}

const shippingA = faqItem("shipping-a", "Shipping A", "DELIVERY", 0);
const paymentB = faqItem("payment-b", "Payment B", "PAYMENT_COD", 1);
const shippingC = faqItem("shipping-c", "Shipping C", "DELIVERY", 2);

function renderSection(
  onMove: (item: AdminFaqItem, direction: -1 | 1) => void,
  saving = false,
) {
  return render(
    <AdminI18nProvider>
      <FaqSharedSection
        items={[shippingA, paymentB, shippingC]}
        usage={{ productCount: 2 }}
        loading={false}
        error={null}
        saving={saving}
        filters={{ search: "", status: "all", updatedSince: null }}
        categoryFilter="all"
        canEdit
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onMove={onMove}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />
    </AdminI18nProvider>,
  );
}

function rowFor(title: string) {
  return within(screen.getByText(title).closest("tr")!);
}

describe("FaqSharedSection ordering controls", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  it("keeps move controls keyboard-visible and disables category boundaries", () => {
    renderSection(vi.fn());

    expect(
      rowFor("Shipping A").getByRole("button", {
        name: "Move up — Shipping A",
      }),
    ).toBeVisible();
    expect(
      rowFor("Shipping A").getByRole("button", {
        name: "Move up — Shipping A",
      }),
    ).toBeDisabled();
    expect(
      rowFor("Shipping A").getByRole("button", {
        name: "Move down — Shipping A",
      }),
    ).toBeEnabled();

    expect(
      rowFor("Payment B").getByRole("button", {
        name: "Move up — Payment B",
      }),
    ).toBeDisabled();
    expect(
      rowFor("Payment B").getByRole("button", {
        name: "Move down — Payment B",
      }),
    ).toBeDisabled();

    expect(
      rowFor("Shipping C").getByRole("button", {
        name: "Move up — Shipping C",
      }),
    ).toBeEnabled();
    expect(
      rowFor("Shipping C").getByRole("button", {
        name: "Move down — Shipping C",
      }),
    ).toBeDisabled();
  });

  it("invokes onMove with the exact item and direction", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderSection(onMove);

    await user.click(
      rowFor("Shipping C").getByRole("button", {
        name: "Move up — Shipping C",
      }),
    );
    await user.click(
      rowFor("Shipping A").getByRole("button", {
        name: "Move down — Shipping A",
      }),
    );

    expect(onMove).toHaveBeenNthCalledWith(1, shippingC, -1);
    expect(onMove).toHaveBeenNthCalledWith(2, shippingA, 1);
  });

  it("disables every move while a shared save is in flight", () => {
    renderSection(vi.fn(), true);

    expect(
      rowFor("Shipping C").getByRole("button", {
        name: "Move up — Shipping C",
      }),
    ).toBeDisabled();
    expect(
      rowFor("Shipping A").getByRole("button", {
        name: "Move down — Shipping A",
      }),
    ).toBeDisabled();
  });
});
