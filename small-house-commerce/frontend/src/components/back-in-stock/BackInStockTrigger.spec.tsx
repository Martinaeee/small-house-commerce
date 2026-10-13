import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";
import { BackInStockTrigger } from "./BackInStockTrigger";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

function EnabledSettings({ children }: { children: ReactNode }) {
  return (
    <SiteSettingsProvider
      settings={{ ...DEFAULT_SITE_SETTINGS, backInStockEnabled: true }}
    >
      {children}
    </SiteSettingsProvider>
  );
}

describe("BackInStockTrigger", () => {
  it("renders no subscription control when real email delivery is unavailable", () => {
    render(<BackInStockTrigger skuId="sku-blue" productName="Chair" />);

    expect(
      screen.queryByRole("button", { name: "Notify me when back in stock" }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("portals the dialog outside a card stacking context", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="card-stacking-context">
        <BackInStockTrigger skuId="sku-blue" productName="Chair" />
      </div>,
      { wrapper: EnabledSettings },
    );

    await user.click(
      screen.getByRole("button", { name: "Notify me when back in stock" }),
    );

    expect(screen.getByTestId("back-in-stock-backdrop").parentElement).toBe(
      document.body,
    );
  });

  it("drops an open success state when the resolved SKU changes", async () => {
    const user = userEvent.setup();
    const view = render(
      <BackInStockTrigger skuId="sku-blue" productName="Chair" />,
      { wrapper: EnabledSettings },
    );
    const trigger = screen.getByRole("button", {
      name: "Notify me when back in stock",
    });
    await user.click(trigger);
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "shopper@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Notify me" }));
    expect(
      await screen.findByText("We'll email you when it's back in stock."),
    ).toBeVisible();

    view.rerender(
      <BackInStockTrigger skuId="sku-red" productName="Chair" />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Notify me when back in stock" }),
    );
    expect(screen.queryByText("We'll email you when it's back in stock.")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveValue("");
  });
});
