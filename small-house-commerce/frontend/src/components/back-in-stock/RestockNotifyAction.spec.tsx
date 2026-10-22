import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestockNotifyAction } from "./RestockNotifyAction";
import { writeRestockContact } from "./restock-contact";

function response(ok: boolean, status = ok ? 200 : 500) {
  return new Response(ok ? JSON.stringify({ ok: true }) : "", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("RestockNotifyAction", () => {
  it("asks for the contact the first time and subscribes with it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(true));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <RestockNotifyAction
        skuId="sku-blue"
        productName="Blue chair"
        onSaved={onSaved}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Notify me when available" }),
    );

    // Nothing was sent yet: the contact is still missing.
    expect(fetch).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText("Email address"),
      "shopper@example.com",
    );
    await user.type(
      screen.getByLabelText("Phone number (optional)"),
      "09171234567",
    );
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        body: JSON.stringify({
          email: "shopper@example.com",
          skuId: "sku-blue",
          phone: "09171234567",
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith({
      email: "shopper@example.com",
      phone: "09171234567",
    });
  });

  it("subscribes straight away once this browser knows the shopper", async () => {
    writeRestockContact({ email: "known@example.com", phone: null });
    vi.mocked(fetch).mockResolvedValueOnce(response(true));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <RestockNotifyAction
        skuId="sku-blue"
        productName="Blue chair"
        onSaved={onSaved}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Notify me when available" }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        body: JSON.stringify({
          email: "known@example.com",
          skuId: "sku-blue",
        }),
      }),
    );
  });

  it("asks again when the alert could not be saved", async () => {
    writeRestockContact({ email: "known@example.com", phone: null });
    vi.mocked(fetch).mockResolvedValueOnce(response(false));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <RestockNotifyAction
        skuId="sku-blue"
        productName="Blue chair"
        onSaved={onSaved}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Notify me when available" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your alert. Please try again.",
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "known@example.com",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("remembers the contact so the next alert is a single click", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(true));
    const user = userEvent.setup();
    const view = render(
      <RestockNotifyAction skuId="sku-blue" productName="Blue chair" />,
    );

    await user.click(
      screen.getByRole("button", { name: "Notify me when available" }),
    );
    await user.type(
      screen.getByLabelText("Email address"),
      "shopper@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    // The page confirms with its own message, so the dialog gets out of the
    // way.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    view.unmount();

    vi.mocked(fetch).mockResolvedValueOnce(response(true));
    render(
      <RestockNotifyAction skuId="sku-blue" productName="Blue chair" />,
    );
    await user.click(
      screen.getByRole("button", { name: "Notify me when available" }),
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });
});
