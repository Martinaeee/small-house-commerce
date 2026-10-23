# 统一商品分组：分类并入集合 — 设计稿

- 日期：2026-10-23
- 状态：待评审（评审通过后才进入实施计划）
- 影响环境：生产 `smallhouse-prod`、本地/验证库
- 目标发布方式：分批迁移，先兼容、后合并、最后删表

## 1. 背景

后台「商品分组」页现在有两套并行实体：

- **分类（Category）**：商品唯一归属、带层级（父/子），驱动 `/categories/<slug>`、页头
  `CATEGORY_ROOT` 下拉、首页分类瓷砖、面包屑、搜索筛选、Sitemap、Link Builder。
- **集合（Collection）**：多对多营销名单，驱动 `/collections/<slug>`、New/Bestseller 角标、
  首页区块与活动页。

两者名字重复（Storage & Organization 等 4 个 slug 同时存在），后台两个列表、两套编辑；
其中 3 个同名集合成员为 0，而同名分类有商品，导致前台有空集合页。用户希望**合并成一个
实体、一个后台入口，并删除分类这块冗余内容**。

## 2. 已确认的决策

1. 分类并入集合，只保留一套数据、一个后台列表；现有「分类」区块删除。
2. 商品**可属于多个分组**，同时保留一个**主分组**（决定面包屑/导航归属）。
3. 集合编辑弹窗结构不变，增加：父分组选择（分类行）、各子分类商品数量统计。
4. 列表页与编辑弹窗**两处**都显示子分类商品数量（列表可展开）。
5. 营销集合（New Arrivals、Best Sellers、Small-Space Solutions、All Products）语义与角标行为不变。
6. 分类页 `/categories/<slug>` 与集合页 `/collections/<slug>` 都保留，统一读同一张表。

## 3. 生产现状（2026-10-23 审计）

- 分类 20 个：4 个根 + 16 个子分类，全部 ACTIVE。
- 集合 8 个：4 个与分类同名（storage-organization、tables-desks、chairs-stools、
  bedroom-essentials），4 个纯营销/系统（new-arrivals、best-sellers、small-space-solutions、
  all-products）。
- 商品 21 个，全部有 `category_id`；`collection_products` 共 23 行（其中 bedroom-essentials 5 行）。
- 同名集合的成员数：3 个为 0，bedroom-essentials 为 5。
- 分类 id 的 JSON 引用：
  - `homepage_sections` 1 行（CATEGORY_TILES 的 `categoryIds`，4 个根 id）。
  - `homepage_documents.draft` 1 行、`homepage_versions.document` 4 行。
  - `storefront_shells` 草稿与已发布各 1 行（页头 `CATEGORY_ROOT.categoryId`）。
  - 落地页、collection_sections、analytics 均无。
- 同名集合 id 的 JSON 引用：
  - `storefront_shells` 草稿/已发布各 4 处（页脚链接实体）。
  - `homepage_documents.draft` 1 处（storage-organization）。
  - 其余列（homepage_sections、versions、collection_sections、analytics）为 0。
- Hero 样式：CATEGORY 4 条（4 个根），COLLECTION 1 条。

## 4. 目标模型

### 4.1 单表

沿用 `collections` 表作为唯一分组表（表名不改，避免大面积重命名）：

- 新增 `parent_id`（自关联，`ON DELETE SET NULL`）与索引，形成层级。
- `CollectionType` 增加 `CATEGORY`（已有 NAVIGATION/MARKETING/SCENARIO/SYSTEM 保留）。
- `Collection` 增加 `image_url`（承接原分类缩略图；`hero_image` 继续作页面横幅）。
- CATEGORY 类型行的 HeroStyle `ownerType` 统一为 `CATEGORY`；其余类型继续用 `COLLECTION`。
- `CollectionProduct` 不变（多对多成员）。
- `Product.category_id` 保留列名与语义「主分组」，外键改指 `collections`。

### 4.2 商品归属

- 主分组：`products.category_id`，单选、必填，决定商品表单归属、面包屑、分类归属。
- 额外归属：`collection_products` 行，可多选；在分组编辑器的商品名单里维护。
- 产品表单本批不改多选（额外归属继续在分组编辑器维护），只把字段标签改为「主分组」。

### 4.3 页面取货规则

- **CATEGORY 型分组**（分类页与集合页一致）：
  在售商品 = （主分组落在该分组子树内的商品）∪（显式加入该分组的成员），去重；
  仍支持 room/solution/价格筛选与分页。
- **MARKETING / SCENARIO / NAVIGATION 型**：只取 `collection_products` 成员，行为不变。
- **SYSTEM all-products**：保持现有自动取全部 ACTIVE 的规则。
- 一边为主分组、一边为成员的同一商品只出现一次。

### 4.4 计数规则（后台）

- CATEGORY 型「商品数」= 上述并集（含非 ACTIVE；与现有集合计数口径一致）。
- 子分类明细：每个节点显示「主分组落在该节点子树内的商品数 ∪ 附加在该节点子树上的成员数」，
  去重；节点自身与其后代各自成行。
- 营销型「商品数」= 成员行数（现状）。

### 4.5 编辑规则

- CATEGORY 型分组的商品名单：
  - 主分组来源的商品显示「主分组」标记，**不能直接移除**（提示到商品表单改主分组）；
  - 成员来源的商品可移除；
  - 「添加商品」写成员关系（不改变商品主分组）；
  - 保存只替换成员行，不改任何商品的主分组；主分组行按商品默认顺序展示，排序仅作用于成员行。
- 营销型分组：维持现有成员增删与排序。
- 父分组选择器仅对 CATEGORY 型显示；类型创建后不可改。
- 删除 CATEGORY 分组时，子分组提升为根（与现有分类删除一致）；被商品用作主分组时禁止删除。
- 新建入口：统一为「新建分组」，类型可选 CATEGORY / MARKETING / SCENARIO / NAVIGATION；
  SYSTEM 不可手工创建（all-products 专用）。

## 5. 迁移设计

### 5.1 存活 id

同名碰撞时保留**分类 id**作为存活 id：

- `products.category_id`（21 行）零改动；
- 页头 `CATEGORY_ROOT`、首页 `CATEGORY_TILES`、首页草稿/版本（分类 id）零改动；
- 只需重指集合侧的小数据：成员行（约 23 行）、HeroStyle（若有）、集合 id 的 JSON 引用
  （页脚 4 处、首页草稿 1 处）。

### 5.2 同名映射（迁移脚本按 slug 现算，不写死 id）

对 4 个同名 slug（storage-organization、tables-desks、chairs-stools、bedroom-essentials）：

1. 先把分类行插入 `collections`（暂用 `slug || '__cat_migrating'`，避免唯一冲突），
   类型 CATEGORY，`parent_id` 指向分类 id（保留原 id），`image_url = categories.image_url`；
2. 把旧集合行的 `collection_products`、`collection_sections` 的 `collection_id` 重指到分类 id；
3. 若旧集合行有 HeroStyle 而分类没有，迁到 CATEGORY owner；
4. 重写 JSON 中出现的旧集合 id → 分类 id（见 5.4）；
5. 删除旧集合行；
6. 把新行的 slug 改回原值。

非同名分类：直接按原 id 插入 CATEGORY 行（父 id 原样，父子顺序无影响）。
纯营销/系统集合：原样保留。

### 5.3 Schema 与外键切换

1. 单独一个迁移先加枚举值 `CATEGORY`（避免同事务内使用新枚举值）。
2. 加列：`collections.parent_id`、`collections.image_url`，建索引。
3. 数据迁移（5.2），验证 20 个分类 id 全部存在于 collections。
4. `products` 删除指向 `categories` 的外键，新增指向 `collections(id)` 的外键（Restrict）。
5. 删除 `categories` 表：**批次 4 才执行**（见第 10 节），批次 1–3 保留作为回滚保险。
6. 更新 Prisma schema 并 `prisma generate`；所有引用 `category` 关系的服务改指向 Collection。

### 5.4 JSON 引用重写

迁移脚本对以下列做文本级 UUID 替换（UUID 全局唯一，文本替换安全）：

- `storefront_shells.draft_document`、`storefront_shells.published_document`：4 个旧集合 id → 分类 id；
- `homepage_documents.draft`：storage-organization 旧集合 id → 分类 id。

迁移后验证：上述列中不再出现任何被删除的集合 id；分类 id 的引用保持原样。
`homepage_versions` 不重写（只含分类 id，仍有效）。

### 5.5 回滚

- 迁移前：`pg_dump` 全库 + 前后端镜像 rollback tag。
- 删除 `categories` 表前（观察期）：代码回滚 = 恢复 dump + 旧镜像；旧集合行已在迁移中删除，
  不能只回滚镜像，必须在文档与发布脚本中写明。
- 删除 `categories` 表后：回滚只能依赖 dump。

## 6. 后端改动

- `categories.service/controller`：保留路由与响应形状（`CategoryNode`：
  id/parentId/name/slug/sortOrder/imageUrl/status/heroStyle/children），实现改为读写
  `collections` 中 `type=CATEGORY` 的行。
- `collections.service`：
  - `storefrontProducts` 按 4.3 规则取货；`storefrontGetBySlug` 支持 CATEGORY 行；
  - admin list 返回 `parentId`、`type=CATEGORY`、有效计数；新增子分类计数接口（或列表内展开时拉取）；
  - 创建/更新 DTO 增加 `parentId`（仅 CATEGORY）；`type` 创建后不可改；
  - 删除保护：作为主分组被商品引用时禁止删除（沿用 Restrict 语义）。
- `products.service`：`category` 关系改指 collections；`expandCategoryIds` 的输入改为
  `type=CATEGORY` 的行；商品 JSON 的 `categoryId` 不变。
- `storefront-shell`：`CATEGORY_ROOT` 解析与校验改查 CATEGORY 型根分组；链接实体
  `CATEGORY` / `COLLECTION` 都按分组解析。
- `cms/homepage.service`：CATEGORY_TILES、链接解析改查分组；分类前缀仍为 `/categories`。
- Link Builder / 搜索筛选 / Sitemap：数据源改为分组，返回形状不变。
- 公开集合索引 `/api/v1/storefront/collections` 排除 `type=CATEGORY` 行，保持现有索引页内容；
  分类分组只通过 `/categories` 与直接页面访问。
- Sitemap 每个分组只输出一个规范 URL：CATEGORY → `/categories/<slug>`，其余 → `/collections/<slug>`。
- 缓存失效：分类写入同样触发 `CACHE_TAGS.STOREFRONT`。

## 7. 后台 UI

- `/admin/groupings` 只保留一个列表：
  - CATEGORY 行按树展示（缩进/展开），营销集合平铺；
  - 列：名称、Slug、类型、状态、商品数、排序、操作；
  - 商品数列可展开，显示各子分类商品数；右侧显示合计。
- 分类编辑并入集合编辑弹窗（同一组件）：
  - 基本信息 + 类型（只读）+ 父分组（仅 CATEGORY）；
  - 页面横幅（Hero）沿用；
  - 商品名单：有效列表（主分组标记/成员行）、添加商品、子分类统计块；
  - 保存仍为一次提交：基本信息 + Hero + 成员变化。
- 删除 `CategoriesPanel` 与分类区块；`/admin/categories` 301 到 `/admin/groupings`。
- 商品表单：「分类」标签改为「主分组」，选项来自 CATEGORY 型分组树，提交字段仍是 `categoryId`。
- 首页分类瓷砖、页头导航、Link Builder 的分类选择器继续调用分类接口（数据源已切换）。

## 8. 前台行为

- `/categories/<slug>` 与 `/collections/<slug>` 命中同一行：
  - CATEGORY 型：同一取货规则（4.3），两页产品集合一致；
  - 营销型：只保留 `/collections/<slug>` 语义（成员）。
- 导航 `CATEGORY_ROOT`、面包屑、首页瓷砖、Sitemap 不变（id 与 API 形状保持）。
- 同名集合页不再出现「空页面」；bedroom-essentials 的 5 个成员会与主分组商品一起展示。

## 9. 兼容策略

- 不改公开 URL、不改 `Product.categoryId` 字段名、不改 CategoryNode 形状；
- 新增字段（parentId、type=CATEGORY、计数明细）均为追加；
- 发布顺序保证旧代码不读新语义：先迁移数据与后端，再改后台 UI，最后删表。

## 10. 分批上线计划

1. **批次 0（准备）**：设计评审 → 实施计划 → 生产 dump 恢复到验证库，演练迁移与回滚。
2. **批次 1（兼容层）**：枚举/列 + 数据迁移 + 外键切换；分类接口改读分组；分类表保留。
   验证：分类/集合页、导航、瓷砖、Link Builder、商品表单、Sitemap 全部正常。
3. **批次 2（后台合并）**：统一列表/编辑器、子分类计数、商品表单标签；移除分类区块。
4. **批次 3（前台入口收敛）**：页脚/首页等仍指向 `/collections/<slug>` 的入口按统一取货规则
   核对，确认与 `/categories/<slug>` 产品集合一致且无空页面；全站链接与 Sitemap 抽查。
5. **批次 4（清理）**：观察期（建议 ≥1 周）后删除 `categories` 表与死代码。

每批独立发布、独立回滚点；批次 1 之前必须完成演练。

## 11. 测试

- 迁移：fixture 覆盖同名碰撞、父子关系、成员重指、JSON 重写、外键切换；迁移后校验
  「无孤儿 category_id、无残留旧集合 id、20 个分类全部存在」；在恢复的生产 dump 副本上演练。
- 后端单测/集成：分类接口（CRUD/树）、集合取货并集去重、计数、筛选分页、shell 目标校验、
  首页瓷砖解析、商品表单保存。
- 前端：统一列表树/展开计数/编辑弹窗（主分组标记、添加移除、统计块）、商品表单、导航、
  分类/集合页面一致性。
- 发布后：HTTP 页面产品数、导航链接、后台计数、Sitemap 与 Link Builder 抽查。

## 12. 验收标准

- 后台只有一个分组列表，无「分类」区块；CATEGORY 型分组能看到商品数与各子分类明细，
  营销型分组照旧显示成员数。
- 商品可属于多个分组，且主分组可在商品表单设置；面包屑正确。
- `/categories/<slug>` 与 `/collections/<slug>`（CATEGORY 型）产品集合一致且非空（有货时）。
- New Arrivals / Best Sellers 角标、All Products、首页瓷砖、页头导航、Link Builder、Sitemap 无回归。
- 生产迁移可重复演练，回滚步骤有书面记录并验证过。

## 13. 非目标（本批不做）

- 商品表单的多分组多选（额外归属仍在分组编辑器维护）。
- 分组类型的互转。
- 新增「来源分组自动同步」字段：合并后分类组自身即「主分组自动 + 成员手动」，
  营销组仍为手选；如以后需要「营销组自动引用某分类」，再单独设计。
- 集合页 CMS sections / Hero 的视觉改版。

## 14. 主要风险

| 风险 | 缓解 |
| --- | --- |
| 迁移删错数据 | 先 dump、验证库演练、迁移脚本幂等校验、分阶段发布 |
| JSON 里残留旧 id | 专项校验查询 + 页面/导航/瓷砖回归 |
| 旧代码回滚需要分类表 | 观察期内不删表；批次 4 才删 |
| 语义混淆（主分组 vs 成员） | UI 明确标记；取货规则写进测试 |
| 分类页/集合页数量不一致 | 同一取货函数，集成测试比对两页产品 id 集合 |
