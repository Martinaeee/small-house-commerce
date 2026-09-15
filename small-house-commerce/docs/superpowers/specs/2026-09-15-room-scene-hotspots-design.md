# 首页场景图热点选购（Shoppable Room Scenes）设计稿

日期：2026-09-15
分支：`feat/home-pdp`（首页/PDP 线）
参考：Castlery 房间场景图 —— 图上白色热点圆点、进场依次点亮、点圆点弹商品简卡、点卡片进 PDP。

## 1. 目标 / 非目标

### 目标

1. 首页「房间灵感 ROOM_INSPIRATION」区块支持**多张场景图**（画廊）。
2. 每张场景图上可放置若干**百分比坐标热点圆点**，每个圆点关联一个真实商品。
3. 场景首次进入视口时，圆点**按顺序整齐点亮一次**（逐个弹出，一次性，不循环）。
4. 点击圆点弹出商品简洁信息卡：缩略图、商品名、PHP 现价/划线价；点卡片跳转商品详情页。
5. 后台 `/admin/homepage` 可视化管理：多场景、图上点击打点、选品、拖动微调、删除。
6. 复用既有 R2 图片直传、`PriceBox` 价格样式、`ProductClick` Pixel 事件、ISR 失效链路。

### 非目标（V1 不做）

- 场景不支持视频（仅图片 jpeg/png/webp，沿用 R2 限制 ≤8MB）。
- 不做圆点自定义文案/图标；圆点内不显示数字气泡（点亮顺序仅动画用）。
- 不做圆点曝光级埋点；只沿用商品点击 `ProductClick`。
- 不做场景视频、不做全屏沉浸式页、不做"把整间房加入购物车"。
- 不新增 npm 依赖；不做数据库 migration（payload 为无约束 JSONB）。
- 不做 wishlist/心形图标（全站禁令继续生效）。

## 2. 数据模型

ROOM_INSPIRATION 是**单例区块**（limit 1，`HomepageService.SECTION_LIMITS`），多场景放进该区块 payload 的 `scenes` 数组，不新增区块类型、不动 Prisma schema、不做 migration。

在现有 payload（`imageUrl? / heading? / body?`）上**纯新增**：

```jsonc
{
  "heading": "Shop the look",        // 既有，≤120
  "body": "…",                        // 既有，≤2000
  "imageUrl": "https://…",            // 既有旧版单图，保留；scenes 非空时前台忽略
  "scenes": [
    {
      "id": "a1b2c3d4",               // 后台生成的短随机 id（打点身份/React key），^[a-z0-9]{8,16}$
      "imageUrl": "https://cdn…/room-1.jpg",  // 必填，绝对 https，≤2048
      "alt": "马尼拉公寓客厅场景",     // 选填，≤120，图片 alt；缺省回退区块 heading
      "hotspots": [
        { "productId": "018e…uuid", "xPct": 34.2, "yPct": 57.8 }
      ]
    }
  ]
}
```

- 坐标：`xPct` / `yPct` 为**相对图片显示盒的百分比**，number，保留 1 位小数，范围 `[0, 100]`。
  圆点中心定位在 `(xPct%, yPct%)`。打点时后台按 `[3, 97]` 夹取，避免圆点贴边。
- 约束：`scenes` ≤ **5** 张；每场景 `hotspots` ≤ **8** 个；同一场景内 `productId` 不可重复；
  同一商品可出现在不同场景。
- 后台输出空数组时省略 `scenes` 键（旧数据/未配置即旧版渲染，完全向后兼容）。

### 坐标与裁剪的一致性（关键）

前后台场景图**统一使用固定画幅 `aspect-[16/10]` + `object-cover`**，同一容器内百分比坐标在任何像素宽度下都对齐。
不允许后台用自然比例预览、前台用固定比例渲染（那样 cover 裁剪会让点位移）。

## 3. 后端改动（先写 vitest）

### 3.1 zod payload — `backend/src/modules/cms/dto/homepage-section.dto.ts`

扩展 `roomPayloadSchema`：

```ts
const roomHotspotSchema = z.object({
  productId: z.string().uuid(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
});

const roomSceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,16}$/),
  imageUrl: mediaUrl(),                 // 既有 https-only 校验器
  alt: z.string().max(120).optional(),
  hotspots: z.array(roomHotspotSchema).max(8).superRefine((hotspots, ctx) => {
    const seen = new Set<string>();
    hotspots.forEach((h, i) => {
      if (seen.has(h.productId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "productId"], message: "duplicate product in scene" });
      }
      seen.add(h.productId);
    });
  }),
});

const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  scenes: z.array(roomSceneSchema).max(5).optional(),
});
```

注意 `validatePayload` 持久化的是 `parsed.data`（z.object 剥离未知键），不更新 schema 新字段会被静默丢弃。

测试（追加到 `homepage-section.dto.spec.ts`）：合法 scenes 通过；http 图拒绝；坐标越界拒绝；
同场景重复商品拒绝；6 张场景 / 9 个点拒绝；无 scenes 的旧 payload 仍通过。

### 3.2 水合 — `backend/src/modules/cms/homepage.service.ts`

1. `storefrontGet()` 收集待水合商品 id 时，追加 ROOM_INSPIRATION payload 中每个 scene 的 `hotspots[].productId`
   （与 PRODUCT_STORY/UGC payload id 同一收集点，一次 `storefrontByIds` 批量查询）。
2. `presentSection` 的 ROOM_INSPIRATION 分支：
   - 旧字段/joins 输出保持不变；
   - 当 `payload.scenes` 非空，把每个 scene 映射为水合形态：点中商品经 `productById` 解析，
     **解析不到（下架/不存在）的点直接剔除**（`storefrontByIds` 已硬过滤 ACTIVE）；
     **不做库存门槛**，与现有房间灵感"ACTIVE 即展示、不按库存过滤"口径一致；
   - scene 内所有点都被剔除后仍保留图片（纯场景图可展示）；scene 的 imageUrl 缺失时该 scene 剔除。
   - 输出形态：

```ts
{
  ...base,
  payload: { ...payload, scenes: [{ id, imageUrl, alt,
    hotspots: [{ productId, xPct, yPct, product: HydratedProduct }] }] },
  products,  // 既有 joins 水合，保持不变
}
```

测试（追加到 `homepage.service.spec.ts`，先红后绿）：
- scenes 商品正确水合（名称/价格/图进入响应）；
- 下架商品的点被剔除、其余点保留；0 库存 ACTIVE 商品点保留（证明无库存门槛）；
- 旧 payload（无 scenes）响应与现在逐字段一致；
- 点商品 id 与 join 商品 id 混在同一次 `storefrontByIds` 调用里（去重收集）。

### 3.3 不做的事

- 不动 Prisma schema / 不生成 migration；`prisma migrate status` 仅在实施前读取确认无 drift。
- 管理端控制器、`PATCH sections`、revalidate 逻辑均不变（payload 编辑已自动走 `revalidateCache([STOREFRONT])`）。

## 4. 前端 —— 店面

### 4.1 类型（`frontend/src/lib/api.ts`，纯新增，共享文件只加不改）

```ts
export interface RoomHotspotDot { productId: string; xPct: number; yPct: number; }
export interface RoomScene {
  id: string; imageUrl: string; alt?: string;
  hotspots: RoomHotspotDot[];
}
export interface HydratedRoomHotspot extends RoomHotspotDot { product: Product; }
export interface HydratedRoomScene extends Omit<RoomScene, "hotspots"> {
  hotspots: HydratedRoomHotspot[];
}
```
`HomepageSection.payload` 现状是宽类型，组件内做类型收窄（`scenes` 存在且数组非空才走新版）。
**改前向线 B 通报**（api.ts 属共享文件，本次仅新增类型，不改任何现有字段）。

### 4.2 组件划分

- `RoomInspirationSection.tsx`（保持 RSC 服务组件）：
  - payload 有合法 `scenes` → 渲染 `<SectionShell><SectionHeading/><RoomSceneGallery scenes/></SectionShell>`，
    不渲染旧版双栏与 "Shop this room" 侧栏（`body` 渲染在画廊下方）；
  - 否则完全走旧版渲染（旧图 + joins 侧栏），零行为变化。
- 新建 `components/home/RoomSceneGallery.tsx`（`"use client"`），props：
  `{ sectionId: string; sectionTitle: string; scenes: HydratedRoomScene[] }`。
  参照 `RecentlyViewed.tsx` 作为"服务区段内唯一客户端叶子"的先例。

### 4.3 画廊交互

**布局**

- 桌面（lg+）：主舞台一张 `aspect-[16/10]` 图；下方缩略图横排（最多 5），点击切换主舞台；
  当前缩略图用 `ring-2 ring-cta` 标识（Castlery 红框的品牌化替代——不用红/不用 hex）。
- 手机：`overflow-x-auto snap-x snap-mandatory` 横滑，每场景占满宽（同样 16/10，
  390px 视口、容器 px-4 下内容宽 358px、高约 224px）；IntersectionObserver 同步当前 scene 与圆点/指示条；
  缩略图降级为底部小圆点指示（`bg-primary` / `bg-border`）。
- 主舞台与缩略图列表均 `max-w-[1200px]` 容器内，不做全出血（首屏已有 Hero）。

**热点圆点**

- 默认态：`h-7 w-7 rounded-full bg-white/95 ring-1 ring-border shadow-md`，居中一个内点（`bg-cta`，h-2 w-2）。
- 选中态：`ring-2 ring-cta`，弹出商品卡；同时只允许一张卡。
- 进场动画：scene 首次 60% 进入视口（IntersectionObserver，unobserve 一次）时，
  圆点按数组顺序逐个弹出，stagger **90ms**，单个动画 260ms（scale 0.4→1 + 透明度过渡），
  随后每个点带一次一次性扩散环（one-shot ping），全部结束用时 < 1.2s。
  切到另一张未播放过的场景时播放该场景；回访已播放场景不重播。
- **无障碍**：`@media (prefers-reduced-motion: reduce)` 下圆点直接全部静态显示，无动画。
- 动画 keyframes 定义在 `globals.css`（纯新增 `@keyframes hotspot-pop` 与一个工具类，
  delay 用内联 style `animationDelay`），不引动画库。

**商品卡（popover）**

- 一张卡 = 一个 `<Link href="/products/{slug}">`，整卡可点；
  内容：56×56 圆角缩略图（无图用 `PlaceholderImage`）、商品名 `line-clamp-2`、
  `<PriceBox price={sku.price} compareAtPrice={sku.compareAtPrice} />`（复用，PHP/划线/折扣牌样式现成），
  右侧「查看 ›」提示；卡宽 `w-60`，白底圆角阴影，z 层级在图内。
- 定位：以圆点为锚按 3×2 区域翻转，保证不出图：
  x<33% 卡左缘对齐圆点；33–67% 居中；>67% 右缘对齐；
  y<60% 卡在点下方，y≥60% 在点上方。
- 点图内空白或按 Esc 关卡；切换场景关卡。
- 圆点是真正的 `<button aria-expanded aria-controls>`，卡片用 `role="dialog"` 的轻量非模态形态？
  **裁决：不用 dialog**（非模态浮层 + Esc/外部点击关闭即可），卡片容器加 `aria-label`。
- 埋点：卡片 Link 上展开 `trackAttrs("ProductClick", {id:sectionId,title:sectionTitle}, hotspotIndex+1)`，
  `position` = **该场景内点序号（1 起）**。HomeTracking 既有委托点击监听自动发 Pixel 自定义事件，零改动。
  scene 编号不进 Pixel 负载（V1 裁决，避免动共享 tracking 形态；需要时后续再加 scene_position）。

**空态/降级**

- 某场景图片加载失败：隐藏该场景（onError 状态），全部失败则回退 `SectionPlaceholder`。
- 水合后 0 个有效点的场景：显示纯图片，不渲染任何圆点（后台仍可编辑）。

### 4.4 SEO / 性能

- 场景图 `loading="lazy"`（区块在首屏下方），首图可 `fetchPriority="auto"`；不加 next/image（全站现状用裸 img）。
- 不新增 JSON-LD（房间图不是商品聚合页）。

## 5. 前端 —— 后台编辑器

页面 `frontend/src/app/admin/(shell)/homepage/page.tsx`：

1. `sanitizePayload` 的 ROOM_INSPIRATION 分支：除 `imageUrl/heading/body` 外，结构化拷贝 `scenes`
   （白名单字段，数字 `Math.round(v*10)/10`，丢弃空 hotspots / 无 imageUrl 的 scene；scenes 空则不带键）。
   不更新这里，保存会剥光 scenes。
2. `PayloadEditor` ROOM_INSPIRATION case：
   - 保留 标题/正文；
   - 新增「场景图热点」编辑器（建议抽成独立文件
     `frontend/src/components/admin/RoomSceneEditor.tsx`，"use client"，避免主页继续膨胀）；
   - 旧版「房间大图 URL + 商品关联（JoinsEditor）」收起到「旧版单图模式（不含场景时生效）」
     折叠区：**scenes 非空时前台只走画廊**，但旧数据和 joins 不删除，便于回退。
3. 编辑器交互（V1 范围）：
   - 「+ 添加场景图」≤5；每个场景一张卡片：`ImageUrlInput`（支持 R2 直传）+ alt 输入 + 16/10 预览；
     「删除场景」二次确认；场景可上移/下移。
   - **打点**：在预览图空白处点击 → 以点击坐标（clientRect 夹取 3–97%）放临时点并立即打开
     既有 `ProductPickerDialog`（单选模式）；选定写入 `{productId,xPct,yPct}`；取消则撤掉临时点。
   - 已有点显示为圆点（带序号）；点选某点 → 弹出小条显示商品名 +「移动」「删除」：
     - 删除直接移除；
     - 移动：进入移动态后在图上点击新位置即更新坐标（V1 用"选中→点新位置"，
       另支持 pointer 拖拽微调，代码量小则一并做，若复杂度冒头则砍掉只保留点击重定位）。
   - 同场景已选商品在选择器中禁用；达 8 个点禁用「打点」并提示上限。
   - 全部提示用中文，例：
     「点击图片摆放热点，随后选择对应商品；热点按摆放顺序在顾客手机上依次亮起。」
     「最多 5 张场景、每张最多 8 个热点。」
     「下架商品的热点前台自动隐藏，无需手动删除。」
   - 编辑器即时写 draft.payload（走现有 PATCH 保存，不需要 joins PUT）。
4. 未保存新区块的既有守卫不变（先保存区块再编辑内容）；scene 编辑同样在区块已保存后可用。

## 6. 测试与验收策略

- 后端：vitest 先行（DTO + service 水合/门控/向后兼容），命令 `npm test`（backend）。
- 前端无单测基建：eslint + tsc + `next build` 三关。
- Playwright 验收（隔离 :3002 前端 + 只读 :3000，或隔离后端 :3010；不重启用户 :3000/:3001）：
  - 后台：建 2 场景（图用 route fulfill 的本地占位图或 R2 测试 URL），各放 2–3 点、
    验证坐标落库（API 回读 payload）、上限/重复禁用、删除/移动、保存后前台 ISR 可见；
  - 前台 1280：缩略图切换、点依次点亮（截一帧动画中段）、商品卡价格/划线、点击落 PDP 且
    抓到 `ProductClick` Pixel 参数 `{section_id, section_name, position}`；
  - 前台 390：横滑切场景、指示条、卡片翻转不溢出、Esc/外部关闭；
  - prefers-reduced-motion 模拟：无动画、点静态可见；
  - 旧数据兼容：scenes 缺省时旧版双栏渲染不变；
  - 验收后清理全部测试 section/scene 数据（恢复 seed 基线），不留临时数据/截图目录。

## 7. 受影响文件清单

后端（2 改 + 2 测试，无 migration）：
- 改 `backend/src/modules/cms/dto/homepage-section.dto.ts`
- 改 `backend/src/modules/cms/homepage.service.ts`
- 测 `backend/src/modules/cms/dto/homepage-section.dto.spec.ts`
- 测 `backend/src/modules/cms/homepage.service.spec.ts`

前端：
- 改 `frontend/src/lib/api.ts`（**纯新增类型；改前通报线 B**）
- 改 `frontend/src/components/home/RoomInspirationSection.tsx`（新旧分支）
- 新 `frontend/src/components/home/RoomSceneGallery.tsx`（客户端画廊/圆点/动画/卡片）
- 新 `frontend/src/components/admin/RoomSceneEditor.tsx`（后台打点编辑器）
- 改 `frontend/src/app/admin/(shell)/homepage/page.tsx`（sanitize + 挂编辑器 + 折叠旧区）
- 改 `frontend/src/app/globals.css`（新增 hotspot 动画 keyframes，纯新增）

文档：本 spec + 实施计划；不动 seed（空 scenes 即现状）、不动 default-sections。

## 8. 裁决记录（实施中不再询问）

1. 多场景放单例 payload 数组，不新增区块类型、不做 migration（JSONB 天然支持）。
2. 坐标 0–100 百分比、1 位小数、打点夹取 3–97；画幅固定 16/10 + object-cover 保证前后台对齐。
3. 上限：5 场景 × 8 热点；同场景商品不重复。
4. 水合门控：ACTIVE 即可、**无库存门槛**（沿用 ROOM_INSPIRATION 现行口径）；下架点自动隐藏。
5. scenes 非空时旧版单图与"Shop this room"侧栏前台不渲染，但数据保留可回退。
6. Pixel 复用 `ProductClick`，position 为场景内点序号；不加场景维度事件。
7. 动画一次性、stagger 90ms、遵守 prefers-reduced-motion；纯 CSS keyframes，零依赖。
8. 商品卡非模态浮层（不用 dialog 角色），Esc/外部点击关闭，整卡即 PDP 链接。
9. 选中态用品牌棕 `ring-cta`，不用 Castlery 的红框；新增颜色只用既有 token。
10. V1 移动热点支持"选中→点新位置"重定位；pointer 拖拽为锦上添花，复杂度冒头即砍。
