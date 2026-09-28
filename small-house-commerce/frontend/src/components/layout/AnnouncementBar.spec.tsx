import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnouncementBlockView, AnnouncementItemView } from "@/lib/api";
import { AnnouncementBar } from "./AnnouncementBar";

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
    linkHref: null,
    linkLabel: null,
    textColor: "#FFFFFF",
    backgroundColor: "#6b4f3a",
    enabled: true,
    ...patch,
  };
}

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
    // Accessible name = item text + linkLabel.
    expect(link).toHaveTextContent("Message 1");
    expect(link).toHaveTextContent("Shop Now");

    view.rerender(<AnnouncementBar data={block([item(0)])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(visibleText()).toBe("Message 1");

    // A label without a resolved href is a dangling CTA: plain text, no suffix.
    view.rerender(<AnnouncementBar data={block([item(0, { linkLabel: "Shop Now" })])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(visibleText()).toBe("Message 1");
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
    expect(node.style.backgroundColor).toBe("rgb(107, 79, 58)"); // #6b4f3a
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
