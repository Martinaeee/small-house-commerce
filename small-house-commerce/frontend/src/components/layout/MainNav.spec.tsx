import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "@/lib/api";
import type { NavItem } from "@/lib/nav";
import { MainNav } from "./MainNav";

const navigationMock = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => navigationMock);

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

const sofa: Category = {
  id: "sofa",
  name: "Sofas",
  slug: "sofas",
  imageUrl: "/sofas.jpg",
  children: [],
};

const living: Category = {
  id: "living",
  name: "Living Room",
  slug: "living-room",
  imageUrl: "/living.jpg",
  children: [sofa],
};

const items: NavItem[] = [
  {
    kind: "link",
    label: "New",
    href: "/collections/new",
    position: 0,
  },
  {
    kind: "tree",
    root: living,
    label: "Lounge",
    position: 1,
  },
];

beforeEach(() => {
  navigationMock.usePathname.mockClear();
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("MainNav preview mode", () => {
  it("renders inert labels without links, body portals, or router access", () => {
    render(<MainNav items={items} mode="preview" />);

    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("Lounge")).toBeVisible();
    expect(document.querySelector("a")).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeDisabled();
    expect(navigationMock.usePathname).not.toHaveBeenCalled();
  });
});

describe("MainNav live mode", () => {
  it("opens current category content on hover using the configured label and closes outside", async () => {
    render(<MainNav items={items} mode="live" />);

    const loungeLink = screen.getAllByRole("link", { name: "Lounge" })[0];
    fireEvent.mouseEnter(loungeLink.closest("[data-nav-root]")!);

    const panel = await screen.findByRole("region", { name: "Lounge" });
    expect(panel).toHaveTextContent("View all Lounge");
    expect(panel).toHaveTextContent("Sofas");
    expect(panel.querySelector('img[src="/sofas.jpg"]')).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Lounge" })).toBeNull();
  });

  it("opens from keyboard focus and closes the desktop panel on Escape", async () => {
    render(<MainNav items={items} />);

    const loungeLink = screen.getAllByRole("link", { name: "Lounge" })[0];
    act(() => loungeLink.focus());
    expect(loungeLink).toHaveFocus();
    expect(await screen.findByRole("region", { name: "Lounge" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Lounge" })).toBeNull();
    expect(loungeLink).toHaveFocus();
  });

  it("keeps the mobile drawer focus trap, Escape restoration, and scroll lock", async () => {
    const offsetParent = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetParent",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });

    try {
      render(<MainNav items={items} />);
      const opener = screen.getByRole("button", { name: "Open menu" });
      fireEvent.click(opener);

      const dialog = screen.getByRole("dialog", { name: "Menu" });
      const close = screen.getByRole("button", { name: "Close menu" });
      await waitFor(() => expect(close).toHaveFocus());
      expect(document.body.style.overflow).toBe("hidden");
      expect(dialog.parentElement).toHaveAttribute("aria-hidden", "false");

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      const focusables = dialog.querySelectorAll(
        'a[href], button:not([disabled])',
      );
      expect(focusables[focusables.length - 1]).toHaveFocus();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(dialog.parentElement).toHaveAttribute("aria-hidden", "true");
      expect(opener).toHaveFocus();
      expect(document.body.style.overflow).toBe("");
    } finally {
      if (offsetParent) {
        Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent);
      } else {
        delete (HTMLElement.prototype as { offsetParent?: Element | null }).offsetParent;
      }
    }
  });
});
