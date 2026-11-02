# 手机端 PDP 改为固定购买栏 + 变体抽屉（2026-11-02）

## 用户确认

用户原话：

> “我想手机端产品详情页的表单填写这里可以隐藏一下呢，底部固定购买栏，可以点击立即购买和加购，弹出相应的变体选择进入checkout流程，电脑端产品详情页的表单可以先保留。”

助手明确范围（普通商品页 + 商品型落地页统一），用户答复“可以”。

## 设计边界

- **< 1024px（与现有 `lg` 桌面分栏同一断点）**：隐藏整块内联 COD（选品清单、地址表单、促销码、提交），不留空 wrapper；固定购买栏从进入页面起常驻。
- ORDER NOW 与 ADD TO CART 都打开共享变体/数量抽屉（`CartDrawer` + `QuickAddView`）：ORDER NOW 确认后去 `/checkout`，ADD TO CART 确认后留在购物车，不直接跳结账。
- 单 SKU 商品手机端也走抽屉，让数量选择显式；桌面单 SKU 保持原有直加/直跳。
- **≥ 1024px**：内联表单与底部栏原有的“hero 离开后出现、表单进入视口后让位”逻辑不变。
- 商品型落地页手机端连整块 `data-landing-product-order` 包装一起移除，避免 `grid gap-6` 留下空行。
- 缺货 SKU 的单一补货/加购入口沿用既有守卫，手机端不出现可下单的 ORDER NOW。
- 不改 Header、图集、详情、评论、推荐、主题；无后端、迁移、ERP、数据变更；未创建订单。

## 实现

| 文件 | 变更 |
|---|---|
| `src/components/product/useDesktopViewport.ts`（新增） | `matchMedia("(min-width: 1024px)")` + `useSyncExternalStore`；服务端快照为 `false`（手机布局），断点变化时重渲染 |
| `src/components/product/PdpQuickCodOrder.tsx` | 外层只做视口门禁；手机直接返回 `null`，内层表单拆成 `PdpQuickCodOrderForm`，不挂载即不跑草稿回填、PSGC 查询与提交逻辑 |
| `src/components/product/PdpStickyBuy.tsx` | `shown = desktop ? visible && !codInView : true`；`#quick-cod-order` 观察器只在桌面运行 |
| `src/components/product/PdpClient.tsx` | `requestIntent`：`selectableCount > 1 \|\| !desktop` 一律 `openPicker`，带入当前 SKU 与数量 |
| `src/components/product/LandingContentView.tsx` | `LiveOrderForm` 手机返回 `null`，连包装节点一起消失 |

## 测试（先红后绿）

新增/更新：

- `PdpQuickCodOrder.spec`：手机不渲染表单（0 textbox / 0 combobox / 无 Delivery information）；桌面保留。
- `PdpStickyBuy.spec`：手机 hero 在视口内也显示两颗按钮；桌面旧行为；断点来回切换不残留 `--sticky-bar-offset`。
- `ProductOptionSelector.spec`：手机单 SKU 的 ADD TO CART 与 ORDER NOW 都调用 `openPicker`（带 `red-small`、数量 1、对应 intent），不直加、不直跳；桌面单 SKU 旧断言保持。
- `LandingContentView.spec`：手机无 `data-landing-product-order` 节点，桌面仍在 lead 内且 `lg:col-span-2`。

测试工具 `src/test/desktop-viewport.ts` 提供可切换的 `matchMedia` stub。

结果：

- 定向 4 个 spec：**118/118**。
- `tsc --noEmit` 无输出；改动文件 ESLint 干净；`pnpm build` 退出码 0。
- 全量前端：**3492/3493**。唯一失败为 `ProductOptionSelector.spec > scoped gallery integration > retries the same scope after failure without leaking console or hydration errors`——只在并行全量时超时，单跑 74/74、按名重复 3 次均通过；该用例此前已被记录为画廊取图时序波动，本轮未改其逻辑。

## 浏览器验收

本地 `localhost:3026` 与生产 `https://luwag.shop` 均用真实 Chromium + WebKit 驱动：

| 场景 | 结果 |
|---|---|
| 手机 390×844 Chromium / WebKit（单 SKU） | `#quick-cod-order` 0 个、无 “Delivery information”；首屏即有固定栏（`--sticky-bar-offset: 53px`）；ORDER NOW 抽屉标题 “ORDER NOW”、按钮 “ORDER NOW”；ADD TO CART 抽屉有数量步进与 “Confirm”；关闭不跳转、不加购；滚到底部栏仍在 |
| 手机 Chromium（多变体） | 同上，抽屉带入当前变体与数量 |
| 桌面 1440×900 | 首屏无固定栏；内联表单存在且 “Delivery information” 可见；越过 hero 后固定栏出现、内联表单仍保留 |
| `pageerror` | 全部场景 `[]` |

生产首页 200、Best Sellers 与 19 个商品链接正常；sitemap 无已发布 `/lp/` 页面，落地页行为由单元测试与共享组件覆盖。

## 发布

- 分支 `feat/mobile-pdp-purchase-20261102`，提交 `aa60b99e`。
- 生产仓库 `staging/luwag-shop-domain` 由 `b0b68aa7` fast-forward 到 `aa60b99e`。
- 新前端镜像 `sha256:423ee2a02ab368f73499752fb72e7acd03978bcef218365976aa0368889774f0`，容器 `healthy`。
- 回滚标签 `small-house-prod-frontend:rollback-pre-mobile-pdp-20261102` → `sha256:bcd008065c0ee632a6da7edc41154e740af598703bbcde7e116f9f8aa833425c`（发布前镜像）。仅回滚前端，不动后端。
- 切换后 `POST /api/internal/revalidate {"tags":["storefront"]}` 返回 `revalidated: true`。
- 未创建订单、未发邮件、未触发 ERP、未改数据。

## 无关附带改动

- 本次 fast-forward 同时带入此前未推上生产的 `docs/superpowers/plans/2026-11-02-compact-delivery-form-release.md` 尾部 11 行文档追加（纯文档；对应功能早已在线）。
- 代码层面的无关改动：**无**。

## 已知限制

- 旧 `PDP_INLINE` 草稿在确认页的 “Edit” 仍指向 `#quick-cod-order`。手机端不再渲染该表单，因此从桌面创建、再到手机打开确认页的旧草稿，点 Edit 会落到商品页而看不到编辑表单；新的手机流程（抽屉 → `/checkout`）Edit 指回 `/checkout`，正常。若要统一改造，需要为多 SKU 草稿在结账页增加 `directItems` 恢复协议，属于另一轮改动。
