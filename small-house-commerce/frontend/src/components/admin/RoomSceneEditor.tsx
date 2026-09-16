"use client";

import { useState, type MouseEvent } from "react";
import { Field, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { Button } from "@/components/ui/Button";

// Row-level micro actions use a plain button: the design-system Button enforces
// h-12 / min-w-120px even in "text" variant, which is too large for these rows.
const miniBtn =
  "text-sm text-cta hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline";

export interface RoomHotspotDraft {
  productId: string;
  xPct: number;
  yPct: number;
}

export interface RoomSceneDraft {
  id: string;
  imageUrl: string;
  alt: string;
  hotspots: RoomHotspotDraft[];
}

export const makeSceneId = (): string =>
  Math.random().toString(36).slice(2, 10).padEnd(8, "0");

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clampPct = (n: number): number => Math.min(97, Math.max(3, round1(n)));

/** Narrow persisted/raw payload into editable drafts (malformed rows dropped). */
export function readScenes(value: unknown): RoomSceneDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !/^[a-z0-9]{8,16}$/.test(s.id)) return [];
    if (typeof s.imageUrl !== "string") return [];
    const hotspots = Array.isArray(s.hotspots) ? s.hotspots : [];
    return [
      {
        id: s.id,
        imageUrl: s.imageUrl,
        alt: typeof s.alt === "string" ? s.alt : "",
        hotspots: hotspots.flatMap((h) => {
          if (!h || typeof h !== "object") return [];
          const dot = h as Record<string, unknown>;
          if (
            typeof dot.productId !== "string" ||
            typeof dot.xPct !== "number" ||
            typeof dot.yPct !== "number"
          ) {
            return [];
          }
          return [{ productId: dot.productId, xPct: dot.xPct, yPct: dot.yPct }];
        }),
      },
    ];
  });
}

const MAX_SCENES = 5;
const MAX_HOTSPOTS = 8;

export function RoomSceneEditor({
  value,
  names,
  onChange,
  onPickProduct,
}: {
  value: unknown;
  names: Record<string, string>;
  onChange: (scenes: RoomSceneDraft[]) => void;
  onPickProduct: (sceneIndex: number, hotspotIndex: number) => void;
}) {
  const scenes = readScenes(value);
  const [move, setMove] = useState<{ s: number; h: number } | null>(null);

  const update = (next: RoomSceneDraft[]) => onChange(next);

  const prunePending = (list: RoomSceneDraft[]): RoomSceneDraft[] =>
    list.map((s) => ({ ...s, hotspots: s.hotspots.filter((h) => h.productId !== "") }));

  const placeOnImage = (
    event: MouseEvent<HTMLDivElement>,
    sceneIndex: number,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const xPct = clampPct(((event.clientX - rect.left) / rect.width) * 100);
    const yPct = clampPct(((event.clientY - rect.top) / rect.height) * 100);
    const next = prunePending(scenes);
    const scene = next[sceneIndex];
    if (!scene) return;

    if (move && move.s === sceneIndex) {
      const h = move.h;
      if (scene.hotspots[h]) scene.hotspots[h] = { ...scene.hotspots[h], xPct, yPct };
      setMove(null);
      update(next);
      return;
    }

    const validCount = scene.hotspots.length;
    if (validCount >= MAX_HOTSPOTS) return;
    scene.hotspots.push({ productId: "", xPct, yPct });
    update(next);
    onPickProduct(sceneIndex, scene.hotspots.length - 1);
  };

  const addScene = () => {
    if (scenes.length >= MAX_SCENES) return;
    update([...scenes, { id: makeSceneId(), imageUrl: "", alt: "", hotspots: [] }]);
  };

  const removeScene = (index: number) => {
    if (!window.confirm(`确定删除第 ${index + 1} 张场景图及其全部热点？`)) return;
    setMove(null);
    update(scenes.filter((_, i) => i !== index));
  };

  const moveScene = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target], next[index]];
    setMove(null);
    update(next);
  };

  const removeHotspot = (s: number, h: number) => {
    const next = scenes.map((scene, i) =>
      i === s ? { ...scene, hotspots: scene.hotspots.filter((_, j) => j !== h) } : scene,
    );
    setMove(null);
    update(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-muted">
        点击预览图摆放热点，随后选择对应商品；热点按摆放顺序在顾客手机上依次亮起。最多 5 张场景、每张最多 8
        个热点；下架商品的热点前台自动隐藏，无需手动删除。
      </p>

      {scenes.map((scene, sIndex) => (
        <div key={scene.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">场景 {sIndex + 1}</span>
            <span className="flex-1" />
            <button type="button" className={miniBtn} onClick={() => moveScene(sIndex, -1)} disabled={sIndex === 0}>
              ↑
            </button>
            <button
              type="button"
              className={miniBtn}
              onClick={() => moveScene(sIndex, 1)}
              disabled={sIndex === scenes.length - 1}
            >
              ↓
            </button>
            <button type="button" className={miniBtn} onClick={() => removeScene(sIndex)}>
              删除场景
            </button>
          </div>

          <Field label="场景图片 URL（支持本地上传，JPG/PNG/WebP ≤ 8MB）">
            <ImageUrlInput
              id={`room-scene-${scene.id}`}
              ariaLabel="场景图片 URL"
              value={scene.imageUrl}
              onChange={(url) =>
                update(scenes.map((s, i) => (i === sIndex ? { ...s, imageUrl: url } : s)))
              }
            />
          </Field>
          <Field label="图片说明（alt，可选）" hint="读屏软件与搜索可见，建议描述房间与风格。">
            <TextInput
              value={scene.alt}
              maxLength={120}
              onChange={(e) =>
                update(scenes.map((s, i) => (i === sIndex ? { ...s, alt: e.target.value } : s)))
              }
            />
          </Field>

          {scene.imageUrl ? (
            <div className="flex flex-col gap-2">
              <div
                role="img"
                aria-label="场景图打点区，点击图片摆放热点"
                onClick={(e) => placeOnImage(e, sIndex)}
                className={`relative aspect-[16/10] w-full cursor-crosshair overflow-hidden rounded-lg border border-border ${
                  move?.s === sIndex ? "ring-2 ring-cta" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scene.imageUrl}
                  alt={scene.alt || `场景 ${sIndex + 1}`}
                  className="pointer-events-none h-full w-full select-none object-cover"
                  draggable={false}
                />
                {scene.hotspots.map((h, hIndex) => (
                  <span
                    key={`${h.productId}-${hIndex}`}
                    className="pointer-events-none absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[10px] font-bold text-cta shadow-md ring-1 ring-cta"
                    style={{ left: `${h.xPct}%`, top: `${h.yPct}%` }}
                  >
                    {hIndex + 1}
                  </span>
                ))}
                {move?.s === sIndex ? (
                  <span className="absolute left-2 top-2 rounded bg-cta px-2 py-1 text-xs text-white">
                    点击图片选择新位置
                    <button
                      type="button"
                      className="ml-2 underline disabled:text-ink-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMove(null);
                      }}
                    >
                      取消
                    </button>
                  </span>
                ) : null}
              </div>

              {scene.hotspots.length >= MAX_HOTSPOTS ? (
                <p className="text-xs text-sale">每张场景最多 {MAX_HOTSPOTS} 个热点。</p>
              ) : null}

              <div className="flex flex-col gap-1">
                {scene.hotspots.map((h, hIndex) => (
                  <div
                    key={`${h.productId}-${hIndex}`}
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                      move?.s === sIndex && move?.h === hIndex
                        ? "border-cta bg-primary-light/30"
                        : "border-border bg-card"
                    }`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cta text-[10px] font-bold text-white">
                      {hIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {h.productId ? names[h.productId] ?? h.productId : "待选商品（未选则保存时丢弃）"}
                    </span>
                    <button
                      type="button"
                      className={miniBtn}
                      onClick={() => onPickProduct(sIndex, hIndex)}
                    >
                      {h.productId ? "更换商品" : "选择商品"}
                    </button>
                    <button
                      type="button"
                      className={miniBtn}
                      onClick={() => setMove({ s: sIndex, h: hIndex })}
                    >
                      在图上重定位
                    </button>
                    <button
                      type="button"
                      className={miniBtn}
                      onClick={() => removeHotspot(sIndex, hIndex)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">先填写或上传场景图片，保存链接后即可在图上打点。</p>
          )}
        </div>
      ))}

      {scenes.length < MAX_SCENES ? (
        <div>
          <Button variant="secondary" onClick={addScene}>
            添加场景图（还可加 {MAX_SCENES - scenes.length} 张，最多 {MAX_SCENES} 张）
          </Button>
        </div>
      ) : (
        <p className="text-xs text-sale">最多 {MAX_SCENES} 张场景图。</p>
      )}
    </div>
  );
}
