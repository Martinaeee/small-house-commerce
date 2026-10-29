# 千易 ERP 下一阶段准备：只读审计与联调方案

日期：2026-10-29。面向发布负责人、开发与运营。
本轮只做只读审计与准备文档：**未修改业务代码、未新建迁移、未调用真实千易写接口、未修改生产数据、未合并、未 push、未部署、未启用生产开关。**

配套文档：

- 千易/运营确认清单：[2026-10-29-qianyi-vendor-confirmation-list.md](../handoff/2026-10-29-qianyi-vendor-confirmation-list.md)
- 四项整改设计：[2026-10-29-qianyi-remediation-designs.md](../specs/2026-10-29-qianyi-remediation-designs.md)
- 上一轮验收报告：[2026-10-29-qianyi-p0-safety-gate.md](2026-10-29-qianyi-p0-safety-gate.md)

---

## 1. 结论

1. **代码候选没有覆盖生产修复的风险**：生产 `36269e66` 是候选分支的祖先，远端 `main` `b0cbb819` 也是候选分支的祖先；候选 `af14094d` = 生产 + 24 个提交，远端 main 与候选之间是快进关系（领先 31、落后 0）。
2. **但 GitHub `main` 与生产不同步**：生产比远端 main 多 7 个提交（结账幂等补丁链），这些提交只在候选分支与生产上，远端 main 上没有。合并会把它们一并带上 main，属于预期行为，不是覆盖。
3. **迁移 72–74 全部为加性变更**，生产当前 71 条已应用。生产 `shipments` 表 0 行，加索引与加列的锁风险可以忽略；若延后到已有真实发货再执行，需要维护窗口。
4. **仍不能启用**：真实签名、远端订单幂等、仓库物理绑定、SHIPDOC/J&T、COD/payTime、shelfLife、SKU 建档幂等都未取得千易书面确认。**技术门禁已过，业务事实门禁未过。**
5. 本轮新发现两个需处理的缺口（详见第 4 节 B 类）：
   - `PUSH_RETURN_ORDER_INFO` 被列入已处理类型，但入站服务没有对应处理逻辑，事件会被标记完成并永久跳过；（2026-10-29 已处理：改为在关联订单上写 SYSTEM 备注，不再静默丢弃；库存/退款/状态仍不动）
   - 推单结果不明时，后台只有“确认不存在后重推”，**没有“确认已存在并采纳”的动作**，运营只能手工改库或让订单永远停在待核对。

---

## 2. 生产基线、远端 main 与候选分支的提交关系（只读）

### 2.1 现场取值

| 项目 | 值 | 取得方式 |
|---|---|---|
| 生产 HEAD | `36269e66fd2676e1dd43fad4569a48d012b7902f` | `ssh luwag-new`，只读 `git rev-parse HEAD` |
| 生产分支 | `staging/luwag-shop-domain` | 同上 |
| 生产工作区 | 干净（`git status --porcelain` 0 行） | 同上 |
| 生产已应用迁移 | **71** | 只读 `select count(*) from _prisma_migrations where finished_at is not null` |
| 远端 main | `b0cbb8194e6f9c470561cf95a88da187555319fe` | `git ls-remote origin refs/heads/main`（经 7897 代理） |
| 候选运行时代码 | `af14094db09d05169a82cf929b83ade7374ea814` | 本地分支 |
| 候选文档 HEAD | `bd0e806d52a34740dc535737ddcaa70ecd59531f` | 本地分支 |
| 候选分支 | `feat/qianyi-erp-integration` | 本地 worktree |

生产表规模（只读）：`shipments 0 / orders 12 / skus 62 / inventory 59`。

### 2.2 关系判定

| 判定 | 命令 | 结果 |
|---|---|---|
| 生产是否为候选祖先 | `git merge-base --is-ancestor 36269e66 HEAD` | **是**（exit 0） |
| 候选相对生产 | `git rev-list --count 36269e66..HEAD` | **24 个提交** |
| 候选与生产差异 | `git diff --stat 36269e66..HEAD` | 59 文件，+16088 / −107 |
| 远端 main 是否为候选祖先 | `git rev-list --left-right --count HEAD...b0cbb819` | **31 领先 / 0 落后** |
| main 与候选的合并基 | `git merge-base HEAD b0cbb819` | `b0cbb819`（即 main 本身） |
| 生产是否为远端 main 祖先 | `git merge-base --is-ancestor 36269e66 b0cbb819` | **否**（exit 1） |

**结论**：候选包含生产全部提交，也包含远端 main 全部提交。把候选合并到 main 是 fast-forward，不存在“用旧代码覆盖新修复”的路径。

### 2.3 只在生产、不在 GitHub main 的 7 个提交

```
36269e66 Merge remote-tracking branch 'origin/main' into staging/luwag-shop-domain
edf11d25 Merge remote-tracking branch 'origin/main' into staging/luwag-shop-domain
57e06efc fix(checkout): scope the retry key to its checkout
9a5d7724 fix(checkout): end the idempotency scope after a successful order
048beed4 harden checkout idempotency transaction boundaries
097de32f fix(checkout): forward Meta consent and harden idempotency keys
49ae0669 feat(orders): idempotent checkout retries (pre-release patch)
```

影响：这 7 个提交涉及 `orders.service.ts`、`order.prisma`、结账幂等与前端 checkout。候选在其之上继续修改 `orders.service.ts`（签收、取消、合并），因为生产是祖先，改动是叠加而非覆盖。合并到 main 后，GitHub 与生产将首次对齐到同一历史。

**风险与要求**：
- 生产当前在 `staging/luwag-shop-domain`，**合并 main 不会自动更新生产**；将来部署必须显式选择基线，并用 `EXPECT_SHA` 闸校验。
- 部署前仍需现场比对“服务器 HEAD / GitHub main / 运行镜像”三者；历史上有过两者不一致的坑。
- 合并本身仍需单独授权；本轮未合并、未 push。

---

## 3. 迁移 71 → 74：文件名、内容、顺序与回滚边界

生产已应用 71 条，最后一条是 `20261028150000_add_order_idempotency`（结账幂等）。候选新增三条，候选目录总数 74。

### 3.1 顺序与文件名

| 序号 | 目录 | 引入提交 | 作用 |
|---|---|---|---|
| 72 | `20261028160000_add_qianyi_order_sync` | 千易接入首批 | 建枚举、加 4 列、建 2 表、索引、外键 |
| 73 | `20261029090000_qianyi_job_review` | P0 修复 | 枚举加 2 值、加 4 列、加 1 索引 |
| 74 | `20261029090100_qianyi_outbound_unique` | P0 修复 | 出库号唯一索引 |

执行顺序由目录名（时间戳）字典序决定，Prisma `migrate deploy` 按此顺序执行；**73 依赖 72 创建的类型，74 依赖 72 创建的列**，不可乱序，不可只挑一条执行。

### 3.2 SQL 内容

**72 `20261028160000_add_qianyi_order_sync`**（文件头注明 additive only；下列为语句摘要，省略重复的约束名与换行，字段与类型未改动）：

```sql
CREATE TYPE "QianyiSyncKind" AS ENUM ('PUSH_ORDER', 'CLOSE_ORDER');
CREATE TYPE "QianyiSyncStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "skus"      ADD COLUMN "qianyi_sku_code" VARCHAR(255);
ALTER TABLE "orders"    ADD COLUMN "qianyi_order_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_outbound_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_status" VARCHAR(40);

CREATE TABLE "qianyi_sync_jobs" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL,
  "kind" "QianyiSyncKind" NOT NULL,
  "status" "QianyiSyncStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" VARCHAR(1024),
  "request_payload" JSONB NOT NULL,
  "response_payload" JSONB,
  "external_order_number" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "qianyi_webhook_events" (
  "id" UUID PRIMARY KEY,
  "service_type" VARCHAR(60) NOT NULL,
  "sign_valid" BOOLEAN NOT NULL DEFAULT false,
  "external_key" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "error" VARCHAR(1024),
  "processed_at" TIMESTAMPTZ(3),
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "qianyi_sync_jobs_order_id_kind_key" ON "qianyi_sync_jobs"("order_id","kind");
CREATE INDEX "qianyi_sync_jobs_status_next_attempt_at_idx" ON "qianyi_sync_jobs"("status","next_attempt_at");
CREATE UNIQUE INDEX "qianyi_webhook_events_external_key_key" ON "qianyi_webhook_events"("external_key");
CREATE INDEX "qianyi_webhook_events_received_at_idx" ON "qianyi_webhook_events"("received_at");

ALTER TABLE "qianyi_sync_jobs"
  ADD CONSTRAINT "qianyi_sync_jobs_order_id_fkey" FOREIGN KEY ("order_id")
  REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**73 `20261029090000_qianyi_job_review`**：

```sql
ALTER TYPE "QianyiSyncStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "QianyiSyncStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "qianyi_sync_jobs"
  ADD COLUMN IF NOT EXISTS "auto_create_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_review" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_action" VARCHAR(1024);

CREATE INDEX IF NOT EXISTS "qianyi_sync_jobs_status_claimed_at_idx"
  ON "qianyi_sync_jobs"("status","claimed_at");
```

**74 `20261029090100_qianyi_outbound_unique`**：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_qianyi_outbound_number_key"
  ON "shipments"("qianyi_outbound_number");
```

### 3.3 锁与执行风险评估

| 语句 | 锁/代价 | 生产现状 | 评估 |
|---|---|---|---|
| 加可空列（`skus`/`orders`/`shipments`） | 仅改元数据 | 表 62 / 12 / **0** 行 | 毫秒级 |
| 建新表 + 外键 | 空表 | 无 | 毫秒级 |
| 新表索引 | 空表 | 无 | 毫秒级 |
| `ALTER TYPE … ADD VALUE` | 需在事务外可用新值；本迁移只加值不使用 | — | PostgreSQL 12+ 允许在事务内执行，但同一事务内不能使用新枚举值；本迁移满足 |
| **74 非并发唯一索引** | `SHARE` 锁，阻塞写入 | `shipments` 0 行 | 当前可忽略；若延后到已有发货，需维护窗口或改为 `CONCURRENTLY`（Prisma 事务内不支持，需单独执行） |

历史教训：曾把 `ALTER TYPE` 与 `CREATE INDEX` 写在同一迁移，结果索引未生效但迁移被记为已应用。本轮已拆分，并在一次性库验证索引真实存在。

### 3.4 执行顺序（未来授权后）

1. 部署前备份：`pg_dump`（沿用 `/usr/local/sbin/smallhouse-backup.sh`）。
2. 应用迁移：后端容器入口自动 `prisma migrate deploy`；或先手工 `prisma migrate deploy` 再重建，二者择一，不可重复并行。
3. 立即验证（只读 SQL）：

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'QianyiSyncStatus' ORDER BY enumsortorder;
-- 期望 6 个：PENDING, SENT, FAILED, SKIPPED, SENDING, CANCELLED

SELECT indexname FROM pg_indexes
 WHERE indexname IN ('shipments_qianyi_outbound_number_key',
                     'qianyi_sync_jobs_order_id_kind_key',
                     'qianyi_sync_jobs_status_claimed_at_idx');

SELECT column_name FROM information_schema.columns
 WHERE table_name = 'qianyi_sync_jobs'
   AND column_name IN ('auto_create_attempts','pending_review','claimed_at','last_action');
```

4. 重复执行一次 `prisma migrate deploy` 应 exit 0 且 0 条新迁移（已在一次性库验证）。

### 3.5 回滚边界

- **没有 down 迁移**，也不应编写破坏性回滚。三条均为加性，旧代码不读这些表/列，**代码回滚不需要回滚数据库**。
- 72：`qianyi_sync_jobs` / `qianyi_webhook_events` 一旦写入即为审计与业务证据，**禁止直接 `DROP`**。只有确认从未启用、两表为空且经书面授权时，才可另行提交删除迁移。
- 73：`SENDING`/`CANCELLED` 枚举值**无法单独删除**（需重建整个类型），因此永久保留。列可保留，旧代码忽略。
- 74：唯一索引是并发重复出库的最终防线，**禁止为“方便”而删除**。若业务确实要允许同号多包裹，必须先改应用与数据模型，再单独评估。
- 若未来已启用并需要退出：先 `QIANYI_ENABLED=false` 阻断出站与入站业务写入，再回滚镜像；千易侧已建订单/已出库只能人工对账，不得用重复推单或反向改库存“撤销”。
- 数据保全：回滚前导出 `qianyi_sync_jobs`、`qianyi_webhook_events` 与相关 `shipments` 行，作为对账依据。

---

## 4. 剩余问题三分类（负责人 / 验收证据 / 阻断级别）

阻断级别定义：

- **L0 合并阻断**：阻止合并到 main。
- **L1 启用阻断**：`QIANYI_ENABLED=true` 之前必须关闭。
- **L2 首单阻断**：第一笔真实推单前必须关闭。
- **L3 整改阻断**：对应整改实现前必须关闭。
- **L4 不阻断**：可上线后跟进。

> 当前**没有 L0 技术阻断**；合并本身仍属流程授权事项，不由本轮自动执行。

### A. 必须由千易官方或有权限的业务人员确认

| ID | 事项 | 负责人 | 验收证据 | 级别 |
|---|---|---|---|---|
| A1 | 真实回调签名样本（4 类）与验签复算一致 | 千易接口管理员 + 开发 | 样本原文 + 本地离线复算 `sign` 一致记录 | L1 |
| A2 | 回调 ACK 语义、重试间隔/次数/总时长、是否 >24h | 千易接口管理员 | 书面答复或工单截图 | L1 |
| A3 | `CREATE` 远端幂等：同 `onlineOrderNumber` 重复行为与错误码 | 千易接口管理员 | 测试域两次同号调用结果截图 | L1 |
| A4 | `PH-DAVAO-01/71537` 与本地仓的物理对应 | 千易仓配负责人 + LUWAG 运营 | 仓库对照表签字/邮件 | L1 |
| A5 | `SHIPDOC-STD` 实际承运商、是否 J&T、多包裹规则 | 千易仓配负责人 | 书面答复 | L1 |
| A6 | COD `payTime=下单时间`、`codPayAmount` 口径、是否标记已付款 | 千易业务负责人 | 测试域一笔 COD 单截图 | L1 |
| A7 | `shelfLife=36500` 是否合法、单位与上限 | 千易接口管理员 | 书面答复 + 建档成功截图 | L2 |
| A8 | `INSERT_SKU_INFO` 重复行为、`sku` 唯一范围 | 千易接口管理员 | 测试域重复建档结果 | L2 |
| A9 | `QUERY_SIMPLE_LIST_SKU` 是否支持按编码精确查询 | 千易接口管理员 | 测试域查询返回样例 | L3（设计 A） |
| A10 | 测试环境账号/店铺/仓库/物流可用；凭据已轮换 | 千易接口管理员 | 测试域只读查询成功 + 旧 secret 失效 | L1 |

清单见配套文档，未关闭前不得启用。

### B. 必须修改代码

| ID | 问题 | 负责人 | 验收证据 | 级别 |
|---|---|---|---|---|
| B1 | SKU 建档无幂等（超时后重复建档） | 后端 | 设计 A 的 A-1…A-9 全绿 | L2 |
| B2 | 永久业务冲突无限 500 重试 | 后端 | 设计 B 的 B-1…B-6 全绿 | L1 |
| B3 | >24h 合法回调被丢弃且不归档 | 后端 | 设计 C 的 C-1…C-6；其中 `LATE_REJECTED` 归档可先行 | L1 |
| B4 | 多实例限流不共享 | 后端 + 运维 | 设计 D 的 D-1…D-6 全绿 | L1（多副本时）/ L4（单副本时仍会重启清零） |
| B5 | `PUSH_RETURN_ORDER_INFO` 被标记已处理但无处理逻辑，退货事件永久跳过 | 后端 + 运营 | 决定“本期忽略”则写明并记录 `IGNORED`；要做则实现并测试 | L3 | **2026-10-29 已实现临时策略**：入站只写订单 SYSTEM 备注（含退货单号），完整退货闭环待业务确认 |
| B6 | 结果不明时缺少“确认已存在→采纳/绑单”动作，只能假设不存在重推 | 后端 | 新增后台动作 + 测试：远端存在时采纳并 `SENT`，不再 CREATE | L2 |
| B7 | 合并后的保留订单未重新计价/重推，远端金额与本地不一致 | 后端 + 运营 | 明确规则（禁止合并已推单 / 或补修改接口）+ 测试 | L2 |
| B8 | 每日对账只写备注、不修复 | 后端 + 运营 | 首单后观察 7 天，人工对账；自动修复另立设计 | L4 |
| B9 | 全局 JSON/urlencoded parser 在中间件之前，回调路由无法单独消除解析成本 | 后端（架构） | 压测记录 + 方案评审 | L4 |

`B5`/`B6` 为本轮只读审计新发现，未在上一轮报告中列出。

### C. 必须进行隔离环境验证

| ID | 事项 | 负责人 | 验收证据 | 级别 |
|---|---|---|---|---|
| C1 | 真实千易签名验签（测试域回调） | 后端 + 千易 | 测试域回调日志 + 本站归档行 | L1 |
| C2 | 超时但远端成功：测试域延迟响应，确认远端是否建单 | 后端 + 千易 | 千易订单列表截图 + 本站 job 状态 | L2 |
| C3 | 人工发货与自动回调并发 | 后端 | 一次性库新增用例：只 1 shipment/1 扣减 | L2 |
| C4 | 进程重启/部署中断（`SENDING` 恢复） | 后端 + 运维 | 容器重启演练记录 + job 转 REVIEW | L1 |
| C5 | 生产数据克隆上执行 71→74 | 后端 + 运维 | 克隆库 `migrate deploy` exit 0 + 验证 SQL | L1（部署前） |
| C6 | 两副本限流（设计 D 上线后） | 后端 + 运维 | 两端 429 一致 + DB 计数 | L4 |
| C7 | 后台“核对后授权”“重排”“回调重放”浏览器 E2E | 前端 + 运营 | 真实浏览器操作截图/录屏 | L2 |
| C8 | 迟到回调策略（设计 C 上线后） | 后端 | C-1…C-6 | L1 |

**已在上一轮完成的隔离验证**：28 项一次性库用例（并发、停用、物流、Bundle、仓库、取消、恢复）。本轮不重复声明为“已验收真实千易”。

---

## 5. 联调验收矩阵

### 5.1 执行环境与命令

隔离库（唯一允许的地址）：

```bash
# 一次性容器（仅本机回环，测试文件会拒绝其他地址）
docker run --rm -d --name luwag-qianyi-next \
  -e POSTGRES_PASSWORD=isolated -e POSTGRES_USER=isolated \
  -e POSTGRES_DB=qianyi_safety_20261029 -p 127.0.0.1:55443:5432 postgres:18-alpine

cd small-house-commerce/backend
DATABASE_URL='postgresql://isolated:isolated@127.0.0.1:55443/qianyi_safety_20261029' pnpm exec prisma migrate deploy
QIANYI_TEST_DATABASE_URL='postgresql://isolated:isolated@127.0.0.1:55443/qianyi_safety_20261029' \
QIANYI_TEST_DB_IS_DISPOSABLE=1 pnpm vitest run test/qianyi-safety.e2e-spec.ts
```

守卫：`qianyi-safety.e2e-spec.ts:14-19` 要求 `QIANYI_TEST_DB_IS_DISPOSABLE=1`，且主机必须是 `127.0.0.1`、端口 `55443`、库名 `qianyi_safety_20261029`，否则直接抛错。

真实千易联调：**需单独授权**，使用清单第 10 节的测试域，禁止在生产域名/生产店铺执行写接口。

### 5.2 场景矩阵

> “现状覆盖”指已在 28 项隔离用例中验证；“待联调”指必须用真实千易或真实进程验证。

#### M1 正常推单

- **前置**：隔离库；订单 `CONFIRMED`、`confirmationStatus=CONFIRMED`、全部明细有 `qianyiSkuCode`；本地仓 ACTIVE/PH；`QIANYI_ENABLED=true`；fake client 或测试域。
- **执行**：下单确认 → `enqueue` → 手动触发 `processPending`。
- **预期数据库**：`qianyi_sync_jobs` 1 行 `PENDING→SENDING→SENT`，`attempts=1`、`auto_create_attempts=1`、`request_payload` 含 `_skuMapping`；`orders.qianyi_order_number` 写入；库存与 `shipments` **不变**。
- **预期千易**：新增 1 笔订单；金额=`grandTotal`；`payTime`=下单时间（+08:00）；仓 `71537`、物流 `SHIPDOC-STD`；COD 不标已付款。
- **失败处理**：无映射 → `SKIPPED`，补映射后 `requeue`；业务拒绝 → `FAILED`（从未 CREATE 才可 `retry`）；超时/未知 → `FAILED+review`，走 M3。
- **现状覆盖**：P0-16、P0-11。

#### M2 重复推单

- **前置**：M1 已完成，job `SENT`。
- **执行**：再次确认订单；并发两个确认请求；再点一次普通“重推”。
- **预期数据库**：job 仍 1 行（`order_id+kind` 唯一索引），状态仍 `SENT`，不被重置；不新增订单备注；`auto_create_attempts` 不变。
- **预期千易**：0 笔新订单；若查询发现已有，采纳为 `SENT`。
- **失败处理**：若出现第二次 CREATE，立即停 worker、核对千易订单列表、人工关单；不得靠重复推单“修正”。
- **现状覆盖**：P0-11（worker 只发一次）+ 单测（`enqueue` 对 `SENT` 不复位）。

#### M3 请求超时但远端成功

- **前置**：订单可推；fake client 延迟超过 20s（或测试域模拟超时）。
- **执行**：`processPending`。
- **预期数据库**：job `FAILED`、`pending_review=true`、`auto_create_attempts=1`、`claimed_at=null`；`orders.qianyi_order_number` 仍空；库存/包裹不变；后续 tick 不再发送。
- **预期千易**：**可能已建 1 单**，需人工按 `onlineOrderNumber` 查询。
- **失败处理**：查到存在 → 应由 B6 的“采纳”动作绑定并转 `SENT`；查到不存在 → `authorize-retry` 后只再发一次；两者都禁止自动重发。
- **现状覆盖**：P0-12、P0-13；**“采纳已存在”尚无实现（B6）**。

#### M4 取消竞争

- **前置**：三种状态各一单：job `PENDING`、`SENDING`、`SENT`。
- **执行**：分别取消订单。
- **预期数据库**：`PENDING→CANCELLED`（worker 不再发送）；`SENDING→FAILED+review`（可能已到达千易）；`SENT→新增 CLOSE job`（`PENDING→SENT`）；订单 `CANCELLED`、预留释放；无新 `shipments`。
- **预期千易**：`PENDING` 无请求；`SENDING` 可能 1 单；`SENT` 收到关单。
- **失败处理**：`SENDING` 情形人工核对后在千易关单；CLOSE 失败 5 次转 `FAILED`，人工处理。
- **现状覆盖**：P0-14、P0-15。

#### M5 重复出库回调

- **前置**：已推单订单，本地预留有效。
- **执行**：并发投递两次同一回调；重复投递；不同事件指纹指向同一出库号并发。
- **预期数据库**：`shipments` **1 行**；`inventory_movements` 1 组；订单转 `SHIPPING` 且只有 1 条状态历史；物流 1 条 `SHIPPED`；归档行可多条但只应用一次。
- **预期千易**：只发回调，无状态变化。
- **失败处理**：出现 2 个包裹或 2 次扣减 → 立即停 worker 与回调入口，冻结数据，按归档与流水对账；禁止直接删包裹掩盖。
- **现状覆盖**：P0-01、P0-02、P0-03、P0-05、P0-06。

#### M6 多包裹

- **前置**：订单 2 件；先出库 1 件。
- **执行**：两次 `PUSH_ODO_ORDER`（不同运单/出库号）→ 对应 `PUSH_TRACKING_PACKAGE`。
- **预期数据库**：2 个 `shipments`，各自明细数量；两次扣减合计=订单量；第一件后订单仍 `SHIPPING`；物流按包裹归属，不串写。
- **预期千易**：2 个出库单。
- **失败处理**：无运单/出库号的回调 → 拒绝（未来设计 B 转终态）；运单歧义 → 不写，人工。
- **现状覆盖**：P1-06、P1-08。

#### M7 J&T 承运商

- **前置**：回调分别携带 `carrier=J&T Express` 与 `carrier=SHIPDOC`，顺序互换。
- **执行**：投递。
- **预期数据库**：`shipments.carrier` 保持真实承运商；占位值/空值不覆盖；先到的真实承运商能回捞到出库包裹。
- **预期千易**：无变化。
- **失败处理**：若真实值被覆盖 → 记录事件与当前值，人工修正；同时补用例。
- **现状覆盖**：P1-04、P1-05。

#### M8 签收

- **前置**：全单已出库（单包裹或多包裹全部发出）。
- **执行**：`DELIVERED` 回调。
- **预期数据库**：对应包裹 `SIGNED` 与签收记录；仅当全部包裹签收后订单 `SIGNED`；COD 支付状态**不变**（不得写已付款）。
- **预期千易**：回传已签收。
- **失败处理**：部分包裹签收 → 订单保持 `SHIPPING`；错误签收 → 按物流事件与快照核对，禁止直接改库。
- **现状覆盖**：P1-07。

#### M9 Bundle 扣减

- **前置**：订单含虚拟 Bundle SKU，`bundleSnapshot` 完整且数量一致。
- **执行**：出库回调 `skuList` 为 Bundle 编码。
- **预期数据库**：按快照扣减**组件 SKU**，不扣虚拟 SKU；`inventory_movements` 为组件行；数量=快照倍数×出库数量。
- **预期千易**：出库 1 个 Bundle。
- **失败处理**：快照缺失/不一致 → 拒绝（未来终态）；人工核对，禁止按 Bundle 直接扣减。
- **现状覆盖**：I-bundle。

#### M10 延迟回调

- **前置**：签名合法，`timestamp` 为 25 小时前。
- **执行**：投递。
- **预期数据库（当前实现）**：**不归档**、业务 0 变化、返回 `{ok:false}`。
- **预期数据库（设计 C 上线后）**：`late=true` 归档并应用；或 `LATE_REJECTED` 归档待人工。
- **预期千易**：是否重试取决于 ACK 语义（待 A2）。
- **失败处理**：当前是已知缺口；启用前必须完成 C，或由千易书面确认不会 >24h 重试。
- **现状覆盖**：无（明确未覆盖）。

#### M11 停用开关

- **前置**：`QIANYI_ENABLED=false`（含缺配置、缺 secret、缺仓库）。
- **执行**：有效签名回调；无效签名；异 `appId`；缺配置启动。
- **预期数据库**：有效签名 → 归档 1 行 `error=INTEGRATION_DISABLED`、`processedAt=null`；订单/库存/包裹/物流 **0 变化**。无效签名/异 appId → 0 行。缺配置 → 0 行且 client 不启动。
- **预期千易**：HTTP 200 `{ok:true,deferred:true}`，应停止重试。
- **失败处理**：重新启用后 30 秒内回放，每条最多应用一次；若发现停用期间业务被写 → 立即停用并按归档核对。
- **现状覆盖**：P0-07、P0-08、P0-09、P0-10。

#### M12 无效签名 / 异 `appId`（附加）

- 前置：任意。
- 执行：错 `sign`、错 `appId`、超长 `bizParam`、非法时间戳。
- 预期数据库：**0 归档、0 业务写入**。
- 预期千易：收到拒绝响应；是否会重试待确认。
- 失败处理：若被接受 → 立即停用并轮换 secret。
- 现状覆盖：P0-08。

#### M13 缺映射推单（附加）

- 前置：订单中任一 SKU 无 `qianyiSkuCode`。
- 执行：确认订单。
- 预期数据库：job `SKIPPED`，`last_error` 列出缺失 SKU；**整单不发送**；无远端订单。
- 预期千易：0 请求。
- 失败处理：运营补映射 → `requeue` 重新校验全部明细；只接受从未发送的 SKIPPED。
- 现状覆盖：推单链与 `requeue` 用例（P0-16、后台 API 单测）。

### 5.3 覆盖对照

| 场景 | 隔离库自动化 | 真实千易联调 | 备注 |
|---|---|---|---|
| M1 正常推单 | 已有（fake） | 待授权 | 需 A1/A3/A4/A5/A6 |
| M2 重复推单 | 已有 | 待授权 | 远端幂等需 A3 |
| M3 超时远端成功 | 已有（fake） | 待授权 | 采纳动作缺（B6） |
| M4 取消竞争 | 已有 | 待授权 | |
| M5 重复出库回调 | 已有（真实并发） | 待授权 | |
| M6 多包裹 | 已有 | 待授权 | 需 A5 |
| M7 J&T 承运商 | 已有（fake） | 待授权 | 需 A5 |
| M8 签收 | 已有 | 待授权 | |
| M9 Bundle 扣减 | 已有 | 待授权 | |
| M10 延迟回调 | **无** | 待授权 | 需先实现设计 C |
| M11 停用开关 | 已有（6 种） | 待授权（暗部署验证） | |
| M12 无效签名 | 已有 | 待授权 | |
| M13 缺映射 | 已有 | 不涉及远端写 | |

---

## 6. 本轮未做与下一步授权点

**未做**：合并、push、PR、部署、启用生产开关、真实千易任何写接口（建档/推单/关单/发货）、生产订单/库存/商品/客户数据修改、`backend/uploads/` 触碰、生产库迁移或测试写入。

**本轮唯一写入**：新增 3 份文档（本报告、确认清单、整改设计），未提交、未 push。

**需要用户逐项授权的下一步**（建议顺序）：

1. 将确认清单发给千易；获得 A1–A10 答复与测试环境。
2. 授权实现 B 类中**不依赖千易**的部分：`LATE_REJECTED` 归档、回调 `attempts` 计数与告警、B6“确认已存在→采纳”、B5 退货事件的显式处理策略。（2026-10-29 已完成：迟到回调 7 天内应用、超期归档 `STALE_CALLBACK`、10 位秒/13 位毫秒时间戳、退货回调写订单备注；**仍未做**：回调 attempts 计数与告警、B6“采纳已存在”）
3. 授权实现设计 A/C/D 的完整版本（需先有 A2/A3/A8/A9 结论）。
4. 授权在**生产数据克隆库**执行 71→74 并跑全部 13 个场景。
5. 授权 `QIANYI_ENABLED=false` 暗部署（只验证无出站、仅 deferred 归档、容器 env 正确）。
6. 授权单笔受控真实订单联调（推单 + 出库 + 轨迹 + 签收），仍然不扩大到全量。
7. 最后才讨论合并到 main 与正式启用。

在上述 1–5 完成前，本候选保持“可交付、不可启用”。
