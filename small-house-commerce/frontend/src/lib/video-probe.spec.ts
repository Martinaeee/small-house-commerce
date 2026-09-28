import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeFailureMessageKey,
  probeVideo,
  type ProbeExecutor,
  type ProbeResult,
} from "@/lib/video-probe";

const file = () => new File(["video"], "hero.mp4", { type: "video/mp4" });
const execution = (overrides: Partial<ProbeResult> = {}) => ({
  durationSec: 12,
  width: 1920,
  height: 1080,
  posterBlob: new Blob(["poster"], { type: "image/jpeg" }),
  ...overrides,
});

describe("probeFailureMessageKey", () => {
  it.each(["DECODE", "SEEK", "FRAME", "TOO_LONG", "TOO_SMALL"] as const)(
    "maps %s to its typed homepage builder message key",
    (reason) => {
      expect(probeFailureMessageKey(reason)).toBe(
        `homepage_builder_video_error_${reason}`,
      );
    },
  );
});

describe("probeVideo validation and execution seam", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an injected 45 second result before any consumer can upload it", async () => {
    const executor: ProbeExecutor = vi.fn(async () =>
      execution({ durationSec: 45 }),
    );

    await expect(probeVideo(file(), executor)).resolves.toEqual({
      ok: false,
      reason: "TOO_LONG",
    });
  });

  it("rejects injected metadata below 1280 by 720", async () => {
    const executor: ProbeExecutor = vi.fn(async () =>
      execution({ width: 1279, height: 720 }),
    );

    await expect(probeVideo(file(), executor)).resolves.toEqual({
      ok: false,
      reason: "TOO_SMALL",
    });
  });

  it.each(["DECODE", "SEEK", "FRAME"] as const)(
    "maps a %s execution failure to the typed probe reason",
    async (reason) => {
      const executor: ProbeExecutor = vi.fn(async () => {
        throw Object.assign(new Error(reason), { reason });
      });

      await expect(probeVideo(file(), executor)).resolves.toEqual({
        ok: false,
        reason,
      });
    },
  );

  it("times out a stuck executor and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const executor: ProbeExecutor = vi.fn(
      async (_file, executionSignal) =>
        new Promise<ReturnType<typeof execution>>(() => {
          signal = executionSignal;
        }),
    );

    const pending = probeVideo(file(), executor);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "DECODE" });
    expect(signal?.aborted).toBe(true);
  });
});

describe("default browser probe cleanup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof URL.createObjectURL !== "function") {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: () => "blob:test",
      });
    }
    if (typeof URL.revokeObjectURL !== "function") {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: () => undefined,
      });
    }
  });

  it("uses and revokes an object URL and removes the hidden video after a successful frame", async () => {
    const objectUrl = "blob:hero";
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue(objectUrl);
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const realCreateElement = document.createElement.bind(document);
    let video: HTMLVideoElement | undefined;

    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName === "video") {
        video = realCreateElement("video");
        Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
        Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
        Object.defineProperty(video, "duration", { configurable: true, value: 8 });
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          get: () => 1,
          set: () => undefined,
        });
        video.load = () => {
          video?.dispatchEvent(new Event("loadedmetadata"));
          video?.dispatchEvent(new Event("seeked"));
        };
        return video;
      }
      if (tagName === "canvas") {
        const canvas = realCreateElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue({
          drawImage: vi.fn(),
        } as unknown as CanvasRenderingContext2D);
        vi.spyOn(canvas, "toBlob").mockImplementation((callback) => {
          callback(new Blob(["poster"], { type: "image/jpeg" }));
        });
        return canvas;
      }
      return realCreateElement(tagName, options);
    });

    const result = await probeVideo(file());

    expect(result.ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(File));
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    expect(video).toBeDefined();
    expect(video?.isConnected).toBe(false);
  });

  it("maps a browser metadata timeout and still revokes the object URL", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stuck");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName === "video") return Object.assign(realCreateElement("video"), { load: vi.fn() });
      return realCreateElement(tagName, options);
    });

    const pending = probeVideo(file());
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "DECODE" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stuck");
  });
});
