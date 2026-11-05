# 后台库存页按产品分组改版（2026-11-05）

## 用户需求

用户提供库存页截图并要求：

1. 增加产品缩略图。
2. 同一产品的多个变体折叠进产品下，点击产品向下展开变体库存；当前是所有变体平铺。
3. 调整库存弹窗里的问号文字不能完整展示。
4. 放大可用库存 Available，而不是 On hand。

用户随后询问「我想增加库存怎么做」。本轮在页面顶部和弹窗内补充了「Quantity 是本次增减数量，不是目标总库存」的说明，未替用户改动任何真实库存。

## 范围与设计

只修改后台库存页展示层：

- `frontend/src/app/admin/(shell)/inventory/page.tsx`
- `frontend/src/app/admin/(shell)/inventory/page.spec.tsx`

不改后端、数据库、库存计算、预占/扣减、ERP、权限模型、侧栏、顶栏或前台。

已确认的限制：搜索结果默认展开匹配产品；SKU 码搜索仍只筛当前页（沿用基线行为）；Bundle 继续显示组件推导可用库存，不提供独立调整入口；无 `INVENTORY_ADJUST` 权限时不显示 Adjust。

## 实现

- 产品缩略图取产品图片中**非场景的 IMAGE**，跳过 VIDEO；经既有 `optimizedUploadImage`（Next 图片优化器，宽 96）加载，加载失败回落占位图。生产 27 个商品中 26 个有可用照片（1 个无图片）。
- 多变体产品只渲染一条产品行（缩略图、名称、变体数量、产品状态），默认收起；点击整行或 Enter/Space 展开/收起，不重新请求数据。
- 单变体产品不显示产品行，直接展示该变体行。
- 展开后的库存列以 **Available** 为 24px 主数字，On hand / Reserved 降为 12px 次要信息；Available 为 0 时显示 Out of stock。
- 库存调整弹窗的 Quantity / Reason 问号改为字段下方内联展开，再次点击收起，不参与表单提交；说明在弹窗宽度内换行。

## 验证

- 定向：库存页 **18/18**；先新增 13 项失败用例并确认红灯（缺失产品行、缩略图、Available 主数字、搜索自动展开、内联帮助等），再实现。
- 全量前端：**325 文件 / 3606 用例全绿**，316.62s（`caffeinate -i pnpm --dir frontend test --maxWorkers=2`）。
- `tsc --noEmit`、改动文件 ESLint、`git diff --check` 退出码 0；`pnpm build` 退出码 0，56 个静态页生成，`/admin/inventory` 正常产出。
- Chromium、WebKit 真实浏览器（本地 dev，只读生产数据）：产品折叠/展开、缩略图实际加载、Available 24px / 次要 12px、375/390/768 下两项帮助同时展开无水平溢出、SKU 搜索自动展开、状态筛选清除分页。调整请求在本机被拦截并断言不会离开浏览器，**未向生产写入库存**。
- 独立只读代码审查：无 Critical / Important / Minor 发现，判定 Ready to merge。

### 基线波动的如实记录

改版前全量基线出现 1 项失败：`ProductOptionSelector > scoped gallery integration > retries the same scope after failure without leaking console or hydration errors`（预期 fetch 1 次，实际 2 次）。单跑该文件与库存页 **77/77 通过**；随后两次全量运行均为 3606/3606 全绿。未修改该 PDP 测试或组件，本轮不宣称已定位该偶发原因。

## 发布

- 分支 `feat/admin-inventory-groups-20261105`，提交 `671e3675`；基线为服务器生产 HEAD `8b7db398`（生产分支 `staging/luwag-shop-domain`，不在 GitHub main）。
- 发布前从服务器 `prod` fetch 真实分支，确认 HEAD 与工作树；用精确 SHA `merge --ff-only`，避免旧 `FETCH_HEAD`。
- 备份并打标签后构建，构建前后各核对一次基线/镜像，确认无并行发布。**仅** `frontend` 执行 `up -d --no-deps --wait`；后端镜像与启动时间未变。
- 新前端镜像 `sha256:9cc3ba0bf62d5c1eee95a88bb31a978d5ecee38df750987c93cf91c69eb4441d`，healthy。
- 后端仍为 `sha256:8016726ce25c39183a97ccc7d05e2a082218e3e0dca8b98db62b488e9980347a`，启动时间仍为 `2026-11-05T04:15:02.776671279Z`。
- 回滚标签 `small-house-prod-frontend:rollback-pre-inventory-groups-20261105-073042`；恢复目录 `/home/ubuntu/deploy-backups/inventory-groups-20261105-073042/`（含基线/发布提交、前后镜像、后端启动时间、构建日志）。
- 回滚只需把该镜像重新标为 `small-house-prod-frontend:latest` 并重建 frontend；不要回滚后端或数据库。本次零迁移。

## 生产验收

- `https://luwag.shop/`、商品页、`/admin/login` 均 200。
- 生产真实数据只读验收（Chromium / WebKit，20 分钟短期管理员令牌，只发 GET）：27 个产品中取多变体产品，确认默认折叠、展开后缩略图真实加载、Available 24px、次要行 12px、375/390/768 两项帮助同时展开无水平溢出。`pageerror=[]`，**非 GET 请求 0 条**，未调整任何真实库存。
- 日志：`/tmp/luwag-inventory-browser-production.log`；截图 `/tmp/inventory-production-{chromium,webkit}-*.png`。
- 第一次生产浏览器验收因短期令牌已过期被 401 拒到登录页，未接触库存数据；重新签发后通过。这不是产品缺陷，但如实记录，避免把失败尝试当成已验收。

## 无关附带改动

**无。** 运行时仅库存页一个文件；未改 Header、侧栏、主题、结账、像素、ERP 或后端。浏览器访问可能留下既有的第一方浏览记录。
