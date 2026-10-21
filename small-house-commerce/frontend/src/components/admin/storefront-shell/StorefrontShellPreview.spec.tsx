import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PUBLIC_STOREFRONT_SHELL } from "@/lib/storefront-shell";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { StorefrontShellPreview } from "./StorefrontShellPreview";

const providersSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/fonts", () => ({
  poppins: { variable: "--font-poppins", className: "font-poppins" },
}));
vi.mock("@/components/auth/Providers", () => ({
  Providers: (props: { children?: unknown }) => {
    providersSpy();
    return <div>{props.children as never}</div>;
  },
}));
vi.mock("@/components/tracking/MarketingTouchObserver", () => ({
  MarketingTouchObserver: () => {
    providersSpy();
    return null;
  },
}));
vi.mock("@/components/cart/CartDrawer", () => ({
  CartDrawer: () => {
    providersSpy();
    return null;
  },
}));
vi.mock("@/components/newsletter/NewsletterPopup", () => ({
  NewsletterPopup: () => {
    providersSpy();
    return null;
  },
}));
vi.mock("@/components/chat/MessengerChat", () => ({
  MessengerChat: () => {
    providersSpy();
    return null;
  },
}));
vi.mock("@/components/layout/MobileTabBar", () => ({
  MobileTabBar: () => {
    providersSpy();
    return null;
  },
}));
vi.mock("@/components/layout/BackToTop", () => ({
  BackToTop: () => {
    providersSpy();
    return null;
  },
}));

const BRAND_ASSET = {
  id: "00000000-0000-7000-8000-000000000901",
  url: "/uploads/brand/logo.webp",
  width: 600,
  height: 120,
};

const SQUARE_ASSET = {
  id: "00000000-0000-7000-8000-000000000902",
  url: "/uploads/brand/mark.webp",
  width: 256,
  height: 256,
};

function shell(
  overrides: Partial<PublicStorefrontShell> = {},
): PublicStorefrontShell {
  return {
    ...structuredClone(DEFAULT_PUBLIC_STOREFRONT_SHELL),
    brand: {
      brandName: "LUWAG",
      horizontalLogo: BRAND_ASSET,
      squareMark: SQUARE_ASSET,
    },
    ...overrides,
  };
}

function canvas(): HTMLElement {
  return screen.getByTestId("storefront-shell-preview-canvas");
}

describe("StorefrontShellPreview", () => {
  beforeEach(() => {
    providersSpy.mockClear();
  });

  it.each([
    ["desktop", "1200px"],
    ["tablet", "768px"],
    ["mobile", "390px"],
  ] as const)("sizes the %s canvas to %s", (device, width) => {
    render(
      <StorefrontShellPreview shell={shell()} device={device}>
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    expect(canvas()).toHaveAttribute("data-device", device);
    expect(canvas().style.width).toBe(width);
    expect(canvas().style.maxWidth).toBe("100%");
  });

  it("keeps the fixed device width from overflowing a narrow editor column", () => {
    render(
      <StorefrontShellPreview shell={shell()} device="desktop">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    // The wrapper carries the fixed device width; without its own cap it forces
    // the whole admin page to scroll horizontally on a phone-width viewport.
    const wrapper = canvas().parentElement as HTMLElement;
    expect(wrapper.style.maxWidth).toBe("100%");
  });

  it("renders the shared Header and Footer in preview mode with inert links", () => {
    render(
      <StorefrontShellPreview shell={shell()} device="desktop">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    const presentation = canvas().querySelector(
      '[data-storefront-shell-mode="preview"]',
    );
    expect(presentation).not.toBeNull();
    expect(within(canvas()).queryAllByRole("link")).toHaveLength(0);
    for (const button of within(canvas()).queryAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByText("Body")).toBeVisible();
  });

  it("shows the horizontal logo on desktop and the square mark on mobile", () => {
    const { rerender } = render(
      <StorefrontShellPreview shell={shell()} device="desktop">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    const sources = () =>
      Array.from(canvas().querySelectorAll("img")).map((image) =>
        image.getAttribute("src"),
      );
    expect(sources()).toContain(BRAND_ASSET.url);

    rerender(
      <StorefrontShellPreview shell={shell()} device="mobile">
        <p>Body</p>
      </StorefrontShellPreview>,
    );
    expect(sources()).toContain(SQUARE_ASSET.url);
  });

  it("applies the local draft theme variables to the isolated canvas", () => {
    const draft = shell({
      theme: {
        ...DEFAULT_PUBLIC_STOREFRONT_SHELL.theme,
        action: "#123456",
      },
      derivedTheme: {
        ...DEFAULT_PUBLIC_STOREFRONT_SHELL.derivedTheme,
        actionHover: "#0f2c44",
      },
    });

    render(
      <StorefrontShellPreview shell={draft} device="desktop">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    expect(canvas().style.getPropertyValue("--color-cta")).toBe("#123456");
    expect(canvas().style.getPropertyValue("--color-cta-hover")).toBe("#0f2c44");
  });

  it("never mounts providers, customer islands or analytics inside the preview", () => {
    render(
      <StorefrontShellPreview shell={shell()} device="desktop">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    expect(providersSpy).not.toHaveBeenCalled();
  });

  it("focuses one shell part at a time and keeps the rest out", () => {
    const { rerender } = render(
      <StorefrontShellPreview shell={shell()} device="desktop" parts="header">
        <p>Body</p>
      </StorefrontShellPreview>,
    );
    expect(canvas().querySelector("header")).not.toBeNull();
    expect(canvas().querySelector("footer")).toBeNull();

    rerender(
      <StorefrontShellPreview shell={shell()} device="desktop" parts="footer">
        <p>Body</p>
      </StorefrontShellPreview>,
    );
    expect(canvas().querySelector("header")).toBeNull();
    expect(canvas().querySelector("footer")).not.toBeNull();

    rerender(
      <StorefrontShellPreview shell={shell()} device="desktop" parts="full">
        <p>Body</p>
      </StorefrontShellPreview>,
    );
    expect(canvas().querySelector("header")).not.toBeNull();
    expect(canvas().querySelector("footer")).not.toBeNull();
  });

  it("renders a light content placeholder instead of the striped block", () => {
    render(<StorefrontShellPreview shell={shell()} device="desktop" />);

    expect(canvas().innerHTML).not.toContain("repeating-linear-gradient");
    expect(screen.getByTestId("preview-content-placeholder")).toBeVisible();
  });

  it("scrolls vertically without overflowing horizontally", () => {
    render(
      <StorefrontShellPreview shell={shell()} device="mobile">
        <p>Body</p>
      </StorefrontShellPreview>,
    );

    expect(canvas().className).toContain("overflow-y-auto");
    expect(canvas().className).toContain("overflow-x-hidden");
    expect(canvas().className).toContain("min-w-0");
  });
});
