"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type {
  RoomHotspot,
  RoomInspirationPayload,
  RoomScene,
} from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { Dialog } from "@/components/admin/Dialog";
import { ProductThumbnail, productThumbnailUrl, useProductSummaries } from "@/components/admin/ProductPicker";
import { useProductOptions } from "@/components/admin/homepage/sections/SectionProductPicker";

const MAX_SCENES = 5;
const MAX_HOTSPOTS = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^https?:\/\/.+/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//") && value.length > 1))
  );
}

function safeText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

function clampPercent(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, number));
}

function placedPercent(value: number): number {
  return Math.min(97, Math.max(3, Math.round(value * 10) / 10));
}

function fallbackSceneId(index: number, used: Set<string>): string {
  let candidateIndex = index + 1;
  let candidate = `legacy${String(candidateIndex).padStart(7, "0")}`;
  while (used.has(candidate)) {
    candidateIndex += 1;
    candidate = `legacy${String(candidateIndex).padStart(7, "0")}`;
  }
  return candidate;
}

function newSceneId(used: Set<string>): string {
  let candidate = "";
  do {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now()}${Math.random()}`;
    candidate = `scene${random.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 11)}`;
  } while (used.has(candidate));
  return candidate;
}

function safeHotspots(value: unknown): RoomHotspot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter(isRecord)
    .map((hotspot) => {
      const productId = typeof hotspot.productId === "string" ? hotspot.productId : "";
      if (productId !== "" && !UUID_PATTERN.test(productId)) return null;
      if (productId !== "" && seen.has(productId)) return null;
      if (productId !== "") seen.add(productId);
      return {
        productId,
        xPct: clampPercent(hotspot.xPct),
        yPct: clampPercent(hotspot.yPct),
      };
    })
    .filter((hotspot): hotspot is RoomHotspot => hotspot !== null)
    .slice(0, MAX_HOTSPOTS);
}

function safeScenes(value: unknown): RoomScene[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value
    .filter(isRecord)
    .map((scene, index) => {
      const requestedId =
        typeof scene.id === "string" && /^[a-z0-9]{8,16}$/.test(scene.id) && !used.has(scene.id)
          ? scene.id
          : fallbackSceneId(index, used);
      used.add(requestedId);
      return {
        id: requestedId,
        imageUrl: isMediaUrl(scene.imageUrl) ? scene.imageUrl : "",
        ...(safeText(scene.alt, 120) !== undefined ? { alt: safeText(scene.alt, 120) } : {}),
        hotspots: safeHotspots(scene.hotspots),
      };
    })
    .slice(0, MAX_SCENES);
}

function safePayload(value: unknown): RoomInspirationPayload {
  if (!isRecord(value)) return {};
  return {
    ...(isMediaUrl(value.imageUrl) ? { imageUrl: value.imageUrl } : {}),
    ...(safeText(value.heading, 120) !== undefined ? { heading: safeText(value.heading, 120) } : {}),
    ...(safeText(value.body, 2000) !== undefined ? { body: safeText(value.body, 2000) } : {}),
    ...(Array.isArray(value.scenes) ? { scenes: safeScenes(value.scenes) } : {}),
  };
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function RoomInspirationSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"ROOM_INSPIRATION">): ReactNode {
  const { t } = useAdminI18n();
  const [productSearch, setProductSearch] = useState("");
  const [movingHotspot, setMovingHotspot] = useState<{
    sceneId: string;
    hotspotIndex: number;
  } | null>(null);
  const [productPicker, setProductPicker] = useState<{
    sceneId: string;
    hotspotIndex: number;
    removeOnCancel: boolean;
  } | null>(null);
  const [pendingProductId, setPendingProductId] = useState("");
  const [sceneImagePickerOpen, setSceneImagePickerOpen] = useState(false);
  const [pendingSceneImageUrl, setPendingSceneImageUrl] = useState("");
  const { products, loading } = useProductOptions(productSearch);
  const payload = safePayload(section.payload);
  const scenes = safeScenes(payload.scenes);
  const linkedProductIds = scenes.flatMap((scene) =>
    scene.hotspots.map((hotspot) => hotspot.productId).filter(Boolean),
  );
  const linkedProducts = useProductSummaries(linkedProductIds);

  const updatePayloadField = (field: "imageUrl" | "heading" | "body", value: string): void => {
    onPayloadChange((current) => {
      const next = { ...safePayload(current) } as Record<string, unknown>;
      if (value === "") delete next[field];
      else next[field] = value;
      return next as RoomInspirationPayload;
    });
  };

  const updateScenes = (transform: (current: RoomScene[]) => RoomScene[]): void => {
    onPayloadChange((current) => {
      const next = safePayload(current);
      return {
        ...next,
        scenes: transform(safeScenes(next.scenes)),
      };
    });
  };

  const updateScene = (sceneId: string, patch: Partial<RoomScene>): void => {
    updateScenes((current) =>
      current.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    );
  };

  const moveScene = (sceneId: string, delta: -1 | 1): void => {
    updateScenes((current) => {
      const index = current.findIndex((scene) => scene.id === sceneId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeScene = (sceneId: string): void => {
    setMovingHotspot(null);
    if (productPicker?.sceneId === sceneId) {
      setProductPicker(null);
      setPendingProductId("");
      setProductSearch("");
    }
    updateScenes((current) => current.filter((scene) => scene.id !== sceneId));
  };

  const addScene = (): void => {
    if (scenes.length >= MAX_SCENES) return;
    setPendingSceneImageUrl("");
    setSceneImagePickerOpen(true);
  };

  const closeSceneImagePicker = (): void => {
    setSceneImagePickerOpen(false);
    setPendingSceneImageUrl("");
  };

  const confirmAddScene = (): void => {
    if (!isMediaUrl(pendingSceneImageUrl) || scenes.length >= MAX_SCENES) return;
    updateScenes((current) => {
      if (current.length >= MAX_SCENES) return current;
      const used = new Set(current.map((scene) => scene.id));
      return [
        ...current,
        { id: newSceneId(used), imageUrl: pendingSceneImageUrl, hotspots: [] },
      ];
    });
    closeSceneImagePicker();
  };

  const createHotspot = (sceneId: string, xPct: number, yPct: number): void => {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene || scene.hotspots.length >= MAX_HOTSPOTS) return;
    const hotspotIndex = scene.hotspots.length;
    updateScenes((current) =>
      current.map((item) =>
        item.id !== sceneId
          ? item
          : {
              ...item,
              hotspots: [
                ...item.hotspots,
                {
                  productId: "",
                  xPct: placedPercent(xPct),
                  yPct: placedPercent(yPct),
                },
              ],
            },
      ),
    );
    setPendingProductId("");
    setProductPicker({ sceneId, hotspotIndex, removeOnCancel: true });
  };

  const placeHotspot = (event: MouseEvent<HTMLDivElement>, sceneId: string): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xPct = placedPercent(((event.clientX - rect.left) / rect.width) * 100);
    const yPct = placedPercent(((event.clientY - rect.top) / rect.height) * 100);

    if (movingHotspot) {
      if (movingHotspot.sceneId !== sceneId) return;
      updateScenes((current) =>
        current.map((scene) =>
          scene.id !== sceneId
            ? scene
            : {
                ...scene,
                hotspots: scene.hotspots.map((hotspot, index) =>
                  index === movingHotspot.hotspotIndex ? { ...hotspot, xPct, yPct } : hotspot,
                ),
              },
        ),
      );
      setMovingHotspot(null);
      return;
    }

    createHotspot(sceneId, xPct, yPct);
  };

  const updateHotspot = (
    sceneId: string,
    hotspotIndex: number,
    patch: Partial<RoomHotspot>,
  ): void => {
    updateScenes((current) =>
      current.map((scene) => {
        if (scene.id !== sceneId) return scene;
        if (patch.productId !== undefined && patch.productId !== "") {
          const duplicate = scene.hotspots.some(
            (hotspot, index) => index !== hotspotIndex && hotspot.productId === patch.productId,
          );
          if (duplicate) return scene;
        }
        return {
          ...scene,
          hotspots: scene.hotspots.map((hotspot, index) =>
            index === hotspotIndex
              ? {
                  ...hotspot,
                  ...patch,
                  ...(patch.xPct !== undefined ? { xPct: clampPercent(patch.xPct) } : {}),
                  ...(patch.yPct !== undefined ? { yPct: clampPercent(patch.yPct) } : {}),
                }
              : hotspot,
          ),
        };
      }),
    );
  };

  const openProductPicker = (sceneId: string, hotspotIndex: number): void => {
    const hotspot = scenes.find((scene) => scene.id === sceneId)?.hotspots[hotspotIndex];
    if (!hotspot) return;
    setProductSearch("");
    setPendingProductId(hotspot.productId);
    setProductPicker({ sceneId, hotspotIndex, removeOnCancel: false });
  };

  const closeProductPicker = (): void => {
    if (productPicker) {
      const hotspot = scenes.find((scene) => scene.id === productPicker.sceneId)?.hotspots[
        productPicker.hotspotIndex
      ];
      if (productPicker.removeOnCancel && hotspot?.productId === "") {
        updateScenes((current) =>
          current.map((scene) =>
            scene.id !== productPicker.sceneId
              ? scene
              : {
                  ...scene,
                  hotspots: scene.hotspots.filter(
                    (_, index) => index !== productPicker.hotspotIndex,
                  ),
                },
          ),
        );
      }
    }
    setProductPicker(null);
    setPendingProductId("");
    setProductSearch("");
  };

  const confirmProductPicker = (): void => {
    if (!productPicker || !pendingProductId) return;
    updateHotspot(productPicker.sceneId, productPicker.hotspotIndex, {
      productId: pendingProductId,
    });
    setProductPicker(null);
    setPendingProductId("");
    setProductSearch("");
  };

  const clearProductPicker = (): void => {
    if (!productPicker) return;
    updateHotspot(productPicker.sceneId, productPicker.hotspotIndex, { productId: "" });
    setProductPicker(null);
    setPendingProductId("");
    setProductSearch("");
  };

  const removeHotspot = (sceneId: string, hotspotIndex: number): void => {
    setMovingHotspot(null);
    if (productPicker?.sceneId === sceneId && productPicker.hotspotIndex === hotspotIndex) {
      setProductPicker(null);
      setPendingProductId("");
      setProductSearch("");
    }
    updateScenes((current) =>
      current.map((scene) =>
        scene.id === sceneId
          ? { ...scene, hotspots: scene.hotspots.filter((_, index) => index !== hotspotIndex) }
          : scene,
      ),
    );
  };

  const pickerScene = productPicker
    ? scenes.find((scene) => scene.id === productPicker.sceneId)
    : undefined;
  const pickerHotspot = productPicker
    ? pickerScene?.hotspots[productPicker.hotspotIndex]
    : undefined;
  const pickerSelectedElsewhere = new Set(
    pickerScene?.hotspots
      .filter((_, index) => index !== productPicker?.hotspotIndex)
      .map((hotspot) => hotspot.productId)
      .filter(Boolean),
  );

  return (
    <section
      data-section-content-editor="ROOM_INSPIRATION"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_room_inspiration_content")}</h2>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_room_inspiration_image")}
        <ImageUrlInput
          ariaLabel={t("homepage_builder_room_inspiration_image")}
          value={safeString(payload.imageUrl)}
          placeholder={t("homepage_builder_media_url_placeholder")}
          onChange={(value) => updatePayloadField("imageUrl", value)}
          labels={{
            upload: t("homepage_builder_media_upload_image"),
            uploading: t("homepage_builder_media_uploading"),
            invalidType: t("homepage_builder_media_image_invalid"),
            tooLarge: t("homepage_builder_media_image_too_large"),
            uploadFailed: t("homepage_builder_media_upload_failed"),
          }}
        />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_room_inspiration_heading")}
          <input
            type="text"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_room_inspiration_heading")}
            maxLength={120}
            value={safeString(payload.heading)}
            onChange={(event) => updatePayloadField("heading", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_room_inspiration_body")}
          <textarea
            className="min-h-20 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            aria-label={t("homepage_builder_room_inspiration_body")}
            maxLength={2000}
            value={safeString(payload.body)}
            onChange={(event) => updatePayloadField("body", event.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t("homepage_builder_room_inspiration_scenes")}</h3>
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_room_inspiration_scene_limit", { max: MAX_SCENES })}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={scenes.length >= MAX_SCENES}
          onClick={addScene}
        >
          {t("homepage_builder_room_inspiration_scene_add")}
        </button>
      </div>

      {scenes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_room_inspiration_scene_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {scenes.map((scene, sceneIndex) => (
            <div
              key={scene.id}
              data-testid={`room-scene-row-${scene.id}`}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-secondary">
                  {t("homepage_builder_room_inspiration_scene_row", { index: sceneIndex + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                    aria-label={t("homepage_builder_room_inspiration_scene_move_up", { index: sceneIndex + 1 })}
                    disabled={sceneIndex === 0}
                    onClick={() => moveScene(scene.id, -1)}
                  >
                    {t("homepage_builder_move_up")}
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                    aria-label={t("homepage_builder_room_inspiration_scene_move_down", { index: sceneIndex + 1 })}
                    disabled={sceneIndex === scenes.length - 1}
                    onClick={() => moveScene(scene.id, 1)}
                  >
                    {t("homepage_builder_move_down")}
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                    aria-label={t("homepage_builder_room_inspiration_scene_remove", { index: sceneIndex + 1 })}
                    onClick={() => removeScene(scene.id)}
                  >
                    {t("homepage_builder_room_inspiration_scene_remove", { index: sceneIndex + 1 })}
                  </button>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                {t("homepage_builder_room_inspiration_scene_image", { index: sceneIndex + 1 })}
                <ImageUrlInput
                  ariaLabel={t("homepage_builder_room_inspiration_scene_image", { index: sceneIndex + 1 })}
                  value={scene.imageUrl}
                  placeholder={t("homepage_builder_media_url_placeholder")}
                  onChange={(value) => updateScene(scene.id, { imageUrl: value })}
                  labels={{
                    upload: t("homepage_builder_media_upload_image"),
                    uploading: t("homepage_builder_media_uploading"),
                    invalidType: t("homepage_builder_media_image_invalid"),
                    tooLarge: t("homepage_builder_media_image_too_large"),
                    uploadFailed: t("homepage_builder_media_upload_failed"),
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                {t("homepage_builder_room_inspiration_scene_alt", { index: sceneIndex + 1 })}
                <input
                  type="text"
                  className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                  aria-label={t("homepage_builder_room_inspiration_scene_alt", { index: sceneIndex + 1 })}
                  maxLength={120}
                  value={scene.alt ?? ""}
                  onChange={(event) => updateScene(scene.id, { alt: event.target.value || undefined })}
                />
              </label>
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold text-ink-secondary">
                      {t("homepage_builder_room_inspiration_hotspots")}
                    </h4>
                    <p className="text-xs text-ink-muted">
                      {t("homepage_builder_room_inspiration_hotspot_click_hint", { max: MAX_HOTSPOTS })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                    aria-label={t("homepage_builder_room_inspiration_hotspot_add", {
                      index: sceneIndex + 1,
                    })}
                    disabled={!scene.imageUrl || scene.hotspots.length >= MAX_HOTSPOTS}
                    onClick={() => createHotspot(scene.id, 50, 50)}
                  >
                    {t("homepage_builder_room_inspiration_hotspot_add", {
                      index: sceneIndex + 1,
                    })}
                  </button>
                </div>
                {scene.imageUrl ? (
                  <div
                    data-room-scene-canvas={scene.id}
                    role="img"
                    aria-label={t("homepage_builder_room_inspiration_hotspot_canvas", {
                      index: sceneIndex + 1,
                    })}
                    onClick={(event) => placeHotspot(event, scene.id)}
                    className={`relative aspect-[16/10] w-full cursor-crosshair overflow-hidden rounded-lg border border-border ${
                      movingHotspot?.sceneId === scene.id ? "ring-2 ring-cta" : ""
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={scene.imageUrl}
                      alt={scene.alt ?? t("homepage_builder_room_inspiration_scene_row", { index: sceneIndex + 1 })}
                      className="pointer-events-none h-full w-full select-none object-cover"
                      draggable={false}
                    />
                    {scene.hotspots.map((hotspot, hotspotIndex) => (
                      <span
                        key={`${scene.id}-${hotspotIndex}`}
                        className="pointer-events-none absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[10px] font-bold text-cta shadow-md ring-1 ring-cta"
                        style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%` }}
                      >
                        {hotspotIndex + 1}
                      </span>
                    ))}
                    {movingHotspot?.sceneId === scene.id ? (
                      <span className="pointer-events-none absolute left-2 top-2 rounded bg-cta px-2 py-1 text-xs text-white">
                        {t("homepage_builder_room_inspiration_hotspot_relocate_hint")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {scene.hotspots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-2 py-3 text-xs text-ink-muted">
                  {t("homepage_builder_room_inspiration_hotspot_empty")}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {scene.hotspots.map((hotspot, hotspotIndex) => {
                    const selectedProduct = products.find((product) => product.id === hotspot.productId);
                    const linkedProduct = linkedProducts.get(hotspot.productId);
                    const selectedProductName =
                      selectedProduct?.name ?? linkedProduct?.name ?? hotspot.productId;
                    const selectedProductImage =
                      selectedProduct ? productThumbnailUrl(selectedProduct) : linkedProduct?.imageUrl ?? null;
                    return (
                      <div
                        key={`${scene.id}-${hotspotIndex}`}
                        data-room-hotspot-row={`${scene.id}-${hotspotIndex}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cta text-[10px] font-bold text-white">
                          {hotspotIndex + 1}
                        </span>
                        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
                          <span className="sr-only">
                            {t("homepage_builder_room_inspiration_hotspot_product", {
                              scene: sceneIndex + 1,
                              hotspot: hotspotIndex + 1,
                            })}
                          </span>
                          {hotspot.productId ? (
                            <ProductThumbnail
                              imageUrl={selectedProductImage}
                              className="h-9 w-9"
                              testId="room-hotspot-product-thumb"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {selectedProductName || t("homepage_builder_room_inspiration_hotspot_product_empty")}
                            </p>
                            {selectedProduct ? (
                              <p className="text-xs text-ink-muted">
                                {selectedProduct.status === "ACTIVE"
                                  ? t("homepage_builder_room_inspiration_hotspot_product_status_active")
                                  : t("homepage_builder_room_inspiration_hotspot_product_status_unavailable")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-xs text-ink-muted">
                            X
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              className="w-16 rounded border border-border bg-card px-1.5 py-1 text-xs text-ink"
                              aria-label={t("homepage_builder_room_inspiration_hotspot_x", {
                                scene: sceneIndex + 1,
                                hotspot: hotspotIndex + 1,
                              })}
                              value={hotspot.xPct}
                              onChange={(event) =>
                                updateHotspot(scene.id, hotspotIndex, {
                                  xPct: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-ink-muted">
                            Y
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              className="w-16 rounded border border-border bg-card px-1.5 py-1 text-xs text-ink"
                              aria-label={t("homepage_builder_room_inspiration_hotspot_y", {
                                scene: sceneIndex + 1,
                                hotspot: hotspotIndex + 1,
                              })}
                              value={hotspot.yPct}
                              onChange={(event) =>
                                updateHotspot(scene.id, hotspotIndex, {
                                  yPct: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-cta hover:bg-primary-light/40"
                          aria-label={t("homepage_builder_room_inspiration_hotspot_replace", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          onClick={() => openProductPicker(scene.id, hotspotIndex)}
                        >
                          {t("homepage_builder_room_inspiration_hotspot_replace_button")}
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
                          aria-label={t("homepage_builder_room_inspiration_hotspot_relocate", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          disabled={!scene.imageUrl}
                          onClick={() => setMovingHotspot({ sceneId: scene.id, hotspotIndex })}
                        >
                          {t("homepage_builder_room_inspiration_hotspot_relocate_button")}
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                          aria-label={t("homepage_builder_room_inspiration_hotspot_remove", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          onClick={() => removeHotspot(scene.id, hotspotIndex)}
                        >
                          {t("homepage_builder_room_inspiration_hotspot_remove_button")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={sceneImagePickerOpen}
        onClose={closeSceneImagePicker}
        title={t("homepage_builder_room_inspiration_scene_picker_title")}
        width="md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-secondary">
            {t("homepage_builder_room_inspiration_scene_picker_prompt")}
          </p>
          <ImageUrlInput
            ariaLabel={t("homepage_builder_room_inspiration_scene_picker_image")}
            value={pendingSceneImageUrl}
            placeholder={t("homepage_builder_media_url_placeholder")}
            onChange={setPendingSceneImageUrl}
            labels={{
              upload: t("homepage_builder_media_upload_image"),
              uploading: t("homepage_builder_media_uploading"),
              invalidType: t("homepage_builder_media_image_invalid"),
              tooLarge: t("homepage_builder_media_image_too_large"),
              uploadFailed: t("homepage_builder_media_upload_failed"),
            }}
          />
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface"
              onClick={closeSceneImagePicker}
            >
              {t("homepage_builder_room_inspiration_scene_picker_cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white hover:bg-cta/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isMediaUrl(pendingSceneImageUrl)}
              onClick={confirmAddScene}
            >
              {t("homepage_builder_room_inspiration_scene_picker_confirm")}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(productPicker && pickerHotspot)}
        onClose={closeProductPicker}
        title={t("homepage_builder_room_inspiration_hotspot_picker_title")}
        width="lg"
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-secondary">
            {t("homepage_builder_product_search")}
            <input
              type="search"
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
              aria-label={t("homepage_builder_product_search")}
              placeholder={t("homepage_builder_product_search")}
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {t("homepage_builder_room_inspiration_hotspot_picker_recommended")}
              </h3>
              <span className="text-xs text-ink-muted">
                {t("homepage_builder_room_inspiration_hotspot_picker_selected", {
                  count: pendingProductId ? 1 : 0,
                })}
              </span>
            </div>
            {loading ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-5 text-sm text-ink-muted">
                {t("homepage_builder_product_loading")}
              </p>
            ) : products.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-5 text-sm text-ink-muted">
                {t("homepage_builder_product_no_results")}
              </p>
            ) : (
              <div className="grid max-h-[45vh] gap-2 overflow-y-auto sm:grid-cols-2">
                {products.map((product) => {
                  const selected = pendingProductId === product.id;
                  const duplicate = pickerSelectedElsewhere.has(product.id);
                  return (
                    <button
                      key={product.id}
                      type="button"
                      className={`flex min-h-16 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? "border-cta bg-primary-light/40 text-ink"
                          : "border-border text-ink hover:border-cta"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                      aria-label={product.name}
                      aria-pressed={selected}
                      disabled={duplicate}
                      onClick={() => setPendingProductId(product.id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ProductThumbnail
                          imageUrl={productThumbnailUrl(product)}
                          className="h-10 w-10"
                          testId={`room-hotspot-option-thumb-${product.slug}`}
                        />
                        <span className="min-w-0 truncate font-medium">{product.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {product.status === "ACTIVE"
                          ? t("homepage_builder_room_inspiration_hotspot_product_status_active")
                          : t("homepage_builder_room_inspiration_hotspot_product_status_unavailable")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="mr-auto rounded-lg px-3 py-2 text-sm text-sale hover:bg-sale/10 disabled:cursor-not-allowed disabled:text-ink-muted"
              disabled={!pendingProductId}
              onClick={clearProductPicker}
            >
              {t("homepage_builder_room_inspiration_hotspot_picker_clear")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface"
              onClick={closeProductPicker}
            >
              {t("homepage_builder_room_inspiration_hotspot_picker_cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white hover:bg-cta/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!pendingProductId}
              onClick={confirmProductPicker}
            >
              {t("homepage_builder_room_inspiration_hotspot_picker_confirm", {
                count: pendingProductId ? 1 : 0,
              })}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
