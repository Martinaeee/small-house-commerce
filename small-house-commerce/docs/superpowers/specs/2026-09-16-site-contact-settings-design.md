# 后台站点联系设置 + Messenger 客服激活（A 批）设计

日期：2026-09-16
分支：`feat/site-contact-settings`（堆叠在线 B `feat/plp-quick-add` 之上；合入顺序：阶段 1 → quick-add → 本支）
参考：2026-09-16 功能盘点审计（客服/checkout/查单）；竞品截图（Castlery 定位弹窗、nathanjames 结账页、Temu 式客服气泡）

## 1. 目标与非目标

### 目标
1. **后台可热改的联系配置**：超级管理员在 `/admin/settings` 维护 Messenger 链接、客服邮箱、服务时间；保存后前台经缓存失效主动刷新（不等 5 分钟）。
2. **Messenger 浮动客服按钮真正生效**：全站 storefront（含类目页/PDP/checkout/购物车，手机+电脑）显示；沿用现有组件的拖拽（可拖到任意一边）、滚动隐藏/淡回。
3. **闲置提醒**：页面 45 秒无操作且标签页可见时，按钮旁弹出 "Have questions? Chat now" 小卡片；关闭后本次访问不再弹。
4. **Checkout "Need help?"**：结账页标题行右侧显示 Messenger + 邮箱 + 服务时间；未配置 Messenger 时降级为仅邮箱，不出死链接。
5. **消灭现有硬编码**：Footer / PDP 缺货区 / PDP FAQ 里写死的 `support@luwag.ph` 与 `Mon–Sat, 9am–6pm (PHT)` 改读设置。

### 非目标（本批不做）
- 不做站内聊天窗/聊天 SDK（fb-customerchat 插件、tawk 等）；点击统一新标签打开 m.me。
- 不做 WhatsApp/Viber/热线渠道（数据模型允许将来加列，但本批只有三个字段；"Need help?" 只放 Messenger+邮箱）。
- 不做进站定位弹窗（那是 E 批 checkout 地址步的事）。
- 不新增任何 Meta Pixel 事件；不改冻结的 COD/配送文案；零新 npm 依赖。
- 后台只有单行站点联系设置，不做通用 settings 框架/多语言/多站点。
- B/C/D/E 批（checkout 体验补强、游客查单、配送日期、地址地图）各自立项。

## 2. 现状事实（实现者须知）

- 浮动按钮组件已存在：`frontend/src/components/chat/MessengerChat.tsx`（FAB、Pointer Events 全屏拖拽、滚动 600ms 淡回、点击 `window.open(MESSENGER_URL)`）；挂在全站唯一 storefront 布局 `frontend/src/app/(storefront)/layout.tsx:48`。**未生效原因**：链接来自 `lib/siteConfig.ts` 的 `process.env.NEXT_PUBLIC_MESSENGER_URL`（默认 `""`），空值时组件 early-return null，且部署配置从未设置该 env。
- 硬编码三处：`components/layout/Footer.tsx:43-44`、`components/product/PdpClient.tsx:14,349`、`components/product/PdpInfoSections.tsx:41,65`。
- 后台无任何设置模块（modules：auth/cart/catalog/collections/customers/inventory/orders/uploads/users）；但**权限 `SYSTEM_SETTINGS_EDIT` 已存在**（`prisma/schema/identity.prisma:47`），种子里仅 SUPER_ADMIN 拥有（seed.ts:102），ADMIN 没有（seed.ts:104-118），不用改种子。
- 模块先例 = collections：`admin/` + `storefront/` 双 controller + 共享 service + `dto/`（Zod 管道）；全局前缀 `/api/v1`；管理端 `@UseGuards(JwtAuthGuard, PermissionsGuard)` + 类级 `@Permissions('SYSTEM_SETTINGS_EDIT')`（先例 users.controller.ts:27-30）；feature module 需 `imports: [AuthModule]`；ESM `.js` import 后缀；PrismaService 全局注入，类型从 `../../generated/prisma/client.js`。
- 缓存失效桥现成：后端 `common/revalidation.ts` 的 `revalidateCache([CACHE_TAGS.STOREFRONT])`；前台 storefront layout 所有请求共享单 tag `STOREFRONT`（`lib/cache-tags.ts`）+ `revalidate: 300`；landing-pages/categories/products 的 admin 写操作后都调它。
- Prisma 7：schema 按域拆在 `backend/prisma/schema/*.prisma`（本批新建 `settings.prisma`）；迁移 `pnpm exec prisma migrate dev --name <kebab>`（backend 目录）；**禁止 `prisma migrate reset`**；共享本地库 localhost:5432/small_house，**执行迁移前必须向并行线 A 串行通报并等无冲突确认**。
- 管理端：`lib/admin-api.ts` 加方法（**不碰线 A 正在编辑的 `lib/api.ts`**）；`lib/admin-auth.ts` 自动带 Bearer/401 刷新；导航 `components/admin/AdminShell.tsx:40-47` 的 NAV_ITEMS 按权限过滤；整页表单先例 `app/admin/(shell)/products/new/page.tsx` + `components/admin/Field.tsx`（Field/TextInput/Textarea/inputCls）+ `PageHeader`；错误块 role="alert" 先例 single-pages/landing-page-form。
- 前台 server fetch 先例：`(storefront)/layout.tsx` 的 async 组件 + `fetch(serverApiUrl(...), {next:{revalidate:300,tags:[STOREFRONT_TAGS]}})` + try/catch 回退；URL 助手 `serverApiUrl()`。
- 冻结句不动，新增英文文案仅限本 spec 第 6 节列出的串。

## 3. 数据模型与后端

### 3.1 表（新建 `prisma/schema/settings.prisma`）

```prisma
model SiteSetting {
  id             String   @id @map("id") @db.Uuid // 固定单行 "00000000-0000-0000-0000-000000000001"
  messengerUrl   String   @default("") @map("messenger_url")
  supportEmail   String   @default("support@luwag.ph") @map("support_email")
  supportHours   String   @default("Mon–Sat, 9am–6pm (PHT)") @map("support_hours")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("site_settings")
}
```

迁移 SQL 由 `prisma migrate dev` 生成；**同迁移内插入默认行**（用固定 UUID），保证公开接口永远读到一行（service 再做一次 get-or-create 兜底，双保险）。纯新建表，无现有表变更。

### 3.2 模块 `backend/src/modules/settings/`

- `settings.module.ts`（imports AuthModule）、`settings.service.ts`：
  - `getPublic()`：findUnique 固定 id；不存在则 upsert 默认行；返回 `{messengerUrl, supportEmail, supportHours}`。
  - `getAdmin()`：同上（管理端表单回显）。
  - `update(patch)`：`updateMany`/upsert 单行三字段，随后 `await revalidateCache([CACHE_TAGS.STOREFRONT])`（best-effort，沿用现有调用风格，不阻塞返回）。
- `dto/settings.dto.ts`（Zod）：
  - `messengerUrl`：string，trim 后 `""` 或 `https://` 开头的合法 URL（`z.string().url()` 且 protocol https），≤500 字符。
  - `supportEmail`：合法 email，≤200 字符（不允许空——降级逻辑依赖邮箱兜底）。
  - `supportHours`：string，1..100 字符（允许任意营业时间文案）。
- `storefront/settings.controller.ts`：`@Controller('storefront/settings')`，`GET ''`，无 guard。
- `admin/settings.controller.ts`：`@Controller('admin/settings')`，类级 `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@Permissions('SYSTEM_SETTINGS_EDIT')`；`GET ''`、`@Patch ''`（house style 用 PATCH）+ `@Body(new ZodValidationPipe(updateSettingsSchema))`。
- `app.module.ts` 注册（import + imports 数组两处，手工）。

## 4. 后台管理页

- 路由 `frontend/src/app/admin/(shell)/settings/page.tsx`（"use client"）：
  - PageHeader 标题"站点设置"；`mx-auto max-w-[1200px]` 容器；挂载时 adminApi 拉取回显（loading/error/Retry 分支，照 products/new）。
  - 三个 Field：Messenger 链接（TextInput，hint："留空则全站隐藏 Messenger 客服入口；需以 https:// 开头，例如 https://m.me/luwag"）、客服邮箱、服务时间（hint："显示在结账页与页脚，例如 Mon–Sat, 9am–6pm (PHT)"）。
  - 客户端校验同后端 Zod 规则，错误串 role="alert"；保存中按钮禁用；成功显示"已保存"行内提示（不跳页）。
- `admin-api.ts`：`AdminSiteSettings` 接口 + `getSettings()` / `updateSettings(input)`。
- `AdminShell.tsx` NAV_ITEMS 加 `{ href: "/admin/settings", label: "站点设置", permission: "SYSTEM_SETTINGS_EDIT" }`（超级管理员自动可见）。
- 管理端中文文案沿用现有后台风格。

## 5. 前台数据通路

- 新建 `frontend/src/lib/site-settings.ts`：
  - `type SiteSettings = { messengerUrl: string; supportEmail: string; supportHours: string }`；
  - `DEFAULT_SITE_SETTINGS`（与迁移默认行一致）；
  - server 助手 `fetchSiteSettings(): Promise<SiteSettings>`：`fetch(serverApiUrl("/api/v1/storefront/settings"), {next:{revalidate:300,tags:[STOREFRONT_TAGS]}})`，失败/超时回退 `DEFAULT_SITE_SETTINGS`（永不因设置接口挂掉而拖垮布局）。
- 新建 client 组件 `components/site/SiteSettingsProvider.tsx`：context + `useSiteSettings()`，props `{ settings, children }`。
- `(storefront)/layout.tsx`：现有 Promise.all 加 `fetchSiteSettings()`；用 provider 包住 children（位置紧邻 Providers 内层，CartDrawer/MessengerChat 都在其内）。
- 消费：
  - `MessengerChat.tsx`：删除 `siteConfig.ts` 的 `MESSENGER_URL` import 与 env 常量（`siteConfig.ts` 文件如无其他导出则删除文件并全局确认无引用），改 `const { messengerUrl } = useSiteSettings()`；三处 empty-guard（:39/:76/:90）保留，空值渲染 null。
  - `Footer.tsx`：邮箱/时间改读 hook（或从 server props——该文件是布局组件，以最小改动为准，实现者二选一，行为一致）。
  - `PdpClient.tsx` / `PdpInfoSections.tsx`：删除本地 `SUPPORT_EMAIL` 常量，改 hook/props；mailto 与文案位置不变。
  - 线 A 文件清单（Footer/PdpClient/PdpInfoSections/(storefront)/layout/AdminShell）动手前通报，等热点 Task 3 落地后再编辑；全部为**取值替换**，不动结构与冻结文案。

## 6. 客服 UI 行为规格

### 6.1 浮动按钮（MessengerChat 现有行为，只换数据源）
- 56px 圆形 FAB，默认右下 16px 边距；Pointer Events 拖拽，5px 阈值区分点击/拖拽，x 轴全屏钳制（可停左右任意一边），resize 重新钳制；滚动停止 600ms 淡回；点击 `window.open(messengerUrl, "_blank", "noopener,noreferrer")`。
- messengerUrl 为空：整个组件（含闲置气泡）不渲染。
- 不新增像素事件。

### 6.2 闲置提醒气泡（新功能，全部状态收在 MessengerChat 内）
- **触发**：最近 45 秒内无 `pointerdown` / `keydown` / `touchstart` / `scroll`（passive 监听，reset 计时器）；`document.hidden` 期间暂停（隐藏时清表，重新可见重新计 45s）。
- **弹出条件**（到点同时满足）：messengerUrl 非空；document 可见；页面上不存在 `[role="dialog"]`（购物车抽屉/选款抽屉/移动菜单打开时不抢戏）；本会话未弹/未关过（sessionStorage key `luwag_chat_nudge_dismissed`）。
- **形态**：渲染在与 FAB 同一个定位容器内、按钮正上方的小卡片：标题 "Have questions?"、链接样式按钮 "Chat now"、右上 ×（aria-label "Dismiss"）。点 Chat now = 同 FAB 点击行为并写入 dismissed；× = 关闭并写入 dismissed（本次访问永不再弹；新标签页/新会话重置）。
- **a11y**：卡片 `role="status"`（礼貌播报，不抢焦点）；Esc 关闭卡片（stopPropagation，不触发抽屉逻辑）；链接可 Tab 到。
- 气泡显示期间用户发生任何操作即视同继续浏览：**不自动关闭**（避免闪烁；用户主动 × 或点 Chat），但仅显示这一次。
- 监听器仅在 messengerUrl 非空时于 effect 中挂载，卸载清理；SSR 安全。

### 6.3 Checkout "Need help?"（CheckoutForm，本线文件）
- 在结账页标题行（"Checkout" / 页首区域）右侧加一行，testid `checkout-need-help`：
  - messengerUrl 非空：`Need help? ` + 链接 "Chat on Messenger"（新标签 noopener）+ ` · {supportEmail}`（mailto）+ ` · {supportHours}`；
  - messengerUrl 为空：`Need help? {supportEmail} · {supportHours}`（无死链接）；
- 手机窄屏允许自然折行，右对齐变全宽；字号 text-xs/text-ink-secondary，链接 text-cta。
- 不遮挡 PLACE COD ORDER，不改任何既有校验/下单逻辑与冻结文案。

## 7. 文案清单（本批允许出现的新串）
- 后台：站点设置 / Messenger 链接 / 客服邮箱 / 服务时间 / 已保存 / 两条 hint（见第 4 节，中文后台风格）。
- 前台：`Have questions?`、`Chat now`、`Dismiss`（aria）、`Need help?`、`Chat on Messenger`。
- 默认值：`support@luwag.ph`、`Mon–Sat, 9am–6pm (PHT)`（沿用现状，含 en dash U+2013）。
- 其余所有 COD/配送/服务条冻结句一字不动。

## 8. 错误与边界
- 后端未启动/设置接口失败：前台全量回退默认值（邮箱+时间正常显示，Messenger 按钮隐藏）。
- 管理端保存 403：显示无权限错误（SUPER_ADMIN 才可见入口，正常不会遇到）；网络/5xx：保留表单值 + role="alert"，可重试。
- 非法 URL（非 https、javascript: 等）：Zod 400 拒绝，后台客户端同步拦。
- 缓存失效 webhook 未配置（REVALIDATE_URL 空）：退化为最多 300s 自然过期，与现状其他模块一致。
- sessionStorage 不可用（隐私模式异常）：try/catch 视为每次会话内存态（组件内 ref 兜底），不报错。
- React 19 StrictMode：所有监听 effect 必须 setup/cleanup 对称（参照本支 quick-add 修复 f9ad401 的教训——ref 类标志在 setup 重新置位）。

## 9. 协调与门禁
- 共享库迁移：`prisma migrate dev` 前向线 A 串行通报，确认其无进行中的迁移后执行；纯新增表、可空/默认值，无 reset。
- 线 A 共享文件（(storefront)/layout.tsx、Footer、PdpClient、PdpInfoSections、AdminShell）编辑前通报，等其热点 Task 3 commit 后进行；`lib/api.ts` 完全不碰（storefront 设置类型放新 lib 文件；管理端走 admin-api.ts）。
- 门禁：后端 `pnpm build`（或 tsc）+ 前端 `npx tsc --noEmit`、`npx eslint src`（0 问题，不新增 eslint-disable 种类）、`npm run build`；零新依赖（package.json/lock 零 diff）。
- 分支 `feat/site-contact-settings`；显式路径 `git add`，不 `git add -A`；不 merge/push。
- 端口纪律：不动 3000/3001/3002/3100；线 B 前端 :3003。

## 10. 浏览器验收（:3003 + 管理端，真实操作）
1. 迁移后默认行存在；SUPER_ADMIN 登录 /admin/settings 看到三个默认值；ADMIN 角色看不到入口/403。
2. 保存 Messenger=https://m.me/luwag-test：硬刷新后类目页/PDP/checkout/cart 右下出现 FAB；点击新标签打开该 URL；拖拽可到左右两边；滚动隐藏/淡回正常。
3. 闲置 45s 气泡弹出（真实等待）；切换标签页隐藏期间不弹；开着购物车抽屉时不弹；× 后本次访问换页也不再弹；新会话重置；Esc 可关；卡片不抢焦点。
4. checkout 右上 Need help 两行形态（配置/清空各一次）；清空 messenger 后全站 FAB 与气泡消失、checkout 只剩邮箱+时间，无死链接、无 console 错误。
5. 保存后 5 分钟内（失效桥生效）前台值更新；邮箱/时间改动在 Footer、PDP 缺货区、PDP FAQ 三处同步。
6. 375px：气泡与 Need help 不错位、不遮按钮；0 app console 错误（fbevents 假 ID 噪音按既有清单忽略）。
7. 后端 400：非法 messengerUrl 被拒；公开接口无鉴权可匿名读。

## 11. 后续批次指针（不在本批）
- B：checkout 体验补强（真实 ETA 日期、保障图标条、隐私提醒、Confirm my order 复核页、隐藏假 Discount 行）——纯前端。
- C：游客查单（storefront 订单只读接口 + /track 页 + 成功页实时状态）。
- D：自选配送日期（Order.preferredDeliveryDate 可空 migration + 日历）。
- E：地址 PSGC 级联搜索 + geolocation 按钮 + Google 地图嵌入（用户已确认接受 Google 嵌入；无配送禁排规则）。
