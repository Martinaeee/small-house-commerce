# 统一商品分组：分类并入集合 — 设计稿（评审修订版）

- 日期：2026-10-23（修订：同日评审意见）
- 状态：修订稿 — 仅批准继续完善设计与本地草稿；生产数据库、外键、分组数据、
  首页内容、迁移与部署均未授权
- 影响环境：生产 `smallhouse-prod`、本地/验证库
- 交付路径：阶段 A（本地草稿）→ 阶段 B（生产备份副本演练）→ 阶段 C（批准后分批切换）
  → 阶段 D（观察后授权清理）

## 0. 评审意见对照

| 评审要求 | 本稿处理 |
| --- | --- |
| 一张统一列表、树形可展开、顶部切换 | 第 7 节（布局）；草稿页实现 |
| 字段与计数口径（直属/含子类、ACTIVE） | 4.4 节明确定义两套数字 |
| 保留统一新建/编辑弹窗 | 第 7 节；复用现有 Dialog/表单组件 |
| 移除大说明框，改帮助提示 | 7.2 节 |
| 视觉沿用 LUWAG Admin | 7.3 节；不新建视觉体系 |
| 主分组单选 + 其他分组多选 | 4.2、4.5；商品编辑页分 C2 阶段接线 |
| 营销集合角标/成员/排序/上架不变 | 4.3、5.7；回归清单 |
| 重新评估双表并存、回滚、ID、JSON、URL、计数、删除、语义 | 第 5 节全部重写 |
| 禁止无约束全文 UUID 替换 | 5.4 结构化 JSON 迁移 |
| 不得假设“旧表还在=旧代码可回滚” | 5.3 兼容矩阵明示：唯一可靠回滚是全库恢复 |
| 阶段 A/B/C/D | 第 10 节 |
| 交付草稿、方案、矩阵、演练、回归清单 | 第 7、5、11、12 节 + 本地草稿页 |

## 1. 背景

后台「商品分组」页现有两套实体：

- 分类 Category：商品唯一归属、带层级，驱动 `/categories/<slug>`、页头下拉、首页分类瓷砖、
  面包屑、搜索筛选、Sitemap、Link Builder。
- 集合 Collection：多对多营销名单，驱动 `/collections/<slug>`、New/Bestseller 角标、首页区块。

两套名字重复、入口重复；3 个同名集合为空导致前台空页面。目标：一个后台、一个列表、
一套编辑、最终一套数据。

## 2. 最终决策

1. 分类并入集合（`collections` 表），后台只留一个分组入口；「分类」区块删除。
2. 商品有**主分组**（单选，决定面包屑/导航）和**其他分组**（多选，含其他分类、营销、场景）。
3. 商品编辑页最终同时管理主分组与其他分组；本轮可拆两阶段（C1 后台合并，C2 商品页多选）。
4. 营销集合（New Arrivals、Best Sellers、Small-Space Solutions、All Products）的
   成员、排序、角标、上架语义不变。
5. 分类页与集合页都保留路径；CATEGORY 型统一取货规则（4.3）。
6. 列表与编辑弹窗都展示子分类商品数；大说明框移除，保留精简帮助。

## 3. 生产现状（2026-10-23 审计）

- 分类 20 个（4 根 + 16 子），全部 ACTIVE。
- 集合 8 个：4 个与分类同名；4 个营销/系统。
- 商品 21 个全部有 `category_id`；`collection_products` 23 行（bedroom-essentials 5 行）。
- 同名集合成员：3 个为 0，bedroom-essentials 5。
- 分类 id 引用：`homepage_sections` 1 行（CATEGORY_TILES，4 根 id）、
  `homepage_documents.draft` 1 行、`homepage_versions.document` 4 行、
  `storefront_shells` 草稿/发布各 1 行（页头 CATEGORY_ROOT）。落地页/collection_sections/
  analytics 无。
- 同名**集合 id** 引用：`storefront_shells` 草稿/发布各 4 处（页脚）、
  `homepage_documents.draft` 1 处（storage-organization）。其余列为 0。
- HeroStyle：CATEGORY 4 条，COLLECTION 1 条。

## 4. 目标模型

### 4.1 单表

- `collections` 增加 `parent_id`（自关联，`ON DELETE SET NULL`）、`image_url`。
- `CollectionType` 增加 `CATEGORY`；保留 NAVIGATION/MARKETING/SCENARIO/SYSTEM。
- CATEGORY 行 HeroStyle ownerType 统一 `CATEGORY`；其他类型继续 `COLLECTION`。
- `CollectionProduct` 保留为多对多成员表。
- `Product.category_id` 保留列名，语义为「主分组」，外键改指 `collections`。

### 4.2 商品归属

- 主分组：`products.category_id`，必填、单选，决定分类归属/面包屑。
- 其他分组：`collection_products` 行，多选；同一商品在同一分组只有一行（唯一约束已存在）。
- 商品编辑页（C2）：主分组下拉（CATEGORY 树）+ 其他分组多选（可搜索）；
  保存写同一套关系；主分组对应的分组不重复计入成员。

### 4.3 页面取货

- CATEGORY 型：在售商品 =（主分组落在子树内的商品）∪（显式成员），按商品 id 去重；
  保留 room/solution/价格筛选与分页。
- 营销/场景：只取成员；排序不变。
- SYSTEM all-products：自动全部 ACTIVE，不变。
- 同一商品不会出现两次。

### 4.4 商品数口径（评审重点）

后台列表与编辑弹窗同时给出两组数字，标签写明：

- **直属**：主分组正好是本节点的商品数；营销型为成员行数。
- **含子类**：本节点子树内主分组商品 ∪ 挂在本节点或后代上的成员的**去重总数**。
- **在售**：上述集合中 `status=ACTIVE` 的数量（前台实际可展示数）。
- 管理主数字默认显示「含子类（全部状态）」；旁边小字「在售 N」。
- 展开行按每个子节点重复上述三个数字；营销分组无子节点，仅显示成员/在售。
- 计数口径写进 API 字段命名：`directCount`、`subtreeCount`、`activeCount`
  （营销为 `memberCount`、`activeCount`）。

### 4.5 编辑规则

- CATEGORY 型商品名单 = 有效列表（主分组子树 + 成员）：
  - 主分组行带「主分组」标记，不能直接移除（提示到商品表单改主分组）；
  - 成员行可移除；
  - 添加商品写成员关系，不改主分组；
  - 保存只替换成员行；排序仅作用于成员行，主分组行按商品默认顺序展示。
- 营销型：维持现有成员增删/排序。
- 父分组选择器仅 CATEGORY 型；类型创建后不可改。
- 新建统一为「新建分组」：CATEGORY / MARKETING / SCENARIO / NAVIGATION；SYSTEM 不可手工创建。
- 删除 CATEGORY：被商品用作主分组时禁止（Restrict）；子分组提升为根；
  导航/首页/链接里的引用由现有校验标为不可用，并在删除确认框列出引用数量。

## 5. 迁移与兼容（重写）

### 5.1 存活 id

同名碰撞保留**分类 id**：商品 `category_id`（21 行）、首页瓷砖、页头 CATEGORY_ROOT、
首页草稿/版本中的分类 id 全部零改动；只重指集合侧小数据（成员 23 行、集合 id 的 JSON 引用 5 处）。

### 5.2 同名合并与成员保留

对 4 个同名 slug（迁移时按 slug 现算，不写死 id）：

1. 分类行插入 collections（暂用临时 slug 规避唯一冲突），id 原样，type=CATEGORY；
2. `collection_products.collection_id` 重指到分类 id；若目标已存在同商品行，
   合并为一行（保留最小 sortOrder，isFeatured 取或），不产生重复；
3. `collection_sections` 重指；若同类型 section 冲突，保留集合侧并记录到迁移报告；
4. HeroStyle：分类已有则保留分类；集合有而分类无则迁到 CATEGORY owner；两者都有时
   保留分类、把集合样式导出到报告（不丢证据）；
5. 结构化 JSON 重写（5.4）；
6. 删除旧集合行；
7. 临时 slug 改回原值。

非同名分类直接按原 id 插入；营销/系统集合原样保留。

### 5.3 双表并存与回滚现实（评审重点）

本方案**不做双写**。双写会让分类/集合两份数据在窗口期漂移，且旧代码仍无法安全读取
合并后的集合（同名集合行被删、成员被重指、外键改指 collections）。因此：

| 阶段 | 数据库 | 运行代码 | 读 | 写 | 回滚方式 |
| --- | --- | --- | --- | --- | --- |
| 现状 | categories + collections | 旧代码 | 各读各表 | 各写各表 | — |
| 阶段 C1 切换（维护窗口） | 迁移后；categories 保留为快照 | 新代码 | 只读 collections（CATEGORY 行） | 只写 collections | **恢复迁移前 dump + 旧镜像** |
| 窗口内误跑旧代码 | 迁移后 | 旧代码 | 会读空/错（同名集合行已删） | 会写回 categories 快照，产生漂移 | 立即停服，恢复 dump |
| 阶段 D 清理 | 删除 categories | 新代码 | 同 C1 | 同 C1 | 只能恢复 dump |

明确结论：**保留 categories 表只用于审计和再次迁移，不构成旧代码回滚能力**。
唯一可靠回滚是「全库 dump 恢复 + 旧镜像」。因此 C1 必须在维护窗口执行，并提前验证：
dump 可恢复、旧镜像可启动、恢复后页面与基线一致。

### 5.4 JSON 迁移（禁止全文 UUID 替换）

用结构化迁移脚本按已知 schema 遍历，不用字符串替换：

- 读取并解析 JSON；
- 只改有明确语义的字段：
  - 首页文档/版本：`sections[].payload.categoryIds[]`、
    `sections[].payload` 内的链接对象 `{ type: 'CATEGORY'|'COLLECTION', id }`、
    导航条目里的目标 id；
  - 页头 shell：`header.items[kind=CATEGORY_ROOT].categoryId`、页脚/其他行的
    `{ type, id }` 链接对象；
- 遇到指向已删除集合 id 的**未知形态**引用：中止迁移并输出路径，不做猜测；
- 迁移前导出受影响 JSON 到证据文件；迁移后重新校验：
  - 被删除的集合 id 在所有已审计列中出现次数 = 0；
  - 分类 id 引用数量与迁移前一致；
  - 全部链接 id 均能在 collections 中找到。
- `homepage_versions` 的历史快照用同一遍历器重写（保证旧版本预览不指向死 id），
  原始版本导出留档；若某历史版本含未知引用则整体中止，交人工处理。

### 5.5 路径与 SEO

- CATEGORY 行规范 URL：`/categories/<slug>`；`/collections/<slug>` 对 CATEGORY 行
  做 **301** 到规范 URL（页脚旧链接继续可用，且不产生重复内容）。
- 营销/系统行：只保留 `/collections/<slug>`；`/categories/<slug>` 404。
- Sitemap 每个分组只输出一个规范 URL；结构化数据（面包屑 JSON-LD）用规范路径。
- 页头 `CATEGORY_ROOT`、首页分类瓷砖继续使用分类接口与 `/categories` 前缀。

### 5.6 删除分组的影响

- 主分组被商品引用 → 禁止删除（Restrict），与现有分类一致。
- 子分组：提升为根（SetNull）。
- 页头/首页/落地页/Link Builder 的引用：现有校验会标为不可用；
  删除确认框展示引用计数（页头条目、首页区块、落地页）供运营决策。
- 营销分组删除只影响成员关系与引用，不删除商品。

### 5.7 营销/系统语义

- New Arrivals / Best Sellers：成员、排序、角标逻辑与 slug 契约不变。
- All Products：自动全部 ACTIVE，不变。
- CATEGORY 行不出现在公开集合索引，也不参与角标判定。

## 6. 后端改动

- `categories.service/controller`：路由与响应形状不变（CategoryNode），实现改读写
  `collections type=CATEGORY`。
- `collections.service`：
  - 统一取货（4.3）、统一计数（4.4，含 `directCount/subtreeCount/activeCount`）；
  - admin list 支持全量分组返回 parentId/type/counts；计数可随列表返回（数据量小）
    或提供批量计数端点；
  - 创建/更新 DTO 增加 parentId（仅 CATEGORY）；类型不可改；
  - 删除保护与引用计数；
- `products.service`：关系指向 collections；分类树展开用 CATEGORY 行；
  `categoryId` 输出不变。
- `storefront-shell`：CATEGORY_ROOT/链接解析改查分组；`/collections` 对 CATEGORY 行
  由前端/路由做 301（或后端返回 canonical 标记）。
- `cms/homepage.service`、Link Builder、搜索、Sitemap：数据源改为分组，形状不变。
- 缓存：分类/分组写入触发 STOREFRONT 失效。

## 7. 后台与草稿

### 7.1 统一列表

- 顶部切换：全部分组 / 商品分类 / 营销集合（默认全部）。
- 一张表：
  - CATEGORY 行树形缩进、可展开/收起；营销、场景、系统行平铺；
  - 字段：分组名称（含层级箭头）、Slug、类型、商品数（直属 / 含子类 / 在售）、状态、排序、操作；
  - 商品数单元格可展开子分类明细；营销行显示成员/在售；
  - 操作：编辑、新建子分组（CATEGORY 行）、删除。
- 统一「新建分组」与统一编辑弹窗（复用现有 Dialog/Field/Hero/会员编辑组件）。
- 移出大段说明框；保留标题下的一行帮助 + 「?」提示（权限、计数口径、主分组规则）。

### 7.2 编辑弹窗

- 基本信息（名称/Slug/状态/排序/描述/SEO）、类型（只读）、父分组（CATEGORY）、页面横幅；
- 商品名单：有效列表、主分组标记、成员增删、搜索添加、子分类统计块；
- 保存一次提交（基本信息 + Hero + 成员变化），CATEGORY 不改商品主分组。

### 7.3 视觉

沿用现有 `PageHeader`、`Table`、`Dialog`、`Field`、`Badge`、`Button` 与 LUWAG Admin 样式；
不引入新颜色/字体/布局体系。

### 7.4 本地可点击草稿（阶段 A 已交付）

- 路由：`/admin/groupings-v2`（仅本地开发，页面标注「本地草稿演示 · 不写数据库」）。
- 代码：
  - `frontend/src/app/admin/(shell)/groupings-v2/page.tsx` — 草稿入口；
  - `frontend/src/components/admin/UnifiedGroupsDraft.tsx` — 列表/树/编辑弹窗/商品归属交互；
  - `frontend/src/lib/admin-grouping-model.ts` — 同名合并、树构建、计数口径（纯函数）；
  - 两份 `.spec.ts(x)` — 单测覆盖合并、计数去重、标签过滤、编辑弹窗主分组/成员。
- 数据：现有 `listCategories` / `listCollections` / `listProducts`（含 categoryId、status）
  + 公开 `getCollectionProducts` 逐集合取成员 id；不改任何现有接口。
- 已覆盖交互：三标签切换、树展开/收起、直属/成员/含子类/在售计数、子分类统计块、
  统一编辑弹窗（主分组只读标记 + 成员可移除 + 搜索添加）、新建子分组继承父级、
  商品归属交互稿（单主分组 + 其他多选）。
- 演示限制：保存只改本次会话内存并提示「演示模式」；All Products 为运行时聚合，
  本地数据里不存在该集合，故草稿不列该行；成员数来自公开在售接口。
- 本地验收（2026-10-23）：13 个商品、Storage & Organization 显示「含子类 6 · 在售 6 /
  直属 1 · 成员 0」，展开后 24 行；Chairs & Stools 弹窗显示 7 个主分组标记；
  控制台 0 错误；`vitest` 6/6、`tsc --noEmit` 与 `eslint` 均通过。
- 截图：`.snapshots/unified-groups-draft-list.png`、`unified-groups-draft-editor.png`、
  `unified-groups-assignment-draft.png`（保存在 homepage-builder 工作树的 `.snapshots/`）。
- **不保存任何更改**，不修改生产数据；正式接线在阶段 C。

## 8. 前台行为

- CATEGORY 行：`/categories/<slug>` 与 `/collections/<slug>` 取货一致；后者 301。
- 营销行：`/collections/<slug>` 不变；角标与成员规则不变。
- 面包屑、导航、瓷砖、Sitemap、JSON-LD 使用规范路径。
- bedroom-essentials 的 5 个成员与主分组商品统一展示，空页面消失。

## 9. API 兼容

- 公开/后台分类接口路径与 CategoryNode 形状不变；
- collections admin 响应追加 parentId/type/counts；旧字段保留；
- `Product.categoryId` 名称不变；
- 新字段为追加，前端渐进接入。

## 10. 阶段计划

- **阶段 A（本次授权）**：本地统一后台草稿（列表/树/计数/编辑弹窗/商品归属交互稿），
  不改生产数据库；补充设计稿与回归清单。
- **阶段 B（待授权）**：把生产备份恢复到隔离库，执行迁移脚本 + 新后端，跑兼容矩阵与
  回归清单；演练恢复流程并记录耗时/证据。
- **阶段 C（待授权，维护窗口）**：C1 数据迁移 + 后端切换 + 后台统一页上线；
  C2 商品编辑页「主分组 + 其他分组」多选接线（可作为独立小批次）。
- **阶段 D（待再次授权）**：观察 ≥1 周，验证无回归后删除 categories 表与死代码。

## 11. 阶段 B 演练计划

1. 生产 `pg_dump`（custom）→ 恢复到隔离库 `small_house_groups_rehearsal`；
2. 在副本上跑 Prisma 迁移 + 结构化 JSON 迁移 + 校验 SQL；
3. 校验：
   - 20 个分类 id 全部存在于 collections；
   - 商品 `category_id` 无孤儿；外键指向 collections；
   - 已删除集合 id 在审计列中出现 0 次；分类 id 引用数量不变；
   - 4 组同名合并后成员总数 = 迁移前两侧之和（去重后），bedroom 5 个成员保留；
   - 分类页与集合页产品 id 集合一致（CATEGORY 行）；
   - 页头/首页/瓷砖/页脚链接解析成功；
4. 启动新后端+前端连接副本，跑第 12 节回归清单；
5. 演练恢复：关闭新服务 → 用 dump 重建副本 → 旧镜像启动 → 核对基线；
6. 输出演练报告（耗时、失败点、修正项），作为阶段 C 的放行依据。

## 12. 回归清单（阶段 B/C 必跑）

- 首页：全部区块渲染；CATEGORY_TILES 链接与图片；SOLUTIONS 链接；公告/Hero 链接。
- Header/Footer：CATEGORY_ROOT 下拉、收藏夹/购物车等导航项、页脚链接与 301。
- 分类页：产品集合、数量、面包屑、筛选、分页、Hero、SEO/JSON-LD。
- 集合页：营销成员、排序、角标；All Products 自动全集；CATEGORY 行 301。
- 商品：PDP 图集、SKU 变体、价格、库存、FAQ、评论、相关商品。
- 营销：New Arrivals / Best Sellers 角标来源与成员、首页推送区块。
- 后台：统一列表/编辑器、计数展开、商品表单主分组、Link Builder、首页编辑器。
- SEO：Sitemap 唯一 URL、canonical/301、robots、结构化数据。
- 非分组链路：结账、订单、库存、订阅、搜索、埋点。

## 13. 验收标准

- 一张列表、一个编辑器、无分类区块；树形展开与三种计数清晰。
- 商品主分组/其他分组正确、无重复行；营销角标与 All Products 无回归。
- `/categories` 与 `/collections` 规范 URL/301 正确，分类页产品集合一致。
- 迁移演练通过，恢复流程验证，阶段 C 放行前有书面证据。

## 14. 非目标（本阶段）

- 不在阶段 A 改生产数据库、外键、分组数据或首页内容。
- 不在阶段 A 完成商品编辑页多选接线（C2）。
- 不做分组类型互转、视觉改版、集合 CMS 区块重设计。
- 不引入运行时 id 别名表：所有已知引用结构化重写并校验；未知引用直接中止迁移。
