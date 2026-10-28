# 千易 ERP 上线手册（订单同步）

日期：2026-10-28
对应设计：`docs/superpowers/specs/2026-10-28-qianyi-erp-integration-design.md`
对应实现计划：`docs/superpowers/plans/2026-10-28-qianyi-erp-order-sync.md`

上线前默认状态：`QIANYI_ENABLED=false`，后端不产生任何千易请求。

## 1. 千易后台（由有 ERP 账号的人操作）

1. 「设置 → 三方应用对接」打开 `LUWAG` 这个自研应用。
2. **IP 白名单**填生产出口 IP：`43.160.229.107`（= `luwag.shop` 的 A 记录）。
3. 勾选本次要用的能力：
   - 商品：商品列表查询、商品新增、商品编辑、商品启用/停用
   - 订单：订单创建并审核、订单关闭、订单列表查询、订单物流信息推送
   - 店铺：店铺列表查询　仓库：仓库列表查询、仓库物流查询
4. 「推送消息接收地址」填 `https://luwag.shop/api/v1/qianyi/webhook`，并勾选：
   - 出库反馈推送（`PUSH_ODO_ORDER`）
   - 订单物流信息推送（`PUSH_SALES_ORDER_SHIPPING_INFO`）
   - 物流跟踪状态变更推送（`PUSH_TRACKING_PACKAGE`）
5. 确认店铺 `LUWAG- PH` 处于「店铺已授权」，发货仓 `PH-DAVAO-01`、物流 `SHIPDOC-STD` 可用。

## 2. 服务器环境变量

在 `/opt/small-house-commerce/small-house-commerce/.env.deploy` 追加（`chmod 600`，**不进 Git**）：

```
QIANYI_ENABLED=true
QIANYI_BASE_URL=https://www.qianyierp.com
QIANYI_APP_ID=<三方应用对接页的 accessId>
QIANYI_APP_SECRET=<三方应用对接页的 secretKey>
QIANYI_SHOP=LUWAG- PH
QIANYI_WAREHOUSE_ID=71537
QIANYI_WAREHOUSE=PH-DAVAO-01
QIANYI_LOGISTICS=SHIPDOC-STD
```

> `QIANYI_SHOP` 里的空格是名字的一部分，不要删。
> 凭证在本项目的对话记录里明文出现过，**建议先在千易后台重置一次 secretKey 再填入**。

## 3. 部署

```bash
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend
```

**必须带 `--env-file .env.deploy`**，否则 `DATABASE_URL` 为空，后端会以 Prisma `P1010` 反复重启。

迁移 `20261028120000_add_qianyi_order_sync` 由后端容器入口的 `prisma migrate deploy` 自动应用（加性：两张新表 + 四个可空列）。

## 4. 打开开关后的第一轮检查

1. 后台 `/admin/settings/qianyi`：应显示「已启用」，待推送 0 / 失败 0。
2. 列表里 62 个 SKU 中，可建档的应约 49 个（缺尺寸/毛重的会显示「缺 …」且无法勾选）。
3. **只勾选首批要上架的商品**，点「建档选中的 N 个」；结果里 `Created x / y`。
4. 建档成功的行会显示千易编码；其余行保持空白，**空白行永不推单**。

## 5. 推单验收（用一笔真实订单）

1. 前台下一笔 COD 订单（或后台录单），客服在订单工作台点「确认」。
2. 后台 `/admin/settings/qianyi` 的同步任务列表应出现 `PUSH_ORDER`，状态从 `PENDING` 变 `SENT`。
3. 千易「订单」里应出现该线上单号（`PH…`），状态为待发货。
4. 千易里点发货 → 我们会收到 `PUSH_ODO_ORDER`：
   - 订单变 `SHIPPING`，生成 `Shipment`，本地库存按实际出货量扣减；
   - 数量不一致时，订单备注里会写「ordered X, shipped Y」。
5. 打开 `/track-order`，用单号 + 手机号查询：卡片里应出现「Tracking」区块，显示承运商、运单号与状态节点。

## 6. 推送失败怎么办

- 任务列表里 `FAILED` 的行有「重推」按钮；重推会把该行拉回队列并立刻尝试。
- 失败原因写在任务行下方（形如 `SERVICE_TYPE_NOT_ALLOW: 权限不足`），据此去千易补权限或改映射。
- 超过 5 次自动转 `FAILED`，不会无限重试。
- 缺 SKU 映射的订单 `enqueue` 阶段就会失败并直接标 `FAILED`（不会重试 5 次），补齐映射后重推。

## 7. 回滚

```bash
# .env.deploy 里改回
QIANYI_ENABLED=false
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend
```

关闭后：不推单、不调千易、worker 不启动。已推过的订单在千易侧保持原样，需要的话在千易后台手工处理。

迁移是加性的，回滚代码不需要回滚表结构；两张 `qianyi_*` 表留着不影响旧代码运行。

## 8. 已知未覆盖（二期）

- 库存双向同步：千易库存变动不会回写本站。
- 退货自动入库：`PUSH_RETURN_ORDER_INFO` 只留档不改库存。
- 商品/价格同步：本站改价不会同步到千易。
- 面单打印：本站不取千易面单。
