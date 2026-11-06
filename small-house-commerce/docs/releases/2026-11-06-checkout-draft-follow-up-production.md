# 草稿订单客服跟进：生产发布记录

日期：2026-11-06。

- 生产域名：https://luwag.shop
- 发布提交：`62d1c233`（含本功能 `bff8459`/`5ee883b`/`cd7188d`，以及同分支的类型修复 `62d1c23`）
- 分支：服务器 `staging/luwag-shop-domain`；部署 ref `deploy/draft-followup-20261106`
- 迁移：`20261105150000_add_checkout_draft_follow_up`（加 5 列、2 索引、1 张只追加事件表；无历史数据回写）
- 备份：`/opt/backups/pre-draft-followup-20261106T010012Z/`（`pre-draft-followup-20261106T010012Z.sql.zst` + `.sha256`）
- 回滚镜像：
  - `small-house-prod-backend:rollback-pre-draft-followup-20261106T010012Z` → `a38fb65e5574`
  - `small-house-prod-frontend:rollback-pre-draft-followup-20261106T010012Z` → `c3197225030e`

## 需求

草稿订单要能进入客服流程：联系顾客、核实是否还要购买。用户确认「草稿保持草稿，加跟进状态」——只有确认要买时才转成正式订单，不污染订单数、库存与风险统计。后续追加两项：列表内联分配负责人（只对有表单数据的草稿显示入口）、备注常用模板下拉。

## 改动

- 数据：`CheckoutDraftFollowUpStatus`（待联系 / 未接 / 稍后联系 / 已确认要买 / 不买）；`follow_up_status`、`assignee_id`、`next_follow_up_at`、`last_contacted_at`、`follow_up_note`（≤500）；`checkout_draft_follow_up_events` 记录每次状态变化（操作人、备注、时间）。
- 接口：`PATCH /api/v1/admin/checkout-drafts/:id/follow-up`（`ORDER_VERIFY`）；列表支持 `followUpStatus`（含 `UNFOLLOWED`）、`assigneeId`、`dueOnly`；`POST /api/v1/admin/orders` 接受可选 `checkoutDraftId`，同一事务内 `updateMany({ status:'OPEN' })` 抢占草稿，0 行返回 409，成功后置 `CONVERTED` 并回写订单号。
- 前端：草稿列表新增「跟进结果 / 负责人 / 下次跟进」列与筛选；负责人格子（仅 `OPEN` 且有 `hasUserInput`）可点开「分配负责人」对话框，一次填写负责人、结果、下次跟进、备注；详情页「客服跟进」面板含时间线，「已确认要买」后才出现「创建订单」对话框（预填草稿信息）。
- 备注模板：六个常用句，商品名取草稿首个商品，选中即填入且可继续编辑。

## 验收

| 检查 | 结果 |
| --- | --- |
| 后端全量 | 2568 passed / 262 skipped；唯一失败 `uploads.service.spec.ts` 5s 超时，单独跑并放宽超时 12/12 通过 |
| 前端全量 | 326 文件 / 3624 条全通过；`tsc --noEmit` 无输出 |
| 空库迁移 | `prisma migrate deploy` 1..80 全部成功 |
| 真实 PostgreSQL 集成 | 跟进写库 + 时间线 + 到期筛选 + 已转草稿 409，通过 |
| 本地浏览器 | 保存跟进、时间线、转单 `PH100007`、已转订单不可二次建单、列表内联分配、模板下拉填充，均通过且无 pageerror |
| 生产容器 | backend / frontend / db healthy，caddy 正常 |
| 生产页面 | `/`、`/collections/all-products`、`/admin/login`、`/admin/orders/drafts` 均 200 |
| 生产接口 | `PATCH .../follow-up` 无令牌 401（路由存在）；带容器签发只读令牌的 `GET /admin/checkout-drafts` 200，返回 `followUpStatus` / `assignee` / `nextFollowUpAt` 等新字段，当前 19 条草稿 |

## 无关附带改动

生产分支在同一次合并中带入了另一会话的 `3a52c37`（投放报表日期选择器改为单一日历）——已在服务器分支上先于本次发布存在，本次发布随快进一并进入生产。本功能的改动文件仅限 checkout-drafts / orders / drafts 页面与 i18n。

## 回滚

```bash
docker tag small-house-prod-backend:rollback-pre-draft-followup-20261106T010012Z small-house-prod-backend:latest
docker tag small-house-prod-frontend:rollback-pre-draft-followup-20261106T010012Z small-house-prod-frontend:latest
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend frontend
```

迁移 80 纯加列/加表，回滚代码后旧后端会忽略新表；如需彻底清库再用备份恢复：

```bash
zstd -d -c /opt/backups/pre-draft-followup-20261106T010012Z/pre-draft-followup-20261106T010012Z.sql.zst | \
  docker compose --env-file .env.deploy -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```
