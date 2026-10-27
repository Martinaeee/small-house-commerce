import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins", variable: "--font-poppins" },
}));

import { PreviewStorefrontShell } from "./PreviewStorefrontShell";
import type { AnnouncementBlockView } from "@/lib/api";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";
import { DEFAULT_PUBLIC_STOREFRONT_SHELL } from "@/lib/storefront-shell";

const announcement: AnnouncementBlockView = {
  enabled: true,
  rotationMs: 5000,
  items: [
    {
      id: "00000000-0000-7000-8000-000000000021",
      text: "Draft announcement",
      link: { type: "INTERNAL", path: "/sale" },
      linkHref: "/sale",
      linkLabel: "Shop now",
      textColor: "#FFFFFF",
      backgroundColor: "#6B4F3A",
      schedule: { publishAt: null, unpublishAt: null },
      enabled: true,
      sortOrder: 0,
    },
  ],
};

function renderShell(device: "desktop" | "tablet" | "mobile") {
  return render(
    <PreviewStorefrontShell
      shell={DEFAULT_PUBLIC_STOREFRONT_SHELL}
      roots={[]}
      collections={[]}
      settings={DEFAULT_SITE_SETTINGS}
      announcement={announcement}
      device={device}
    >
      <div data-testid="homepage-sections">Homepage sections</div>
    </PreviewStorefrontShell>,
  );
}

describe("PreviewStorefrontShell", () => {
  it("renders the complete inert shell in storefront order", () => {
    const view = renderShell("mobile");
    const root = view.container.querySelector<HTMLElement>(
      "[data-storefront-preview-shell]",
    );
    expect(root).not.toBeNull();

    const announcementNode = root!.querySelector("[data-announcement-bar]");
    const header = root!.querySelector<HTMLElement>("header");
    const main = root!.querySelector<HTMLElement>("main");
    const sections = root!.querySelector<HTMLElement>(
      "[data-testid='homepage-sections']",
    );
    const footer = root!.querySelector<HTMLElement>("footer");
    expect(announcementNode).not.toBeNull();
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();
    expect(main).toContainElement(sections);
    expect(footer).not.toBeNull();
    // The announcement bar and header now share one sticky block, so assert
    // document order rather than direct-child indexes.
    const order = [announcementNode!, header!, main!, footer!];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(announcementNode!.parentElement).toBe(header!.parentElement);
    expect(root).toHaveAttribute("data-device", "mobile");
    expect(root).toHaveAttribute("data-storefront-shell-mode", "preview");
  });

  it("keeps every fixed control inside the preview root without interactive semantics", () => {
    const view = renderShell("mobile");
    const root = view.container.querySelector("[data-storefront-preview-shell]")!;

    expect(root.querySelector("[data-preview-cart-drawer='closed']")).not.toBeNull();
    expect(root.querySelector("[data-preview-messenger]")).not.toBeNull();
    expect(root.querySelector("[data-preview-mobile-tab-bar]")).not.toBeNull();
    expect(root.querySelector("[data-preview-mobile-tab-bar]")).toHaveClass("pb-[env(safe-area-inset-bottom)]");
    expect(root.querySelector("[data-preview-back-to-top]")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    for (const button of screen.queryAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("tabindex", "0");
    }
  });

  it("blocks navigation and form submission from arbitrary preview sections", () => {
    const linkAction = vi.fn();
    const submitAction = vi.fn();
    const view = render(
      <PreviewStorefrontShell
        shell={DEFAULT_PUBLIC_STOREFRONT_SHELL}
        roots={[]}
        collections={[]}
        settings={DEFAULT_SITE_SETTINGS}
        announcement={announcement}
        device="desktop"
      >
        <a href="/escape" onClick={linkAction}>
          Linked section
        </a>
        <form action="/submit" onSubmit={submitAction}>
          <button type="submit">Submit section</button>
        </form>
      </PreviewStorefrontShell>,
    );
    const link = screen.getByRole("link", { name: "Linked section" });
    for (const type of ["click", "auxclick", "contextmenu", "dragstart"] as const) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: type === "auxclick" ? 1 : 0,
      });
      expect(link.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    }
    const form = view.container.querySelector("form")!;
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    expect(form.dispatchEvent(submit)).toBe(false);
    expect(submit.defaultPrevented).toBe(true);
    expect(linkAction).not.toHaveBeenCalled();
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("shows the mobile tab bar only for the mobile canvas", () => {
    const view = renderShell("desktop");
    expect(
      view.container.querySelector("[data-preview-mobile-tab-bar]"),
    ).toBeNull();

    view.rerender(
      <PreviewStorefrontShell
        shell={DEFAULT_PUBLIC_STOREFRONT_SHELL}
        roots={[]}
        collections={[]}
        settings={DEFAULT_SITE_SETTINGS}
        announcement={announcement}
        device="tablet"
      >
        <div>Homepage sections</div>
      </PreviewStorefrontShell>,
    );
    expect(
      view.container.querySelector("[data-preview-mobile-tab-bar]"),
    ).toBeNull();
  });
});
