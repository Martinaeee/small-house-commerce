# Checkout 自动保存草稿：生产发布记录

日期：2026-11-03。

- 生产域名：https://luwag.shop
- 发布提交：`08fefe66`（基线 `25c9d435`）
- 分支：服务器 `staging/luwag-shop-domain`；部署 ref `deploy/checkout-drafts-20261103`
- 迁移：`20261103120000_add_checkout_drafts`（第 77 条，已应用）
- 本地验收记录：[2026-11-03-checkout-autosave-drafts-verification.md](2026-11-03-checkout-autosave-drafts-verification.md)

## 发布前

- 回滚镜像：
  - `small-house-prod-backend:rollback-pre-checkout-drafts-20261103` → `f673b7c63d39`
  - `small-house-prod-frontend:rollback-pre-checkout-drafts-20261103` → `df9f209dcc8f`
- 数据库备份：`/opt/backups/pre-checkout-drafts-20261103-220715/small-house.sql.zst`（zstd 校验通过，1,539,312 字节）
- 生产基线核对：76 条迁移完成，`checkout_drafts` 不存在，工作树干净。

## 执行顺序

1. 服务器工作树 reset 到 `08fefe66`（旧容器继续运行）。
2. `docker compose --env-file .env.deploy -f docker-compose.prod.yml build` → `BUILD_EXIT=0`。
3. `up -d backend`：entrypoint 执行 `prisma migrate deploy`，日志显示 `Applying migration 20261103120000_add_checkout_drafts` 与 `All migrations have been successfully applied.`，容器转 healthy。
4. 数据库复核：`_prisma_migrations` 77 条已完成；`checkout_drafts` 表存在，0 行。
5. `up -d frontend`：容器 healthy。

## 发布后验证

| 检查 | 结果 |
| --- | --- |
| `https://luwag.shop/` | 200 |
| `https://luwag.shop/api/v1` | 200 |
| `https://luwag.shop/checkout` | 200 |
| `https://luwag.shop/admin/orders/drafts` | 200（页面） |
| `GET /api/v1/admin/checkout-drafts`（未登录） | 401 |
| 公开 PUT 建草稿 | 200，行落库 |
| 公开 GET 读草稿 | 200，返回快照 |
| 非法令牌 GET | 404 |
| 缺少令牌 PUT | 400 |
| 同 revision 不同内容 | 409（不再假报已保存） |
| revision 0 | 400 校验 |
| revision 2 | 200 |
| 真实浏览器（1440×900） | `/checkout?skuId=…` 输入姓名/0917 → PUT 200；刷新后姓名与手机恢复；无 pageerror |
| 容器状态 | backend / frontend / db healthy，caddy 正常 |

所有验证草稿行已删除，`checkout_drafts` 回到 0 行；未在生产创建任何正式订单。

## 已知限制

- 创建限额为 backend 进程内计数，重启归零；不是手机号所有权验证。
- 迁移与保存/下单事务的真实并发场景只在本地 mock 与离线 SQL 比对中覆盖；本次生产验证为单次串行写入。
- 后台草稿页需要 `ORDER_VIEW_ALL` 登录后才显示数据。

## 回滚

代码：把两个镜像 tag 重新打为 `latest` 并 `up -d`（新表为 additive，旧代码不引用，可保留）。
数据库：仅在确认迁移本身导致问题时才按 `docs/DEPLOYMENT.md` §7 的干净库恢复流程使用本次备份；不要手工删表。
