import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import StorefrontLayout from "./layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/fonts", () => ({
  poppins: {
    className: "font-poppins",
    variable: "font-poppins-variable",
  },
}));

const ANNOUNCEMENT_TEXT = "Free Metro Manila delivery on orders ₱3,000+";
const ANNOUNCEMENT = {
  enabled: true,
  rotationMs: 5000,
  items: [
    {
      id: "00000000-0000-7000-8000-000000000021",
      text: ANNOUNCEMENT_TEXT,
      link: null,
      linkLabel: null,
      textColor: "#FFFFFF",
      backgroundColor: "#6b4f3a",
      schedule: { publishAt: null, unpublishAt: null },
      enabled: true,
      sortOrder: 0,
      linkHref: null,
    },
  ],
};

const CUSTOM_SHELL: PublicStorefrontShell = {
  publishedRevision: 4,
  brand: { brandName: "Roomy Co", horizontalLogo: null, squareMark: null },
  header: {
    items: [
      { id: "campaign", kind: "LINK", label: "Campaign", href: "/campaign" },
    ],
  },
  footer: {
    tagline: "Room for real life",
    description: "Flexible furniture for compact homes.",
    columns: [
      {
        id: "help",
        kind: "LINKS",
        title: "Help",
        rows: [
          { id: "delivery", kind: "LINK", label: "Delivery", href: "/delivery" },
        ],
      },
      {
        id: "contact",
        kind: "CONTACT",
        title: "Contact",
        supportEmail: "support@luwag.ph",
        supportHours: "Mon–Sat, 9am–6pm (PHT)",
        codText: "Cash on Delivery nationwide",
        trackOrderLabel: "Track Order",
        trackOrderHref: "/track-order",
      },
    ],
    copyrightBrand: "Roomy Co",
  },
  theme: {
    primary: "#315e81",
    action: "#7a351f",
    background: "#f1f2f3",
    surface: "#ffffff",
    text: "#111827",
    headingFont: "POPPINS_HEADING",
    bodyFont: "SYSTEM",
  },
  derivedTheme: {
    primaryDark: "#274b67",
    primaryLight: "#c9d4dd",
    actionHover: "#682d1a",
    textSecondary: "#636a75",
    textMuted: "#93979e",
    border: "#d9dade",
    focus: "#7a351f",
    disabled: "#a3a6ab",
    actionForeground: "#ffffff",
  },
};

const SETTINGS = {
  messengerUrl: "",
  supportEmail: "support@luwag.ph",
  supportPhone: "+63 917 123 4567",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
  newsletterBandEnabled: true,
  newsletterPopupEnabled: false,
  newsletterPopupDelaySeconds: 5,
  newsletterOfferTitle: "",
  newsletterOfferBody: "",
  newsletterOfferAvailable: false,
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchOptions = {
  announcement?: () => Response | Promise<Response>;
  shell?: () => Response | Promise<Response>;
  categories?: unknown[];
  collections?: unknown[];
};

function stubFetch(options: FetchOptions = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/storefront/announcement")) {
      return (options.announcement ?? (() => jsonResponse(ANNOUNCEMENT)))();
    }
    if (url.includes("/storefront/shell")) {
      return (options.shell ?? (() => jsonResponse(CUSTOM_SHELL)))();
    }
    if (url.includes("/storefront/categories")) {
      return jsonResponse(options.categories ?? []);
    }
    if (url.includes("/storefront/collections")) {
      return jsonResponse({ items: options.collections ?? [] });
    }
    if (url.includes("/storefront/settings")) return jsonResponse(SETTINGS);
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderLayout(): Promise<void> {
  const tree = await StorefrontLayout({
    children: <div data-testid="page">Page content</div>,
  });
  await act(async () => {
    render(tree);
  });
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StorefrontLayout data loading", () => {
  it("starts categories, collections, settings, announcement and shell in parallel", async () => {
    const pending = new Map<string, (response: Response) => void>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return new Promise<Response>((resolve) => pending.set(url, resolve));
    });
    vi.stubGlobal("fetch", fetchMock);

    const layoutPromise = StorefrontLayout({ children: <div>Page</div> });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect([...pending.keys()].map((url) => new URL(url).pathname).sort()).toEqual([
      "/api/v1/storefront/announcement",
      "/api/v1/storefront/categories",
      "/api/v1/storefront/collections",
      "/api/v1/storefront/settings",
      "/api/v1/storefront/shell",
    ]);

    for (const [url, resolve] of pending) {
      if (url.includes("/announcement")) resolve(jsonResponse(null));
      else if (url.includes("/categories")) resolve(jsonResponse([]));
      else if (url.includes("/collections")) resolve(jsonResponse({ items: [] }));
      else if (url.includes("/settings")) resolve(jsonResponse(SETTINGS));
      else resolve(jsonResponse(CUSTOM_SHELL));
    }
    await expect(layoutPromise).resolves.toBeDefined();
  });

  it("renders published Header, Footer and validated theme tokens", async () => {
    await renderLayout();

    expect(screen.getAllByRole("link", { name: "Campaign" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Room for real life")).toBeVisible();
    expect(screen.getByRole("link", { name: "Delivery" })).toHaveAttribute(
      "href",
      "/delivery",
    );
    const style = document.querySelector<HTMLStyleElement>(
      "style#storefront-theme-tokens",
    );
    expect(style?.textContent).toContain(":root { --color-primary: #315e81;");
    expect(style?.textContent).not.toContain("--color-sale:");
    expect(document.querySelector(".storefront-app")).not.toBeNull();
  });

  it("uses current legacy navigation, Footer and theme when shell loading fails", async () => {
    stubFetch({
      shell: () => {
        throw new Error("shell unavailable");
      },
      categories: [
        {
          id: "living",
          name: "Living Room",
          slug: "living-room",
          imageUrl: null,
          children: [],
        },
      ],
      collections: [
        {
          id: "new",
          name: "New Arrivals",
          slug: "new-arrivals",
          type: "NAVIGATION",
          description: null,
          heroImage: null,
          sortOrder: 0,
        },
      ],
    });

    await renderLayout();

    expect(screen.getAllByRole("link", { name: "Living Room" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "New Arrivals" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Small-space furniture, made roomy")).toBeVisible();
    expect(screen.getByRole("link", { name: "support@luwag.ph" })).toHaveAttribute(
      "href",
      "mailto:support@luwag.ph",
    );
    expect(
      document.querySelector("style#storefront-theme-tokens")?.textContent,
    ).toContain("--color-primary: #c9a77b;");
  });
});

describe("StorefrontLayout announcement wiring", () => {
  it("renders the bar from the storefront announcement endpoint alongside the page", async () => {
    await renderLayout();

    expect(await screen.findByText(ANNOUNCEMENT_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "+63 917 123 4567" }),
    ).toHaveAttribute("href", "tel:+639171234567");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/announcement"),
      expect.any(Object),
    );
  });

  it("renders no bar when the announcement fetch rejects, and the page still renders", async () => {
    stubFetch({
      announcement: () => {
        throw new Error("backend down");
      },
    });

    await renderLayout();

    expect(screen.queryByText(ANNOUNCEMENT_TEXT)).toBeNull();
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("renders no bar for the empty 200 body the backend sends when nothing is active", async () => {
    stubFetch({ announcement: () => new Response("", { status: 200 }) });

    await renderLayout();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(
      screen.queryByText(
        /Free Metro Manila delivery on orders ₱3,000\+ · Cash on Delivery nationwide/,
      ),
    ).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("renders no bar for a disabled announcement block", async () => {
    stubFetch({
      announcement: () => jsonResponse({ ...ANNOUNCEMENT, enabled: false }),
    });

    await renderLayout();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });
});
