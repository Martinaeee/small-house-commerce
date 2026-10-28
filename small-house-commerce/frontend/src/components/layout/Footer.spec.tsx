import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { Footer } from "./Footer";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const base = {
  collections: [],
  supportEmail: "support@luwag.ph",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
};

const shell: PublicStorefrontShell = {
  publishedRevision: 3,
  brand: {
    brandName: "Roomy Co",
    horizontalLogo: {
      id: "horizontal",
      url: "/uploads/brand/horizontal.webp",
      width: 600,
      height: 120,
    },
    squareMark: null,
  },
  header: { items: [] },
  footer: {
    tagline: "Room for real life",
    description: "Flexible furniture for compact Filipino homes.",
    columns: [
      {
        id: "help",
        kind: "LINKS",
        title: "Help",
        rows: [
          { id: "delivery", kind: "LINK", label: "Delivery", href: "/delivery" },
          { id: "note", kind: "TEXT", text: "Metro Manila and beyond" },
        ],
      },
      {
        id: "contact",
        kind: "CONTACT",
        title: "Talk to us",
        supportEmail: "hello@roomy.ph",
        supportHours: "Daily, 9am–7pm",
        trackOrderLabel: "Track a delivery",
        trackOrderHref: "/track-order",
      },
      {
        id: "about",
        kind: "LINKS",
        title: "About",
        rows: [
          { id: "story", kind: "LINK", label: "Our story", href: "/pages/story" },
        ],
      },
    ],
    copyrightBrand: "Roomy Co Living",
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

function renderFooter(
  props: Partial<Parameters<typeof Footer>[0]> = {},
  settings: Partial<SiteSettings> = {},
) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...settings }}>
      <Footer {...base} supportPhone="+63 917 123 4567" {...props} />
    </SiteSettingsProvider>,
  );
}

describe("Footer subscribe integration", () => {
  it("renders the subscribe block inside the footer element", () => {
    renderFooter();

    const footer = document.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer).toContainElement(screen.getByTestId("newsletter-band"));
  });

  it("puts the subscribe band in its own sage strip above the footer surface", () => {
    renderFooter();

    const footer = document.querySelector("footer");
    expect(footer?.className).toContain("bg-footer-background");
    const band = screen.getByTestId("newsletter-band");
    expect(band.className).toContain("bg-footer-band");
    expect(band.className).toContain("text-footer-band-ink");
  });

  it("uses storefront theme tokens for the Footer surface and readable copy", () => {
    renderFooter();

    const footer = document.querySelector("footer");
    expect(footer?.className).toContain("bg-footer-background");
    expect(footer?.className).toContain("text-footer-foreground");
    expect(screen.getByText("Small-space furniture, made roomy").className).toContain(
      "text-footer-foreground",
    );
    expect(
      screen.getByText(/Furniture for Filipino condos/).className,
    ).toContain("text-footer-secondary");
  });

  it("renders the brand lockup in the on-dark tone", () => {
    renderFooter();

    const wordmark = document.querySelector('footer [aria-label="LUWAG"]');
    // The generated lockup follows the published Footer foreground tokens
    // instead of reusing the Header's CTA tone.
    expect(wordmark?.className).toContain("text-footer-foreground");
    expect(wordmark?.className).not.toContain("text-cta");
    expect(wordmark?.querySelector("rect")?.getAttribute("fill")).toBe(
      "var(--color-footer-logo-tile)",
    );
  });

  it("omits the subscribe block when the band setting is off", () => {
    renderFooter({}, { newsletterBandEnabled: false });

    expect(screen.queryByTestId("newsletter-band")).toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
  });
});

describe("Footer support phone", () => {
  it("renders the readable number as a callable tel link", () => {
    renderFooter();

    expect(
      screen.getByRole("link", { name: "+63 917 123 4567" }),
    ).toHaveAttribute("href", "tel:+639171234567");
  });

  it("hides the telephone row when the setting is empty", () => {
    renderFooter({ supportPhone: "" });

    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
});

describe("Footer published shell content", () => {
  it("renders brand copy, ordered columns, resolved rows, one named logo, and current year", () => {
    renderFooter({ shell, mode: "live" });

    expect(screen.getByRole("img", { name: "Roomy Co" })).toHaveAttribute(
      "src",
      "/uploads/brand/horizontal.webp",
    );
    expect(document.querySelectorAll('footer img[alt="Roomy Co"]')).toHaveLength(1);
    expect(screen.getByText("Room for real life")).toBeVisible();
    expect(
      screen.getByText("Flexible furniture for compact Filipino homes."),
    ).toBeVisible();
    expect(
      [...document.querySelectorAll("[data-footer-column-id]")].map((node) =>
        node.getAttribute("data-footer-column-id"),
      ),
    ).toEqual(["help", "contact", "about"]);
    expect(screen.getByRole("link", { name: "Delivery" })).toHaveAttribute(
      "href",
      "/delivery",
    );
    expect(screen.getByText("Metro Manila and beyond")).toBeVisible();
    expect(screen.getByRole("link", { name: "hello@roomy.ph" })).toHaveAttribute(
      "href",
      "mailto:hello@roomy.ph",
    );
    expect(screen.getByRole("link", { name: "Track a delivery" })).toHaveAttribute(
      "href",
      "/track-order",
    );
    expect(screen.getByRole("link", { name: "Our story" })).toHaveAttribute(
      "href",
      "/pages/story",
    );
    expect(screen.getByText("Daily, 9am–7pm")).toBeVisible();
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Roomy Co Living`))).toBeVisible();
    expect(screen.getByTestId("newsletter-band")).toBeInTheDocument();
  });

  it("renders only Track Order, phone, hours and email in the Contact column", () => {
    renderFooter({ shell, mode: "live" });

    const contact = document.querySelector('[data-footer-column-id="contact"]');
    expect(contact?.querySelectorAll("li")).toHaveLength(4);
    expect(screen.queryByText(/cash on delivery/i)).toBeNull();
  });

  it("uses a desktop grid sized for the brand block and three content columns", () => {
    renderFooter({ shell, mode: "live" });

    expect(screen.getByTestId("footer-column-grid").className).toContain(
      "lg:grid-cols-[1.35fr_repeat(3,minmax(0,1fr))]",
    );
  });

  it("sizes the desktop grid for the brand block and four content columns", () => {
    const fourColumns = {
      ...shell,
      footer: {
        ...shell.footer,
        columns: [
          shell.footer.columns[0],
          shell.footer.columns[2],
          shell.footer.columns[1],
          { ...shell.footer.columns[2], id: "about-luwag", title: "About LUWAG" },
        ],
      },
    } as unknown as PublicStorefrontShell;

    renderFooter({ shell: fourColumns, mode: "live" });

    expect(screen.getByTestId("footer-column-grid").className).toContain(
      "lg:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))]",
    );
  });

  it("renders the Contact column with a callable phone and a mailto email", () => {
    const withContact = {
      ...shell,
      footer: {
        ...shell.footer,
        columns: [
          ...shell.footer.columns,
          {
            id: "contact-luwag",
            kind: "CONTACT" as const,
            title: "Contact",
            supportEmail: "hello@luwag.shop",
            supportHours: "Mon–Sat, 9am–6pm (PHT)",
            trackOrderLabel: "Track Order",
            trackOrderHref: "/track-order",
          },
        ],
      },
    } as unknown as PublicStorefrontShell;

    renderFooter({ shell: withContact, mode: "live", supportPhone: "0935 977 7504" });

    const contact = document.querySelector('[data-footer-column-id="contact-luwag"]');
    expect(contact?.querySelectorAll("li")).toHaveLength(4);
    expect(
      within(contact as HTMLElement).getByRole("link", { name: "0935 977 7504" }),
    ).toHaveAttribute("href", "tel:09359777504");
    expect(
      within(contact as HTMLElement).getByRole("link", { name: "hello@luwag.shop" }),
    ).toHaveAttribute("href", "mailto:hello@luwag.shop");
  });

  it("keeps Contact details but omits Track Order when its target is unavailable", () => {
    const withoutTrackOrder = {
      ...shell,
      footer: {
        ...shell.footer,
        columns: shell.footer.columns.map((column) =>
          column.kind === "CONTACT"
            ? { ...column, trackOrderHref: null }
            : column,
        ),
      },
    } as unknown as PublicStorefrontShell;

    renderFooter({ shell: withoutTrackOrder, mode: "live" });

    expect(screen.getByText("hello@roomy.ph")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Track a delivery" })).toBeNull();
  });

  it("replaces every shell link with text and omits the customer newsletter island in preview", () => {
    renderFooter({ shell, mode: "preview" });

    expect(document.querySelector("footer a")).toBeNull();
    expect(screen.getByText("Delivery")).toBeVisible();
    expect(screen.getByText("Track a delivery")).toBeVisible();
    expect(screen.getByText("hello@roomy.ph")).toBeVisible();
    expect(screen.queryByTestId("newsletter-band")).toBeNull();
  });
});

describe("Footer phone accordion", () => {
  it("gives every column a toggle and opens one column at a time", () => {
    renderFooter({ shell, mode: "live" });

    const toggles = screen.getAllByRole("button", { expanded: false });
    expect(toggles).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "About" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "About" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("Footer social icons, legal links and payment labels", () => {
  const withExtras = {
    ...shell,
    footer: {
      ...shell.footer,
      socials: [
        { id: "s1", network: "FACEBOOK" as const, href: "https://facebook.com/luwag" },
      ],
      legal: [{ id: "l1", label: "Privacy", href: "/privacy" }],
      payments: ["VISA", "GCash"],
    },
  };

  it("renders the configured icons, legal links and payment labels", () => {
    renderFooter({ shell: withExtras, mode: "live" });

    expect(screen.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://facebook.com/luwag",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByText("VISA")).toBeVisible();
    expect(screen.getByText("GCash")).toBeVisible();
  });

  it("renders nothing extra when the operator configured nothing", () => {
    renderFooter({ shell, mode: "live" });

    expect(document.querySelector('footer a[href^="https://facebook.com"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull();
    expect(screen.queryByText("VISA")).toBeNull();
  });
});
