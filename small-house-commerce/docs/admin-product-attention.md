# 商品列表「需要处理」口径说明

后台商品列表顶部的 **Needs attention（需要处理）** 一栏，每个条目既是一个**全局计数**，也是一个**可点击的筛选**。

**唯一真源**：`backend/src/modules/catalog/admin-product-attention.ts` 的 `attentionWhere()`。
计数（`GET /admin/products/counts`）与筛选（`GET /admin/products?attention=<preset>`）调用**同一个函数**，
所以「chip 上的数字」和「点进去看到的行数」不可能对不上——这条契约由单测固定
（`admin-product-attention.spec.ts` + `products.service.spec.ts` 的计数用例）。

四个预设的精确判断条件如下。

---

## `missing_media` — 缺少共享图库

```ts
{ images: { none: { optionValueId: null, variantId: null } } }
```

**判断**：该商品在 `product_images` 里**没有任何共享图库行**（`option_value_id IS NULL AND variant_id IS NULL`）。

- 作用域媒体（按选项值 / 精确款式）**不算数**：前台所有位置都需要一个共享兜底图，只有作用域图时商品没有可用的封面。
- 一张共享图都没有 → 命中。哪怕有 10 张按颜色图，也仍然命中。

## `no_priced_sku` — 已上架但没有定价 SKU

```ts
{ status: 'ACTIVE', skus: { none: { status: 'ACTIVE', price: { not: null } } } }
```

**判断**：商品状态是 `ACTIVE`，且**不存在**任何一个「SKU 状态为 ACTIVE 且 `price` 非空」的 SKU。

- **只看已上架商品**：草稿没有价格是正常的，不会被标记。
- 价格为空（`NULL`）与价格为 0 是两回事：0 是合法价格，不会被标记。
- SKU 存在但状态为 `DISABLED` → 不计入「有定价 SKU」。

## `incomplete_shipping` — 物流信息不全

```ts
{ skus: { some: { OR: [
  { productWeight: null }, { packageWidth: null }, { packageHeight: null },
  { packageDepth: null }, { packageWeight: null },
] } } }
```

**判断**：该商品**至少有一个 SKU** 缺少以下任一字段：`product_weight`、`package_width`、
`package_height`、`package_depth`、`package_weight`。

- 这五项是承运商报价与体积重计算的最小集合；缺一项就无法可靠发货。
- **完全没有 SKU 的商品不会命中**（它的问题由其他检查覆盖，不在「物流信息」口径内）。
- 只要有**一个** SKU 不全，整个商品就命中——它提醒的是"这单商品还不能发"，不是"某一行有问题"。

## `stale_draft` — 草稿超过 30 天未更新

```ts
{ status: 'DRAFT', updatedAt: { lt: now - 30 天 } }
```

**判断**：状态为 `DRAFT` 且 `updated_at` 早于「当前时间 − 30 天」（`STALE_DRAFT_DAYS = 30`）。

- 任何一次保存都会刷新 `updated_at`，所以这是"30 天没人碰过的草稿"。
- 已上架/已下架商品不会命中，无论多久没改。

---

## 计数是怎么算的

`GET /api/v1/admin/products/counts` 返回：

```json
{
  "status": { "all": 1248, "active": 892, "draft": 238, "disabled": 118 },
  "attention": {
    "missing_media": 6,
    "no_priced_sku": 4,
    "incomplete_shipping": 3,
    "stale_draft": 7
  }
}
```

- 状态计数：一次 `groupBy(status)`。
- 关注计数：**每个预设一次 `count()`，并行执行**，全部在数据库内完成。
- **绝不按当前分页计算**：列表每页 20 条，用可见行数当全局计数是错的。

## 筛选是怎么应用的

列表接口新增 `attention` 参数，取值就是上面四个预设名。它与其他筛选**取交集**：

```
GET /admin/products?attention=missing_media&categoryId=<uuid>&page=1
```

实现上用 `AND` 组合，所以预设里固定 `status` 的那两条（`no_priced_sku`、`stale_draft`）
不会和显式的 `status` 参数互相覆盖。

前端：列表页顶部关注条中的 chip 点击即切换该筛选；筛选生效时页面额外显示
「当前筛选」标签行，每个标签可单独 ✕ 清除，也可一键清除全部。
