import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnouncementBlockView, AnnouncementItemView } from "@/lib/api";
import { requestNewsletterOffer } from "@/components/newsletter/newsletterOfferChannel";
import { AnnouncementBar } from "./AnnouncementBar";

vi.mock("@/components/newsletter/newsletterOfferChannel", () => ({
  requestNewsletterOffer: vi.fn(),
}));

// Task 20 storefront announcement contract (spec §6.2): the bar renders one
// visible line at a time; null data / disabled block / zero enabled items
// render nothing; multiple items rotate on rotationMs with hover pause and a
// prefers-reduced-motion off-switch; item colors are re-clamped through
// safeHex; an item with linkHref renders as a whole-item link with the
// linkLabel as a text suffix. The server already filtered by enablement and
// schedule, so the component only re-checks enablement (defense in depth).

const ROTATION_MS = 5000;

const IDS = [
  "00000000-0000-7000-8000-000000000021",
  "00000000-0000-7000-8000-000000000022",
  "00000000-0000-7000-8000-000000000023",
];

function item(
  index: number,
  patch: Partial<AnnouncementItemView> = {},
): AnnouncementItemView {
  return {
    id: IDS[index],
    text: `Message ${index + 1}`,
    link: null,
    linkHref: null,
    linkLabel: null,
    textColor: "#FFFFFF",
    backgroundColor: "#6b4f3a",
    schedule: { publishAt: null, unpublishAt: null },
    enabled: true,
    sortOrder: index,
    ...patch,
  };
}

/** Rich-text copy in the editor's document shape. */
const RICH_CONTENT = {
  version: 1 as const,
  doc: {
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        attrs: { textAlign: "center" as const },
        content: [{ type: "text" as const, text: "More room, better deals" }],
      },
    ],
  },
};

function block(
  items: AnnouncementItemView[],
  patch: Partial<Omit<AnnouncementBlockView, "items">> = {},
): AnnouncementBlockView {
  return { enabled: true, rotationMs: ROTATION_MS, items, ...patch };
}

function bar(): HTMLElement {
  const node = document.querySelector("[data-announcement-bar]");
  if (!(node instanceof HTMLElement)) {
    throw new Error("missing announcement bar root");
  }
  return node;
}

function visibleText(): string {
  return bar().textContent?.trim() ?? "";
}

function reducedMotionStub(): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AnnouncementBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(requestNewsletterOffer).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders nothing for null data, a disabled block, or only disabled items", () => {
    const view = render(<AnnouncementBar data={null} />);
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(<AnnouncementBar data={block([item(0)], { enabled: false })} />);
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(
      <AnnouncementBar
        data={block([item(0, { enabled: false }), item(1, { enabled: false })])}
      />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("renders a single enabled item statically without scheduling rotation", async () => {
    render(<AnnouncementBar data={block([item(0)])} />);

    expect(visibleText()).toBe("Message 1");
    await advance(ROTATION_MS * 3);
    expect(visibleText()).toBe("Message 1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hides a future-scheduled item until its publish time", async () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            schedule: {
              publishAt: new Date(now.getTime() + 1000).toISOString(),
              unpublishAt: null,
            },
          }),
        ])}
      />,
    );

    await advance(0);
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    await advance(999);
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    await advance(1);
    expect(visibleText()).toBe("Message 1");
  });

  it("rotates through enabled items on the configured interval and wraps", async () => {
    render(
      <AnnouncementBar
        data={block([item(0), item(1, { enabled: false }), item(2)])}
      />,
    );

    expect(visibleText()).toBe("Message 1");
    await advance(ROTATION_MS);
    expect(visibleText()).toBe("Message 3"); // disabled item skipped
    await advance(ROTATION_MS);
    expect(visibleText()).toBe("Message 1"); // wraps
  });

  it("pauses rotation while hovered and resumes on leave", async () => {
    render(<AnnouncementBar data={block([item(0), item(1)])} />);

    fireEvent.mouseEnter(bar());
    await advance(ROTATION_MS * 3);
    expect(visibleText()).toBe("Message 1");

    fireEvent.mouseLeave(bar());
    await advance(ROTATION_MS);
    expect(visibleText()).toBe("Message 2");
  });

  it("clears a stale hover pause when data swaps to no items and back", async () => {
    // Minor 2 fix round: the bar unmounts its div (no mouseleave fires) when
    // data revalidates to zero enabled items while hovered; the pause must
    // not stick to the same component instance when items come back.
    const view = render(<AnnouncementBar data={block([item(0), item(1)])} />);

    fireEvent.mouseEnter(bar());
    await advance(ROTATION_MS * 2);
    expect(visibleText()).toBe("Message 1"); // hover pause active

    view.rerender(<AnnouncementBar data={null} />);
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();

    view.rerender(<AnnouncementBar data={block([item(0), item(1)])} />);
    expect(vi.getTimerCount()).toBe(1);
    await advance(ROTATION_MS);
    expect(visibleText()).toBe("Message 2");
  });

  it("shows only the first enabled item under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(reducedMotionStub()));
    render(<AnnouncementBar data={block([item(0), item(1), item(2)])} />);

    expect(visibleText()).toBe("Message 1");
    await advance(ROTATION_MS * 3);
    expect(visibleText()).toBe("Message 1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders the whole item as a link only when linkHref exists, with the linkLabel as suffix", () => {
    const view = render(
      <AnnouncementBar
        data={block([
          item(0, { linkHref: "/collections/living-room", linkLabel: "Shop Now" }),
        ])}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/collections/living-room");
    // Minor 1 fix round: the label must be a separate token — an explicit
    // separator, not a Babel-stripped JSX newline (which rendered the
    // accessible name as "Message 1Shop Now").
    expect(link.textContent).toBe("Message 1 Shop Now");
    expect(screen.getByRole("link", { name: "Message 1 Shop Now" })).toBe(link);

    view.rerender(<AnnouncementBar data={block([item(0)])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(visibleText()).toBe("Message 1");

    // A label without a resolved href is a dangling CTA: plain text, no suffix.
    view.rerender(<AnnouncementBar data={block([item(0, { linkLabel: "Shop Now" })])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(visibleText()).toBe("Message 1");
  });

  it("makes the whole bar clickable for a rich item whose link has no label", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            content: RICH_CONTENT,
            linkHref: "/collections/living-room",
            linkLabel: null,
          }),
        ])}
      />,
    );

    // The bar itself is the affordance: one anchor wrapping the copy, no
    // dangling suffix and no nested links.
    const links = document.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/collections/living-room");
    expect(link.textContent).toContain("More room, better deals");
  });

  it("keeps a rich item's CTA label as plain text inside the whole-bar link", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            content: RICH_CONTENT,
            linkHref: "/collections/living-room",
            linkLabel: "Shop Now",
          }),
        ])}
      />,
    );

    const links = document.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/collections/living-room");
    // The anchor wraps the copy itself, not just the trailing label.
    expect(link.textContent).toContain("More room, better deals");
    expect(link.textContent).toContain("Shop Now");
  });


  it("re-clamps item colors through safeHex before they reach the style attribute", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            textColor: "red; background: url(javascript:alert(1))",
            backgroundColor: "not-a-color",
          }),
        ])}
      />,
    );

    const node = bar();
    expect(node.style.color).toBe("rgb(255, 255, 255)");
    expect(node.style.backgroundColor).toBe("rgb(36, 76, 60)"); // #244c3c
    const styleAttr = node.getAttribute("style") ?? "";
    expect(styleAttr).not.toContain("javascript");
    expect(styleAttr).not.toContain("not-a-color");
  });

  it("passes whitelisted hex colors through unchanged", () => {
    render(
      <AnnouncementBar
        data={block([item(0, { textColor: "#112233", backgroundColor: "#E8EEF4" })])}
      />,
    );

    expect(bar().style.color).toBe("rgb(17, 34, 51)");
    expect(bar().style.backgroundColor).toBe("rgb(232, 238, 244)");
  });

  it("renders validated rich typography as React elements with a separate CTA", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            text: "Rich message",
            content: {
              version: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    attrs: { textAlign: "right" },
                    content: [
                      {
                        type: "text",
                        text: "Rich ",
                        marks: [{ type: "bold" }, { type: "italic" }],
                      },
                      {
                        type: "text",
                        text: "message",
                        marks: [
                          {
                            type: "textStyle",
                            attrs: {
                              color: "#112233",
                              fontFamily: "POPPINS",
                              fontSize: "LG",
                            },
                          },
                          { type: "highlight", attrs: { color: "#FFF2AA" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
            link: { type: "INTERNAL", path: "/sale" },
            linkHref: "/sale",
            linkLabel: "Shop now",
          }),
        ])}
      />,
    );

    const rich = screen.getByText(
      (_content, element) =>
        element?.tagName === "SPAN" &&
        element.childElementCount === 0 &&
        element.textContent === "Rich ",
    );
    expect(rich.closest("strong")).not.toBeNull();
    expect(rich.closest("em")).not.toBeNull();
    const styled = screen.getByText("message");
    expect(styled).toHaveStyle({
      color: "rgb(17, 34, 51)",
      backgroundColor: "rgb(255, 242, 170)",
      fontSize: "16px",
    });
    expect(styled.closest("[data-announcement-paragraph]")).toHaveStyle({
      textAlign: "right",
    });
    // The whole bar is the link: it wraps the rich copy and the label, and
    // the label stays plain text inside it (no nested anchor).
    const cta = screen.getByRole("link", { name: /Shop now/ });
    expect(cta).toHaveAttribute("href", "/sale");
    expect(cta).toContainElement(rich);
  });

  it("falls back to safe plain text when rich content is malformed", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            text: "Safe fallback",
            content: {
              version: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "script",
                    attrs: { textAlign: "center" },
                    content: [{ type: "text", text: "Injected" }],
                  },
                ],
              },
            } as never,
          }),
        ])}
      />,
    );

    expect(visibleText()).toBe("Safe fallback");
    expect(screen.queryByText("Injected")).toBeNull();
  });

  it("formats and styles announcement countdowns with explicit device units", () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    const countdownItem = item(0, {
      countdown: {
        endsAt: new Date(
          now.getTime() + ((1 * 24 + 2) * 60 * 60 + 6 * 60 + 44) * 1000,
        ).toISOString(),
        color: "#112233",
        fontFamily: "POPPINS",
        fontSize: "LG",
        fontWeight: 800,
      },
    });
    const view = render(
      <AnnouncementBar data={block([countdownItem])} device="desktop" />,
    );

    expect(screen.queryByRole("timer")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("1 DAY 02 HR 06 MIN 44 SEC");
    expect(timer).toHaveStyle({
      color: "rgb(17, 34, 51)",
      fontSize: "16px",
      fontWeight: "800",
    });

    view.rerender(
      <AnnouncementBar data={block([countdownItem])} device="mobile" />,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("1D 02H 06M 44S");
  });

  it("chunks far-future deadline timers within the JavaScript timeout limit", () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            countdown: {
              endsAt: "2099-10-14T00:00:00.000Z",
              color: null,
              fontFamily: "SANS",
              fontSize: "MD",
              fontWeight: 700,
            },
          }),
        ])}
      />,
    );

    const delays = timeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === "number");
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2_147_483_647);
  });

  it("removes expired items exactly at their deadlines without a blank frame", async () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            text: "First",
            countdown: {
              endsAt: new Date(now.getTime() + 1000).toISOString(),
              color: null,
              fontFamily: "SANS",
              fontSize: "MD",
              fontWeight: 700,
            },
          }),
          item(1, {
            text: "Second",
            countdown: {
              endsAt: new Date(now.getTime() + 2000).toISOString(),
              color: null,
              fontFamily: "SANS",
              fontSize: "MD",
              fontWeight: 700,
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("First")).toBeInTheDocument();
    await advance(999);
    expect(screen.getByText("First")).toBeInTheDocument();
    await advance(1);
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeInTheDocument();
    await advance(1000);
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
  });

  it("stops second ticks after the last countdown even when a later schedule deadline remains", async () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            schedule: {
              publishAt: null,
              unpublishAt: new Date(now.getTime() + 60_000).toISOString(),
            },
            countdown: {
              endsAt: new Date(now.getTime() + 1000).toISOString(),
              color: null,
              fontFamily: "SANS",
              fontSize: "MD",
              fontWeight: 700,
            },
          }),
        ])}
      />,
    );

    await advance(1000);
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("rechecks absolute deadlines when the document becomes visible", () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    vi.setSystemTime(now);
    render(
      <AnnouncementBar
        data={block([
          item(0, {
            text: "Expires while hidden",
            countdown: {
              endsAt: new Date(now.getTime() + 5000).toISOString(),
              color: null,
              fontFamily: "SANS",
              fontSize: "MD",
              fontWeight: 700,
            },
          }),
        ])}
      />,
    );

    vi.setSystemTime(new Date(now.getTime() + 6000));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(document.querySelector("[data-announcement-bar]")).toBeNull();
  });

  it("removes link semantics from rich and legacy items in preview mode", () => {
    render(
      <AnnouncementBar
        mode="preview"
        data={block([
          item(0, {
            text: "Preview message",
            link: { type: "INTERNAL", path: "/sale" },
            linkHref: "/sale",
            linkLabel: "Shop now",
          }),
        ])}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(visibleText()).toBe("Preview message Shop now");
  });

  it("opens the subscribe popup when the item links to the subscribe popup", () => {
    render(
      <AnnouncementBar
        data={block([
          item(0, { link: { type: "SUBSCRIBE" }, linkHref: null }),
        ])}
      />,
    );

    // The whole line is the trigger: the popup is the destination, not a URL.
    const trigger = screen.getByRole("button", { name: /Message 1/ });
    fireEvent.click(trigger);
    expect(requestNewsletterOffer).toHaveBeenCalledTimes(1);
  });

  it("opens the subscribe popup from the link label and keeps it inert in preview", () => {
    const view = render(
      <AnnouncementBar
        data={block([
          item(0, {
            link: { type: "SUBSCRIBE" },
            linkHref: null,
            linkLabel: "New here?",
          }),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New here?" }));
    expect(requestNewsletterOffer).toHaveBeenCalledTimes(1);

    view.rerender(
      <AnnouncementBar
        mode="preview"
        data={block([
          item(0, {
            link: { type: "SUBSCRIBE" },
            linkHref: null,
            linkLabel: "New here?",
          }),
        ])}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("clears the rotation interval on unmount", () => {
    const view = render(<AnnouncementBar data={block([item(0), item(1)])} />);

    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to the default interval for a zero rotationMs instead of spinning", async () => {
    render(<AnnouncementBar data={block([item(0), item(1)], { rotationMs: 0 })} />);

    await advance(1);
    expect(visibleText()).toBe("Message 1");
    await advance(4998); // t = 4999ms
    expect(visibleText()).toBe("Message 1");
    await advance(1); // t = 5000ms
    expect(visibleText()).toBe("Message 2");
  });

  it("clamps a sub-floor rotationMs up to the rotation floor", async () => {
    render(<AnnouncementBar data={block([item(0), item(1)], { rotationMs: 500 })} />);

    await advance(1999);
    expect(visibleText()).toBe("Message 1");
    await advance(1);
    expect(visibleText()).toBe("Message 2");
  });
});
