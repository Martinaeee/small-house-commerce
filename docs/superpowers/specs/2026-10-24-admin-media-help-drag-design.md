# 后台媒体 UX：问号提示、批量归属、拖动排序

日期：2026-10-24
状态：待实现
基线：生产 `c969745`（含订单 V2 与商品行悬停）

## 1. 目标

用户确认的三项需求：

1. **后台所有说明性小字改成问号提示**：悬停/聚焦/点按显示原文，不再长期占版面；计数、状态、报错、空态、进度、阻断性警告保持可见。
2. **详情长图在上传时批量选归属**：一次选择「共享 / 选项值 / 精确款式」，本批文件、手填 URL、手动新增空块都跟随该归属；缩略图直接标出归属；单图编辑里的归属下拉保留。
3. **商品与营销的媒体列表支持拖动排序**：共享图库、选项值/精确款式图库、详情长图、营销媒体；保留现有 ↑↓ 按钮；支持鼠标、触屏、键盘。

## 2. 非目标

- 不改前台 PDP 的详情图拼接/整组替换规则。
- 不改共享图库 / 款式图库的数据模型与保存接口。
- 不做首页装修区块的拖动排序（首页模块树、幻灯片已有 dnd-kit，不在本批）。
- 不做商品卡封面/悬停双图的排序（固定两个槽位）。
- 不新增后端接口、不改数据库结构。

## 3. 现状（生产基线）

- `Field` 统一在输入框下渲染 `hint` 灰字（后台约 74 处 `hint=`），另有 66 个后台文件约 235 行 `text-xs + text-ink-muted` 说明。
- 详情长图块数据已有 `variantId` / `optionValueId` 可空字段，`ProductForm` 已能序列化；归属下拉只存在于单图展开编辑器。
- `MediaGallery` 支持 `onMove(key, delta)` 的 ↑↓，没有拖动；被详情长图、选项值/款式图库、营销媒体复用。
- `SharedMediaWorkspace` 已有原生 HTML5 拖动（鼠标可用，触屏/键盘不可用）。
- `@dnd-kit/core`、`@dnd-kit/sortable` 已是依赖，首页模块树/幻灯片/页脚排序已在用，可直接复用现有键盘坐标 getter 与测试手法。

## 4. 设计

### 4.1 问号提示组件

新增 `frontend/src/components/admin/AdminHelpTip.tsx`（client）：

```tsx
export function AdminHelpTip(props: {
  text: ReactNode;
  label?: string;      // aria-label，默认 i18n admin_help_tip_aria
  id?: string;         // 关联 aria-describedby
  className?: string;
}): ReactNode
```

行为：

- `?` 小圆钮（`type="button"`），尺寸与现有标签同高，不抢视觉。
- 桌面悬停/聚焦打开；点按切换并固定；Esc 关闭；点外部关闭。
- 内容**始终在 DOM**：关闭时 `sr-only`，打开时绝对定位成小气泡（`role="tooltip"`，`max-w-xs`，自动换行，`z-50`）。这样读屏、现有按文本查询的测试都能继续工作。
- 按钮在 `Field` 的 `<label>` 内时，点击 `preventDefault` + `stopPropagation`，不触发关联控件。
- 移动端：点按开关，气泡在按钮下方，宽度不超过视口。

`Field` 新增：

```tsx
hint?: ReactNode;
hintDisplay?: "tooltip" | "inline"; // 默认 "tooltip"
```

默认把 `hint` 放到标签旁的 `?` 里；`hintDisplay="inline"` 保留原来的灰字段落（仅用于“不看会填错”的格式要求或阻断性说明）。

### 4.2 小字转换规则

**转换**：解释字段/区域是什么、内容从哪里来、会显示在哪里、顺序如何生效的被动说明。

**保持可见**：

- 计数与摘要（`9 行 / 9 张图片`、`3 个 SKU`）
- 状态、库存、价格、时间戳、SKU 码
- 表单校验错误（`role="alert"`）
- 上传进度、失败原因、结果列表
- 空态（`暂无图片`）
- 阻断性警告与删除确认
- 按钮/链接自身的动作文字

散落的 `<p className="...text-xs...text-ink-muted">说明</p>` 改为标题或字段标签旁的 `<AdminHelpTip text={...} />`，原文不删，移入气泡。

### 4.3 详情长图批量归属

`MediaAddRow` 增加可选属性（只有详情长图传入）：

```tsx
scopeOptions?: readonly { value: string; label: string }[];
scopeValue?: string;
onScopeChange?: (value: string) => void;
scopeLabel?: string;
```

- 上传行顺序：`上传图片 / 视频` → `归属 [共享 ▾]` → `图片/视频` → `URL` → `添加`。空间不足自动换行。
- `DetailMediaWorkspace` 持有 `scopeValue` 状态（默认 `""` = 共享），选择后保持不变，直到再次修改。
- `MediaAddRow` 的 `onAddMedia(media)` 签名不变；`DetailMediaWorkspace` 在回调里附加当前归属，调用 `onAddMedia(media, scope)`。
- 手动 URL 与手动新增空块同样附加当前归属。
- `ProductForm`：
  - `addDetailMedia(media, scope?)`、`addDetailBlock(type, scope?)` 把 `option:<id>` / `variant:<id>` 写进 `optionValueId` / `variantId`（互斥，XOR 不变）。
  - 新增 `moveDetailBlockTo(from, to)`，与现有 `moveImageTo` 同型，重排后按位置重编号 `sortOrder`。
- 缩略图标签：`MediaGallery` 的 item 新增可选 `scopeLabel?: string`；有值时在缩略图左下角渲染小徽标（共享用中性色，选项值/款式用 `cta` 强调）。详情长图传入，其他图库不传。
- 标题区：删除两行说明，改为 `详情内容（图片 / 视频）` 右侧的 `?`，气泡内容合并原文两句。

### 4.4 拖动排序

`MediaGallery` 新增可选 `onReorder?: (from: number, to: number) => void`：

- 有 `onReorder` 时，把缩略图网格包进 `DndContext` + `SortableContext`（`rectSortingStrategy`）。
- 每个缩略图左上角一个专用抓手（grip 图标，`aria-label` 来自 `product_media_drag_aria`），只有抓手绑定 `listeners/attributes`；缩略图本体点击仍展开编辑器。
- `PointerSensor` 激活距离 6px，`KeyboardSensor` + `sortableKeyboardCoordinates`（与首页现有实现一致）。
- `onDragEnd` 调用 `onReorder(oldIndex, newIndex)`；没有 `onReorder` 时不渲染抓手，完全保持现状。

接入：

| 位置 | 现有重排 | 新增 |
| --- | --- | --- |
| 共享图库 `SharedMediaWorkspace` | 原生 HTML5 拖动 + ↑↓ | 换成同一套 dnd-kit 抓手（保留 `onReorder` 与 ↑↓），补触屏/键盘 |
| 详情长图 `DetailMediaWorkspace` | ↑↓ | `ProductForm.moveDetailBlockTo` |
| 选项值/款式图库 `ProductMediaScopesEditor` | ↑↓ | 组内按 `sortOrder` 交换后 `renumberScopes` |
| 营销媒体 `MarketingMediaField` | 无 | 数组 splice 重排后 `onChange` |

排序结果仍走现有 `sortOrder` 序列化，保存行为不变。

## 5. i18n

新增键（zh/en）：

- `admin_help_tip_aria`：更多说明
- `product_detail_upload_scope`：归属
- `product_media_drag_aria`：拖动排序
- `product_detail_scope_badge_shared`：共享（如已有 `product_detail_scope_shared` 则复用）

删除使用中的 `product_detail_scope_explanation`、`product_detail_hint` 的渲染（键可保留，避免大范围清理）。

## 6. 实施顺序

### 阶段 1：媒体区（先交付）

1. `AdminHelpTip` + `Field.hintDisplay` + 新增测试。
2. 详情长图批量归属、缩略图标签、标题问号。
3. `MediaGallery` 拖动 + 四个接入点。
4. 相关测试：详情上传归属、URL/空块归属、徽标、键盘拖动、保存后顺序。

### 阶段 2：全后台小字扫尾（按模块分批）

1. 商品表单与媒体
2. 营销
3. 首页装修
4. 集合/分类/分组/FAQ
5. 订单
6. 页眉/页脚/品牌
7. 订阅/仪表盘/设置

每批：只改说明类文案 → 跑该目录测试 + 全量测试 + `tsc` + `build`；如发现某条说明属于“必须看见”，标 `hintDisplay="inline"` 并记录原因。

## 7. 测试

- `AdminHelpTip`：悬停/聚焦/点按/Esc/点外部；内容始终可被 `getByText` 找到；`aria-describedby` 正确。
- `Field`：默认把 hint 放进问号；`hintDisplay="inline"` 仍渲染灰字；错误仍可见。
- 详情归属：选中「颜色=黑」后一次上传 3 个文件 → 3 个块都带 `optionValueId`；URL 添加与空块同样；切换回共享后新块为共享；缩略图徽标文本正确。
- 拖动：键盘 Space 拿起、方向键移动、Space 放下后 `onReorder` 收到正确索引；↑↓ 仍可用；点击缩略图仍展开；拖动不会触发展开。
- 保存回归：拖动后保存 payload 的 `sortOrder` 密集且顺序正确。

## 8. 验收

- 详情区只剩标题 + 计数 + `?`；气泡含原文。
- 上传前可选归属；一次上传全部带同一归属；缩略图可见归属；单图仍可改。
- 共享/详情/选项值/款式/营销媒体都能拖动，鼠标、触屏、键盘均可用；↑↓ 与保存不回归。
- 阶段 2 覆盖的模块中，说明类小字不再长期占用版面；计数/状态/报错/空态/进度原样可见。
- 前端全量测试、`tsc`、`build` 通过；无后端/迁移改动。

## 9. 风险

- 66 个文件的文案迁移是视觉回归面最大的部分 → 分批、每批跑测试与构建，先易后难。
- 现有测试可能断言灰字位置 → HelpTip 内容常驻 DOM，文本查询基本不受影响；断言布局的用例逐个修正。
- 拖动与“点击展开”冲突 → 仅抓手可拖；指针激活距离 6px。
- 触屏上 hover 样式残留 → 气泡用点按开关，不依赖 hover 状态。
