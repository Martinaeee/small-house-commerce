"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, Select, TextInput, Textarea } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { RoomSceneEditor, makeSceneId, readScenes } from "@/components/admin/RoomSceneEditor";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  type AdminCategoryNode,
  type AdminHomepageSection,
  type AdminProduct,
  type HomepageSectionType,
  type SaveHomepageSectionInput,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

const TYPE_LABELS: Record<HomepageSectionType, string> = {
  HERO: "主视觉 Hero",
  USP: "信任承诺条",
  CATEGORY_TILES: "分类瓷砖",
  PRODUCT_GRID: "商品网格",
  SOLUTIONS: "方案入口",
  PRODUCT_STORY: "商品故事",
  ROOM_INSPIRATION: "房间灵感",
  UGC: "真实买家秀",
  BRAND_STORY: "品牌故事",
  CONFIDENCE: "购买保障",
};

const SECTION_LIMITS: Record<HomepageSectionType, number> = {
  HERO: 1, USP: 1, CATEGORY_TILES: 1, SOLUTIONS: 1,
  ROOM_INSPIRATION: 1, UGC: 1, BRAND_STORY: 1, CONFIDENCE: 1,
  PRODUCT_STORY: 2, PRODUCT_GRID: 3,
};

const SINGLETON_TYPES = new Set<HomepageSectionType>(
  (Object.keys(SECTION_LIMITS) as HomepageSectionType[]).filter(
    (type) => SECTION_LIMITS[type] === 1,
  ),
);

const USP_ICONS = [
  { value: "shield", label: "盾牌" },
  { value: "home", label: "房子" },
  { value: "lock", label: "锁" },
  { value: "truck", label: "货车" },
];

interface JoinDraft {
  productId: string;
  sortOrder: number;
  badge: string;
}

interface SectionDraft {
  key: string;
  id?: string;
  type: HomepageSectionType;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  payload: Record<string, unknown>;
  products: JoinDraft[];
  joinsDirty: boolean;
}

type PickerState =
  | { key: string; mode: "multi" }
  | { key: string; mode: "single"; target: { kind: "story" } | { kind: "ugc"; index: number } }
  | { key: string; mode: "single"; target: { kind: "room"; sceneIndex: number; hotspotIndex: number } }
  | null;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function flattenCategories(
  nodes: AdminCategoryNode[],
  depth = 0,
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const node of nodes) {
    out.push({ id: node.id, label: `${"　".repeat(depth)}${node.name}` });
    out.push(...flattenCategories(node.children ?? [], depth + 1));
  }
  return out;
}

/** Strip empty optional fields per type so payloads always pass backend zod. */
function sanitizePayload(
  type: HomepageSectionType,
  p: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const copy = (key: string) => {
    const value = str(p[key]).trim();
    if (value) out[key] = value;
  };

  switch (type) {
    case "HERO":
      [
        "desktopImage", "mobileImage", "videoUrl", "posterImage",
        "ctaPrimaryText", "ctaPrimaryLink", "ctaSecondaryText", "ctaSecondaryLink",
      ].forEach(copy);
      return out;
    case "USP": {
      const items = Array.isArray(p.items) ? p.items : [];
      out.items = items
        .filter((i) => i && str(i.label).trim())
        .map((i) => ({
          ...(i.icon ? { icon: i.icon } : {}),
          label: str(i.label).trim(),
          ...(str(i.sub).trim() ? { sub: str(i.sub).trim() } : {}),
        }));
      return out;
    }
    case "CATEGORY_TILES":
      out.categoryIds = Array.isArray(p.categoryIds)
        ? p.categoryIds.filter((x): x is string => typeof x === "string")
        : [];
      return out;
    case "PRODUCT_GRID":
      if (p.columns === 2 || p.columns === 4) out.columns = p.columns;
      return out;
    case "SOLUTIONS": {
      const items = Array.isArray(p.items) ? p.items : [];
      out.items = items
        .filter((i) => i && str(i.title).trim() && str(i.link).trim())
        .map((i) => ({
          title: str(i.title).trim(),
          ...(str(i.blurb).trim() ? { blurb: str(i.blurb).trim() } : {}),
          link: str(i.link).trim(),
        }));
      return out;
    }
    case "PRODUCT_STORY": {
      ["imageUrl", "heading", "body", "ctaText", "ctaLink"].forEach(copy);
      const productId = str(p.productId).trim();
      if (productId) out.productId = productId;
      return out;
    }
    case "ROOM_INSPIRATION": {
      ["imageUrl", "heading", "body"].forEach(copy);
      const rawScenes = Array.isArray(p.scenes) ? p.scenes : [];
      const round1 = (n: unknown): number | null =>
        typeof n === "number" && Number.isFinite(n)
          ? Math.min(100, Math.max(0, Math.round(n * 10) / 10))
          : null;
      const scenes = rawScenes
        .flatMap((raw) => {
          if (!raw || typeof raw !== "object") return [];
          const s = raw as Record<string, unknown>;
          const imageUrl = str(s.imageUrl).trim();
          if (!imageUrl.startsWith("https://")) return [];
          const id = str(s.id);
          const hotspots = (Array.isArray(s.hotspots) ? s.hotspots : []).flatMap((rawDot) => {
            if (!rawDot || typeof rawDot !== "object") return [];
            const dot = rawDot as Record<string, unknown>;
            const productId = str(dot.productId).trim();
            const xPct = round1(dot.xPct);
            const yPct = round1(dot.yPct);
            // Empty productId = abandoned "pending" dot from a cancelled picker.
            if (!productId || xPct === null || yPct === null) return [];
            return [{ productId, xPct, yPct }];
          });
          const scene: Record<string, unknown> = {
            id: /^[a-z0-9]{8,16}$/.test(id) ? id : makeSceneId(),
            imageUrl,
            hotspots,
          };
          const alt = str(s.alt).trim();
          if (alt) scene.alt = alt;
          return [scene];
        })
        .slice(0, 5);
      if (scenes.length > 0) out.scenes = scenes;
      return out;
    }
    case "UGC": {
      const entries = Array.isArray(p.entries) ? p.entries : [];
      out.entries = entries
        .filter((e) => e && str(e.name).trim() && str(e.comment).trim())
        .map((e) => {
          const o: Record<string, unknown> = {
            name: str(e.name).trim(),
            comment: str(e.comment).trim(),
          };
          if (str(e.location).trim()) o.location = str(e.location).trim();
          if (str(e.imageUrl).trim()) o.imageUrl = str(e.imageUrl).trim();
          const productId = str(e.productId).trim();
          if (productId) o.productId = productId;
          return o;
        });
      return out;
    }
    case "BRAND_STORY":
    case "CONFIDENCE": {
      ["heading", "body"].forEach(copy);
      const bullets = Array.isArray(p.bullets) ? p.bullets : [];
      out.bullets = bullets.map((b) => str(b).trim()).filter(Boolean);
      return out;
    }
  }
}

function toDraft(row: AdminHomepageSection): SectionDraft {
  return {
    key: row.id,
    id: row.id,
    type: row.type,
    title: row.title ?? "",
    subtitle: row.subtitle ?? "",
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    payload: row.payload ?? {},
    products: row.products.map((j) => ({
      productId: j.productId,
      sortOrder: j.sortOrder,
      badge: j.badge ?? "",
    })),
    joinsDirty: false,
  };
}

// --- small field helpers -----------------------------------------------------

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      {children}
    </Field>
  );
}

function MediaField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <Labeled label={label} hint={hint}>
      <ImageUrlInput id={id} ariaLabel={label} value={value} onChange={onChange} placeholder="https://…" />
    </Labeled>
  );
}

// --- product picker dialog ---------------------------------------------------

function ProductPickerDialog({
  open,
  title,
  multi,
  initialSelected,
  cap,
  excludedIds,
  onClose,
  onApply,
  onNames,
}: {
  open: boolean;
  title: string;
  multi: boolean;
  initialSelected: string[];
  // Multi-select ceiling (joins: 24/section). Single-select modes omit it.
  cap?: number;
  // Single mode: product ids the caller forbids (e.g. already pinned by
  // another hotspot in the same room scene — backend zod rejects duplicates).
  excludedIds?: ReadonlySet<string>;
  onClose: () => void;
  onApply: (ids: string[]) => void;
  onNames: (names: Record<string, string>) => void;
}) {
  // The dialog is mounted fresh per open (parent renders it conditionally with
  // a `key`), so initial state is the open-state reset — no open-sync effect;
  // the first page loads on mount with loading initialised true.
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(initialSelected),
  );

  const run = useCallback((query: string) => {
    setLoading(true);
    adminApi
      .listProducts({ search: query || undefined, page: 1, pageSize: 20 })
      .then((res) => {
        setItems(res.items);
        onNames(Object.fromEntries(res.items.map((p) => [p.id, p.name])));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [onNames]);

  useEffect(() => {
    let active = true;
    adminApi
      .listProducts({ page: 1, pageSize: 20 })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        onNames(Object.fromEntries(res.items.map((p) => [p.id, p.name])));
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // dialog remounts per open via `key` from parent; load the first page once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atCap = multi && cap !== undefined && picked.size >= cap;

  const toggle = (id: string) => {
    // Defense against keyboard/label activation of a visually disabled row.
    if (!multi && excludedIds?.has(id)) return;
    // Unchecking stays allowed at the cap; adding a new row is blocked.
    if (multi && cap !== undefined && !picked.has(id) && picked.size >= cap) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} width="lg">
      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(search);
          }}
        >
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按商品名搜索（每次显示前 20 条）"
          />
          <Button type="submit" variant="secondary">
            搜索
          </Button>
        </form>

        {multi && cap !== undefined ? (
          <p className={`text-xs ${atCap ? "text-sale" : "text-ink-muted"}`}>
            {atCap
              ? "每个区块最多关联 24 个商品"
              : `还可选 ${Math.max(0, cap - picked.size)} 个`}
          </p>
        ) : null}

        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <p className="p-4 text-sm text-ink-muted">加载中…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">没有匹配商品。</p>
          ) : (
            items.map((product) => {
              // Multi: over-cap rows blocked (already-picked stay toggleable).
              // Single: caller-excluded products (pinned elsewhere in the same
              // room scene) can't be re-picked — a duplicate would 400 the save.
              const blocked =
                (multi &&
                  cap !== undefined &&
                  !picked.has(product.id) &&
                  picked.size >= cap) ||
                (!multi && excludedIds?.has(product.id) === true);
              return (
                <label
                  key={product.id}
                  className={`flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 ${
                    blocked
                      ? "cursor-not-allowed text-ink-muted"
                      : "cursor-pointer hover:bg-primary-light/30"
                  }`}
                >
                  <input
                    type={multi ? "checkbox" : "radio"}
                    checked={picked.has(product.id)}
                    disabled={blocked}
                    onChange={() => toggle(product.id)}
                  />
                  <span
                    className={`flex-1 text-sm ${blocked ? "text-ink-muted" : "text-ink"}`}
                  >
                    {product.name}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {product.status === "ACTIVE" ? "在售" : "已下架"}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex justify-between gap-2">
          {!multi ? (
            <Button
              variant="text"
              onClick={() => {
                onApply([]);
              }}
            >
              清除关联
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => {
                onApply([...picked]);
              }}
            >
              确定（已选 {picked.size}）
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// --- per-type payload editors ------------------------------------------------

interface EditorProps {
  draft: SectionDraft;
  categories: Array<{ id: string; label: string }>;
  names: Record<string, string>;
  patch: (patch: Record<string, unknown>) => void;
  setProducts: (rows: JoinDraft[]) => void;
  openPicker: (state: Exclude<PickerState, null>) => void;
}

function JoinsEditor({ draft, names, setProducts, openPicker }: EditorProps) {
  const reindex = (rows: JoinDraft[]) => rows.map((r, i) => ({ ...r, sortOrder: i }));

  const move = (index: number, delta: number) => {
    const rows = [...draft.products];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    setProducts(reindex(rows));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        {draft.type === "ROOM_INSPIRATION"
          ? "房间灵感展示全部关联商品（不按库存过滤）；前台按下方顺序排列。"
          : "只展示在售且有可售库存的商品；无商品时前台显示占位卡。"}
      </p>
      {draft.products.map((row, index) => (
        <div
          key={row.productId}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {names[row.productId] ?? row.productId}
          </span>
          <input
            aria-label="角标文字"
            className="w-28 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-ink"
            value={row.badge}
            maxLength={20}
            placeholder="角标，如：新品"
            onChange={(e) => {
              const rows = [...draft.products];
              rows[index] = { ...rows[index], badge: e.target.value };
              setProducts(rows);
            }}
          />
          <Button variant="text" onClick={() => move(index, -1)} disabled={index === 0}>
            ↑
          </Button>
          <Button
            variant="text"
            onClick={() => move(index, 1)}
            disabled={index === draft.products.length - 1}
          >
            ↓
          </Button>
          <Button
            variant="text"
            onClick={() =>
              setProducts(reindex(draft.products.filter((_, i) => i !== index)))
            }
          >
            移除
          </Button>
        </div>
      ))}
      {!draft.id ? (
        <p className="text-xs text-ink-muted">新区块请先点页面底部「保存发布」，之后再选择商品。</p>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "multi" })}>
            选择商品
          </Button>
        </div>
      )}
    </div>
  );
}

function PayloadEditor(props: EditorProps) {
  const { draft, categories, patch, openPicker } = props;
  const p = draft.payload;

  const setField = (key: string, value: unknown) => patch({ [key]: value });

  switch (draft.type) {
    case "HERO":
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MediaField id="hero-desktop" label="桌面端图片 URL" value={str(p.desktopImage)} onChange={(v) => setField("desktopImage", v)} hint="建议宽 1600px 以上；不上传则显示奶油色渐变文字版。" />
          <MediaField id="hero-mobile" label="移动端图片 URL" value={str(p.mobileImage)} onChange={(v) => setField("mobileImage", v)} hint="建议竖图或方图；留空时移动端使用桌面图。" />
          <MediaField id="hero-video" label="桌面端视频 URL（可选）" value={str(p.videoUrl)} onChange={(v) => setField("videoUrl", v)} hint="MP4 直链；桌面端无声自动循环播放，不显示控制条。" />
          <MediaField id="hero-poster" label="视频海报 / 移动端封面 URL" value={str(p.posterImage)} onChange={(v) => setField("posterImage", v)} hint="视频加载前与手机端展示的封面图。" />
          <Labeled label="主按钮文字"><TextInput value={str(p.ctaPrimaryText)} maxLength={120} onChange={(e) => setField("ctaPrimaryText", e.target.value)} /></Labeled>
          <Labeled label="主按钮链接" hint="站内路径（/collections）或 https 链接"><TextInput value={str(p.ctaPrimaryLink)} placeholder="/collections" onChange={(e) => setField("ctaPrimaryLink", e.target.value)} /></Labeled>
          <Labeled label="次按钮文字"><TextInput value={str(p.ctaSecondaryText)} maxLength={120} onChange={(e) => setField("ctaSecondaryText", e.target.value)} /></Labeled>
          <Labeled label="次按钮链接" hint="可用锚点，如 #solutions"><TextInput value={str(p.ctaSecondaryLink)} placeholder="#solutions" onChange={(e) => setField("ctaSecondaryLink", e.target.value)} /></Labeled>
        </div>
      );

    case "USP": {
      const items = Array.isArray(p.items) ? p.items : [];
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">
            留空（不添加任何条目）则前台显示默认四条：货到付款 / 小空间适用 / 安全结账 / 菲律宾配送。最多 4 条。
          </p>
          {items.map((item, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-2">
              <Labeled label="图标">
                <Select
                  value={str(item.icon)}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, icon: e.target.value || undefined };
                    setField("items", next);
                  }}
                >
                  <option value="">默认</option>
                  {USP_ICONS.map((icon) => (
                    <option key={icon.value} value={icon.value}>{icon.label}</option>
                  ))}
                </Select>
              </Labeled>
              <div className="flex-1">
                <Labeled label="承诺标题"><TextInput value={str(item.label)} maxLength={120} onChange={(e) => { const next=[...items]; next[index]={...item,label:e.target.value}; setField("items",next); }} /></Labeled>
              </div>
              <div className="flex-1">
                <Labeled label="补充说明"><TextInput value={str(item.sub)} maxLength={200} onChange={(e) => { const next=[...items]; next[index]={...item,sub:e.target.value}; setField("items",next); }} /></Labeled>
              </div>
              <Button variant="text" onClick={() => setField("items", items.filter((_, i) => i !== index))}>移除</Button>
            </div>
          ))}
          {items.length < 4 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("items", [...items, { label: "", sub: "" }])}>
                添加一条
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "CATEGORY_TILES": {
      const selected = new Set(
        Array.isArray(p.categoryIds) ? p.categoryIds.filter((x): x is string => typeof x === "string") : [],
      );
      const toggleCat = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else if (next.size >= 6) return;
        else next.add(id);
        setField("categoryIds", [...next]);
      };
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">勾选最多 6 个分类，按勾选顺序展示；停用、无图或已删除的分类前台自动跳过。</p>
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 md:grid-cols-2">
            {categories.length === 0 ? (
              <p className="text-sm text-ink-muted">暂无分类。</p>
            ) : (
              categories.map((cat) => (
                <label key={cat.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-ink">
                  <input type="checkbox" checked={selected.has(cat.id)} onChange={() => toggleCat(cat.id)} />
                  <span className="truncate">{cat.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      );
    }

    case "PRODUCT_GRID":
      return (
        <div className="flex flex-col gap-3">
          <Labeled label="每行商品数（桌面端）" hint="默认 4 列；小空间故事场景可用 2 列大图。">
            <Select
              value={p.columns === 2 ? "2" : "4"}
              onChange={(e) => setField("columns", Number(e.target.value))}
            >
              <option value="4">4 列</option>
              <option value="2">2 列</option>
            </Select>
          </Labeled>
          <JoinsEditor {...props} />
        </div>
      );

    case "SOLUTIONS": {
      const items = Array.isArray(p.items) ? p.items : [];
      return (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background p-2 md:grid-cols-4">
              <Labeled label="方案标题"><TextInput value={str(item.title)} maxLength={120} onChange={(e) => { const n=[...items]; n[index]={...item,title:e.target.value}; setField("items",n); }} /></Labeled>
              <Labeled label="一句话说明"><TextInput value={str(item.blurb)} maxLength={300} onChange={(e) => { const n=[...items]; n[index]={...item,blurb:e.target.value}; setField("items",n); }} /></Labeled>
              <Labeled label="链接" hint="/collections/… 或 #锚点"><TextInput value={str(item.link)} placeholder="/collections/small-space-solutions" onChange={(e) => { const n=[...items]; n[index]={...item,link:e.target.value}; setField("items",n); }} /></Labeled>
              <div className="flex items-end"><Button variant="text" onClick={() => setField("items", items.filter((_, i) => i !== index))}>移除</Button></div>
            </div>
          ))}
          {items.length < 6 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("items", [...items, { title: "", blurb: "", link: "" }])}>
                添加方案（最多 6 个）
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "PRODUCT_STORY":
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MediaField id={`story-img-${draft.key}`} label="故事图片 URL" value={str(p.imageUrl)} onChange={(v) => setField("imageUrl", v)} />
          <Labeled label="标题"><TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} /></Labeled>
          <div className="md:col-span-2">
            <Labeled label="正文"><Textarea rows={3} maxLength={2000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} /></Labeled>
          </div>
          <Labeled label="按钮文字"><TextInput value={str(p.ctaText)} maxLength={120} onChange={(e) => setField("ctaText", e.target.value)} /></Labeled>
          <Labeled label="按钮链接"><TextInput value={str(p.ctaLink)} placeholder="/products/…" onChange={(e) => setField("ctaLink", e.target.value)} /></Labeled>
          <div className="md:col-span-2">
            <Labeled label="关联商品（可选）" hint="前台会附上最新价格与库存；商品下架后自动不展示。">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink">
                  {p.productId ? props.names[str(p.productId)] ?? str(p.productId) : "未关联"}
                </span>
                <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "single", target: { kind: "story" } })}>
                  选择商品
                </Button>
              </div>
            </Labeled>
          </div>
        </div>
      );

    case "ROOM_INSPIRATION":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Labeled label="标题">
              <TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} />
            </Labeled>
            <div className="md:col-span-2">
              <Labeled label="正文">
                <Textarea rows={3} maxLength={2000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} />
              </Labeled>
            </div>
          </div>

          <Field
            label="场景图热点（新）"
            hint="配置后前台展示可点热点画廊；留空则回退到下方旧版单图模式。"
          >
            <RoomSceneEditor
              value={p.scenes}
              names={props.names}
              onChange={(scenes) => setField("scenes", scenes)}
              onPickProduct={(sceneIndex, hotspotIndex) =>
                openPicker({
                  key: draft.key,
                  mode: "single",
                  target: { kind: "room", sceneIndex, hotspotIndex },
                })
              }
            />
          </Field>

          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              旧版单图模式（不含场景图时生效）
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <MediaField
                id={`room-img-${draft.key}`}
                label="房间大图 URL"
                value={str(p.imageUrl)}
                onChange={(v) => setField("imageUrl", v)}
              />
              <JoinsEditor {...props} />
            </div>
          </details>
        </div>
      );

    case "UGC": {
      const entries = Array.isArray(p.entries) ? p.entries : [];
      return (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-sale bg-sale/10 p-3 text-sm text-ink">
            仅可录入已获授权的真实客户内容，禁止伪造评价。每条建议留存授权凭证；无授权素材时保持为空，前台会显示中性的即将上线占位卡。
          </div>
          {entries.map((entry, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <MediaField id={`ugc-img-${draft.key}-${index}`} label="买家照片 URL（可选）" value={str(entry.imageUrl)} onChange={(v) => { const n=[...entries]; n[index]={...entry,imageUrl:v}; setField("entries",n); }} />
                <Labeled label="买家称呼"><TextInput value={str(entry.name)} maxLength={120} onChange={(e) => { const n=[...entries]; n[index]={...entry,name:e.target.value}; setField("entries",n); }} /></Labeled>
                <Labeled label="地区（可选）"><TextInput value={str(entry.location)} maxLength={120} onChange={(e) => { const n=[...entries]; n[index]={...entry,location:e.target.value}; setField("entries",n); }} /></Labeled>
                <div className="flex items-end">
                  <Button variant="secondary" onClick={() => openPicker({ key: draft.key, mode: "single", target: { kind: "ugc", index } })}>
                    {entry.productId ? `关联商品：${props.names[str(entry.productId)] ?? "已选"}` : "关联商品（可选）"}
                  </Button>
                </div>
              </div>
              <Labeled label="买家原话"><Textarea rows={2} maxLength={1000} value={str(entry.comment)} onChange={(e) => { const n=[...entries]; n[index]={...entry,comment:e.target.value}; setField("entries",n); }} /></Labeled>
              <div><Button variant="text" onClick={() => setField("entries", entries.filter((_, i) => i !== index))}>移除这条</Button></div>
            </div>
          ))}
          {entries.length < 6 ? (
            <div>
              <Button variant="secondary" onClick={() => setField("entries", [...entries, { name: "", location: "", comment: "" }])}>
                添加买家秀（最多 6 条）
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    case "BRAND_STORY":
    case "CONFIDENCE": {
      const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)) : [];
      const nonEmptyBullets = bullets.map((b) => b.trim()).filter(Boolean).length;
      return (
        <div className="flex flex-col gap-3">
          <Labeled label="标题（可选）"><TextInput value={str(p.heading)} maxLength={120} onChange={(e) => setField("heading", e.target.value)} /></Labeled>
          <Labeled label="正文（可选）"><Textarea rows={4} maxLength={3000} value={str(p.body)} onChange={(e) => setField("body", e.target.value)} /></Labeled>
          <Field
            label="要点列表（每行一条，最多 6 条）"
            error={nonEmptyBullets > 6 ? "最多 6 条要点，请删减空行" : undefined}
          >
            <Textarea
              rows={4}
              value={bullets.join("\n")}
              onChange={(e) => setField("bullets", e.target.value.split("\n"))}
            />
          </Field>
        </div>
      );
    }
  }
}

// --- page --------------------------------------------------------------------

function HomepageAdminContent() {
  const { hasPermission } = useAdminAuth();
  const canManage = hasPermission("PRODUCT_MANAGE");

  const [drafts, setDrafts] = useState<SectionDraft[] | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [addType, setAddType] = useState<HomepageSectionType>("PRODUCT_GRID");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);

  const reload = useCallback(() => {
    setDrafts(null);
    setError(null);
    setPermissionDenied(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([adminApi.listHomepageSections(), adminApi.listCategories()])
      .then(([sections, tree]) => {
        if (!active) return;
        setDrafts(sections.map(toDraft));
        setCategories(flattenCategories(tree));
        setNames(
          Object.fromEntries(
            sections.flatMap((s) => s.products.map((j) => [j.productId, j.product.name] as const)),
          ),
        );
        setError(null);
        setPermissionDenied(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPermissionDenied(errorStatus(err) === 403);
        setError(err instanceof Error ? err.message : "加载失败。");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const sorted = useMemo(
    () => (drafts ? [...drafts].sort((a, b) => a.sortOrder - b.sortOrder) : null),
    [drafts],
  );

  const counts = useMemo(() => {
    const map = new Map<HomepageSectionType, number>();
    drafts?.forEach((d) => map.set(d.type, (map.get(d.type) ?? 0) + 1));
    return map;
  }, [drafts]);

  const typeRemaining = (type: HomepageSectionType) =>
    SECTION_LIMITS[type] - (counts.get(type) ?? 0);

  // Render-phase adjustment (same pattern as ProductForm's syncedInitial):
  // once the selected add-type saturates — last row added, reload or save —
  // move the selector to a type that still has slots. The guard converges in
  // one render; if every type is capped the selection is left as-is and the
  // add button stays disabled.
  const firstAvailableType = (Object.keys(TYPE_LABELS) as HomepageSectionType[]).find(
    (type) => typeRemaining(type) > 0,
  );
  if (typeRemaining(addType) <= 0 && firstAvailableType) {
    setAddType(firstAvailableType);
  }

  const addLeft = typeRemaining(addType);

  // Text blocks cap bullets at 6 (backend zod); non-empty trimmed lines only,
  // so blank spacer/empty trailing lines do not count toward the block.
  const bulletsBlocking = useMemo(
    () =>
      (sorted ?? []).filter((d) => {
        if (d.type !== "BRAND_STORY" && d.type !== "CONFIDENCE") return false;
        const list = Array.isArray(d.payload.bullets) ? d.payload.bullets : [];
        return list.filter((b) => str(b).trim()).length > 6;
      }),
    [sorted],
  );

  const patchDraft = (key: string, patch: Partial<SectionDraft>) =>
    setDrafts((prev) => prev!.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const patchPayload = (key: string, payloadPatch: Record<string, unknown>) =>
    setDrafts((prev) =>
      prev!.map((d) =>
        d.key === key ? { ...d, payload: { ...d.payload, ...payloadPatch } } : d,
      ),
    );

  const setJoinRows = (key: string, rows: JoinDraft[]) =>
    setDrafts((prev) =>
      prev!.map((d) => (d.key === key ? { ...d, products: rows, joinsDirty: true } : d)),
    );

  const addSection = () => {
    // Button-level guard (the option is also disabled in the dropdown).
    if ((counts.get(addType) ?? 0) >= SECTION_LIMITS[addType]) return;
    const maxSort = Math.max(-10, ...(drafts ?? []).map((d) => d.sortOrder));
    const draft: SectionDraft = {
      key: `new-${crypto.randomUUID()}`,
      type: addType,
      title: "",
      subtitle: "",
      enabled: true,
      sortOrder: maxSort + 10,
      payload: {},
      products: [],
      joinsDirty: false,
    };
    setDrafts((prev) => [...(prev ?? []), draft]);
  };

  const removeSection = (key: string) =>
    setDrafts((prev) => prev!.filter((d) => d.key !== key));

  const moveSection = (index: number, delta: number) => {
    if (!sorted) return;
    const target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[target];
    setDrafts((prev) =>
      prev!.map((d) => {
        if (d.key === a.key) return { ...d, sortOrder: b.sortOrder };
        if (d.key === b.key) return { ...d, sortOrder: a.sortOrder };
        return d;
      }),
    );
  };

  const saveAll = async () => {
    if (!sorted) return;
    setSaving(true);
    setSaveError(null);

    const body: SaveHomepageSectionInput[] = sorted.map((d) => ({
      ...(d.id ? { id: d.id } : { type: d.type }),
      title: d.title.trim() || null,
      subtitle: d.subtitle.trim() || null,
      enabled: d.enabled,
      sortOrder: d.sortOrder,
      payload: sanitizePayload(d.type, d.payload),
    }));

    try {
      const saved = await adminApi.saveHomepageSections(body);
      const savedSorted = [...saved].sort((a, b) => a.sortOrder - b.sortOrder);

      // Merge server ids/types back into drafts BEFORE any joins PUT. The
      // PATCH response is the full persisted set in the same sorted order as
      // the `sorted` body we sent (singletons are never deleted client-side;
      // deleted non-singletons vanish on both sides — 1:1 zip by index).
      // Durable ids matter when a later PUT 400s (25 joins, product deleted
      // mid-session): retry must UPDATE these sections, not CREATE duplicates.
      const merged = sorted.map((draft, i) => ({
        ...draft,
        id: savedSorted[i]?.id ?? draft.id,
        type: savedSorted[i]?.type ?? draft.type,
      }));
      setDrafts(merged);

      // PUT loop runs against the local merged copy — it must not wait for the
      // setDrafts re-render. Every row now carries an id; PUT only the dirty.
      for (const draft of merged) {
        if (!draft.joinsDirty || !draft.id) continue;
        await adminApi.setHomepageSectionProducts(
          draft.id,
          draft.products.map((r, i) => ({
            productId: r.productId,
            sortOrder: i,
            badge: r.badge.trim() || null,
          })),
        );
      }

      setSavedAt(new Date().toLocaleTimeString());
      reload();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const onPickerApply = (ids: string[]) => {
    if (!picker) return;
    const draft = drafts?.find((d) => d.key === picker.key);
    if (!draft) {
      setPicker(null);
      return;
    }

    if (picker.mode === "multi") {
      const existing = draft.products.filter((r) => ids.includes(r.productId));
      const known = new Set(existing.map((r) => r.productId));
      const added = ids
        .filter((id) => !known.has(id))
        .map((id) => ({ productId: id, sortOrder: 0, badge: "" }));
      const rows = [...existing, ...added].map((r, i) => ({ ...r, sortOrder: i }));
      setJoinRows(draft.key, rows);
    } else if (picker.target.kind === "story") {
      patchPayload(draft.key, { productId: ids[0] ?? "" });
    } else if (picker.target.kind === "room") {
      const scenes = readScenes(draft.payload.scenes);
      const { sceneIndex, hotspotIndex } = picker.target;
      const scene = scenes[sceneIndex];
      if (scene && scene.hotspots[hotspotIndex]) {
        // Defense in depth: the dialog already greys out same-scene
        // duplicates, but persisting one would make backend zod 400 the
        // whole saveAll batch. Refuse the write; the pending dot is left for
        // sanitize/prune (or cancel) to drop.
        if (
          ids[0] &&
          scene.hotspots.some((h, i) => i !== hotspotIndex && h.productId === ids[0])
        ) {
          setPicker(null);
          return;
        }
        if (ids[0]) scene.hotspots[hotspotIndex].productId = ids[0];
        else scene.hotspots.splice(hotspotIndex, 1);
        // Drop any other abandoned pending dots, then persist back to draft.
        scene.hotspots = scene.hotspots.filter((h) => h.productId !== "");
        patchPayload(draft.key, { scenes });
      }
    } else {
      const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
      const next = [...entries];
      next[picker.target.index] = {
        ...next[picker.target.index],
        productId: ids[0] ?? "",
      };
      patchPayload(draft.key, { entries: next });
    }
    setPicker(null);
  };

  // Cancel / backdrop / Esc: a room picker opened for a freshly placed dot
  // (productId still "") means the operator abandoned the dot — revoke it so
  // no temporary dot lingers (spec §5.3 "取消则撤掉临时点"). Existing hotspots
  // opened via "更换商品" are left untouched.
  const onPickerClose = () => {
    if (picker && picker.mode === "single" && picker.target.kind === "room") {
      const draft = drafts?.find((d) => d.key === picker.key);
      if (draft) {
        const scenes = readScenes(draft.payload.scenes);
        const { sceneIndex, hotspotIndex } = picker.target;
        const scene = scenes[sceneIndex];
        if (scene && scene.hotspots[hotspotIndex]?.productId === "") {
          scene.hotspots.splice(hotspotIndex, 1);
          patchPayload(draft.key, { scenes });
        }
      }
    }
    setPicker(null);
  };

  const pickerInitial = useMemo<string[]>(() => {
    if (!picker) return [];
    const draft = drafts?.find((d) => d.key === picker.key);
    if (!draft) return [];
    if (picker.mode === "multi") return draft.products.map((r) => r.productId);
    if (picker.target.kind === "story") return str(draft.payload.productId) ? [str(draft.payload.productId)] : [];
    if (picker.target.kind === "room") {
      const scenes = readScenes(draft.payload.scenes);
      const id = scenes[picker.target.sceneIndex]?.hotspots[picker.target.hotspotIndex]?.productId;
      return id ? [id] : [];
    }
    const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
    const value = str(entries[picker.target.index]?.productId);
    return value ? [value] : [];
  }, [picker, drafts]);

  // Room single-picker only: products already pinned by OTHER hotspots in the
  // same scene are disabled in the dialog (spec §5.3/§8.3 — one product per
  // scene; a duplicate would make backend zod reject the whole save batch).
  // The hotspot currently being edited is exempt.
  const pickerExcludedIds: ReadonlySet<string> | undefined =
    picker && picker.mode === "single" && picker.target.kind === "room"
      ? (() => {
          const { sceneIndex, hotspotIndex } = picker.target;
          const draft = drafts?.find((d) => d.key === picker.key);
          if (!draft) return undefined;
          const scenes = readScenes(draft.payload.scenes);
          const ids = (scenes[sceneIndex]?.hotspots ?? [])
            .map((h, i) => (i === hotspotIndex ? "" : h.productId))
            .filter((id): id is string => id !== "");
          return new Set(ids);
        })()
      : undefined;

  if (!canManage) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <EmptyState
          title="没有权限"
          hint="首页装修需要商品管理权限（PRODUCT_MANAGE），请联系管理员。"
        />
      </div>
    );
  }
  if (permissionDenied) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <EmptyState title="没有权限" hint="后台拒绝了本次访问（403）。" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <EmptyState
          title="加载失败"
          hint={error}
          action={<Button onClick={reload}>重试</Button>}
        />
      </div>
    );
  }
  if (!sorted) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="首页装修"
        count={sorted.length}
        actions={
          <div className="flex items-center gap-3">
            {savedAt ? <span className="text-sm text-ink-secondary">已发布 {savedAt}</span> : null}
            <Button onClick={saveAll} disabled={saving || bulletsBlocking.length > 0}>
              {saving ? "保存中…" : "保存发布"}
            </Button>
          </div>
        }
      />

      {bulletsBlocking.length > 0 ? (
        <div className="mb-4 mt-4 rounded-lg border border-sale bg-sale/10 p-3 text-sm text-ink">
          最多 6 条要点，请删减空行
        </div>
      ) : null}

      {saveError ? (
        <div className="mb-4 mt-4 rounded-lg border border-sale bg-sale/10 p-3 text-sm text-ink">
          保存失败：{saveError}
        </div>
      ) : null}

      <div className="mb-4 mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <Labeled label="添加新区块">
          <Select
            value={addType}
            onChange={(e) => setAddType(e.target.value as HomepageSectionType)}
          >
            {(Object.keys(TYPE_LABELS) as HomepageSectionType[]).map((type) => {
              const left = SECTION_LIMITS[type] - (counts.get(type) ?? 0);
              return (
                <option key={type} value={type} disabled={left <= 0}>
                  {TYPE_LABELS[type]}（{left <= 0 ? "已达上限" : `还可加 ${left}`}）
                </option>
              );
            })}
          </Select>
        </Labeled>
        <Button
          variant="secondary"
          onClick={addSection}
          disabled={addLeft <= 0}
          title={addLeft <= 0 ? "该类型已达上限" : undefined}
        >
          添加区块
        </Button>
        <span className="text-xs text-ink-muted">
          单例区块（Hero/信任条/分类/方案/房间/UGC/品牌/保障）只能停用，不能删除；排序与启用状态保存后生效。
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {sorted.map((draft, index) => (
          <section
            key={draft.key}
            className={`rounded-lg border bg-card p-4 ${
              draft.enabled ? "border-border" : "border-border opacity-60"
            }`}
          >
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <strong className="text-sm text-ink">{TYPE_LABELS[draft.type]}</strong>
              {SINGLETON_TYPES.has(draft.type) ? (
                <span className="rounded bg-primary-light/60 px-2 py-0.5 text-xs text-ink-secondary">
                  单例
                </span>
              ) : null}
              {draft.type === "PRODUCT_GRID" || draft.type === "ROOM_INSPIRATION" ? (
                <span className="text-xs text-ink-muted">{draft.products.length} 个商品</span>
              ) : null}
              <label className="ml-1 flex items-center gap-1 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patchDraft(draft.key, { enabled: e.target.checked })}
                />
                启用
              </label>
              <span className="flex-1" />
              <Button variant="text" onClick={() => moveSection(index, -1)} disabled={index === 0}>
                ↑ 上移
              </Button>
              <Button
                variant="text"
                onClick={() => moveSection(index, 1)}
                disabled={index === sorted.length - 1}
              >
                ↓ 下移
              </Button>
              {SINGLETON_TYPES.has(draft.type) ? null : (
                <Button variant="text" onClick={() => removeSection(draft.key)}>
                  删除
                </Button>
              )}
            </header>

            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Labeled label="区块标题（可选）">
                <TextInput
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => patchDraft(draft.key, { title: e.target.value })}
                />
              </Labeled>
              <Labeled label="区块副标题（可选）">
                <TextInput
                  value={draft.subtitle}
                  maxLength={500}
                  onChange={(e) => patchDraft(draft.key, { subtitle: e.target.value })}
                />
              </Labeled>
            </div>

            <PayloadEditor
              draft={draft}
              categories={categories}
              names={names}
              patch={(payloadPatch) => patchPayload(draft.key, payloadPatch)}
              setProducts={(rows) => setJoinRows(draft.key, rows)}
              openPicker={setPicker}
            />
          </section>
        ))}
      </div>

      {picker ? (
        <ProductPickerDialog
          key={`${picker.key}-${picker.mode}`}
          open
          title="选择商品"
          multi={picker.mode === "multi"}
          cap={picker.mode === "multi" ? 24 : undefined}
          excludedIds={pickerExcludedIds}
          initialSelected={pickerInitial}
          onClose={onPickerClose}
          onApply={onPickerApply}
          onNames={(incoming) => setNames((prev) => ({ ...prev, ...incoming }))}
        />
      ) : null}
    </div>
  );
}

export default function AdminHomepagePage() {
  return <HomepageAdminContent />;
}
