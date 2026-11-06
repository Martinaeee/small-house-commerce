# 商品漏斗监控与结账提交失败埋点：发布记录

日期：2026-11-06。状态：本地端到端验收通过，**生产发布待授权**。

- 基线：`53304bce`
- 提交：`474f7d30`（设计）、`299af3e5`（实施计划）、`68df9e1f`、`432e98d3`、`956d808c`、`6003c193`、`59880a64`、`a74b99fe`、`9969ee80`、`8d852d6f`
- 迁移：`20261106120000_add_checkout_submit_events`（`analytics_events.event_name` 枚举新增 `CHECKOUT_SUBMIT_ATTEMPT`、`CHECKOUT_SUBMIT_FAILED`，只有 `ADD VALUE IF NOT EXISTS`，向后兼容，可先执行）
- 范围：后端 + 前端
- 发布顺序：**先后端、再前端**。前端一旦开始发事件，后端枚举与诊断 schema 必须已经在跑；反过来停前端不会影响后端接收。

## 需求

用户原话：「这个盲区怎么改，我希望后台能监控用户浏览落地页的全链路，对我来说透明，我能及时发现问题并且针对性的优化。」

确认过的口径：

1. 按商品分组的全链路漏斗：访问 → 商品浏览 → 加购 → 发起结账 → 提交尝试 → 提交失败（带原因）→ 订单。
2. 报表页自动标红异常，推送给电话/邮件之外不做。
3. 失败原因五类可读标签，同时保留原始错误消息、HTTP 状态码和完整上下文。
4. 下沉明细 = 汇总 + 会话时间线 + 筛选。
5. 入口是投放工作台新增的「商品漏斗」页签。
6. 流量口径 = 投放 + 自然，可筛选。
7. 复用 `analytics_events`，只加两个枚举值。
8. 失败事件必须带客户姓名、电话、地址、备注和**完整幂等键**。

## 设计要点

- **按商品**：事件经 PDP 路径、`/lp/<slug>`、`metadata.productId` 或 SKU 列表归到商品；SKU 列表优先（`entity_id` 只有 120 字符，长购物车会截断，`BEGIN_CHECKOUT` 因此补了 `metadata.skuIds`）。
- **会话去重**：每一步是区间内去重会话数；步骤率用相邻两步的**会话交集**（Buy Now 可以跳过加购，所以不能拿「上一步总人数」作分母）；订单数来自 `order_items`/`orders` 真实订单，与 `orderingSessions` 分开列。
- **异常基线**：区间前 7 天的每日比率中位数；基样本 ≥ 20 才判异常；失败率高于 `max(10%, 基线×2)` 标红，其余步骤低于基线 50% 标红；无基线或样本不足显示「样本少 / 无基线」而不是标红。
- **归因边界**：负责人按事件所属的 `campaign_links` / 订单归因过滤，**不按商品过滤**；个人账号（`MARKETING_VIEW_OWN`）看不到无法归属的自然流量。
- **失败分类**：`VALIDATION | STOCK | NETWORK | SERVER | UNKNOWN`，由 `ApiError.status/code` 决定；`INSUFFICIENT_STOCK`、`SKU_UNAVAILABLE`、`SKU_NOT_PRICED` 归 STOCK，≥500 归 SERVER，400/422 归 VALIDATION，`TypeError`/`AbortError`/`TimeoutError` 归 NETWORK。
- **一次点击一个 occurrence**：`attemptId` + `retry` 由点击时生成，ATTEMPT 与对应的 FAILED 共用；成功后 `clearSubmitAttempt()`；表单页与确认页共用 scope，策略路径（`/checkout/confirm` → `/checkout`）归一。
- **隐私**：诊断只进第一方事件表，只在管理员会话接口返回；默认打码（电话只留后四位，其余 `***`），点「显示完整信息」才展开；服务端日志只记错误名不记消息。

## 改动

后端：

- `backend/prisma/schema/analytics.prisma` 枚举 + 迁移 `20261106120000_add_checkout_submit_events`。
- `analytics-event.dto.ts`：这两类事件走专用诊断 schema，服务端上限 16 KiB（普通事件仍 4 KiB）。
- `checkout-metadata.ts`（新）：zod 白名单，未知字段直接丢弃；客户字段长度上限；消息里出现的客户值、手机号、邮箱统一打码；超限返回 null。
- `analytics.service.ts`：仅 `CHECKOUT_SUBMIT_*` 走诊断校验；日志改为只输出错误名。
- `orders.service.ts` / `inventory.service.ts`：库存与不可售错误带稳定 `code`（`INSUFFICIENT_STOCK`、`SKU_UNAVAILABLE`、`SKU_NOT_PRICED`）。
- `marketing-funnel.{sql,service,metrics}.ts` + `admin/marketing-funnel.controller.ts`：`/api/v1/admin/marketing/funnel`、`/sessions`、`/:productId/detail`，`JwtAuthGuard + MarketingGuard`，`Cache-Control: private, no-store`。

前端：

- `src/lib/api.ts`：`ApiError` 带 `status` / `code`。
- `src/lib/checkout-events.ts`：重写为 occurrence 模型；客户字段白名单；4 KiB 修剪只压缩 `variantNames` / `message`，完整幂等键保留。
- 结账表单（`CheckoutForm.tsx`）、确认页（`CheckoutConfirmView.tsx`）、PDP 内联 COD（`PdpQuickCodOrder.tsx`）三处接入。
- `commerce-events.ts`：`BEGIN_CHECKOUT` 补 `metadata.skuIds`。
- `src/lib/funnel-api.ts`、`ProductFunnel.tsx`、`ProductFunnelDrawer.tsx`、`funnel-display.ts`、`MarketingWorkbench.tsx` 新增页签、`src/app/admin/(shell)/marketing/funnel/page.tsx`。
- 中英文案。

## 验收（本地隔离环境）

隔离库 `luwag_post_links_local_e2e_20261103`（127.0.0.1:5441），后端 4104，前端 dev `localhost:4023`。

| 检查 | 结果 |
| --- | --- |
| 后端 `pnpm build` | exit 0 |
| 后端测试 | 2582 通过；唯一失败是既有的 `uploads.service.spec.ts` 大 mp4 转码 5s 超时，与本改动无关 |
| 前端测试 | 330 文件 / 3650 测试全过 |
| 前端 `tsc --noEmit`（营销组件） | 无输出 |
| 迁移 | `prisma migrate deploy` 成功 |
| 集成测试 | `marketing-funnel.integration.spec.ts` 3/3 |
| 浏览器：表单校验失败 | 事件体 `CHECKOUT_SUBMIT_FAILED{step:form, reason:VALIDATION, field:phone, customer{…}, idempotencyKey:""}` 与 `CHECKOUT_SUBMIT_ATTEMPT` 同一 `attemptId`，接口 200 |
| 浏览器：确认页库存失败 | `CHECKOUT_SUBMIT_FAILED{step:confirm, reason:STOCK, httpStatus:400, message:"Insufficient stock for E2E-CS-RED-S: available 0, requested 1", customer{name,phone,…}, idempotencyKey:"fab25eb1-5060-46d8-bda8-fa5aac69cdc0"}` |
| 后台漏斗页 | 商品行出现，提交尝试 2 / 失败 2（100%）；失败原因分布 VALIDATION 2、STOCK 2，来源自然 2、设备电脑 2；会话时间线可展开、默认打码，点「显示完整信息」后显示客户快照与完整幂等键；失败原因筛选后会话列表收敛 |

## 生产发布与回滚（待授权）

1. 迁移先行：`docker compose ... exec backend pnpm prisma migrate deploy`（只加枚举值，旧代码不受影响）。
2. 后端 → 前端依次重建镜像，`--env-file .env.deploy`。
3. 回滚镜像命名：`rollback-pre-checkout-funnel-20261106`（前端、后端各一份）。
4. 只回滚前端：失败事件停止累积，但后台页和历史数据不受影响；只回滚后端则前端会收到 400（枚举不存在），因此**不要单独回滚后端**。

## 限制

- 提交失败只能从本次前端上线后开始累积；上线前的历史会话无法补出失败记录。
- 断网期间 `sendBeacon` 未送达的事件不会重试，真实失败可能漏记。
- 基线要求区间前 7 天有足够样本（≥20），新品和低流量商品会显示「样本少 / 无基线」而不是标红。
- 访问 / 浏览 / 加购 / 发起结账仍是既有埋点；老事件没有 `skuIds`，只能靠商品路径或截断的 `entity_id` 归属。
