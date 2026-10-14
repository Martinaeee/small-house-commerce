import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuredLink } from "@/lib/storefront-shell-document";
import { ShellLinkEditor } from "./ShellLinkEditor";

const apiMock = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listCollections: vi.fn(),
  listCategories: vi.fn(),
  listLandingPages: vi.fn(),
  getProduct: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [label, setLabel] = useState("Track order");
  const [link, setLink] = useState<StructuredLink>({
    type: "INTERNAL",
    path: "/track-order",
  });

  return (
    <>
      <ShellLinkEditor
        label={label}
        link={link}
        disabled={disabled}
        onLabelChange={setLabel}
        onLinkChange={setLink}
      />
      <output data-testid="link-state">{JSON.stringify({ label, link })}</output>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listProducts.mockResolvedValue({ items: [] });
  apiMock.listCollections.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  apiMock.listCategories.mockResolvedValue([]);
  apiMock.listLandingPages.mockResolvedValue({ items: [] });
});

describe("ShellLinkEditor", () => {
  it("controls a bounded label and uses LinkPicker's INTERNAL path", async () => {
    render(<Harness />);

    const label = screen.getByRole("textbox", {
      name: "storefront_shell_link_label",
    });
    expect(label).toHaveAttribute("maxLength", "40");
    fireEvent.change(label, { target: { value: "Where is my order?" } });

    const path = screen.getByRole("textbox", {
      name: "homepage_builder_link_internal_path",
    });
    fireEvent.change(path, { target: { value: "/orders/find" } });
    fireEvent.blur(path);

    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("link-state").textContent!)).toEqual({
        label: "Where is my order?",
        link: { type: "INTERNAL", path: "/orders/find" },
      }),
    );
    expect(
      screen.getByRole("combobox", { name: "homepage_builder_link_type" }),
    ).toHaveValue("INTERNAL");
  });

  it("keeps the committed structured link when LinkPicker clears during a type switch", async () => {
    render(<Harness />);
    const type = screen.getByRole("combobox", {
      name: "homepage_builder_link_type",
    });

    fireEvent.change(type, { target: { value: "COLLECTION" } });

    expect(JSON.parse(screen.getByTestId("link-state").textContent!).link).toEqual({
      type: "INTERNAL",
      path: "/track-order",
    });
    await waitFor(() => expect(apiMock.listCollections).toHaveBeenCalledTimes(1));
  });

  it("disables the label and all LinkPicker actions under the shared lock", () => {
    render(<Harness disabled />);

    expect(
      screen.getByRole("textbox", { name: "storefront_shell_link_label" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "homepage_builder_link_type" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", {
        name: "homepage_builder_link_internal_path",
      }),
    ).toBeDisabled();
  });
});
