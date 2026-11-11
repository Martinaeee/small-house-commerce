# Staging 验收证据 — CL/AID/动态 AdID 归因闭环

日期：2026-11-11
环境：`/opt/luwag-staging`（`luwag-staging-*`），数据库 `luwag_staging_test`
基线：`1a3cbaf4` + 本分支提交（见 `git log`）
部署范围：**仅 Staging；未触碰生产容器、生产数据库或生产 compose。**

## 部署

- `rsync` 同步 source；`docker compose --env-file .env build backend frontend` 成功。
- 迁移 `20261111120000_add_analytics_attribution` 已应用：
  `_prisma_migrations.finished_at = 2026-11-11 04:31:49+00`。
- `analytics_events` 新列存在：`optimizer_id`、`ad_id`、`ad_id_source`、
  `ad_id_missing_reason`、`aid_snapshot`、`adset_id`、`attribution_paid`、
  `link_resolution`、`attribution_conflict`、`conflict_detail`。
- 容器健康：backend / frontend / db 均 healthy。

## 测试链接

通过 admin API 创建（`POST /api/v1/admin/campaign-links`）：

```json
{
  "id": "01a1c8ec-0e29-71f8-a584-c9f04914a223",
  "code": "rdmiTMfdJOMh1IQV",
  "aid": "OP-F06ECB704CC3",
  "cleanPath": "/products/e2e-legacy-style",
  "metaUrlParameters": "cl=rdmiTMfdJOMh1IQV&aid=OP-F06ECB704CC3&adid={{ad.id}}",
  "path": "/products/e2e-legacy-style?cl=rdmiTMfdJOMh1IQV",
  "sourceType": "META_AD",
  "attributionMode": "CL"
}
```

## 验收结果（11 项通过 + 第 12 项 N/A）

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 创建 META_AD 链接，URL 不带追踪参数 | 通过 | `cleanPath` 无 `?cl`/`?aid`；FB_POST 未在本次创建 |
| 2 | 干净 URL 直接打开 | 通过 | `GET /products/e2e-legacy-style` → 200 |
| 3 | 模拟 `cl + aid + adid` 三参数 | 通过 | touch claims 含 `linkId`、`aid`、`adId=120200000000001`、`adIdSource=META_DYNAMIC`、`linkResolution=CL` |
| 4 | 同一 CL 三个 AdID 分开统计 | 通过 | ADID 报表 3 行，`adVisits` 各 1；随后新增第 4 个 AdID 也独立成行 |
| 5 | 不同 AID 的优化师归属 | 通过 | `OP-E2E-OPT` touch：`ownerUserId=E2E Optimizer`、`linkId` 保留、`attributionConflict=true`、`conflictDetail` 有值；ADID 报表该行 owner 为 `E2E Optimizer` |
| 6 | 浏览/加购/结账参数不丢失 | 通过 | 12 条事件（PAGE_VIEW/PRODUCT_VIEW/ADD_TO_CART/BEGIN_CHECKOUT × 3 AdID）全部 `campaign_link_id`、`optimizer_id`、`ad_id` 有值 |
| 7 | 测试订单归因快照 | 通过 | `PH100021`：`optimizer_id`、`aid_snapshot=OP-F06ECB704CC3`、`adid=120200000000001`、`ad_id=120200000000001`、`adid_source=META_DYNAMIC`、`link_id`、`product_id` 有值；`campaign_id`/`adset_id`/UTM 为空（允许） |
| 8 | 按优化师/商品/AdID/CL 筛选与分组 | 通过 | ADID 报表 4 行（3 个 E2E Admin + 1 个 E2E Optimizer）；AID 报表 2 行，`linkCount`/`adCount` 与去重集合一致 |
| 9 | 旧 AID-only 链接兼容 + 动态 AdID | 通过 | `linkId=null`、`linkResolution=AID`、`adId=120200000000005`、`adIdSource=META_DYNAMIC`；事件行同上 |
| 10 | 短链 302 不丢参数 | 通过 | `GET /s/yroG57rK?cl=...&aid=...&adid=...&fbclid=...` → 302 `Location: http://127.0.0.1:8088/products/e2e-legacy-style?cl=...&aid=...&adid=...&fbclid=...` |
| 11 | 未知 CL + 有效 AID 回退 + 冲突 | 通过 | claims：`linkId=null`、`linkResolution=AID_FALLBACK`、`attributionConflict=true`、`conflictDetail="CL missing-code did not resolve; used AID OP-F06ECB704CC3"` |
| 12 | Pixel/CAPI | 不适用（Staging 显式关闭） | compose `NEXT_PUBLIC_META_PIXEL_ID=""`；由 63 个 CAPI/触达单元测试与现有 event_id 去重测试覆盖，未在 Staging 发送真实 Pixel 事件 |

## 数据库核对

- `campaign_link_visits`：测试链接 5 条（3 个 AdID + 冲突 AID + 下单触达）。
- `analytics_events`：最近 30 分钟 13 条测试事件；12 条带 `campaign_link_id` +
  `optimizer_id` + `ad_id`，1 条 AID-only（`campaign_link_id NULL`、`ad_id` 有值）。
- `order_attributions`：`PH100021` 见上表第 7 项。

## 说明

- 第一次订单脚本因未发送必填 `attribution` 对象返回 400；补上
  `attribution: { sourceType: "ORGANIC" }` 后成功。服务端仍以验签 claims 为准，
  客户端 `sourceType` 未影响归因。
- 未执行 Task 15（生产发布）与 Task 16（历史回填）。

---

## 审核补充（第二轮）

### 代码版本

- Staging 实际运行源码 = **`0aae52d3`**（部署时 worktree 的最后一个运行时提交）。
- 验证：`git archive 0aae52d3` 后执行
  `rsync -a --checksum --delete --dry-run -i -e ssh`（排除
  `node_modules/.next/.git/dist/*.tsbuildinfo/backend/uploads/backend/src/generated/frontend/next-env.d.ts`）
  → **0 行差异**。
- 当前 worktree 与 Staging source 的差异 = 6 行：3 个测试文件、
  `marketing-report.service.ts`（仅类型标注）、2 个文档；运行时行为未变。
- `4ecf81d6` 是审核报告提交（父 `f34b9e68`）；`f34b9e68` 是 Staging 证据提交。
  两个提交都不包含运行时逻辑变更。

### 验收口径修正

- Staging：**11 项实测通过**；第 12 项 Pixel/CAPI 为 **N/A**（compose 显式
  `NEXT_PUBLIC_META_PIXEL_ID=""`，不发送真实 Pixel 事件）。
- Pixel/CAPI 由单元测试另行覆盖：
  - 后端 `src/modules/meta-capi`：5 文件 / 34 测试通过。
  - 前端 `PurchaseTracking.spec.tsx` + `tracking.touch.spec.ts`：2 文件 /
    34 测试通过。
- 关键测试：`sends one deduplicated event with hashed user data`、
  `queues one row per event id, even when the browser retries the same POST`、
  `fires the stashed payload Purchase once with the server value`、
  `a refresh after the payload load never re-fires the Purchase`。

### rsync --delete dry-run

实际部署：

```bash
rsync -a --delete -e ssh \
  --exclude node_modules --exclude .next --exclude .git \
  <worktree>/small-house-commerce/ \
  luwag-new:/opt/luwag-staging/source/small-house-commerce/
```

审计 dry-run（`0aae52d3` ↔ Staging source，排除构建/运行产物）：

```bash
rsync -a --checksum --delete --dry-run -i -e ssh \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude dist --exclude '*.tsbuildinfo' \
  --exclude backend/uploads --exclude backend/src/generated \
  --exclude frontend/next-env.d.ts \
  /tmp/meta-attr-0aae52d3/small-house-commerce/ \
  luwag-new:/opt/luwag-staging/source/small-house-commerce/
# 0 行
```
