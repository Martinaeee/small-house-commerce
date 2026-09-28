import type { TKey } from "@/lib/admin-i18n";

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_POSTER_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SEC = 30;
export const MIN_VIDEO_WIDTH = 1280;
export const MIN_VIDEO_HEIGHT = 720;
export const VIDEO_PROBE_TIMEOUT_MS = 10_000;

export type ProbeFailureReason = "DECODE" | "SEEK" | "FRAME" | "TOO_LONG" | "TOO_SMALL";

export type ProbeResult =
  | {
      ok: true;
      durationSec: number;
      width: number;
      height: number;
      posterBlob: Blob;
    }
  | { ok: false; reason: ProbeFailureReason };

export type ProbeExecution = {
  durationSec: number;
  width: number;
  height: number;
  posterBlob: Blob;
};

export type ProbeExecutor = (
  file: File,
  signal: AbortSignal,
) => Promise<ProbeExecution>;

export type VideoFileValidation = "INVALID_TYPE" | "TOO_LARGE";

const FAILURE_MESSAGE_KEYS: Record<ProbeFailureReason, TKey> = {
  DECODE: "homepage_builder_video_error_DECODE",
  SEEK: "homepage_builder_video_error_SEEK",
  FRAME: "homepage_builder_video_error_FRAME",
  TOO_LONG: "homepage_builder_video_error_TOO_LONG",
  TOO_SMALL: "homepage_builder_video_error_TOO_SMALL",
};

class ProbeFailure extends Error {
  readonly reason: ProbeFailureReason;

  constructor(reason: ProbeFailureReason) {
    super(reason);
    this.name = "ProbeFailure";
    this.reason = reason;
  }
}

export function probeFailureMessageKey(reason: ProbeFailureReason): TKey {
  return FAILURE_MESSAGE_KEYS[reason];
}

/**
 * The picker is only a first-pass MP4 gate. Compatibility is established by
 * probeVideo's real decode/seek/frame pipeline, never by canPlayType().
 */
export function isMp4File(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const mime = file.type.toLowerCase().split(";", 1)[0] ?? "";
  return (
    extension === "mp4" &&
    (mime === "" || mime === "video/mp4" || mime === "application/octet-stream")
  );
}

export function validateVideoFile(file: File): VideoFileValidation | null {
  if (!isMp4File(file)) return "INVALID_TYPE";
  if (file.size > MAX_VIDEO_BYTES) return "TOO_LARGE";
  return null;
}

function reasonFromError(error: unknown): ProbeFailureReason {
  if (error instanceof ProbeFailure) return error.reason;
  if (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "string" &&
    error.reason in FAILURE_MESSAGE_KEYS
  ) {
    return error.reason as ProbeFailureReason;
  }
  return "DECODE";
}

function timeoutReason(stage: ProbeFailureReason): ProbeFailure {
  return new ProbeFailure(stage);
}

/**
 * Probe a local video before it can enter the upload pipeline. The executor
 * seam keeps metadata-limit and stage failures unit-testable while the default
 * executor remains a real hidden-video/object-URL browser implementation.
 */
export async function probeVideo(
  file: File,
  executor: ProbeExecutor = defaultProbeExecutor,
): Promise<ProbeResult> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(timeoutReason("DECODE"));
      }, VIDEO_PROBE_TIMEOUT_MS);
    });
    const execution = await Promise.race([executor(file, controller.signal), timedOut]);
    if (
      !Number.isFinite(execution.durationSec) ||
      !Number.isFinite(execution.width) ||
      !Number.isFinite(execution.height)
    ) {
      return { ok: false, reason: "DECODE" };
    }
    if (execution.durationSec > MAX_VIDEO_DURATION_SEC) {
      return { ok: false, reason: "TOO_LONG" };
    }
    if (
      execution.width < MIN_VIDEO_WIDTH ||
      execution.height < MIN_VIDEO_HEIGHT
    ) {
      return { ok: false, reason: "TOO_SMALL" };
    }
    return { ok: true, ...execution };
  } catch (error: unknown) {
    return { ok: false, reason: reasonFromError(error) };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    controller.abort();
  }
}

const hiddenVideoStyle = {
  position: "fixed",
  width: "1px",
  height: "1px",
  opacity: "0",
  pointerEvents: "none",
  left: "-10000px",
  top: "-10000px",
};

function defaultProbeExecutor(file: File, signal: AbortSignal): Promise<ProbeExecution> {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return Promise.reject(new ProbeFailure("DECODE"));
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch {
    return Promise.reject(new ProbeFailure("DECODE"));
  }

  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  Object.assign(video.style, hiddenVideoStyle);

  return new Promise<ProbeExecution>((resolve, reject) => {
    let stage: ProbeFailureReason = "DECODE";
    let settled = false;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      video.removeAttribute("src");
      video.remove();
      URL.revokeObjectURL(objectUrl);
    };

    const succeed = (execution: ProbeExecution): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(execution);
    };

    const fail = (reason: ProbeFailureReason): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProbeFailure(reason));
    };

    const onLoadedMetadata = (): void => {
      const durationSec = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!Number.isFinite(durationSec)) {
        fail("DECODE");
        return;
      }
      if (durationSec > MAX_VIDEO_DURATION_SEC) {
        fail("TOO_LONG");
        return;
      }
      if (width < MIN_VIDEO_WIDTH || height < MIN_VIDEO_HEIGHT) {
        fail("TOO_SMALL");
        return;
      }
      stage = "SEEK";
      try {
        video.currentTime = 1;
      } catch {
        fail("SEEK");
      }
    };

    const onSeeked = (): void => {
      stage = "FRAME";
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      let context: CanvasRenderingContext2D | null;
      try {
        context = canvas.getContext("2d");
        if (!context) {
          fail("FRAME");
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (posterBlob) => {
            if (!posterBlob) {
              fail("FRAME");
              return;
            }
            succeed({
              durationSec: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
              posterBlob,
            });
          },
          "image/jpeg",
          0.85,
        );
      } catch {
        fail("FRAME");
      }
    };

    const onError = (): void => fail(stage);
    const onAbort = (): void => fail(stage);
    const timer = setTimeout(() => fail(stage), VIDEO_PROBE_TIMEOUT_MS);

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      document.body.append(video);
      video.src = objectUrl;
      video.load();
    } catch {
      fail(stage);
    }
  });
}
