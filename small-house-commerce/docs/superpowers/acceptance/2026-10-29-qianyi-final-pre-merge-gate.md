# 千易 ERP Final Pre-Merge Gate：未通过

日期：2026-10-29。面向千易联调、订单运营与发布负责人。

**最终建议：Not Ready；不合并、不 push、不创建 PR、不部署、不启用生产千易，不执行真实商品/订单/发货写接口。** 单元测试与构建通过，但扩展隔离端到端验收失败，唯一一次独立只读审查也判定不具备合并条件。不能用此前“实现完成”或提交标题中的 safe requeue 代替业务安全证据。

## 1. 现场 Git 与生产基线

| 项目 | 现场结果 |
|---|---|
| 工作树 | `/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/qianyi-erp-20261028` |
| 分支 | `feat/qianyi-erp-integration` |
| HEAD / 运行时代码候选 | `3264ae6fea3f67366bfc712180b55f4af205f125` |
| 本轮 gate 修改前提交 | `e4aa2364cd2b629e60bc65efb2d955a5d38fe71e` |
| 远端 main（通过代理 ls-remote 复核） | `b0cbb8194e6f9c470561cf95a88da187555319fe` |
| 生产 HEAD（只读 SSH 复核） | `36269e66fd2676e1dd43fad4569a48d012b7902f` |
| refs/prod-inspect | 与上述生产 HEAD 一致 |
| 祖先关系 | origin/main 与生产 HEAD 均为候选祖先 |
| 候选累计 Diff | 48 文件，+8059 / -6，包含历史设计/计划文档 |
| backend/uploads | 候选差异和本轮工作树均无修改；没有添加、删除或提交该目录 |

请求中提及的 `f8f073b` 不是本次运行时代码候选；不再依据旧 SHA 宣称状态。

复核开始时工作树干净。交付时 HEAD 未再改变：仅上线手册的修订及本报告、JSON 证据、两份 patch 尚未提交；没有暂存、创建新提交或改写提交历史。独立审查针对固定 HEAD 的运行时代码；之后的新增内容只有说明性文档/证据，没有业务代码修复。

## 2. 交付文件与完整 Diff

- [完整候选 Diff：生产基线 → 3264ae6f](2026-10-29-qianyi-candidate-3264ae6.patch)
  - SHA-256：`bf49b1a54200a7c049466bb946a079b513605c1303a7910f134ef15fa031cf40`
  - 327493 字节；含候选的全部 48 个文件，不是只看最后一个提交。
- [候选之后的上线手册修正](2026-10-29-qianyi-runbook-correction.patch)
  - SHA-256：`d0b65d04f45fc61556878424521f428d997a1789763a36f62e6d81363e510b83`
- [机器可读验收结果](2026-10-29-qianyi-final-gate-evidence.json)
- [修正后的上线手册](../runbooks/qianyi-erp-go-live.md)

两份 patch 分别表示已提交候选和未提交手册修正；本报告及 JSON 是新增证据文件，不自嵌入 patch，避免递归打包。2026-10-28 的验收文件保留为历史，不代表当前最终结论。

本轮代码提交为 `3264ae6fea3f67366bfc712180b55f4af205f125`，修改的 16 个文件如下（均以 small-house-commerce/ 为根）：

- [qianyi-admin.controller.ts](../../../backend/src/modules/qianyi/qianyi-admin.controller.ts)
- [qianyi-inbound.service.spec.ts](../../../backend/src/modules/qianyi/qianyi-inbound.service.spec.ts)
- [qianyi-inbound.service.ts](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts)
- [qianyi-sync.service.spec.ts](../../../backend/src/modules/qianyi/qianyi-sync.service.spec.ts)
- [qianyi-sync.service.ts](../../../backend/src/modules/qianyi/qianyi-sync.service.ts)
- [qianyi-webhook.controller.spec.ts](../../../backend/src/modules/qianyi/qianyi-webhook.controller.spec.ts)
- [qianyi-webhook.controller.ts](../../../backend/src/modules/qianyi/qianyi-webhook.controller.ts)
- [qianyi-webhook.multipart.spec.ts](../../../backend/src/modules/qianyi/qianyi-webhook.multipart.spec.ts)
- [qianyi-webhook.service.spec.ts](../../../backend/src/modules/qianyi/qianyi-webhook.service.spec.ts)
- [qianyi-webhook.service.ts](../../../backend/src/modules/qianyi/qianyi-webhook.service.ts)
- [qianyi-erp-go-live.md](../runbooks/qianyi-erp-go-live.md)
- [千易后台 page.spec.tsx](../../../frontend/src/app/admin/(shell)/settings/qianyi/page.spec.tsx)
- [千易后台 page.tsx](../../../frontend/src/app/admin/(shell)/settings/qianyi/page.tsx)
- [en.ts](../../../frontend/src/i18n/en.ts)
- [zh.ts](../../../frontend/src/i18n/zh.ts)
- [admin-api.ts](../../../frontend/src/lib/admin-api.ts)

## 3. 候选已有的局部修正与局限

- 修复 `QianyiInboundService` 被 type-only import 抹去 DI 元数据导致 Nest 无法启动的问题；候选已实际启动，构建与对应回归测试通过。
- 归档去重键改为有界哈希，避免原始字符串截尾丢失运单/时间等尾部信息；但指纹没有贯穿物流表，也没有完成并发处理所有权。
- 无效签名不再写归档，避免未认证请求直接膨胀归档表；但验签前资源消耗、总请求大小和真实签名验证仍未关闭。
- 出库 carrier 为空白时使用占位值，缺少 carrier 的 SHIPPING_INFO 保留既有值；但占位值覆盖真实值、先到回调和 TRACKING_PACKAGE 仍有缺陷。
- 缺映射的确认可保留整单 SKIPPED，后台新增重排入口并提示缺少的 SKU；**恢复入口的幂等、状态限制及审计未达到要求，不得称为安全重排已完成。**

这些局部修正的 78 项千易单测均通过；不据此宣称下节失败场景已经修复。

## 4. 测试、构建与迁移结果

本次重新捕获各子进程退出码，不使用 `grep/head/tail` 的成功来代替测试或构建成功。

| 验证 | 结果 |
|---|---|
| Prisma generate | exit 0，Prisma Client 7.10.0 |
| 千易定向测试 | 10 文件 / 78 项通过，exit 0 |
| 后端完整测试 | 168 文件通过、22 文件跳过；2354 项通过、246 项跳过；exit 0 |
| Nest build | exit 0 |
| 前端完整测试 | 300 文件 / 3347 项通过，exit 0 |
| 前端 TypeScript --noEmit | exit 0 |
| Next 生产构建 | exit 0 |
| git diff --check（相对生产基线，含手册修正） | exit 0 |
| 一次性 PostgreSQL 18 全链迁移 | 72 条迁移完成；deploy exit 0，第二次 deploy exit 0 |
| 扩展订单/物流端到端 | **exit 1，四项断言失败** |
| disabled 入站隔离探针 | **失败：仍发生业务写入** |

此前有一轮前端全量输出为 1 failed / 3346 passed，但旧管道丢弃了失败名称和原因。本次保留完整日志的重跑为 3347 passed；不能据此把之前失败无证据归为 flaky，也不把旧的 TSC_OK 输出视为有效退出码证据。

### 4.1 一次性数据库与本地假千易

仅使用新建的 PostgreSQL 18 容器和 `127.0.0.1:55443`，假 ERP 绑定 `127.0.0.1:55444`。所有账号、客户、SKU、凭据都是隔离测试值；无真实千易写请求，未使用生产数据库。后端 API 为本地 3311，前端开发服务为 localhost:3394。

通过路径：

1. 顾客创建 3 件商品的 COD 订单，管理员登录并明确 CONFIRM。
2. worker 对假千易只发出 1 次 CREATE，任务达到 SENT。
3. 第一包实际出 1 件，库存 20→19。
4. 已处理完的同一回调再并发发送 5 次：仍 1 个包裹，库存仍 19。
5. 第二、第三包各出 1 件，最终 3 个包裹、库存 17。
6. 顾客 lookup 可访问，COD 未变 PAID。

**上述“已处理后的重复”不是首到并发或失败恢复并发的证明。**

失败路径：

| 场景 | 应有结果 | 实际结果 |
|---|---|---|
| 同运单、同状态、同时间、不同 city | 2 条物流事件 | 只有 1 条 |
| 已存 J&T Express 后到达较旧 SHIPDOC | 保留 J&T Express | 被改为 SHIPDOC |
| TRACKING_PACKAGE 仅有 onlineOrderId | 新增 1 条物流事件 | 新增 0 条，回调仍被 ACK |
| DELIVERED 到达已存在包裹 | Shipment.status=SIGNED | 仍为 SHIPPING，仅补 signedAt 等字段 |

另以相同隔离库重新启动 `QIANYI_ENABLED=false` 的后端，提交带有效测试签名的 SHIPPING_INFO：HTTP 200 `{ok:true}`，归档 processedAt 被填写，包裹承运商实际改变，证明开关不是入站业务写入闸。

这些新增端到端断言提供了真实 RED 证据；本轮没有继续改业务代码把它们变成 GREEN，因此**不能交付“RED→GREEN 全部完成”的结论**。

### 4.2 浏览器验收

使用专用隔离浏览器上下文、开发服务器及隔离后端，不使用生产账号：

- 导航可打开千易页；未启用状态显示正确。
- 缺重量/尺寸时，行勾选框和建档按钮禁用。
- 资料齐全行默认不勾选；选择 1 行时建档计数和按钮启用状态正确；没有点击实际建档提交。
- 预置 SKIPPED 且缺映射时点击重排，明确显示 `仍缺映射：GATE-SKU-1`，任务保持 SKIPPED。
- 未观察到页面 console error/warn。

本轮创建的本地前后端服务、假 ERP、数据库和浏览器标签均已停止/清理；未停止用户其他服务。

## 5. 独立审查及尚未解决的风险

仅一个独立只读审查者，审查完整生产基线到 HEAD 差异、聚焦千易运行时与订单/库存接缝，没有实现代理群、没有重复审查循环。审查使用代码与替身依赖的内存交错复现；不是 PostgreSQL 并发验收。主会话随后核对了相关事务、库存扣减和取消代码；下列 PostgreSQL 端到端失败也有独立于审查者的实测证据。

### Critical

**C1：并发派发缺乏所有权及订单级串行化，可能重复出库与扣减。**

[Webhook :122–145](../../../backend/src/modules/qianyi/qianyi-webhook.service.ts#L122-L145) 把 processedAt=null 的归档视为可再次派发；P2002 只覆盖同时插入，未覆盖“已插入未完成”和失败恢复。两个 [出库事务 :79–97](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L79-L97) 可同时读到无包裹，再各自创建和扣减。共享 [consumeForOrder :219–278](../../../backend/src/modules/inventory/inventory.service.ts#L219-L278) 先读预留再更新，没有为此路径提供订单行锁。审查的内存交错实际产生两次扣减；生产数据库首到/失败并发仍需定向复现与修复，不能用已完成回调的重复测试替代。

### Important

| ID | 已确认问题 / 具体触发 | 最小安全方向 |
|---|---|---|
| I1 | [worker :124–146](../../../backend/src/modules/qianyi/qianyi-sync.service.ts#L124-L146) 在远端成功而本地 markSent 前崩溃时，attempts 可能仍为 0，重启直接再次 CREATE；无跨实例领取，查询为空后也继续创建 | 持久化发送边界并排他领取；不明结果只读核验/人工对账，不能自动再次创建 |
| I2 | [cancel :941–948](../../../backend/src/modules/orders/orders.service.ts#L941-L948) 只给 SENT 排 CLOSE，PENDING 不撤销，worker 不复核取消状态；在途取消也无完整补偿 | 取消与发送按同一订单串行协调，区分未发、在途不明、已发 |
| I3 | [retry :281–295](../../../backend/src/modules/qianyi/qianyi-sync.service.ts#L281-L295) 可接受 SKIPPED/SENT/PENDING；SKIPPED 缓存 payload 只有店铺/单号，能绕过全明细校验；没有操作者备注。[重排 :251–269](../../../backend/src/modules/qianyi/qianyi-sync.service.ts#L251-L269) 状态与备注不原子，后续成功清 lastError | 统一受限恢复入口、订单状态/全映射校验、原子状态迁移与审计；保留原始原因 |
| I4 | [物流身份 :377–384](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L377-L384) 又缩为 status:shippingTime，丢地点和 eventTime；实时不读 onlineOrderId；[签收 :387–390](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L387-L390) 不推进包裹/订单生命周期 | 完整稳定身份贯穿归档与物流；保留发生时间/地点，识别真实字段，复用正确签收流程 |
| I5 | [SHIPPING_INFO :325–358](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L325-L358) 及 TRACKING_PACKAGE 固定取 shipments[0]，不同运单可串写；[回放 :277–305](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L277-L305) 先截全站 20/50 条再筛本单 | 用订单+包裹/运单定位，先筛关联再分页回放；验证乱序不丢、状态不倒退 |
| I6 | 真实承运商可被 SHIPPING_INFO 的 SHIPDOC 覆盖；先到真实 carrier 没有回捞；TRACKING_PACKAGE carrier 不更新 | 两类回调统一“真实信息优先、占位不覆盖”规则，并恢复先到信息 |
| I7 | [ingest :87–101 / :158–159](../../../backend/src/modules/qianyi/qianyi-webhook.service.ts#L87-L101) 不检查 enabled；关闭开关仍接受入站写入，已在隔离库实测 | 在业务派发前明确禁用行为；停用必须同时覆盖入站、worker 和管理写入口 |
| I8 | [出库 requirements :129–152](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L129-L152) 用虚拟 Bundle SKU 扣减，而原订单预留组件 SKU | 复用冻结 Bundle 快照组件展开；若一期不支持，应在推单前显式阻止 |
| I9 | [仓库 :256–263](../../../backend/src/modules/qianyi/qianyi-inbound.service.ts#L256-L263) pin 缺失回退默认仓；包裹仓与实际预留扣仓未绑定，物理仓对应也未确认 | 确认本地仓绑定并失败关闭；验收 reservation、Shipment、Movement 的仓库一致性 |
| I10 | [Compose :32–62](../../../docker-compose.prod.yml#L32-L62) 未转发 QIANYI 变量；路由限流在 Multer 后，总文件/parts/bytes 限额不足；验签前仍解析 JSON、未校验配置 appId | 后续授权前补容器环境转发；入口前置预算/体积限制、禁止文件、验签后解析；补测试，不直接加依赖/改库 |

归档 90 天清理依赖启用中的每日对账，且会删除未完成记录；延迟超过 24 小时的回调当前 200 拒绝；这些不能被描述为完整恢复保护。真实 vendor event ID 如存在应优先使用；当前未接入。没有稳定 ID 且时间/地点缺失时，必须明确指纹无法区分真实重复扫描的边界。

## 6. 为什么本轮停止自动恢复实现

未证明千易创建单的原子幂等或唯一约束。**按照本轮“不能证明幂等则先报告”的要求，不继续扩展无条件重推，也不把目前按钮用于真实订单。** 查询后创建不是充分方案。

建议的后续最小方案尚未实施：

1. 远端超时、崩溃、已尝试但结果不明：只读查询与人工对账，查询空不自动 CREATE。
2. 确实从未发出的 SKIPPED：事务内验证全部映射、订单可履约、原任务状态；原子保存操作人/原因并排他领取。
3. 将发送前的持久化边界与取消补偿补齐，再验证服务重启和多 worker。
4. 入站按订单锁住读改写，与人工发货共享串行化边界；同一完整事件身份用于所有去重层。

当前分支保留用于这些后续修复，不申请立即合并或启用。

## 7. 千易侧与运营仍需人工提供/确认

- 轮换凭据、确认旧凭据失效；当前 Diff 未包含原 accessId/secretKey。精确扫描发现早期分支历史含旧 accessId，但未发现旧 secretKey；未擅自改写历史，正式分享/合并前需确认凭据轮换与历史处理策略。
- 提供真实回调原始请求体、五个签名字段与接收时间，通过受限渠道验证，不将 secret 或客户 PII 放入 Git/报告。
- 店铺内 onlineOrderNumber 唯一性、CREATE 超时后的幂等/查询一致性、响应包装格式，以及回调重试/确认语义。
- SHIPDOC-STD 的实际承运商、J&T、COD 代收及 payTime 约定。
- PH-DAVAO-01 与本站 Manila Central 的真实物理关系和库存预留策略。
- 稳定事件 ID、订单/出库/包裹关联字段、真实时间/地点、乱序和签收状态语义。
- 家具 shelfLife 的正确填法；确认净重/毛重矛盾行，不将“字段齐全”自动视为可建档批准。

[首批 SKU 快照](../runbooks/qianyi-sku-first-batch.md) 仅作为待人工核对的候选资料，未获本轮建档授权，也没有执行创建。

## 8. 部署与回滚建议

当前候选未部署，**无需生产回滚**；生产保持原基线。没有创建生产测试订单，没有修改生产订单/库存/商品/客户/Meta 数据，只读取 Git 和容器镜像元数据。

不能按“QIANYI_ENABLED=false 即安全”批准当前候选暗部署，因为入站闸实测失败。应先关闭上述缺陷，完成真实签名、物理仓与业务条件确认，再逐阶段申请暗部署、人工 SKU 建档、单单订单与真实发货签收授权。

只读取得的现生产镜像：

```text
backend  sha256:990819255fd9d063dddfdd4962743297972ef6b4887a524c575172fd66962074
frontend sha256:f31e2e4f0a92e796a42b38edd4ff7824bc48826914e9d504887083ac6353f713
```

如未来另获部署授权，必须在部署前重新固定并保存镜像/Compose/受限环境备份。精确回滚对象是该次保存的镜像，不是运行时可能已改变的 tag；先阻断入站和 worker，再恢复旧后端、前端及原配置，以 `--env-file .env.deploy`、禁止 build/pull 的方式重建并验证。现在没有执行任何回滚命令，也没有保证上述本地镜像 ID 永久保留。

加性数据库结构保留，不删除表/列，不回滚生产业务数据。外部已建单或已出库无法通过代码回滚撤销，须单独对账，禁止盲目再次推单。

## 9. 结束状态

运行时代码停在 `3264ae6f`；文档明确标记未通过，测试证据和 Diff 已提供。本轮没有 merge、push、PR、deploy、启用生产开关、真实千易写调用，也没有触碰 backend/uploads；无新增依赖或额外数据库结构变更。

**无关附带改动：无。完成报告后停止，等待明确授权。**
