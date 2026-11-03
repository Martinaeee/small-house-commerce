# PDP 详情导航被固定页头遮挡修复（2026-11-03）

## 用户问题

用户提供手机截图并反馈：“现在这个产品详情的导航栏在下滑的时候看不到了，电脑和手机都被掩盖了”。本轮只恢复详情导航的正常吸顶与锚点定位，不改原有设计。

## 根因与生产复现

`PdpSectionNav` 原先使用 `sticky top-16 z-20`，将吸顶位置写死为 64px。实际 storefront 的固定头部同时包括公告栏与 Header，且层级为 `z-40`：

| 生产视口 | 固定头部底边 | 原导航范围 | 遮挡 |
|---|---:|---:|---:|
| 390px | 113px | 64–117px | 49px（导航共 53px） |
| 1920px | 125px | 64–117px | 整条导航都在头部后面 |

不是导航被移除，而是旧的固定偏移小于真实页头高度。继续沿用 `scroll-mt-32` 也会使锚点标题被“头部＋导航”盖住。

## 修复范围

代码提交：`4f2d95c7`。

仅修改：

- `frontend/src/components/product/PdpSectionNav.tsx`
  - 从所属 storefront shell 取得包含公告栏和 Header 的固定头部容器，测量真实高度，设置本导航的 `top`。
  - `ResizeObserver` 同时观察头部与导航，响应断点、字体加载和公告内容高度变化。
  - 对应内容的 `scrollMarginTop` 使用“头部高度＋导航高度＋8px”，与导航当前态判定共用同一基准。
  - 保留原生锚点、视觉 class、原有当前态与横向轨道逻辑；卸载时清理监听并恢复目标原有的内联 margin。
- `frontend/src/components/product/PdpSectionNav.spec.tsx`
  - 增加 3 个回归用例：手机 113px、桌面 125px、无需 window resize 的头部高度变化。

未修改 `Header`、公告栏、storefront shell、全局样式或任何后端文件。

## 验证

- 新增 3 项先红后绿；定向 **12/12**。
- 最终前端全量：**313 文件 / 3514 用例全绿**，138.37s（`caffeinate -i pnpm --dir frontend vitest run --maxWorkers=2`）。
- `tsc --noEmit`、改动文件 ESLint、`git diff --check` 均退出码 0。
- `pnpm build` 退出码 0，55 个静态页面生成完成；PDP 仍为动态路由。
- 独立只读审查无 Critical / Important / Minor 发现。

### 本地真实浏览器

本地 Next dev 连接生产公开只读商品接口。Chromium、WebKit 各验证 390 / 768 / 1024 / 1440 / 1920 五档宽度，并在同一页面来回切换断点。

| 宽度 | 头部底边 | 修复后导航 top | 重叠 |
|---|---:|---:|---:|
| 390 | 113px | 113px | 0px |
| 768 | 101px | 101px | 0px |
| 1024 | 151px | 151px | 0px |
| 1440 | 125px | 125px | 0px |
| 1920 | 125px | 125px | 0px |

两引擎的实际点击命中元素均为导航链接；390 / 1440 下点击 Details、Specifications、Reviews & Q&A、Order Now，目标内容不被固定层盖住；`pageerror=[]`。购买区域位于导航前方，点击 Order Now 返回该区域时，导航正常回到文档流，不强行悬浮到购买区域上方。

截图：本机 `/tmp/pdp-section-nav-local-{chromium,webkit}-{width}.png`。

### 如实记录休眠造成的早期失败

前几次全量运行并未通过：有两次因工具超时中断；随后 4-worker 全量出现 17 项失败和 worker RPC 超时，serial 全量出现 4 项超时和 worker RPC 超时。部分单条用例耗时达到 900–927 秒，`pmset -g log` 同期显示电脑反复 Sleep / DarkWake。未更改这些后台测试或放宽断言；仅在临时防休眠并发 2 的完整复跑中恢复为 3514/3514。

早期失败用例名（最终完整复跑均通过）：

- `ProductForm shared color specifications > edits one packaging group for two colors while preserving their separate price and stock`
- `EditProductPage save orchestration > keeps card, SKU, packaging and stock drafts after a graph version conflict`
- `ProductForm independent card media > previews the unpriced draft variant without changing the saved default or requiring cart context`
- `EditProductPage save orchestration > saves a newly materialized Bundle definition only after its real SKU identity exists`
- `EditProductPage save orchestration > adopts the saved product's version and SKU identities on the next save`
- `EditProductPage save orchestration > shows a published slug conflict without losing unsaved changes or writing inventory`
- `NewProductPage two-phase save > creates the product and graph before saving new Bundle components against a real identity`
- `NewProductPage two-phase save > keeps failed new Bundle definitions visible and retries without creating another product`
- `NewProductPage two-phase save > keeps a requested stock row the create's batch response never reports`
- `FooterContentEditor columns > edits CONTACT fields and its structured Track Order link`
- `QianyiSettingsPage reliability > locks only the row being saved and updates its bound badge`
- `AdminGlobalSearch > opens with Control+K, focuses the combobox, and restores opener focus on Escape`
- `HomepageEditor > compares only the canvas, keeps autosave idle and offers a visible way to stop comparing`
- `HomepageEditor > loads the draft on mount and renders the three panes with the status bar`
- `HomepageEditor > reveals the settings workspace and the exact navigation row from a publish issue`
- `HomepageEditor > routes the settings pane by selection priority`
- `HomepageEditor > neither signs nor opens when preview's save fails with 409`
- `HomepageEditor > does not open when the draft changes while the token is in flight`
- `NewsletterAdminPage permissions > shows the promotion tab only to a system settings editor`
- `HomepageEditor > opens Hero media settings when a thumbnail is clicked after editing a Hero element`
- `HomepageEditor > gives each desktop pane an independent scroll container`
- `FaqWorkspace > renders the FAQ structure without any question or answer inputs`
- `ProductPerformanceTable > withholds the profit while the cost snapshot is incomplete`

## 发布

- 分支 `fix/pdp-section-nav-offset-20261103`，功能提交 `4f2d95c7`。
- 发布前从服务器 fetch，确认生产基线仍是 `014120b7`；服务器干净后用精确提交 SHA fast-forward，避免误用旧 `FETCH_HEAD`。
- 只构建和替换 `frontend`；使用 `docker compose --env-file .env.deploy -f docker-compose.prod.yml`，启动时 `--no-deps`，未重启后端、数据库或 Caddy。
- 新前端镜像 `sha256:04b3a5225ce0ef929e61300da17e229c1d77ee033d4dc85a323828f04ba29fe7`，容器 `healthy`。
- 后端仍为 `sha256:f673b7c63d39f5539ad0a8d615a45ac2e87360538f2a994d7346d96d184c1f6c`，启动时间仍为 `2026-11-02T09:35:19.318181188Z`。
- 前端容器内 revalidate `storefront` 返回 200 / `revalidated: true`。
- 代码与镜像恢复索引：`/home/ubuntu/deploy-backups/pdp-section-nav-20261103/`；本次零迁移，不需要数据库恢复。
- 回滚标签 `small-house-prod-frontend:rollback-pre-pdp-section-nav-20261103` → `sha256:42965d5ddb2f7632779358fd45328c79a2d182875f86cb2e86e7bf1070926418`。需要时只将该镜像重新标为 `small-house-prod-frontend:latest` 并重新创建 frontend；不要回滚后端或数据库。
- 首页、PDP、后台登录页 200；首页 HTML 仍有 Best Sellers 与 8 个不同的商品链接。

## 生产浏览器验收

生产 `https://luwag.shop/products/expandable-kitchen-cart-with-pull-out-baskets`，Chromium / WebKit：

- 正常公告轮播下，390 / 768 / 1024 / 1440 / 1920 五档导航 top 分别与头部底边 113 / 101 / 151 / 125 / 125px 重合，**重叠全部 0px**；`elementFromPoint` 确认链接可接收点击。
- 两引擎各检查 8 次原生锚点跳转（390 / 1440 × 4 栏目），均通过。为隔离公告自动换文案的高度变化，锚点静态落点测试使用浏览器正式支持的 `prefers-reduced-motion: reduce`；上面的下滑吸顶测试则保留正常轮播。
- 两引擎 `pageerror=[]`。已人工查看生产手机与桌面截图，导航完整露在头部下方，购买固定栏保持原状。
- 截图：本机 `/tmp/pdp-section-nav-production-{chromium,webkit}-{width}.png`。

首次生产脚本曾在异步高度更新的一帧间采到 2.66px 的旧偏移；改为等待实际头部与导航尺寸同步后再断言。另一次锚点检查恰逢公告换行高度增长，标题顶部短暂少了约 5px 的净空。因此本轮没有宣称“原生锚点在后续任意页面重排后仍永久保持同一位置”，也没有为此篡改公告轮播或强制二次滚动；本次用户反馈的整条导航被盖住问题在正常轮播下已验收恢复。

## 无关附带改动

**无。** 运行时代码仅上述一个 PDP 导航组件；无 Header/Footer/shell、结账、像素、ERP 或数据库改动。未进行真实下单、订阅、商品编辑或客户资料写入；浏览器访问本身可能留下既有的第一方浏览记录。
