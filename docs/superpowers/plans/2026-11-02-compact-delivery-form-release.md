# 手机端下单表单紧凑化（方案 A）— 发布记录（2026-11-02）

## 用户确认

用户在预览页选择「按 A 实施（推荐）」，并确认三项附加优化：去掉卡片上方重复标题/说明、三行保障合并一行、填写时底部购买栏让位。

## 调研与取舍

线上实测（iPhone 13，390×664）：表单卡片 1228px，约 2 屏；每字段行 71px。

- 方案 A（全部字段可见，短字段两两并排）：真实渲染 861px。
- 方案 B（再把 Barangay/邮编/地标收进展开项）：852px，只比 A 少 9px，却隐藏 3 个字段 → 放弃。
- 方案 C（浮动标签）：会偏离结账页视觉语言 → 未采用。

依据：NN/g 单列原则允许「短且逻辑相关字段（City/State/ZIP）同排」；Baymard 指出手机键盘约占竖屏一半，标签须脱离上下文可读；GOV.UK 要求标签可见、输入字号 16px。输入框保持 16px、点击高度 46px、标签 13px 不变。

## 改动内容（仅前端）

- 表单网格：手机端两列（`grid-cols-2`），省/市、Barangay/邮编、Landmark/日期三对并排；姓名、手机、详细地址、备注整行。桌面布局不变。
- 行距：栅格 12→10px，卡片内部间距 16→12px。
- 备注：`rows=1`，占位改为 `Add a delivery note (optional)`，仍最多 200 字、可纵向拉伸。
- 标签：并排的可选字段手机端显示短标签（Landmark / Preferred date），桌面端仍显示完整 `(Optional)` 文案；输入框加 `aria-label` 保持可访问名称完整。
- 地址选择器新增 `compactPlaceholders` 属性（默认关闭）：仅本表单使用 `Select` 占位，结账页保持原文案；并排时为省/市标签加手机端最小高度，避免窄屏换行导致输入框错位。
- 删除卡片上方重复的「Order Now — Cash on Delivery」标题与说明（104px），保留 section 的 `aria-label` 与 `#quick-cod-order` 锚点。
- CTA 下方三行保障合并为一行：`Cash on Delivery · We call to confirm every order · Details used only to deliver this order`。
- 移除「We use your mobile number for delivery updates.」提示（与保障文案重复）。
- 外层 section 去掉多余卡片边框/内边距，避免与表单卡片形成双层卡片。
- 底部购买栏：`PdpStickyBuy` 原本已监听 `#quick-cod-order`，表单进入视口自动隐藏，本轮**未改**其代码。

未改动：结账页布局、Header/Footer、底部导航、商品卡、价格/库存、后端、迁移、ERP。

## 结果

| 场景 | 改前 | 改后 |
|---|---:|---:|
| iPhone 13（390） | 1228px | 903px（−26.5%） |
| iPhone SE（354，Chromium） | 1228px | 931px |
| iPhone SE（354，WebKit） | 1228px | 947px |
| 桌面 1440 | 929px | 875px（仅文案精简） |

三对并排字段在 Chromium/WebKit、390/354 下输入框顶边一致；WebKit SE 的 Barangay/邮编存在 1px 取整差。

## 测试与生产验收

- 新增/更新 `PdpQuickCodOrder.spec.tsx` 5 项断言，先红后绿：23/23。
- 定向 `PdpQuickCodOrder` + `CheckoutConfirmView`：45/45。
- 全量前端：**309 文件 / 3471 用例全部通过**；`tsc --noEmit` 无输出；改动文件 ESLint 干净。
- 生产 Chromium 与 WebKit，iPhone 13 / iPhone SE：10 个输入控件齐全、三对字段对齐、`Select` 占位无截断、Landmark 占位 `Gate name`、单行保障文案、旧标题不存在、底部购买栏在表单视口内隐藏、`pageerror=[]`。
- 截图（临时）：`/tmp/luwag-compact-final-chromium-iphone13.png`、`/tmp/luwag-compact-final-webkit-iphoneSE.png`。

## 代码与镜像

- 分支 `fix/landing-order-notes-20261102`；紧凑化 `995b5d95`，标签对齐/占位修正 `82947787`。
- 最终前端镜像：`sha256:f91e9970f0f0f56fcc74cc26ccab3a07677849c70419360ccfb4ae81c2de1737`；切换后 `running healthy`。
- 中间镜像（紧凑首版）：`sha256:e6318bd999454812d05b8f1a2a0b4fbbe2669f7e8dcd7e003d06f70e77943d58`。
- 无迁移、无 seed、无数据修改；未创建订单；切换后已刷新 `storefront` ISR tag。
- **恢复点**：`small-house-prod-frontend:rollback-pre-form-compact-20261102` → `sha256:c785607205a2c126108e326f33d4a60baf0fa1462afb7c898bf041b93aaa7a63`（紧凑化前、含订单备注的版本）。
- 回滚仅切前端；不要连带回退后端。

## 剩余观察（本轮未改）

- 手机端悬浮客服气泡与「回到顶部」按钮在滚动时会压住表单右侧部分控件，属于全站浮动件；是否在表单区域隐藏需要另行确认。
- 预览页 `/tmp/luwag-form-preview/index.html` 为调研用临时文件，发布截图与线上最终版存在少量差异（占位/标签已微调）。

## 无关附带改动

**无。** `PsgcAddressSelects` 新属性默认关闭，结账页行为与外观不变。
