import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnouncementBlockView, Category } from "@/lib/api";
import type { NavItem } from "@/lib/nav";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { StorefrontShellPresentation } from "./StorefrontShellPresentation";

vi.mock("./AnnouncementBar", () => ({
  AnnouncementBar: ({ mode }: { mode: string }) => (
    <div data-testid="shell-announcement" data-mode={mode} />
  ),
}));

vi.mock("./Header", () => ({
  Header: ({ navItems, mode }: { navItems: NavItem[]; mode: string }) => (
    <header data-testid="shell-header" data-mode={mode}>
      {navItems.map((item) => item.label).join("|")}
    </header>
  ),
}));

vi.mock("./Footer", () => ({
  Footer: ({ mode }: { mode: string }) => (
    <footer data-testid="shell-footer" data-mode={mode} />
  ),
}));

const root: Category = {
  id: "living",
  name: "Living Room",
  slug: "living-room",
  imageUrl: null,
  children: [],
};

const shell: PublicStorefrontShell = {
  publishedRevision: 1,
  brand: { brandName: "LUWAG", horizontalLogo: null, squareMark: null },
  header: {
    items: [
      { id: "new", kind: "LINK", label: "New", href: "/collections/new" },
      {
        id: "living",
        kind: "CATEGORY_ROOT",
        categoryId: root.id,
        label: "Lounge",
      },
    ],
  },
  footer: {
    tagline: "Small-space furniture, made roomy",
    description: "Furniture for Filipino condos and rentals.",
    columns: [],
    copyrightBrand: "LUWAG Living",
    socials: [],
    legal: [],
    payments: [],
  },
  theme: {
    primary: "#c9a77b",
    action: "#6b4f3a",
    background: "#faf8f5",
    surface: "#ffffff",
    text: "#1f1f1f",
    headingFont: "SYSTEM",
    bodyFont: "SYSTEM",
  },
  derivedTheme: {
    primaryDark: "#b8946a",
    primaryLight: "#e8dccb",
    actionHover: "#5a4130",
    textSecondary: "#666666",
    textMuted: "#999999",
    border: "#e8e2d9",
    focus: "#6b4f3a",
    disabled: "#999999",
    actionForeground: "#ffffff",
  },
};

describe("StorefrontShellPresentation", () => {
  it.each(["live", "preview"] as const)(
    "uses one sticky Header/main/Footer landmark order in %s mode",
    (mode) => {
      const { container } = render(
        <StorefrontShellPresentation
          shell={shell}
          roots={[root]}
          collections={[]}
          mode={mode}
        >
          <div data-testid="page-content">Page content</div>
        </StorefrontShellPresentation>,
      );

      const shellRoot = container.firstElementChild!;
      expect([...shellRoot.children].map((node) => node.tagName)).toEqual([
        "DIV",
        "MAIN",
        "FOOTER",
      ]);
      const sticky = shellRoot.children[0];
      expect(sticky).toHaveClass("sticky", "top-0");
      expect(sticky).toContainElement(screen.getByTestId("shell-header"));
      expect(screen.getByTestId("shell-header")).toHaveAttribute("data-mode", mode);
      expect(screen.getByTestId("shell-header")).toHaveTextContent("New|Lounge");
      expect(screen.getByRole("main")).toContainElement(
        screen.getByTestId("page-content"),
      );
      expect(screen.getByTestId("shell-footer")).toHaveAttribute("data-mode", mode);
    },
  );

  it("keeps the announcement bar and Header in the same sticky block", () => {
    render(
      <StorefrontShellPresentation
        shell={shell}
        roots={[root]}
        collections={[]}
        announcement={
          { enabled: true, items: [], rotationMs: 5000 } as unknown as AnnouncementBlockView
        }
      >
        <div />
      </StorefrontShellPresentation>,
    );

    const sticky = document.querySelector(".sticky")!;
    expect(sticky).toContainElement(screen.getByTestId("shell-announcement"));
    expect(sticky).toContainElement(screen.getByTestId("shell-header"));
    expect(screen.getByTestId("shell-announcement")).toHaveAttribute(
      "data-mode",
      "live",
    );
  });
});
