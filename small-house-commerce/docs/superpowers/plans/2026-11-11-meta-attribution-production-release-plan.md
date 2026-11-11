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
- 回滚到旧后端后，监控 24 小时内的事件未归因/订单无归因是否升高；不做自动
  重签或降级（当前无此逻辑）。

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
  丢失风险。
- 记录 `TS/TAG`、dump 大小、sha256、当前镜像 ID，写入发布记录。

### 3.3 恢复演练/灾难恢复

- 恢复演练（不覆盖生产）：在 DB 容器内创建临时库
  `small_house_restore_<TS>`，用 `pg_restore` 恢复 dump，核对
  `orders/order_attributions/analytics_events` 行数，然后删除临时库。
- 灾难恢复（需单独授权）：
  1. `docker compose --env-file .env.deploy -f docker-compose.prod.yml stop backend frontend`
  2. 在 db 容器内 `DROP DATABASE small_house WITH (FORCE); CREATE DATABASE small_house OWNER smallhouse;`
  3. `cat prod.dump | docker exec -i small-house-prod-db-1 pg_restore -U smallhouse -d small_house`
  4. 启动 backend（entrypoint 会 `migrate deploy`，无 pending）→ 启动 frontend
  5. 健康检查 + 非下单冒烟。
- **不要把 dump 直接恢复到现有库**（会因对象重复失败）；必须先 clean/重建库。
- 当前无 cron → RPO = 距最近一次手动备份；发布前备份可把本次 RPO 压到 0。
  RTO 约数分钟（dump 840KB）。

## 4. 迁移安全性、可重复性与回滚影响

### 4.1 安全性

- 10 个新列全部 `NULL`、无 `DEFAULT`；PostgreSQL 仅改元数据，不重写表。
- 5 个新索引均为普通 `CREATE INDEX`（非 CONCURRENT）：
  - `analytics_events` 5,471 行 / 3.5MB
  - `order_attributions` 10 行 / 112KB
- 锁影响：`ALTER TABLE` 短暂 `ACCESS EXCLUSIVE`；`CREATE INDEX` 的 `SHARE`
  锁会阻塞这两张表的写入，但表很小；Staging 同迁移实测 **24.6ms**，
  生产预计 <1s。
- Prisma 在事务中执行迁移；失败会回滚 DDL，backend entrypoint `set -e`
  不会启动 API。

### 4.2 可重复性

- 通过 `prisma migrate deploy` 执行，`_prisma_migrations` 记录后重复执行是
  no-op。
- 迁移 SQL 本身**不是** `IF NOT EXISTS` 幂等；禁止手工重复执行原始 SQL。
- 如果迁移中途失败：先查 `_prisma_migrations` 状态；不要直接重跑；在确认
  DDL 已回滚后，用 `prisma migrate resolve --rolled-back` 再由 entrypoint
  重试。生产场景优先按 §3.3 从备份恢复，再重新发布。

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
8. **非下单冒烟**：§6。
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

## 6. 生产非下单冒烟方案

### 6.1 使用的现有对象（只读查询所得）

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
4. **Storefront touch**：
   ```bash
   POST /api/v1/storefront/marketing-touch
   { "code":"88ZZPLLih2aHbelP", "aid":"OP-2D88029D53F6",
     "adId":"120200000000900", "path":"/products/2-tier-gas-spring-sit-stand-desk-converter",
     "visitKey":"release-smoke-20261111T..." }
   ```
   期望 200；解码 credential：`linkId` 有值、`adId=120200000000900`、
   `adIdSource=META_DYNAMIC`、`linkResolution=CL`、`ownerUserId` 为该链接
   优化师。会写入 1 条 `campaign_link_visits`（用唯一 visitKey 标记）。
5. **Analytics ingest**：
   `POST /api/v1/storefront/events` 一条 PAGE_VIEW，带上述 credential、
   `sessionId=release-smoke-...`；期望 202 `accepted>=1`。
6. **DB 核对**（只读）：
   ```sql
   select visit_key, visit_day from campaign_link_visits
   where link_id=(select id from campaign_links where code='88ZZPLLih2aHbelP')
     and visit_key like 'release-smoke-%';
   select session_id, campaign_link_id, optimizer_id, ad_id, ad_id_source, link_resolution
   from analytics_events where session_id like 'release-smoke-%';
   ```
   期望：链接、优化师、AdID 均有值。
7. **报表 API**：`GET /api/v1/admin/marketing/reports?from=<today>&to=<today>&groupBy=ADID`
   与 `groupBy=AID` → 200，能找到 `adId=120200000000900` 行；`visits=null`，
   `adVisits` 独立。
8. **不做**：不下单、不创建测试订单、不触发 Purchase、不发送 Meta 测试事件、
   不创建生产测试链接（复用现有链接）。
9. 冒烟产生的 1 条 visit + 1 条 event 保留并标记 `release-smoke-*`；是否清理
   由发布后单独授权决定（不在本方案自动执行）。

### 6.3 停止/回滚条件

出现任一情况立即停止并回滚镜像：

- 迁移失败，或 5 分钟内 backend 未 healthy；
- `https://luwag.shop/api/v1` / 首页 / 商品页非 200；
- touch 返回非 200、credential 为空、claims 字段缺失/错误；
- analytics ingest 202 但 `accepted=0`（排除限流后仍为 0）；
- ADID/AID 报表 500 或找不到冒烟 AdID 行；
- backend 日志出现 Prisma/迁移错误、订单创建 5xx；
- 真实订单归因异常升高（监控订单/事件）。

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
- 监控 24 小时；不自动重签。若影响面大，优先恢复新后端而不是长期停留在旧后端。

## 8. 风险清单

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 迁移锁阻塞 analytics 写入 | 低 | 毫秒级 | 表小；Staging 24.6ms；低峰执行 |
| 迁移失败导致 backend 不启动 | 低 | 服务不可用 | 预应用迁移；失败时不重建 backend；备份 |
| 新旧 claims 混合解析 | 低（单实例） | 部分事件/订单暂失归因 | 后端先发；回滚顺序；监控 |
| 前端先发导致字段缺失 | 中（若顺序错） | 链接页显示不全 | 强制后端先发 |
| 备份在同主机 | 中 | 主机丢失不可恢复 | 发布前复制到主机外；建议 cron+异地 |
| 生产无备份 cron | 高 | RPO 不可控 | 发布前手动备份；后续补 cron |
| 冒烟产生少量测试 visit/event | 确定 | 报表有 1 条标记数据 | 唯一 `release-smoke-*` 前缀；按需授权清理 |
| 三参数口径下 campaign/adset/UTM 为空 | 确定 | 报表维度缺失 | 已知边界；需要时追加参数 |

## 9. 发布前 Go/No-Go 清单（需用户明确授权）

- [ ] 审核本方案并授权生产发布。
- [ ] 生产 HEAD 仍为 `1a3cbaf4`（或已明确 rebase）。
- [ ] 备份完成、sha256 校验通过、已复制到主机外。
- [ ] 回滚镜像标签已创建并记录 ID。
- [ ] `.env.deploy` 存在，构建参数不含空 Pixel ID 等异常。
- [ ] 维护窗口/低峰时间确认。
- [ ] 发布后监控人/停止条件确认。
- [ ] 明确：**不创建生产测试订单、不发送 Meta 测试事件。**

## 10. 关联证据

- Staging 验收：`docs/superpowers/plans/2026-11-11-meta-attribution-staging-evidence.md`
- 审核报告（含第二轮补充）：`docs/superpowers/plans/2026-11-11-meta-attribution-audit-report.md`
- 迁移：`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`
- 实施计划/规格：`docs/superpowers/plans/2026-11-11-meta-attribution-cl-aid-adid.md`、
  `docs/superpowers/specs/2026-11-11-meta-attribution-cl-aid-adid.md`
