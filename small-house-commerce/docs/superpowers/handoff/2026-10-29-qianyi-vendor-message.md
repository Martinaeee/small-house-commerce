# 发给千易的对接确认消息（可直接复制）

更新时间：2026-10-29。配套完整清单见 `2026-10-29-qianyi-vendor-confirmation-list.md`；以下为最小必答项，回答完即可进入联调。

---

您好，我们已完成千易 OpenAPI 的只读验证（店铺 `LUWAG- PH`、仓 `PH-DAVAO-01` / 71537、物流 `SHIPDOC-STD`）。正式启用前需要确认以下 6 项，麻烦逐条回复：

1. **回调签名**
   请提供 1 份真实回调样本（`appId` / `serviceType` / 原始 `bizParam` 字节 / `timestamp` / `sign`），用于离线复算；并说明回调验签是否与请求同一算法、同一密钥。
   `timestamp` 是 10 位秒还是 13 位毫秒？回调超过多少小时后不再重试？

2. **回调应答与重试**
   我们返回 HTTP 200 + `{"ok":true}` 是否视为已接收？返回 500 时你们的重试间隔与最大次数是多少？

3. **推单幂等**
   重复调用 `CREATE_AND_AUDIT_SALES_ORDER` 且 `onlineOrderNumber` 相同时，返回什么（报错码 / 返回原单 / 再建一单）？`onlineOrderNumber` 的唯一范围是店铺还是账号？

4. **仓配**
   `PH-DAVAO-01` / 71537 与我们本地仓 `Manila Central` 的物理对应关系请确认；`SHIPDOC-STD` 实际承运商是谁，是否可指定 J&T？

5. **COD**
   `paymentMethod=COD`、`payTime=下单时间`、`codPayAmount=订单总额` 的口径是否正确？未收款前订单在千易里显示什么状态？

6. **退货**
   本期是否启用 `PUSH_RETURN_ORDER_INFO`？若启用，请提供 1 份样本并说明退货单与出库单的关联字段。

另：SKU 由我方运营在千易后台建档，本站只绑定已存在的 `sku` 编码，因此**不需要** `INSERT_SKU_INFO` 权限；但请确认后台新建的 SKU 能被 `QUERY_SIMPLE_LIST_SKU` 立即查到（有无同步延迟）。

我们目前**不会**在生产调用 `CREATE_AND_AUDIT_SALES_ORDER` / `CLOSE_SALES_ORDER`，答复确认前保持停用。
