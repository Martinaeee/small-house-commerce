# 千易首批 SKU 建档清单

数据来源：2026-10-28 生产库只读查询（62 个 SKU）。建档规则：毛重、净重、包装长宽高**全部有值**才允许勾选建档。

## 结论

| 分组 | 数量 |
|---|---|
| 可直接建档 | **23** |
| 缺净重（毛重/尺寸齐全） | **26** |
| 缺毛重或缺包装尺寸 | **13** |

净重缺失**不再用毛重顶替**；这些 SKU 会一直显示「缺 productWeight」，补齐后才能建档。

## A. 可直接建档（23）

| SKU | 商品 | 毛重 kg | 净重 kg | 包装 L×W×H (cm) |
|---|---|---|---|---|
| SC001-3 | Foldable Shoe Cabinet with Clear Doors | 1.89 | 1.71 | 27×35.5×11.5 |
| SC001-6 | Foldable Shoe Cabinet with Clear Doors | 3.38 | 3.63 | 27×35.5×19 |
| SC001-9 | Foldable Shoe Cabinet with Clear Doors | 4.9 | 5.27 | 36×27×27 |
| SC002-1 | Mobile Pegboard Storage Cabinet with Hooks | 2.9 | 2.35 | 59×15×36 |
| SC002-2 | Mobile Pegboard Storage Cabinet with Hooks | 4.5 | 3.5 | 59×25×36 |
| SC002-3 | Mobile Pegboard Storage Cabinet with Hooks | 6 | 5 | 59×34×36 |
| SC002-4 | Mobile Pegboard Storage Cabinet with Hooks | 7.5 | 6.45 | 59×44×36 |
| SC003-l | Modular Foldable Cube Storage Cabinet | 3.35 | 2.85 | 65×56×11 |
| SC003-s | Modular Foldable Cube Storage Cabinet | 1.7 | 1.4 | 33×33.5×11 |
| SC004-1 | Faux Rattan Foldable Storage Cabinet | 2.15 | 1.71 | 51×34×11 |
| SC004-3 | Faux Rattan Foldable Storage Cabinet | 4.7 | 4 | 52×34×24 |
| SC004-5 | Faux Rattan Foldable Storage Cabinet | 7.3 | 6.29 | 52×37×33 |
| SC004-XL5 | Faux Rattan Foldable Storage Cabinet | 10.2 | 8.9 | 62×40×38 |
| SC005-121.5 | Narrow Gap Cabinet with Adjustable Shelves & Clear Door | 4.75 | 4.15 | 32×42×24.5 |
| SC005-93 | Narrow Gap Cabinet with Adjustable Shelves & Clear Door | 4.05 | 3.55 | 32×33×24.5 |
| SC006 | 2XL 5-Tier Foldable Storage Cabinet | 7.26 | 6.16 | 47×36×31.5 |
| SH-STOOL-001 | Compact Folding Stool | 1.4 | 1.2 | 30×45×5 |
| SH-STORE-001 | Slim Slide Storage Cart | 2.1 | 1.8 | 14×65×40 |
| SH-TABLE-001 | Foldable Dining Table | 8.2 | 7.5 | 80×8×60 |
| TB007-Black | Rolling Sofa Side Table with Drawer & Basket | 3.6 | 3.1 | 46×13×32 |
| TB007-White | Rolling Sofa Side Table with Drawer & Basket | 3.6 | 3.1 | 46×13×32 |
| UB001-2-black | Foldable Metal Underbed Storage Bin with Wheels 62.6cm | 1.93 | 1.94 | 43×42×31 |
| UB001-2-white | Foldable Metal Underbed Storage Bin with Wheels 62.6cm | 1.93 | 1.94 | 43×42×31 |

> 两个 UB001 的净重（1.94）略高于毛重（1.93），是历史录入数据。建前建议人工核对，避免千易侧出现「净重 > 毛重」的异常。

## B. 缺净重（26）——补齐 `productWeight` 后可建档

`CH002-gray` `CH002-green` `CH002-orange` `GR001-Black` `GR001-Walnut` `GR002-Black` `GR002-Walnut` `TB001-Wa` `TB001-Wa-V` `TB001-Wi` `TB001-Wi-V` `TB002-Gray` `TB002-oak` `TB002-pebble` `TB003-Beige` `TB003-Black` `TB003-White` `TB004-B80` `TB004-B90` `TB004-W80` `TB004-W90` `TB004-Wa80` `TB004-Wa90` `TB005-with` `TB005-without` `TB006`

## C. 缺毛重或包装尺寸（13）——资料补齐前不可建档

| SKU | 缺什么 |
|---|---|
| CH001-B / CH001-W | 毛重、净重 |
| SC001 / hj | 毛重、净重、包装尺寸（两个 SKU 是同一款吧台椅，疑似重复商品） |
| SC003-22 / SC003-44 / SC003-46 | 毛重、净重、包装尺寸 |
| TB008 | 毛重、净重、包装尺寸 |
| TB008-Black / TB008-Walnut | 毛重、净重 |
| TBK01 | 毛重、净重 |
| **SC005-B / SC005-H** | 商品名为 `abtest`，**疑似测试商品，建议不要建档** |

## 建档时的固定参数（系统统一发送）

| 字段 | 取值 | 说明 |
|---|---|---|
| `type` | `SINGLE` | 当前 62 个 SKU 全部为非组合品 |
| `weightUnit` | `KG` | 与后台录入单位一致 |
| `dimensionUnit` | `cm` | 与后台录入单位一致（全站已统一 cm） |
| `shelfLife` | `36500` 天 | 千易必填；家具无保质期，取值需千易确认 |
| `enable` | `1` | 建档即可用 |
| 编码 | 直接用本站 `skuCode` | 千易侧确认不冲突后才写入映射 |
