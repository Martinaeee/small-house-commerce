"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { Group, SelectField } from "@/components/admin/homepage/SettingsPanel";
import {
  useHomepageEditor,
  type BuilderDevice,
  type SafeAreaFlags,
} from "@/components/admin/homepage/HomepageEditor";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { adminApi } from "@/lib/admin-api";
import {
  probeFailureMessageKey,
  probeVideo,
  validateVideoFile,
  MAX_POSTER_BYTES,
  type ProbeResult,
} from "@/lib/video-probe";
import {
  clampPct,
  updateHeroMedia,
  type FocalPoint,
  type HeroImage,
  type HeroMedia,
  type HeroSlide,
  type HeroVideo,
  type HomepageDocument,
} from "@/lib/homepage-document";

const DEFAULT_FOCAL: FocalPoint = { x: 50, y: 50 };
const DEVICES: readonly BuilderDevice[] = ["desktop", "tablet", "mobile"];
const FITS = ["COVER", "CONTAIN"] as const;
type Fit = (typeof FITS)[number];
type MediaType = "IMAGE" | "VIDEO";

type ImageSlotProps = {
  label: string;
  ariaPrefix: string;
  slot: HeroImage | null;
  onUrlChange: (url: string) => void;
  onAltChange: (alt: string) => void;
};

type VideoSlotProps = {
  fileLabel: string;
  idPrefix: string;
  slot: HeroVideo | null;
  onUploaded: (uploaded: { url: string; poster: string }) => void;
  onError: (messageKey: TKey) => void;
};

const FIT_LABEL_KEYS: Record<Fit, TKey> = {
  COVER: "homepage_builder_media_fit_COVER",
  CONTAIN: "homepage_builder_media_fit_CONTAIN",
};

const SAFE_AREA_FIELDS: ReadonlyArray<{
  key: keyof SafeAreaFlags;
  labelKey: TKey;
}> = [
  { key: "header", labelKey: "homepage_builder_safe_area_header" },
  { key: "text", labelKey: "homepage_builder_safe_area_text" },
  { key: "mobileCrop", labelKey: "homepage_builder_safe_area_mobile_crop" },
  { key: "mediaCrop", labelKey: "homepage_builder_safe_area_media_crop" },
  { key: "universal", labelKey: "homepage_builder_safe_area_universal" },
];

function findSlide(document: HomepageDocument, slideId: string | null): HeroSlide | null {
  if (slideId === null) return null;
  for (const section of document.sections) {
    if (section.type !== "HERO") continue;
    const slide = section.payload.slides.find((candidate) => candidate.id === slideId);
    if (slide) return slide;
  }
  return null;
}

function defaultVideo(overrides: Partial<HeroVideo> = {}): HeroVideo {
  return {
    url: "",
    poster: null,
    autoplay: true,
    muted: true,
    loop: true,
    playsInline: true,
    showSoundToggle: false,
    pauseOffscreen: true,
    ...overrides,
  };
}

function imageLabels(t: (key: TKey) => string) {
  return {
    upload: t("homepage_builder_media_upload_image"),
    uploading: t("homepage_builder_media_uploading"),
    invalidType: t("homepage_builder_media_image_invalid"),
    tooLarge: t("homepage_builder_media_image_too_large"),
    uploadFailed: t("homepage_builder_media_upload_failed"),
  };
}

function ImageSlot({
  label,
  ariaPrefix,
  slot,
  onUrlChange,
  onAltChange,
}: ImageSlotProps): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <ImageUrlInput
        ariaLabel={ariaPrefix}
        value={slot?.url ?? ""}
        onChange={onUrlChange}
        labels={imageLabels(t)}
        placeholder={t("homepage_builder_media_url_placeholder")}
      />
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        <span>{t("homepage_builder_media_alt")}</span>
        <input
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={`${ariaPrefix}: ${t("homepage_builder_media_alt")}`}
          placeholder={t("homepage_builder_media_alt_placeholder")}
          value={slot?.alt ?? ""}
          onChange={(event) => onAltChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function VideoUploadControl({
  fileLabel,
  idPrefix,
  slot,
  onUploaded,
  onError,
}: VideoSlotProps): ReactNode {
  const { t } = useAdminI18n();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const validation = validateVideoFile(file);
    if (validation === "INVALID_TYPE") {
      onError("homepage_builder_media_invalid_type");
      return;
    }
    if (validation === "TOO_LARGE") {
      onError("homepage_builder_media_file_too_large");
      return;
    }

    setBusy(true);
    try {
      const result: ProbeResult = await probeVideo(file);
      if (!result.ok) {
        onError(probeFailureMessageKey(result.reason));
        return;
      }
      if (result.posterBlob.size > MAX_POSTER_BYTES) {
        onError("homepage_builder_media_poster_too_large");
        return;
      }

      // Upload the poster first. A failed poster can therefore never leave a
      // publish-ready video URL in the document.
      const posterFile = new File(
        [result.posterBlob],
        `${file.name.replace(/\.mp4$/i, "")}-poster.jpg`,
        { type: "image/jpeg" },
      );
      const poster = await adminApi.uploadImage(posterFile, "image/jpeg");
      const video = await adminApi.uploadImage(file, "video/mp4");
      onUploaded({
        url: video.url,
        poster: poster.url,
      });
    } catch {
      onError("homepage_builder_media_upload_failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
      <div className="flex items-center gap-2">
        {slot?.poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- local admin poster preview.
          <img
            src={slot.poster}
            alt=""
            className="h-12 w-16 rounded border border-border object-cover"
          />
        ) : null}
        <span data-testid={idPrefix === "hero" ? "video-url" : "mobile-video-url"} className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
          {slot?.url ?? "—"}
        </span>
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
          aria-label={t("homepage_builder_media_upload_video")}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? t("homepage_builder_media_uploading") : t("homepage_builder_media_upload_video")}
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="video/mp4,.mp4"
          aria-label={fileLabel}
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}

function PointPreview({
  point,
  testId,
  ariaLabel,
  onChange,
}: {
  point: FocalPoint;
  testId: string;
  ariaLabel: string;
  onChange: (point: FocalPoint) => void;
}): ReactNode {
  const dragging = useRef(false);

  const pointFromEvent = (event: { clientX: number; clientY: number }, element: HTMLElement): FocalPoint => {
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return point;
    }
    return {
      x: clampPct(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPct(((event.clientY - rect.top) / rect.height) * 100),
    };
  };

  const updateFromEvent = (event: { clientX: number; clientY: number }, element: HTMLElement): void => {
    onChange(pointFromEvent(event, element));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateFromEvent(event, event.currentTarget);
    event.preventDefault();
  };

  return (
    <div
      role="application"
      tabIndex={0}
      data-testid={testId}
      aria-label={ariaLabel}
      className="relative h-28 overflow-hidden rounded-lg border border-border bg-gradient-to-br from-primary-light to-primary-dark"
      onClick={(event) => updateFromEvent(event, event.currentTarget)}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        if (dragging.current) updateFromEvent(event, event.currentTarget);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => {
        dragging.current = false;
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cta shadow"
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
      />
    </div>
  );
}

function DeviceButtons({
  device,
  onChange,
}: {
  device: BuilderDevice;
  onChange: (device: BuilderDevice) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const labels: Record<BuilderDevice, TKey> = {
    desktop: "homepage_builder_device_desktop",
    tablet: "homepage_builder_device_tablet",
    mobile: "homepage_builder_device_mobile",
  };
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={t("homepage_builder_media_object_device")}>
      {DEVICES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={device === candidate}
          className={`rounded px-2 py-1 text-xs font-semibold ${device === candidate ? "bg-cta text-white" : "border border-border text-ink-secondary"}`}
          onClick={() => onChange(candidate)}
        >
          {t(labels[candidate])}
        </button>
      ))}
    </div>
  );
}

function HeroMediaPanel({
  slideId,
  initialMedia,
}: {
  slideId: string;
  initialMedia: HeroMedia | null;
}): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    dispatch,
    device,
    setDevice,
    safeAreaFlags,
    setSafeAreaFlags,
  } = useHomepageEditor();
  const [mediaType, setMediaType] = useState<MediaType>(initialMedia?.type ?? "IMAGE");
  const [imageSlot, setImageSlot] = useState<HeroImage | null>(initialMedia?.image ?? null);
  const [videoSlot, setVideoSlot] = useState<HeroVideo | null>(initialMedia?.video ?? null);
  const [mobileImageSlot, setMobileImageSlot] = useState<HeroImage | null>(initialMedia?.mobileOverride.image ?? null);
  const [mobileVideoSlot, setMobileVideoSlot] = useState<HeroVideo | null>(initialMedia?.mobileOverride.video ?? null);
  const [mobileType, setMobileType] = useState<MediaType>(
    initialMedia?.mobileOverride.video ? "VIDEO" : "IMAGE",
  );
  const [mobileEnabled, setMobileEnabled] = useState(initialMedia?.mobileOverride.enabled ?? false);
  const [error, setError] = useState<string | null>(null);
  const mediaTypeIntentRef = useRef<MediaType | null>(null);
  const mobileTypeIntentRef = useRef<MediaType | null>(null);

  const document = state.document;
  const persistedSlide = findSlide(document, slideId);
  const media = persistedSlide?.media ?? null;

  /* eslint-disable react-hooks/set-state-in-effect -- reducer document is the external source of truth. */
  useEffect(() => {
    setImageSlot(media?.image ?? null);
    setVideoSlot(media?.video ?? null);
    setMobileImageSlot(media?.mobileOverride.image ?? null);
    setMobileVideoSlot(media?.mobileOverride.video ?? null);
    setMobileEnabled(media?.mobileOverride.enabled ?? false);

    if (!media) {
      setMobileType("IMAGE");
      mediaTypeIntentRef.current = null;
      mobileTypeIntentRef.current = null;
      return;
    }

    const mediaTypeIntent = mediaTypeIntentRef.current;
    if (mediaTypeIntent === null || media.type === mediaTypeIntent) {
      setMediaType(media.type);
      if (media.type === mediaTypeIntent) mediaTypeIntentRef.current = null;
    }

    if (!media.mobileOverride.enabled) {
      setMobileType("IMAGE");
      mobileTypeIntentRef.current = null;
      return;
    }

    const persistedMobileType: MediaType | null = media.mobileOverride.video
      ? "VIDEO"
      : media.mobileOverride.image
        ? "IMAGE"
        : null;
    const mobileTypeIntent = mobileTypeIntentRef.current;
    if (
      persistedMobileType !== null &&
      (mobileTypeIntent === null || persistedMobileType === mobileTypeIntent)
    ) {
      setMobileType(persistedMobileType);
      if (persistedMobileType === mobileTypeIntent) {
        mobileTypeIntentRef.current = null;
      }
    }
  }, [media]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const imageSlotForPanel = media ? media.image : imageSlot;
  const videoSlotForPanel = media ? media.video : videoSlot;
  const mobileImageSlotForPanel = media
    ? media.mobileOverride.image
    : mobileImageSlot;
  const mobileVideoSlotForPanel = media
    ? media.mobileOverride.video
    : mobileVideoSlot;
  const focal = media?.focal ?? DEFAULT_FOCAL;
  const fit = media?.fit ?? "COVER";
  const activeVideo = mediaType === "VIDEO" ? videoSlotForPanel : null;
  const activeMobileVideo = mobileType === "VIDEO" ? mobileVideoSlotForPanel : null;

  const mutateMedia = (patch: Parameters<typeof updateHeroMedia>[2]): void => {
    dispatch({
      type: "mutate",
      mutate: (latest) => updateHeroMedia(latest, slideId, patch),
    });
  };

  const selectType = (nextType: MediaType): void => {
    mediaTypeIntentRef.current = nextType;
    setMediaType(nextType);
    if (nextType === "IMAGE" && imageSlotForPanel?.url) {
      mutateMedia({ type: "IMAGE", image: imageSlotForPanel });
    }
    if (nextType === "VIDEO" && videoSlotForPanel?.url) {
      mutateMedia({ type: "VIDEO", video: videoSlotForPanel });
    }
  };

  const selectMobileType = (nextType: MediaType): void => {
    mobileTypeIntentRef.current = nextType;
    setMobileType(nextType);
  };

  const updateImage = (next: HeroImage): void => {
    setImageSlot(next);
    if (next.url.trim() !== "") mutateMedia({ type: "IMAGE", image: next });
  };

  const updateMobileImage = (next: HeroImage): void => {
    if (!media) return;
    setMobileImageSlot(next);
    if (next.url.trim() !== "") {
      mutateMedia({ mobileOverride: { enabled: true, image: next } });
    }
  };

  const updateVideoSetting = <K extends keyof HeroVideo>(key: K, value: HeroVideo[K]): void => {
    if (!videoSlotForPanel) return;
    const next = { ...videoSlotForPanel, [key]: value } as HeroVideo;
    setVideoSlot(next);
    dispatch({
      type: "mutate",
      mutate: (latest) => {
        const latestVideo = findSlide(latest, slideId)?.media?.video;
        if (!latestVideo) return latest;
        return updateHeroMedia(latest, slideId, {
          type: "VIDEO",
          video: { ...latestVideo, [key]: value },
        });
      },
    });
  };

  const updateFocal = (next: FocalPoint): void => {
    mutateMedia({ focal: next });
  };

  const objectPosition = media?.objectPosition[device] ?? focal;
  const updateObjectPosition = (next: FocalPoint): void => {
    const objectPositionPatch =
      device === "desktop"
        ? { desktop: next }
        : device === "tablet"
          ? { tablet: next }
          : { mobile: next };
    mutateMedia({ objectPosition: objectPositionPatch });
  };

  const resetObjectPosition = (): void => updateObjectPosition(focal);

  const toggleSafeArea = (key: keyof SafeAreaFlags, checked: boolean): void => {
    setSafeAreaFlags((previous) => ({ ...previous, [key]: checked }));
  };

  const commitUploadedVideo = (
    uploaded: { url: string; poster: string },
    mobile: boolean,
  ): void => {
    dispatch({
      type: "mutate",
      mutate: (latest) => {
        const latestSlide = findSlide(latest, slideId);
        const latestMedia = latestSlide?.media;
        if (mobile && !latestMedia) return latest;
        const latestVideo = mobile
          ? latestMedia?.mobileOverride.video
          : latestMedia?.video;
        const video = {
          ...defaultVideo(latestVideo ?? undefined),
          url: uploaded.url,
          poster: uploaded.poster,
        };
        return mobile
          ? updateHeroMedia(latest, slideId, {
              mobileOverride: { video },
            })
          : updateHeroMedia(latest, slideId, { type: "VIDEO", video });
      },
    });
  };

  const onVideoUploaded = (uploaded: { url: string; poster: string }): void => {
    setError(null);
    commitUploadedVideo(uploaded, false);
  };

  const onMobileVideoUploaded = (uploaded: { url: string; poster: string }): void => {
    setError(null);
    commitUploadedVideo(uploaded, true);
  };

  const onPosterUrlChange = (url: string): void => {
    if (!videoSlotForPanel) return;
    const next = { ...videoSlotForPanel, poster: url.trim() || null };
    setVideoSlot(next);
    dispatch({
      type: "mutate",
      mutate: (latest) => {
        const latestVideo = findSlide(latest, slideId)?.media?.video;
        if (!latestVideo) return latest;
        return updateHeroMedia(latest, slideId, {
          type: "VIDEO",
          video: { ...latestVideo, poster: url.trim() || null },
        });
      },
    });
  };

  const onMobilePosterUrlChange = (url: string): void => {
    if (!mobileVideoSlotForPanel || !media) return;
    const next = { ...mobileVideoSlotForPanel, poster: url.trim() || null };
    setMobileVideoSlot(next);
    dispatch({
      type: "mutate",
      mutate: (latest) => {
        const latestVideo = findSlide(latest, slideId)?.media?.mobileOverride.video;
        if (!latestVideo) return latest;
        return updateHeroMedia(latest, slideId, {
          mobileOverride: {
            enabled: true,
            video: { ...latestVideo, poster: url.trim() || null },
          },
        });
      },
    });
  };

  const selectMobileEnabled = (checked: boolean): void => {
    if (!media) return;
    if (!checked) {
      setMobileImageSlot(null);
      setMobileVideoSlot(null);
      mobileTypeIntentRef.current = null;
      setMobileType("IMAGE");
    }
    mutateMedia({ mobileOverride: { enabled: checked } });
  };

  return (
    <div
      data-panel="hero-media-settings"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_media")}</h2>

      <div className="flex gap-1" role="group" aria-label={t("homepage_builder_group_media")}>
        {(["IMAGE", "VIDEO"] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={mediaType === type}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${mediaType === type ? "bg-cta text-white" : "border border-border text-ink-secondary"}`}
            onClick={() => selectType(type)}
          >
            {t(type === "IMAGE" ? "homepage_builder_media_image" : "homepage_builder_media_video")}
          </button>
        ))}
      </div>

      {mediaType === "IMAGE" ? (
        <ImageSlot
          label={t("homepage_builder_media_image")}
          ariaPrefix={t("homepage_builder_media_image")}
          slot={imageSlotForPanel}
          onUrlChange={(url) => updateImage({ url, alt: imageSlotForPanel?.alt ?? "" })}
          onAltChange={(alt) => updateImage({ url: imageSlotForPanel?.url ?? "", alt })}
        />
      ) : (
        <Group title={t("homepage_builder_media_video")}>
          <VideoUploadControl
            fileLabel={t("homepage_builder_media_video_file")}
            idPrefix="hero"
            slot={videoSlotForPanel}
            onUploaded={onVideoUploaded}
            onError={(key) => setError(t(key))}
          />
          {activeVideo ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-ink-secondary">{t("homepage_builder_media_poster")}</span>
              <ImageUrlInput
                ariaLabel={t("homepage_builder_media_poster")}
                value={activeVideo.poster ?? ""}
                onChange={onPosterUrlChange}
                labels={{
                  upload: t("homepage_builder_media_poster_replace"),
                  uploading: t("homepage_builder_media_uploading"),
                  invalidType: t("homepage_builder_media_image_invalid"),
                  tooLarge: t("homepage_builder_media_image_too_large"),
                  uploadFailed: t("homepage_builder_media_upload_failed"),
                }}
                placeholder={t("homepage_builder_media_url_placeholder")}
              />
            </div>
          ) : null}
        </Group>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <SelectField
        label={t("homepage_builder_media_fit")}
        value={fit}
        options={FITS}
        labelKeys={FIT_LABEL_KEYS}
        onChange={(next) => mutateMedia({ fit: next })}
      />

      <Group title={t("homepage_builder_media_focal")}>
        <PointPreview
          point={focal}
          testId="hero-media-focal-point"
          ariaLabel={t("homepage_builder_media_focal_preview")}
          onChange={updateFocal}
        />
        <DeviceButtons device={device} onChange={setDevice} />
        <PointPreview
          point={objectPosition}
          testId="hero-media-object-position"
          ariaLabel={t("homepage_builder_media_object_preview")}
          onChange={updateObjectPosition}
        />
        <button
          type="button"
          className="self-start rounded border border-border px-2 py-1 text-xs font-semibold text-ink-secondary hover:text-cta"
          onClick={resetObjectPosition}
        >
          {t("homepage_builder_media_reset_focal")}
        </button>
      </Group>

      <Group title={t("homepage_builder_media_mobile_override")}>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-cta"
            aria-label={t("homepage_builder_media_mobile_override")}
            checked={mobileEnabled}
            disabled={!media}
            onChange={(event) => selectMobileEnabled(event.target.checked)}
          />
          {t("homepage_builder_media_mobile_override")}
        </label>
        {!media ? (
          <p className="text-xs text-ink-secondary">
            {t("homepage_builder_media_mobile_requires_primary")}
          </p>
        ) : null}
        {media && mobileEnabled ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1" role="group" aria-label={t("homepage_builder_media_mobile_override")}>
              <button
                type="button"
                aria-pressed={mobileType === "IMAGE"}
                className="rounded border border-border px-2 py-1 text-xs font-semibold text-ink-secondary"
                onClick={() => selectMobileType("IMAGE")}
              >
                {t("homepage_builder_media_mobile_image")}
              </button>
              <button
                type="button"
                aria-pressed={mobileType === "VIDEO"}
                className="rounded border border-border px-2 py-1 text-xs font-semibold text-ink-secondary"
                onClick={() => selectMobileType("VIDEO")}
              >
                {t("homepage_builder_media_mobile_video")}
              </button>
            </div>
            {mobileType === "IMAGE" ? (
              <ImageSlot
                label={t("homepage_builder_media_mobile_image")}
                ariaPrefix={t("homepage_builder_media_mobile_image")}
                slot={mobileImageSlotForPanel}
                onUrlChange={(url) => updateMobileImage({ url, alt: mobileImageSlotForPanel?.alt ?? "" })}
                onAltChange={(alt) => updateMobileImage({ url: mobileImageSlotForPanel?.url ?? "", alt })}
              />
            ) : (
              <>
                <VideoUploadControl
                  fileLabel={t("homepage_builder_media_mobile_video_file")}
                  idPrefix="mobile"
                  slot={mobileVideoSlotForPanel}
                  onUploaded={onMobileVideoUploaded}
                  onError={(key) => setError(t(key))}
                />
                {activeMobileVideo ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-ink-secondary">{t("homepage_builder_media_poster")}</span>
                    <ImageUrlInput
                      ariaLabel={t("homepage_builder_media_mobile_video")}
                      value={activeMobileVideo.poster ?? ""}
                      onChange={onMobilePosterUrlChange}
                      labels={{
                        upload: t("homepage_builder_media_poster_replace"),
                        uploading: t("homepage_builder_media_uploading"),
                        invalidType: t("homepage_builder_media_image_invalid"),
                        tooLarge: t("homepage_builder_media_image_too_large"),
                        uploadFailed: t("homepage_builder_media_upload_failed"),
                      }}
                      placeholder={t("homepage_builder_media_url_placeholder")}
                    />
                  </div>
                ) : null}
              </>
            )}
            {activeMobileVideo?.poster ? (
              <span className="text-xs text-ink-secondary">{t("homepage_builder_media_poster")}</span>
            ) : null}
          </div>
        ) : null}
      </Group>

      {activeVideo ? (
        <Group title={t("homepage_builder_video_playback_settings")}>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["homepage_builder_field_autoplay", "autoplay"],
                ["homepage_builder_video_muted", "muted"],
                ["homepage_builder_video_loop", "loop"],
                ["homepage_builder_video_plays_inline", "playsInline"],
                ["homepage_builder_video_sound_toggle", "showSoundToggle"],
                ["homepage_builder_video_pause_offscreen", "pauseOffscreen"],
              ] as const
            ).map(([labelKey, property]) => (
              <label key={property} className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cta"
                  aria-label={t(labelKey)}
                  checked={activeVideo[property]}
                  onChange={(event) => updateVideoSetting(property, event.target.checked)}
                />
                {t(labelKey)}
              </label>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title={t("homepage_builder_safe_area_group")}>
        <div className="grid grid-cols-2 gap-2">
          {SAFE_AREA_FIELDS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-cta"
                aria-label={t(labelKey)}
                checked={safeAreaFlags[key]}
                onChange={(event) => toggleSafeArea(key, event.target.checked)}
              />
              {t(labelKey)}
            </label>
          ))}
        </div>
      </Group>
    </div>
  );
}

export function HeroMediaSettings(): ReactNode {
  const { state, selectedSlideId } = useHomepageEditor();
  const slide = findSlide(state.document, selectedSlideId);
  if (!slide) return null;
  return <HeroMediaPanel key={slide.id} slideId={slide.id} initialMedia={slide.media} />;
}
