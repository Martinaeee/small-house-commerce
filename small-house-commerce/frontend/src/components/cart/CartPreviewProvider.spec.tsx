import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartPreviewProvider, useCart } from "./CartContext";

function Probe() {
  const cart = useCart();
  const [notice, setNotice] = useState("");
  return <>
    <output>{cart.itemKindCount}</output>
    <button onClick={async () => {
      try { await cart.addItem({ skuId: "preview-sku", quantity: 1 }); }
      catch (error) { setNotice((error as Error).message); }
    }}>Attempt add</button>
    <p role="status" aria-label="Preview notice">{notice}</p>
  </>;
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("private preview cart boundary", () => {
  it("never loads or modifies the existing guest cart", async () => {
    expect(CartPreviewProvider).toBeTypeOf("function");
    const fetch = vi.spyOn(globalThis, "fetch");
    localStorage.setItem("cartId", "customer-cart");
    render(<CartPreviewProvider><Probe /></CartPreviewProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Attempt add" }));
    expect(await screen.findByRole("status", { name: "Preview notice" })).toHaveTextContent("Preview");
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("cartId")).toBe("customer-cart");
  });
});
