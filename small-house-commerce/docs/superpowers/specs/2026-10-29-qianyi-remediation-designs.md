# 千易接入：四项整改设计（未实现，待授权）

日期：2026-10-29。基线：候选 `af14094d`（生产 `36269e66` + 24 提交），生产保持停用。

**本文只做设计与测试用例，不改业务代码、不新建迁移、不调用真实千易。** 四项均存在业务规则前置条件，未获千易书面确认前不得进入实现。

优先级：A（SKU 国外创建幂等）= P0 合并阻断；B（永久冲突终态）= P1 部署阻断；C（迟到回调）= P1 部署阻断；D（多实例限流）= P2 可与首单联调并行。

---

## A. SKU 远端创建幂等

### A.1 现状与缺陷证据

- `qianyi-admin.controller.ts:112-118`：逐个 SKU 调 `INSERT_SKU_INFO`，**成功后才**写本地 `qianyiSkuCode`。
- 超时/连接断开/进程退出时：千易可能已建档，本地仍为空映射；再次勾选同一 SKU 会**重复建档**。
- 无本地任务表、无 attempt 计数、无“待核对”状态、无审计备注。
- `QUERY_SIMPLE_LIST_SKU` 只用于只读验证，未用于建档前查重。

### A.2 目标行为

与订单推送同一原则：**远端最多自动写一次**；结果不明一律停在“待核对”，由操作人确认后再授权一次。

### A.3 设计

新增表（**提议**，迁移文件 `20261030xxxxxx_qianyi_sku_jobs`，本阶段不创建）：

```
qianyi_sku_jobs
  id UUID PK
  sku_id UUID NOT NULL UNIQUE -> skus(id) ON DELETE CASCADE
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    -- PENDING | SENDING | SENT | FAILED | REVIEW | CANCELLED
  attempts INT NOT NULL DEFAULT 0
  auto_create_attempts INT NOT NULL DEFAULT 0
  claimed_at TIMESTAMPTZ(3)
  remote_code VARCHAR(255)
  last_error VARCHAR(1024)
  last_action VARCHAR(1024)
  requested_by UUID
  created_at / updated_at
```

流程：

1. 后台勾选 → **同一事务**内 `upsert`（`sku_id` 唯一）：已有 `SENT/SENDING` 直接返回；`REVIEW` 不因再次点击而复活。
2. worker 用 `UPDATE … WHERE status='PENDING' … FOR UPDATE SKIP LOCKED RETURNING` 领取 → `SENDING`；租约 10 分钟，超时 → `REVIEW`。
3. 发送前 `QUERY_SIMPLE_LIST_SKU` 精确查该编码：
   - 命中 1 条 → 不发 CREATE，直接 `SENT` + 同事务写 `skus.qianyi_sku_code`；
   - 命中 0 条 → `auto_create_attempts` 0→1（条件更新，只有一次），调用 `INSERT_SKU_INFO`；
   - 命中 ≥2 条 → `REVIEW`（歧义），不写映射。
4. 响应分类：
   - 明确业务拒绝（字段非法、编码冲突且可判定）→ `FAILED`（允许普通重试，但**仅当从未发出 CREATE**）；
   - 传输超时 / 非 JSON / 未知结果 → `FAILED` + `REVIEW`，禁止自动重试。
5. 成功后在**同一事务**写 `SENT`、`remote_code`、`skus.qianyi_sku_code`、订单备注（SYSTEM）。
6. 后台动作：
   - `POST /admin/qianyi/skus/jobs/:id/retry`（仅从未 CREATE 的 `FAILED`）
   - `POST /admin/qianyi/skus/jobs/:id/authorize-retry`（body `{confirmedAbsent:true}`，仅 `REVIEW` 且 `auto_create_attempts>0`）
   - 批量勾选**不得**绕过单 SKU 状态。
7. `QIANYI_ENABLED=false` 时：不调用任何远端接口，不创建任务（或创建即 `CANCELLED`，二选一，倾向不创建）。

### A.4 前置业务确认（阻断实现）

1. 重复 `INSERT_SKU_INFO` 的远端行为与 `errorCode`。
2. `QUERY_SIMPLE_LIST_SKU` 能否按 `sku` 精确过滤、返回是否含千易主键。
3. `sku` 唯一范围（账号/店铺/仓库）。

未确认时的替代方案：不做远端查重，纯靠“最多一次 + 人工核对”；但操作人核对成本更高，且无法自动采纳已存在的 SKU。

### A.5 测试用例（RED → GREEN，隔离库 + fake client）

| ID | 前置条件 | 操作 | 预期（RED 时应失败） |
|---|---|---|---|
| A-1 | 一个未映射、字段齐全的 SKU | 两个并发请求同时勾选同一 SKU，worker 并发领取 | fake `INSERT_SKU_INFO` 只被调 **1** 次；`qianyi_sku_jobs` 1 行 `SENT`；`skus.qianyi_sku_code` 1 个值 |
| A-2 | 同上 | fake client 抛超时 | job `FAILED` + `REVIEW`；映射仍为空；后续 tick 不再发送；`auto_create_attempts=1` |
| A-3 | 千易已存在同码 SKU | fake 查询返回 1 条 | 不发 CREATE；job `SENT`；本地映射写入；`auto_create_attempts=0` |
| A-4 | 查询返回 2 条同码 | 执行 worker | job `REVIEW`；不写映射；不调用 CREATE |
| A-5 | A-2 后的 REVIEW | 未确认就点授权 → 再确认后授权 | 第一次 400/拒绝；第二次只再发 1 次 CREATE；第三次被拒 |
| A-6 | 字段缺净重/尺寸 | 勾选 | 不创建任务、不调用远端（沿用现有 readiness） |
| A-7 | `QIANYI_ENABLED=false` | 勾选并等待 worker | 0 次远端调用；无 `SENT` |
| A-8 | 已领取后模拟进程退出 | 推进时间 10 分钟 | job 转 `REVIEW`；不自动重发 |
| A-9 | A-1 成功后再次勾选 | 重复点击 | 不产生第二次 CREATE（`SENT` 短路） |

验收证据：上述 9 条全绿；`qianyi_sku_jobs` 行数与远端调用次数断言；日志无 `appSecret`。

---

## B. 永久业务冲突回调的终结状态

### B.1 现状与缺陷证据

- `qianyi-inbound.service.ts` 对未知订单、已取消订单、无映射、运单歧义、数量冲突、仓库不匹配等抛 `BadRequestException`。
- `qianyi-webhook.service.ts:127-132`：捕获后写 `error`、保持 `processedAt=null`、返回 `retryable:true` → 控制器 500 → 千易持续重试。
- 这些是**数据/业务事实**，重试不会自行恢复；形成无限 5xx，也会淹没真实的瞬时故障。

### B.2 目标行为

- 瞬时故障：继续 5xx，让千易重试（当前行为正确）。
- 永久冲突：只应用一次判断，进入**可审计的终态**，按千易确认的 ACK 语义停止重试；运营在后台可见、可修数据后手动重放。
- 任何终态都不丢弃原始归档。

### B.3 设计

归档表新增列（**提议**，迁移 `20261030xxxxxx_qianyi_webhook_failure_class`，本阶段不创建）：

```
qianyi_webhook_events
  failure_class VARCHAR(16) NULL      -- TRANSIENT | PERMANENT
  attempts INT NOT NULL DEFAULT 0
  terminal_at TIMESTAMPTZ(3) NULL
  resolution VARCHAR(32) NULL         -- REPLAYED | ADOPTED | IGNORED | ...
  resolved_by UUID NULL
  resolved_at TIMESTAMPTZ(3) NULL
```

错误映射（新建 `qianyi-error-class.ts`，纯函数）：

- PERMANENT：`Unknown Qianyi online order`、`Qianyi outbound requires a confirmed, open order`、`Unresolved risk flag blocks Qianyi outbound`、`Qianyi outbound has no frozen sent SKU mapping`、`Missing or ambiguous frozen Qianyi SKU mapping`、`Ambiguous Qianyi shipment identity`、`Qianyi callback does not identify which parcel`、`Qianyi warehouse differs from reserved inventory`、`Qianyi outbound exceeds the unshipped order quantities`、`Qianyi outbound already belongs to another order`。
- TRANSIENT：Prisma 连接/事务/锁超时、未知异常、数据库写入失败。
- 未知 `BadRequestException` 文案**默认 TRANSIENT**（保守），并在发布前补齐映射表。

处理：

1. PERMANENT → `failure_class=PERMANENT`、`terminal_at=now()`、写 `orderNote(SYSTEM)` 与后台计数；返回千易确认过的“成功”形态（若 200 即成功 → `{ok:true,permanent:true}`）。
2. TRANSIENT → 保持 `processedAt=null`、`attempts+1`、500。
3. `attempts ≥ QIANYI_CALLBACK_MAX_ATTEMPTS`（默认 20）→ 转 PERMANENT/REVIEW，止住无限 500。
4. 后台新增 `/admin/qianyi/callbacks`：按 `failure_class`、`terminal_at` 过滤；每行可“重新应用”（幂等，成功写 `resolution=REPLAYED`、`resolved_by`）。
5. 不删除归档行；每日清理只删 90 天前 `processedAt` 非空的行（现有行为保留）。

### B.4 前置业务确认

- 千易认为“成功”的 HTTP 状态与包体（清单 3.1）。
- 重试次数/间隔/总时长（3.2–3.4）。
- 永久冲突时千易希望 200 停止还是继续重试（3.8）。

未确认时保持 5xx（当前行为），但先加 `attempts` 计数与告警，避免不可观测。

### B.5 测试用例

| ID | 前置条件 | 操作 | 预期 |
|---|---|---|---|
| B-1 | 回调指向不存在的 `onlineOrderNumber` | 投递两次 | 第一次终态 + 1 条运营备注；第二次不重复处理、不新增备注；订单/库存/包裹 0 变化 |
| B-2 | 订单已 `CANCELLED` | 投递 `SHIPPED` 回调 | 终态；无 shipment/无扣减；后台待处理 +1 |
| B-3 | 注入一次瞬时 DB 错误（事务内抛错） | 投递 → 再投递 | 第一次 500、`processedAt=null`、`attempts=1`；第二次成功且只应用一次 |
| B-4 | B-1 修好映射后 | 后台 replay | 应用一次；`resolution=REPLAYED`；`resolved_by` 有值；不重复扣减 |
| B-5 | 连续 20 次瞬时失败 | 第 21 次投递 | 转终态/REVIEW，不再 500 循环；有告警 |
| B-6 | 两个并发投递同一永久冲突 | 并发 | 只 1 条终态记录、1 条备注；`attempts` 不重复递增 |

---

## C. 超过 24 小时的合法回调

### C.1 现状与缺陷证据

- `qianyi-webhook.service.ts:69`：`Math.abs(now - timestamp) > 24h` 直接 `ok:false`，**不归档**。
- 控制器对 `ok:false` 返回 HTTP 200 `{ok:false}`，千易不会重试 → 事件**静默丢失**。
- 现状只能防重放，但不能处理“千易延迟推送/积压”或“我方停机超过一天”。

### C.2 目标行为

- 签名与格式校验始终严格；时间只影响“接受策略”，不再直接丢弃已签名事件。
- 迟到的合法事件：可归档、可应用，但永不覆盖更新的状态（状态机单调）。
- 超过策略上限：归档为 `LATE_REJECTED` 供人工补偿，而不是无声丢弃。

### C.3 设计

配置（新增，均默认保守）：

```
QIANYI_CALLBACK_MAX_SKEW_HOURS=24     # 正常窗口
QIANYI_CALLBACK_ACCEPT_LATE=false     # 默认关闭；千易确认后再开
QIANYI_CALLBACK_LATE_MAX_HOURS=168    # 接受迟到的上限（7 天）
```

归档新增列（**提议**，可与 B 合并为一个迁移）：

```
qianyi_webhook_events
  late BOOLEAN NOT NULL DEFAULT false
```

处理：

1. `|now - timestamp| ≤ MAX_SKEW` → 正常路径（现行为）。
2. 超过但 `ACCEPT_LATE=true` 且 `≤ LATE_MAX` → 归档 `late=true`，正常进业务；物流事件按 `eventTime` 排序去重，**状态不回退**（已 `SIGNED` 不再变 `IN_TRANSIT`）。
3. 超过 `LATE_MAX` 或 `ACCEPT_LATE=false` → 归档 `signValid=true`、`error=LATE_REJECTED`、`processedAt=null`，返回 200 收下（停止重试），后台人工补偿。
4. 未来时间戳（`timestamp > now + MAX_SKEW`）→ 仍然拒绝，不入库（防伪造）。
5. 迟到事件与正常事件共用同一 `externalKey` 去重；重复投递只应用一次。

### C.4 前置业务确认

- 千易实际重试窗口与是否会 >24h（3.3）。
- 迟到事件的签名是否仍可信（2.3.5）。
- 200 是否等于“已收下”（3.1）。

未确认时保持默认拒绝，但**改为一律归档 `LATE_REJECTED`**（这一条不依赖千易，可先做），避免静默丢事件。

### C.5 测试用例

| ID | 前置条件 | 操作 | 预期 |
|---|---|---|---|
| C-1 | `ACCEPT_LATE=true` | 投递 25 小时前的合法签名 `DELIVERED` | 归档 `late=true` 并应用；包裹 `SIGNED` 一次 |
| C-2 | `ACCEPT_LATE=true` | 投递 8 天前 | 归档 `LATE_REJECTED`；业务 0 变化 |
| C-3 | 订单已全单 `SIGNED` | 投递更早的 `IN_TRANSIT` | 追加物流记录；订单/包裹状态不回退 |
| C-4 | C-1 后重复投递 | 再投一次 | 不重复签收、不重复扣减 |
| C-5 | 时间戳在未来 25 小时 | 投递 | 拒绝且不入库 |
| C-6 | `ACCEPT_LATE=false` | 投递 25 小时前 | 归档 `LATE_REJECTED`；0 业务写入；返回 200 |

---

## D. 多实例限流

### D.1 现状与缺陷证据

- `qianyi-webhook.service.ts:33,53-63`：进程内 `Map`，每 IP 240 次/分钟。
- 多副本部署时，总限额 = 240 × 副本数；进程重启计数清零；无法全局约束单 IP 或全站。
- 中间件顺序正确（在 multipart 解析前），但计数不共享。

### D.2 目标行为

- 无论副本数，单 IP 与全站回调速率有统一上限。
- 存储不可用时 fail-closed（503，让千易重试），不放大数据库压力。
- 限流发生在验签与解析之前，被限流的请求不归档。

### D.3 设计（推荐：数据库固定窗口）

新增表（**提议**，迁移 `20261030xxxxxx_webhook_rate_bucket`，不创建）：

```
webhook_rate_buckets
  bucket_key VARCHAR(80) NOT NULL      -- 'ip:<addr>' | 'global'
  window_start TIMESTAMPTZ(3) NOT NULL
  count INT NOT NULL
  PRIMARY KEY (bucket_key, window_start)
```

单条 SQL 原子计数：

```sql
INSERT INTO webhook_rate_buckets (bucket_key, window_start, count)
VALUES ($1, date_trunc('minute', now()), 1)
ON CONFLICT (bucket_key, window_start)
DO UPDATE SET count = webhook_rate_buckets.count + 1
RETURNING count;
```

- 每条回调 2 次计数（IP + 全局），`count > limit` → 429。
- 全局限额建议按千易回调峰值 × 3 设定（需千易提供峰值，见清单 11.4）。
- 清理：每小时删除 `window_start < now() - 10 分钟` 的行（并入现有 reconcile）。
- DB 异常：捕获后返回 503 `{ok:false,retry:true}`，并告警；**不放行**。
- 保留现有内存 Map 作为进程内快速拒绝（可选，二者取较小值），但权威是数据库。
- 需先确认千易出口 IP 是否固定：若为共享 IP 池，`ip:<addr>` 会误伤，应改为按 `appId` 全局维度。

替代方案（若不允许回调路径写库）：在 Caddy 边缘做限流（需要自定义构建插件），应用层保留全局配额；或在网关前置一台带限流的反代。二者都需要额外运维改造，本轮不选。

### D.4 测试用例

| ID | 前置条件 | 操作 | 预期 |
|---|---|---|---|
| D-1 | 两个 service 实例共享同一隔离库 | 交替请求 241 次（同 IP） | 第 241 次在两个实例上都返回 429；DB `count=240` |
| D-2 | D-1 后等待下一分钟 | 再请求 | 恢复 200；新窗口行 count=1 |
| D-3 | 1000 个不同 IP 各 1 次，全局上限 600 | 并发投递 | 第 601 次起 429；业务只处理 600 条 |
| D-4 | DB 连接断开 | 投递 | 503；无归档、无业务写入；日志告警 |
| D-5 | 同一窗口 300 并发同 IP | 并发 | 计数精确 = 240（或上限），无丢失/重复计数 |
| D-6 | 被限流的合法签名请求 | 投递 | 429 且不归档（与现行为一致） |

---

## 实施顺序与授权点

1. **A 依赖千易确认**（重复建档行为、精确查询、唯一范围）→ 确认后先写 RED 测试再实现。
2. **B 依赖 ACK 语义**；`attempts` 计数与告警可先做（不依赖千易）。
3. **C 的 `LATE_REJECTED` 归档**不依赖千易，可先做；`ACCEPT_LATE` 必须等确认。
4. **D 不依赖千易**（除出口 IP 峰值），可与 A 并行。

四项全部实现并通过隔离库测试后，仍需真实千易联调（见总报告第 6 节）才能解除“不得合并”的门禁。
