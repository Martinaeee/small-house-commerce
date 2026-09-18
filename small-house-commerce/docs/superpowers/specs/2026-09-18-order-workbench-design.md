# 订单工作台（Order Workbench）设计

> 背景：用户提出后台订单页需支持——状态标注（含重复订单）、完整历史痕迹（何时下单/客服是否处理/分配给谁/处理结果）、订单编辑、舒适的后台外观。原始设计文档 `docs/DATABASE.md` §37–§48 已定义订单架构（状态分域、订单历史、备注、重复订单风险标记、订单合并），本 spec 严格遵循原文实现未落地部分，并补充用户本次新增需求（客服分配、编辑、中英文切换）。日期：2026-09-18。

## 1. 背景与目标

后台订单页目前只有：列表（订单号/时间/客户/商品/金额/三态徽章）+ 详情（仅确认/取消 + 状态历史时间线）。用户拍板：

- **重复订单标注**：同手机号（不限时间窗）多笔订单 → 标记，不得自动删除（DATABASE §47）。
- **完整历史痕迹**：下单时间、客服是否处理、分配给哪个客服、处理结果，时间线可视化（§45/§46）。
- **订单编辑**：收货信息、备注、商品行（增删改数量）、金额重算；所有编辑留痕（DB-004）。
- **客服分配**：手动分配/改派（列表页下拉 + 详情页），记录操作人。
- **订单合并**：合并未发货订单，保留历史（§48，用户明确本轮做）。
- **发货流程**：`POST /orders/{id}/ship`（API_SPEC §839）**本轮不做**，留待物流对接。
- **后台中英文切换，默认中文**：整个 admin 区域支持 i18n，订单模块先行。

## 2. 全局约束

- **零新 npm 依赖**：i18n 用轻量自研字典（context + hook），不引 i18next。
- 数据库迁移：新增 3 张表 + Order 增列（见 §3），严格 forward-only，禁止 reset。
- 商品行编辑涉及库存预留调整：严格按 DATABASE §30/§31/§32 规则——加行→新增预留；删行/减量→释放预留；改量→多退少补；**绝不二次扣减**（§32 "Do not implement two deductions"）。
- 编辑金额重算：`lineTotal = unitPrice × quantity`，`grandTotal = subtotal + shippingTotal − discountTotal`，全部服务端计算（Decimal），前端只展示。
- 重复检测**只标记不删单**（§47 原文：`Duplicate detection must not automatically delete Orders`）。
- 历史记录（§45）已实现（`order_status_history`，含 `operator_id`/`comment`/`source`）；本 spec 扩展：**状态迁移/客服分配/编辑/合并** 写入 `order_status_history`（statusDomain 扩展为 ASSIGNMENT/EDIT/MERGE）；**客服备注**写入独立的 `order_notes` 表（§46）；前端时间线将两类数据合并渲染。
- 新后台字段必须有中文操作提示（既有约定）；前台 storefront 文案**保持英文**（UX 偏好记忆），i18n 仅作用于 admin 区域。
- 门店下单/checkout 逻辑**零改动**（只加字段默认值/可空列）。
- 遵循既有测试纪律：后端 vitest 纯 `new Service(prismaMock)`；前端 tsc/eslint/next build。

## 3. 数据模型变更（prisma，全部 forward-only）

### 3.1 `Order` 增列（客服分配）

```prisma
assignedToId String? @map("assigned_to_id") @db.Uuid   // 当前负责客服 user.id
assignedBy   String? @map("assigned_by") @db.Uuid      // 分配人 user.id
assignedAt   DateTime? @map("assigned_at") @db.Timestamptz(3)
```

- 改派 = 更新三字段 + 写历史（`statusDomain: 'ASSIGNMENT'`，old→new 为客服 id/姓名快照）。
- 客服来源：`users` 表（Super Admin / 客服角色）。不新建角色——V1 用现有用户即可。

### 3.2 `order_notes`（DATABASE §46 原文实现）

```prisma
model OrderNote {
  id        String   @id @default(uuid(7)) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  userId    String?  @map("user_id") @db.Uuid        // 写备注的操作人
  noteType  String   @map("note_type")               // CUSTOMER_SERVICE / SYSTEM / WAREHOUSE（§46 原文扩展）
  content   String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId])
  @@map("order_notes")
}
```

- 备注不可编辑/删除（内部审计性质，追加式）。

### 3.3 `order_risk_flags`（DATABASE §47 原文实现）

```prisma
model OrderRiskFlag {
  id         String   @id @default(uuid(7)) @db.Uuid
  orderId    String   @map("order_id") @db.Uuid
  flagType   String   @map("flag_type")             // POSSIBLE_DUPLICATE / CUSTOMER_RECHECK / CUSTOMER_BLOCKED
  reason     String?                                // 可读描述
  resolved   Boolean  @default(false)
  createdBy  String?  @map("created_by") @db.Uuid
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(3)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId])
  @@index([flagType, resolved])
  @@map("order_risk_flags")
}
```

- **重复检测**：`GET /admin/orders` 列表时按 customer 手机号分组，同号 ≥2 单 → 每单自动写入/刷新 `POSSIBLE_DUPLICATE` 标记（不删单）。检测在列表查询服务端完成（N+1 控制：一次 groupBy）。
- 人工标记/解除：客服可从详情页添加 `CUSTOMER_RECHECK` 等标记或 resolve。

### 3.4 `order_merge_records`（DATABASE §48 原文实现）

```prisma
model OrderMergeRecord {
  id              String   @id @default(uuid(7)) @db.Uuid
  primaryOrderId  String   @map("primary_order_id") @db.Uuid
  mergedOrderId   String   @map("merged_order_id") @db.Uuid
  operatorId      String?  @map("operator_id") @db.Uuid
  reason          String?
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  primaryOrder Order @relation("PrimaryOrder", fields: [primaryOrderId], references: [id], onDelete: Restrict)
  mergedOrder  Order @relation("MergedOrder", fields: [mergedOrderId], references: [id], onDelete: Restrict)
  @@index([primaryOrderId])
  @@map("order_merge_records")
}
```

- **合并规则**：仅允许合并**未发货**订单（orderStatus ∈ NEW/PENDING/QUESTION/CONFIRMED/ABNORMAL 且 SHIPPING 之外）；合并后 primary 保留，merged 置为 `CANCELLED`（写历史，reason=merge）并释放其预留；**merged 历史订单永不删除**（§48 原文）；商品行/收货信息/金额并入 primary 并重算；合并写 `order_merge_records` + 双方历史。

## 4. API 设计（admin 域，均在 `admin/orders` 下）

| 方法/路径 | 说明 |
|---|---|
| `GET /admin/orders` | 增强：返回 `riskFlags[]`（未解决）、`assignedTo{id,name}`、`duplicateGroupId`（同号组键）；新增筛选 `assignedTo`、`risk`（POSSIBLE_DUPLICATE 等）、`note` 搜索 |
| `GET /admin/orders/:id` | 增强：含 `notes[]`、`riskFlags[]`、`history[]`（联表 operator 姓名）、`mergeRecords[]`、`assignedTo` |
| `PATCH /admin/orders/:id` | 编辑：`{ shippingAddress?, items?, note? }`。收货信息直接更新快照表；商品行增删改（见 §5.2 库存规则）；每次编辑写一条历史（statusDomain `EDIT`，comment 存变更摘要，old/new 存 JSON diff 摘要） |
| `POST /admin/orders/:id/assign` | `{ assignedToId }`，改派客服，写历史 |
| `POST /admin/orders/:id/status` | `{ status, comment? }` 状态迁移（见 §5.1 合法表），写历史（沿用现有 §45 表） |
| `POST /admin/orders/:id/notes` | `{ content, noteType }` 追加内部备注 |
| `POST /admin/orders/:id/risk-flags` | `{ flagType, reason? }` 人工标记；`PATCH /risk-flags/:flagId` resolve |
| `POST /admin/orders/merge` | `{ primaryOrderId, mergedOrderId, reason? }` 合并 |

错误码沿用 API_SPEC：`INVALID_STATUS_TRANSITION`、`DUPLICATE_ORDER`、`ORDER_LOCKED`（合并/编辑时对方单已发货等）。

## 5. 业务规则

### 5.1 状态迁移合法表（含全部运营态）

| 当前 → 合法目标 |
|---|
| NEW → PENDING / QUESTION / CONFIRMED / CANCELLED / DENIED |
| PENDING → QUESTION / CONFIRMED / CANCELLED / DENIED / ABNORMAL |
| QUESTION → PENDING / CONFIRMED / CANCELLED / DENIED |
| CONFIRMED → SHIPPING / CANCELLED / DENIED / AFTER_SALES |
| ABNORMAL → PENDING / QUESTION / CONFIRMED / CANCELLED / DENIED / AFTER_SALES |
| SHIPPING → SIGNED / CANCELLED / AFTER_SALES（发货流程后续再做，本轮仅展示） |
| SIGNED → AFTER_SALES |
| CANCELLED / DENIED → 终态（不可再改） |
| AFTER_SALES → 终态 |

- 取消/拒单 → 释放预留（§31 已实现）。
- `SHIPPING`/`SIGNED` 本轮不提供操作入口（ship 留待），但状态字段保留展示。

### 5.2 商品行编辑库存规则（§30–§32）

服务端逐行 diff：
1. **新增行**：校验 SKU ACTIVE + 库存充足 → `create` OrderItem + 新增预留（movement `ORDER_RESERVED`）。
2. **删除行**：`delete` OrderItem + 释放该行预留（`RESERVATION_RELEASED`）。
3. **改数量**：`update` + 预留差量调整（多退少补）。
4. 任何操作写 `inventory_movements`（§33 原文，含 `operator_id/reason`）。
5. 金额全量重算并写回 Order header；历史留痕。

## 6. 前端设计

### 6.1 i18n 框架（admin 区域）

- `frontend/src/lib/admin-i18n.ts`：`useLang()` hook + `t(key)`；字典文件 `src/i18n/zh.ts` / `en.ts`（key 结构 `orders.list.status` 等）。
- `AdminShell` 顶栏加语言切换按钮（中/EN），localStorage 持久化，默认 `zh`。
- 本轮翻译范围：**AdminShell（导航/通用）、订单列表、订单详情、Dialog/Field/Badge 通用文案**。其余模块（商品/类目等）保持英文原文，key 缺失时 fallback 英文（渐进式，不阻塞）。
- 字典类型安全：`keyof typeof zh` 校验 en 完整性。

### 6.2 订单列表页（改造）

- 新增列：**风险**（`POSSIBLE_DUPLICATE` 显示红色「重复 ⚠」徽章，hover 提示同号其他单链接）、**客服**（当前负责客服名 + 内联下拉改派）。
- 筛选区新增：客服（下拉，来自 users）、风险类型（下拉）、备注关键词搜索。
- 行内快捷操作：确认/取消/分配（保留现有 + 新增）。
- 视觉：保持现有 Badge 色系（§12 设计），列表行高/间距微调提升舒适度（用户要求"整体外观舒适"）。

### 6.3 订单详情页（订单工作台）

布局（左主右辅或上主下辅，响应式）：
1. **顶部状态区**：Order Number + 三态徽章 + 状态迁移下拉（合法目标才可选）+ 分配客服下拉 + 合并按钮 + 编辑按钮。
2. **商品区**（可编辑）：行列表（快照字段）+ 编辑模式（增删行/改数量/改单价）+ 金额汇总（Subtotal/You save/Shipping/Total）。
3. **收货信息区**（可编辑）：地址快照表 + 编辑表单（全字段）。
4. **备注区**：`order_notes` 追加式列表 + 新增输入（客服备注）。
5. **风险标记区**：风险徽章 + 添加/解除。
6. **时间线**：统一展示（下单/分配/状态/编辑/备注/合并），按时间倒序，每条含操作人姓名（联表 users）、时间、变更摘要。
7. 所有操作按钮带确认 Dialog（沿用现有 Dialog 组件）。

### 6.4 合并 UI

- 详情页「合并订单」→ Dialog：输入/选择被合并订单号（可搜索）→ 显示两单摘要（金额/商品/状态）→ 确认合并（校验未发货）。
- 合并后详情页显示合并记录（§48 字段）与双方历史。

## 7. 测试

- 后端（vitest，纯 mock）：
  - 重复检测 groupBy 逻辑（同号 2 单/3 单、跨时间、resolve 后不再标记）
  - 状态迁移合法表（每个转移合法/非法）
  - 商品行编辑库存 diff（增/删/改量、预留增减、金额重算、库存不足拒绝）
  - 合并（未发货校验、merged 置 CANCELLED+释放预留、双写历史、不可逆）
  - 分配/备注/风险标记写历史
  - 历史联表返回操作人姓名
- 前端：`tsc --noEmit` + `eslint` + `next build` + 浏览器手动验证（中英文切换、工作台交互）。
- 迁移验证：`prisma migrate status` up to date；生产部署前备份 + `prisma generate`（既有纪律）。

## 8. 非目标（本轮不做）

- 发货流程（`/ship`、SHIPPING/SIGNED 操作入口、物流对接）——已确认留待。
- 支付操作（收款/退款）、库存手工调整页。
- 其余 admin 模块（商品/类目/单页）的 i18n 翻译（框架先行，逐模块迁移）。
- 门店（storefront）任何改动。

## 9. 文件结构（本轮新增/修改）

**后端**：
- `prisma/schema/order.prisma` — Order 增 3 列 + 3 新模型（notes/risk_flags/merge_records）
- `prisma/migrations/<ts>_order_workbench/` — 新迁移
- `src/modules/orders/admin/orders.controller.ts` — 新增 PATCH/assign/status/notes/risk-flags/merge 端点
- `src/modules/orders/orders.service.ts` — 编辑/分配/状态/合并/重复检测/备注逻辑
- `src/modules/orders/dto/order.dto.ts` — 新 DTO（编辑/分配/状态/备注/风险/合并）
- `src/modules/orders/orders.service.spec.ts` — 新测试

**前端**：
- `src/lib/admin-i18n.ts` + `src/i18n/zh.ts` / `en.ts` — i18n 框架
- `src/components/admin/AdminShell.tsx` — 语言切换
- `src/app/admin/(shell)/orders/page.tsx` — 列表改造
- `src/app/admin/(shell)/orders/[id]/page.tsx` — 订单工作台
- `src/components/admin/orders/` — 新子组件（Timeline/NoteSection/RiskFlags/ItemEditor/MergeDialog/AssignSelect 等）

## 10. 验收标准（用户视角）

1. 列表页：重复订单有醒目 ⚠ 标记；可按客服/风险筛选；客服可下拉改派。
2. 详情页：时间线完整（下单/分配/状态/编辑/备注/合并，含操作人姓名和时间）；状态可切换（合法迁移）；商品/收货/备注可编辑，编辑后金额与预留正确、历史可见。
3. 合并：两单合并后 primary 含全部商品、merged 置 CANCELLED 且历史保留。
4. 中英文切换：默认中文，顶栏切换，订单模块全部文案双语完整。
5. 生产部署后门店下单/查单不受影响（回归）。
