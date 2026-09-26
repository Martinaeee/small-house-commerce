import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import AdminLinkBuilderPage from "./page";

const getLinkBuilderContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { getLinkBuilderContext },
}));

function renderPage() {
  return render(
    <AdminI18nProvider>
      <AdminLinkBuilderPage />
    </AdminI18nProvider>,
  );
}

describe("AdminLinkBuilderPage", () => {
  beforeEach(() => {
    setAdminLang("en");
    getLinkBuilderContext.mockReset();
  });

  it("loads the permission-filtered context and renders the builder", async () => {
    getLinkBuilderContext.mockResolvedValue({
      products: [
        {
          id: "product-1",
          name: "Compact Chair",
          slug: "compact-chair",
          variants: [],
          landingPages: [],
        },
      ],
    });

    renderPage();

    expect(screen.getByText("Loading link builder…")).toBeVisible();
    await waitFor(() => expect(getLinkBuilderContext).toHaveBeenCalledOnce());
    expect(await screen.findByRole("heading", { name: "Optimizer Link Builder" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Compact Chair" })).toBeVisible();
  });

  it("shows a retryable error without leaking a failed response", async () => {
    getLinkBuilderContext.mockRejectedValue(new Error("Forbidden"));

    renderPage();

    expect(await screen.findByText("Link-builder data could not be loaded.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByLabelText("Product")).not.toBeInTheDocument();
  });
});
