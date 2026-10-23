# 详情媒体按作用域区分 + 去掉重复添加入口 — 设计稿

- 日期：2026-10-23
- 状态：设计已口头确认，待书面评审
- 影响：后台商品媒体编辑器、后端商品接口、PDP 详情区、一次 additive 迁移

## 1. 背景

商品媒体目前分四类：共享图集、选项值图集、精确款式图集、详情媒体（长图/视频）。
前三类已经支持按作用域区分（`product_images.option_value_id / variant_id`），
详情媒体只有商品级列表（`product_detail_blocks` 无作用域列），无法随变体变化。

同时后台详情区存在两个添加入口：
「上传图片/视频（可多选）+ URL 添加」一行，以及底部折叠的
「手动添加空条目 → 添加详情图片 / 添加详情视频」。后者与前者重复。

## 2. 目标与非目标

**目标**
1. 详情块支持三种作用域：共享、具体选项值、具体款式。
2. PDP 的解析规则与图集完全一致：先精确款式，再 media driver 选项值，最后共享；
   选中作用域存在专属详情块时，用专属块**替换**共享块，否则显示共享块。
3. 删除详情区底部重复的「添加详情图片 / 添加详情视频」入口。

**非目标**
- 不改图集的作用域规则与后台交互。
- 不引入新的媒体类型；仍是 IMAGE / VIDEO。
- 不做作用域之间的排序重排动画或拖拽（沿用现有 ↑/↓）。

## 3. 数据模型

新增迁移（additive，可空列）：

```prisma
model ProductDetailBlock {
  // 现有字段不变
  optionValueId String? @map("option_value_id") @db.Uuid
  variantId     String? @map("variant_id") @db.Uuid

  optionValue ProductOptionValue? @relation(fields: [optionValueId, productId], references: [id, productId], onDelete: Cascade)
  variant     ProductVariant?     @relation(fields: [variantId, productId], references: [id, productId], onDelete: Cascade)

  @@index([optionValueId, productId])
  @@index([variantId, productId])
}
```

- 两列都为空 = 共享（历史数据全部落在这里，行为不变）。
- 两列互斥由应用层保证；同时非空时以 `variantId` 优先（与图集解析顺序一致）。
- 复合外键保证作用域一定属于同一商品。

## 4. 后端

- 商品创建/更新的 detail block DTO 增加可选 `optionValueId`、`variantId`。
- service 写入这两个字段；更新时按 id 覆盖，保持现有「整表替换」语义。
- 商品读取响应中 detail block 追加这两个字段（可选，向后兼容）。
- 校验沿用外键；不新增业务规则。

## 5. 后台

`DetailMediaWorkspace` 每个详情块行增加「适用范围」下拉：

- `共享`（默认，两列为空）
- `选项值：<选项名> = <值>`：只列 `isMediaDriver` 的选项值（与图集一致，
  避免产生 PDP 永远解析不到的作用域）
- `款式：<款式名>`：列出全部款式

其他行为不变：上传、批量上传、URL 添加、↑/↓ 排序、Alt、删除；
排序仍按整个列表的 `sortOrder` 生效，PDP 侧只按作用域筛选。

删除底部 `<details>` 折叠块及其两个按钮，同时移除对应 i18n key
（`product_media_manual_add`、`product_detail_add_image`、`product_detail_add_video`）
与 `onAdd` 回调；`MediaAddRow` 保留，它已覆盖 URL 手动添加。

## 6. 前台 PDP

- `PdpDetails` 已是客户端组件且位于 `PdpPurchaseProvider` 内，可直接读取
  `primaryLine.selectedValueIds` 与已解析款式。
- 新增纯函数 `filterDetailBlocksForScope(blocks, selectedValueIds, resolvedVariantId, options)`：
  1. 找出当前选择解析出的作用域（精确款式优先，其次 media driver 选项值）；
  2. 该作用域有专属块 → 返回专属块；
  3. 否则返回共享块；
  4. 无任何作用域字段的历史数据 → 原样返回。
- 折叠首屏数量、See more 计数、有无详情区的判断都基于筛选后的列表。
- 服务端渲染仍输出全部块，客户端首次渲染即按默认选择筛选，避免闪烁。

## 7. 测试

- 纯函数：共享回退、款式优先、选项值命中、同时存在时的优先级。
- `PdpDetails`：切换变体后详情块替换；无作用域数据行为不变。
- `DetailMediaWorkspace`：下拉切换写入对应字段；底部重复入口不存在。
- 后端：创建/更新/读取 detail block 的 scope 字段。
- 迁移：在测试库执行后，历史行两列为 NULL，读路径不变。

## 8. 发布与回滚

- 迁移为加列 + 索引，可空，不重写历史数据。
- 后端与前端同批发布；顺序：迁移 → 后端 → 前端。
- 回滚：旧镜像 + 新列保留（旧代码忽略新列），无需恢复数据。
- 发布前跑完整前端/后端测试与构建；生产备份与回滚镜像按既有流程记录。

## 9. 验收标准

- 后台：给某颜色上传一组详情长图并设为该选项值；其余颜色仍显示共享详情。
- 前台：切换颜色后详情区长图随作用域替换；共享块在无专属块时正常显示。
- 详情区底部只剩「上传图片/视频（可多选）+ URL 添加」一行。
- 无作用域数据、无详情数据、纯视频详情均无回归。
