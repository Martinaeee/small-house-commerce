import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./admin-id";

describe("newId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses crypto.randomUUID when available", () => {
    const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-7000-8000-000000000001",
    );
    expect(newId()).toBe("00000000-0000-7000-8000-000000000001");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("falls back to a unique local id on plain http where randomUUID is undefined", () => {
    vi.restoreAllMocks();
    // Simulate a non-secure context: the API does not exist at all.
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined, configurable: true,
    });
    const first = newId();
    const second = newId();
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    expect(first).toMatch(/^id-[a-z0-9]+-[a-z0-9]+$/);
    expect(second).toMatch(/^id-[a-z0-9]+-[a-z0-9]+$/);
    expect(first).not.toBe(second);
    expect(typeof globalThis.crypto.randomUUID).toBe("function");
  });
});
