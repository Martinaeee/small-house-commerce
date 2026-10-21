# 全站商品卡统一改版 — 设计规格

**日期：** 2026-10-10  
**状态：** 对话中的完整设计方向已获“继续”；本文为正式规格，待用户审阅。尚未开始产品代码、迁移或实施计划。  
**执行方式：** 主会话 Native/inline；不启动子代理或 Workflow。  
**需求来源：** [用户原始需求对账 A6](../acceptance/2026-10-10-user-requirements-audit.md)。用户已明确选择在后台手动指定场景图，而非固定第二张图片。

## 1. 目标与范围

顾客在首页、类目页和搜索结果页的商品卡上，能够直接选择款式，看到对应图片、真实售价和划线价，并把所选真实 SKU 加入现有购物车。桌面图片悬停展示运营明确指定的场景图；手机正常选款、加购，不依赖 hover。

本轮完整覆盖原需求 A6：

1. 搜索结果 `Order Now` 改为真正的 `Add to Cart`，不是仅改链接文字。
2. 首页、类目、搜索统一卡片悬停浮起效果。
3. 仅鼠标移入图片区域时显示场景图，移出恢复首图。
4. 多款式的划线价按当前选中 SKU 显示。
5. 两个及以上可选择款式时，在卡片内直接显示选项。
6. 选款同步首图、场景图、价格、划线价、库存提示和最终加购 SKU。
7. 三个主要入口、窄屏、触屏及键盘操作均独立验收。

现有共享卡片同时用于集合页、相关推荐和最近浏览，这些调用位置采用同一实现，不保留另一套静态 `Order Now` 卡片。保留各页面原有网格、标题、运营徽标和商品排序；不重做首页模块或类目布局。

### 1.1 明确不做

- 不重做购物车、Quick Add 弹层、PDP 购买流程、COD 结账、库存或订单系统。
- 不新增评论、优惠券、营销费用、归因或落地页工作台功能。
- 不新增另一套图片上传区，不改变批量上传、上传限制、媒体作用域 XOR 或详情媒体的语义。
- 不自动识别白底图/场景图，不按“第二张图片”猜测。
- 不改变 PDP 图集顺序、默认封面、视频播放或尺寸展示。
- 不改变已确认的后台长×宽×高口径，以及前台 Width/Height/Depth 口径。
- 不进行生产写入、发布、推送、合并、PR 或提交。
- 不触碰 `backend/uploads/`；不重启或占用用户的 3000/3001。

## 2. 现状与改动理由

当前存在两条卡片流程：

- `frontend/src/components/product/ProductCard.tsx` 服务首页、搜索、集合等位置，是静态卡片；主 CTA 是详情链接。
- `frontend/src/components/product/PlpProductCard.tsx` 服务类目，单 SKU 可真实加购，多 SKU 通过 `CartContext.openPicker(product)` 打开选择器。

`cardPricePresentation()` 在未解析到具体款式且各 SKU 价格不一致时，展示 `From` 并清空 compare-at。这是起价展示的保护逻辑，不是缺少后台价格数据。本轮通过真实卡片内选款获得准确 SKU，不能用另一个 SKU 的划线价修饰起价。

`ProductImage` 目前只有媒体类型、排序、所属商品及选项值/款式作用域，没有场景图标记。新增显式标记，不能把图片位置等同于用途。

公共列表目前只补默认封面及选项值缩略图，缺少每个款式的精确首图与场景图。主数据来源汇入 `ProductsService.storefrontByIds()`/列表公共投影，CMS 首页与集合页也调用同一产品服务；应在这条共用投影内批量补齐，而非浏览器按每张卡请求 PDP 或媒体接口。

## 3. 持久化：场景图标记

### 3.1 字段

在已有 `ProductImage` 上新增：

```prisma
isScene Boolean @default(false) @map("is_scene")
```

该标记只表达“用于商品卡图片悬停”，不表达封面、不改变 `sortOrder`。所有存量媒体默认 false，不迁移或推断存量图片用途。

### 3.2 唯一性与校验

一个商品的每个图库作用域最多一张场景图：

- 共享：`productId`，且两个作用域外键均为空。
- 选项值：`productId + optionValueId`，`variantId` 为空。
- 精确款式：`productId + variantId`，`optionValueId` 为空。

使用三条 PostgreSQL 部分唯一索引约束 `is_scene = true` 的上述三种情况，保留已有媒体外键与 XOR 约束。数据库同时约束：标记为场景图的行必须是 `IMAGE`，不能是 `VIDEO`。

应用层在事务写入前校验最终媒体快照，返回带具体媒体行/作用域的可读错误；不把数据库唯一约束异常直接作为 500 返回给运营。

### 3.3 图保存与旧客户端兼容

`mediaWriteSchema` 与 legacy `imageSchema` 接受可选 boolean `isScene`：

- 新媒体省略时为 false。
- 已有媒体在作用域及 IMAGE 类型不变时省略字段，保留原标记；不能使用 `.default(false)` 抹掉已有元数据。省略字段但改变作用域或改为 VIDEO 时取消旧标记，不能隐式把它带到新作用域或视频。
- 明确 false 代表取消；明确 true 必须通过作用域唯一性与 IMAGE 校验。
- 场景图选择、取消、删除及作用域变化都与现有商品/图保存处于同一事务。
- typed graph 继续使用 `catalogGraphVersion` 的 409 乐观冲突门禁，禁止无条件覆盖。

图保存当前并行创建/更新媒体。交换同一作用域内的场景图时，必须先解除该事务计划中需要取消/移动的旧标记，再创建或设置新标记，避免合法交换撞上唯一索引；任何后续错误都整体回滚。

legacy `images` 当前走整表替换。保持原替换合同，但事务中先取得旧共享图片元数据：旧请求省略新标记时，按照同一共享作用域内唯一的 `(url, type)` 匹配保留标记，不能按数组下标继承。若标记继承因重复 URL 等原因存在歧义，拒绝该替换并提示使用当前编辑器明确设置，不能猜测标记归属。旧 URL 不再出现在替换列表中时，视为删除原图片；无法从无稳定 ID 的旧请求推断它被改成哪个新 URL。新 UI 保存携带每行明确标记，因此图片 URL 编辑不依赖这种旧请求兼容回退。

省略整个 `images`/媒体 patch 不触碰任何标记；明确删除图片或清空图库则删除其标记，不转移给下一张图。后台业务权限保持 `PRODUCT_MANAGE`，不新增绕过商品权限的媒体写入口。

保存后沿用现有 storefront 缓存再验证。标记变化不能等待用户硬刷新到期才在新页面生效。

## 4. 后台媒体工作区

### 4.1 操作入口

复用已有缩略图与媒体编辑区，支持共享、选项值、精确款式三类商品图库。详情媒体不加入场景图能力。

- IMAGE 缩略图提供“设为场景图”。
- 已指定的图片显示小型“场景图”徽标，并提供“取消场景图”。
- VIDEO 不提供该操作；后端仍校验违规直接请求。
- 在某作用域设新图时，只清除该作用域中的旧标记，不影响别的作用域/商品。
- 标记只更新父级商品/图草稿，使用顶部商品保存；不立即另发写请求。
- 跨 Tab、折叠、选项值切换、普通图片编辑与重排时，草稿标记不能丢失或串到别的目标。

### 4.2 细节规则

- 场景图更换 URL 但仍是同一 IMAGE 行时保留标记。
- 将已标记图片改为 VIDEO 时，编辑器明确取消草稿标记；直接请求 true+VIDEO 被拒绝。
- 将媒体移动到其他作用域时取消其场景标记，需在目标作用域重新指定，避免移动时无意替换目标场景图。
- 删除、替换封面、拖拽排序不按位置转移标记。
- 异步上传仍绑定启动时的作用域；新上传文件不自动获得场景标记。
- 未完成上传、无可用 URL 的占位行不能指定并保存为场景图。
- 保存中及已有上传锁等禁用状态继续生效。

继承已有紧凑工作区、中文默认/英文后台 i18n。只追加具名操作与徽标，不增加常驻大说明卡或重做媒体布局。

## 5. 统一的卡片媒体投影

### 5.1 公共响应

为现有 `Product` 增加仅供卡片使用的可选加法字段；原公共字段及 PDP 媒体响应保持兼容：

```ts
type ProductCardImage = ProductMedia & { type: "IMAGE" };

interface ProductCardMediaPair {
  cover: ProductCardImage | null;
  scene: ProductCardImage | null;
}

interface ProductCardMedia {
  unselected: ProductCardMediaPair;
  variants: Array<ProductCardMediaPair & { variantId: string }>;
}

// Product 新增：
// cardMedia?: ProductCardMedia;
```

`unselected` 是现有默认展示规则的媒体展示结果，不是“自动选择了第一款”。每个可选择的真实 variant ID 对应一对卡片媒体。输出公开的 id/url/type/altText/sortOrder，不泄露作用域外键、供应商成本、Bundle 组件内部信息或后台场景编辑元数据。

### 5.2 解析规则

复用 `product-media.resolver.ts` 的有效图库选择，不另建一套冲突的 variant/image 下标映射：

1. 精确款式图库非空时使用该图库。
2. 否则使用当前有效媒体驱动选项值的图库。
3. 否则使用共享图库。

在同一个有效图库中：

- `cover` 为排序最靠前的 IMAGE，按现有 `sortOrder, id` 稳定顺序。
- `scene` 为唯一 `isScene = true` 的 IMAGE。
- 有图库但无 IMAGE 时返回空图片对，卡片使用占位图；不能把视频 URL 放进 `<img>`。
- 无场景图时 `scene = null`，不取第二张，也不从其他款式或低优先级图库拼凑场景图。
- 场景图与封面相同是合法配置，悬停不产生不同图片。

过滤卡片视频只影响卡片投影，不能改变 PDP 图集的完整 IMAGE/VIDEO 数据、排序和作用域规则。

### 5.3 性能与兼容

- 公共产品列表以批量方式补所有本页产品所需媒体，禁止每产品/每 SKU 单独查询造成 N+1。
- 沿用同一 `storefrontByIds`/列表投影，让首页、集合、类目、搜索、相关推荐与最近浏览都取得一致数据。
- 响应只增加每款式最多两张图片的公开元数据，不附完整各作用域图库、详情积木或评论。
- 浏览器选款及 hover 不发送产品/PDP/媒体 API 请求；图片资源请求不计作商品 API 请求。
- 新字段暂缺的旧缓存/后台预览数据必须能安全渲染。未选状态保留原封面回退；选定后使用已有匹配选项值缩略图或共享 IMAGE 回退，不能把别的款式默认封面冒充为该款首图。缺少场景投影时不切图。
- 缓存和批量响应测试覆盖 1 与 20 个产品，证明新增数据库查询数不随 SKU 数线性增长。

## 6. 卡片组件与选款

### 6.1 组件边界

`ProductCard` 作为共用入口；`PlpProductCard` 保留为薄适配器，转换类目运营徽标并使用同一交互与展示实现。不得保留两份价格计算、选款、媒体切换或加购状态机。

复用现有 `product-selection.ts`、`PdpPurchaseProvider` 和选项可用性规则；卡片实例隔离自己的状态，不能读写父级 PDP 的选择。Provider 本身不改列表 URL；不得为了卡片预选改变 PDP/Quick Add 的全局默认与确认语义。

### 6.2 初始选择

- 单一可选择 SKU 沿用既有自动解析。
- 多款式且后台 `defaultDisplayVariantId` 指向有效可选择 SKU 时，卡片明确显示该款选中态及其准确价格/图片。
- 多款式没有有效默认时不选择第一款、最便宜款或第一个有货 SKU。显示 `From`/既有诚实价格摘要与选款提示，等待顾客选择。
- 默认展示不等于已确认购买；Add/Save for Later 点击才是本卡片的明确购买/暂存意图。
- 旧无类型化选项的商品沿用兼容图规范化，展示可选款式名，而不是丢掉 legacy variants。

### 6.3 选项布局

- 两个及以上可选择款式时，在卡片内显示所有启用的选项组；一组一个具名区域。
- Color/Size 等两组选项分别展示，遵循现有 TEXT/SWATCH/IMAGE 呈现、位置排序与依赖规则。
- 单 SKU 商品不常驻冗余选项区域。
- 长文案、多个值可以换行；使用紧凑按钮，避免新建弹层、截掉操作或使页面横向溢出。
- 全部选项值在卡片内紧凑换行呈现，不隐藏为跳转详情或打开 Quick Add 的替代操作；大量值时卡片自然增高，不裁切控件。
- disabled、未定价、不存在的组合不可加购，具体依赖可用性仍由现有选择器决定。
- 选款不是立即加购，也不是导航。未选完整时不使用默认或之前选择的 SKU 偷偷提交。

### 6.4 价格与库存

- 解析到具体 SKU 后显示它的 price、compareAtPrice 及诚实折扣百分比。
- compare-at 只有高于当前 price 时展示；未选具体且价格不同则保留 From，不混用另一 SKU 的划线价。
- 切换款式同步取消旧 Added/错误提示，并更新图片、库存提示和价格。
- 禁用/未定价商品仅保留详情访问，不伪造售价或可购状态。
- 缺货继续允许按既有规则 `Save for Later` 加入购物车，显示清楚的 Out of Stock，结账仍拒绝不足库存。不能把本轮 UI 改为全局禁用缺货暂存。
- Bundle 显示已有派生 availability，提交其虚拟 SKU ID。卡片不展开或预留物理组件，也不复制库存算法。

### 6.5 详情链接

图片与标题仍是独立详情链接。选定真实 variant 时携带该 variant 的深链，PDP 按已有深链逻辑展示，仍保留原购买确认门禁。不得把整个 article 包进链接，再嵌套选项/加购按钮。

## 7. 加购、重复提交与事件

- 调用现有 `CartContext.addItem({ skuId, quantity: 1 })`；沿用现有打开购物车抽屉的成功行为。
- 未解析出有效 SKU 时不发请求，显示英文具名提示并聚焦第一个缺失选项组。
- 单卡片使用同步 ref 锁结合 busy UI，阻止同一点击任务里的重复提交；仅 React state 禁用不足以作为锁。
- 请求期间锁定本卡片选项及 CTA，快照记录 product/variant/SKU/price，防止响应或事件落在用户后来选择的另一款上。
- 成功显示 `Added` 的可访问反馈；失败保留选择，显示可读错误并允许重试。不能像旧 PLP 代码一样吞掉错误。
- 切款、产品替换和卸载清理成功反馈定时器，不能把旧请求的状态写进新的商品卡。
- 只有加购成功后发送一次现有 `AddToCart`；多款式确认按既有 Quick Add 事件语义发送一次 `variant_confirm`，source 仍使用支持的 `QUICK_ADD`。不新增虚假 Purchase/收入事件。
- 缺货暂存继续遵循现有成功购物车变更事件口径。
- 首页已有 ProductClick 归因只在实际图片/标题导航时触发，选项与 Add 点击不能被外层追踪包装误记为详情导航。

不改 CartService、checkout、库存或订单并发行为；测试本轮单卡片重复点击边界，不能据此声称已解决全站所有多请求并发问题。

## 8. Hover、图片加载与可访问性

### 8.1 桌面

- 卡片整体在 `hover: hover` 且 `pointer: fine` 时轻微向上移动 2px，统一阴影；不改变格子占位或引起布局跳动。
- 只有图片链接区域的 pointer enter 激活 scene，移出该区域恢复 cover。悬停标题、价格、选项、按钮不能切图。
- 切款后即刻以当前 variant 的图片对为准，旧款式场景图不能暂留。
- scene 首次实际需要时加载，未加载完成保留 cover；图片 onerror 回退 cover，不能闪出空白或破图。
- 已离开图片区域或已切款时，旧图片加载完成不能重新激活旧 scene。

### 8.2 触屏与键盘

- `hover: none` 或 coarse pointer 下不自动激活场景图，不用第一次点击图片模拟 hover。单次点击仍可进入详情。
- 键盘选款、CTA、详情链接具有明显焦点和具名 aria；选项的 checked/pressed 状态可读。
- 键盘聚焦图片链接可等价预览场景图，失焦恢复；加购和选择控件的聚焦不能触发切图。
- 尊重 `prefers-reduced-motion`，关闭位移/淡入动画但保留功能。
- 加购 loading/error/success 使用非阻塞、不会每帧重复播报的状态区域。
- 场景图图片 alt 使用后台英文 alt，空值回退商品名，不生成中文前台文案。

### 8.3 视觉约束

沿用 LUWAG 现有字体、颜色、按钮、PriceBox、4:5 图片比例与父网格，不另造主题。保持卡片图片稳定占位、选项紧凑、CTA 在卡片底部；无真实评论时不新增评分。

验收至少包含 375、768、1440 宽度。375 下既有双列商品卡的每卡可用宽度必须作为测试条件，不能只在整页单列上测试。

## 9. 无副作用的后台预览

新的交互卡不能要求后台预览额外安装 CartProvider，也不能在后台购物车中产生真实顾客购物车变更。

为共用卡片提供显式 `interactionMode: "storefront" | "preview"`，默认 storefront：

- storefront 挂载独立购买状态和 CartContext 交互。
- preview 渲染同一视觉展示，但不挂载依赖 CartContext 的购买动作，不发购物车或 commerce tracking 请求。
- 预览可展示当前默认款式、图片对、选项形态和禁用 CTA；不能进入真实详情或离开编辑器。
- `SectionProps` 增加可选 interactionMode，HomepageLivePreview 明确传 preview；现有 ProductGrid renderer 继续传递该模式。Room Inspiration 当前使用独立商品链接而非 ProductCard，保留现有预览链接捕获，不将其链接列表改造成商品卡。
- 外层现有预览链接捕获和桌面/平板/手机固定画布仍保留。
- 产品缓存/后台 preview catalog 未携带 cardMedia 时安全回退，不触发数据加载循环。

这只是共享卡片兼容保护，不实施暂缓的首页完整 Header/Footer 外壳、公告栏富文本或 Header/Footer 编辑功能。

## 10. 改动单元与协调边界

### 后端

- `prisma/schema/catalog.prisma`：ProductImage 标记。
- 一条独立追加 migration：默认 false、IMAGE 约束、三种作用域部分唯一索引；实现前与营销会话协调唯一迁移命名和执行窗口。
- `dto/product.dto.ts`、`dto/catalog-graph.dto.ts`：可选标记和最终快照验证。
- `catalog-graph.service.ts`：快照、计划、交换写序与版本冲突。
- `products.service.ts`：legacy 元数据兼容、公开列表批量投影与缓存再验证。
- `product-media.resolver.ts` 附近的窄共用 card projection helper：复用有效图库解析，不改变现有 PDP resolver 的外部合同。

### 前端后台

- `admin-api.ts`、`admin-product-graph.ts`：读/写类型、草稿水合、baseline、明确 serializer。
- `ProductForm.tsx` 与产品 new/edit 页面：共享图库标记的父草稿和保存闭环。
- SharedMediaWorkspace、MediaGallery、ProductMediaScopesEditor：缩略图操作与 scope-safe 标记。
- `i18n/en.ts`、`i18n/zh.ts`：仅新增/调整本轮商品卡场景操作文案，保留 FAQ 与尺寸/包装键。

### 前端前台

- `lib/api.ts`：兼容性卡片投影类型。
- ProductCard/PlpProductCard：共用交互与展示、薄适配。
- `product-selection.ts`、PdpPurchaseProvider、ProductOptionSelector、PriceBox、CartContext：默认复用，只有被本轮 RED 指向的必要扩展才改；不得重写全局购买合同。
- 首页 renderer、类目/搜索/集合入口及后台预览：传递模式与运营徽标，保留布局/排序。
- homepage 追踪接线：避免新按钮被误报成 ProductClick。

商品公开投影、admin-api、前台 api、i18n 和 Prisma 文件可能与营销线交叠，实施前须先协调编辑窗口；共享 PostgreSQL 5432 的迁移串行。禁止整文件覆盖、宽范围格式化、整树暂存或清理另一会话的 scratch。

## 11. TDD 与验收矩阵

实现以 RED→最小 GREEN→项目完整测试为准；每个已修改行为先证明测试能复现缺失，而不是实现后补通过测试。

### 11.1 持久化与后台

1. 新字段缺省 false，存量相同顺序/封面不变。
2. Shared/Option/Variant 各可独立选一张，不互相清标记。
3. 同一作用域两张 true 被拒绝，事务无半写；合法旧图→新图交换成功。
4. VIDEO true、跨商品 ID、XOR 非法被拒绝，权限不放宽。
5. 取消、删除、换 URL、转 VIDEO、移动 scope、拖拽、封面重设的标记行为符合 §4。
6. 标记草稿跨 Tab/折叠持久；上传异步结束不会写错 scope。
7. typed graph 409 保留本地草稿，场景图写入失败不影响其他字段。
8. 新媒体省略标记 false；已有 graph media 省略字段保留 true。
9. legacy images 无新字段请求不因整表替换丢掉唯一可匹配的旧标记，歧义拒绝且无数据改变。
10. save/reload/new product/edit product 确认 flag、scene/cover 与 sortOrder 的 round-trip。

### 11.2 数据投影

1. 精确款式、选项值、共享三个优先级分别验收，卡片首图/scene 来自同一有效 scope。
2. 完整图有 video/image 混排时只输出 IMAGE pair，PDP 原图集不变。
3. 无 scene、不存在图片、仅视频、scene=cover 均安全。
4. 公开列表不泄漏成本、作用域外键及 Bundle 组件明细。
5. 列表、ids batch、首页与集合公开商品投影一致。
6. 对 20 产品/多 SKU 查询计数断言：无每产品/每 SKU 新查询。
7. 缺少新字段的旧响应/preview catalog 有安全回退。

### 11.3 卡片交互

1. 单款直接加购数量1；多款有效默认显示准确选择；无默认不偷选。
2. 一个/两个选项组、legacy variant、长标签、大量选项与不存在组合。
3. 切款同时改变对应首图、scene、售价、compare-at、badge 与库存提示。
4. 未选完整不发加购，焦点到缺失组；disabled/unpriced 不购。
5. 缺货暂存仍可用，Bundle 提交虚拟 SKU，不触碰组件库存。
6. 同任务 double click 只一次请求；busy 期间不能改 SKU；失败无事件、成功一次事件、retry 可用。
7. 独立卡片互不串选；同一个商品刷新/被替换/卸载时旧反馈不落到新卡。
8. 图片和标题深链正确；选项、CTA 不导航，也不误触 ProductClick。
9. 鼠标只在图片范围激活 scene，移入价格/选项不激活；离开、图片延迟、错误及快切款恢复正确。
10. pointer coarse/no-hover、keyboard、reduced-motion 下交互符合 §8。
11. admin preview 无 CartProvider 也渲染，无 cart mutation/event/navigation。

### 11.4 浏览器

- 首页、类目、搜索各用至少一个真实多款式测试商品验证选款→媒体/价格→加购→购物车最终 SKU。
- 集合、相关推荐、最近浏览验证共享卡片没有旧 CTA 或独立逻辑残留。
- 标记 Shared/Option/Variant 场景图并保存，前台加载后匹配具体款式；取消标记后无错误场景回退。
- 375 双列、768、1440 无页面横向溢出，按钮可触达、长标签可阅读。
- 真实 hover/leave/focus/blur 与加载失败检查，console/page/hydration 无本轮错误。
- 后台首页装修 desktop/tablet/mobile 预览照常可滚动、可选中模块，CTA 不产生购物车写入。
- Network 验证没有每卡 PDP/媒体 API 请求，图片资源行为符合按需 scene 加载。

浏览器测试只使用已获准的本地隔离环境/独立测试库及临时上传目录；不触碰保护的 uploads，不改用户正在编辑的本地商品，不为展示方便批量上架或恢复未知来源的 fixture 改动。测试自建数据在适当事务/独立库中，保留原始用户数据。

## 12. 完成与发布边界

本轮完成证据应包括：当前树前后端项目完整测试、相关数据库/接口测试、前端 tsc、前后端 lint/build、git diff --check，以及上述浏览器矩阵。

后端完整 tsc 已记录存在18条测试区域诊断，但没有干净基线证明它们全部与本轮无关。实施结束重新运行并按文件报告，不能因为单测/build通过就隐去它们，不能无条件声称全门禁通过。若共享树中另一会话仍处于 RED 或生成临时输出，先协调并记录实际边界；不改 ESLint ignore 来掩盖。

- 只在当前 `homepage-builder` worktree 本地实施。
- 主会话不启动多代理审查；如用户另行明确要求独立审查，再按其授权安排。
- 不提交、不推送、不合并、不建 PR、不部署；本文也不提交。
- eventual 后端发布必须包含 Prisma generate、迁移窗口、备份/回滚与两工作线依赖核对，但本规格不是发布授权。

## 13. 正式规格自审结论

- 原 A6 各子项都对应目标和验收项；不只更改 CTA 文案。
- 手动场景图已经选定；无自动第二张或图像猜测分支。
- 默认展示款式、未选款、价格比较、缺货暂存和点击确认有明确规则，未改变全局 PDP 购买契约。
- 首图/scene 同源、不跨作用域拼接；PDP 图片排序与视频播放独立保留。
- 新元数据的存量默认、旧请求省略字段、legacy 整表替换和唯一索引交换写序均已定义。
- 公开投影覆盖 CMS/集合现有共享链路，卡片无 N+1 商品 API；后台预览无副作用。
- 已区分卡片实现、营销线协调、现有尺寸/FAQ/Bundle保护与发布授权。

**下一闸：** 用户审阅本文；通过后才编写具体实施计划。本文不代表已经开始改代码。
