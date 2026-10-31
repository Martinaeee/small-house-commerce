# 首页商品模块链接与可选销量排序 — 生产验收记录（2026-10-31）

## 用户授权与交付边界

用户选择「做成可配置链接」，并要求「后台可以选择手动/按销量排」。

- 商品网格模块增加可配置的链接文字、地址；有链接时标题和右侧 `See more →` 指向同一地址。
- 后台增加手动/销量排序选择，不强制所有模块改成销量排序。
- 本次仅给首页 Best Sellers 配置 `/collections/best-sellers`；线上继续使用原手动顺序。
- 首页选品与集合成员仍独立管理，没有将首页 5 件商品替换为集合的 6 件商品。
- 保留原商品卡、横滑轨道、Header/Footer、主题与其他首页模块。

## 代码与运行镜像

- 功能提交：`861e9018`。
- 后台说明文案提交：`1415703970f7b8eaedead741fde77f48f88e8de7`。澄清销量排序作用于线上，编辑画布仍显示手动顺序。
- 发布时服务器分支：`staging/luwag-shop-domain`；仓库根 `/opt/small-house-commerce`，应用位于其 `small-house-commerce` 子目录。
- 最终后端镜像：`sha256:1f9a189267e16976b297c3083f6c6c900ae83db1b044f996babeab8e849a0bde`。
- 最终前端镜像：`sha256:722a6e638f4fcdcb393e8523990408ae77dc3864f9094e62f02987ecbb2cafe7`。
- 本次前后端均重建；Compose 显式使用 `--env-file .env.deploy`，切换指定目标服务，不重建 DB/Caddy。
- 无新增数据库迁移、无 seed；没有创建验收订单、订阅或发送邮件。
- 最终现场复核：前后端均 `running healthy`，服务器工作树干净；`QIANYI_ENABLED=true` 保持不变。

## 排序口径与运营说明

后台入口：首页装修 → 对应商品模块（本次为 Best Sellers）→ 链接文字/链接地址/商品顺序。

- `MANUAL` 或未配置：按原选品列表顺序。
- `SALES`：只重排当前模块选中且可售的商品，按最近 90 天订单中的商品件数降序。
- 排除 `CANCELLED`、`DENIED`、`RETURNED`、`PARTIALLY_RETURNED` 订单，沿用既有 dashboard 有效销售口径。
- **这不是「仅已完成/已签收销量」；NEW、PENDING 等未被排除的订单也可计入。**
- 同销量保留手动相对顺序；无近期销量的商品排在有销量商品后，并保留手动相对顺序。
- 不自动从全店补选商品，不自动改集合成员，不展示销量数字。
- 编辑画布没有订单数据，继续显示手动顺序；签名预览和线上由后端按实际订单数据排序。
- 切换排序需要保存并发布首页版本；本次没有将线上切到 `SALES`。

## 首页生产数据变更与备份

操作前确认草稿 revision 416 与线上 version 12 完全一致，避免顺带发布其他人的草稿。

- 旧发布版本：12，ID `01a18ae4-f64a-71df-aa66-6ae03bfde5c4`。
- 目标模块：`3c2d55e4-8698-4e33-b543-6bbd9a2eeeb4`，`PRODUCT_GRID`，标题 Best Sellers。
- 原 payload：`{}`。
- 正常保存后草稿 revision 417，验证 errors/warnings 均为空。
- 正常 API 发布 version **13**，时间 `2026-10-31T08:00:28.838Z`。
- 新 payload：

```json
{"linkUrl":"/collections/best-sellers","linkLabel":"See more"}
```

version 12→13 深度比较：7 个模块数量不变，只有目标模块 payload 的上述两个字段变化；商品名单/顺序、标题、副标题、样式、启用状态、排期和其他模块都不变。

私有备份：

- `/var/backups/luwag/homepage-grid-20261031T075848Z/homepage.sql`
- 仅备份 `homepage_documents`、`homepage_versions` 数据；223,102 bytes；文件权限 600，目录权限 700。
- 同目录归档本轮四个操作/验收 `.cjs` 脚本；脚本不含 JWT 或环境密钥，执行时从容器环境读取配置。
- 临时脚本已从本地工作树和 backend `/app` 删除。

销量预览验证只临时将草稿设为 `SALES`（revision 418），生成签名预览后恢复原设置（revision **419**）。**该预览没有发布，线上始终是 version 13 手动排序。**

## 销量聚合的独立只读核对

本轮预览时，独立 SQL 使用相同时间窗和订单状态过滤得到：

| 商品（简写） | 最近 90 天计入的订单件数 |
| --- | ---: |
| Mid-Century Rolling Clothes Rack | 4 |
| Narrow Gap Cabinet | 2 |
| Kids Study Chair | 2 |
| Mobile Pegboard Storage Cabinet | 1 |
| Flip-Top Sofa & Bed Table | 0 |

签名预览的排序与此一致；2 件销量的两件商品维持原手动相对顺序。该表是验收当时快照，不保证后续订单变化后数值不变。

生产手动顺序继续为：Narrow Gap Cabinet → Rolling Clothes Rack → Flip-Top Table → Pegboard → Kids Study Chair。

## 测试与生产验收

### 发布前完整测试记录

- 后端：177 个文件、2,436 个用例通过；22 个文件、249 个用例跳过，主要为需要数据库/本地 ffmpeg 的环境相关测试。本轮完整测试不能描述为「所有测试均执行」或「重跑了真实 ffmpeg 集成」。
- 前端：309 个文件、3,445 个用例通过；存在既有 act/key/Recharts 警告，不宣称零警告。
- 后端 production build、前端 TypeScript/改动文件 ESLint/production build 成功。
- 最后仅说明文案的前端构建也成功，最终运行的是 722a6e63 镜像，不是中间 d620cec2 镜像。

### 最终镜像切换后的重新验证

- 本次收尾重新执行后端两份定向测试：**58/58** 通过。
- 重新执行前端三份定向测试：**38/38** 通过。
- Chromium 桌面 1440×900、iPhone 13 移动视口分别实际点击标题与 `See more`，两处都进入 `/collections/best-sellers`，落地页 HTTP 200。
- 两端确认标题/箭头可见、5 张商品卡及手动顺序未变，无 `Small-Space Favorites` 空兜底模块，`pageerror=[]`。
- 额外等待可见商品图片加载后截图：桌面模块 31/31 张 img 已加载；移动端当屏图片均成功，其余离屏图片保留懒加载（截图时 11/31 已加载）。此计数含商品卡附属图片，不等于商品数。
- 本机截图：`/tmp/luwag-best-sellers-final-desktop-20261031.png`、`/tmp/luwag-best-sellers-final-mobile-20261031.png`；临时文件不作为永久归档保证。
- 公共页面 `/`、`/collections/best-sellers`、`/about`、`/cart`、`/checkout`、`/track-order`、`/contact` HTTP 烟测均为 200；图片优化器返回 200/WebP。

### 构建期首页兜底缓存的处理

最终前端镜像构建时 backend 主机名不可达，Next 将兜底首页烘焙进缓存。切换后首页虽然 HTTP 200，却一度展示 `Small-Space Favorites` 空模块；公共 homepage API 的 version 13 数据仍正确，因此不是数据库回退。

已使用既有 secret 保护的 `/api/internal/revalidate` 重新验证 `storefront` tag，返回 200/`revalidated:true`；随后首页恢复真实 Best Sellers 内容，并在最终镜像上重新完成上述两端浏览器验收。

**后续重建前端不能只验首页状态码：须检查真实首页内容；如 build 缓存了兜底，运行既有内部再验证流程后重新检查。** 本次未改动缓存策略或全局布局。

## 恢复点（保留，未执行回滚）

| 范围 | 镜像标签 | 镜像 ID 前缀 |
| --- | --- | --- |
| 本轮功能前 backend | `small-house-prod-backend:rollback-pre-grid-links-20261031` | `ac972521` |
| 本轮功能前 frontend | `small-house-prod-frontend:rollback-pre-grid-links-20261031` | `940ff017` |
| 仅说明文案前 frontend | `small-house-prod-frontend:rollback-pre-grid-hint-20261031` | `d620cec2` |

- **恢复入口配置**：优先从当前最新草稿只删除本模块 `linkLabel`/`linkUrl` 后正常验证发布；不要直接回发历史 version 12 而覆盖此后其他首页编辑。若有新编辑，先核对差异。
- **恢复排序**：将本模块改为 `MANUAL` 后保存发布即可，不需要数据库恢复。
- **恢复代码/镜像**：先现场核验生产是否已前进；只用明确的目标镜像与 `.env.deploy` 切换所需服务，保持最新环境变量和 ERP 状态。上述标签不会自动保护后续发布，不可盲目按旧基线回滚。
- 无 schema 变化，不需要数据库回迁；`homepage.sql` 仅是应急取证/恢复材料，不应整库或整表覆盖在线新数据。
- 本轮旧 backend 已包含视频自动转码，旧 frontend 已包含 PDP 视频热修；不应误用更早的视频/PDP 回滚标签。

## 无关附带改动

**无。**

- 没有改 Header/Footer/导航/主题/商品卡排版/首页横滑结构。
- 没有改 Hero、公告栏、其他首页内容或 Best Sellers 集合成员。
- 没有改商品价格、库存、素材、客户账户、订单、营销订阅或 ERP 配置。
- 允许的生产内容变更只有上述 Best Sellers 两个链接字段及对应新首页版本；技术验收另产生临时草稿 revision 与正常访问日志/第一方浏览事件，未创建业务订单。
