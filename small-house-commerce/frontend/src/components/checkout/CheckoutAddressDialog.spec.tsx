import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutAddressDialog } from "./CheckoutAddressDialog";

const VALUES = {
  name: "Ana",
  phone: "0917",
  province: "Metro Manila",
  city: "Caloocan",
  barangay: "",
  postalCode: "",
  streetAddress: "",
  landmark: "",
};

function renderDialog() {
  render(
    <CheckoutAddressDialog
      open
      values={VALUES}
      errors={{}}
      postalAuto={null}
      postalOptions={[{ label: "Caloocan", zip: "1400" }]}
      locating={false}
      locationError={null}
      locationNotice={null}
      onChange={vi.fn()}
      onProvinceChange={vi.fn()}
      onCityChange={vi.fn()}
      onBarangayChange={vi.fn()}
      onUseMyLocation={vi.fn()}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

async function openRegionPicker() {
  await userEvent.setup().click(screen.getByTestId("checkout-region-trigger"));
}

function barangayResponse(names: string[]): Response {
  return new Response(
    JSON.stringify({
      city: "Caloocan",
      barangays: names.map((name, index) => ({ code: String(index + 1), name })),
    }),
    { status: 200 },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CheckoutAddressDialog barangay loading", () => {
  it("offers a retry when the list fails to load instead of showing an empty result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();
    await openRegionPicker();

    expect(await screen.findByText("Could not load barangays.")).toBeInTheDocument();
    expect(screen.queryByText("No match — adjust the search.")).not.toBeInTheDocument();

    fetchMock.mockResolvedValue(barangayResponse(["Barangay 1"]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: "Barangay 1" }),
    ).toBeInTheDocument();
  });

  it("keeps the search and postal controls at 16px so iOS does not zoom on focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(barangayResponse(["Barangay 1"])));
    renderDialog();
    await openRegionPicker();

    expect(screen.getByPlaceholderText("Search barangay")).toHaveClass("text-base");
    expect(document.getElementById("checkout-address")).toHaveClass(
      "text-base",
      "placeholder:text-base",
    );
    expect(document.getElementById("checkout-postal-code")).toHaveClass("text-base");
    expect(document.getElementById("checkout-landmark")).toHaveClass("text-base");
  });
});
