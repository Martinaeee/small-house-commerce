# 落地页/PDP 快捷下单表单对齐结账页并补订单备注 — 验收记录（2026-11-02）

## 用户需求

用户发现落地页（商品详情快捷 COD 表单）没有订单备注，要求像普通结账页一样集中展示，即改成与 checkout 完全一致的 `Delivery information` 卡片形式。

## 变更范围（仅前端）

组件 `frontend/src/components/product/PdpQuickCodOrder.tsx`，同时服务 PDP（`/products/[slug]`）与落地页（`/lp/[slug]`）：

- 表单改为与结账页相同的单张 `Delivery information` 卡片：标题、右上角 `Use my location`（含定位图标）、`grid-cols-1 gap-3 sm:grid-cols-2`。
- Full Name 与 Mobile Number 桌面并排、手机堆叠；Province/City、Barangay/Postal Code 两两成行；Full Address、Landmark、Preferred delivery date 整行。
- 标签改为结账页的 13px 内嵌 `<label>` 形式；Landmark 文案改为 `Landmark (Optional)`。
- 新增 `Order Notes (Optional)`：textarea、`rows=2`、`maxLength=200`、结账页同款 placeholder 与提示 `We'll do our best to accommodate your request.`。
- 新增隐私行 `Your information is used only to process and deliver your order.`。
- 备注写入共享 `writeCheckoutDraft(..., customerNote)`；返回编辑时从 `draft.customerNote` 回填。
- 备注经确认页既有逻辑发送为 `customerNote`（后端、千易 `buyerMessage` 链路原本已支持，未改）。

未改动：普通结账页、Header/Footer、首页、商品卡、价格/库存、后端、迁移、ERP 配置。无障碍上错误提示与提示文字保持在 `<label>` 之外，避免污染字段可访问名称。

## 代码与运行镜像

- 分支 `fix/landing-order-notes-20261102`，代码提交 `394ccc2e90a068c61a5364f120d3bd7dfe6346f4`；发布前已合入生产基线 `888a108f`。
- 只重建并切换前端；后端镜像未变。Compose 显式 `--env-file .env.deploy`，`up -d --no-deps --wait frontend`。
- 新前端镜像：`sha256:c785607205a2c126108e326f33d4a60baf0fa1462afb7c898bf041b93aaa7a63`。
- 切换后 `running healthy`；`/` 与商品页 HTTP 200。
- 无新增迁移、无 seed、无数据库/商品/订单数据变更，未创建验收订单，未提交营销订阅，未改 `QIANYI_ENABLED`。
- 切换后已用既有 secret 保护的 `/api/internal/revalidate` 刷新 `storefront` tag（200），首页未出现构建期空兜底，Best Sellers 正常。

## 测试

定向（修改文件新增测试先红后绿）：

- `PdpQuickCodOrder.spec.tsx`：20/20 通过。新增：结账式 Delivery information 卡片与备注字段、备注写入草稿第 5 参数、从草稿回填备注。
- 相关 3 个 spec（`PdpQuickCodOrder`、`PdpStickyBuy`、`CheckoutConfirmView`）：53/53。
- `tsc --noEmit`、改动文件 ESLint：通过/无输出。
- 全量前端：309 个文件、3468 用例。两次全量运行各有 1 项与本改动无关的偶发失败：`ProductOptionSelector.spec.tsx`（scoped gallery integration，`fetch` 次数 / 找不到图片）与一次 `DashboardClient`（找不到 alert）；两者单独运行 79/79 通过，本次未触碰相关文件。不宣称全量零失败。

## 生产浏览器验收（最终镜像）

Chromium 桌面 1440×900 + iPhone 13：

- 商品页出现 `Delivery information` 卡片，标题与 `Use my location` 同卡；Order Notes 字段、placeholder、helper、隐私行全部可见；`maxlength=200`。
- 桌面 Full Name 与 Mobile Number 同一行（y 坐标一致），手机上下堆叠；无 `pageerror`。
- 端到端（不创建订单）：填写姓名/手机/地址、选择 Province/City、加入 1 件商品、填写备注 → REVIEW ORDER → `/checkout/confirm` 显示 `Order notes: Please call before delivery E2E`；未点击下单，无订单产生。
- 截图：`/tmp/luwag-landing-notes-desktop-20261102.png`、`/tmp/luwag-landing-notes-mobile-20261102.png`（临时文件，不作永久归档）。

## 恢复点（未执行）

- 本轮前前端：`small-house-prod-frontend:rollback-pre-landing-notes-20261102` → `sha256:2274e5bfc1a62d5e215221506adb7bd1bcc767f73bcc9cbb6d2faff9dd887e3d`。
- 回滚仅切前端；使用当前 `.env.deploy`，不要连带回退后端（后端含千易控制台等后续功能）。
- 无 schema 变化，不需要数据库回迁。

## 无关附带改动

**无。**
