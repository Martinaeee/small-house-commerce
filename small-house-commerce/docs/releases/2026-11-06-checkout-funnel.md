# 商品漏斗监控与结账提交失败埋点：发布记录

实现与浏览器验收：2026-11-06；收口复核：2026-11-07。状态：本地验收与最终全量测试通过，**已全套发布生产（2026-11-07）**。

- 基线：`53304bce`
- 提交：`474f7d30`（设计）、`299af3e5`（实施计划）、`68df9e1f`、`432e98d3`、`956d808c`、`6003c193`、`59880a64`、`a74b99fe`、`9969ee80`、`8d852d6f`；最终默认排序修正 `26c255b6`、主表诊断提示补齐 `e731af83`。
- 迁移：`20261106120000_add_checkout_submit_events`（`analytics_events.event_name` 枚举新增 `CHECKOUT_SUBMIT_ATTEMPT`、`CHECKOUT_SUBMIT_FAILED`，只有 `ADD VALUE IF NOT EXISTS`，向后兼容，可先执行）
- 范围：后端 + 前端
- 发布顺序：**先后端、再前端**。前端一旦开始发事件，后端枚举与诊断 schema 必须已经在跑；反过来停前端不会影响后端接收。

## 需求

用户原话：「这个盲区怎么改，我希望后台能监控用户浏览落地页的全链路，对我来说透明，我能及时发现问题并且针对性的优化。」

确认过的口径：

1. 按商品分组的全链路漏斗：访问 → 商品浏览 → 加购 → 发起结账 → 提交尝试 → 提交失败（带原因）→ 订单。
2. 报表页自动标红异常，本期不做电话、邮件或其他对外推送。
3. 失败原因五类可读标签，同时保留原始错误消息、HTTP 状态码和完整上下文。
4. 下沉明细 = 汇总 + 会话时间线 + 筛选。
5. 入口是投放工作台新增的「商品漏斗」页签。
6. 流量口径 = 投放 + 自然，可筛选。
7. 复用 `analytics_events`，只加两个枚举值。
8. 失败事件必须带客户姓名、电话、地址、备注和**完整幂等键**。

## 设计要点

- **按商品**：事件经 PDP 路径、`/lp/<slug>`、顶层 `productId` 或 SKU 列表归到商品；SKU 列表优先（`entity_id` 只有 120 字符，长购物车会截断，`BEGIN_CHECKOUT` 因此补了 `metadata.skuIds`）。
- **会话去重**：每一步是区间内去重会话数；步骤率以上一步去重会话数为分母，与下一步的**会话交集**为分子，避免 Buy Now 跳步导致比率倒挂；订单数来自 `order_items`/`orders` 真实订单，与 `orderingSessions` 分开列。
- **异常基线**：区间前 7 天的每日比率中位数；基样本 ≥ 20 才判异常；失败率高于 `max(10%, 基线×2)` 标红，其余步骤低于基线 50% 标红；无基线或样本不足显示「样本少 / 无基线」而不是标红。
- **归因边界**：负责人按事件所属的 `campaign_links` / 订单归因过滤，**不按商品过滤**；个人账号（`MARKETING_VIEW_OWN`）看不到无法归属的自然流量。
- **失败分类**：`VALIDATION | STOCK | NETWORK | SERVER | UNKNOWN`，由 `ApiError.status/code` 决定；`INSUFFICIENT_STOCK`、`SKU_UNAVAILABLE`、`SKU_NOT_PRICED` 归 STOCK，≥500 归 SERVER，400/422 归 VALIDATION，`TypeError`/`AbortError`/`TimeoutError` 归 NETWORK。
- **一次点击一个 occurrence**：`attemptId` + `retry` 由点击时生成，ATTEMPT 与对应的 FAILED 共用；成功后 `clearSubmitAttempt()`；表单页与确认页共用 scope，策略路径（`/checkout/confirm` → `/checkout`）归一。
- **隐私**：诊断只进第一方事件表，只在管理员会话接口返回；默认打码（电话只留后四位，其余 `***`），点「显示完整信息」才展开；服务端日志只记错误名不记消息。

## 改动

后端：

- `backend/prisma/schema/analytics.prisma` 枚举 + 迁移 `20261106120000_add_checkout_submit_events`。
- `analytics-event.dto.ts`：接受两个新事件名；`analytics.service.ts` 将其交给专用诊断 schema，诊断 metadata 上限为 16 KiB，其他事件沿用原有上限。
- `checkout-metadata.ts`（新）：zod 白名单，未知字段直接丢弃；客户字段长度上限；消息里出现的客户值、手机号、邮箱统一打码；超限返回 null。
- `analytics.service.ts`：仅 `CHECKOUT_SUBMIT_*` 走诊断校验；日志改为只输出错误名。
- `orders.service.ts` / `inventory.service.ts`：库存与不可售错误带稳定 `code`（`INSUFFICIENT_STOCK`、`SKU_UNAVAILABLE`、`SKU_NOT_PRICED`）。
- `marketing-funnel.{sql,service,metrics}.ts` + `admin/marketing-funnel.controller.ts`：`/api/v1/admin/marketing/funnel`、`/sessions`、`/:productId/detail`，`JwtAuthGuard + MarketingGuard`，`Cache-Control: private, no-store`。

前端：

- `src/lib/api.ts`：`ApiError` 带 `status` / `code`。
- `src/lib/checkout-events.ts`：重写为 occurrence 模型；客户字段白名单；错误消息最多 200 字符，失败快照超 4 KiB 时先压缩、再省略 `variantNames`，不裁掉 SKU 列表或完整幂等键。4 KiB 是客户端尽量达到的目标，不是失败快照的硬上限。
- 结账表单（`CheckoutForm.tsx`）、确认页（`CheckoutConfirmView.tsx`）、PDP 内联 COD（`PdpQuickCodOrder.tsx`）三处接入。
- `commerce-events.ts`：`BEGIN_CHECKOUT` 补 `metadata.skuIds`。
- `src/lib/funnel-api.ts`、`ProductFunnel.tsx`、`ProductFunnelDrawer.tsx`、`funnel-display.ts`、`MarketingWorkbench.tsx` 新增页签、`src/app/admin/(shell)/marketing/funnel/page.tsx`。
- 中英文案。

## 验收（本地隔离环境）

隔离库 `luwag_post_links_local_e2e_20261103`（127.0.0.1:5441），后端 4104，前端 dev `localhost:4023`。

| 检查 | 结果 |
| --- | --- |
| 后端 `pnpm build` | exit 0 |
| 后端 `pnpm test`（2026-11-07 最终轮） | 197 文件 / 2583 测试通过；26 文件 / 265 测试按既有条件跳过 |
| 前端 `pnpm test --maxWorkers=2`（2026-11-07 最终轮） | 330 文件 / 3651 测试全过，未排除任何测试 |
| 前端完整 `tsc --noEmit` | exit 0，无输出 |
| 后端 `prisma generate` | exit 0 |
| 迁移 | `prisma migrate deploy` 成功 |
| 集成测试 | `marketing-funnel.integration.spec.ts` 3/3 |
| 浏览器：表单校验失败 | 事件体 `CHECKOUT_SUBMIT_FAILED{step:form, reason:VALIDATION, field:phone, customer{…}, idempotencyKey:""}` 与 `CHECKOUT_SUBMIT_ATTEMPT` 同一 `attemptId`，接口 200 |
| 浏览器：确认页库存失败 | `CHECKOUT_SUBMIT_FAILED{step:confirm, reason:STOCK, httpStatus:400, message:"Insufficient stock for E2E-CS-RED-S: available 0, requested 1", customer{name,phone,…}, idempotencyKey:"fab25eb1-5060-46d8-bda8-fa5aac69cdc0"}` |
| 后台漏斗页 | 商品行出现，提交尝试 2 / 失败 2（100%）；失败原因分布 VALIDATION 2、STOCK 2，来源自然 2、设备电脑 2；会话时间线可展开、默认打码，点「显示完整信息」后显示客户快照与完整幂等键；失败原因筛选后会话列表收敛 |

### 测试失败历史（不省略）

- 2026-11-06 后端全量曾出现 `uploads.service.spec.ts` 大 mp4 转码 5 秒超时；2026-11-07 两轮后端全量均通过，未修改上传相关代码。
- 2026-11-07 前端首轮全量：`ProductOptionSelector.spec.tsx > scoped gallery integration > retries the same scope after failure without leaking console or hydration errors` 在 `toHaveBeenCalledTimes(1)` 收到 2 次请求而失败。该文件单跑 74/74 通过，随后完整前端测试 3650/3650 通过；未改该测试或图集代码，不把首次失败隐去。
- 补齐主表提示后的默认并发全量中，`SubscribeBand.spec.tsx > opens the shared success dialog after subscribing from the band` 曾找不到瞬时 `Copied` 按钮状态。测试在等待剪贴板 mock 被调用后立刻断言 UI，未等待对应异步状态完成；本次未修改订阅功能或该测试，单独复核 6/6 通过，随后以 `pnpm test --maxWorkers=2` 重跑全部前端测试 3651/3651 通过。
- 本次排序回归的 RED 阶段，两端测试均明确显示预期 `CONVERSION`、实际 `ORDER_COUNT`；修复后各 2/2 通过。

最终测试日志在本机私有目录 `/private/tmp/luwag-post-links-tools-20261103/`：`backend-suite-final-20261107.log`、`backend-build-final-20261107.log`、`frontend-suite-limited-20261107.log`、`frontend-tsc-final-20261107.log`、`funnel-integration-20261107.log`、`funnel-table-hints-green.log`、`newsletter-recheck-20261107.log`。改动合入服务器分支后的合并树全量复跑结果：后端 197 文件 / 2604 通过（265 跳过），前端 330 文件 / 3670 通过，前后端构建与 `tsc --noEmit` 均 exit 0。

## 生产发布（2026-11-07 已执行）

- 生产提交：`b2b1d7df`（`staging/luwag-shop-domain`，含服务器原有 `6a3f95a4`、`3179702d`）；先推送 `deploy/checkout-funnel-20261107`，服务器 `merge --ff-only` 快进。
- 迁移：`20261106120000_add_checkout_submit_events` 已应用（2026-11-07 06:10:27 UTC），`_prisma_migrations` 共 81 条；`CHECKOUT_SUBMIT_ATTEMPT`、`CHECKOUT_SUBMIT_FAILED` 枚举值已存在。
- 镜像：后端 `small-house-prod-backend:latest` = `0901ee1040c0`；前端 `small-house-prod-frontend:latest` = `1639ad3166c0`。
- 数据库备份：`/opt/backups/pre-checkout-funnel-20261107T060630Z/small_house.sql`（3.3 MB）。
- 回滚标签：`small-house-prod-backend:rollback-pre-checkout-funnel-20261107` = `2f23e4618f22`；`small-house-prod-frontend:rollback-pre-checkout-funnel-20261107` = `bfc70632040d`。

### 生产验收

| 检查 | 结果 |
| --- | --- |
| 容器 | backend / frontend / db healthy，caddy 正常 |
| 页面 | `/`、`/checkout`、`/admin/marketing/funnel`、`/api/v1/storefront/settings` 均 200 |
| 前端镜像内容 | SSR chunk 内含「商品漏斗」文案 |
| 漏斗接口（管理员令牌） | `GET /api/v1/admin/marketing/funnel` 200，11 个商品行 |
| 事件接收 | 临时 `CHECKOUT_SUBMIT_FAILED` POST → `202 {"accepted":1}` |
| 入库字段 | `reason=STOCK`、`httpStatus=400`、完整幂等键、客户姓名/电话均保留 |
| 报表联动 | 该商品行 failures=1、STOCK=1；sessions 返回该会话与 diagnostic |
| 清理 | 测试事件已按 session 前缀删除（remaining=0）；未创建真实订单 |
| 日志 | 后端仅既有 pg 弃用警告；前端无 error/warn |

### 发布过程事故（已处置）

`docker compose run --rm backend pnpm prisma migrate deploy` 会执行镜像 entrypoint（先跑 migrate 与权限 reconcile，再启动 Nest），而不是只跑迁移。三次尝试各启动了一个临时后端容器，均已 `docker stop` / `rm -f` 清理。核对 `meta_conversion_events`、`qianyi_sync_jobs` 在 06:05 UTC 后均为 0 条，无推送副作用；迁移已由 entrypoint 应用，随后用 `--entrypoint sh` 复核得「No pending migrations」。后续部署应改用 `--entrypoint sh` 形式，或依赖 entrypoint 自带的迁移步骤。

### 回滚

1. 先回退前端：`docker tag small-house-prod-frontend:rollback-pre-checkout-funnel-20261107 small-house-prod-frontend:latest`，再 `up -d frontend`。
2. 需要时再回退后端；枚举新增值保留，不执行反向删值。
3. 不要在新版前端在线时单独回退后端：旧版 DTO 不接受新事件名，新接口也不存在。

## 收口审查与实施裁定

- 独立整分支审查在产出结论前遇到 API 429 额度限制；按用户既定规则没有重启代理，由主会话检查数据归属、负责人隔离、去重、分页、失败分类、隐私边界与前端状态。这是**作者自审，不等同于独立审查通过**。
- 修正默认排序：已确认设计要求优先看低转化商品，前端初始筛选和后端省略 `sort` 时均改为 `CONVERSION`；两端回归测试均先看到 `ORDER_COUNT` 的失败结果，再修正为通过。
- 补齐主表诊断提示：失败列悬停展示五类原因各自的会话数与占比；步骤基数不足或没有基线时，主表单元格直接显示「样本少 / 无基线」，不要求先打开抽屉。回归测试先确认提示缺失，再修复为通过。

实施过程中采用的裁定（含代价）：

1. 最初拟让抽屉复用主表、不调用 `detail`，后来已撤销；最终调用 `detail` 保留每日明细、设备/来源拆分和错误消息 top3。代价：打开抽屉多一次请求，不保留无调用方接口。
2. 校验前也记录 ATTEMPT，真实点击与对应失败共享 occurrence；form/confirm 共用 scope，成功后清理。代价：提交尝试表示真实点击，不只表示校验通过。
3. 诊断 metadata 使用专用 16 KiB 上限，客户端尽量压至 4 KiB；完整 SKU 与幂等键优先于变体名称展示文本。客户信息仍仅允许出现在失败事件。代价：失败行较大，极端超限快照会被丢弃为 null，事件行本身仍可入库。
4. 负责人过滤落实到事件/订单所属的链接，而非「推广过这个商品即可看全部」。代价：个人账号看不到无法归属的自然流量。
5. 步骤率用相邻两步的会话交集，订单数独立于下单会话；失败率升高才判异常。代价：这是会话口径，不能直接与核算页的事件次数相等比较。

## 无关附带改动

- 未改 Header、Footer、站点 shell 的布局或样式；只在用户指定的投放工作台内新增页签。
- 修改 `ApiError` 与库存异常 code 是失败分类的必需依赖，保留原有错误消息。
- 实现期间未修改生产数据，未发送 Meta/CAPI 事件；生产变更只发生在下方「生产发布」段记录的发布窗口。

## 待后续处理的小项

- 主表排序控件沿用的可访问名称是「点击表头排序」，但实际操作是下拉框；步骤排序选项也尚未在标签中区分「率」和「次数」。不影响已实现的排序逻辑。

## 限制

- 提交失败只能从本次前端上线后开始累积；上线前的历史会话无法补出失败记录。
- 断网期间 `sendBeacon` 未送达的事件不会重试，真实失败可能漏记。
- 基线要求区间前 7 天有足够样本（≥20），新品和低流量商品会显示「样本少 / 无基线」而不是标红。
- 访问 / 浏览 / 加购 / 发起结账仍是既有埋点；老事件没有 `skuIds`，只能靠商品路径或截断的 `entity_id` 归属。
