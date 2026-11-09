# 订单工作台增强：实施与验收记录

更新：2026-11-09。面向后续维护与发布人员。

**状态：已部署生产（2026-11-09）。发布分支 `release/orders-workbench-20261109` 提交 `3255c951` 已推送到 GitHub；生产分支 `staging/luwag-shop-domain` 由 `4bf25f8b` 快进到该提交，生产数据库迁移已执行并完成只读验收。**

开发基线 `60178e5b`；发布时线上 HEAD 已是 `4bf25f8b`（含此前 AID 归因与草稿客服跟进），本轮是在该线上版本上整合增量后重新验证、构建与发布。生产只执行 additive 迁移与时间字段回填，没有创建或修改任何真实订单。

## 已确认范围与结果

| 需求 | 实现 |
| --- | --- |
| 电话模糊查询 | 后台订单通用搜索与电话筛选兼容 `09`、`+63`、`63`、无前导零、数字片段及常用分隔符；专用电话筛选输入完整有效号码时仍精确匹配规范化 Customer，保留客户历史入口语义。 |
| 草稿订单时间与来源 | 列表显示 `draftStartedAt ?? createdAt`、等待时长按同一时间计算，标记「草稿订单转订单」；等待/最新排序在数据库分页之前使用对应有效时间，并用 ID 稳定排序。抽屉、详情及历史流程显示草稿发起与正式转单两个时间。 |
| 人工转单直接确认 | 草稿详情提供实时风险提示，可更正收货信息/日期/备注；有确认权限才能转换。风险单须明确勾选已联系或审核。按当前售价、促销及库存重新验证，直接创建 `CONFIRMED`，不再要求第二次确认。 |
| 列拖动排序 | 在「列显示」中用手柄拖动，也支持键盘；隐藏列保留位置，本地刷新/保存视图保留顺序，兼容旧偏好；恢复默认同时重置显示、宽度与顺序。冻结列遵守实际列顺序，避免遮挡。 |
| 当前页批量操作 | 当前页勾选/全选，确认、指派客服、取消、普通状态修改、打印打包单。翻页、换筛选、刷新清空选择；写操作二次确认，按权限展示与校验，逐单返回成功/失败或跳过，结果在刷新后仍可见。 |

### 电话规范化的影响

- `0917…` 和 `+63917…` 是同一菲律宾号码的本地/国际表示，保留 E.164 Customer identity 有利于去重、客户历史及风险判断；本轮不改存储规则。
- 下单地址快照保留提交的电话；千易订单 mapper 读取收货地址电话，而不是以 Customer 格式替换它。本轮不改 mapper。
- 模糊能力仅用于受权限保护的后台订单筛选，没有放宽前台查单的精确身份校验。
- 没有做真实拨号、短信或承运商联调，不能由号码规范化推断这些链路已验收。

## 转换、幂等与权限边界

人工转换的库存预留、创建已确认订单、关联草稿、风险记录/人工决定、状态历史及千易 outbox 写入属于**同一个数据库事务**。事务失败不得留下半张订单或占用库存。

- Shopper 与 operator 转换使用同一 token hash advisory lock；已存在草稿同时加行锁，转换前重读状态、有效期及 revision。
- 锁查询使用 `$executeRaw` 忽略 PostgreSQL `void` 返回值，避免 adapter-pg 解码失败。
- 相同幂等键与相同指纹的 shopper 并发重试，锁后重读并返回胜出订单；不同键、不同内容和人工竞争者不重放、不再创建第二张。
- 普通 shopper 转单仍保持原未确认路径；人工转单不发送 shopper Meta Purchase。
- 批量确认在逐单事务内锁 Customer、重算当前历史风险，排除当前订单本身；当前为 RPT/RECHECK 或有未解决订单风险标记时跳过，不改写入单时的分类快照。
- 批量接口 1–100 个不重复 UUID，逐单复用既有状态机/事务。`assign` 要求 ORDER_ASSIGN，`cancel` 要求 ORDER_CANCEL，`confirm/status` 要求 ORDER_CONFIRM，DENIED 额外要求 ORDER_CANCEL；入口还要求 ORDER_VIEW_ALL。
- 批量普通状态仅允许 PENDING、QUESTION、ABNORMAL、DENIED、AFTER_SALES，不能借此直接改为 CONFIRMED、SHIPPING 或 SIGNED。
- 打印复用已有内部打包单，一单一页、HTML 转义；不是承运商运单或 J&T 面单，也不产生运单购买请求。

## 数据库变更（2026-11-09 生产已执行）

迁移：`backend/prisma/migrations/20261106120000_add_order_draft_started_at/migration.sql`。

1. `orders.draft_started_at`：nullable，记录草稿发起时间，草稿清理后仍保留来源。对仍有 CONVERTED 草稿关联的旧订单，用 `LEAST(draft.created_at, order.created_at)` 回填。
2. `orders.workbench_started_at`：non-null，工作台分页排序的物化有效时间。旧订单按 `COALESCE(draft_started_at, created_at)` 回填；新普通订单与 `created_at` 同取数据库 `CURRENT_TIMESTAMP`，新草稿转换由 checkout 显式写入草稿时间。
3. 复合索引 `(workbench_started_at, id)`，支持普通单/草稿单混排及稳定分页。

真实 `created_at` 不修改；日期筛选、财务、收入和漏斗继续按正式创建时间。核对有效排序时间不一致可用：

```sql
SELECT count(*)
FROM orders
WHERE workbench_started_at IS DISTINCT FROM COALESCE(draft_started_at, created_at);
```

生产执行结果（2026-11-09 03:48:30 UTC）：后端容器入口 `prisma migrate deploy` 应用 `20261106120000_add_order_draft_started_at` 成功；两列与复合索引均存在；17 张历史订单全部回填，`workbench_started_at IS DISTINCT FROM COALESCE(draft_started_at, created_at)` 计数 **0**；17 张 CONVERTED 草稿对应订单的 `draft_started_at` 一并回填。执行前后 `orders` 均为 17 行、`checkout_drafts` 均为 37 行。

生产数据量规模下本次迁移耗时未单独计时（入口日志未记录步进耗时）；后续更大数据量发布仍应按实际行数预留维护窗口。

## 独立审查与一次修复轮

一名 fresh-context reviewer 只读审查相对基线的未提交改动及新增文件，未修改工作树。确认 1 项 Critical、3 项 Important；下列全部修复，主会话逐项观察 RED→GREEN，之后完整回归。未重复派发审查。

| 发现 | 修复与证据 |
| --- | --- |
| C1：advisory SELECT 的 `void` 结果让 `$queryRaw` 在 adapter-pg 报 UnsupportedNativeDataType | 使用实际 adapter、只替换 PG 网络结果的回归测试先失败，改 `$executeRaw` 后通过；随后真实 PostgreSQL shopper/operator 转换均通过。 |
| I1：两个 shopper 同键请求在锁前均查不到订单，后手误报草稿已转换 | 已转换分支在锁内重新检查幂等键/指纹；同键并发双方拿到同一订单，不同键/不同内容只允许一个胜出。 |
| I2：批量确认只检查历史分类快照 | 在确认事务内检查 live history，排除自身并保留原快照；真实分类服务单测验证 RPT/RECHECK 跳过，实库验证同一批第一张确认后第二张被跳过且无第二个 ERP job。 |
| I3：显示草稿时间但仍按正式创建时间排序 | 新增有效排序时间/索引，数据库先排序再分页；实库验证普通/草稿混排、等待/最新方向及跨页结果，日期筛选仍使用正式创建时间。 |

### 延后的小项

- Final: minor (deferred): M1 风险卡暂显示通用风险提示、分类原因及关联订单链接，不在卡内逐项展开命中的 `riskFlags[].flagType/reason` 或单独标注 24h 同商品匹配。风险预览、必需复核勾选和服务端重检已生效；这是提示明细的后续增强，不是风险门禁缺失。

## 验证证据

### 完整测试与构建（在合并线上 `4bf25f8b` 后的发布树上重跑）

| 命令/项目 | 结果 |
| --- | --- |
| Backend `pnpm build`（Docker 内 `prisma generate` + `nest build`） | exit 0。 |
| Backend `pnpm test --maxWorkers=2`，启用专属 workbench 测试库 | **201 files / 2668 tests passed；26 files / 265 tests skipped**。跳过的是未配置其各自数据库/环境的其他集成测试，未计入通过。 |
| Backend `pnpm lint` | exit 0；原有 warnings 未顺带清理。 |
| Backend 广义 `tsc --noEmit`（包括旧测试） | 不是本轮门禁；此前基线存在既有测试类型错误（113 项），本轮新增/修改功能文件无类型错误，未声称整个后端 tsc 通过。 |
| Frontend `pnpm test --maxWorkers=2` | **338 files / 3762 tests passed**。 |
| Frontend `tsc --noEmit` | exit 0。 |
| Frontend `pnpm build` | exit 0，Next 16.3.4。 |
| Frontend `pnpm lint` | exit 1，5 errors / 19 warnings。5 个错误全部是生产基线已有的 `react-hooks/set-state-in-effect` 模式（drafts 详情页、ChangePasswordDialog、PostLinkResultDialog、ResetPasswordDialog、TeamMemberDialog）；本轮新增组件无新增 lint 错误。 |
| 离线 Prisma schema diff | 相对基线仅新增两个字段及一个复合索引，与本轮迁移 DDL 一致；显式数据回填另由实库测试验证。 |
| `git diff --check` | exit 0；最终打包单/列偏好定向测试 2 files / 9 tests passed。 |
| 发布树浏览器 fixture 复验 | 真实 Next 构建产物 + fixture API：拖动/键盘排序、刷新保留、当前页全选/翻页清空、批量逐单结果、两份打包单、风险勾选门禁、转换后 CONFIRMED、两个流程时间、390px 手机无横向溢出；`pageerrors=0`。 |

完整本地输出在 `/tmp/orders-workbench-{backend,frontend}-{suite,build,lint}-verified.log`、`/tmp/orders-workbench-tsc.log`，不是长期生产备份。

### 真实 PostgreSQL 验证

Docker daemon 不可用后，在 `/tmp/order-workbench-pg.aBZ6Xr` 下载独立 PostgreSQL 18.4 二进制包，无 repo 依赖或 lockfile 变更。服务只监听 `127.0.0.1:55438`，不连接生产，不执行生产 seed，不触碰用户 3000/3001。

专用库 `small_house_order_workbench_20261109`、专用用户 `workbench_test`。测试入口 `ORDER_WORKBENCH_TEST_DATABASE_URL` 有本地 hostname、专属库名前缀及用户检查；清理仅用于该可丢弃测试库。没有启动应用 worker，千易仅验证真实 outbox 行，不投递到外部。

`orders.service.workbench.integration.spec.ts` **10/10 通过**，也包含在上面的完整后端结果内：

- 人工转换：CONFIRMED、两种时间、库存预留、审计和真实 PENDING ERP outbox，删除草稿后来源时间仍在。
- 双 shopper 同键并发：双方成功且同一订单，只预留一次库存。
- 不同键、同键不同内容、双 operator、shopper/operator 竞争：各只有一单胜出。
- 真实 enqueue 已插入 outbox 后注入异常：订单、Customer、审计、outbox、库存及草稿关联全部回滚；之后允许重试。
- 批量 live-risk 重检，以及数据库分页混排/时间排序。
- 用临时表执行完整新增迁移 SQL，验证历史回填、OPEN 草稿不回填来源及真实创建时间未改。

全量迁移在空测试库成功应用。整库 `migrate diff` 另显示三项基线 schema 漂移（两个旧索引不在 Prisma schema、一项旧索引名截断差异），不属于本次新增 DDL，未清理、未将“整库无漂移”作为验收结论。

实库测试证明本轮列出的查询、并发和回滚场景，不代表已验证生产数据规模下的迁移时长或外部 ERP/短信/物流链路。验收后已停止专属 PostgreSQL 与 Next 预览服务，确认 55438 / 3028 均无监听；测试文件及日志保留在本地临时目录。

### 真实浏览器交互（fixture API，不是前后端全栈 E2E）

独立 `3028` 端口启动真实 Next 构建产物，Chromium 驱动。所有 `/api/**` 请求拦截为 fixture；外部请求及未知写请求禁止。

复验通过：鼠标拖动、键盘排序、刷新保留、恢复默认、09 电话筛选参数、当前页全选/翻页清空、批量逐单结果保留、两份打包单、风险勾选门禁、转换后 CONFIRMED 及两个流程时间、390px 手机弹窗无横向溢出。`pageerror=0`。截图已经目视检查。

本地脚本 `/tmp/order-workbench-browser-check.cjs`，结果 `/tmp/order-workbench-browser-result.log`；截图 `/tmp/order-workbench-{columns-desktop,draft-risk-desktop,draft-mobile}.png`。预览服务验收后停止。

## 生产发布与只读验收（2026-11-09）

发布提交 `3255c951`（`feat(orders): add draft conversion and bulk workbench controls`，43 files，+3119/−292），已推送 GitHub `origin/release/orders-workbench-20261109`；经 `git bundle` 传到服务器后，`staging/luwag-shop-domain` 由 `4bf25f8b` 快进到 `3255c951`。在 `/opt/small-house-commerce/small-house-commerce` 重建镜像并 `up -d --no-deps backend frontend`。

| 项目 | 证据 |
| --- | --- |
| 发布前备份 | `/home/ubuntu/deploy-backups/orders-workbench-20261109T034523Z/`：`db.sql.gz`（574K）、`.env.deploy` 与 `docker-compose.prod.yml` 及其 sha256（env `d7f6ed6d…`，compose `e1e7973b…`）、`pre-images.txt`、`db-pre.txt`。 |
| 回滚镜像标签 | `small-house-prod-backend:rollback-pre-orders-workbench-20261109T034523Z` → `4e564d99dc52`；`small-house-prod-frontend:rollback-pre-orders-workbench-20261109T034523Z` → `63e73cf571cb`。 |
| 新镜像 | backend `93123a83cd54`、frontend `c16fa427fa93`；`docker compose ... build backend frontend` exit 0。 |
| 迁移 | 入口日志 `Applying migration 20261106120000_add_order_draft_started_at` → `All migrations have been successfully applied.`；`finished_at=2026-11-09 03:48:30 UTC`。 |
| 数据结构 | `orders.draft_started_at`、`orders.workbench_started_at` 与索引 `orders_workbench_started_at_id_idx` 均存在。 |
| 数据核对 | 迁移前 orders 17 / drafts 37；迁移后 orders 17 / drafts 37；回填不一致 0；带 `draft_started_at` 的订单 17；CONVERTED 草稿 17。部署后新增订单 0，最新订单仍为 `PH100040`。 |
| 容器健康 | backend、frontend、db 均 `healthy`，caddy `running`；切换后约 10 秒达到全部健康。 |
| HTTP 只读 | `https://luwag.shop/`、`/admin`、`/collections/all-products`、`/api/v1` 均 200。 |
| 后台只读 API | 容器内管理员令牌调 `GET /api/v1/admin/orders?sort=newest` 与 `sort=waiting`：各 200、total 17、返回项按 `workbenchStartedAt` 对应方向有序、列表含 `draftStartedAt`；`GET /api/v1/admin/checkout-drafts` 200。 |
| 日志 | backend `error|exception|fatal` 计数 0；frontend `error|fatal` 计数 0；6 个 RBAC reconcile 与 API 启动正常。 |

验证用的容器内令牌文件与脚本已删除；未执行任何写订单操作、未触发外部 ERP 投递、未重跑 seed。首次备份尝试因命令转义失败留下了一份不完整的 `orders-workbench-20261109T034509Z` 目录与同镜像 ID 的重复回滚标签；权威备份是上表的 `T034523Z`。

## 裁决（按作出顺序）

- Ruling: 订单真实 `createdAt` 不回填；列表显示时间使用 `draftStartedAt ?? createdAt` — 避免收入/漏斗被算到草稿日期 — 代价：列表展示日期与正式订单统计日期语义不同，详情明确区分。
- Ruling: 人工转换采用明确操作确认，风险客户额外勾选已联系/已审核 — 用户要求草稿中提示且可联系确认，不应把看到页面当作审核完毕 — 代价：风险单比普通单多一次确认。
- Ruling: 批量打印复用现有打包单，不新增承运商面单接口 — 本轮没有授权新的运单购买/打印集成 — 代价：不产生 J&T 面单。
- Ruling: 所有新增/修复均在此工作树完成，不顺带提交或发布 — 本轮用户授权继续开发；含新增字段迁移，生产执行另报门禁 — 代价：本地完工后仍需发布。（后续用户单独指示「部署上线吧」，发布已按上方流程执行。）
- Ruling: 增加物化 `workbenchStartedAt` 和复合索引，取代 nullable 字段分堆排序或逐页前端重排 — 必须在数据库分页前正确混排，复用所有现有 Prisma 筛选 — 代价：多一个时间字段、全量历史回填及索引；将来新增明确指定历史 `createdAt` 的写入路径也须同步有效时间。
- Final: Ruling: reviewer 暂不判断的真实数据库/浏览器项由主会话分别完成实库与 fixture 交互验证 — 环境缺失已解除，不再以 mock 冒充实库 — 代价：生产数据规模、外部投递及真实浏览器到真实后端的全栈 E2E 仍不在本轮证据内。
- Final: Ruling: 原有单条状态接口的 SHIPPING→SIGNED 权限语义保持不动 — 这是基线行为，新增 bulk DTO 已排除 SIGNED — 代价：如需改变旧接口权限，应独立评估，不能宣称本轮已改。
- Final: Ruling: 过期/耗尽优惠码仍按正式 checkout 规则拒绝转换，不静默删除优惠，不新增人工清除优惠入口 — 保持价格/促销规则且不擅自改变客户选择 — 代价：此类草稿需客服另行处理促销问题后转换。

## 恢复边界与回滚

- 已按用户「部署上线吧」完成生产发布与迁移。发布前核对线上 HEAD/迁移：开发基线 `60178e5b` 不含线上 `4bf25f8b` 的 AID 归因与草稿客服跟进，本轮是在线上版本上整合增量后重新验证、构建和发布。
- 应用回滚：以 `rollback-pre-orders-workbench-20261109T034523Z` 镜像标签重启 backend/frontend，或把 `staging/luwag-shop-domain` 退回 `4bf25f8b` 后重建镜像。
- 两字段与复合索引是 additive；旧应用可以在新结构上运行。**不要把删除列/索引当作自动回滚步骤**。
- 已转换/已确认订单、库存预留、ERP outbox 与跟进记录是业务事实，不能靠回滚镜像撤销，需要单独业务处置。
- 数据库快照是迁移前的 `db.sql.gz`；整库恢复会丢失部署后的线上新数据，只能在明确确认后执行，本轮未演练。

## 无关附带改动

无。未改 Header、Footer、导航、shell、全局主题、前台结账设计；未添加 repo 依赖；未变更生产环境变量；未创建/取消/确认任何真实生产订单。原有 lint、测试类型基线与 schema 漂移均明确保留。
