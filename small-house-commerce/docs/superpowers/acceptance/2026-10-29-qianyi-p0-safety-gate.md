# 千易 ERP P0 安全修复与端到端验收

日期：2026-10-29。面向千易联调、订单运营与发布负责人。

**结论：本轮列出的 P0/P1 缺陷已在一次性 PostgreSQL 18 上修复并复验；真实千易签名、仓配与 COD 业务条件仍未确认，候选仍不得合并、部署或启用。** 本次未启动第二个独立审查代理，只做本地只读自审。

## 1. 起始现场与保留物

| 项目 | 现场结果 |
|---|---|
| 分支 | `feat/qianyi-erp-integration` |
| 起始 HEAD | `3264ae6fea3f67366bfc712180b55f4af205f125` |
| 生产基线 | `36269e66fd2676e1dd43fad4569a48d012b7902f`（SSH 只读复核） |
| 远端 main | `b0cbb8194e6f9c470561cf95a88da187555319fe`（代理 ls-remote） |
| 暂存区 | 空 |
| 未提交资料 | 上一轮报告、JSON 证据、完整 Diff、手册修正 patch、手册修改 |

五份未提交资料均先核对哈希并复制到 `/tmp/qianyi-p0-preserve-20261029-3264ae6/`，未覆盖、未删除。上一轮 Diff patch 仍指 `3264ae6f`，不是本轮最终候选。

**最终候选提交：`af14094db09d05169a82cf929b83ade7374ea814`。** 完整差异：[候选 af14094d](2026-10-29-qianyi-candidate-af14094d.patch)（373739 字节，SHA-256 `d0ca07100ba1d35366a9717c8c857f8e20c11f74cc66fd9c04628d579bcdefd5`）。本轮提交为 `af14094d`；其后的报告更新与 Diff 文件为文档提交。

## 2. 修复内容

| 缺陷 | 修复 | 主要文件 |
|---|---|---|
| 并发重复出库/扣库存 | 归档派发事务内先锁订单，状态与日志同一事务；`shipments.qianyi_outbound_number` 唯一索引 + 并发插入回落；不同事件身份指向同一出库单只成一次 | `qianyi-webhook.service.ts`、`qianyi-inbound.service.ts`、`order.prisma`、`20261029090100_qianyi_outbound_unique` |
| 关闭开关仍写业务 | 有效签名只归档并标记 `INTEGRATION_DISABLED`，返回 `{ok:true,deferred:true}`；启用后回放；入站先校验 appId/格式/常量时间签名 | `qianyi-webhook.service.ts`、`.controller.ts` |
| 推单结果不明重复创建 | DB `SKIP LOCKED` 领取；`auto_create_attempts` 保证 CREATE 最多自动一次；超时/断开/进程退出转 `FAILED` + 待核对；只有操作人确认千易无单后才授权再一次 | `qianyi-sync.service.ts`、`qianyi.prisma`、`20261029090000_qianyi_job_review` |
| 取消与待发送竞争 | PENDING/SKIPPED/FAILED → CANCELLED；SENDING → 待核对；SENT → CLOSE；合并掉的订单同样取消推送 | `qianyi-sync.service.ts`、`orders.service.ts` |
| 恢复绕过校验/无审计 | 重推限“从未 CREATE”的 FAILED；重排限 SKIPPED 且全映射/订单可推；状态与 SYSTEM 备注同事务，记录操作人与 `lastAction` | `qianyi-sync.service.ts`、`qianyi-admin.controller.ts` |
| 物流节点合并 | 归档与物流共用指纹：稳定 vendor event ID 优先，否则 `serviceType+单号+运单+出库号+状态+发生时间+地点` 哈希；保留时间与地点 | `qianyi-event.ts`、`inbound`、`logistics-event.service.ts` |
| 承运商被 SHIPDOC 覆盖 | 真实值优先、占位值不覆盖、空值保留；SHIPPING_INFO 与 TRACKING 共用规则；先到承运商回捞到出库包裹 | `qianyi-event.ts`、`qianyi-inbound.service.ts` |
| 多包裹串写 | 按运单/出库号定位；无运单的多包裹回调显式拒绝而非写错包裹 | `qianyi-inbound.service.ts` |
| 签收状态机不一致 | 抽出 `signShipmentWithin`，人工与回调共用；全单完成才 SIGNED，不改 COD 支付状态 | `orders/sign-shipment.ts`、`orders.service.ts`、`inbound` |
| Bundle 扣虚拟 SKU | 出库按推单时冻结映射 + Bundle 快照展开到组件 SKU，校验组件总量 | `qianyi-inbound.service.ts` |
| 仓库回退默认仓 | 必须配置 ACTIVE/PH 本地仓；预留仓与包裹记账仓不一致整笔拒绝；不再回退 | `qianyi-inbound.service.ts` |
| 入口限流/体积 | 路由中间件在 multipart 解析前按 IP 限流（429）并拒绝 >200KB（413）；multipart 5 字段；验签后才解析 JSON | `qianyi-webhook.middleware.ts`、`qianyi.module.ts` |
| 部署变量不转发 | Compose 显式转发全部 `QIANYI_*` | `docker-compose.prod.yml` |

后台新增“待核对”计数与“核对后授权重推”按钮；普通“重推”只在从未 CREATE 时出现。手册已改为与状态机一致。

## 3. RED 证据

一次性数据库：`luwag-qianyi-p0-safety-20261029`（PostgreSQL 18，仅 `127.0.0.1:55443`，库名 `qianyi_safety_20261029`；测试文件拒绝任何其他地址）。真实并发通过两个 Prisma 事务 + 触发器闸门 + `pg_stat_activity` 等待检测来制造交错，不是 mock。

首次运行：18 项中 3 通过、15 失败（日志 `/tmp/qianyi-p0-red.log`）。

关键失败与当时实际结果：

- 同一首到回调并发：2 个 Shipment、2 次扣减。
- 不同身份指向同一出库单并发：2 个 Shipment。
- 失败归档并发重试：2 个 Shipment。
- 数据库无唯一约束：重复出库号插入成功。
- `QIANYI_ENABLED=false`：回调写入归档并修改包裹（业务库与前后快照不相等）。
- 不同 appId 的签名回调被接受。
- 已启用的缺配置仍处理回调并允许客户端启动。
- 异地同状态/同时间节点只剩 1 条；不同时间节点合并；vendor event ID 被忽略。
- 旧 SHIPDOC 覆盖真实 J&T；先到承运商未回捞。
- `onlineOrderId` 回调 0 条物流；第二包裹运单无法定位。
- DELIVERED 后包裹仍 `SHIPPING`。

额外三项在修复前单独 RED：无本地仓返回成功；改码后出库不扣减；Bundle 出库失败。

事务回滚两项（库存更新失败、movement 插入失败）在旧代码就已通过，**不计入本轮 RED→GREEN**。

## 4. GREEN 证据

| 验证 | 结果 |
|---|---|
| 一次性库迁移 `prisma migrate deploy` | exit 0；重复执行 exit 0 |
| 新增千易安全 E2E | **28/28 通过，exit 0** |
| 千易定向单测 | 66 通过，exit 0（重写为新契约） |
| 后端全量 | 2345 通过、246 跳过，exit 0（跳过的 246 不计为通过） |
| Nest build / Prisma generate | exit 0 |
| 前端全量（单独运行） | 3350 通过、0 失败，exit 0 |
| 前端 `tsc --noEmit` | exit 0 |
| Next 生产构建 | exit 0 |

说明：前端曾与后端全量并发运行，3 个无关商品/首页测试因 5 秒超时失败；单独重跑 3350/3350 通过。该超时与千易改动无调用关系，但不掩盖首次失败记录。

在最终候选 `af14094d` 上再次复跑：Nest build exit 0、后端 2345/2345、安全 E2E 28/28、前端 tsc exit 0；前端全量与 Next 构建在提交前同一内容上 exit 0。

E2E 覆盖：

1. 并发首到、重复回调、不同身份同一出库单、失败后并发重试 → 都只 1 个包裹、1 次扣减。
2. 数据库唯一约束在绕过服务预检时仍拒绝重复。
3. 停用态 6 种回调场景（含无效签名、异 appId、缺配置）→ 业务快照不变；启用后回放一次。
4. 推单链：enqueue → 冻结映射 → 查询 → 单次 CREATE → SENT → 出库 → 库存扣减。
5. CREATE 结果不明 → 自动重发被阻断；重推被拒；授权后只再发一次；进程中断 SENDING → 待核对。
6. 取消 PENDING → 不再发送；旧确认不能复活已取消任务。
7. 同状态不同地点/时间、稳定 event ID、承运商优先级、先到承运商、第二包裹定位、全单签收与 COD 未付款。
8. 多包裹无运单回调被拒绝，不写错包裹。
9. 无本地仓拒绝、冻结映射不受改码影响、Bundle 按组件扣减。

日志：`/tmp/qianyi-p0-red.log`、`/tmp/qianyi-p0-green8.json`、`/tmp/qianyi-be-all3.json`、`/tmp/qianyi-fe-alone.json`。

## 5. 未解决风险（按严重度）

### Critical / 合并阻断

无已知 Critical。

### Important

1. **真实千易签名未验证**：全部签名都是本站自签。回调字段、时间窗、`onlineOrderId` 语义、重试策略仍需真实样本。
2. **远端 CREATE 幂等未证明**：代码只保证“本站最多自动发一次 CREATE”；千易是否允许同 `onlineOrderNumber` 多单、超时后是否已建单，本轮仍无证据。生产恢复必须走“核对后授权”。
3. **物理仓未确认**：`PH-DAVAO-01/71537` 与本站 `Manila Central` 是否同仓仍未确认；现在代码宁可拒绝也不再猜。
4. **COD/SHIPDOC/J&T/payTime/shelfLife 未确认**：COD `payTime=下单时间` 是否被接受、SHIPDOC-STD 实际承运商与 COD 代收、家具 `shelfLife=36500` 都需要千易书面确认。
5. **SKU 建档远端无幂等**：`INSERT_SKU_INFO` 超时后本地未写映射，再次勾选可能重复建档。本轮未改，需真实联调或改为远端先行查询确认。
6. **永久业务冲突会持续 500**：如出库对应已取消订单、无运单的多包裹回调，千易会重试；需要运营按归档错误人工处理，尚无“永久失败”终结状态。
7. **超过 24 小时的真实回调**当前被 200 拒绝且不归档；协议若有更晚重试需放宽或单独补偿。
8. **合并保留订单未重新定价/重推**：合并后保留单的金额和明细变化不会同步到已 SENT 的千易订单；本轮只取消被合并单的推送。
9. **限流仍是单进程内存**；JSON/urlencoded 的全局 parser 在任何中间件之前执行（100KB 默认），超限解析成本无法在本路由单独消除。
10. **每日对账仍只提示不修复**；归档清理只删已完成记录，失败记录不会自动消失。

## 6. 千易侧仍需人工提供

- 轮换并失效对话中出现过的旧凭据；真实回调样本（五个字段、原始 bizParam、接收时间）；店铺内单号唯一性与超时语义；响应包装格式。
- 仓库绑定、SHIPDOC-STD/J&T/COD 代收、家具 shelfLife。
- 稳定事件 ID 字段是否存在；多包裹回调是否总带运单号。

## 7. 合并与回滚

**建议：仍不合并、不部署。** P0/P1 代码门禁已通过，但业务事实未确认。先做 `false` 暗部署申请时，只能验证“无出站、无业务写入、只有 deferred 归档”。

生产基线仍是 `36269e66`。本轮未部署、未 push、未创建 PR、未启用生产开关、未调用真实千易写接口、未修改生产订单/库存/商品/客户/Meta 数据，未触碰 `backend/uploads/`。

若未来部署后回滚：恢复部署前保存的后端/前端镜像与配置，`--env-file .env.deploy` 重建；`QIANYI_ENABLED=false` 可阻止新业务写入，但会把签名回调归档为 deferred，回滚到不认识 deferred 的旧镜像前应先停掉千易回调。加性迁移保留，不回滚表结构；千易侧已建单/已出库只能对账处理。

## 8. 本轮改动文件

新增：`backend/test/qianyi-safety.e2e-spec.ts`、`backend/src/modules/orders/sign-shipment.ts`、`backend/src/modules/qianyi/qianyi-event.ts`（+spec）、`qianyi-webhook.middleware.ts`（+spec）、两个迁移目录。

修改：`qianyi-{webhook,sync,inbound,admin}.ts` 及测试、`qianyi.module.ts`、`orders.service.ts`、`order.prisma`、`qianyi.prisma`、`docker-compose.prod.yml`、后台页面/类型/i18n、上线手册。

**无关附带改动：无。**
