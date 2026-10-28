# 千易 ERP 接入设计（订单同步）

日期：2026-10-28
状态：设计待审。本文只描述方案，尚未写任何实现代码，也未向千易推送订单、创建商品或修改库存。

## 1. 目标与边界

目标是让独立站的订单在**客服确认后自动进入千易 ERP**（免千易人工审核），千易发货后把**运单号、承运商、物流节点、出库明细**回传独立站，顾客在 `/track-order` 能看到真实轨迹，客服在后台能核对少发/多发。

本期范围：

- 推单、关单（取消订单时同步关闭千易单）
- 发货回推、轨迹回推、出库明细核对
- 每日对账兜底
- 千易商品建档清单与 SKU 映射
- 后台管理页（连接状态、失败重推、未匹配 SKU、回调记录）

本期不做：库存双向同步、价格同步、退货自动入库、采购单、面单打印。

## 2. 已核实的外部事实（2026-10-28 实测）

以下均为线上只读验证结果，不是推断：

| 项目 | 实测值 |
|---|---|
| ERP 域名 | `https://www.qianyierp.com`（用户日常登录域名） |
| 三方应用 | `LUWAG`，自研应用，`accessId` 以 `1793177155241-` 开头 |
| IP 白名单 | `43.160.229.107`（= 生产服务器出口 IP，已与 `luwag.shop` 的 A 记录一致） |
| 店铺 | `LUWAG- PH`，platform `OTHER`，siteCode `PH`，status `UNLOCK`，授权状态「店铺已授权」 |
| 已开通权限 | 商品全套（含新建/编辑/启停/查询）、订单全套（含创建、创建并审核、关闭、列表查询、物流推送）、店铺查询、仓库查询、仓库物流查询 |
| 千易现有 SKU | 4,213 个 |
| 本站 SKU | 62 个 |
| 编码匹配结果 | **0 个匹配**（我们的 `skuCode` 与千易现有编码完全不同） |
| 本站建档资料完整度 | 62 个中 49 个毛重 + 包装长宽高齐全；13 个缺尺寸；净重只有 23 个 |
| PH 可用仓库 | `PH-BULACAN-02`(70986)、`PH-DAVAO-01`(71537)、`A3-AYOU-PH-0611`(36135)、`OSW_PH02`(14349)；**已选定 `PH-DAVAO-01`** |
| PH 可用物流 | Bulacan/Davao：Lazada、Shopee、TEMU、TikTok、**`SHIPDOC-STD`**；AYOU 只有 GWMS + 平台物流；OSW 只有 TikTok + SPX；**已选定 `SHIPDOC-STD`** |

协议约定（来自官方文档）：

- 请求：`POST https://www.qianyierp.com/api/v1/{模块}`，`multipart/form-data`，UTF-8
- 公共参数：`appId`、`bizParam`（JSON 字符串）、`serviceType`、`timestamp`（13 位毫秒）、`sign`
- 签名：把除 `sign` 外的参数按参数名 ASCII 升序拼成 `k=v`，末尾直接接 `secretKey`，取 MD5 小写 32 位
- 响应：`{ errorCode, errorMsg, state, result }`，`state = success` 或 `errorCode = 0` 视为成功

## 3. 总体架构

```
客服确认订单 ──► orders.service.confirm() 同事务写 QianyiSyncJob
                          │
                          ▼
              QianyiSyncService（30 秒 worker + 入队即试一次）
                          │ 签名 / form-data / 失败退避重试
                          ▼
                   千易 ERP /api/v1/salesOrder
                          │
                          │ 千易发货
                          ▼
       千易 Webhook ──► POST /api/qianyi/webhook（验签 + 幂等）
                          │
              ┌───────────┼────────────┐
              ▼           ▼            ▼
      Shipment + 库存  订单转 SHIPPING  轨迹 / 明细核对
```

模块边界（`backend/src/modules/qianyi/`）：

| 文件 | 职责 | 不做什么 |
|---|---|---|
| `qianyi.client.ts` | 签名、发 multipart、解析响应、错误码归一 | 不认识订单结构 |
| `qianyi-order.mapper.ts` | `Order` → `CREATE_AND_AUDIT_SALES_ORDER` 报文（纯函数） | 不发起网络请求 |
| `qianyi-sku.mapper.ts` | `Sku` → `INSERT_SKU_INFO` 建档报文 + 缺口清单（纯函数） | 不写数据库 |
| `qianyi-sync.service.ts` | outbox 入队、worker、退避、对账 | 不解析业务字段 |
| `qianyi-inbound.service.ts` | 发货落地：Shipment、库存、轨迹、明细核对 | 不含 HTTP 细节 |
| `qianyi-webhook.service.ts` | 验签、按 serviceType 分发、幂等 | 不直接改订单 |
| `qianyi-admin.controller.ts` | 后台：健康度、任务列表、重推、未匹配 SKU | 无业务规则 |

## 4. 数据模型

新增一条加性迁移，不改既有列的含义。

| 对象 | 定义 | 用途 |
|---|---|---|
| `Sku.qianyiSkuCode` | `String? @map("qianyi_sku_code")`，非唯一（千易侧允许一码多品的历史数据存在） | 千易编码映射 |
| `Order.qianyiOrderNumber` | `String? @map("qianyi_order_number")` | 千易系统单号（`S…`），Webhook 反查用 |
| `QianyiSyncJob` | `id, orderId, kind(PUSH_ORDER/CLOSE_ORDER), status(PENDING/SENT/FAILED/SKIPPED), attempts, nextAttemptAt, lastError, requestPayload Json, responsePayload Json?, createdAt, sentAt, updatedAt` | 事务性 outbox |
| `QianyiWebhookEvent` | `id, serviceType, signValid Bool, externalKey, payload Json, processedAt?, error?, receivedAt` | 原始回调留档，可重放排查 |
| `ShipmentTrackingEvent` | `id, shipmentId, code, description, eventAt, raw Json` | 轨迹节点 |
| `Shipment.qianyiOutboundNumber` / `Shipment.qianyiStatus` | `String?` ×2 | 出库单号与千易侧状态 |

约束：`QianyiSyncJob` 上 `@@unique([orderId, kind])` —— 同一订单同一动作只允许一条任务，重推是更新该行而不是新建。`QianyiWebhookEvent` 上 `@@unique([serviceType, externalKey, statusKey])` 用于幂等，重复回调直接返回 200。

## 5. 出站：确认后推单

`orders.service.confirm()` 已经在 `$transaction` 内完成确认，新增同一事务内的 `qianyiSync.enqueue(tx, 'PUSH_ORDER', orderId)`。事务提交前入队意味着：确认成功一定有任务，确认回滚一定没有任务。

worker 沿用 `origin/main` 上 Meta CAPI 的形态（`setInterval` + `unref`，`NODE_ENV=test` 不启动，入队后立刻先试一次，失败退避 1 → 5 → 15 → 60 分钟，第 5 次转 `FAILED`），后台可手动重推把 `FAILED` 拉回 `PENDING`。

字段映射（`CREATE_AND_AUDIT_SALES_ORDER`）：

| 千易字段 | 取值 | 说明 |
|---|---|---|
| `shop` | `QIANYI_SHOP` = `LUWAG- PH` | 原样带空格 |
| `onlineOrderNumber` | `order.orderNumber` | 幂等键，最长 50 字符 |
| `paymentMethod` | `COD` | 文档枚举 `COD` / `PAY_ONLINE` |
| `codPayAmount` | `grandTotal` | 4 位小数，含运费 |
| `freight` | `shippingTotal` | 4 位小数 |
| `currency` | `PHP` | 文档枚举存在 |
| `payTime` | `order.createdAt` 转 `+08:00` | **不代表已收款**；这是 COD 无支付时间时的既定口径 |
| `buyerMessage` | `customerNote` | |
| `buyer.*` | 收货地址 + 客户 | `receiverName/phone/email/country/province/city/district/address1/postCode` |
| `warehouse` / `warehouseId` | `PH-DAVAO-01` / `71537` | 已选定；两个都传，按 ID 优先 |
| `logistics` | `SHIPDOC-STD` | 已选定，Davao 仓可用 |
| `skuList[].sku` | `qianyiSkuCode` | **空则整单不推**，进「未匹配」清单 |
| `skuList[].quantity` | `OrderItem.quantity` | |
| `skuList[].paymentPrice` | 行单价（不含运费） | |
| `skuList[].shippingPrice` | 按行金额比例分摊运费 | 分摊余数给最后一行，保证合计相等 |
| `skuList[].payAmount` | 行实付（含分摊运费） | |
| `skuList[].promotionDiscount` | 行折扣 | |

金额一律走 `Decimal`，不经过浮点，四舍五入只发生在边界。

关单：`cancel()` 时若该订单已有 `SENT` 的推单任务，同事务入 `CLOSE_SALES_ORDER`（只需要 `shop` + `onlineOrderNumber`）。未推过的订单不产生关单任务。

## 6. 入站：Webhook

路由 `POST /api/qianyi/webhook`，公开、不走 JWT，只接受已知 `serviceType`。

- 同时接受 `multipart/form-data`（千易默认）与 `application/x-www-form-urlencoded`
- 验签失败：返回 401，写 `QianyiWebhookEvent(signValid=false)`，**不执行业务**
- `timestamp` 与本地时间差超过 15 分钟：返回 401（防重放）
- 幂等键 = `serviceType + 出库单号/运单号 + 状态`，重复回调直接 200

| serviceType | 处理 |
|---|---|
| `PUSH_ODO_ORDER`（`status=SHIPPED`） | 建 `Shipment`（carrier、trackNumber）、扣本地库存、订单转 `SHIPPING`、写首条轨迹；逐 SKU 比对数量 |
| `PUSH_SALES_ORDER_SHIPPING_INFO` | 只补运单号/承运商；比 ODO 先到也不丢 |
| `PUSH_TRACKING_PACKAGE` | 追加轨迹；`DELIVERED` 置 `Shipment` 已签收 |
| `PUSH_RETURN_ORDER_INFO` | 只留档，不动库存 |
| 未知类型 | 200 + 留档，避免千易无限重试 |

明细核对：把 `skuList` 按千易编码反查回 `OrderItem`，数量不等时写 `OrderNote(noteType=WAREHOUSE)` 并在后台「出库差异」列表标红。**不自动改订单金额，不自动退款。**

## 7. 对账兜底

每日一次 `QUERY_SALES_ORDER_LIST`：条件是最近 3 天的 `updateTimeFrom/updateTimeTo`（文档要求 11 个条件至少一个，时间窗 ≤ 30 天）。只做两件事：本地缺 `Shipment` 的补建；千易有、本地无对应订单的写告警。不覆盖已签收状态，不改金额。

## 8. SKU 建档与映射

因为 0 个编码能对上，本期必须先把商品建到千易。**建档动作由系统执行，但哪些商品进千易由人在后台逐项勾选决定**：

1. 后台生成**建档预览清单**：62 个 SKU 全列出来，每行显示建议千易编码、标题、图片、毛重、净重、长宽高、单位、保质期，以及该行能否建档（资料齐/缺尺寸/缺净重）
2. 清单每行有勾选状态，默认**全不勾**；只有被勾选的行才会被提交建档
3. 确认提交后，系统对勾选行逐个调 `INSERT_SKU_INFO`，成功的回写 `Sku.qianyiSkuCode`
4. 未勾选、或勾选了但建档失败的行，**保持无映射，永不推单**，留在清单里等下轮处理
5. 资料缺口只提示不补齐，不填假数

`INSERT_SKU_INFO` 的必填项：`sku / title / type / weight / netWeight / weightUnit / length / width / height / dimensionUnit / enable / shelfLife`。本站现状：49 个毛重 + 包装尺寸齐全可直接建；13 个缺尺寸；净重只有 23 个。

净重缺失的既定口径：`netWeight = productWeight ?? packageWeight`，并在清单里标「净重默认取毛重，需人工确认」，不静默当成真实净重。

约束：**不覆盖千易已有商品**，**不给初始库存**，**不在编码未确认时推单**。

## 9. 后台

新增 `/admin/settings/qianyi`：

- 连接状态：开关、`appId` 掩码、域名、店铺、仓库、物流编码
- 可复制的 Webhook 地址（`https://luwag.shop/api/qianyi/webhook`）
- 待推送 / 失败 / 24 小时成功数
- 失败任务列表 + 重推
- 未匹配 SKU 清单（有订单但无千易编码）
- 建档预览清单（逐行勾选，默认全不勾）与建档进度
- 最近回调记录（含验签失败）
- 出库差异列表

商品表单 SKU 区新增「千易编码」输入框，和 `skuCode` 并排显示，不替换。

## 10. 配置与密钥

`.env.deploy` 新增（不进 Git，权限 600）：

```
QIANYI_ENABLED=false
QIANYI_BASE_URL=https://www.qianyierp.com
QIANYI_APP_ID=...
QIANYI_APP_SECRET=...
QIANYI_SHOP=LUWAG- PH
QIANYI_WAREHOUSE_ID=71537
QIANYI_WAREHOUSE=PH-DAVAO-01
QIANYI_LOGISTICS=SHIPDOC-STD
```

默认 `QIANYI_ENABLED=false`，开关打开前不产生任何外部请求。密钥只经 `ConfigService` 读取，不下发前端、不写日志、不进后台页面明文。

该 `secretKey` 已在对话中明文出现过，联调通过后应在千易后台重置一次再写入服务器。

## 11. 错误处理与安全

- 签名错误、时间窗超限、未知 `serviceType`、超大 body 一律在业务之前拦截
- 回调日志脱敏：手机号、邮箱、地址不进日志与 `lastError`
- 推单失败只记 `errorCode/errorMsg`，不记完整收件人报文到日志
- 重推是幂等更新同一行任务，不会产生重复订单
- 千易侧已有 4,213 个 SKU 且属其他店铺，**所有请求都必须显式带 `shop`**，禁止依赖默认店铺

## 12. 测试策略

- `qianyi.client`：用文档中的签名样例复现签名结果；HTTP 错误/业务错误/超时分别归类
- `qianyi-order.mapper`：普通单、Bundle 行、折扣分摊、运费分摊、缺映射、缺净重
- `qianyi-sku.mapper`：资料齐全 / 缺尺寸 / 缺净重三种输入
- 建档勾选：未勾选的行不提交、勾选失败的行不回写编码、已映射的行不会被重复建档
- outbox：入队即试、失败退避、第 5 次转 FAILED、手动重推、重复入队不重复建行
- webhook：验签成功/失败、时间窗、重复回调幂等、乱序到达（SHIPPING_INFO 先于 ODO）
- 集成：确认订单 → 生成任务 → 假客户端推单 → 回推 ODO → 订单 `SHIPPING` + `Shipment` + 库存扣减 + 轨迹
- 对账：本地缺 Shipment 能补、已签收不被覆盖
- 前端：后台页、`/track-order` 轨迹时间线、商品表单千易编码字段

## 13. 上线与发布

1. 迁移 + 后端上线，`QIANYI_ENABLED=false`，验证无外部请求
2. 后台完成 SKU 建档与映射，未匹配数归零
3. 千易后台配置推送接收地址并勾选推送类型
4. 打开开关，先用一笔真实订单走通推单 → 回推全链路
5. 回滚：关闭开关即断开所有外部调用；迁移为加性，不需要回退表

## 14. 待确认事项

| 编号 | 事项 | 影响 |
|---|---|---|
| 1 | `SHIPDOC-STD` 是否支持 COD 代收，面单由谁出 | 若不支持，需要改用其他物流或走平台物流 |
| 2 | Webhook 的 `sign` 算法（文档只给了请求侧） | 先按同一算法实现，验签失败率在后台可见 |
| 3 | 千易是否接受 COD 单 `payTime` 取下单时间 | 已按此设计，需千易确认不被拒单 |
| 4 | 净重缺失时用毛重兜底是否可接受 | 已按此设计并标注，需确认 |

已定：发货仓 `PH-DAVAO-01`(71537) + `SHIPDOC-STD`；建档由系统执行、商品范围由后台勾选决定。
