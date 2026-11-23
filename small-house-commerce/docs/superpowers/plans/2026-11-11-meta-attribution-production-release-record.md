# CL/AID/动态 AdID — 生产发布记录

日期：2026-11-11（马尼拉）
发布分支：`staging/luwag-shop-domain`（生产本地分支）
发布 commit/tag：`dfcc96cc` / `release/meta-attribution-20261111`（tag 对象 `ce573b5f`）
发布范围：**Backend + Frontend + 迁移；无生产测试订单，无生产 touch/analytics 合成写入。**

## 1. 发布前基线

- 生产 HEAD：`1a3cbaf4`；工作区 clean。
- 容器：backend/frontend/db/caddy 均 healthy。
- 旧镜像（回滚点）：
  - backend `sha256:52b281cd097e90d1092cbc629aeea77c3e987cd14ceee6a2ae070431cb259bcd`
  - frontend `sha256:8b93a2005456248d1f62e888a77af9afa4a86f595e871fbb11331a4228fcc8b8`
  - 标签：`rollback-pre-meta-attr-20261111T065535Z`

## 2. 备份

- 生产备份：`/opt/backups/meta-attribution-20261111T065535Z/prod.dump`
  （custom dump，SHA256 `8251b0735669c468791cd04387ab7fae2c635435bf49e0ce736d3c7a3aecca80`）。
- 异机副本：`~/luwag-backups/meta-attribution-20261111T065535Z.dump`
  （本机，SHA256 与远端一致，873KB）。
- `pg_restore --list` 可读；发布前备份校验通过。

## 3. 代码与镜像

- 代码通过 git bundle 传输，生产 `staging/luwag-shop-domain`
  fast-forward `1a3cbaf4 → dfcc96cc`，工作区 clean。
- 构建新镜像：
  - backend `sha256:0be59349e302b2bb948facf17bd919285900d4e718d352343ebc1619ac26c85a`
  - frontend `sha256:d27470cec09dcfc2e58502a15476f0ccfc5332cfae729ea388d7305ca85b4969`
- 旧容器在构建期间继续服务；未 push。

## 4. 迁移

- 预应用命令（新 backend 一次性容器，旧 backend 仍在线）：
  `docker compose --env-file .env.deploy -f docker-compose.prod.yml run --rm --entrypoint ./node_modules/.bin/prisma backend migrate deploy`
- 结果：`20261111120000_add_analytics_attribution` 应用成功；
  `started_at 06:59:05.023Z → finished 06:59:05.069Z`，耗时 **45.7ms**。
- 校验：`analytics_events` 新列 **10/10**，新索引 **5/5**。
- 迁移文件含显式 `BEGIN/COMMIT`（发布前审计修正）。

## 5. 容器重建与健康

- `up -d backend` → 约 20s 后 healthy；Nest `successfully started`；
  entrypoint `migrate deploy` no-op。
- `up -d frontend` → 约 10s 后 healthy。
- probes：
  - `https://luwag.shop/api/v1` → 200
  - `https://luwag.shop/` → 200
  - 商品页 `/products/2-tier-gas-spring-sit-stand-desk-converter` → 200
- backend/frontend 日志无 error/exception；Caddy 正常。

## 6. 只读冒烟

- 短链（Caddy/Next，curl 不执行 JS，无写入）：
  `GET /s/RQAVC4h6?cl=88ZZPLLih2aHbelP&aid=OP-2D88029D53F6&adid=120200000000900&fbclid=IwARsmoke1234567890`
  → **302**，`location` 含 `aid/cl/adid/fbclid` 四项。
- Admin 链接 API（GET）：
  `88ZZPLLih2aHbelP` 返回
  `cleanPath=/products/2-tier-gas-spring-sit-stand-desk-converter`、
  `cl=88ZZPLLih2aHbelP`、
  `metaUrlParameters=cl=88ZZPLLih2aHbelP&aid=OP-2D88029D53F6&adid={{ad.id}}`；
  旧 `path` 仍为 `?aid=`（存量 AID 链接，未改写）。
- 报表 API（GET）：
  - `groupBy=ADID` → 200，`total=2`；历史链接事件行 `adId=null`（上线前事件无 AdID），
    `adVisits` 为数字，结构正常。
  - `groupBy=AID` → 200，`total=0`；上线前事件无 `optimizer_id`，需等新真实流量。
- 未调用 touch/analytics ingest，未创建链接/短链，未下单，未触发 Purchase。

## 7. 发布后真实流量观察（首轮）

- 发布后约 10 分钟：8 条真实事件，全部为首页/商品页自然流量；
  `link_resolution`/`optimizer_id`/`ad_id` 均为 0 条（无广告点击到达）。
- 没有合成请求“补数据”；写路径继续由 Staging（touch claims、12 事件、
  `PH100021` 订单）与集成测试覆盖。
- 待继续观察：新广告流量到达后，确认 `link_resolution`、`optimizer_id`、
  `ad_id` 写入及 ADID/AID 报表行；监控至发布后 60 分钟，之后按 7 天观察
  claims 回滚风险（若未回滚则仅常规监控）。

## 8. 回滚状态

- 未触发回滚。
- 回滚镜像：
  - `small-house-prod-backend:rollback-pre-meta-attr-20261111T065535Z`
  - `small-house-prod-frontend:rollback-pre-meta-attr-20261111T065535Z`
- 回滚顺序：前端 → 后端；DB 保留新列，不回滚迁移。
- claims v2 回滚 7 天窗口风险与恢复方案见生产发布方案 §2.4/§7.3。

## 9. 偏差与待办

- AID 报表 `total=0`、ADID 行 `adId=null` 是“上线前事件无新列”的预期；
  新广告流量到达后复核。
- 未使用真实投放链接制造测试访问；生产真实归因验证为观察式。
- 未 push 分支；生产服务器本地分支已 fast-forward 到 `dfcc96cc`。
- 建议后续单独批准：每日 DB 备份 cron + 异机保存（当前仍为手动）。
