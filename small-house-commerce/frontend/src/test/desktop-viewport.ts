import { vi } from "vitest";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Drives `useDesktopViewport` in jsdom. Returns a setter that flips the lg
 * breakpoint and fires the change listeners, exactly like a resize would.
 */
export function installDesktopViewport(initialDesktop = true) {
  let desktop = initialDesktop;
  const listeners = new Set<() => void>();
  const original = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList => {
    if (query !== DESKTOP_QUERY) return original(query);
    return {
      matches: desktop,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
  return (next: boolean) => {
    desktop = next;
    listeners.forEach((listener) => listener());
  };
}
