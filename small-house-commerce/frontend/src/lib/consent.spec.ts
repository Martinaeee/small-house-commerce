import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_CHANGED_EVENT,
  CONSENT_OPEN_EVENT,
  CONSENT_STORAGE_KEY,
  hasAdsConsent,
  onConsentChange,
  onConsentOpen,
  openConsentSettings,
  readConsentChoice,
  saveConsentChoice,
} from "./consent";

describe("cookie consent choice", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.consentTest = "1";
  });

  it("starts undecided, and an undecided visitor has no ads consent", () => {
    expect(readConsentChoice()).toBeNull();
    expect(hasAdsConsent()).toBe(false);
  });

  it("stores a granted choice and reports it", () => {
    saveConsentChoice("granted");
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("granted");
    expect(readConsentChoice()).toBe("granted");
    expect(hasAdsConsent()).toBe(true);
  });

  it("stores a denied choice", () => {
    saveConsentChoice("denied");
    expect(readConsentChoice()).toBe("denied");
    expect(hasAdsConsent()).toBe(false);
  });

  it("ignores corrupted stored values instead of treating them as consent", () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "yes-please");
    expect(readConsentChoice()).toBeNull();
  });

  it("announces a change so live listeners can react without reloading", () => {
    const listener = vi.fn();
    const off = onConsentChange(listener);
    const nativeListener = vi.fn();
    window.addEventListener(CONSENT_CHANGED_EVENT, nativeListener);

    saveConsentChoice("granted");

    expect(listener).toHaveBeenCalledWith("granted");
    expect(nativeListener).toHaveBeenCalledTimes(1);
    off();
    saveConsentChoice("denied");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("opens the settings surface on demand", () => {
    const listener = vi.fn();
    const off = onConsentOpen(listener);
    openConsentSettings();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    openConsentSettings();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still answers within the page when storage is unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    saveConsentChoice("granted");
    expect(hasAdsConsent()).toBe(true);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
