# 千易 ERP 合并前检查包（2026-10-28）

状态：**未合并、未推送、未部署、`QIANYI_ENABLED` 未启用、未向千易写入任何数据。**

## 1. 基线

| 项目 | 值 |
|---|---|
| 生产服务器 HEAD | `36269e6`（截图/服务器实测） |
| 生产 HEAD 组成 | GitHub `main` `b0cbb81` + 尚未进 main 的结账幂等四提交（`097de32f`…`57e06efc`） |
| 本分支基线 | 已 rebase 到 `36269e6`，**不再基于旧代码** |
| 本分支最终 SHA | `01fae8f45310ff61f526c87da89e57b87ea7b4da` |
| 分支名 | `feat/qianyi-erp-integration` |
| 工作树 | `.claude/worktrees/qianyi-erp-20261028`（隔离） |

### 与生产基线的 Diff（`git diff refs/prod-inspect..HEAD`）

| 区域 | 文件 | 增 | 删 |
|---|---|---|---|
| `backend/prisma`（schema + 1 条加性迁移） | 4 | +119 | 0 |
| `backend/src`（千易模块、订单挂钩、物流事件、guest 投影） | 29 | +3357 | −6 |
| `frontend/src`（后台页、查单轨迹、i18n、admin-api） | 10 | +436 | 0 |
| `docs/superpowers`（设计、计划、两份 runbook） | 4 | +3475 | 0 |

删掉的 6 行全部在 `orders.service.ts` 的 guest 投影里（把整行 `...order` 展开改成显式字段），没有删除任何既有功能。

## 2. 本分支在可靠性上补的修复

| 编号 | 问题 | 现状 |
|---|---|---|
| R1 | 入站事务内写轨迹用的是根客户端，看到不刚建的 Shipment → 第一条真实出库回调必然 404 并整笔回滚 | `record(..., client)` 接受事务客户端 |
| R2 | 派发失败后回调已被"留档"，千易重试被判重复并 ACK → 永久丢单 | 只有 `processedAt` 有值才算重复；失败保留错误并返回 500 触发重发 |
| R3 | 同一运单、相同状态但**不同时间/地点**被当成重复 | 去重键加入 `shippingTime` + 城市/省/仓库名 |
| R4 | 并发两条相同回调都去插入 → 唯一键冲突 500 | 捕获 P2002 视为"已处理" |
| R5 | 15 分钟时间窗会把千易几小时后的**真实重试**丢掉 | 窗口放宽到 24 小时；签名始终强制 |
| R6 | 物流节点先于出库回调到达时只进备注，时间线缺失 | 出库落地时回放已归档的轨迹节点 |
| R7 | 任何已有 Shipment 都会让千易回调整单被丢弃（人工发货场景） | 重复判定改用千易出库单号 |
| R8 | 第二个包裹可能按订货量重复扣库存 | 按「已发数量」封顶，最多扣到订单数量 |
| R9 | 重推可能让千易重复建单（超时但千易已建单） | 重推前先 `QUERY_SALES_ORDER_LIST` 按线上单号查，命中则直接采纳 |
| R10 | 订单级优惠码折扣没摊到明细行，`payAmount` 合计 ≠ `grandTotal` | 按比例分摊，合计精确相等 |
| R11 | 缺 SKU 映射会让客服「确认」直接 500 | 记 `SKIPPED` 任务，确认照常成功，补齐映射可重推 |
| R12 | 净重缺失时用毛重兜底（数据不准确） | 净重缺失即不可建档（`productWeight` 成为硬门槛） |
| R13 | `shelfLife` 硬编码 90 天（凭空取值） | 改为 36500 天并在预览里显式说明，等待千易确认 |

## 3. 剩余风险（已知且未消除）

| 风险 | 影响 | 缓解 |
|---|---|---|
| **Webhook 签名算法未经真实样本验证** | 若千易回调签名与请求侧算法不同，所有回调会被判非法并留档 | 上线前必须用一条真实回调核对；后台「回调记录」能直接看到失败 |
| 出库回调字段名（`trackNumber` vs `trackingNumber`）、是否列出全部行、是否带城市 | 影响运单号/差异核对的准确性 | 代码两个名字都读；首单必须人工比对 |
| `SHIPDOC-STD` 是否支持 COD 代收未知 | 若不支持，COD 单无法用该物流履约 | 见第 4 节需千易确认项 |
| `shelfLife=36500` 是否被千易接受 | 可能被拒单或影响效期管理 | 见第 4 节 |
| 本地只有 `Manila Central` 一个仓库，与 `PH-DAVAO-01` 不对应 | 出库扣减记在 Manila Central 名下 | 新增 `QIANYI_LOCAL_WAREHOUSE_ID` 可绑定；不设则沿用默认仓 |
| 公开 webhook 无频控、归档无清理任务 | 可被写放大；`qianyi_webhook_events` 会增长 | 目前单行上限 64KB；后续加清理 |
| 确认后最长 30 秒才推送 | 客服确认后千易侧不是立即出现 | 可调 `WORKER_INTERVAL_MS`，或后续在 `enqueue` 后立即尝试 |
| `SKIPPED` 任务不能在后台直接重推 | 需先填映射 | 填完映射后该行仍留在任务列表，可手动改状态后重推 |
| 前端全量套件在本机会因负载出现偶发失败 | 本机验证噪声 | 同一提交多次运行均能全绿；CI 上建议单机跑 |

## 4. 真实联调必须由人工/千易提供

1. **一条真实回调样本**（完整 form-data：`appId` / `serviceType` / `bizParam` / `timestamp` / `sign`），用于验证签名算法。
2. 确认 **webhook 的签名算法**是否与请求侧一致（文档只给了请求侧）。
3. `SHIPDOC-STD` 的**实际承运商**、是否支持 **J&T**、是否支持 **COD 代收**。
4. 出库回调 `PUSH_ODO_ORDER` 的真实字段名（`trackNumber`?）、是否逐行列全、是否带 `city`/`province`。
5. COD 单 `payTime` 用**下单时间**是否被千易接受（且不会因此把订单标记为已付款）。
6. `shelfLife` 对家具的合规取值。
7. IP 白名单保持 `43.160.229.107`（生产出口 IP）。
8. **轮换后的新 `accessId`/`secretKey`** —— 旧凭证在聊天中出现过，启用前必须重置并使旧值失效。

## 5. 端到端验收方案

| 阶段 | 动作 | 通过标准 |
|---|---|---|
| P1 部署空转 | `QIANYI_ENABLED=false` 上线 | 迁移应用成功；后端无任何出站请求（日志 0 条 qianyi）；后台页可打开并显示「未启用」；62 行预览里 23 行可勾选 |
| P2 只读联调 | 在服务器上跑只读脚本（`QUERY_SHOP_LIST`/`QUERY_WAREHOUSE_LIST`/`QUERY_SIMPLE_LIST_SKU`/`QUERY_SALES_ORDER_LIST`） | 全部 `state=success`；返回 `LUWAG- PH`、`PH-DAVAO-01`、`SHIPDOC-STD` |
| P3 建档 1–2 个 | 后台勾选 `SH-TABLE-001`（尺寸/重量齐全）→ 建档 | 千易后台出现该商品；本站该行回写千易编码 |
| P4 首单 | 真实订单 → 客服确认 | 任务 `PENDING→SENT`；千易出现该线上单号（待发货） |
| P5 发货 | 千易后台对首单点发货 | 本站订单转 `SHIPPING`、生成 Shipment、按实际数量扣库存、`/track-order` 出现运单号与首条轨迹 |
| P6 轨迹 | 千易推进物流状态 | `/track-order` 时间线追加节点；重复回调不重复记账 |
| P7 取消 | 另一笔已推送订单在后台取消 | 生成 `CLOSE_ORDER` 任务并 `SENT`；千易侧该单关闭 |
| P8 异常演练 | 临时清空某 SKU 的千易编码后确认订单 | 订单确认成功、任务为 `SKIPPED`；补回编码后重推成功 |
| P9 回滚演练 | `QIANYI_ENABLED=false` 重启 | 不再有任何出站请求；后台「未启用」；已有数据不变 |

每一步都要记录：任务行状态、千易侧单号、本站订单状态、库存变动量、`/track-order` 截图。

## 6. 分阶段启用与安全部署

```bash
# 1) 先备份
/usr/local/sbin/smallhouse-backup.sh

# 2) 部署但保持关闭（.env.deploy 只加 QIANYI_* 的值，QIANYI_ENABLED=false）
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend
# ★ 必须带 --env-file，否则 DATABASE_URL 为空且后端会反复重启

# 3) 确认空转
docker compose --env-file .env.deploy -f docker-compose.prod.yml logs --since 10m backend | grep -i qianyi   # 期望 0 行
```

启用顺序：P2 只读通过 → P3 建档 → 把 P3 的 SKU 填好映射 → 再 `QIANYI_ENABLED=true` 重启后端 → P4 首单。

**建议**：第一批只启用 1–2 个 SKU 的映射，其余保持空白（空白行永不推单），确认链路后再逐步放开。

## 7. 回滚

| 场景 | 操作 | 说明 |
|---|---|---|
| 关闭集成 | `.env.deploy` 设 `QIANYI_ENABLED=false` → `up -d backend` | 立刻停止所有出站请求与 worker；数据保留 |
| 回滚代码 | `small-house-prod-backend:<回滚标签>` 重新 `up -d --no-deps backend` | 发布时按既有流程打回滚标签 |
| 回滚数据库 | **不需要** | 迁移是加性的（2 张新表 + 4 个可空列），旧代码照常运行 |
| 单笔订单纠错 | 后台重推 / 千易后台人工处理 | 本站不自动退款、不改金额 |

千易侧已推送的订单在关闭开关后保持原状，需要人工在千易后台关闭。

## 8. 验证证据（本地）

- 后端：`pnpm vitest run` → **2332 通过 / 0 失败**（rebased 基线），`nest build` 退出 0
- 前端：`pnpm vitest run` → **3346 通过 / 0 失败**，`tsc --noEmit` 退出 0
- 迁移：在一次性 `postgres:18` 容器上跑完整链条（含生产已有的幂等迁移），2 张千易表 + 4 个列均创建成功，容器已销毁
- 凭据：全分支 git 历史与工作树中密钥命中 **0**；真实 `accessId` 已从测试夹具与文档替换为占位符
- 生产库：全程只读 `SELECT`，未写任何订单/商品/库存/客户/Meta 数据
