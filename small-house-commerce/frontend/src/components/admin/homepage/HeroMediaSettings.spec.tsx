import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { HeroMediaSettings } from "@/components/admin/homepage/HeroMediaSettings";
import {
  emptyDocument,
  type HeroMedia,
  type HomepageDocument,
} from "@/lib/homepage-document";
import type { ProbeResult } from "@/lib/video-probe";

const probeVideoMock = vi.hoisted(() => vi.fn());
const uploadImageMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/video-probe", () => ({
  probeVideo: probeVideoMock,
  probeFailureMessageKey: (reason: string) =>
    `homepage_builder_video_error_${reason}`,
  isMp4File: (file: File) =>
    file.name.toLowerCase().endsWith(".mp4") &&
    (!file.type || file.type === "video/mp4" || file.type === "application/octet-stream"),
  validateVideoFile: (file: File) => {
    if (
      !file.name.toLowerCase().endsWith(".mp4") ||
      (file.type && file.type !== "video/mp4" && file.type !== "application/octet-stream")
    ) {
      return "INVALID_TYPE";
    }
    return file.size > 100 * 1024 * 1024 ? "TOO_LARGE" : null;
  },
  MAX_POSTER_BYTES: 5 * 1024 * 1024,
}));

vi.mock("@/lib/admin-api", () => ({
  adminApi: { uploadImage: uploadImageMock },
}));

const SLIDE_ID = "00000000-0000-7000-8000-000000000010";

function imageMedia(url = "/uploads/hero.jpg"): HeroMedia {
  return {
    type: "IMAGE",
    image: { url, alt: "Hero image" },
    video: null,
    mobileOverride: { enabled: false, image: null, video: null },
    fit: "COVER",
    focal: { x: 50, y: 50 },
    objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
  };
}

function videoMedia(url = "/uploads/hero.mp4"): HeroMedia {
  return {
    ...imageMedia(),
    type: "VIDEO",
    image: null,
    video: {
      url,
      poster: "/uploads/hero-poster.jpg",
      autoplay: true,
      muted: true,
      loop: true,
      playsInline: true,
      showSoundToggle: false,
      pauseOffscreen: true,
    },
  };
}

function documentWithMedia(media: HeroMedia | null): HomepageDocument {
  const document = emptyDocument();
  const hero = document.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects hero");
  hero.payload.slides[0].id = SLIDE_ID;
  hero.payload.slides[0].media = media;
  return document;
}

function Harness({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch, setSelectedSlideId } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 1, savedAt: null });
    setSelectedSlideId(SLIDE_ID);
  }, [dispatch, document, setSelectedSlideId]);
  return null;
}

function StateProbe(): ReactNode {
  const { state, safeAreaFlags } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slide = hero?.type === "HERO" ? hero.payload.slides[0] : null;
  return (
    <>
      <pre data-testid="media-state">{JSON.stringify(slide?.media ?? null)}</pre>
      <pre data-testid="safe-area-state">{JSON.stringify(safeAreaFlags)}</pre>
    </>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderPanel(document: HomepageDocument) {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Harness document={document} />
        <HeroMediaSettings />
        <StateProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function mediaState(): HeroMedia | null {
  return JSON.parse(screen.getByTestId("media-state").textContent ?? "null") as HeroMedia | null;
}

function setPreviewRect(element: HTMLElement): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 100, height: 100, right: 110, bottom: 120 }),
  });
}

describe("HeroMediaSettings", () => {
  beforeEach(() => {
    setAdminLang("en");
    probeVideoMock.mockReset();
    uploadImageMock.mockReset();
    uploadImageMock.mockImplementation(async (_file: File, contentType: string) => ({
      url: contentType === "image/jpeg" ? "/uploads/generated-poster.jpg" : "/uploads/hero.mp4",
      key: "key",
    }));
  });

  it("preserves independent image and video slots when switching type", async () => {
    const media = videoMedia();
    media.image = { url: "/uploads/kept-image.jpg", alt: "Kept" };
    renderPanel(documentWithMedia(media));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    expect(mediaState()?.type).toBe("IMAGE");
    expect(mediaState()?.image?.url).toBe("/uploads/kept-image.jpg");

    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(mediaState()?.type).toBe("VIDEO");
    expect(screen.getByTestId("video-url")).toHaveTextContent("/uploads/hero.mp4");
  });

  it("rejects a wrong type, wrong extension, and oversized video before probing or upload", async () => {
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    const input = screen.getByLabelText("Video file");

    fireEvent.change(input, {
      target: { files: [new File(["x"], "hero.webm", { type: "video/webm" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("MP4");
    expect(probeVideoMock).not.toHaveBeenCalled();
    expect(uploadImageMock).not.toHaveBeenCalled();

    const oversized = new File(["x"], "hero.mp4", { type: "video/mp4" });
    Object.defineProperty(oversized, "size", { configurable: true, value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("100MB");
    expect(probeVideoMock).not.toHaveBeenCalled();
    expect(uploadImageMock).not.toHaveBeenCalled();
  });

  it("rejects a 45 second probe result and uploads neither video nor poster", async () => {
    probeVideoMock.mockResolvedValue({ ok: false, reason: "TOO_LONG" } satisfies ProbeResult);
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByLabelText("Video file"), {
      target: { files: [new File(["x"], "hero.mp4", { type: "video/mp4" })] },
    });

    expect(await screen.findByText("The video is longer than 30 seconds. Upload a video up to 30 seconds.")).toBeVisible();
    expect(probeVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(mediaState()?.type).toBe("IMAGE");
  });

  it("probes before uploading the poster and video, then writes both URLs", async () => {
    probeVideoMock.mockResolvedValue({
      ok: true,
      durationSec: 12,
      width: 1920,
      height: 1080,
      posterBlob: new Blob(["poster"], { type: "image/jpeg" }),
    } satisfies ProbeResult);
    uploadImageMock
      .mockResolvedValueOnce({ url: "/uploads/poster.jpg", key: "poster" })
      .mockResolvedValueOnce({ url: "/uploads/video.mp4", key: "video" });
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    const file = new File(["video"], "hero.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Video file"), { target: { files: [file] } });
    await settle();

    expect(probeVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImageMock).toHaveBeenCalledTimes(2);
    expect(probeVideoMock.mock.invocationCallOrder[0]).toBeLessThan(
      uploadImageMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(uploadImageMock.mock.calls[0]?.[1]).toBe("image/jpeg");
    expect(uploadImageMock.mock.calls[1]?.[1]).toBe("video/mp4");
    expect(mediaState()?.type).toBe("VIDEO");
    expect(mediaState()?.video).toMatchObject({ url: "/uploads/video.mp4", poster: "/uploads/poster.jpg" });
  });

  it("rejects an extracted poster over 5MB before uploading either asset", async () => {
    const oversizedPoster = new Blob(["poster"], { type: "image/jpeg" });
    Object.defineProperty(oversizedPoster, "size", {
      configurable: true,
      value: 5 * 1024 * 1024 + 1,
    });
    probeVideoMock.mockResolvedValueOnce({
      ok: true,
      durationSec: 12,
      width: 1920,
      height: 1080,
      posterBlob: oversizedPoster,
    } satisfies ProbeResult);
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByLabelText("Video file"), {
      target: { files: [new File(["video"], "hero.mp4", { type: "video/mp4" })] },
    });

    expect(await screen.findByText("Poster must be 5MB or smaller.")).toBeVisible();
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(mediaState()?.type).toBe("IMAGE");
  });

  it("does not write a video when the generated poster upload fails", async () => {
    probeVideoMock.mockResolvedValue({
      ok: true,
      durationSec: 12,
      width: 1920,
      height: 1080,
      posterBlob: new Blob(["poster"], { type: "image/jpeg" }),
    } satisfies ProbeResult);
    uploadImageMock.mockRejectedValueOnce(new Error("poster failed"));
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.change(screen.getByLabelText("Video file"), {
      target: { files: [new File(["video"], "hero.mp4", { type: "video/mp4" })] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Media upload failed. Try again.");
    expect(uploadImageMock).toHaveBeenCalledTimes(1);
    expect(mediaState()?.type).toBe("IMAGE");
  });

  it("hides mobile override controls while off and reveals them when enabled", async () => {
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    expect(screen.queryByRole("button", { name: "Mobile video" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Use separate mobile media" }));
    expect(screen.getByRole("button", { name: "Mobile video" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mobile image" })).toBeVisible();
  });

  it("uses the same probe gate for a mobile video", async () => {
    probeVideoMock.mockResolvedValue({ ok: false, reason: "TOO_SMALL" } satisfies ProbeResult);
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use separate mobile media" }));
    fireEvent.click(screen.getByRole("button", { name: "Mobile video" }));
    fireEvent.change(screen.getByLabelText("Mobile video file"), {
      target: { files: [new File(["video"], "mobile.mp4", { type: "video/mp4" })] },
    });

    expect(await screen.findByText("The video is below 1280×720. Upload a higher-resolution video.")).toBeVisible();
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(mediaState()?.mobileOverride.video).toBeNull();
  });

  it("clamps focal and per-device object-position clicks, and resets to focal", async () => {
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    const focal = screen.getByTestId("hero-media-focal-point");
    setPreviewRect(focal);
    fireEvent.click(focal, { clientX: 999, clientY: -100 });
    expect(mediaState()?.focal).toEqual({ x: 100, y: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    const objectPosition = screen.getByTestId("hero-media-object-position");
    setPreviewRect(objectPosition);
    fireEvent.click(objectPosition, { clientX: 15, clientY: 95 });
    expect(mediaState()?.objectPosition.tablet).toEqual({ x: 5, y: 75 });

    fireEvent.click(screen.getByRole("button", { name: "Reset to focal point" }));
    expect(mediaState()?.objectPosition.tablet).toEqual({ x: 100, y: 0 });
  });

  it("toggles safe-area flags through the real editor context", async () => {
    renderPanel(documentWithMedia(imageMedia()));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Header safe area" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Text safe area" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Universal safe zone" }));
    expect(JSON.parse(screen.getByTestId("safe-area-state").textContent ?? "{}")).toMatchObject({
      header: true,
      text: true,
      universal: true,
      mediaCrop: false,
      mobileCrop: false,
    });
  });

  it("starts playback settings at the required defaults and toggles them", async () => {
    renderPanel(documentWithMedia(videoMedia()));
    await settle();
    expect(screen.getByRole("checkbox", { name: "Autoplay" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Muted" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Loop" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Plays inline (iOS)" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pause when off-screen" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Show sound toggle" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Muted" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show sound toggle" }));
    expect(mediaState()?.video).toMatchObject({ muted: false, showSoundToggle: true });
  });
});
