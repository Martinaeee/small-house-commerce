import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { MessengerChat } from "./MessengerChat";

const NUDGE_KEY = "luwag_chat_nudge_dismissed";

function renderChat(overrides: Partial<SiteSettings> = {}) {
  return render(
    <SiteSettingsProvider
      settings={{
        ...DEFAULT_SITE_SETTINGS,
        messengerUrl: "",
        supportEmail: "",
        supportPhone: "",
        ...overrides,
      }}
    >
      <MessengerChat />
    </SiteSettingsProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 375,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 667,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.querySelectorAll("[data-test-open-dialog]").forEach((node) => node.remove());
});

describe("MessengerChat channels", () => {
  it("renders nothing when every support channel is empty", () => {
    renderChat();

    expect(screen.queryByTestId("messenger-chat-anchor")).toBeNull();
  });

  it.each([
    {
      settings: { messengerUrl: "https://m.me/luwag" },
      name: "Contact us on Messenger",
      href: "https://m.me/luwag",
      target: "_blank",
    },
    {
      settings: { supportEmail: "help@luwag.ph" },
      name: "Email support",
      href: "mailto:help@luwag.ph",
      target: null,
    },
    {
      settings: { supportPhone: "+63 917 123 4567" },
      name: "Call support",
      href: "tel:+639171234567",
      target: null,
    },
  ])("uses the only $name channel as the direct FAB action", ({ settings, name, href, target }) => {
    renderChat(settings);

    const action = screen.getByRole("link", { name });
    expect(action).toHaveAttribute("href", href);
    if (target) expect(action).toHaveAttribute("target", target);
    else expect(action).not.toHaveAttribute("target");
    expect(screen.queryByRole("button", { name: "Contact support" })).toBeNull();
  });

  it("toggles a keyboard-accessible stack for Messenger, email and phone", async () => {
    const user = userEvent.setup();
    renderChat({
      messengerUrl: "https://m.me/luwag",
      supportEmail: "help@luwag.ph",
      supportPhone: "(02) 8123-4567",
    });

    const fab = screen.getByRole("button", { name: "Contact support" });
    expect(fab).toHaveAttribute("aria-expanded", "false");
    await user.click(fab);
    expect(fab).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Messenger" })).toHaveAttribute(
      "href",
      "https://m.me/luwag",
    );
    expect(screen.getByRole("link", { name: "Messenger" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:help@luwag.ph",
    );
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute(
      "href",
      "tel:0281234567",
    );
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Close support options" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Messenger" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close support options" }));
    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Messenger" })).toBeNull();

    await user.click(fab);
    await user.keyboard("{Escape}");
    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(fab).toHaveFocus();
  });
});

describe("MessengerChat movement and visibility regressions", () => {
  function renderMultiChannel() {
    renderChat({
      messengerUrl: "https://m.me/luwag",
      supportEmail: "help@luwag.ph",
    });
    const fab = screen.getByRole("button", { name: "Contact support" });
    Object.defineProperty(fab, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(fab, "getBoundingClientRect").mockReturnValue({
      x: 280,
      y: 580,
      left: 280,
      top: 580,
      right: 336,
      bottom: 636,
      width: 56,
      height: 56,
      toJSON: () => ({}),
    } as DOMRect);
    return fab;
  }

  it("suppresses the click after a drag beyond five pixels", () => {
    const fab = renderMultiChannel();

    fireEvent.pointerDown(fab, { pointerId: 1, clientX: 300, clientY: 600 });
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: 307, clientY: 600 });
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: 307, clientY: 600 });
    fireEvent.click(fab);

    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("messenger-chat-anchor")).toHaveStyle({ left: "287px" });
  });

  it("hides on scroll and restores after the idle delay", () => {
    vi.useFakeTimers();
    const fab = renderMultiChannel();

    fireEvent.scroll(window);
    expect(fab.style.opacity).toBe("0");
    expect(fab.style.pointerEvents).toBe("none");
    act(() => vi.advanceTimersByTime(600));
    expect(fab.style.opacity).toBe("1");
    expect(fab.style.pointerEvents).toBe("");
  });

  it("clamps a dragged position after viewport resize", () => {
    const fab = renderMultiChannel();
    fireEvent.pointerDown(fab, { pointerId: 1, clientX: 300, clientY: 600 });
    fireEvent.pointerMove(fab, { pointerId: 1, clientX: 330, clientY: 640 });
    fireEvent.pointerUp(fab, { pointerId: 1, clientX: 330, clientY: 640 });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 100,
    });
    fireEvent(window, new Event("resize"));

    expect(screen.getByTestId("messenger-chat-anchor")).toHaveStyle({
      left: "32px",
      top: "32px",
    });
  });
});

describe("MessengerChat one-shot nudge", () => {
  it("opens the multi-channel stack after 45 seconds and persists one-shot dismissal", () => {
    vi.useFakeTimers();
    renderChat({
      messengerUrl: "https://m.me/luwag",
      supportEmail: "help@luwag.ph",
    });

    act(() => vi.advanceTimersByTime(44_999));
    expect(screen.queryByTestId("chat-nudge")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("chat-nudge")).toBeVisible();

    fireEvent.click(screen.getByTestId("chat-nudge-cta"));
    expect(screen.queryByTestId("chat-nudge")).toBeNull();
    expect(screen.getByRole("button", { name: "Contact support" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(sessionStorage.getItem(NUDGE_KEY)).toBe("1");
  });

  it("defers while a visible dialog is open and stays hidden after prior session dismissal", () => {
    vi.useFakeTimers();
    const dialog = document.createElement("div");
    dialog.dataset.testOpenDialog = "true";
    dialog.setAttribute("role", "dialog");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.append(dialog);
    const view = renderChat({ supportEmail: "help@luwag.ph" });

    act(() => vi.advanceTimersByTime(45_000));
    expect(screen.queryByTestId("chat-nudge")).toBeNull();
    dialog.remove();
    act(() => vi.advanceTimersByTime(45_000));
    expect(screen.getByTestId("chat-nudge")).toBeVisible();
    view.unmount();

    renderChat({ supportEmail: "help@luwag.ph" });
    act(() => vi.advanceTimersByTime(90_000));
    expect(screen.queryByTestId("chat-nudge")).toBeNull();
  });
});
