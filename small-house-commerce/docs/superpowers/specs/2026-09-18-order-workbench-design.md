# 订单工作台（Order Workbench）设计

> 背景：用户提出后台订单页需支持——状态标注（含重复订单）、完整历史痕迹（何时下单/客服是否处理/分配给谁/处理结果）、订单编辑、舒适的后台外观。原始设计文档 `docs/DATABASE.md` §37–§48 + `docs/CUSTOMER_RISK_SPEC.md`（客户风险规格 21 节）已定义完整订单与客户风险架构。本 spec 严格遵循原文实现未落地部分，并补充用户本次新增需求（客服分配、编辑、中英文切换）。日期：2026-09-18。

## 1. 背景与目标

后台订单页目前只有：列表（订单号/时间/客户/商品/金额/三态徽章）+ 详情（仅确认/取消 + 状态历史时间线）。用户拍板：

- **客户分类标注**：`order_customer_classification` = `NEW / AGAIN / RPT / RECHECK`，下单时按算法计算存快照（DATABASE §14、CUSTOMER_RISK_SPEC §6–7）。
- **分类影响确认与发货（§17 确认策略，用户拍板）**：NORMAL/AGAIN 标准确认；**RPT/RECHECK 进入人工复核队列**，`confirmationStatus` 置 `NEEDS_REVIEW`，必须人工复核后确认；**RECHECK 发货前强制卡点**——未来 ship 必须校验 `confirmationStatus=CONFIRMED` 且无未解决高风险 flag。现有 `checkout()` 已预留 `riskType/requiresReview` 返回字段（注释 "Risk rules land in Phase 2"），本轮即 Phase 2 落地。
- **重复订单标注**：同手机号 + 相似商品 + 24 小时窗口 → `POSSIBLE_DUPLICATE`（CUSTOMER_RISK_SPEC §14），**只标记不自动删单**（DATABASE §47）。
- **完整历史痕迹**：下单时间、客服是否处理、分配给哪个客服、处理结果，时间线可视化（DATABASE §45/§46、CUSTOMER_RISK_SPEC §10/§13）。
- **订单编辑**：收货信息、备注、商品行（增删改数量）、金额重算；所有编辑留痕（DB-004）。
- **客服分配**：手动分配/改派（列表页下拉 + 详情页），记录操作人。
- **订单合并**：合并未发货订单，保留历史（DATABASE §48 + CUSTOMER_RISK_SPEC §15，用户明确本轮做）。
- **发货流程**：`POST /orders/{id}/ship`（API_SPEC §839）**本轮不做**，留待物流对接。
- **后台中英文切换，默认中文**：整个 admin 区域支持 i18n，订单模块先行。

## 2. 全局约束

- **零新 npm 依赖**：i18n 用轻量自研字典（context + hook），不引 i18next。
- 数据库迁移：新增表 + Order/Customer 增列（见 §3），严格 forward-only，禁止 reset。
- 商品行编辑涉及库存预留调整：严格按 DATABASE §30/§31/§32 规则——加行→新增预留；删行/减量→释放预留；改量→多退少补；**绝不二次扣减**（§32 "Do not implement two deductions"）。
- 编辑金额重算：`lineTotal = unitPrice × quantity`，`grandTotal = subtotal + shippingTotal − discountTotal`，全部服务端计算（Decimal），前端只展示。
- 客户分类是**下单时计算的一次性快照**（DATABASE §14 "calculated when the new order enters the system and stored as a snapshot"），后续订单变化不重算历史订单的分类。
- 风险只能升级、降级需 ADMIN 批准 + 风险备注（CUSTOMER_RISK_SPEC §8）。
- 重复检测/风险决策**必须留痕**（CUSTOMER_RISK_SPEC §10 customer_risk_logs；§19 Audit：operator/time/before/after/reason）。
- 新后台字段必须有中文操作提示（既有约定）；前台 storefront 文案**保持英文**（UX 偏好记忆），i18n 仅作用于 admin 区域。
- 门店下单/checkout 逻辑**零改动**（分类计算挂在订单创建后的扩展点，只新增可空列/新表）。
- 遵循既有测试纪律：后端 vitest 纯 `new Service(prismaMock)`；前端 tsc/eslint/next build。

## 3. 数据模型变更（prisma，全部 forward-only）

### 3.1 `Order` 增列

```prisma
assignedToId String? @map("assigned_to_id") @db.Uuid   // 当前负责客服 user.id
assignedBy   String? @map("assigned_by") @db.Uuid      // 分配人 user.id
assignedAt   DateTime? @map("assigned_at") @db.Timestamptz(3)
customerClassification String @default("NEW") @map("customer_classification")  // NEW/AGAIN/RPT/RECHECK
```

- `customerClassification`：下单时由算法计算写入（默认 NEW）；类型可收紧为 enum，与 DATABASE §14 一致。
- 客服来源：`users` 表（Super Admin / 客服角色）。V1 不新建角色，用现有用户。

### 3.2 `order_notes`（DATABASE §46 原文实现）

```prisma
model OrderNote {
  id        String   @id @default(uuid(7)) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  userId    String?  @map("user_id") @db.Uuid
  noteType  String   @map("note_type")               // CUSTOMER_SERVICE / SYSTEM / WAREHOUSE
  content   String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId])
  @@map("order_notes")
}
```

- 备注不可编辑/删除（内部审计性质，追加式）。

### 3.3 `customer_notes`（CUSTOMER_RISK_SPEC §13 原文实现）

```prisma
model CustomerNote {
  id         String   @id @default(uuid(7)) @db.Uuid
  customerId String   @map("customer_id") @db.Uuid
  orderId    String?  @map("order_id") @db.Uuid     // 可关联到订单
  operatorId String?  @map("operator_id") @db.Uuid
  note       String
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  @@index([customerId])
  @@map("customer_notes")
}
```

- 客户维度的沟通记录（"Customer confirmed address" 等，§13 原文），在订单工作台客户侧展示，可跨订单累积。

### 3.4 `order_risk_flags`（DATABASE §47 原文实现）

```prisma
model OrderRiskFlag {
  id         String   @id @default(uuid(7)) @db.Uuid
  orderId    String   @map("order_id") @db.Uuid
  flagType   String   @map("flag_type")             // POSSIBLE_DUPLICATE / CUSTOMER_RECHECK / CUSTOMER_BLOCKED
  reason     String?
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

- **重复检测**（CUSTOMER_RISK_SPEC §14）：同手机号 **+ 相似商品（相同 productId 或 SKU）+ 24 小时窗口** 内多笔 → 系统自动写入 `POSSIBLE_DUPLICATE`（每单一条，不删单）。检测在订单创建时 + 列表查询时刷新。
- 人工标记/解除：客服可从详情页添加 `CUSTOMER_RECHECK`/`CUSTOMER_BLOCKED` 或 resolve（降级需 ADMIN 批准，§8）。

### 3.5 `customer_risk_logs`（CUSTOMER_RISK_SPEC §10 原文实现）

```prisma
model CustomerRiskLog {
  id                String   @id @default(uuid(7)) @db.Uuid
  customerId        String   @map("customer_id") @db.Uuid
  orderId           String?  @map("order_id") @db.Uuid
  riskType          String   @map("risk_type")       // NEW/AGAIN/RPT/RECHECK
  previousOrderId   String?  @map("previous_order_id") @db.Uuid
  reason            String?
  operatorId        String?  @map("operator_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  @@index([customerId])
  @@map("customer_risk_logs")
}
```

- **每笔风险决策必记**（§10/§19）：下单时分类计算、人工改分类、标记/解除风险 flag。

### 3.6 `order_merge_records`（DATABASE §48 + CUSTOMER_RISK_SPEC §15 原文实现）

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

- **合并规则**（CUSTOMER_RISK_SPEC §15）：仅允许状态 ∈ `NEW/PENDING/CONFIRMED`（原文 NEW/PENDING_CONFIRM，映射到现有枚举）的订单；要求**同一客户 + 同手机号 + 同地址**；动作 = **合并商品行 + 取消重复单 + 保留最早订单** + 写 audit log；merged 置 `CANCELLED`（reason=merge）并释放预留；**历史订单永不删除**（§48）；合并写 `order_merge_records` + 双方历史。

## 4. 客户分类算法（CUSTOMER_RISK_SPEC §7 Step 3 原文）

下单时对 `phone_normalized` 匹配历史（可含预下单 leads 层，V1 只查 orders），伪代码：

```
IF previous denied > 0                       → RECHECK
ELSE IF previous failed delivery > 0         → RECHECK
ELSE IF previous pending/shipping order exists → RPT
ELSE IF previous signed order exists         → AGAIN
ELSE                                          → NEW
```

优先级 RECHECK > RPT > AGAIN > NEW（DATABASE §17）。

## 5. API 设计（admin 域）

| 方法/路径 | 说明 |
|---|---|
| `GET /admin/orders` | 增强：返回 `classification`（NEW/AGAIN/RPT/RECHECK 徽章色）、`riskFlags[]`、`assignedTo{id,name}`、`duplicateGroupId`；新增筛选 `classification`、`assignedTo`、`risk`、`note` 搜索 |
| `GET /admin/orders/:id` | 增强：含 `notes[]`、`customerNotes[]`、`riskFlags[]`、`riskLogs[]`、`history[]`（联表操作人姓名）、`mergeRecords[]`、`assignedTo`、`classification` |
| `PATCH /admin/orders/:id` | 编辑：`{ shippingAddress?, items?, note? }`。收货信息更新快照表；商品行增删改（§6.2 库存规则）；每次编辑写一条历史（statusDomain `EDIT`，comment 存变更摘要） |
| `POST /admin/orders/:id/assign` | `{ assignedToId }`，改派客服，写历史（statusDomain `ASSIGNMENT`） |
| `POST /admin/orders/:id/confirm` | 升级现有端点：RPT/RECHECK 需带 `{ decision, note? }`（§6.1 卡点），写 risk_log/customer_note/history |
| `POST /admin/orders/:id/status` | `{ status, comment? }` 状态迁移（§6.2 合法表），写历史（沿用 §45 表）；`CONFIRMED` 经 §6.1 卡点确认流程 |
| `POST /admin/orders/:id/notes` | `{ content, noteType }` 追加订单内部备注（order_notes） |
| `POST /admin/customers/:id/notes` | `{ note, orderId? }` 客户沟通记录（customer_notes） |
| `POST /admin/orders/:id/risk-flags` | `{ flagType, reason? }` 人工标记；`PATCH /risk-flags/:flagId` resolve（降级需 ADMIN 权限，写 risk_log） |
| `POST /admin/orders/merge` | `{ primaryOrderId, mergedOrderId, reason? }` 合并（§3.6 规则） |

错误码沿用 API_SPEC：`INVALID_STATUS_TRANSITION`、`DUPLICATE_ORDER`、`ORDER_LOCKED`、`PERMISSION_DENIED`（降级风险）。

## 6. 业务规则

### 6.1 确认/发货风险卡点（CUSTOMER_RISK_SPEC §17，用户拍板）

| 分类 | 确认策略 | 卡点 |
|---|---|---|
| NORMAL | 标准确认队列 | 无 |
| AGAIN | 快速确认（徽章提示，可正常确认） | 无 |
| RPT | **人工复核**：`confirmationStatus` 置 `NEEDS_REVIEW`，进入复核队列；客服按 §12 流程（Call Customer → Decision）复核后确认 | `confirm` 端点对 RPT/RECHECK 必须走复核确认（带 decision/reason），**不可直接跳过** |
| RECHECK | 人工复核同上 + **发货前强制卡点** | 未来 `ship` 端点校验 `confirmationStatus=CONFIRMED` 且无未解决 RECHECK/POSSIBLE_DUPLICATE flag，否则拒绝 |

- `checkout()` 返回已预留 `riskType/requiresReview`；本轮让 `checkout` 按 §7 算法真实计算并回填。
- `confirm()` 现有实现（orders.service.ts:208）升级：读 `customerClassification`，RPT/RECHECK 时要求 `decision` 参数（`CONFIRM`/`CANCEL`/`REQUEST_INFO`，§12），写 `customer_risk_logs` + `customer_notes` + history，再置 CONFIRMED。

### 6.2 状态迁移合法表（含全部运营态）

| 当前 → 合法目标 |
|---|
| NEW → PENDING / QUESTION / CONFIRMED / CANCELLED / DENIED |
| PENDING → QUESTION / CONFIRMED / CANCELLED / DENIED / ABNORMAL |
| QUESTION → PENDING / CONFIRMED / CANCELLED / DENIED |
| CONFIRMED → SHIPPING / CANCELLED / DENIED / AFTER_SALES |
| ABNORMAL → PENDING / QUESTION / CONFIRMED / CANCELLED / DENIED / AFTER_SALES |
| SHIPPING → SIGNED / CANCELLED / AFTER_SALES（本轮仅展示，无操作入口） |
| SIGNED → AFTER_SALES |
| CANCELLED / DENIED / AFTER_SALES → 终态 |

- 取消/拒单 → 释放预留（§31 已实现）。
- `SHIPPING`/`SIGNED` 本轮不提供操作入口（ship 留待），状态字段保留展示。

### 6.3 商品行编辑库存规则（§30–§32）

服务端逐行 diff：
1. **新增行**：校验 SKU ACTIVE + 库存充足 → `create` OrderItem + 新增预留（movement `ORDER_RESERVED`）。
2. **删除行**：`delete` OrderItem + 释放该行预留（`RESERVATION_RELEASED`）。
3. **改数量**：`update` + 预留差量调整（多退少补）。
4. 任何操作写 `inventory_movements`（§33 原文，含 `operator_id/reason`）。
5. 金额全量重算并写回 Order header；历史留痕。

## 7. 前端设计

### 7.1 i18n 框架（admin 区域）

- `frontend/src/lib/admin-i18n.ts`：`useLang()` hook + `t(key)`；字典 `src/i18n/zh.ts` / `en.ts`（key 结构 `orders.list.status` 等）。
- `AdminShell` 顶栏加语言切换按钮（中/EN），localStorage 持久化，默认 `zh`。
- 本轮翻译范围：**AdminShell（导航/通用）、订单列表、订单详情、Dialog/Field/Badge 通用文案**。其余模块保持英文原文，key 缺失 fallback 英文（渐进式）。
- 字典类型安全：`keyof typeof zh` 校验 en 完整性。

### 7.2 后台整体风格布局升级（用户拍板）

订单工作台是后台 UI 升级的第一站，确立新的视觉基线，后续模块沿用：

- **布局**：列表页从"密集表格"改为**卡片行 + 关键列**（订单号/分类徽章/状态/客户/金额/时间/客服/风险），行高与间距加大（`py-3.5` 以上、行间分隔柔和）；详情页顶部固定操作条（状态/客服/合并/编辑主按钮区），内容分两栏（左：商品+收货；右：时间线+备注+风险）。
- **视觉**：沿用 Tailwind 设计 token 与 Badge 色系（§12 设计）；分类徽章三色（🟢 AGAIN / 🟡 RPT / 🔴 RECHECK）；卡片 `rounded-xl border-border bg-card`；hover 行高亮；操作按钮统一主次两级。
- **AdminShell**：顶栏加语言切换（中/EN，§7.1）；导航与面包屑保持；整体间距/字号统一（`text-sm` 基线），后台全区域舒适可读。
- **中英文**：新风格所有文案走 i18n 字典（§7.1），默认中文。

### 7.3 订单列表页（改造）

- 新增列：**分类徽章**（🟢 AGAIN / 🟡 RPT / 🔴 RECHECK，色随 §16 显示规则）、**风险**（`POSSIBLE_DUPLICATE` 红色「重复 ⚠」）、**客服**（当前负责客服名 + 内联下拉改派）。
- 筛选区新增：分类（NEW/AGAIN/RPT/RECHECK）、客服、风险类型、备注关键词。
- 行内快捷操作：确认/取消/分配（保留现有 + 新增）。
- 视觉：沿用 Badge 色系（§12 设计），列表行高/间距微调提升舒适度。

### 7.4 订单详情页（订单工作台）

布局（左主右辅或上主下辅，响应式）：
1. **顶部状态区**：Order Number + 分类徽章 + 三态徽章 + 状态迁移下拉（合法目标才可选）+ 分配客服下拉 + 合并按钮 + 编辑按钮。
2. **商品区**（可编辑）：行列表（快照字段）+ 编辑模式（增删行/改数量/改单价）+ 金额汇总。
3. **收货信息区**（可编辑）：地址快照表 + 编辑表单（全字段）。
4. **订单备注区**：`order_notes` 追加式列表 + 新增输入。
5. **客户沟通区**：`customer_notes` 列表（跨订单累积）+ 新增输入；含客户分类徽章与 risk_logs 摘要。
6. **风险标记区**：风险徽章 + 添加/解除（降级走 ADMIN 确认）。
7. **时间线**：统一展示（下单/分类计算/分配/状态/编辑/备注/合并/风险变更），按时间倒序，每条含操作人姓名、时间、变更摘要。
8. 所有操作按钮带确认 Dialog（沿用现有 Dialog 组件）。

### 7.5 合并 UI

- 详情页「合并订单」→ Dialog：输入被合并订单号（可搜索）→ 显示两单摘要（金额/商品/状态/客户一致性校验）→ 确认合并（校验 §3.6 规则）。
- 合并后详情页显示合并记录（§48 字段）与双方历史。

## 8. 测试

- 后端（vitest，纯 mock）：
  - 客户分类算法：RECHECK > RPT > AGAIN > NEW 各分支（denied/failed/pending-signed/无历史）
  - 重复检测：同号+同商品+24h → POSSIBLE_DUPLICATE；跨 24h/不同商品 → 不标
  - 状态迁移合法表（每个转移合法/非法）
  - 确认卡点：RPT/RECHECK 无 decision 拒绝确认；带 decision 走通并写 risk_log/customer_note；NORMAL/AGAIN 直接确认不受影响
  - 商品行编辑库存 diff（增/删/改量、预留增减、金额重算、库存不足拒绝）
  - 合并（未发货校验、同客户/手机号/地址校验、merged 置 CANCELLED+释放预留、双写历史、不可逆、保留最早订单）
  - 分配/备注/风险标记写历史 + risk_log
  - 风险降级需 ADMIN 权限
  - 历史联表返回操作人姓名
- 前端：`tsc --noEmit` + `eslint` + `next build` + 浏览器手动验证（中英文切换、工作台交互）。
- 迁移验证：`prisma migrate status` up to date；生产部署前备份 + `prisma generate`（既有纪律）。

## 9. 非目标（本轮不做）

- 发货流程（`/ship`、SHIPPING/SIGNED 操作入口、物流对接）——已确认留待。
- 支付操作（收款/退款）、库存手工调整页。
- 双检中心独立页（CUSTOMER_RISK_SPEC §11）：V1 通过订单列表「分类=RPT/RECHECK」筛选 + 详情工作台完成，不做独立队列页。
- 风险评分 0–100（§9）、分析报表（§18）——future extension。
- 其余 admin 模块（商品/类目/单页）的 i18n 翻译（框架先行，逐模块迁移）。
- 门店（storefront）任何改动。

## 10. 文件结构（本轮新增/修改）

**后端**：
- `prisma/schema/order.prisma` — Order 增 4 列（assignedToId/assignedBy/assignedAt/customerClassification）
- `prisma/schema/customer.prisma`（或 order.prisma）— Customer 增 relations + 4 新模型（order_notes/customer_notes/order_risk_flags/customer_risk_logs/order_merge_records）
- `prisma/migrations/<ts>_order_workbench/` — 新迁移
- `src/modules/orders/admin/orders.controller.ts` — 新增 PATCH/assign/status/notes/risk-flags/merge 端点
- `src/modules/orders/orders.service.ts` — 编辑/分配/状态/合并/重复检测/备注/分类逻辑
- `src/modules/orders/customer-risk.service.ts`（新）— 客户分类算法 + 重复检测
- `src/modules/orders/dto/order.dto.ts` — 新 DTO（编辑/分配/状态/备注/风险/合并/客户备注）
- `src/modules/orders/orders.service.spec.ts` + `customer-risk.service.spec.ts` — 新测试

**前端**：
- `src/lib/admin-i18n.ts` + `src/i18n/zh.ts` / `en.ts` — i18n 框架
- `src/components/admin/AdminShell.tsx` — 语言切换
- `src/app/admin/(shell)/orders/page.tsx` — 列表改造
- `src/app/admin/(shell)/orders/[id]/page.tsx` — 订单工作台
- `src/components/admin/orders/` — 新子组件（Timeline/NoteSection/CustomerNotes/RiskFlags/ItemEditor/MergeDialog/AssignSelect/ClassificationBadge 等）

## 11. 验收标准（用户视角）

1. 列表页：每单有分类徽章（NEW/AGAIN/RPT/RECHECK）；重复订单有红色「重复 ⚠」标记；可按分类/客服/风险筛选；客服可下拉改派。
2. 详情页：时间线完整（下单/分类/分配/状态/编辑/备注/合并/风险，含操作人姓名和时间）；状态可切换（合法迁移）；商品/收货/备注/客户沟通可编辑，编辑后金额与预留正确、历史可见；风险可标记/解除（降级需 ADMIN）。
3. **确认卡点**：RPT/RECHECK 订单无法直接确认——详情页进入复核流程（显示客户历史/风险原因 → Call → 决策 Confirm/Cancel/Request Info → 确认成功并留痕）；NORMAL/AGAIN 可直接确认。
4. 合并：两单（同客户/同号/同地址/未发货）合并后 primary 含全部商品、merged 置 CANCELLED 且历史保留。
5. 中英文切换：默认中文，顶栏切换，订单模块全部文案双语完整。
6. 生产部署后门店下单/查单不受影响（回归）。
