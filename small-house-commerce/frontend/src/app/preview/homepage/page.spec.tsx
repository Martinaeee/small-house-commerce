import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import type { AnnouncementBlockView, HomepageSection } from "@/lib/api";
import { emptySlide } from "@/lib/homepage-document";
import { initMetaPixel, trackCustom } from "@/lib/tracking";
import HomepagePreviewPage, { metadata } from "./page";

// Task 21 draft-preview contract (spec §5.2 / Ruling 49):
// - `/preview/homepage?token=…` is the only entry point; a missing or empty
//   token 404s, and any non-200 answer from either preview fetch 404s too.
// - A present-but-invalid token is the backend's silent fallback: it answers
//   200 with the live document, and this page must render it (no client-side
//   token validation, no second fetch to compare against the live version).
// - The page is operator-only: noindex/nofollow metadata, private no-store +
//   no-referrer response headers (next.config `headers()`), zero tracking
//   (no MetaPixelInit, no HomeTracking, no delegated data-track reporting)
//   and the token never leaves the server-side fetch URL.

const { notFoundMock } = vi.hoisted(() => {
  // Mirrors next/dist/client/components/not-found.js: the real notFound()
  // throws an Error whose digest is "NEXT_HTTP_ERROR_FALLBACK;404".
  const notFoundMock = vi.fn(() => {
    const error = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    (error as Error & { digest?: string }).digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  });
  return { notFoundMock };
});

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

// Sentinels: if the preview tree ever mounts the pixel or the tracking
// delegation again, these markers appear and the zero-tracking test fails.
vi.mock("@/components/tracking/MetaPixelInit", () => ({
  MetaPixelInit: () => <div data-testid="meta-pixel-init" />,
}));
vi.mock("@/components/home/HomeTracking", () => ({
  HomeTracking: () => <div data-testid="home-tracking" />,
}));

vi.mock("@/lib/tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracking")>();
  return { ...actual, initMetaPixel: vi.fn(), track: vi.fn(), trackCustom: vi.fn() };
});

const DRAFT_TOKEN = "draft-token.abc123";
const DRAFT_HEADING = "Draft headline — unpublished";
const DRAFT_CTA = "Draft CTA";
const DRAFT_ANNOUNCEMENT = "Draft announcement: free shipping this weekend";
const DRAFT_BANNER = "草稿预览 · 未发布";

const DRAFT_SECTION_ID = "00000000-0000-7000-8000-00000000a001";
const DRAFT_SLIDE_ID = "00000000-0000-7000-8000-00000000a002";

function draftHeroSection(): HomepageSection {
  // Same fixture approach as HeroSlider.spec.tsx: build the slide from the
  // editor's emptySlide so heroCss gets the real element shapes, then apply
  // the draft copy plus the resolved linkHref the backend would emit.
  const slide = emptySlide(0);
  slide.id = DRAFT_SLIDE_ID;
  slide.name = "Draft slide";
  slide.elements.heading.text = DRAFT_HEADING;
  slide.elements.ctaPrimary.text = DRAFT_CTA;
  (slide.elements.ctaPrimary as { linkHref?: string | null }).linkHref = "/collections";
  return {
    id: DRAFT_SECTION_ID,
    type: "HERO",
    title: "Draft hero",
    subtitle: null,
    sortOrder: 0,
    payload: {
      behavior: { autoplay: false, transition: "FADE", arrows: false },
      slides: [slide],
    },
  };
}

function draftAnnouncement(): AnnouncementBlockView {
  return {
    enabled: true,
    rotationMs: 5000,
    items: [
      {
        id: "00000000-0000-7000-8000-00000000a003",
        text: DRAFT_ANNOUNCEMENT,
        linkHref: null,
        linkLabel: null,
        textColor: "#FFFFFF",
        backgroundColor: "#6b4f3a",
        enabled: true,
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stubs global fetch; `handler` may override either endpoint's answer. */
function stubFetch(
  handler?: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (handler) return handler(url);
    if (url.includes("/storefront/homepage")) {
      return jsonResponse({ sections: [draftHeroSection()] });
    }
    if (url.includes("/storefront/announcement")) return jsonResponse(draftAnnouncement());
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Loads the page component the way Next would (searchParams is a promise). */
function loadPreview(
  params: Record<string, string | string[] | undefined>,
): Promise<React.ReactElement> {
  return HomepagePreviewPage({ searchParams: Promise.resolve(params) });
}

async function renderPreview(
  params: Record<string, string | string[] | undefined> = { token: DRAFT_TOKEN },
): Promise<void> {
  const tree = await loadPreview(params);
  await act(async () => {
    render(tree);
  });
}

function fetchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
  vi.clearAllMocks();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HomepagePreviewPage token gate", () => {
  it("404s without a token search param", async () => {
    await expect(loadPreview({})).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFoundMock).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("404s with an empty token search param", async () => {
    await expect(loadPreview({ token: "" })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(notFoundMock).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("404s with a whitespace-only token search param", async () => {
    // Ruling 51: `?token=%20` must not reach the backend. A whitespace-only
    // token would otherwise pass the empty-string check, fetch with
    // `previewToken=%20`, get the backend's silent-fallback 200 (the live
    // document) and render it under the draft banner — misleading.
    await expect(loadPreview({ token: " " })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(notFoundMock).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("404s with a tabs/spaces/nbsp-only token search param", async () => {
    // `trim()` also clears tab, vertical tab _and_ non-breaking space
    // (Unicode WhiteSpace), so each of these must land in the missing/empty
    // 404 branch too, again before any fetch.
    const whitespaceVariants = ["\t", " \t ", "  ", "  \t "];
    for (const token of whitespaceVariants) {
      await expect(loadPreview({ token })).rejects.toThrow(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }
    expect(notFoundMock).toHaveBeenCalledTimes(whitespaceVariants.length);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("404s when either preview API answers non-200 (401 / 404)", async () => {
    stubFetch((url) =>
      url.includes("/storefront/homepage")
        ? new Response("Unauthorized", { status: 401 })
        : jsonResponse(draftAnnouncement()),
    );
    await expect(loadPreview({ token: DRAFT_TOKEN })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );

    stubFetch((url) =>
      url.includes("/storefront/announcement")
        ? new Response("Not Found", { status: 404 })
        : jsonResponse({ sections: [draftHeroSection()] }),
    );
    await expect(loadPreview({ token: DRAFT_TOKEN })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  it("404s when the preview API is unreachable", async () => {
    stubFetch(() => {
      throw new Error("backend down");
    });
    await expect(loadPreview({ token: DRAFT_TOKEN })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  it("404s with repeated token search params before any fetch", async () => {
    // `?token=a&token=b` arrives as an array. A String() coercion would send
    // "a,b" to the backend, whose silent fallback would then render the live
    // document under the draft banner — the gate must reject it first.
    await expect(loadPreview({ token: ["a", "b"] })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(notFoundMock).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("HomepagePreviewPage rendering", () => {
  it("renders the draft banner, announcement and sections from the token fetches", async () => {
    const fetchMock = stubFetch();

    await renderPreview();

    expect(screen.getByText(DRAFT_BANNER)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: DRAFT_HEADING }),
    ).toBeInTheDocument();
    expect(screen.getByText(DRAFT_ANNOUNCEMENT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: DRAFT_CTA })).toBeInTheDocument();

    // Both fetches hit the preview contract: the token rides in the URL and
    // the responses are never cached.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchUrls(fetchMock);
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`/api/v1/storefront/homepage?previewToken=${DRAFT_TOKEN}`),
        expect.stringContaining(`/api/v1/storefront/announcement?previewToken=${DRAFT_TOKEN}`),
      ]),
    );
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    }
    // No live-document fetch may slip in alongside the token fetches.
    expect(urls.every((url) => url.includes("previewToken="))).toBe(true);
  });

  it("hides the bar for the empty 200 body the backend sends when nothing is active", async () => {
    stubFetch((url) =>
      url.includes("/storefront/announcement")
        ? new Response("", { status: 200 })
        : jsonResponse({ sections: [draftHeroSection()] }),
    );

    await renderPreview();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: DRAFT_HEADING }),
    ).toBeInTheDocument();
  });

  it("hides the bar for a literal null 200 body", async () => {
    // Nest serializes a null service result as the JSON literal `null`.
    stubFetch((url) =>
      url.includes("/storefront/announcement")
        ? new Response("null", { status: 200, headers: { "Content-Type": "application/json" } })
        : jsonResponse({ sections: [draftHeroSection()] }),
    );

    await renderPreview();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: DRAFT_HEADING }),
    ).toBeInTheDocument();
  });

  it("hides the bar for a malformed JSON 200 body without failing the preview", async () => {
    // The bar is enhancement (same contract as the storefront layout): a 200
    // whose body cannot be parsed must not 404 the preview or crash it.
    stubFetch((url) =>
      url.includes("/storefront/announcement")
        ? new Response("{not-json", { status: 200 })
        : jsonResponse({ sections: [draftHeroSection()] }),
    );

    await renderPreview();

    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: DRAFT_HEADING }),
    ).toBeInTheDocument();
  });
});

describe("HomepagePreviewPage privacy controls", () => {
  it("marks the page noindex/nofollow", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("configures private no-store and no-referrer headers for the preview route", async () => {
    const config = (await import("../../../../next.config")).default;
    const rules = (await config.headers?.()) ?? [];
    const rule = rules.find((entry) => entry.source === "/preview/:path*");
    expect(rule).toBeDefined();
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ]),
    );

    // Next compiles the source with path-to-regexp; prove the declared rule
    // actually matches this route (and not a lookalike path).
    const compiled = buildCustomRoute("header", { source: rule!.source, headers: [] });
    const regex = new RegExp(compiled.regex);
    expect(regex.test("/preview/homepage")).toBe(true);
    expect(regex.test("/previews")).toBe(false);
  });

  it("mounts no MetaPixel or HomeTracking and fires no tracking calls", async () => {
    await renderPreview();

    expect(screen.queryByTestId("meta-pixel-init")).toBeNull();
    expect(screen.queryByTestId("home-tracking")).toBeNull();
    expect(document.querySelector('script[src*="fbevents"]')).toBeNull();
    expect(initMetaPixel).not.toHaveBeenCalled();

    // HeroSlider keeps its data-track-* attributes by contract, but without
    // the HomeTracking delegation a click must report nothing.
    const cta = screen.getByRole("link", { name: DRAFT_CTA });
    expect(cta).toHaveAttribute("data-track-event", "HeroClick");
    cta.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(cta);
    expect(trackCustom).not.toHaveBeenCalled();
  });

  it("never persists or logs the token", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const consoleSpies = (["log", "warn", "error", "info", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      await renderPreview();

      for (const [, value] of storageSpy.mock.calls) {
        expect(String(value ?? "")).not.toContain(DRAFT_TOKEN);
      }
      expect(document.cookie).not.toContain(DRAFT_TOKEN);
      // The token may only live in the server-side fetch URL — never in markup.
      expect(document.documentElement.outerHTML).not.toContain(DRAFT_TOKEN);
      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls) {
          expect(call.map(String).join(" ")).not.toContain(DRAFT_TOKEN);
        }
      }
      // And it did reach the API: the fetch URL carries it.
      expect(fetchUrls(vi.mocked(globalThis.fetch)).some((url) => url.includes(DRAFT_TOKEN))).toBe(
        true,
      );
    } finally {
      storageSpy.mockRestore();
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});
