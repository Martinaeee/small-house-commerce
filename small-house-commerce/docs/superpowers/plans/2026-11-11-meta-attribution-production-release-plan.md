# CL/AID/动态 AdID — 生产发布操作方案

日期：2026-11-11
状态：**仅审核与文档；未修改生产代码/数据库，未重启生产容器，未执行迁移，未推送/部署。**
适用分支：`deploy/meta-attribution-20261111`
审核基线 HEAD：`bb10309c`（父 `4ecf81d6`；本方案提交后的新 HEAD 以 git log 为准）
生产基线：`1a3cbaf4`（`prod/staging/luwag-shop-domain`）

## 1. 变更范围

- 后端：`analytics_events` 归因列、touch claims provenance、AID 冲突回退、
  订单动态 AdID 优先级、ADID/AID 报表。
- 前端：META_AD 三件套（干净 URL/CL/AID）、按链接 Meta 参数、短链转发 `cl`、
  ADID/AID 报表视图。FB_POST 行为不变。
- 迁移：`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`
  （仅可空列 + 索引，无数据回写）。
- 已应用环境：Staging（`2026-11-11 04:31:49+00`，耗时 24.6ms）。
  生产 **未应用**（当前最后迁移 `20261110120000_add_purchase_order_unique`）。

## 2. Claims v2 部署、兼容与回滚

### 2.1 结构

- `marketingTouchClaimsSchema`：`.strict()`，`version` 接受 1/2。
- 新后端仍签发 **version 2**，仅新增可选字段：
  `adIdSource`、`adIdMissingReason`、`linkResolution`。
- 旧凭据（无新字段）在新后端可正常解析；已有测试：
  `still accepts touches signed before the advertising number existed`。

### 2.2 兼容矩阵

| 凭据来源 \ 解析方 | 新后端 | 旧后端（回滚后） |
|---|---|---|
| 旧 v1/v2（无新字段） | 通过 | 通过 |
| 新 v2（含新字段） | 通过 | **拒绝**（`.strict()` 未知字段） |

- 生产只有 **1 个 backend 容器**，正常发布没有新旧并行；混合版本窗口主要出现
  在「新后端已签发凭据 → 回滚到旧后端」之后。
- 新凭据被旧后端拒绝时：`resolve()` 返回 null，事件不挂链接、订单暂时无归因；
  **fail-closed，不会错配到其他优化师**。用户下一次点击投放链接会签发旧后端
  可解析的新凭据。
- 凭据 TTL 7 天；localStorage key `sh:marketing-touch`，另有
  `luwag_mt_first`/`luwag_mt_last` 首触/末触 cookie。

### 2.3 发布/回滚操作

- **发布顺序：后端 → 前端。** 前端依赖后端新字段 `cleanPath`/`cl`/
  `metaUrlParameters`；先前端会显示缺失字段。
- **回滚顺序：前端 → 后端。** 旧前端与新后端兼容；先把前端回旧，再把后端回旧，
  缩短「新前端 + 旧后端」窗口。
- 回滚到旧后端后，风险窗口是**凭据 TTL 7 天**，不是 24 小时；24 小时监控
  只覆盖早期信号，不能视为风险解除。详见 §2.4 与 §7.3。
- 不做自动重签或降级（当前无此逻辑）。

### 2.4 回滚兼容方案与 7 天风险

- **本轮未构建兼容回滚镜像。** 可选方案（需单独批准）：从 `1a3cbaf4` 建一个
  仅把 `adIdSource`/`adIdMissingReason`/`linkResolution` 三个可选字段加入
  `marketingTouchClaimsSchema` 的 rollback-compat 分支，构建并测试后打标签；
  旧行为不变，只是能解析新凭据。本轮不扩大开发，不构建。
- 因此必须按最坏情况接受：新后端在 `[新后端启动, 回滚完成]` 之间签发的凭据，
  在旧后端上最长 **7 天**不可解析。
- 影响：这些凭据对应的事件不挂链接、订单进入 `TOKEN_INVALID` 无归因；
  **fail-closed，不会错配**。无法从 DB 完整枚举受影响用户（凭据只在浏览器/
  cookie），只能按流量与未归因比例观察。
- 恢复方案（按优先级）：
  1. **恢复修复后的新后端**（新后端同时接受旧/新凭据），归因立即恢复；
  2. 用户重新点击任一投放链接，旧后端签发可解析的新凭据，后续事件/订单恢复；
  3. 等待最多 7 天 TTL 过期后重新触达；
  4. 不做自动重签、批量补发或数据库层修复。
- 7 天监控指标（旧后端可查）：
  - `order_attributions.adid_missing_reason='TOKEN_INVALID'` 的数量；
  - `analytics_events` 中 `page_url` 带 `cl=`/`aid=` 但 `campaign_link_id IS NULL`
    的比例；
  - `campaign_link_visits` 日环比是否异常下降。
  监控持续到回滚后 7 天或恢复新后端为止。

## 3. 生产数据库备份与恢复

### 3.1 现状（2026-11-11 只读核对）

- 备份目录：`/opt/backups`（`root:root`，`ubuntu` 需 `sudo`；`sudo -n` 可用）。
- 最近备份：`/opt/backups/cart-added-20261110T055829Z/prod.dump`
  （PostgreSQL custom dump，840KB，`pg_restore --list` 可读）。
- 备份为**手动/按次**，`crontab` 无备份任务；备份与数据库在同一台主机。
- 生产 DB 卷：`small-house-prod_prod_pgdata`；容器 `small-house-prod-db-1`。
- 当前数据量：`analytics_events` 5,471 行 / 3.5MB；
  `order_attributions` 10 行 / 112KB。

### 3.2 发布前备份（必须）

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
TAG=meta-attribution-$TS
sudo install -d -m 0750 /opt/backups/$TAG
sudo sh -c "docker exec small-house-prod-db-1 \
  pg_dump -U smallhouse -Fc small_house > /opt/backups/$TAG/prod.dump"
sudo sh -c "sha256sum /opt/backups/$TAG/prod.dump > /opt/backups/$TAG/prod.dump.sha256"
```

校验：

```bash
sudo sh -c "cd /opt/backups/$TAG && sha256sum -c prod.dump.sha256"
sudo sh -c "cat /opt/backups/$TAG/prod.dump | \
  docker exec -i small-house-prod-db-1 pg_restore --list | head"
```

- 备份完成后**立即复制到主机之外**（本地/对象存储）；同主机备份不能覆盖主机
  丢失风险。例如：
  ```bash
  scp /opt/backups/$TAG/prod.dump <user@offhost>:/path/
  ssh <user@offhost> 'sha256sum /path/prod.dump'   # 与本地 sha256 比对
  ```
- 记录 `TS/TAG`、dump 大小、sha256、当前镜像 ID，写入发布记录。

### 3.3 恢复演练/灾难恢复

- 恢复演练（不覆盖生产）：在**独立临时 PostgreSQL**（本地或隔离容器，非生产
  DB 集群）创建临时库 `meta_attr_restore_<TS>`，用 `pg_restore` 恢复 dump，
  核对 `orders/order_items/order_attributions/analytics_events` 行数，然后删除
  临时库；本轮已按此完成，见 §11.1。
- 灾难恢复（需单独授权）：
  1. `docker compose --env-file .env.deploy -f docker-compose.prod.yml stop backend frontend`
  2. 在 db 容器内 `DROP DATABASE small_house WITH (FORCE); CREATE DATABASE small_house OWNER smallhouse;`
  3. `cat prod.dump | docker exec -i small-house-prod-db-1 pg_restore -U smallhouse -d small_house`
  4. 启动 backend（entrypoint 会 `migrate deploy`，无 pending）→ 启动 frontend
  5. 健康检查 + 只读冒烟。
- **不要把 dump 直接恢复到现有库**（会因对象重复失败）；必须先 clean/重建库。
- 当前无 cron → 常态 RPO = 距最近一次手动备份。
- **发布前备份不等于 RPO=0**：如果必须恢复 DB，备份时间点之后的真实订单/
  事件会丢失。准确表述是「把本次发布造成的 RPO 压到备份时刻」，不是零。
- 缩小损失的顺序：备份 → 立即迁移；若需恢复，先停 backend/frontend 冻结写入
  （停止前的写入仍会丢失），再按 §3.3 恢复；记录备份时间与恢复时间。
- RTO 约数分钟（dump 840KB）；本次已在独立临时库完成真实 `pg_restore`
  恢复演练，见 §11.1。

## 4. 迁移安全性、可重复性与回滚影响

### 4.1 安全性

- 10 个新列全部 `NULL`、无 `DEFAULT`；PostgreSQL 仅改元数据，不重写表。
- 5 个新索引均为普通 `CREATE INDEX`（非 CONCURRENT）：
  - `analytics_events` 5,471 行 / 3.5MB
  - `order_attributions` 10 行 / 112KB
- 锁影响：`ALTER TABLE` 短暂 `ACCESS EXCLUSIVE`；`CREATE INDEX` 的 `SHARE`
  锁会阻塞这两张表的写入，但表很小；Staging 同迁移实测 **24.6ms**，
  生产预计 <1s。
- **Prisma 7.10.0 不会自动把迁移包进事务**：实测失败探针的 `CREATE TABLE`
  在失败后仍存在。迁移文件已显式加 `BEGIN; ... COMMIT;`；带事务的失败探针
  实测 0 个新列 / 0 个新索引残留。backend entrypoint `set -e` 不会在迁移
  失败后启动 API。
- 恢复步骤见 §4.2；事务核实证据见 §11.2。

### 4.2 可重复性

- 通过 `prisma migrate deploy` 执行，`_prisma_migrations` 记录后重复执行是
  no-op。
- 迁移 SQL 本身**不是** `IF NOT EXISTS` 幂等；禁止手工重复执行原始 SQL。
- 如果迁移中途失败：
  1. 查 `_prisma_migrations`：`finished_at IS NULL` 表示失败记录；
  2. 查新列数（10 个）与新索引数（5 个）：
     ```sql
     select count(*) from information_schema.columns
     where table_name='analytics_events'
       and column_name in ('optimizer_id','aid_snapshot','ad_id','ad_id_source',
                           'ad_id_missing_reason','adset_id','attribution_paid',
                           'link_resolution','attribution_conflict','conflict_detail');
     select count(*) from pg_indexes
     where indexname in ('analytics_events_ad_id_event_name_event_day_idx',
                         'analytics_events_optimizer_id_event_name_event_day_idx',
                         'analytics_events_campaign_link_id_ad_id_event_day_idx',
                         'order_attributions_link_id_ad_id_idx',
                         'order_attributions_ad_id_attributed_at_idx');
     ```
  3. 若均为 0（显式事务已回滚）：`./node_modules/.bin/prisma migrate resolve --rolled-back 20261111120000_add_analytics_attribution`，修复原因后重试 `migrate deploy`；
  4. 若有部分 DDL（理论上不应发生）：按清单逐项
     `DROP INDEX IF EXISTS ...`、`ALTER TABLE ... DROP COLUMN IF EXISTS ...`，
     或从 §3.2 备份恢复；随后 `migrate resolve --rolled-back` 再重试；
  5. 不要直接重跑失败迁移（会因对象已存在再次失败）。

### 4.3 回滚影响

- **推荐：只回滚镜像，不回滚迁移。** 旧代码不读新列；新列保留，后续重新发布
  可直接使用。
- 强行删列会丢失上线后的 `adId/adIdSource/optimizerId/conflict` 诊断数据，
  并需要删除 5 个索引；仅在灾难恢复且确认不需要这些数据时执行，且必须先有
  §3.2 备份。
- 迁移已应用但旧后端运行：旧后端忽略新列，功能正常；仅新凭据解析风险见 §2.2。

## 5. 生产部署顺序与健康检查

### 5.1 顺序（推荐）

1. **只读预检**：确认生产 HEAD/镜像/健康；确认 `.env.deploy` 存在。
2. **记录回滚点**：给当前 `latest` 打标签：
   ```bash
   docker tag small-house-prod-backend:latest small-house-prod-backend:rollback-pre-meta-attr-<TS>
   docker tag small-house-prod-frontend:latest small-house-prod-frontend:rollback-pre-meta-attr-<TS>
   ```
3. **备份 DB**：§3.2；校验；复制到主机外。
4. **构建镜像**（旧容器继续服务）：
   ```bash
   cd /opt/small-house-commerce/small-house-commerce
   docker compose --env-file .env.deploy -f docker-compose.prod.yml build backend frontend
   ```
5. **预应用迁移**（旧后端仍在跑；新镜像一次性容器）：
   ```bash
   docker compose --env-file .env.deploy -f docker-compose.prod.yml run --rm \
     --entrypoint ./node_modules/.bin/prisma backend migrate deploy
   ```
   验证 `_prisma_migrations` 新记录、新列存在。
6. **重建后端**：
   ```bash
   docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend
   ```
   entrypoint 会再次 `migrate deploy`（no-op）并执行 RBAC reconcile。
   等 health=healthy（镜像健康检查：`GET /api/v1`，10s 间隔，start 40s，
   retries 6）。
7. **重建前端**：
   ```bash
   docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d frontend
   ```
   等 health=healthy（`GET /`，start 20s，retries 6）。
8. **只读冒烟**：§6。
9. **监控**：backend/frontend 日志、Caddy 5xx、事件/订单归因。

### 5.2 健康检查

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "small-house-prod-(backend|frontend|db)"
docker inspect small-house-prod-backend-1  --format '{{.State.Health.Status}}'
docker inspect small-house-prod-frontend-1 --format '{{.State.Health.Status}}'
curl -fsS -o /dev/null -w '%{http_code}\n' https://luwag.shop/api/v1
curl -fsS -o /dev/null -w '%{http_code}\n' https://luwag.shop/
curl -fsS -o /dev/null -w '%{http_code}\n' https://luwag.shop/products/2-tier-gas-spring-sit-stand-desk-converter
```

- 后端镜像健康检查：`node -e fetch('http://127.0.0.1:3000/api/v1')`。
- 前端镜像健康检查：`node -e fetch('http://127.0.0.1:3000/')`。
- 生产 compose 没有独立 `healthcheck:` 块，健康状态来自镜像
  `HEALTHCHECK`；`docker ps` 显示 `(healthy)`。
- Caddy 依赖 backend/frontend 启动，但没有健康条件；必须等两侧 healthy
  再做冒烟。

### 5.3 发布镜像基线 / 最终 Git SHA

发布前必须记录（当前值，2026-11-11 只读核对）：

| 项目 | 当前值 |
|---|---|
| backend 镜像 | `small-house-prod-backend:latest` |
| backend 镜像 ID/Digest | `sha256:52b281cd097e90d1092cbc629aeea77c3e987cd14ceee6a2ae070431cb259bcd` |
| frontend 镜像 | `small-house-prod-frontend:latest` |
| frontend 镜像 ID/Digest | `sha256:8b93a2005456248d1f62e888a77af9afa4a86f595e871fbb11331a4228fcc8b8` |
| 回滚标签 | `rollback-pre-meta-attr-<TS>`（前后端各一个，指向上述 digest） |

- 新版本最终 Git SHA：以本地 tag **`release/meta-attribution-20261111`**
  指向的 commit 为准；构建前在 worktree 执行
  `git rev-parse release/meta-attribution-20261111` 并把 SHA 写入发布记录。
- 镜像构建后记录新镜像 ID/Digest；回滚标签指向**旧** digest，不要被新 build
  覆盖（先 tag 旧镜像，再 build）。
- 若 tag 未创建或 SHA 与构建 worktree 不一致，停止发布。

## 6. 生产只读冒烟方案（不写入真实报表）

> 生产冒烟**不调用** touch / analytics ingest，不创建链接/短链，不下单。
> 真实广告链接只用于 GET 页面、GET 短链 302、GET Admin API、GET 报表。
> 写路径（touch claims、事件、订单快照）已由 Staging 与集成测试覆盖。

### 6.1 使用的现有对象（只读查询所得，仅 GET/302）

- 链接：`88ZZPLLih2aHbelP`，AID `OP-2D88029D53F6`，商品
  `/products/2-tier-gas-spring-sit-stand-desk-converter`（P-000018），ACTIVE。
- 短链：`RQAVC4h6` → `/products/2-tier-gas-spring-sit-stand-desk-converter?aid=OP-2D88029D53F6`
  （目标无 `cl`，适合验证短链转发 `cl`）。
- 管理员：`01a09f54-0cc4-778e-a853-197b296cd8b0`（`admin@luwag.shop`，SUPER_ADMIN）。

### 6.2 验证项

1. **页面**：`GET /`、商品页、`/s/RQAVC4h6` 均 200。
2. **短链 302**：
   ```bash
   curl -s -D - -o /dev/null \
     "https://luwag.shop/s/RQAVC4h6?cl=88ZZPLLih2aHbelP&aid=OP-2D88029D53F6&adid=120200000000900&fbclid=IwARsmoke1234567890"
   ```
   期望 302，`Location` 同时含 `cl=88ZZPLLih2aHbelP`、`aid`、`adid`、`fbclid`。
3. **Admin 链接 API**（只读）：用生产 backend 容器内 `@nestjs/jwt` 签
   SUPER_ADMIN 令牌，`GET /api/v1/admin/campaign-links?search=88ZZPLLih2aHbelP`
   → 返回 `cleanPath`（无 `?cl`/`?aid`）、`cl`、
   `metaUrlParameters=cl=...&aid=...&adid={{ad.id}}`。
   ```bash
   TOKEN=$(docker exec small-house-prod-backend-1 node --input-type=module -e \
     "import {JwtService} from '@nestjs/jwt'; \
      console.log(new JwtService({secret:process.env.JWT_SECRET}).sign(\
        {sub:'01a09f54-0cc4-778e-a853-197b296cd8b0',email:'admin@luwag.shop'},\
        {expiresIn:'1h'}))")
   ```
   仅在发布窗口内使用，不写入任何文件。
4. **DB 只读核对**：确认迁移记录与新列/索引存在；不写入任何行。
   ```sql
   select migration_name, finished_at from _prisma_migrations
   where migration_name='20261111120000_add_analytics_attribution';
   select column_name from information_schema.columns
   where table_name='analytics_events'
     and column_name in ('optimizer_id','aid_snapshot','ad_id','ad_id_source',
                         'ad_id_missing_reason','adset_id','attribution_paid',
                         'link_resolution','attribution_conflict','conflict_detail');
   select indexname from pg_indexes
   where indexname in ('analytics_events_ad_id_event_name_event_day_idx',
                       'analytics_events_optimizer_id_event_name_event_day_idx',
                       'analytics_events_campaign_link_id_ad_id_event_day_idx',
                       'order_attributions_link_id_ad_id_idx',
                       'order_attributions_ad_id_attributed_at_idx');
   ```
   期望：迁移 `finished_at` 非空，10 列 + 5 索引齐全。
5. **报表只读检查**：`GET /api/v1/admin/marketing/reports?from=<today>&to=<today>&groupBy=ADID`
   与 `groupBy=AID` → 200；返回结构含 `adVisits/productViews/linkCount/adCount`，
   不要求出现特定 AdID 行（生产真实流量尚未到达时行数可为 0）。
6. **不做任何生产写入**：不调用 touch、不调用 analytics ingest、不创建链接/
   短链、不下单、不触发 Purchase、不发送 Meta 测试事件。
7. **写路径验证由 Staging/集成测试承担**：Staging 已验证 touch claims
   （`linkId/adId/adIdSource/linkResolution`）、12 条事件、订单 `PH100021`
   快照、ADID/AID 报表；集成测试 `does not multiply order amounts...` 等 16/16
   通过。生产不重复制造这些写入。
8. **发布后观察真实流量**（不制造数据）：后端启动后 30–60 分钟内，只读查询
   新到达的真实事件/订单是否带 `campaign_link_id`、`optimizer_id`、`ad_id`：
   ```sql
   select count(*) filter (where campaign_link_id is not null) as linked,
          count(*) filter (where ad_id is not null) as with_adid
   from analytics_events where created_at > now() - interval '60 minutes';
   select count(*) filter (where a.link_id is not null) as linked_orders,
          count(*) filter (where a.ad_id is not null) as with_adid
   from orders o left join order_attributions a on a.order_id=o.id
   where o.created_at > now() - interval '60 minutes';
   ```
   若 60 分钟内没有真实流量，继续观察，不用合成请求“补数据”。

### 6.3 停止/回滚条件

出现任一情况立即停止并回滚镜像：

- 迁移记录缺失，或 10 列/5 索引不齐；
- `https://luwag.shop/api/v1` / 首页 / 商品页非 200；
- Admin 链接 API 500，或返回缺 `cleanPath`/`cl`/`metaUrlParameters`；
- ADID/AID 报表 500，或返回结构缺 `adVisits/productViews/linkCount/adCount`；
- backend 日志出现 Prisma/迁移错误、订单创建 5xx；
- 真实流量观察中，`page_url` 带 `cl=`/`aid=` 的事件持续 `campaign_link_id NULL`
  （排除窗口前旧流量），或真实订单归因异常升高。

注意：生产不执行 touch/analytics 写入，因此上述条件**不包含**合成请求的
`accepted=0` 或 claims 字段检查；这些由 Staging/集成测试覆盖。

## 7. 回滚方案

### 7.1 代码回滚（优先）

- 若**迁移前**失败：旧 backend 仍在跑；不执行 `up -d backend` 即可，新镜像/
  一次性容器可保留或删除；已预应用的迁移是可空列，旧代码兼容，无需回滚 DB。
- 若**后端已重建后**失败：
  ```bash
  docker tag small-house-prod-frontend:rollback-pre-meta-attr-<TS> small-house-prod-frontend:latest
  docker tag small-house-prod-backend:rollback-pre-meta-attr-<TS>  small-house-prod-backend:latest
  docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d --force-recreate frontend
  docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d --force-recreate backend
  ```
  前端先回、后端后回；验证 health + §6.2 的页面/短链/报表只读项。
- DB **不回滚**（保留新列）；旧代码忽略新列。

### 7.2 数据库回滚（仅灾难，需单独授权）

- 按 §3.3 从发布前 dump 恢复到 clean 库；会丢失备份点之后的订单/事件。
- 只有在迁移导致不可恢复的 schema 问题时才执行；优先保留新列 + 代码回滚。

### 7.3 Claims v2 回滚副作用

- 回滚到旧后端后，新后端已签发且存于用户浏览器的凭据会被旧后端拒绝：
  这些用户的事件不挂链接、订单暂无归因，直到重新点击投放链接。
- 风险窗口为 **7 天 TTL**；24 小时监控只覆盖早期信号，不能视为风险解除。
- 恢复优先级：恢复修复后的新后端 → 用户重新触达 → 等 TTL 过期。
  不自动重签、不批量补发、不做数据库层修复。
- 监控持续到回滚后 7 天或恢复新后端为止；指标见 §2.4。

## 8. 风险清单

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 迁移锁阻塞 analytics 写入 | 低 | 毫秒级 | 表小；Staging 24.6ms；低峰执行 |
| 迁移失败导致 backend 不启动 | 低 | 服务不可用 | 预应用迁移；失败时不重建 backend；备份 |
| 新旧 claims 混合解析 | 低（单实例） | 部分事件/订单暂失归因 | 后端先发；回滚顺序；监控 |
| 前端先发导致字段缺失 | 中（若顺序错） | 链接页显示不全 | 强制后端先发 |
| 备份在同主机 | 中 | 主机丢失不可恢复 | 发布前复制到主机外；建议 cron+异地 |
| 生产无备份 cron | 高 | RPO 不可控 | 发布前手动备份；后续补 cron |
| 生产冒烟误写入真实报表 | 已消除 | 真实 touch/analytics 会污染核算 | 冒烟改为纯只读；写路径由 Staging/集成测试覆盖 |
| 迁移部分 DDL 残留 | 低（已补事务） | 需手工清理或恢复 | 迁移显式 `BEGIN/COMMIT`；临时库失败演练 0 残留 |
| claims v2 回滚 7 天窗口 | 中（若回滚后端） | 部分事件/订单最长 7 天无归因 | 优先只回前端/恢复新后端；7 天监控；用户重新触达 |
| 三参数口径下 campaign/adset/UTM 为空 | 确定 | 报表维度缺失 | 已知边界；需要时追加参数 |

## 9. 发布前 Go/No-Go 清单（需用户明确授权）

- [ ] 审核本方案并授权生产发布。
- [ ] 生产 HEAD 仍为 `1a3cbaf4`（或已明确 rebase）。
- [ ] release tag `release/meta-attribution-20261111` 的 SHA 已记录，并与构建 worktree 一致。
- [ ] 旧 backend/frontend 镜像 ID/Digest 已记录，回滚标签指向旧 digest。
- [ ] 备份完成、sha256 校验通过、已复制到主机外。
- [ ] 已在独立临时库完成真实 `pg_restore` 恢复演练（§11.1）。
- [ ] 迁移文件含显式 `BEGIN/COMMIT`，已完成失败探针（0 残留，§11.2）。
- [ ] `.env.deploy` 存在，构建参数不含空 Pixel ID 等异常。
- [ ] 维护窗口/低峰时间确认。
- [ ] 生产冒烟为**纯只读**，不调用 touch/analytics ingest，不写真实报表。
- [ ] 已确认 claims v2 回滚的 7 天风险窗口与恢复方案（§2.4/§7.3）。
- [ ] 发布后监控人/停止条件确认。
- [ ] 明确：**不创建生产测试订单、不发送 Meta 测试事件。**

## 10. 关联证据

- 生产发布记录：`docs/superpowers/plans/2026-11-11-meta-attribution-production-release-record.md`
- Staging 验收：`docs/superpowers/plans/2026-11-11-meta-attribution-staging-evidence.md`
- 审核报告（含第二轮补充）：`docs/superpowers/plans/2026-11-11-meta-attribution-audit-report.md`
- 迁移：`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`
- 实施计划/规格：`docs/superpowers/plans/2026-11-11-meta-attribution-cl-aid-adid.md`、
  `docs/superpowers/specs/2026-11-11-meta-attribution-cl-aid-adid.md`

---

## 11. 验证证据（本轮只读/隔离环境）

### 11.1 生产备份真实恢复演练

使用最近一次生产备份（**不是**发布前新备份）：

- 源文件：`/opt/backups/cart-added-20261110T055829Z/prod.dump`
  （PostgreSQL custom dump，840KB，archive created 2026-11-10 05:58:29 UTC）。
- SHA256（远端与本地一致）：
  `e75bf9d95dec252210c662029b6385b1ac95b6ebd778545327d9657d893cd386`。
- 本地隔离环境：`small-house-postgres`（PostgreSQL 18.6，独立于生产/Staging），
  新建临时库 `meta_attr_restore_20261111`，执行：
  ```bash
  docker exec -i small-house-postgres pg_restore -U postgres \
    -d meta_attr_restore_20261111 --no-owner --no-privileges < prod.dump
  ```
  `pg_restore` exit 0。

恢复后核对（恢复库 vs 生产当前）：

| 指标 | 恢复库 | 生产当前 | 说明 |
|---|---:|---:|---|
| public 表数 | 87 | 87 | 一致 |
| orders | 10 | 10 | 一致 |
| order_items | 10 | 10 | 一致 |
| order_attributions | 10 | 10 | 一致 |
| order_attributions（有 optimizer） | 6 | 6 | 一致 |
| 最大订单创建时间 | 2026-11-07 01:14:56+00 | 同左 | 一致 |
| analytics_events | 5,055 | 5,471 | 备份后新增 416，预期 |
| campaign_links | 21 | 22 | 备份后新增 1，预期 |
| campaign_link_visits | 1,081 | 1,097 | 备份后新增 16，预期 |

- 演练后已 `DROP DATABASE meta_attr_restore_20261111`，并删除本地临时 dump；
  未在生产/Staging 库执行恢复。
- 结论：备份可真实恢复，核心表/订单/归因行数与备份时点一致；差异来自备份后
  的真实新增流量，符合预期。
- **RPO 修正**：发布前备份只把 RPO 限到备份时刻，不是 0；备份后的写入在
  DB 恢复时会丢失。发布前备份必须紧邻迁移，恢复前先停写。

### 11.2 Prisma 迁移事务核实

- Prisma：`7.10.0`（`@prisma/client` 7.10.0）；迁移文件原本**没有**显式
  `BEGIN/COMMIT`。
- 临时库 A（无显式事务的失败探针，`CREATE TABLE` + `SELECT 1/0`）：
  `prisma migrate deploy` exit 1；检查发现 `tx_probe` 表**仍然存在**
  → Prisma 7.10.0 不会自动包裹事务。
- 修正：迁移文件已加显式 `BEGIN; ... COMMIT;`。
- 临时库 B（带显式事务 + 在 `COMMIT` 前注入 `SELECT 1/0` 的真实迁移副本）：
  `migrate deploy` exit 1；检查结果：
  - 新列数 = **0**
  - 新索引数 = **0**
  - `_prisma_migrations` 记录 `finished_at IS NULL`、`rolled_back_at IS NULL`
    （失败待处理）
  → 显式事务完整回滚 DDL。
- 正常路径：带显式事务的真实迁移在 fresh DB 上 exit 0，4 个抽检列存在。
- 失败恢复步骤（生产）：
  1. 查 `_prisma_migrations` 失败记录；确认新列/索引数均为 0；
  2. 若为 0：`./node_modules/.bin/prisma migrate resolve --rolled-back 20261111120000_add_analytics_attribution`，修复原因后重试 `migrate deploy`；
  3. 若有部分 DDL（理论上不应发生）：按迁移清单逐项 `DROP INDEX`/
     `ALTER TABLE ... DROP COLUMN`，或从 §11.1 备份恢复；随后
     `migrate resolve --rolled-back` 再重试；
  4. backend entrypoint `set -e` 不会在迁移失败后启动 API。
- Staging 的 `_prisma_migrations` 显示已应用，`migrate status` 仍为
  `Database schema is up to date!`；Staging 应用的是加事务前的等价 DDL，
  生产将应用带事务的版本。

### 11.3 Claims v2 回滚兼容结论

- 本轮**未构建**兼容回滚镜像（不扩大开发）。
- 明确接受：回滚到旧后端后，新后端已签发凭据最长 **7 天**不可解析；
  24 小时监控不构成风险解除。
- 恢复优先级与监控指标见 §2.4/§7.3。
- 若后续批准，可单独构建 `1a3cbaf4 + 3 个 optional claims 字段` 的
  rollback-compat 镜像；本轮不做。

### 11.4 生产只读冒烟清单（最终）

- [ ] `GET /`、商品页、`/s/RQAVC4h6` → 200。
- [ ] `/s/RQAVC4h6?cl=...&aid=...&adid=...&fbclid=...` → 302，Location 参数齐全。
- [ ] `GET /api/v1/admin/campaign-links?search=88ZZPLLih2aHbelP` → `cleanPath`/`cl`/`metaUrlParameters`。
- [ ] `GET /api/v1/admin/marketing/reports?...groupBy=ADID` 与 `AID` → 200，字段齐全。
- [ ] DB 只读：迁移记录、10 列、5 索引齐全。
- [ ] 发布后 30–60 分钟只读观察真实事件/订单归因；不合成写入。
- [ ] 全程不调用 touch/analytics ingest，不创建链接/短链，不下单，不触发 Purchase，
      不发送 Meta 测试事件。
