import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorefrontLayout from "./layout";

// Task 20 layout wiring: the storefront layout fetches the announcement
// document and passes it into AnnouncementBar. A rejected or absent fetch
// renders no bar and must never take the rest of the layout down with it.

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

// next/font/local only resolves inside the Next build pipeline.
vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(announcement: () => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/storefront/announcement")) return announcement();
      if (url.includes("/storefront/categories")) return jsonResponse([]);
      if (url.includes("/storefront/collections")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/storefront/settings")) {
        return jsonResponse({
          messengerUrl: "",
          supportEmail: "support@luwag.ph",
          supportHours: "",
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
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
  stubFetch(() => jsonResponse(ANNOUNCEMENT));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StorefrontLayout announcement wiring", () => {
  it("renders the bar from the storefront announcement endpoint alongside the page", async () => {
    await renderLayout();

    expect(await screen.findByText(ANNOUNCEMENT_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/announcement"),
      expect.any(Object),
    );
  });

  it("renders no bar when the announcement fetch rejects, and the page still renders", async () => {
    stubFetch(() => {
      throw new Error("backend down");
    });

    await renderLayout();

    expect(screen.queryByText(ANNOUNCEMENT_TEXT)).toBeNull();
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("renders no bar for the empty 200 body the backend sends when nothing is active", async () => {
    stubFetch(() => new Response("", { status: 200 }));

    await renderLayout();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    // The legacy hardcoded copy must be gone: with no data nothing
    // announcement-like renders (the Footer's own trust line is separate copy
    // and must not match this full legacy string).
    expect(
      screen.queryByText(
        /Free Metro Manila delivery on orders ₱3,000\+ · Cash on Delivery nationwide/,
      ),
    ).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("renders no bar for a disabled announcement block", async () => {
    stubFetch(() => jsonResponse({ ...ANNOUNCEMENT, enabled: false }));

    await renderLayout();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });
});
