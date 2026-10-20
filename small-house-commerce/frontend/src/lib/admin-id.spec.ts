import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./admin-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

  it("falls back to unique UUID v4 ids on plain http where randomUUID is undefined", () => {
    vi.restoreAllMocks();
    // Simulate a non-secure context: the API does not exist at all.
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined, configurable: true,
    });
    const first = newId();
    const second = newId();
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    // Persisted document ids are validated as UUIDs by the backend.
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
    expect(typeof globalThis.crypto.randomUUID).toBe("function");
  });

  it("still returns a UUID v4 when getRandomValues is unavailable too", () => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined, configurable: true,
    });
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      value: undefined, configurable: true,
    });
    const id = newId();
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    delete (globalThis.crypto as { getRandomValues?: unknown }).getRandomValues;
    expect(id).toMatch(UUID_V4);
  });
});
