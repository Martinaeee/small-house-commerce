"use client";

import { useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type {
  RoomHotspot,
  RoomInspirationPayload,
  RoomScene,
} from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
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
  const { products, loading } = useProductOptions(productSearch);
  const payload = safePayload(section.payload);
  const scenes = safeScenes(payload.scenes);

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
    updateScenes((current) => current.filter((scene) => scene.id !== sceneId));
  };

  const addScene = (): void => {
    if (scenes.length >= MAX_SCENES) return;
    updateScenes((current) => {
      if (current.length >= MAX_SCENES) return current;
      const used = new Set(current.map((scene) => scene.id));
      return [...current, { id: newSceneId(used), imageUrl: "", hotspots: [] }];
    });
  };

  const addHotspot = (sceneId: string): void => {
    updateScenes((current) =>
      current.map((scene) =>
        scene.id !== sceneId || scene.hotspots.length >= MAX_HOTSPOTS
          ? scene
          : {
              ...scene,
              hotspots: [...scene.hotspots, { productId: "", xPct: 50, yPct: 50 }],
            },
      ),
    );
  };

  const updateHotspot = (
    sceneId: string,
    hotspotIndex: number,
    patch: Partial<RoomHotspot>,
  ): void => {
    updateScenes((current) =>
      current.map((scene) => {
        if (scene.id !== sceneId) return scene;
        if (patch.productId !== undefined) {
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

  const removeHotspot = (sceneId: string, hotspotIndex: number): void => {
    updateScenes((current) =>
      current.map((scene) =>
        scene.id === sceneId
          ? { ...scene, hotspots: scene.hotspots.filter((_, index) => index !== hotspotIndex) }
          : scene,
      ),
    );
  };

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

      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_product_search")}
        <input
          type="search"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_product_search")}
          placeholder={t("homepage_builder_product_search")}
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
        />
      </label>

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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-ink-secondary">
                    {t("homepage_builder_room_inspiration_hotspots")}
                  </h4>
                  <p className="text-xs text-ink-muted">
                    {t("homepage_builder_room_inspiration_hotspot_limit", { max: MAX_HOTSPOTS })}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-cta/40 px-2 py-1 text-xs font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
                  aria-label={t("homepage_builder_room_inspiration_hotspot_add", { index: sceneIndex + 1 })}
                  disabled={scene.hotspots.length >= MAX_HOTSPOTS}
                  onClick={() => addHotspot(scene.id)}
                >
                  {t("homepage_builder_room_inspiration_hotspot_add", { index: sceneIndex + 1 })}
                </button>
              </div>
              {scene.hotspots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-2 py-3 text-xs text-ink-muted">
                  {t("homepage_builder_room_inspiration_hotspot_empty")}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {scene.hotspots.map((hotspot, hotspotIndex) => {
                    const selectedElsewhere = new Set(
                      scene.hotspots
                        .filter((_, index) => index !== hotspotIndex)
                        .map((item) => item.productId),
                    );
                    const hasSelectedProduct = products.some((product) => product.id === hotspot.productId);
                    return (
                      <div
                        key={`${scene.id}-${hotspotIndex}`}
                        className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]"
                      >
                        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                          {t("homepage_builder_room_inspiration_hotspot_product", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          <select
                            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                            aria-label={t("homepage_builder_room_inspiration_hotspot_product", {
                              scene: sceneIndex + 1,
                              hotspot: hotspotIndex + 1,
                            })}
                            value={hotspot.productId}
                            disabled={loading}
                            onChange={(event) =>
                              updateHotspot(scene.id, hotspotIndex, {
                                productId: event.target.value,
                              })
                            }
                          >
                            <option value="">{t("homepage_builder_product_no_results")}</option>
                            {!hasSelectedProduct && hotspot.productId ? (
                              <option value={hotspot.productId}>{hotspot.productId}</option>
                            ) : null}
                            {products.map((product) => (
                              <option
                                key={product.id}
                                value={product.id}
                                disabled={selectedElsewhere.has(product.id)}
                              >
                                {product.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                          {t("homepage_builder_room_inspiration_hotspot_x", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                            aria-label={t("homepage_builder_room_inspiration_hotspot_x", {
                              scene: sceneIndex + 1,
                              hotspot: hotspotIndex + 1,
                            })}
                            value={hotspot.xPct}
                            onChange={(event) => updateHotspot(scene.id, hotspotIndex, { xPct: Number(event.target.value) })}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                          {t("homepage_builder_room_inspiration_hotspot_y", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                            aria-label={t("homepage_builder_room_inspiration_hotspot_y", {
                              scene: sceneIndex + 1,
                              hotspot: hotspotIndex + 1,
                            })}
                            value={hotspot.yPct}
                            onChange={(event) => updateHotspot(scene.id, hotspotIndex, { yPct: Number(event.target.value) })}
                          />
                        </label>
                        <button
                          type="button"
                          className="self-end rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                          aria-label={t("homepage_builder_room_inspiration_hotspot_remove", {
                            scene: sceneIndex + 1,
                            hotspot: hotspotIndex + 1,
                          })}
                          onClick={() => removeHotspot(scene.id, hotspotIndex)}
                        >
                          {t("homepage_builder_text_block_remove", { index: hotspotIndex + 1 })}
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
    </section>
  );
}
