import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { CampaignLinkContext } from "@/lib/campaign-link-builder";
import { CampaignLinkBuilder } from "./CampaignLinkBuilder";

const context: CampaignLinkContext = {
  products: [
    {
      id: "00000000-0000-7000-8000-000000000001",
      name: "Compact Chair",
      slug: "compact-chair",
      variants: [
        {
          id: "00000000-0000-7000-8000-000000000002",
          name: "Red / Small",
        },
      ],
      landingPages: [
        {
          id: "00000000-0000-7000-8000-000000000003",
          slug: "compact-chair-red",
          title: "Compact Chair for Condos",
        },
        {
          id: "00000000-0000-7000-8000-000000000006",
          slug: "compact-chair-blue",
          title: "Compact Chair for Condos",
        },
      ],
    },
    {
      id: "00000000-0000-7000-8000-000000000004",
      name: "Storage Shelf",
      slug: "storage-shelf",
      variants: [],
      landingPages: [],
    },
  ],
};

function renderBuilder() {
  return render(
    <AdminI18nProvider>
      <CampaignLinkBuilder context={context} />
    </AdminI18nProvider>,
  );
}

beforeEach(() => {
  setAdminLang("en");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CampaignLinkBuilder", () => {
  it("uses only real products, variants and landing pages from the permitted context", () => {
    renderBuilder();

    expect(screen.getByLabelText("Product")).toHaveValue(
      "00000000-0000-7000-8000-000000000001",
    );
    expect(screen.getByLabelText("Variant")).toHaveValue(
      "00000000-0000-7000-8000-000000000002",
    );
    expect(screen.getByLabelText("Landing page (optional)")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Compact Chair" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Red / Small" })).toBeVisible();
    expect(
      screen.getByRole("option", {
        name: "Compact Chair for Condos · /lp/compact-chair-red",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", {
        name: "Compact Chair for Condos · /lp/compact-chair-blue",
      }),
    ).toBeVisible();
  });

  it("generates and copies product, variant and campaign links without alerts", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderBuilder();

    await user.type(screen.getByLabelText(/Optimizer \/ AID/), "optimizer-a");
    await user.type(screen.getByLabelText("Source (UTM source)"), "facebook");
    await user.type(screen.getByLabelText("Campaign ID"), "campaign-1");
    await user.type(screen.getByLabelText("Ad ID"), "ad-7");
    await user.click(screen.getByRole("button", { name: "Generate links" }));

    expect(
      screen.getByText("https://luwag.ph/products/compact-chair"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "https://luwag.ph/products/compact-chair?variant=00000000-0000-7000-8000-000000000002",
      ),
    ).toBeVisible();
    const generated = screen.getByTestId("generated-campaign-url");
    expect(generated).toHaveTextContent("aid=optimizer-a");
    expect(generated).toHaveTextContent("campaign_id=campaign-1");
    expect(generated).toHaveTextContent("ad_id=ad-7");
    expect(generated).toHaveTextContent("utm_source=facebook");

    await user.click(screen.getByRole("button", { name: "Copy campaign link" }));
    expect(writeText).toHaveBeenCalledWith(generated.textContent);
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(alert).not.toHaveBeenCalled();
  });

  it("uses the selected real landing page as the campaign base", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.selectOptions(
      screen.getByLabelText("Landing page (optional)"),
      "00000000-0000-7000-8000-000000000003",
    );
    await user.type(screen.getByLabelText(/Optimizer \/ AID/), "optimizer-a");
    await user.click(screen.getByRole("button", { name: "Generate links" }));

    const generated = screen.getByTestId("generated-campaign-url");
    expect(generated).toHaveTextContent("https://luwag.ph/lp/compact-chair-red?");
    expect(generated).not.toHaveTextContent("landingPageId");
    expect(generated).not.toHaveTextContent("landing_page_id");
  });

  it("shows localized validation and clears cross-product selections", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: "Generate links" }));
    expect(screen.getByText("AID is required.")).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText("Product"),
      "00000000-0000-7000-8000-000000000004",
    );
    expect(screen.getByLabelText("Variant")).toHaveValue("");
    expect(screen.getByLabelText("Landing page (optional)")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Red / Small" })).not.toBeInTheDocument();
  });
});
