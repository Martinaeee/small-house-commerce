# Homepage V2 / Visual Homepage Builder — 设计文档

日期：2026-09-27
状态：待用户审阅（审阅通过后进入实施计划编写）
前置文档：`2026-09-15-homepage-redesign-design.md`（现行首页区块）、`2026-09-15-room-scene-hotspots-design.md`（热点画廊）、`2026-09-15-navigation-mega-menu-design.md`（导航）

## 0. 已确认决策（2026-09-27 用户拍板）

1. **数据模型**：版本化 JSONB 文档（`homepage_documents` 单例草稿 + `homepage_versions` 发布快照），不改造现有关系表。
2. **P1 范围**：基建（文档模型 / Draft / Publish / 版本历史）+ Hero 完整可视化（三栏编辑器、元素拖拽、响应式覆盖、Safe Area）+ Announcement Bar。
3. **视频策略**：不做服务端转码，也不做任何服务端 codec 解析（P1 无 ffmpeg/parser）。兼容性以**浏览器实测可解码**为准（元数据加载 + seek + 抽帧成功），不以 MIME 或 `canPlayType` 声明作为验证依据；Poster 强制。
4. **本期只预留、不做完整功能**：Blog / Editorial / Press 模块、Newsletter 订阅、Mega Menu 可视化搭建、Wishlist 功能（Header 图标开关预留、默认隐藏）。
5. **唯一写入链路（canonical write path）**：新 Homepage Document API 是唯一正常可写接口。旧 `homepage_sections` 仅作 **emergency rollback 数据源**（只读冻结）；旧 admin `GET` 可保留（只读排查），旧 admin `PATCH/PUT` 写接口在 P1 **删除**，禁止形成第二套可写数据源或双写。
6. **数据库级单例**：`homepage_documents` 以固定 ID + `CHECK` 约束在数据库层保证有且仅有一行，不依赖 service 约定。
7. **草稿预览 Token 安全契约**：见 §5.2——短 TTL、HMAC 签名不可猜、过期/篡改拒绝、`private, no-store`、`noindex, nofollow`、预览页零追踪、token 不落 localStorage。

补充决策（主 Agent 推荐，用户未否决）：
- RBAC 沿用 `PRODUCT_MANAGE`，P1 不新增权限码。
- 图片继续使用现有原生 `<img>`；`next/image` 迁移与图片转码不在本期。
- `homepage_sections` 旧表只读冻结保留，不删除；emergency rollback = 上一版镜像 + 冻结旧表。

### 最终数据流（唯一写入链路）

```
Editor State                客户端 reducer 草稿 + undo/redo（不落库，改字即预览）
      │
      ▼  Save Draft / 自动保存（3s 防抖，expectedRev 乐观锁）
Saved Draft                 homepage_documents.draft（rev+1，draftUpdatedBy/At）
      │
      ▼  Validate（POST /admin/homepage/validate，或发布时内联执行）
Validation                  errors 阻断发布 / warnings 需管理员确认
      │
      ▼  Publish（立即或排期；从已保存草稿生成快照）
Published Version           homepage_versions（versionNo+1，publishAt/unpublishAt，note）
      │
      ▼  读取时求值（无 cron；unpublishAt 到期自动回退次新有效版本）
Effective Version           publishAt <= now < unpublishAt 的最新版本
      │
      ▼  GET /storefront/homepage（ISR 120s + publish 时标签失效）
Storefront                  HeroSlider / Announcement（独立端点）/ 既有区块组件
```

不存在第二写入链路：旧 `PATCH/PUT /admin/homepage/sections` 在 P1 删除；旧表在迁移后不再被任何写路径触碰。

## 1. 目标与非目标

### 目标
- 把现有表单式首页后台重做为可运营的 Visual Homepage Builder：左侧结构树 / 中间真实组件 Live Preview / 右侧参数面板，Desktop / Tablet / Mobile 随时切换。
- Draft → Preview → Publish 工作流：编辑只进 Draft；Publish 生成新版本；版本历史可预览/恢复/回滚；排期发布读取时求值。
- Hero Slider 多张幻灯、单素材源响应式媒体、元素级拖拽定位（百分比坐标）、逐设备排版覆盖、Safe Area 与裁切边界提示。
- Announcement Bar 多条目轮播、颜色/链接/排期后台可配。
- 前台保持既有区块组件与业务规则（可售过滤、集合/分类水合、ISR + 标签失效），不推翻现有首页业务逻辑。

### 非目标（本期）
- 不迁移到 `next/image`、不做服务端图片转码/视频转码（P3 媒体库阶段评估）。
- 不做 Blog/Editorial/Press 内容系统、Newsletter 订阅、Mega Menu 可视化搭建、Wishlist 功能本体。
- 不做 A/B 测试、多语言首页。
- 不改动订单/结账/商品域任何逻辑。

## 2. 现状与复用清单（盘点结论）

| 能力 | 现状 | 本次处理 |
|---|---|---|
| 首页数据 | `homepage_sections` + `homepage_section_products`，10 种类型，payload JSONB + zod | 一次性快照为 version 1；旧表只读保留 |
| 后台编辑 | `/admin/homepage` 单文件表单式（整表 PATCH） | P1 重做为 Visual Editor；旧 API 保留但不再被页面使用 |
| 前台渲染 | 服务端组件 + SECTION_REGISTRY + ISR 120s + 标签失效桥 | 数据源换成生效版本文档；区块组件不重写 |
| Hero | `HeroSection` 已支持桌面视频/移动图片/双 CTA | 升级为 `HeroSlider`（多张、元素定位、样式） |
| 视频播放 | `ViewportVideo` 已有 `HERO` 模式（未使用）、协调器单播放赢家、reduced-motion/save-data 门控 | 直接启用 |
| Hotspot | `RoomSceneEditor` + `RoomSceneGallery` 已存在 | P2 接入 Builder（P1 不动） |
| 排期先例 | 落地页 `startAt/endAt` 读取时求值（无 cron） | 同一模式用于版本与区块排期 |
| 上传 | 本地盘 `/uploads/catalog/<year>/<uuid>.<ext>`，图 5MB / 视频 100MB，MIME 白名单 | 复用；新增视频校验与客户端 Poster |
| 导航/页头 | MainNav Mega Panel + AnnouncementBar（写死一条） | P1 做 Announcement；Navigation/Header 管理 P3 |
| 追踪 | Meta Pixel 自定义事件（HomepageView/HeroClick 等） | P1 保留；一方 Analytics 在 P2 |
| 拖拽库 | 无任何 DnD 依赖 | 新增 `dnd-kit`（仅列表排序；画布拖拽自研） |

## 3. 数据模型

### 3.1 新表（纯加性迁移）

```prisma
model HomepageDocument {
  id                 String   @id @db.Uuid         // 固定单例 ID 00000000-0000-0000-0000-000000000001（见下）
  draft              Json                          // 编辑器草稿（完整文档）
  draftRev           Int      @default(1)          // 乐观并发计数
  draftUpdatedById   String?  @db.Uuid
  publishedVersionId String?  @db.Uuid             // 最近一次发布动作指向的版本（仅展示用）
  createdAt          DateTime @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime @updatedAt @db.Timestamptz(3)
  @@map("homepage_documents")
}

model HomepageVersion {
  id          String    @id @default(uuid(7)) @db.Uuid
  versionNo   Int       @unique
  document    Json
  note        String?                              // 变更摘要（发布时可填，默认自动生成）
  createdById String?   @db.Uuid
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)  // 发布动作时间
  publishAt   DateTime  @db.Timestamptz(3)         // 生效开始（立即发布=now；排期=未来时间）
  unpublishAt DateTime? @db.Timestamptz(3)         // 计划下线（null=不下线）
  @@index([publishAt])
  @@map("homepage_versions")
}
```

**数据库级单例保证**（不只靠 service 约定）：
- 固定 ID `00000000-0000-0000-0000-000000000001`（沿用 `site_settings` 先例），迁移内直接 `INSERT` 该行；所有读写只用这一常量。
- 迁移内追加原生 SQL 约束：
  ```sql
  ALTER TABLE homepage_documents
    ADD CONSTRAINT homepage_documents_singleton
    CHECK (id = '00000000-0000-0000-0000-000000000001');
  ```
  任何插入第二行的尝试都会被数据库拒绝（固定 ID 撞主键、异 ID 撞 CHECK）。

**生效版本（读取时求值，无 cron）**：

```
effectiveVersion(now) =
  versions WHERE publishAt <= now AND (unpublishAt IS NULL OR unpublishAt > now)
  ORDER BY publishAt DESC, versionNo DESC LIMIT 1
```

回退语义（写入文档，测试覆盖）：
- 某版本到达 `unpublishAt` 或被手动下线后，自动回退到**次新的仍然有效**的版本（即"节日主题到期自动回到日常版本"由发布两条版本实现：先发日常版，再排期节日版并设 unpublishAt）。
- 若不存在任何有效版本（例如仅一个版本且已下线），回退读旧 `homepage_sections` 表；旧表也为空时前台使用现有 `DEFAULT_SECTIONS`。

派生状态（管理端展示）：`SCHEDULED`（publishAt > now）/ `LIVE`（生效中）/ `ENDED`（unpublishAt <= now）/ `SUPERSEDED`（存在更新的 LIVE 版本）。

版本保留：默认保留最近 50 个（超过后仅允许删除非 LIVE、非 SCHEDULED 的旧版本；P1 自动清理不在范围）。

### 3.2 文档 schema v1

```jsonc
{
  "schemaVersion": 1,
  "sections": [
    {
      "id": "uuid",                    // 稳定身份，服务端生成
      "type": "HERO",                  // 复用现有 10 种类型
      "enabled": true,
      "sortOrder": 0,
      "schedule": { "publishAt": null, "unpublishAt": null },   // 区块级排期（P2 开放 UI）
      "payload": { /* 类型专属，见 3.3 */ },
      "products": [ { "productId": "uuid", "sortOrder": 0, "badge": "BEST_SELLER" } ],
      "style": {                       // 逐设备样式覆盖，缺省继承上一级
        "desktop": { /* 类型相关 */ },
        "tablet":  { /* 可选 */ },
        "mobile":  { /* 可选 */ }
      }
    }
  ],
  "announcement": {                    // 顶部横幅（P1）
    "items": [
      {
        "id": "uuid",
        "text": "10.10 HOME SALE · Up to 30% Off",
        "link": { "type": "COLLECTION", "id": "uuid" },
        "linkLabel": "Shop Now",
        "textColor": "#292724",
        "backgroundColor": "#E8EEF4",
        "schedule": { "publishAt": null, "unpublishAt": null },
        "enabled": true,
        "sortOrder": 0
      }
    ],
    "rotationMs": 5000,
    "enabled": true
  }
}
```

服务端用 zod 对整份文档做严格校验（与 DTO 同层）；客户端持有镜像类型。文档中只允许数字/布尔/枚举/受限字符串（颜色 `#rrggbb`、URL 白名单），供前台安全生成内联样式。

### 3.3 HERO payload v2（P1 核心）

```jsonc
{
  "behavior": {
    "autoplay": true, "durationMs": 6000, "transition": "FADE",
    "pauseOnHover": true, "arrows": true, "pagination": "DOTS",
    "manualPauseMs": 12000            // 手动切换后暂停自动轮播的时长
  },
  "slides": [
    {
      "id": "uuid", "name": "01 Brand Hero", "enabled": true, "sortOrder": 0,
      "schedule": { "publishAt": null, "unpublishAt": null },
      "media": {
        "type": "IMAGE",              // IMAGE | VIDEO
        "image": { "url": "/uploads/...", "alt": "..." },
        "video": null,                // { url, poster, autoplay, muted, loop, playsInline,
                                      //   showSoundToggle, pauseOffscreen }
        "mobileOverride": { "enabled": false, "image": null, "video": null },
        "fit": "COVER",               // COVER | CONTAIN
        "focal": { "x": 50, "y": 50 },                    // 全局焦点（%）
        "objectPosition": {                               // 逐设备裁切锚点（%）
          "desktop": { "x": 50, "y": 50 },
          "tablet":  null,             // null=继承 desktop
          "mobile":  null
        }
      },
      "overlay": { "color": "#000000", "opacity": 0.30, "gradient": "BOTTOM" },
      "elements": {
        "eyebrow":     { "text": "...", "style": {...}, "layout": {...}, "overrides": {}, "locked": false },
        "heading":     { ... }, "subheading": { ... },
        "offer":       { "text": "...", "style": { "background": "#C4552D", "textColor": "#FFFFFF",
                                                   "borderRadius": 4, "paddingX": 12, "paddingY": 6 }, ... },
        "ctaPrimary":  { "text": "SHOP NEW ARRIVALS", "link": { "type": "COLLECTION", "id": "..." },
                         "style": { "variant": "SOLID", "background": "...", "textColor": "...",
                                    "borderColor": null, "hoverBackground": "...", "hoverTextColor": "...",
                                    "borderRadius": 0, "paddingX": 28, "paddingY": 14, "size": "MD" }, ... },
        "ctaSecondary": { ... },
        "countdown":   { "enabled": false, "endsAt": null, "style": {...}, ... }
      }
    }
  ]
}
```

元素通用字段：
- `style`：`fontSize`(px) / `fontWeight` / `lineHeight` / `letterSpacing` / `textColor` / `textAlign` / `maxWidthPct`，默认继承站点 Design Tokens（不设置即用组件默认）。
- `layout`：`{ xPct, yPct, widthPct, align, verticalAlign }`——百分比坐标，编辑器拖拽产出。
- `overrides`：`{ tablet?: Partial<layout+style>, mobile?: ... }`，缺省继承 desktop。

### 3.4 迁移策略

一笔迁移 `add_homepage_document_versions`：
1. 建两张新表；`homepage_documents` 插入固定单例行（`id = 00000000-0000-0000-0000-000000000001`）并追加 `homepage_documents_singleton` CHECK 约束（见 §3.1）。
2. 数据回填：把现有 `homepage_sections`（含 products joins）组装为文档 v1，写入 `homepage_documents.draft` 与 `homepage_versions`（versionNo=1，publishAt=迁移时刻，note="Migrated from homepage_sections"）。
3. `homepage_sections` / `homepage_section_products` **只读冻结**保留（emergency rollback 数据源，无任何写路径）。

回填在 SQL 中完成（`jsonb_build_object` / `jsonb_agg`），幂等条件：仅当 `homepage_versions` 为空时执行。迁移后用一个只读比对脚本验证：文档渲染输出与旧接口输出等价（区块数、顺序、payload 深比较）。

## 4. 后端 API

### 4.1 Admin（全部 `PRODUCT_MANAGE`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/homepage/draft` | 返回 `{ draft, draftRev, draftUpdatedAt, draftUpdatedBy, published: {versionNo,publishAt,status}\|null }` |
| PUT | `/api/v1/admin/homepage/draft` | 保存草稿；body `{ draft, expectedRev }`；rev 不匹配返回 409（双编辑器防覆盖） |
| POST | `/api/v1/admin/homepage/validate` | 对当前草稿跑发布前检查，返回 `{ errors[], warnings[] }`（不落库） |
| POST | `/api/v1/admin/homepage/publish` | 从**已保存草稿**生成版本；body `{ note?, publishAt?, unpublishAt?, confirmWarnings? }`；Error 存在时 422；`publishAt` 未来时间=排期发布；成功后触发 `revalidateCache(STOREFRONT)` |
| GET | `/api/v1/admin/homepage/versions` | 版本列表（仅 meta：versionNo/时间/作者/note/派生状态），倒序 |
| GET | `/api/v1/admin/homepage/versions/:id` | 单版本完整文档（预览/恢复用） |
| POST | `/api/v1/admin/homepage/versions/:id/restore` | 把该版本文档写入草稿（不发布） |
| POST | `/api/v1/admin/homepage/versions/:id/unpublish` | 立即下线（写 `unpublishAt=now`；生效版本自动回退到次新有效版本） |
| POST | `/api/v1/admin/homepage/preview-token` | 签发短期草稿预览 token（安全契约见 §5.2），供草稿预览页使用 |

旧接口处置（唯一写入链路）：
- `GET /api/v1/admin/homepage/sections`：**保留**（只读，排查/导出旧数据用，新编辑器不调用）。
- `PATCH /api/v1/admin/homepage/sections`、`PUT /api/v1/admin/homepage/sections/:id/products`：**P1 删除**（路由 + service 写方法一并移除），杜绝第二套可写数据源；emergency rollback 依靠上一版镜像而非这些接口。
- 旧表 `homepage_sections` / `homepage_section_products`：迁移后只读冻结，任何写路径都不再触碰。

### 4.2 Storefront

`GET /api/v1/storefront/homepage` 响应形状**保持今日契约**（`{ sections: [{id,type,title,subtitle,enabled,sortOrder,payload,products,categories}] }`），数据源改为：
1. `effectiveVersion(now)` 的文档；
2. 区块过滤：`enabled && schedule 生效`；
3. 复用现有 `presentSection` 水合与可售过滤（PRODUCT_GRID 可售、CATEGORY_TILES 有图 ACTIVE、ROOM 场景解析等）；
4. HERO 区块把 slides 数组原样传给前台（新 `HeroSlider` 消费）；link 实体在服务端解析为最终 href（`product→/products/slug`、`collection→/collections/slug`、`category→/categories/slug`、`landing→/lp/slug`、`external→https URL`）；
5. `announcement` 项按排期过滤后一并返回。

无生效版本时回退读旧表（迁移前的安全网，迁移后自然不再命中）。

另新增 `GET /api/v1/storefront/announcement`（revalidate 120，tag `storefront`）：返回生效版本文档中按排期过滤后的 `announcement`（items + rotationMs）。Announcement Bar 在全局 layout 渲染（全站显示，与现状一致），因此数据独立于首页 sections 端点，避免 layout 依赖整份首页响应。请求带有效 `previewToken` 时返回草稿文档中的 announcement（`Cache-Control: no-store`）。

### 4.3 发布前检查（P1 规则集）

Error（阻断发布）：
- Hero 启用中的幻灯缺媒体（无图/无视频）；
- 视频缺 Poster；
- CTA / 链接指向不存在的实体 ID（无法解析为 URL）；
- 外链非 `https://`；
- 启用幻灯的 Heading 为空（Required Content）；
- 排期冲突：同区块/幻灯两个启用窗口重叠。

Warning（管理员确认后可发布）：
- 图片缺 Alt；
- 引用商品已下架 / 无有效主图（渲染时自动跳过并提示）；
- PRODUCT_GRID 空（渲染时整块隐藏，不显示 "coming soon"）；
- 文本超出 Safe Area（P1 仅桌面提示，不阻断）。

## 5. 编辑器（后台）

### 5.1 路由与导航

- `/admin/homepage` — Visual Editor（默认入口，替换现有页面）。
- `/admin/homepage/versions` — 版本历史（列表 / 预览 / 恢复 / 下线）。
- AdminShell 导航新增 **Website 分组**（现有扁平导航加分组支持），P1 只放 Homepage 一项；Navigation / Footer / Media Library 在 P3 加入。
- P2 追加 `/admin/homepage/analytics`。

### 5.2 三栏布局

```
┌ 顶部状态栏: 最后保存 / 最后发布 / Draft·Published / 未保存标记 / Save Draft / Preview / Publish ┐
├─────────────┬──────────────────────────────┬──────────────────────┤
│ 模块树       │  Live Preview                │  Settings            │
│ Sections     │  (真实 storefront 组件渲染)    │  (选中元素/区块参数)    │
│  + Slides    │  Desktop | Tablet | Mobile    │                      │
│  拖拽/显隐/   │  设备框缩放                    │                      │
│  复制/删除    │                              │                      │
└─────────────┴──────────────────────────────┴──────────────────────┘
```

- 中间 Preview 直接渲染真实前台组件（`HeroSlider`、`AnnouncementBar`、其余既有区块组件——这些组件无 server-only 依赖，可在客户端复用）；草稿数据客户端水合（商品按 id 经 admin API 拉取摘要，套用与前台一致的过滤规则）。
- 顶部状态栏常驻：`Last Saved`（草稿保存时间/人）、`Last Published`（生效版本）、`Draft/Published 差异标记`、未保存圆点；按钮：`Save Draft`（也可 Cmd/Ctrl+S）、`Preview Draft`（新标签页草稿预览）、`Publish`（弹出发布面板：立即/排期、下线时间、变更摘要、校验结果）。
- Preview Draft 实现与**安全契约**：
  - 流程：后台调 `POST /admin/homepage/preview-token` 签发 token → 新标签打开 `/preview/homepage?token=<token>` → 独立动态路由（不进 ISR）校验通过后以草稿文档渲染同一套区块组件。生产 `/` 不读 searchParams、不改变 ISR，完全不受影响。
  - **Token 格式**：`base64url(payload).base64url(HMAC-SHA256(payload, secret))`；payload = `{ scope: "homepage-draft-preview", draftRev, exp, jti }`；secret 为服务端专用密钥（与 JWT/REVALIDATE 密钥隔离，缺失则预览功能整体禁用）。
  - **TTL**：30 分钟（`exp` 服务端强制校验）；token 不可猜（签名）、不可跨用途复用（scope 校验）。
  - **拒绝策略**：过期、篡改、scope 不符、缺签名一律返回 **404**（统一响应，不给探测信号）；预览页不可被搜索引擎索引。
  - **响应头**：`Cache-Control: private, no-store`；页面 metadata `robots: noindex, nofollow`；`Referrer-Policy: no-referrer`。
  - **零追踪**：预览路由使用独立 layout，**不挂载** Meta Pixel（`MetaPixelInit`）、`HomeTracking`、不触发任何 `data-track-*` 上报、不调用 `/storefront/lp/*/view` 等任何统计端点。
  - **不落存储**：token 只存在于 URL，绝不写入 localStorage / sessionStorage / cookie；关闭标签即失效。
  - 测试覆盖：过期拒绝、篡改拒绝、scope 不符拒绝、预览页零追踪（无 Pixel 请求、无追踪事件）、`no-store`/`noindex` 头存在。

### 5.3 编辑器状态

- 单一 `useReducer` 文档状态 + 历史栈（undo/redo，容量 50，Cmd/Ctrl+Z / Shift+Z）。
- 脏标记：文档与 `lastSavedRev` 比对；自动保存 3s 防抖（可关），状态条显示 `Saving… / Saved / Save failed (retry)`。
- 并发保护：`expectedRev` 乐观锁；409 时提示"他人已保存，载入最新/覆盖"（P1 给载入最新）。

### 5.4 Hero 编辑（P1 重点）

- 左侧：Slide 列表（名称、序号、启用开关、缩略图、拖拽排序、复制、删除、排期、状态角标）。点击选中 → 中间预览切到该幻灯 → 右侧显示该幻灯设置。
- 中间：设备框内渲染 `HeroSlider` 草稿态；点击元素（Eyebrow/Heading/Sub/Offer/CTA/Countdown）即选中，直接拖动改 `xPct/yPct`；拖动时显示吸附（中线/安全区/相邻元素边缘）与对齐辅助线；键盘方向键微调（Shift=10px）；锁定/重置/对齐按钮在元素悬浮工具条与右侧面板同步。
- 右侧分组：`Content`（文案与链接）/ `Typography`（字号/字重/行高/字距/颜色/对齐/最大宽度，默认"继承站点样式"）/ `Position`（X/Y/宽度精确输入 + 对齐/垂直对齐/重置/锁定）/ `Responsive`（切到 Tablet/Mobile 时编辑 override，含"重置为 Desktop 值"）/ `Media`（类型、图片/视频、Poster、Alt、Fit、焦点、逐设备 Object Position、Reset to Focal、Safe Area/Crop 开关）/ `Style`（Offer 与 CTA 的完整样式项）/ `Behavior`（仅选中区块时：自动播放/时长/过渡/悬停暂停/箭头/分页/手动暂停时长）。
- Safe Area 可视化：Header 安全区（顶部 80px 提示线）、文本安全区、媒体裁切边界、移动端裁切、中心通用安全区，全部为预览覆盖层开关。

### 5.5 媒体面板（单素材源）

- 默认只上传一个源（图或视频）；`Use separate mobile media` 开关默认 OFF，开启后可传移动端图片/视频（可选，非必填）。
- 视频上传流程（**以浏览器实测为准，不做 codec 声明判断**）：
  1. 选择文件 → 基础校验：MIME/扩展名 `video/mp4`、体积 ≤ 100MB；
  2. **浏览器解码探测**：在隐藏 `<video>` 中实际加载该文件——`loadedmetadata` 成功（可读 duration/分辨率）→ `currentTime = 1s` 且 `seeked` 事件成功 → canvas `drawImage` 抽帧成功。三步任一失败即拒绝上传并明确提示（"此视频当前浏览器无法解码/定位，请重新导出 MP4"）；
  3. 时长 ≤ 30s、分辨率 ≥ 1280×720（以探测读到的真实元数据为准，不以文件声明为准）；
  4. 抽帧画面作为 Poster（≤5MB PNG/JPG）自动上传；探测通过后允许手动替换 Poster；
  5. 表单就绪。Poster 缺失（含替换失败）时发布校验强制阻断。
  说明：MIME 与 `canPlayType` 只用于初筛，**不构成兼容性验证**；P1 无 ffmpeg/codec parser，兼容性结论只来自"能解码、能 seek、能抽帧"这一实测。
- 焦点/裁切：在媒体预览上点击/拖动十字准星设置 `focal`；逐设备 `objectPosition` 有独立可视化（选择设备后拖动裁切锚点）；`Reset to Focal Point` 一键回退。

### 5.6 Link Picker（P1 版）

- 统一组件 `LinkPicker`：类型选择（Product / Collection / Category / Landing Page / External URL）+ 可搜索选择器（商品复用 `ProductPickerDialog` 模式；集合/分类/落地页走现有 admin list 端点）+ 外链输入（仅 https）+ 预览最终 URL。
- 存储 `{ type, id }` 或 `{ type: "EXTERNAL", url }`；URL 由服务端渲染时解析，运营不写内部路径。

### 5.7 版本历史页

- 列表：版本号 / 时间 / 操作人 / 变更摘要 / 状态角标（LIVE/SCHEDULED/ENDED/SUPERSEDED）。
- 操作：预览（只读渲染该版本文档）、恢复（写入草稿，提示"已恢复到草稿，发布后生效"）、下线（对 LIVE/SCHEDULED 版本）。
- 发布面板中的变更摘要默认自动生成（如"Hero: 3 slides, 2 updated; Announcement: 1 item added"），可编辑。

### 5.8 拖拽技术选型

- 列表排序（模块树、Slide 列表、Announcement 条目）：`dnd-kit`（`@dnd-kit/core` + `@dnd-kit/sortable`），键盘可达。
- 画布元素拖拽：自研 pointer 事件（`pointerdown/move/up` + `setPointerCapture`），便于吸附/辅助线/百分比换算与 undo 集成。
- 新依赖仅进后台 bundle；storefront 不加载。

## 6. 前台渲染

### 6.1 HeroSlider（新组件，替换 HeroSection 的渲染）

- 服务端渲染首屏（第一张幻灯），客户端接管轮播；`ViewportVideo`（`mode="HERO"`）承担视频幻灯：进入视口才加载、离屏暂停、Poster 兜底、reduced-motion / save-data 时禁用自动播放。
- 过渡 FADE / SLIDE；自动播放（时长可配）；`pauseOnHover`；手动切换后暂停自动轮播 `manualPauseMs`；箭头 / 分页（DOTS / 01/03 计数 / PROGRESS 进度条）。
- 高度：桌面 `clamp(560px, 72vh, 720px)` 区间响应式；Tablet/Mobile 按设备覆盖（默认 4:5 竖版）。
- 元素：绝对定位容器 + 服务端生成的逐设备 CSS 变量（见 6.3）；`countdown` 为小型客户端组件（到点自更新）。
- 无媒体时保留现有渐变兜底块（不显示破图）。
- 保持现有追踪属性（`data-track-*`：HeroClick 等）并新增 `slide-id` 维度（P2 Analytics 使用）。

### 6.2 AnnouncementBar v2

- 客户端轮播多条（`rotationMs`），排期过滤在服务端完成；每条支持文字/链接（Link Picker 解析）/文字色/背景色；高度 PC 32–36px、Mobile 30–34px；无启用条目时整条隐藏。
- 数据来自 `GET /storefront/announcement`（全局 layout 拉取，与 categories/settings 同层，revalidate 120）；现有硬编码文案迁移为第一条数据。

### 6.3 响应式样式生成（SSR 安全）

- 服务端把区块/幻灯元素的逐设备样式编译为带作用域的 CSS 变量与媒体查询：

```css
#hp-hero-<sectionId> { --el-heading-size: 48px; --el-heading-x: 7.4%; ... }
@media (min-width: 768px) { ... tablet 覆盖 ... }
@media (min-width: 1024px) { ... desktop ... }
```

- 变量值只允许数字/百分比/枚举/`#rrggbb`（zod 白名单），杜绝样式注入；元素读取 `var(--...)`，无客户端断点检测、无闪烁。

### 6.4 视频约束（已确认策略）

- 仅接受 `video/mp4`；兼容性以**浏览器实测**为准（加载元数据 + seek + 抽帧成功，见 §5.5），不依赖 MIME/`canPlayType` 声明，也不做服务端 codec 解析；不转码。
- Poster 强制（上传时自动抽帧，允许手动替换）；未加载完成显示 Poster 防黑屏。
- 时长上限 30s、分辨率下限 1280×720、体积上限 100MB；判定一律使用浏览器探测读到的真实元数据。

## 7. 分期与范围

### P1（本次实施）
- 后端：3.1 表 + 3.4 迁移 + 4.1/4.2/4.3 全部 API 与校验 + 文档 zod schema。
- 后台：5.1–5.8 全部（三栏编辑器、Hero 幻灯全功能、Announcement 编辑、版本历史、Link Picker、发布面板、自动保存/undo）。
- 前台：HeroSlider、AnnouncementBar v2、CSS 变量生成、草稿预览模式。
- 旧 `/admin/homepage` 页面代码被新编辑器替换（同一路由）；旧 admin `GET sections` 保留（只读），旧 admin `PATCH/PUT` **删除**（唯一写入链路）；emergency rollback = 上一版镜像 + 冻结的旧表数据。

### P2（后续独立规划）
- 其余区块接入 Builder（Category / Best Sellers Manual+Dynamic / Hotspot 专用编辑器（拖拽）/ Get Inspired / UGC 弹层 / Why Shop）。
- 区块级排期 UI + 冲突提示；完整发布校验（低对比、Safe Area 阻断级别、对比度计算）。
- 一方 Analytics：事件表 + 批量 beacon + 区块/幻灯曝光/点击/CTR + 视频 25/50/75/完成 + 后台看板。

### P3（后续独立规划）
- Header 设置（Search/图标开关/Sticky）、Navigation 管理（实体选择器）、Footer 管理。
- Media Library（缩略图/替换/尺寸/Alt/焦点/裁切预览 + WebP/AVIF 生成评估）。
- Blog/Editorial/Press、Newsletter、Mega Menu 可视化、Wishlist 功能本体（按需立项）。

## 8. 测试策略

- **后端 unit/integration**：文档 zod 校验、draft rev 乐观锁、publish 生成版本、effectiveVersion 排期求值（边界含 unpublishAt 回退）、校验规则集、迁移回填等价性（旧表 vs 文档渲染深比较）、DB 单例约束（插入第二行被拒）、preview token 签发/校验（过期、篡改、scope 不符均 404）、旧写接口已删除（PATCH/PUT 不再可达）。
- **前端 unit/component**：编辑器 reducer（undo/redo/脏标记/自动保存节流）、拖拽百分比换算与吸附、CSS 变量生成（含注入白名单）、LinkPicker、发布面板校验展示、HeroSlider 轮播行为（含 reduced-motion）、AnnouncementBar 轮播与排期、视频解码探测（元数据/seek/抽帧失败路径）。
- **Playwright（隔离 E2E 库）**：编辑器改文案→预览即时更新；拖拽元素→坐标持久化；Save Draft→刷新仍在；Publish→前台生效；排期版本不生效/到点生效；版本恢复；预览页零追踪（无 Meta Pixel 请求、无追踪事件）、`no-store`/`noindex` 头存在、过期 token 404、生产 `/` 无 token 行为不变；375/768/1440 三档截图证据。
- **验证纪律**：每批 RED→GREEN；完整 gate（unit / tsc / lint / build / Chromium 全量回归）；独立审查；部署前 pg_dump 备份 + rollback 镜像。

## 9. 风险与回退

| 风险 | 缓解 |
|---|---|
| 编辑器复杂度高、状态多 | 单一 reducer + 文档 schema 单一权威；组件全部受控 |
| 双编辑器互相覆盖 | `draftRev` 乐观锁 + 409 处理 |
| 迁移后前台渲染不一致 | 回填等价性比对测试；旧表冻结只读 + emergency rollback 镜像 |
| 双写/第二数据源 | 旧写接口 P1 删除；旧表无任何写路径；DB 单例约束 |
| 预览 token 泄露/被索引 | 30min TTL + HMAC 签名 + 统一 404 + `no-store`/`noindex`/`no-referrer` + 预览页零追踪；token 仅存在于 URL |
| 服务器 1 核无图片/视频处理 | 本期明确不做转码与 codec 解析；兼容性=浏览器实测；Poster 客户端抽帧；媒体库阶段再评估 |
| 文档体积膨胀 | 图片/视频仅存 URL；版本快照 ≤50 份；单文档上限 512KB 校验 |
| 排期时区 | 全部 `Timestamptz`，管理端输入按 Asia/Manila 展示（复用落地页日期处理惯例） |

## 10. 实施前检查清单（进入编码前执行，逐项留证）

1. **隔离 worktree**：从 `b11595e`（= 生产 `ac4db0e` + 本设计文档 commit，不含任何其他 feature 改动）新建 `feature/homepage-builder` worktree；验证 `git log --oneline ac4db0e..HEAD` 仅输出 `b11595e` 一条。
2. **Homepage BEFORE baseline（改动前采集，只读）**：
   - 前台首页整页截图：1440 / 768 / 390 三档；
   - 现有 Admin Homepage（`/admin/homepage`）截图：列表态 + 区块编辑态；
   - 旧 homepage 表只读 JSON snapshot：`homepage_sections` + `homepage_section_products` 全量导出；
   - 产物存 `docs/superpowers/acceptance/2026-09-27-homepage-before/`（截图 + snapshot.json + 采集时间与 HEAD 记录）。
3. 本地库迁移演练：克隆库应用新迁移，跑回填等价性比对 + DB 单例约束验证。
4. 生产部署前：`pg_dump` → `/root/deploy-backups/pre-homepage-p1-<date>.sql.gz` + gzip/SHA 校验；`small-house-prod-{backend,frontend}:rollback-<sha>` 镜像标记。
5. 迁移仅加性；不删除任何旧表/列；E2E 只在隔离库执行。
