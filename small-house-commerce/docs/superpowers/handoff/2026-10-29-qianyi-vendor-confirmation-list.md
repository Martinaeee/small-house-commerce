# 千易 ERP 联调资料与确认清单

版本：2026-10-29。对应本站候选 `af14094d`（基于生产 `36269e66`），**尚未合并、未部署、未启用**。
本清单用于向千易接口管理员、千易仓配负责人和 LUWAG 运营同事逐项取证；**未勾选确认前，生产开关保持 `QIANYI_ENABLED=false`**。

回传要求：逐项填写下表并在“证据”列附上截图、导出文件或邮件原文。**不要在任何工单、聊天或邮件正文中发送 `appSecret` 明文**；签名样本可保留 `sign`，但 `appSecret` 一律打码。

---

## 0. 已知固定信息（无需重复确认，仅作对照）

| 项目 | 当前值 |
|---|---|
| 千易登录域 | `https://www.qianyierp.com`（国内生产）；海外 `asia.qianyierp.com`；测试 `gerp-test1.800best.com` |
| 三方应用名 | `LUWAG`（自研应用） |
| IP 白名单 | `43.160.229.107`（= luwag.shop 生产出口） |
| 店铺 | `LUWAG- PH`（platform `OTHER`、siteCode `PH`） |
| 目标仓 | `PH-DAVAO-01` / `71537` |
| 物流编码 | `SHIPDOC-STD` |
| 回调路径（拟） | `https://luwag.shop/api/v1/qianyi/webhook`（**尚未在千易后台配置**） |

> 注意：该账号下还有 surebuy / TikTok / Shopee 等大量店铺，本站所有请求都必须显式带 `shop`，不能依赖“默认店铺”。

---

## 1. 接口权限清单

请在“状态”列填写：已开通 / 未开通 / 需额外申请；在“限制”列写明频率、并发、按店铺或按仓库的权限范围。

| # | serviceType | 用途 | 本站调用点 | 状态 | 限制与备注 |
|---|---|---|---|---|---|
| 1.1 | `QUERY_SHOP_LIST` | 核对店铺与授权状态 | 只读验证已用 | | |
| 1.2 | `QUERY_WAREHOUSE_LIST` | 核对仓与可用物流 | 只读验证已用 | | 是否可按 `shop` 过滤 |
| 1.3 | `QUERY_SIMPLE_LIST_SKU` | 绑定时核对 SKU 编码是否存在 | `qianyi-admin.controller.ts`（保存映射前） | | **按 `skus` 数组精确过滤已实测生效**；返回行以 `row.sku` 匹配，含 `purchaseCost` |
| 1.4 | `QUERY_SALES_ORDER_LIST` | 推单前查重、每日对账 | `qianyi-sync.service.ts` | | `onlineOrderNumber` 是否精确匹配；`shop` 过滤是否生效；分页上限 |
| 1.5 | `QUERY_FIRST_LRG_LOGISTICS` | 查可选物流 | 只读验证已用 | | |
| 1.6 | `INSERT_SKU_INFO` | 建档（写） | **本站不再调用**：SKU 由运营在千易后台建档 | 不申请 | 若未来要恢复自动建档，需先确认重复提交行为 |
| 1.7 | `CREATE_AND_AUDIT_SALES_ORDER` | 推单并免人工审核（写） | `qianyi-sync.service.ts:160` | | 确认 `onlineOrderNumber` 唯一性范围 |
| 1.8 | `CLOSE_SALES_ORDER` | 取消/关闭远端订单（写） | `qianyi-sync.service.ts:165` | | 确认哪些状态可关闭、关闭后是否还能恢复 |
| 1.9 | 回调推送配置 | 千易主动推送物流/出库 | `qianyi/webhook` | | 是否支持自定义 URL、是否只支持 https、是否有签名密钥 |

**重点确认（1.9）**：千易后台配置回调地址时，是否需要我们提供回调专用密钥？回调签名是否复用三方应用的 `appSecret`？

---

## 2. 真实签名样本与回调协议

本站目前所有签名都是**自签**，只能证明实现自洽，不能证明与千易一致。请提供真实样本。

### 2.1 需要的四类回调样本

| # | serviceType | 触发动作 | 需要样本数 |
|---|---|---|---|
| 2.1.1 | `PUSH_ODO_ORDER`（`status=SHIPPED`） | 千易出库 | 1 份 |
| 2.1.2 | `PUSH_SALES_ORDER_SHIPPING_INFO` | 运单/承运商信息 | 1 份 |
| 2.1.3 | `PUSH_TRACKING_PACKAGE` | 轨迹（中间态 + `DELIVERED`） | 2 份 |
| 2.1.4 | `PUSH_RETURN_ORDER_INFO` | 退货 | 1 份（如本期不启用退货，请明确说明） |

### 2.2 每份样本必须包含

| 项目 | 说明 |
|---|---|
| 原始 HTTP 方法/路径 | 是否为 `POST`，`Content-Type: multipart/form-data; boundary=…` |
| 五个字段原文 | `appId`、`serviceType`、`bizParam`（**原始字节，不要重新序列化**）、`timestamp`、`sign` |
| 接收时间 | 千易发送时间 + 我方接收时间（注明时区，建议 UTC+8） |
| 对应业务标识 | `onlineOrderNumber`、千易 `orderNumber`（出库单号）、`trackingNumber` |
| 是否存在稳定事件 ID | `bizParam` 里是否有 `eventId` / `eventID` / 唯一流水号字段？字段名与示例值 |

### 2.3 签名算法确认

| # | 待确认项 | 我方当前实现 |
|---|---|---|
| 2.3.1 | 参数名 ASCII 升序拼 `k=v`，末尾直接拼 `secretKey`，MD5 小写 | 是（`qianyi.client.ts` `signQianyiRequest`） |
| 2.3.2 | 回调是否与请求同一算法、同一密钥 | 假设是，**未验证** |
| 2.3.3 | `timestamp` 单位：毫秒还是秒 | 接受 10–13 位数字，但**按毫秒**与当前时间比较；若千易是 10 位秒级时间戳会被判过期，请明确单位 |
| 2.3.4 | 回调 `timestamp` 是“发送时间”还是“业务发生时间” | 按发送时间理解 |
| 2.3.5 | 签名有效期窗口 | 假设 ±24 小时 |
| 2.3.6 | `bizParam` 是否需要与 HTTP 层发送的字符串**逐字节一致** | 是 |

### 2.4 请提供一份可复算的验签样例

给出 `appId` + `bizParam` + `serviceType` + `timestamp` + **脱敏后的 secret（如 `abcd…wxyz`，长度与首尾字符保留）** + 期望 `sign`，让我方离线复算一致。若不便提供 secret，可提供千易侧验签 SDK/文档中的官方测试向量。

---

## 3. 回调重试与 ACK 语义（决定“永久失败”如何处理）

| # | 待确认项 | 为什么重要 |
|---|---|---|
| 3.1 | 我方返回什么才算“成功”？HTTP 200 即可，还是必须特定 JSON（如 `{"state":"success"}`）？ | 当前返回 `{ok:true}`；若千易只认特定包体，会造成“假成功”或无限重试 |
| 3.2 | 返回非 200 / 解析失败时，重试间隔与次数？ | 决定退避与告警 |
| 3.3 | 重试总时长上限（小时/天）？是否会超过 24 小时？ | 当前 >24h 直接拒绝且不归档 |
| 3.4 | 单次回调的**超时时间**是多少？ | 我方事务最长 20s，需小于该值 |
| 3.5 | 重复投递是否保证 `sign` 不变、`bizParam` 不变？ | 当前按事件指纹去重 |
| 3.6 | 是否可能乱序（`DELIVERED` 先于 `SHIPPED`）？ | 状态机需要单调 |
| 3.7 | 多包裹订单是否**每次**都带 `trackingNumber` 与出库号？ | 无运单的多包裹回调目前被拒 |
| 3.8 | 永久性业务冲突（如订单已取消、SKU 无映射）时，希望我方返回 200 停止重试，还是持续 5xx 让你们重试？ | 决定设计 B 的终态 |

---

## 4. 远端订单幂等

| # | 待确认项 | 我方现状 |
|---|---|---|
| 4.1 | 同一 `shop` + 同一 `onlineOrderNumber` 重复调用 `CREATE_AND_AUDIT_SALES_ORDER`：拒绝、覆盖，还是建第二单？ | 假设会重复建单，因此本站**最多自动发一次** |
| 4.2 | 若拒绝，`errorCode` / `errorMsg` 是什么？是否返回已有 `orderNumber`？ | 需要精确错误码才能“采纳已有单” |
| 4.3 | 请求超时后，千易侧是否可能已建单？如何查询确认？ | 操作人需在千易后台核对 |
| 4.4 | `QUERY_SALES_ORDER_LIST` 按 `onlineOrderNumber` + `shop` 是否**精确唯一**返回？ | 当前用它做推单前查重 |
| 4.5 | `onlineOrderNumber` 的唯一范围：全账号 / 单店铺 / 单仓库？ | 影响多店场景 |
| 4.6 | 已建单后金额或明细变化，是否有“修改订单”接口？还是必须作废重建？ | 合并订单场景需要 |
| 4.7 | 是否有“作废/删除测试订单”接口，供联调清理？ | 联调必需，否则测试单会堆积 |

---

## 5. 仓库映射

| # | 待确认项 | 我方现状 |
|---|---|---|
| 5.1 | `PH-DAVAO-01` / `71537` 是否就是 `LUWAG- PH` 的实际发货仓？ | 配置默认值 |
| 5.2 | 该仓与本站本地仓 `Manila Central` 是否**同一物理仓**？若不是，哪个千易仓对应本地仓？ | 本地仓 UUID 需写入 `QIANYI_LOCAL_WAREHOUSE_ID` |
| 5.3 | 出库回调扣减的库存，是否就是该仓库存？与本站库存是否独立？ | 本站按本地预留仓扣减 |
| 5.4 | `warehouse`（名称）与 `warehouseId` 是否必须同时传且互相匹配？ | 是 |
| 5.5 | 仓库存不足时，`CREATE` 的 `errorCode` 是什么？ | 需要区分“可重试”与“业务拒绝” |
| 5.6 | 回调中的 `warehouseName` / `warehouseId` 是否稳定可用于校验？ | 当前不依赖回调仓名，但会校验本地仓 |

---

## 6. 物流 `SHIPDOC-STD` 与 J&T

| # | 待确认项 |
|---|---|
| 6.1 | `SHIPDOC-STD` 的实际承运商是谁？是否固定为 J&T？ |
| 6.2 | `PH-DAVAO-01` 是否只有 `SHIPDOC-STD` 可用于独立站订单？是否有 J&T 专用编码？ |
| 6.3 | 运单号前缀/长度规则；同一订单是否可能拆成多个运单？ |
| 6.4 | 回调里的 `carrier` 字段是否一定会给真实承运商名（而不是 `SHIPDOC`）？ |
| 6.5 | 面单由千易生成还是由承运商系统生成？（本期不做面单打印，仅记录） |
| 6.6 | 是否支持“取消出库/拦截包裹”？ |

---

## 7. COD 与 `payTime`

| # | 待确认项 | 我方现状 |
|---|---|---|
| 7.1 | COD 订单 `payTime` 填**下单时间**是否被接受？ | 是（`qianyi-order.mapper.ts:173`，格式 `YYYY-MM-DD HH:mm:ss+08:00`） |
| 7.2 | 这样是否会被千易标记为“已付款”？ | 本站**不写**任何支付状态 |
| 7.3 | `codPayAmount` 是否等于订单应付总额（含运费、已扣折扣）？ | 是（`grandTotal`） |
| 7.4 | `freight` 与 `skuList[].shippingPrice`、`payAmount` 的口径是否如我方拆分（订单运费按金额比例分摊、尾差落最后一行）？ | 是 |
| 7.5 | 千易是否回传 COD 收款/对账状态？走哪个回调或查询接口？ | 当前未接 |
| 7.6 | `paymentMethod` 除 `COD` 外是否还有其他枚举需要支持？ | 目前仅 COD |

---

## 8. SKU 建档（改由运营在千易后台完成）

**本站不再调用 `INSERT_SKU_INFO`**，因此本轮不需确认 `shelfLife`、`picUrl`、`type` 等建档报文字段——这些由贵司后台界面负责校验。

| # | 待确认项 | 说明 |
|---|---|---|
| 8.1 | 家具类目在千易后台建档时，“保质期”一栏应填什么？ | 运营需要可执行的填写口径，避免直接影响仓配/效期逻辑 |
| 8.2 | 后台建的 SKU 是否立即可被 `QUERY_SIMPLE_LIST_SKU` 查到？有无同步延迟？ | 影响绑定后马上推送订单是否会失败 |
| 8.3 | 建档时是否有“店铺”归属要求（必须选 `LUWAG- PH`）？ | 绑定只传 `shop=LUWAG- PH` |

---

## 9. SKU 编码与绑定口径

| # | 待确认项 | 我方现状 |
|---|---|---|
| 9.1 | `sku` 编码唯一范围：全账号 / 单店铺 / 单仓库？ | 按单店铺假设 |
| 9.2 | `QUERY_SIMPLE_LIST_SKU` 的 `skus` 数组过滤是否稳定生效？单次最多几个？ | 已实测单值生效，绑定保存前逐条核验 |
| 9.3 | 返回行是否含千易内部主键、规格/颜色等属性？ | 当前只用 `sku` 与 `purchaseCost` |
| 9.4 | 推送订单时 `skuList[].sku` 是否就是目录里的 `sku`（而非店铺级编码/规格编码）？ | 直接使用绑定值 |
| 9.5 | 同一 `sku` 在目录里出现多条（不同规格）时如何区分？ | 当前要求一码一行，重复即拒绝 |

---

## 10. 测试环境

| # | 待确认项 |
|---|---|
| 10.1 | `gerp-test1.800best.com` 是否可用？提供测试 `appId` / 测试店铺 / 测试仓 / 测试物流编码 |
| 10.2 | 测试环境是否与生产数据隔离？能否创建/删除测试订单？ |
| 10.3 | 测试环境是否支持回调到公网地址（可用临时隧道）？ |
| 10.4 | 正式联调前，能否安排一个固定窗口与千易侧值班同学同步看日志？ |

---

## 11. 凭据与白名单

| # | 待确认项 |
|---|---|
| 11.1 | 请重置 `appSecret` 并使旧 secret 失效（旧值曾在对话中出现过） |
| 11.2 | 是否支持双 secret 过渡期（新旧并存 24 小时）？ |
| 11.3 | 确认白名单仅保留 `43.160.229.107`；是否需要加入测试机出口 IP？ |
| 11.4 | 千易回调出口 IP 是否固定？请提供列表（用于限流白名单/告警） |

---

## 12. 回传与关闭条件

本清单关闭（可进入“隔离环境验证”）的最低条件：

1. 第 1、2、3、4、5、6、7、8、9 节全部有明确答复，且第 2 节提供至少 4 份真实样本。
2. 第 10 节测试环境可用，第 11 节凭据已轮换。
3. 双方书面确认：**在正式授权前，LUWAG 不会在生产调用 `CREATE_AND_AUDIT_SALES_ORDER` / `CLOSE_SALES_ORDER`**（本站不调用 `INSERT_SKU_INFO`）。

未满足上述条件时，生产保持停用，本站不合并、不部署千易候选。

---

## 附：本站当前实际发送字段（供千易核对）

**建档**：本站不发送，SKU 由运营在千易后台创建。

**SKU 核验 `QUERY_SIMPLE_LIST_SKU`**：`shop=LUWAG- PH`、`page=1`、`pageSize=5`、`skus=[绑定编码]`（path `sku`）。

**推单 `CREATE_AND_AUDIT_SALES_ORDER`**：`shop`、`onlineOrderNumber`、`paymentMethod=COD`、`codPayAmount`、`freight`、`currency`、`buyerMessage`、`payTime`、`warehouse`、`warehouseId`、`logistics`、`buyer{receiverName, phone, email, country=PH, province, city, district, address1, postCode}`、`skuList[{sku, quantity, paymentPrice, shippingPrice, payAmount, promotionDiscount, originalPrice}]`（金额为 4 位小数字符串）。

**关单 `CLOSE_SALES_ORDER`**：`shop`、`onlineOrderNumber`。
