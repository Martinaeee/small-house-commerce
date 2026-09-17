# 首页场景图热点选购（Shoppable Room Scenes）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首页「房间灵感」区块支持多张场景图，每张图上可放百分比坐标热点，进场依次点亮、点热点弹商品简卡、点卡片进 PDP，后台可视化打点选品。

**Architecture:** 无 migration——多场景存进 ROOM_INSPIRATION 单例区块 payload 的新 `scenes` 数组（JSONB 无约束）。后端 zod 加场景校验、storefront 水合把热点 productId 批量解析成完整商品（ACTIVE 门控、无库存门槛）。前台新增一个客户端画廊叶子组件（RSC 区段不变）；后台新增独立的打点编辑器组件，主页只做挂载和 sanitize 白名单。

**Tech Stack:** NestJS 12 + zod 4.5 + Prisma 7（vitest/oxlint）；Next.js 16 App Router + React 19 + Tailwind v4（零新依赖，纯 CSS keyframes）。

**Spec:** `docs/superpowers/specs/2026-09-15-room-scene-hotspots-design.md`（执行时 spec 与本计划同时读；冲突以 spec 为准）。

## Global Constraints

- 价格只显示 PHP（复用 `PriceBox`，它硬编码 ₱）；COD/配送既有文案一字不改。
- **零新 npm 依赖**；动画纯 CSS keyframes。
- 样式只用 Tailwind 设计 token，禁止组件内 hex（既有例外 `text-sale/border-sale/bg-sale` 与本功能无关）。
- 后台新增文案全部中文；前台无新增可见文案（除 aria-label）。
- 后端改动**先写 vitest**（红→绿），mock 风格沿用 `new HomepageService(prismaMock as never, productsMock)`；TS 导入 ESM `.js` 后缀。
- **不做 Prisma migration**（payload JSONB schema-less）；实施前只读跑一次 `npx prisma migrate status` 确认无 drift，有 drift 立即 STOP。
- 用户的后端 :3000 / 前端 :3001 绝不重启；隔离验收用 :3010/:3002 自己起停。
- 提交只在 `feat/home-pdp`，`git add <显式路径>`，禁止 `git add -A`；不留测试数据。
- 共享文件 `frontend/src/lib/api.ts` **只加不改**（线 B 已书面同意纯新增类型；动手派发 Task 3 时再发一次协调消息）。
- 像素事件继续走 `ProductClick`（委托监听已存在），不新增 Pixel 事件类型。
- 不做 wishlist/心形图标。
- 上限：5 场景 × 8 热点；坐标 0–100 保留 1 位小数；打点夹取 3–97；画幅固定 `aspect-[16/10]` + `object-cover`。

## File Map

后端：
- 改 `backend/src/modules/cms/dto/homepage-section.dto.ts` — roomPayloadSchema 加 scenes。
- 改 `backend/src/modules/cms/homepage.service.ts` — 收集热点 productId + 水合 scenes。
- 测 `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`、`backend/src/modules/cms/homepage.service.spec.ts`。

前端：
- 改 `frontend/src/lib/api.ts` — 纯新增 4 个类型。
- 改 `frontend/src/app/globals.css` — 新增 hotspot-pop / hotspot-ring keyframes。
- 新 `frontend/src/components/home/room-scenes.ts` — payload 运行时收窄（纯函数，无 "use client"）。
- 新 `frontend/src/components/home/RoomSceneGallery.tsx` — 客户端画廊/热点/动画/商品卡。
- 改 `frontend/src/components/home/RoomInspirationSection.tsx` — scenes 分支，旧版零变化。
- 新 `frontend/src/components/admin/RoomSceneEditor.tsx` — 后台打点编辑器。
- 改 `frontend/src/app/admin/(shell)/homepage/page.tsx` — sanitize、PickerState room 分支、挂载编辑器、旧区折叠。

---

### Task 1: 后端 DTO —— scenes payload zod 校验

**Files:**
- Modify: `backend/src/modules/cms/dto/homepage-section.dto.ts:74-78`（替换 `roomPayloadSchema`）
- Test: `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`（追加用例）

**Interfaces:**
- Produces: `roomPayloadSchema` 接受 `{ imageUrl?, heading?, body?, scenes?: RoomScene[] }`，其中
  `RoomScene = { id: /^[a-z0-9]{8,16}$/, imageUrl: https URL, alt?: string≤120, hotspots: Array<{productId: uuid, xPct: 0..100, yPct: 0..100}> }`，
  `scenes ≤ 5`、`hotspots ≤ 8`、同场景 productId 不可重复（跨场景可重复）。

- [ ] **Step 1: 先加失败测试**

在 `homepage-section.dto.spec.ts` 的 `describe('homepage payload schemas', ...)` 内追加：

```ts
  it('accepts ROOM_INSPIRATION scenes with hotspots and keeps legacy fields', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const result = schema.safeParse({
      heading: 'Shop the look',
      scenes: [
        {
          id: 'a1b2c3d4',
          imageUrl: 'https://cdn.example.com/room-1.jpg',
          alt: '马尼拉公寓客厅',
          hotspots: [
            { productId: crypto.randomUUID(), xPct: 34.2, yPct: 57.8 },
            { productId: crypto.randomUUID(), xPct: 3, yPct: 97 },
          ],
        },
        {
          id: 'b2c3d4e5',
          imageUrl: 'https://cdn.example.com/room-2.jpg',
          hotspots: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed room scenes', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const baseHotspot = { productId: crypto.randomUUID(), xPct: 10, yPct: 10 };

    expect(schema.safeParse({ scenes: [{ id: 'BAD-ID', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'http://x.io/a.jpg', hotspots: [] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, xPct: 101 }] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, yPct: -0.1 }] }] }).success).toBe(false);
    expect(
      schema.safeParse({
        scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [baseHotspot, baseHotspot] }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, productId: 'not-a-uuid' }] }],
      }).success,
    ).toBe(false);
  });

  it('enforces room scene/hotspot caps but allows the same product across scenes', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const pid = crypto.randomUUID();
    expect(
      schema.safeParse({
        scenes: Array.from({ length: 6 }, () => ({
          id: 'abcdefgh',
          imageUrl: 'https://x.io/a.jpg',
          hotspots: [],
        })),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [
          {
            id: 'abcdefgh',
            imageUrl: 'https://x.io/a.jpg',
            hotspots: Array.from({ length: 9 }, () => ({ productId: crypto.randomUUID(), xPct: 1, yPct: 1 })),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [
          { id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ productId: pid, xPct: 1, yPct: 1 }] },
          { id: 'ijklmnop', imageUrl: 'https://x.io/b.jpg', hotspots: [{ productId: pid, xPct: 2, yPct: 2 }] },
        ],
      }).success,
    ).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `backend/`）：`npx vitest run src/modules/cms/dto/homepage-section.dto.spec.ts`
Expected: FAIL —— 新用例报 scenes 被剥离/校验缺失。

- [ ] **Step 3: 实现 schema**

在 `dto/homepage-section.dto.ts` 中，把第 74-78 行的：

```ts
const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
});
```

替换为：

```ts
const roomHotspotSchema = z.object({
  productId: z.string().uuid(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
});

const roomSceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,16}$/),
  imageUrl: mediaUrl(),
  alt: z.string().max(120).optional(),
  hotspots: z
    .array(roomHotspotSchema)
    .max(8)
    .superRefine((hotspots, ctx) => {
      // Same product twice in one scene would stack two dots on one item.
      const seen = new Set<string>();
      hotspots.forEach((hotspot, index) => {
        if (seen.has(hotspot.productId)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'productId'],
            message: 'product appears twice in one scene',
          });
        }
        seen.add(hotspot.productId);
      });
    }),
});

const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  // Multi-scene hotspot gallery (spec 2026-09-15-room-scene-hotspots §2).
  scenes: z.array(roomSceneSchema).max(5).optional(),
});
```

注意：本仓 zod 是 **v4.5**，自定义 issue 的 code 用字符串字面量 `'custom'`（v3 的 `z.ZodIssueCode` 在 v4 不可用）。

- [ ] **Step 4: 跑全部后端测试 + lint**

Run：`npm test`
Expected: PASS（全部文件，含 3 个新用例；既有用例不回归）。
Run：`npm run lint`
Expected: 无新增告警。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/cms/dto/homepage-section.dto.ts backend/src/modules/cms/dto/homepage-section.dto.spec.ts
git commit -m "feat(cms): zod validation for room scene hotspot payloads"
```

---

### Task 2: 后端水合 —— scenes 热点商品批量解析

**Files:**
- Modify: `backend/src/modules/cms/homepage.service.ts`（`storefrontGet` 收集点 ~54-76；`presentSection` ROOM 分支 121-131；新增两个 private helper）
- Test: `backend/src/modules/cms/homepage.service.spec.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 payload 形态（DB 中存什么由 zod 保证，但水合代码做防御性收窄，不信任 JSONB）。
- Produces: ROOM_INSPIRATION storefront 视图中
  `payload.scenes: Array<{ id, imageUrl, alt?, hotspots: Array<{ productId, xPct, yPct, product: HydratedProduct }> }>`；
  下架/不存在商品的点剔除，0 库存 ACTIVE 商品保留；无 scenes 旧 payload 响应逐字段不变。

- [ ] **Step 1: 先加失败测试**

在 `homepage.service.spec.ts` 的 `describe('HomepageService.storefrontGet', ...)` 内追加：

```ts
  it('hydrates room scene hotspot products with one batched lookup, drops inactive ids, keeps 0-stock ACTIVE', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        payload: {
          scenes: [
            {
              id: 'scene1',
              imageUrl: 'https://cdn.example.com/s1.jpg',
              alt: '客厅',
              hotspots: [
                { productId: 'p1', xPct: 10, yPct: 20 },
                { productId: 'p2', xPct: 30, yPct: 40 },
                { productId: 'p-gone', xPct: 50, yPct: 60 },
              ],
            },
          ],
        },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    const payload = result.sections[0].payload as {
      scenes: Array<{
        id: string;
        imageUrl: string;
        alt?: string;
        hotspots: Array<{ productId: string; xPct: number; yPct: number; product: { id: string } }>;
      }>;
    };

    expect(payload.scenes).toHaveLength(1);
    expect(payload.scenes[0]).toMatchObject({ id: 'scene1', imageUrl: 'https://cdn.example.com/s1.jpg', alt: '客厅' });
    expect(payload.scenes[0].hotspots.map((h) => h.product.id)).toEqual(['p1', 'p2']);
    expect(payload.scenes[0].hotspots[0]).toMatchObject({ productId: 'p1', xPct: 10, yPct: 20 });
    // p2 has 0 inventory in the fixture but stays: ROOM_INSPIRATION has no stock gate.
    expect(payload.scenes[0].hotspots[1].product.id).toBe('p2');
    // Join ids and payload ids share the single batched lookup (dedup set).
    expect(ctx.products.storefrontByIds).toHaveBeenCalledWith(expect.arrayContaining(['p1', 'p2', 'p-gone']));
  });

  it('keeps legacy ROOM_INSPIRATION payload byte-for-byte when scenes is absent', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        payload: { imageUrl: 'https://cdn.example.com/legacy.jpg', heading: 'Old', body: 'Text' },
        products: [join('room', 'p1', 0)],
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect(result.sections[0].payload).toEqual({
      imageUrl: 'https://cdn.example.com/legacy.jpg',
      heading: 'Old',
      body: 'Text',
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run：`npx vitest run src/modules/cms/homepage.service.spec.ts`
Expected: 新用例 FAIL（`payload.scenes` 原样带 productId 字符串、无 product；`storefrontByIds` 未收到 p-gone）。

- [ ] **Step 3: 收集热点商品 id**

在 `homepage.service.ts` 的 `storefrontGet()` 中，UGC 收集块（64-75 行）之后、`if` 链结尾 `}` 前加：

```ts
      if (section.type === HomepageSectionType.ROOM_INSPIRATION) {
        for (const id of this.collectRoomSceneIds(payload)) productIds.add(id);
      }
```

并在类中 `isSellable` 附近新增两个 private helper（`payloadObject` 之后即可）：

```ts
  /** Defensive read of every hotspot productId inside a room payload's scenes. */
  private collectRoomSceneIds(payload: Record<string, unknown>): string[] {
    if (!Array.isArray(payload.scenes)) return [];
    const ids: string[] = [];
    for (const scene of payload.scenes) {
      if (!scene || typeof scene !== 'object') continue;
      const hotspots = (scene as Record<string, unknown>).hotspots;
      if (!Array.isArray(hotspots)) continue;
      for (const hotspot of hotspots) {
        if (
          hotspot &&
          typeof hotspot === 'object' &&
          typeof (hotspot as Record<string, unknown>).productId === 'string'
        ) {
          ids.push((hotspot as Record<string, string>).productId);
        }
      }
    }
    return ids;
  }

  /**
   * Replace each scene hotspot's productId with the hydrated ACTIVE product.
   * Unresolved dots are dropped (inactive/deleted); scenes with broken images
   * are dropped too. No stock gate — same rule as the legacy room list.
   */
  private hydrateRoomScenes(
    payload: Record<string, unknown>,
    productById: Map<string, HydratedProduct>,
  ): Record<string, unknown> {
    if (!Array.isArray(payload.scenes)) return payload;

    const scenes = payload.scenes.flatMap((rawScene) => {
      if (!rawScene || typeof rawScene !== 'object') return [];
      const scene = rawScene as Record<string, unknown>;
      if (typeof scene.id !== 'string' || typeof scene.imageUrl !== 'string') return [];

      const hotspots = Array.isArray(scene.hotspots) ? scene.hotspots : [];
      const nextHotspots = hotspots.flatMap((rawHotspot) => {
        if (!rawHotspot || typeof rawHotspot !== 'object') return [];
        const hotspot = rawHotspot as Record<string, unknown>;
        if (typeof hotspot.productId !== 'string') return [];
        if (typeof hotspot.xPct !== 'number' || typeof hotspot.yPct !== 'number') return [];
        const product = productById.get(hotspot.productId);
        if (!product) return [];
        return [
          {
            productId: hotspot.productId,
            xPct: hotspot.xPct,
            yPct: hotspot.yPct,
            product,
          },
        ];
      });

      const nextScene: Record<string, unknown> = {
        id: scene.id,
        imageUrl: scene.imageUrl,
        hotspots: nextHotspots,
      };
      if (typeof scene.alt === 'string') nextScene.alt = scene.alt;
      return [nextScene];
    });

    return { ...payload, scenes };
  }
```

- [ ] **Step 4: 挂到 presentSection 的 ROOM 分支**

把 121-131 行的 ROOM_INSPIRATION 分支替换为：

```ts
    if (section.type === HomepageSectionType.ROOM_INSPIRATION) {
      // Shop-this-room thumbs show every ACTIVE joined product (no stock gate).
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter((product): product is HydratedProduct => product !== undefined)
        .map((product) => ({
          ...product,
          badge: section.products.find((j) => j.productId === product.id)?.badge ?? null,
        }));
      return { ...base, payload: this.hydrateRoomScenes(payload, productById), products };
    }
```

- [ ] **Step 5: 全量测试 + lint + build**

Run：`npm test`
Expected: PASS（全文件；旧 ROOM 用例仍绿）。
Run：`npm run lint && npm run build`
Expected: 无新增告警；nest build 成功。

- [ ] **Step 6: 提交**

```bash
git add backend/src/modules/cms/homepage.service.ts backend/src/modules/cms/homepage.service.spec.ts
git commit -m "feat(cms): hydrate room scene hotspot products in storefront response"
```

---

### Task 3: 前端类型（纯新增）+ 热点动画 keyframes

**Files:**
- Modify: `frontend/src/lib/api.ts:124` 后（纯新增类型，不动任何现有行）
- Modify: `frontend/src/app/globals.css`（@layer base 之前纯新增 keyframes/类）

**Interfaces:**
- Produces（Task 4/5 依赖，名字必须一致）:

```ts
export interface RoomSceneHotspotInput { productId: string; xPct: number; yPct: number; }
export interface RoomScene { id: string; imageUrl: string; alt?: string; hotspots: RoomSceneHotspotInput[]; }
export interface RoomSceneHotspot extends RoomSceneHotspotInput { product: Product; }
export interface HydratedRoomScene extends Omit<RoomScene, "hotspots"> { hotspots: RoomSceneHotspot[]; }
```

**协调动作（控制器执行，不属于实现者）：派发本任务前给线 B 发消息，声明 api.ts 纯新增 4 个类型、零改动现有成员。**

- [ ] **Step 1: 加类型**

在 `frontend/src/lib/api.ts` 的 `export type HomepageSectionProduct = Product & { badge: string | null };`（第 124 行）之后插入：

```ts
// --- room scene hotspots (ROOM_INSPIRATION payload) --------------------------

/** Admin/input shape: a dot positioned by percentage over its scene image. */
export interface RoomSceneHotspotInput {
  productId: string;
  xPct: number;
  yPct: number;
}

/** Admin-persisted scene (payload.scenes[n] before storefront hydration). */
export interface RoomScene {
  id: string;
  imageUrl: string;
  alt?: string;
  hotspots: RoomSceneHotspotInput[];
}

/** Storefront shape: backend replaces productId with the hydrated product. */
export interface RoomSceneHotspot extends RoomSceneHotspotInput {
  product: Product;
}

export interface HydratedRoomScene extends Omit<RoomScene, "hotspots"> {
  hotspots: RoomSceneHotspot[];
}
```

- [ ] **Step 2: 加动画 CSS**

在 `frontend/src/app/globals.css` 中 `@layer base {` 之前插入（只用 transform/opacity，无颜色 hex）：

```css
/*
 * Homepage room-scene hotspot entry (one-shot staggered pop + ping ring).
 * Delays are supplied inline per dot; both are disabled for users who
 * prefer reduced motion.
 */
@keyframes hotspot-pop {
  0% {
    opacity: 0;
    transform: scale(0.4);
  }
  60% {
    opacity: 1;
    transform: scale(1.12);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes hotspot-ring {
  0% {
    opacity: 0.7;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(2.2);
  }
}

.hotspot-pop {
  animation: hotspot-pop 260ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

.hotspot-ring {
  animation: hotspot-ring 600ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .hotspot-pop,
  .hotspot-ring {
    animation: none;
  }
}
```

- [ ] **Step 3: 前端三关**

Run（在 `frontend/`）：`npm run lint && npx tsc --noEmit`
Expected: 干净。
（本任务不单独跑 next build，Task 4 结束一起跑。）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/lib/api.ts frontend/src/app/globals.css
git commit -m "feat(home): room scene types and hotspot entry animation"
```

---

### Task 4: 店面画廊 —— RoomSceneGallery + 区段分支

**Files:**
- Create: `frontend/src/components/home/room-scenes.ts`
- Create: `frontend/src/components/home/RoomSceneGallery.tsx`
- Modify: `frontend/src/components/home/RoomInspirationSection.tsx`（整体替换为下方版本）
- Test: 前端无单测基建；关卡 eslint + tsc + `next build`，行为由 Task 6 Playwright 验收。

**Interfaces:**
- Consumes: Task 3 的 `HydratedRoomScene`；`trackAttrs("ProductClick", section, position)`（home-tracking）；`PriceBox`（`@/components/ui/PriceBox`）；`PlaceholderImage`；SectionProps（`@/components/home/sectionRegistry` 导出）。
- Produces: `parseScenes(payload: Record<string, unknown>): HydratedRoomScene[] | null`（新文件导出）；默认导出无，具名导出 `RoomSceneGallery({ section, scenes }: { section: Pick<HomepageSection, "id" | "title">; scenes: HydratedRoomScene[] })`。

- [ ] **Step 1: 新建 payload 收窄纯函数**

`frontend/src/components/home/room-scenes.ts`：

```ts
import type { HydratedRoomScene, Product } from "@/lib/api";

const num0to100 = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.slug === "string" &&
    typeof p.name === "string" &&
    Array.isArray(p.images) &&
    Array.isArray(p.variants)
  );
}

/**
 * Narrow the storefront ROOM_INSPIRATION payload to hydrated scenes.
 * Returns null when there is no valid gallery (caller renders legacy view).
 * Scenes survive with zero valid hotspots (plain editorial image is fine);
 * scenes missing id/image or with malformed dots are dropped individually.
 */
export function parseScenes(payload: Record<string, unknown>): HydratedRoomScene[] | null {
  if (!Array.isArray(payload.scenes)) return null;

  const scenes: HydratedRoomScene[] = [];
  for (const raw of payload.scenes) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.imageUrl !== "string") continue;

    const rawHotspots = Array.isArray(rec.hotspots) ? rec.hotspots : [];
    const hotspots = rawHotspots.flatMap((dot) => {
      if (!dot || typeof dot !== "object") return [];
      const d = dot as Record<string, unknown>;
      const xPct = num0to100(d.xPct);
      const yPct = num0to100(d.yPct);
      if (!isProduct(d.product) || xPct === null || yPct === null) return [];
      return [{ productId: d.product.id, xPct, yPct, product: d.product }];
    });

    scenes.push({
      id: rec.id,
      imageUrl: rec.imageUrl,
      ...(typeof rec.alt === "string" && rec.alt ? { alt: rec.alt } : {}),
      hotspots,
    });
  }

  return scenes.length > 0 ? scenes : null;
}
```

- [ ] **Step 2: 新建客户端画廊组件**

`frontend/src/components/home/RoomSceneGallery.tsx`（整文件照写）：

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { HomepageSection, HydratedRoomScene } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { PriceBox } from "@/components/ui/PriceBox";
import { SectionPlaceholder } from "./SectionPlaceholder";

/**
 * Castlery-style shoppable room gallery: a full-width snap rail on every
 * breakpoint (desktop thumbnails scroll it), white hotspot dots that pop in
 * sequence once per scene, and a portaled product card linking to the PDP.
 */
const CARD_WIDTH = 240;
const CARD_HEIGHT = 96;

interface OpenCard {
  sceneId: string;
  index: number;
}

export function RoomSceneGallery({
  section,
  scenes,
}: {
  section: Pick<HomepageSection, "id" | "title">;
  scenes: HydratedRoomScene[];
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState<Set<string>>(() => new Set());
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [mounted, setMounted] = useState(false);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => setMounted(true), []);

  // Reduced motion: skip the observer-driven pop sequence entirely and show
  // every dot statically.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(mq.matches);
      if (mq.matches) setPlayed(new Set(scenes.map((s) => s.id)));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [scenes]);

  // Fire each scene's pop sequence once when it first fills >=60% of the rail.
  useEffect(() => {
    if (reduced) return;
    const rail = railRef.current;
    if (!rail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          const id = (entry.target as HTMLElement).dataset.sceneId;
          if (!id) continue;
          setActive(scenes.findIndex((s) => s.id === id));
          setPlayed((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }
      },
      { root: rail, threshold: 0.6 },
    );
    const els = rail.querySelectorAll<HTMLElement>("[data-scene-id]");
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reduced, scenes]);

  // Any scroll/resize dismisses the card: its fixed position is viewport-relative.
  useEffect(() => {
    const rail = railRef.current;
    const close = () => setOpenCard(null);
    rail?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      rail?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openHotspot = useCallback((sceneId: string, index: number) => {
    const el = document.querySelector<HTMLElement>(`[data-hotspot="${sceneId}-${index}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - CARD_WIDTH / 2, 8),
      window.innerWidth - CARD_WIDTH - 8,
    );
    const belowTop = rect.bottom + 8;
    const top =
      belowTop + CARD_HEIGHT > window.innerHeight ? rect.top - 8 - CARD_HEIGHT : belowTop;
    setCardPos({ top, left });
    setOpenCard({ sceneId, index });
  }, []);

  const visibleScenes = scenes.filter((s) => !failed.has(s.id));

  if (visibleScenes.length === 0) {
    return (
      <SectionPlaceholder
        title={section.title ?? ""}
        message="Room inspiration coming soon."
        inside
      />
    );
  }

  const openHotspotData = openCard
    ? visibleScenes
        .find((s) => s.id === openCard.sceneId)
        ?.hotspots[openCard.index]
    : undefined;

  return (
    <div>
      <div
        ref={railRef}
        className="flex snap-x snap-mandatory overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleScenes.map((scene) => (
          <div key={scene.id} data-scene-id={scene.id} className="w-full shrink-0 snap-center px-0.5">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-primary-light/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scene.imageUrl}
                alt={scene.alt ?? section.title ?? ""}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() =>
                  setFailed((prev) => {
                    const next = new Set(prev);
                    next.add(scene.id);
                    return next;
                  })
                }
              />
              {scene.hotspots.map((hotspot, index) => {
                const isOpen =
                  openCard?.sceneId === scene.id && openCard.index === index;
                return (
                  <span
                    key={hotspot.product.id}
                    className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%` }}
                  >
                    <button
                      type="button"
                      data-hotspot={`${scene.id}-${index}`}
                      aria-expanded={isOpen}
                      aria-label={`查看商品：${hotspot.product.name}`}
                      onClick={() =>
                        isOpen
                          ? setOpenCard(null)
                          : openHotspot(scene.id, index)
                      }
                      className={`relative flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow-md transition-transform hover:scale-110 ${
                        isOpen ? "ring-2 ring-cta" : "ring-1 ring-border"
                      } ${played.has(scene.id) && !reduced ? "hotspot-pop" : ""}`}
                      style={
                        played.has(scene.id) && !reduced
                          ? { animationDelay: `${index * 90}ms` }
                          : undefined
                      }
                    >
                      {played.has(scene.id) && !reduced ? (
                        <span
                          className="hotspot-ring pointer-events-none absolute inset-0 rounded-full border border-cta/50 opacity-0"
                          style={{ animationDelay: `${index * 90 + 120}ms` }}
                        />
                      ) : null}
                      <span className="h-2 w-2 rounded-full bg-cta" />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop thumbnail selector */}
      {visibleScenes.length > 1 ? (
        <div className="mt-3 hidden justify-center gap-2 lg:flex">
          {visibleScenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              aria-label={`查看第 ${index + 1} 张场景图`}
              onClick={() => {
                railRef.current
                  ?.querySelector(`[data-scene-id="${scene.id}"]`)
                  ?.scrollIntoView({
                    behavior: reduced ? "auto" : "smooth",
                    inline: "center",
                    block: "nearest",
                  });
              }}
              className={`relative h-16 w-28 overflow-hidden rounded-lg ring-offset-2 ${
                active === index ? "ring-2 ring-cta" : "ring-1 ring-border"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={scene.imageUrl} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      {/* Mobile indicator dots */}
      {visibleScenes.length > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5 lg:hidden" aria-hidden>
          {visibleScenes.map((scene, index) => (
            <span
              key={scene.id}
              className={`h-2 rounded-full transition-all ${
                active === index ? "w-4 bg-cta" : "w-2 bg-border"
              }`}
            />
          ))}
        </div>
      ) : null}

      {/* Portaled product card (fixed positioning escapes rail overflow) */}
      {mounted && openCard && openHotspotData
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="关闭商品卡"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setOpenCard(null)}
              />
              <Link
                href={`/products/${openHotspotData.product.slug}`}
                {...trackAttrs("ProductClick", section, openCard.index + 1)}
                onClick={() => setOpenCard(null)}
                className="fixed z-50 flex w-60 gap-3 rounded-xl border border-border bg-card p-3 shadow-lg"
                style={{ top: cardPos.top, left: cardPos.left }}
              >
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-primary-light/30">
                  {openHotspotData.product.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={openHotspotData.product.images[0].url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderImage label="" className="h-full w-full" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm font-medium text-ink">
                    {openHotspotData.product.name}
                  </span>
                  <PriceBox
                    price={openHotspotData.product.variants[0]?.sku?.price ?? null}
                    compareAtPrice={
                      openHotspotData.product.variants[0]?.sku?.compareAtPrice ?? null
                    }
                  />
                </span>
                <span aria-hidden className="self-center text-lg text-cta">
                  ›
                </span>
              </Link>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
```

- [ ] **Step 3: 替换 RoomInspirationSection 分支**

把 `frontend/src/components/home/RoomInspirationSection.tsx` 整体替换为：

```tsx
import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";
import { parseScenes } from "./room-scenes";
import { RoomSceneGallery } from "./RoomSceneGallery";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function RoomInspirationSection({ section }: SectionProps) {
  const p = section.payload ?? {};
  const scenes = parseScenes(p);
  const image = str(p.imageUrl);
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const products = section.products ?? [];

  // New gallery mode: a non-empty scenes array owns the section; legacy
  // imageUrl / joins stay in the DB but are not rendered while scenes exist.
  if (scenes) {
    return (
      <SectionShell>
        <SectionHeading title={heading} />
        <RoomSceneGallery
          section={{ id: section.id, title: section.title }}
          scenes={scenes}
        />
        {body ? <p className="mt-4 text-ink-secondary">{body}</p> : null}
      </SectionShell>
    );
  }

  if (!image && products.length === 0 && !body) {
    return <SectionPlaceholder title={section.title} message="Room inspiration coming soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={heading} />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ) : (
            <PlaceholderImage label="" className="aspect-[4/3] w-full rounded-xl" />
          )}
          {body ? <p className="mt-4 text-ink-secondary">{body}</p> : null}
        </div>
        {products.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              Shop this room
            </h3>
            {products.map((product, index) => {
              const thumb = product.images[0]?.url;
              return (
                <Link
                  key={product.id}
                  href={`/products/${product.slug}`}
                  {...trackAttrs("ProductClick", section, index + 1)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-md"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <PlaceholderImage label="" className="h-16 w-16 rounded-md" />
                  )}
                  <span className="line-clamp-2 flex-1 text-sm font-medium text-ink">
                    {product.name}
                  </span>
                  {product.badge ? (
                    <span className="rounded bg-primary-light/60 px-2 py-1 text-xs text-cta">
                      {product.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 4: 三关 + build**

Run：`npm run lint && npx tsc --noEmit && npm run build`
Expected: 全部成功；`/` 仍为 ISR 静态页。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/home/room-scenes.ts frontend/src/components/home/RoomSceneGallery.tsx frontend/src/components/home/RoomInspirationSection.tsx
git commit -m "feat(home): shoppable room scene gallery with animated hotspots"
```

---

### Task 5: 后台打点编辑器 + 主页挂载

**Files:**
- Create: `frontend/src/components/admin/RoomSceneEditor.tsx`
- Modify: `frontend/src/app/admin/(shell)/homepage/page.tsx`（4 处：PickerState、sanitize、ROOM case、onPickerApply/pickerInitial）
- Test: 三关 + Task 6 Playwright 行为验收。

**Interfaces:**
- Consumes: `ImageUrlInput`（props `{ id?, ariaLabel?, value, onChange, disabled?, placeholder? }`）、admin `Field`（props `{ label, hint?, error?, children }`）、`TextInput`、`Button`、既有 `ProductPickerDialog`（single 模式，`onApply(ids)`，空数组=清除关联）。
- Produces（page.tsx 按这两个名字导入）：
  - `makeSceneId(): string`
  - `readScenes(value: unknown): RoomSceneDraft[]`
  - 组件 `RoomSceneEditor({ value, names, onChange, onPickProduct }: { value: unknown; names: Record<string,string>; onChange: (scenes: RoomSceneDraft[]) => void; onPickProduct: (sceneIndex: number, hotspotIndex: number) => void })`
  - 类型 `RoomSceneDraft = { id: string; imageUrl: string; alt: string; hotspots: RoomHotspotDraft[] }`，`RoomHotspotDraft = { productId: string; xPct: number; yPct: number }`（productId 为 "" 表示打点后未选商品的临时点）。

- [ ] **Step 1: 新建 RoomSceneEditor**

`frontend/src/components/admin/RoomSceneEditor.tsx`（整文件照写）：

```tsx
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
```

- [ ] **Step 2: page.tsx —— 扩展 PickerState**

`frontend/src/app/admin/(shell)/homepage/page.tsx` 第 73-76 行：

```ts
type PickerState =
  | { key: string; mode: "multi" }
  | { key: string; mode: "single"; target: { kind: "story" } | { kind: "ugc"; index: number } }
  | { key: string; mode: "single"; target: { kind: "room"; sceneIndex: number; hotspotIndex: number } }
  | null;
```

- [ ] **Step 3: page.tsx —— 导入**

在文件顶部 import 区（`ImageUrlInput` import 之后）加：

```tsx
import {
  RoomSceneEditor,
  makeSceneId,
  readScenes,
  type RoomSceneDraft,
} from "@/components/admin/RoomSceneEditor";
```

（`RoomSceneDraft` 若 Step 4 未直接引用导致 lint 报未使用，则只导入实际用到的成员；Step 4 的 sanitize 使用 `unknown` 收窄，不直接需要该类型——以 tsc/eslint 为准，未使用就删掉该类型导入。）

- [ ] **Step 4: page.tsx —— sanitize ROOM_INSPIRATION**

把第 148-150 行：

```ts
    case "ROOM_INSPIRATION":
      ["imageUrl", "heading", "body"].forEach(copy);
      return out;
```

替换为：

```ts
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
```

- [ ] **Step 5: page.tsx —— PayloadEditor ROOM case**

把第 650-662 行整个 ROOM_INSPIRATION case 替换为：

```tsx
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
```

- [ ] **Step 6: page.tsx —— onPickerApply room 分支**

把 `onPickerApply` 中（约 933-943 行）：

```tsx
    } else if (picker.target.kind === "story") {
      patchPayload(draft.key, { productId: ids[0] ?? "" });
    } else {
```

替换为：

```tsx
    } else if (picker.target.kind === "story") {
      patchPayload(draft.key, { productId: ids[0] ?? "" });
    } else if (picker.target.kind === "room") {
      const scenes = readScenes(draft.payload.scenes);
      const { sceneIndex, hotspotIndex } = picker.target;
      const scene = scenes[sceneIndex];
      if (scene && scene.hotspots[hotspotIndex]) {
        if (ids[0]) scene.hotspots[hotspotIndex].productId = ids[0];
        else scene.hotspots.splice(hotspotIndex, 1);
        // Drop any other abandoned pending dots, then persist back to draft.
        scene.hotspots = scene.hotspots.filter((h) => h.productId !== "");
        patchPayload(draft.key, { scenes });
      }
    } else {
```

- [ ] **Step 7: page.tsx —— pickerInitial room 分支**

把 `pickerInitial` memo 中（约 952 行）：

```tsx
    if (picker.target.kind === "story") return str(draft.payload.productId) ? [str(draft.payload.productId)] : [];
    const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
```

替换为：

```tsx
    if (picker.target.kind === "story") return str(draft.payload.productId) ? [str(draft.payload.productId)] : [];
    if (picker.target.kind === "room") {
      const scenes = readScenes(draft.payload.scenes);
      const id = scenes[picker.target.sceneIndex]?.hotspots[picker.target.hotspotIndex]?.productId;
      return id ? [id] : [];
    }
    const entries = Array.isArray(draft.payload.entries) ? draft.payload.entries : [];
```

- [ ] **Step 8: 三关 + build**

Run：`npm run lint && npx tsc --noEmit && npm run build`
Expected: 全部成功；`/admin/homepage` 仍为静态页。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/components/admin/RoomSceneEditor.tsx "frontend/src/app/admin/(shell)/homepage/page.tsx"
git commit -m "feat(admin): visual room scene hotspot editor in homepage composer"
```

---

### Task 6: 整功能验收（控制器执行，不派实现者）

环境：隔离后端 `:3010`（如需造数据）与隔离前端 `:3002`（`API_TARGET=http://localhost:3010 NEXT_PUBLIC_META_PIXEL_ID=000000000000`）；
用户的 :3000/:3001 不动；浏览器只用 Playwright MCP 自己的隔离 context（线 B 同期可能在用 chrome-devtools :3003）。

**前置只读检查**

- [ ] `cd backend && npx prisma migrate status` —— 必须无 drift；有 drift 立即 STOP 并与线 B 协调。

**后端门**

- [ ] `cd backend && npm test && npm run lint && npm run build` 全绿（vitest 文件数/用例数相对基线只增不减）。

**前端门**

- [ ] `cd frontend && npm run lint && npx tsc --noEmit && npm run build` 全绿。

**后台 Playwright（throwaway SUPER_ADMIN，验收后删除）**

- [ ] ROOM_INSPIRATION 卡片出现「场景图热点（新）」编辑器；添加 2 场景：场景图用 Playwright `route.fulfill` 的本地占位图不可行（保存要过 https URL 校验）——改用两张 R2/CDN 公网 https 图（无凭证时用 `https://picsum.photos/seed/luwag-room-1/1600/1000` 这类公网图；若网络不可用，则用后端 presign 上传本地生成的 jpg）。
- [ ] 场景 1 打 3 个点并关联 3 个商品（含 1 个 0 库存 ACTIVE），场景 2 打 1 点；验证：打点坐标落在 3–97、1 位小数（PATCH 请求体或 API 回读）；同商品不可重复由后端 400 兜住（手工改请求验证一次）；第 9 个点打不上（8 点上限 UI）；第 6 张场景加不上。
- [ ] 重定位一个点、删除一个点、场景上移/下移、删除整场景（confirm）、取消打点不留垃圾（API 回读无 productId 为空的点）。
- [ ] 保存发布 200；`GET /api/v1/storefront/homepage` 回读：scenes 2 张、点内嵌 product（含价格/compareAtPrice/图/slug）、0 库存点在、若关联一个下架商品则该点消失。

**店面 Playwright 1280**

- [ ] 房间灵感区段显示画廊 + 桌面缩略图；切换缩略图滚到对应场景。
- [ ] 首次进入视口截一帧动画中段：圆点处于不同 pop 阶段（验证 stagger）；播放过的场景回访不重播。
- [ ] 点圆点：商品卡出现（缩略图/名称/₱ 价格/划线价与折扣牌）；点卡片落对 PDP；抓到 Pixel `ProductClick` 自定义事件参数 `{section_id, section_name, position}`，position 为场景内点序号。
- [ ] Esc / 点遮罩关闭卡片；卡不出视口（点选 y>60% 的点验证上翻）。

**店面 Playwright 390 + reduced motion**

- [ ] 横滑切换场景，指示点跟随；卡片 w-60 在 390 宽内不溢出。
- [ ] `colorScheme`/`emulateMedia({ reducedMotion: 'reduce' })`：无动画、所有点静态可见。
- [ ] 旧版兼容：把 scenes 清空保存一次 → 前台恢复旧版双栏（图 + Shop this room），无报错；随后恢复。

**清理（必须）**

- [ ] 删除验收 section payload 的 scenes（恢复 seed：ROOM_INSPIRATION 空 payload）、删除 throwaway admin 与其角色、删除任何临时上传图/脚本；停 :3010/:3002；确认端口空闲、无 `.playwright-mcp` 产物、`git status` 干净。
- [ ] 验收报告写入 SDD 工作区 `task-6-acceptance-report.md`。

---

## Self-Review 记录（计划作者自查）

- spec §3.1 → Task 1；§3.2 → Task 2；§4.1 类型 → Task 3；§4.2-4.4 画廊/兼容/降级 → Task 4；§5 后台 → Task 5；§6 验收 → Task 6；§7 文件清单全覆盖。
- 关键名字跨任务一致：`RoomScene/RoomSceneHotspotInput/RoomSceneHotspot/HydratedRoomScene`（api.ts）、`parseScenes`（room-scenes.ts）、`RoomSceneEditor/readScenes/makeSceneId/RoomSceneDraft`（admin）、`ProductClick` position=点序号。
- zod v4 用 `code: 'custom'`（非 v3 枚举）；坐标动画 transform 放在内层 button、定位 translate 放在外层 span，避免 animation fill 覆盖定位。
- 商品卡用 portal + fixed，规避 snap 轨 `overflow-x:auto` 对浮层的裁剪；滚动/缩放自动关卡。
