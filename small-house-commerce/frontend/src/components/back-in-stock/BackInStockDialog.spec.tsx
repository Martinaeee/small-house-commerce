import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { BackInStockDialog } from "./BackInStockDialog";

function response(ok: boolean, status = ok ? 200 : 500) {
  return new Response(ok ? JSON.stringify({ ok: true }) : "", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  document.body.style.overflow = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

describe("BackInStockDialog", () => {
  it("validates email locally without sending a request", async () => {
    const user = userEvent.setup();
    render(
      <BackInStockDialog
        skuId="sku-blue"
        productName="Blue chair"
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Email address" }), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the exact email and SKU once while a request is pending", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(
      <BackInStockDialog
        skuId="sku-blue"
        productName="Blue chair"
        onClose={vi.fn()}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "  Shopper@Example.com  ",
    );
    const form = screen.getByRole("button", { name: "Notify me" }).closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Shopper@Example.com",
          skuId: "sku-blue",
        }),
      }),
    );
    expect(screen.getByRole("button", { name: "Notifying" })).toBeDisabled();

    await act(async () => resolve(response(true)));
    expect(screen.getByText("We'll email you when it's back in stock.")).toBeVisible();
  });

  it("keeps the entered email visible after a server error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(false));
    const user = userEvent.setup();
    render(
      <BackInStockDialog
        skuId="sku-red"
        productName="Red chair"
        onClose={vi.fn()}
      />,
    );
    const email = screen.getByRole("textbox", { name: "Email address" });
    await user.type(email, "shopper@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your alert. Please try again.",
    );
    expect(email).toHaveValue("shopper@example.com");
  });

  it("locks scroll, traps focus, closes with Escape and restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    const returnFocusRef = createRef<HTMLButtonElement>();
    returnFocusRef.current = opener;
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <BackInStockDialog
        skuId="sku-blue"
        productName="Blue chair"
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Back in stock alert" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    screen.getByRole("button", { name: "Close" }).focus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes from the backdrop and the close button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <BackInStockDialog
        skuId="sku-blue"
        productName="Blue chair"
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(screen.getByTestId("back-in-stock-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
