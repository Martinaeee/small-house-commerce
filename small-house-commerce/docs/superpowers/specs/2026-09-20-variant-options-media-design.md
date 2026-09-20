# 商品多维选项、变体素材与购买确认设计

日期：2026-09-20
状态：待用户审阅
范围：商品数据模型、后台商品编辑器、Storefront PDP/PLP/Quick Add、购物车与 Checkout、广告深链与追踪

## 1. 背景与现状

当前商品模型把“变体”表示为扁平的 `ProductVariant.name`：每条变体最多对应一个 SKU，但系统不知道名称代表颜色、尺寸、材质还是其他属性。

现状能力：

- 一个商品可以有多条变体；
- 每条变体可以有独立 SKU、价格、划线价、库存和物流字段；
- PDP 选择变体后会更新 SKU、价格、库存、CTA 和 `?variant=<variantId>`；
- 购物车与订单通过 SKU/variant 保存和展示款式。

现状缺口：

- 没有 Color、Size 等选项组；
- 没有 Color × Size 组合模型；
- `ProductImage` 只属于 Product，不能属于选项值或精确 SKU 组合；
- PDP 图集不随变体变化；
- PDP 变体按钮只有文字；
- Quick Add 的缩略图依赖“第 N 个变体映射第 N 张商品图”的临时位置约定，图片调序后可能错配；
- PDP 默认选中第一条可售变体，用户可能在未确认颜色/尺寸时直接加购或结账；
- `ViewContent` 使用 Product ID，而 `AddToCart` 使用 SKU ID，不利于未来的 Meta Catalog 变体级匹配。

本设计替换这些临时约定，但保留现有 SKU、库存和历史订单链路。

## 2. 已确认产品决策

1. 每个商品最多配置两组选项。
2. 支持的选项类型包括 Color/Finish、Size、Material、Style；后台显示名称可自定义。
3. Color、Size 等任意选项组均可选择图片缩略图、纯色色块或文字按钮展示。
4. 选项组合生成可售 ProductVariant，每个组合继续对应独立 SKU。
5. 素材采用分层回退：精确组合套图 → 主视觉选项值套图 → 商品公共图集。
6. 每个商品最多一个“主视觉选项组”；通常是 Color/Finish。Size 也可成为主视觉选项，或只使用缩略图。
7. 多 SKU 商品不把第一条 SKU 当作用户购买选择。
8. 普通页面可展示运营指定的默认素材，但购买前必须完成真实选项选择。
9. 广告/分享深链可以预选并展示精确变体，但第一次购买动作仍需用户确认。
10. 只有一个可售 SKU 的商品保留直接加购和直接结账。

## 3. 目标

### 3.1 顾客目标

- 明确看到 Color、Size 等不同选项组；
- 点击 Yellow 后，主图、缩略图、Lightbox 和视频切换为黄色套图；
- 尺寸可以按商品需要显示图片缩略图；
- 只有完成所有必选项后才能购买；
- 不存在的组合不会被静默替换；
- 购物车与 Checkout 清楚展示最终颜色、尺寸、缩略图、价格和库存；
- 广告创意与落地页首屏素材一致，但不会因为深链预选而误买。

### 3.2 运营目标

- 后台按选项组和选项值录入，不再手写含义不明的扁平名称；
- 自动生成实际销售的 SKU 组合，并提供批量价格、库存、状态操作；
- 为颜色、尺寸等选项值配置缩略图；
- 为主视觉选项值配置整套图；
- 仅在确有需要时，为精确组合配置覆盖套图；
- 一键复制精确变体落地链接用于 Meta、Messenger、TikTok、KOL 和落地页；
- 广告事件、商品目录和订单统一使用 SKU ID。

### 3.3 工程目标

- 保留现有 ProductVariant ID、SKU ID、库存流水、预留和历史订单引用；
- 迁移现有扁平变体时不删重建；
- 所有组合对账在事务内完成；
- 现有商品迁移后保持原有前台可售行为；
- 商品媒体绑定有明确回退和校验规则；
- 不把选项 UI、SKU 解析或图片映射分散成互相不一致的临时逻辑。

## 4. 非目标

本期不做：

- 超过两组选项；
- 套餐、加价配件或自定义刻字；
- AI 自动识别颜色或自动生成变体素材；
- 为每个颜色创建独立可索引商品页；
- 强制每个组合上传重复套图；
- 自动转码视频；
- 用选项系统替代现有类目、规格参数或 Shipping 字段；
- 修改历史订单快照。

## 5. 领域模型

### 5.1 ProductOption

表示一个商品的选项组。

建议字段：

```text
id
productId
kind                COLOR | SIZE | MATERIAL | STYLE
name                前台标签，如 Color、Finish、Size
position            选项组顺序，只允许 0 或 1
presentation        IMAGE | SWATCH | TEXT
isMediaDriver       是否为主视觉选项；同一商品最多一组为 true
isActive
createdAt / updatedAt
```

约束：

- 每个商品最多两组 active options；
- `productId + name` 唯一；
- 每个商品最多一个 `isMediaDriver=true`；
- 选项组位置唯一；
- 有历史 SKU 关联时不得物理删除，只能停用或迁移。

### 5.2 ProductOptionValue

表示选项组中的一个值，例如 Yellow、Red、80 cm、120 cm。

建议字段：

```text
id
optionId
label               前台显示文字
position
swatchHex           presentation=SWATCH 时可用
thumbnailUrl        可选；IMAGE 展示的显式覆盖图
thumbnailAlt        可选；空时回退 label
isActive
createdAt / updatedAt
```

有效缩略图解析：

1. `thumbnailUrl`；
2. 该值主视觉套图的第一张 IMAGE；
3. 商品公共图第一张 IMAGE；
4. 文字占位。

即使使用缩略图，前台也始终显示 `label`，不能只靠图片传达颜色或尺寸。

### 5.3 ProductVariantOptionValue

连接一个可售组合与其选项值。

```text
variantId
optionValueId
```

约束：

- 一个 variant 对每个 active option 恰好一个 value；
- value 必须属于同一个 product；
- 同一 variant 不得出现同一 option 的两个 value；
- 同一 product 不得出现两条选项值集合完全相同的 variant。

### 5.4 ProductVariant

保留现有 ProductVariant 和一对一 SKU 关系，不更换现有主键。

新增内部 `combinationKey`：由 option value IDs 按 option position 排序后生成，用于唯一性和稳定对账。`name` 不再由运营自由输入，而由选项值按 option position 自动生成：

```text
Yellow / 120 cm
```

保留 `name` 的原因：

- 现有购物车和库存界面仍依赖它；
- 订单创建时继续保存 `variantSnapshot`；
- 迁移可保持兼容，不需要一次重写所有消费方；
- 选项值改名时可更新当前 variant name，历史订单快照不变。

### 5.5 ProductImage 媒体归属

在现有 ProductImage 上增加两个可空作用域：

```text
optionValueId       主视觉选项值套图
variantId           精确组合覆盖套图
```

作用域规则：

- 两者都为空：商品公共图集；
- 仅 `optionValueId`：该主视觉选项值的套图；
- 仅 `variantId`：该精确组合的覆盖套图；
- 两者不能同时存在；
- option value 必须属于该 product 的 `isMediaDriver` 选项组；
- variant 必须属于该 product；
- IMAGE 和 VIDEO 都遵守相同作用域；
- sortOrder 在各自作用域内排序。

后端必须在事务内校验归属，数据库增加“最多一个作用域”的 CHECK 约束。

### 5.6 Product 默认展示变体

Product 增加可空 `defaultDisplayVariantId`。

它只决定：

- 商品卡默认素材；
- PDP 普通进入时的默认展示素材；
- 无精确深链时 ViewContent 对应的展示 SKU；
- 后台预览默认状态。

它绝不代表用户已完成购买选择。

## 6. 媒体解析规则

给定已解析的精确 variant，图集按以下顺序选择第一个非空集合：

1. `variantId = selectedVariant.id` 的精确组合套图；
2. 该 variant 在 `isMediaDriver` option 下所选 value 的套图；
3. 两个作用域均为空的商品公共图集；
4. 无图占位。

集合是替换关系，不自动拼接。这样 Yellow 套图不会混入 Red 公共素材。运营若希望多个套图共享某张安装图，应使用后台“复制到选定套图”，而不是在前台合并不确定的公共内容。

当组合尚未完整选择时：

- 已选择主视觉 value：显示该 value 套图；
- 未选择主视觉 value：显示 `defaultDisplayVariantId` 的有效套图；
- 无默认展示变体：显示公共图集。

切换有效素材集合后：

- 主图和缩略图索引重置为 0；
- Lightbox 若已打开则关闭，避免索引指向旧套图；
- 仅加载当前套图资源；
- 非当前视频不预加载，当前视频保持 `preload=metadata`。

## 7. 后台商品编辑器

### 7.1 Options & Variants

原 `Variants & Pricing` 改为两个区域。

#### Options

操作流程：

1. Add option；
2. 选择 kind；
3. 填写前台名称；
4. 选择 IMAGE、SWATCH 或 TEXT；
5. 添加 option values；
6. 可拖动排序；
7. 可指定该组为 Gallery follows this option。

选项值字段：

- label；
- thumbnail upload/select；
- swatchHex；
- position；
- active/disabled。

当 presentation=IMAGE 时，没有缩略图的 active value 显示明显警告；保存允许文字回退，发布 ACTIVE 前是否阻断取决于 §13 校验。

#### Variant matrix

两组选项自动形成矩阵，但只创建运营勾选的实际销售组合。

```text
Color    Size      Enabled   SKU          Price    Stock    Status
Yellow   80 cm     ✓         TB-YL-80      1299     12       ACTIVE
Yellow   120 cm    ✓         TB-YL-120     1599     8        ACTIVE
Red      80 cm     ✓         TB-RD-80      1299     5        ACTIVE
Red      120 cm    —         —             —        —        —
```

必须提供：

- 批量设置 price；
- 批量设置 compareAtPrice；
- 批量启用/停用；
- 批量设置库存；
- 按行编辑 SKU 和物流字段；
- 显示已有订单/库存历史导致的删除限制；
- Copy storefront link；
- Set as default display。

改变 option values 后，矩阵通过稳定 IDs 和 combinationKey 对账：

- 未变化的组合保留 variant/SKU ID；
- 新组合创建新 variant/SKU；
- 被取消但已有历史的组合改为 SKU DISABLED；
- 无历史的新组合可以物理删除；
- 禁止 deleteMany + recreate。

### 7.2 Media

Media tab 分为：

1. Shared media；
2. 主视觉 option values，例如 Yellow、Red；
3. Advanced combination overrides。

每个区块支持：

- 上传图片/视频；
- URL 输入；
- 拖动或上下移动排序；
- 设为套图第一张；
- 将图片设为 option thumbnail；
- 从其他套图复制媒体引用；
- 预览桌面和移动端最终图集；
- 显示该套图会作用于哪些 SKU。

精确组合覆盖放在 Advanced 中，默认折叠。只有颜色和尺寸同时显著改变外观时才使用，避免为所有组合重复维护素材。

### 7.3 保存原子性

后台仍提供一次 Save，但 payload 中的新增实体使用稳定 ID 或客户端临时 key。后端在一个事务中：

1. 对账 option groups；
2. 对账 option values；
3. 解析临时 key；
4. 对账 variants 和 SKUs；
5. 更新库存；
6. 对账媒体作用域和顺序；
7. 更新 defaultDisplayVariantId；
8. 提交后触发 storefront revalidation。

任何一步失败，整次商品结构更新回滚。库存若继续通过独立 ledger API 写入，则商品结构先提交、库存失败时必须沿用现有“商品已保存但库存失败”的明确提示和服务器重读；实施计划阶段应评估是否将库存绝对值写入纳入同一服务事务。

## 8. Storefront 选择状态机

### 8.1 状态分离

前端不得只维护一个 `selectedVariantId`。需要至少区分：

```text
displayVariantId       当前页面展示素材/价格参考的 variant
selectedValueIds       用户或深链当前填入的 option values
touchedOptionIds       用户本次亲自操作过的 option groups
resolvedVariantId      完整组合对应的 variant；不完整/不存在则 null
confirmedVariantId     已允许执行购买动作的 variant；否则 null
selectionSource        DEFAULT | DEEP_LINK | USER | CONFIRM_DIALOG
```

`displayVariantId` 与 `confirmedVariantId` 永远不能互相推导。

### 8.2 普通 PDP 初始状态

多 SKU 商品：

- 使用 defaultDisplayVariant 展示素材；
- option buttons 不标记为用户已选择；
- selectedValueIds 为空；
- confirmedVariantId 为空；
- 价格显示 `From ₱X` 或 `₱X–₱Y`；
- CTA 显示 `CHOOSE OPTIONS`。

一个可售 SKU 的商品：

- 自动解析并允许直接加购/结账；
- 不显示无意义的选择步骤。

### 8.3 用户手动选择

- 每次点击记录对应 option 为 touched；
- 组合不完整：提示缺少的选项；
- 组合不存在：不自动替换其他 value；
- 改变某个 value 后，若另一个已选 value 与其无任何有效组合，清除不再有效的 value并提示重新选择；
- 组合完整且两个 option 都由用户本次明确操作：confirmedVariantId 可设为 resolvedVariantId；
- 任一 value 再次变化，旧确认立即失效。

### 8.4 广告/分享深链

有效 `?variant=<id>`：

- 回填该 variant 的全部 option values；
- 展示对应套图、价格、库存；
- URL 与当前 display variant 保持同步；
- selectionSource=DEEP_LINK；
- touchedOptionIds 为空；
- confirmedVariantId 为空。

第一次 Add to Cart 或 Order Now：打开预填确认面板。顾客点击 Confirm 后，设置 confirmedVariantId，并在同一动作中完成加购或跳转 Checkout。

无效 `?variant=`：移除无效参数，回到普通初始状态，不选择第一条 SKU。

### 8.5 购买动作守卫

统一术语：

- `selectableVariant`：存在 SKU、SKU status=ACTIVE 且 price 非空；即使 availableInventory=0 仍属于 selectable，因为顾客可以查看其素材和售罄状态；
- `purchasableVariant`：selectable 且 availableInventory>0；
- SKU DISABLED、无价格或无 SKU 的组合不属于 selectable。

所有入口共用同一判断：

```text
selectable 数量 = 0               → View Details / Unavailable
selectable 数量 = 1 且有库存       → 可直接执行
selectable 数量 = 1 且售罄         → 展示 Out of Stock，不发购买请求
selectable 数量 > 1，且 confirmedVariantId 匹配 resolvedVariantId，
同时 resolved variant 有库存       → 执行
其他                               → 打开/聚焦选项选择器，不调用购物车或订单接口
```

后端仍只信任最终 SKU ID，并重新验证 SKU ACTIVE、商品 ACTIVE、库存和价格；前端确认不是安全边界。

## 9. 前台组件体验

### 9.1 PDP 选项区

每组选项显示：

- option name；
- 当前 label 或 `Choose <name>`；
- IMAGE/SWATCH/TEXT 对应控件；
- thumbnail、label、选中态、禁用态、售罄态；
- 缺少选项时的字段级提示。

IMAGE 按钮必须同时显示文字。SWATCH 必须有可访问名称。TEXT 使用尺寸按钮。

### 9.2 CTA

桌面与移动端统一：

- 未完成：`CHOOSE OPTIONS`；
- 深链预选未确认：点击打开 `Confirm your options`；
- 已由用户完成：`ADD TO CART` / `ORDER NOW`；
- 售罄：`OUT OF STOCK`，允许继续浏览素材；
- 无效组合：`UNAVAILABLE`，提示更换选项。

移动端 sticky CTA 打开 Bottom Sheet，展示完整选项、当前缩略图、价格、库存和最终动作。

### 9.3 Quick Add 与商品卡

- 移除位置索引图片映射；
- 商品卡使用 defaultDisplayVariant 的有效缩略图；
- 一个可售 SKU：维持直接加购；
- 多个可售 SKU：打开 picker，初始没有购买确认；
- picker 使用相同 option resolver、缩略图、组合可用性和购买守卫；
- Confirm 成功后才发 AddToCart 事件并切换购物车视图。

### 9.4 购物车与 Checkout

每条购物车行显示：

```text
Color: Yellow
Size: 120 cm
SKU: TABLE-YL-120
```

图片使用最终 variant 的有效媒体首图或有效 option thumbnail。

提供 `Change options`：

- 打开相同选择器；
- 默认填入当前选项，但要求 Confirm；
- 确认后原子替换 cart item 的 SKU；
- 若目标 SKU 已在购物车，按购物车既有规则合并数量；
- 重新校验价格和库存；
- 不可用时保留原行并显示错误。

Checkout 确认页再次显示 option labels、缩略图、SKU、数量和价格。Checkout 不允许存在 unresolved selection；请求体仍只提交 SKU ID 和数量。

### 9.5 订单与后台

- 新订单继续保存 product、SKU 和 variant name 快照；
- 可追加结构化 option snapshot JSON，避免未来改名后客服看不到下单时 Color/Size 标签；
- 后台订单、库存和发货 UI 显示结构化选项；
- 历史订单无 option snapshot 时回退现有 variantSnapshot；
- 评论显示 `Color: Yellow · Size: 120 cm`，Verified Purchase 规则不变。

## 10. 价格、库存与组合可用性

### 10.1 未选择时价格

- 所有 active priced SKUs 同价：显示单一价格；
- 价格不同：显示 `From ₱X`；
- 若设计需要同时表达区间，可显示 `₱X–₱Y`，但全站必须统一一种形式；本设计默认 `From ₱X`；
- 完整组合解析后显示精确 price/compareAtPrice/savings。

### 10.2 不存在与售罄

- 不存在：没有对应 ProductVariant/SKU，option combination disabled；
- 停售：SKU DISABLED，组合显示但不可购买；
- 售罄：SKU ACTIVE 且 availableInventory<=0，可选择查看素材和价格，但 CTA 禁用；
- 选择某 value 后，其他组的每个 value 根据是否存在至少一个兼容组合更新状态。

### 10.3 不静默替换

任何情况下都禁止：

- 自动选择第一个 SKU 作为购买项；
- 选项冲突时自动换到另一个尺寸；
- 缺货时自动换颜色；
- 深链无效时静默购买默认款。

## 11. API 合约

### 11.1 Storefront Product

Storefront product payload 增加：

```text
options[]
  id, kind, name, position, presentation, isMediaDriver
  values[]
    id, label, position, swatchHex, thumbnailUrl, thumbnailAlt

variants[]
  id, name, position
  optionValueIds[]
  sku

images[]
  id, url, type, altText, sortOrder
  optionValueId?
  variantId?

defaultDisplayVariantId?
```

禁止向 storefront 暴露 supplier cost 等内部字段，现有约束不变。

### 11.2 Admin Product

Admin payload 除 storefront 字段外包含：

- option/value active 状态；
- 组合矩阵所需 stable IDs/client keys；
- SKU 内部字段；
- 库存数据；
- 媒体作用域；
- 历史引用导致的可删除性提示。

### 11.3 Cart

新增或扩展 cart item SKU 替换能力：

```text
PATCH /storefront/cart/items/:itemId
{ skuId, quantity }
```

服务端必须校验目标 SKU、库存与数量，并处理与现有同 SKU 行的合并。具体路由命名在实施计划中遵循现有 CartController 风格。

## 12. 广告、商品目录与测量

### 12.1 精确落地链接

后台每个 variant 提供 Copy storefront link：

```text
/products/<slug>?variant=<variantId>
```

广告创意使用哪个颜色/尺寸，链接就指向同一组合。页面首屏素材、价格和库存立即匹配，购买时仍确认。

### 12.2 Meta Catalog

未来商品目录按 SKU 输出：

```text
id             = sku.id
item_group_id  = product.id
link           = 精确 variant URL
image_link     = 有效变体/视觉选项套图第一张 IMAGE
price          = sku.price
availability   = sku status + availableInventory
```

同一 Product 的 variants 共用 item_group_id，支持颜色/尺寸变体聚合。

### 12.3 Pixel/Analytics

标准事件统一最终 SKU ID：

- ViewContent：当前展示 SKU（深链或 defaultDisplayVariant）；
- AddToCart：实际加入 SKU；
- InitiateCheckout：购物车 SKU 列表；
- Purchase：订单 SKU 列表。

ViewContent 每次页面加载一次，不因每次切选项重复触发。额外内部事件：

```text
option_select
  product_id, option_kind, option_value_id, selection_source
variant_confirm
  product_id, variant_id, sku_id, source
variant_unavailable
  product_id, selected_value_ids, missing_or_oos
```

打开 picker、取消 picker、浏览缩略图不触发 AddToCart。

### 12.4 SEO

- 所有变体共享一个 PDP；
- canonical 指向无 query 的商品主 URL；
- `?variant=` 不生成独立索引页面；
- Product JSON-LD 包含多个 Offers，每个可售 SKU 一条 Offer；
- option labels 可作为 Offer/SKU 描述，但不复制整页内容。

## 13. 校验与错误

### 13.1 保存校验

阻断保存：

- 超过两组选项；
- option/value 名称为空或重复；
- variant 缺少某个 active option 的 value；
- 重复 combinationKey；
- SKU code 重复；
- 媒体作用域指向其他商品；
- optionValueId 和 variantId 同时存在；
- defaultDisplayVariant 不属于商品；
- 试图删除有订单/库存历史的 variant/SKU；
- thumbnail URL 或 media URL 非法。

### 13.2 发布 ACTIVE 校验

至少要求：

- 一个 ACTIVE、priced SKU；
- defaultDisplayVariant 属于该商品，并关联 ACTIVE、priced SKU；库存可以暂时为 0，但后台必须警告运营优先选择有库存的默认展示款；
- 每个 IMAGE presentation 的 active value 有有效缩略图回退；
- 每个主视觉 active value 有 option 套图、精确组合套图或明确可用的公共图回退；
- 所有在售 variants 有完整 option assignments。

素材缺失先作为具名错误定位到具体 option value，不能笼统报 Product invalid。

### 13.3 前台错误

- incomplete：`Choose Color` / `Choose Size`；
- unavailable：`This combination is unavailable`；
- out of stock：`Out of Stock`；
- stale inventory：保留选择，刷新库存状态，提示重试；
- invalid deep link：清 query，回普通初始状态；
- media load failure：同作用域下一张 → 有效 thumbnail → 占位，不跨颜色显示错误套图。

## 14. 性能与存储

- Storefront payload 可以包含全部媒体元数据，但浏览器只请求当前套图文件；
- Next Image/图片 CDN 生成小尺寸 option thumbnails，不能在 64px 控件中下载原始大图；
- variant 视频只对当前套图加载 metadata；
- PLP 不返回完整 variant galleries，只返回 effective thumbnail 和最小 option/SKU 数据；
- PDP 详情接口返回完整作用域映射；
- R2/CDN 直传与对象存储是后续上传性能优化，数据模型使用 URL，不与具体存储厂商耦合；
- 删除数据库媒体行不自动删除共享对象，清理由独立 orphan job 或显式引用检查处理。

## 15. 数据迁移

迁移必须加性执行，不重建现有 variants/SKUs。

对每个存在 variants 的商品：

1. 创建一个 `Style` ProductOption，position=0，presentation=TEXT，isMediaDriver=false；
2. 为每条现有 ProductVariant 创建同名 ProductOptionValue；
3. 创建 ProductVariantOptionValue 关联；
4. 生成 combinationKey；
5. 保持 ProductVariant.id、Sku.id、skuCode、价格、库存和所有引用不变；
6. 把现有 ProductImage 保持为 shared；
7. 选择按 position 排序的首个有效 variant 作为 defaultDisplayVariant；
8. 历史订单不改写；
9. Quick Add 在新映射上线后删除位置索引 heuristic。

迁移后执行一致性审计：

- 每条现有 variant 恰好一个 Style value；
- SKU/variant 主键集合迁移前后完全相同；
- 库存和 order item 外键计数不变；
- ProductImage 数量、URL、类型和顺序不变；
- 商品 ACTIVE 状态不变。

## 16. 可访问性与响应式

- option group 使用 `fieldset`/`legend` 或等价语义；
- buttons 使用 `aria-pressed`，禁用和售罄有文本说明；
- 图片缩略图同时显示 label；
- 色块提供可访问名称且不能只靠颜色区分选中状态；
- 错误与缺少选项使用 `aria-describedby`/live region；
- Bottom Sheet 有 dialog label、焦点陷阱、Esc/关闭、关闭后焦点归还；
- 切换图集后焦点留在刚点击的 option，不跳到主图；
- 375px 下选项横向滚动或换行，不产生页面横向溢出；
- reduced-motion 下取消不必要的图集动画。

## 17. 测试策略

### 17.1 数据与服务测试

- 一组/两组选项组合生成；
- combinationKey 唯一性；
- 保留既有 variant/SKU ID；
- rename value 后更新当前 variant name，订单快照不变；
- 新增/停用/删除组合；
- 有历史组合拒绝物理删除；
- option/value/product 归属校验；
- media scope CHECK 和跨商品拒绝；
- defaultDisplayVariant 归属；
- 迁移前后 SKU、库存、订单引用一致。

### 17.2 Resolver 单元测试

- exact variant media > option value media > shared；
- 不合并不同 scope；
- thumbnail override > option media > shared > placeholder；
- 完整组合解析；
- 不存在组合；
- 售罄与不存在区分；
- 改 option 后清除不兼容值；
- 不自动选择第一条 SKU。

### 17.3 前端组件测试

- IMAGE/SWATCH/TEXT 三种 presentation；
- Color 与 Size 均可用 thumbnail；
- 普通初始状态无 purchase confirmation；
- deep link 预选但 confirmedVariantId 为空；
- 用户手动完成所有选项后允许购买；
- CTA 未确认时只开 picker，不发请求；
- 选项变化使旧确认失效；
- 图集切换重置索引并关闭旧 Lightbox；
- Quick Add 多 SKU 不默认选首项；
- 单 SKU 直接加购回归；
- cart Change options 正确替换/合并 SKU。

### 17.4 追踪测试

- ViewContent 一次且 ID 对应展示 SKU；
- option_select 不触发 AddToCart；
- Confirm 成功后 AddToCart 恰好一次；
- Order Now 确认后 InitiateCheckout 使用最终 SKU；
- Purchase 使用订单 SKU；
- invalid/unavailable selection 不发商业转化事件。

### 17.5 浏览器验收

至少覆盖：

1. Color-only：Yellow/Red 图片缩略图，点击切完整套图；
2. Size-only：80/120 cm 图片缩略图；
3. Color × Size：颜色套图回退；
4. 某一精确组合有专属套图；
5. 深链预选 → Confirm → 加购；
6. 普通 PDP 未选择 → Choose Options；
7. 改颜色导致尺寸无效时清空尺寸；
8. 售罄组合可浏览不可购买；
9. Quick Add、PDP、购物车 Change options；
10. Checkout/订单显示正确 option snapshot；
11. 375px、768px、1280px；
12. 键盘、屏幕阅读器语义、焦点归还；
13. 当前套图以外图片/视频不提前下载；
14. 0 console error、0 hydration error。

## 18. 发布与回滚

建议分四批实施，但作为一个兼容目标设计：

1. 数据模型、迁移、后端 resolver 和兼容 payload；
2. 后台 Options/Variant matrix/Media scopes；
3. PDP、Quick Add、购物车、Checkout、订单与 tracking；
4. 数据迁移审计、生产录入验证、广告深链验收。

发布顺序：

- 先部署可读取旧数据和新数据的后端；
- 应用加性 migration；
- 部署后台和 storefront；
- 迁移旧商品；
- 验证 SKU/库存/订单引用；
- 再允许运营配置第二组选项和 scoped media。

回滚原则：

- migration 第一阶段只新增表/列/关联，不删除旧字段；
- ProductVariant.name 和 SKU 关系继续存在；
- 若前端回滚，旧客户端仍可读取扁平 variants 和 shared images；
- 新建两维商品在旧前端只能显示生成后的组合名，因此生产回滚前暂停新结构录入；
- 稳定一个发布周期后再评估是否清理旧兼容字段，不能在本次一并删除。

## 19. 验收成功标准

功能完成必须同时满足：

- 后台可配置最多两组选项并生成稳定 SKU 组合；
- Color 和 Size 均可选择缩略图展示；
- PDP 图集按 exact → visual option → shared 正确解析；
- 多 SKU 商品所有购买入口都没有默认购买 SKU；
- 深链只预选展示，购买前确认；
- 单 SKU 商品转化路径不增加步骤；
- Quick Add 不再使用位置索引猜图；
- 购物车和 Checkout 可确认并修改最终选项；
- SKU ID、库存流水和历史订单完整保留；
- 广告深链、Meta IDs 和最终订单 SKU 一致；
- 前后端测试、迁移审计、浏览器验收和生产冒烟全部通过。
