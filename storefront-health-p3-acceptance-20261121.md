# Storefront Health P1.5 / P2-lite / P3 — 验收与交接（2026-11-23 定稿）

> 状态：**本地完成，未推送、未部署、真实数据库未迁移**。
> 交付分支：`feat/storefront-health-port-20261122`（**基于生产 `5684fea0`**，11 个提交）。
> 过程记录分支：`feat/observability-p1-20261110`（基线 `951f6ab1`，10 个提交）。
> P4（Page Experience / RUM）与 P5（Journey）按用户决定**暂停**。

---

## 1. 交付了什么

| 阶段 | 内容 |
|---|---|
| P1.5 | 合成探针（默认 2 分钟只读 GET，DNS/TLS/HTTP/DOM）、外部节点 HMAC 上报、节点心跳、7/30 天可用率与故障恢复 |
| P2-lite | 告警引擎（指纹去重 / 恢复关闭 / 复开计数）、飞书通知，四条规则：`PROBE_DOWN`、`PROBE_STALE`、`PDP_5XX_TIMEOUT`、`PDP_P95_SLOW` |
| P3 | 接口样本采集（异步缓冲、队列上限 2000、丢样计数可见）、路由组 p50/p90/p95、结账技术链路、Request ID 关联、接口与结账诊断页 |

配套修的三件关联问题：
- **探针污染访问诊断**：访问报告把探针算成真人流量、把命中率拉低（实测 4 真人 + 3 探针报成 7 真人、33.3% 而非 50%）。已加 `probe` 独立分类，与预热脚本一样排除在真实命中率外。
- **探针频率**：每条路由一轮要付一次 DNS 查询 + 一次 TLS 握手 + 一次整页渲染；默认间隔改为 2 分钟，新增 `PROBE_INCLUDE_CHECKOUT=false` 可去掉购物车/结账两条。
- **导航标题**：「店面健康」标题用生产的 group 机制承载，子模块仍收在「健康总览」行下。

## 2. 提交序列

**移植分支**（相对生产 `5684fea0`）：

```
ac0c3fa4 feat(observability): add the Storefront Health schema
23d67254 feat(checkout): carry a per-attempt request id through checkout
6f124b46 feat(observability): add the backend health services
da3f311c feat(admin): add the Storefront Health pages
71bfa494 fix(frontend): give Testing Library waits enough room on a loaded machine
109d9a0b docs(observability): record the P3 acceptance evidence
1bcc4e04 fix(observability): close the gaps the independent review found
1a71562a fix(deploy): keep the availability probes out of the traffic report
26364875 feat(observability): make the probe cadence and routes configurable
277fd27b fix(admin): keep the Storefront Health heading in the ported navigation
242cd0c4 chore(observability): move the five migrations past the applied production ones
```

**为什么按依赖顺序而不是按阶段切**：P1.5/P2/P3 共用 `observability.service.ts`（+701 行）、管理控制器、
Nest 模块、`admin-api.ts`、`i18n/zh.ts`+`en.ts` 和 `HealthHomeView.tsx`，且这些文件内的 diff hunk 三个阶段
交错。按阶段切需要手工构造中间版本，每个中间版本都得编译并通过全量测试——那正是会悄悄弄坏工作树的地方。

**分阶段回滚靠运行时开关**（不是 git revert）：

| 阶段 | 开关 | 关闭后表现 |
|---|---|---|
| P1.5 | `PROBE_ENABLED=false` | 探针不采集，可用性页面显示 NO DATA |
| P2-lite | `ALERT_ENABLED=false` | 不评估、不通知，活跃问题显示「未启用」 |
| P3 | `API_METRICS_ENABLED=false` | 不采集，接口诊断页显示「尚未启用」 |

## 3. 三条不可妥协的口径

1. **采集绝不阻塞业务**：样本只入队，数据库写入在定时器里；队列有上限，丢样计数在页面上可见；
   采集器自身抛错不改变业务响应。
2. **缺证据不装作干净**：查询失败、采集未启用、样本不足、空窗口分别显示 UNKNOWN / 未启用 / NO DATA，
   绝不显示「没有异常」。（独立评审抓到的第一个缺陷就是这条被破坏。）
3. **不下超出证据的结论**：浏览器网络错误**不能**证明服务器没收到请求，因此关联状态只有
   `CORRELATED` / `SERVER_LOG_MISSING` / `UNKNOWN` 三态。

## 4. 迁移

五个迁移，**全部命名在生产最新迁移 `20261123120000` 之后**（该迁移从未在任何环境应用过，重命名零风险）：

```
20261123130000_add_observability_view_permission   ← 权限，必须 reconcile
20261123140000_add_synthetic_probe_runs
20261123150000_add_probe_node_heartbeats
20261123160000_add_alert_issues                    ← 表名 alert_history
20261123170000_add_api_request_metrics             ← 含 analytics_events 的 requestId 部分索引
```

纯 additive：不重写任何既有表。唯一触及既有表的是那条部分索引。

## 5. 验证证据

### 5.1 自动化

| 范围 | 结果 |
|---|---|
| 后端全量 | **2957 passed / 281 skipped**（262 files） |
| 前端全量 | **3985 passed**（370 files） |
| 后端 build / oxlint / prisma validate | exit 0 |
| 前端 tsc / build / eslint | exit 0（3 个生产原有 warning，0 error） |
| 部署脚本测试 `test-access-report-probe.py` | PASS（仓库第一个 Python 测试） |

### 5.2 真实数据库

临时库重放**当前完整生产迁移序列 + 这 5 个** = **99 个迁移**，然后 HTTP 冒烟，再删库。业务库全程未接触。

冒烟覆盖：采样落库且 p95 正确、浏览器事件与服务端样本按 requestId 关联、响应头与样本同 ID、
非法 requestId 400、owner 视图整体 UNKNOWN 且 trace 接口 403、响应不含 PII、p95 告警同窗口只通知一次。

### 5.3 浏览器

桌面 1440 / 手机 390 无横向溢出、无 page error；request id 查询出 `CORRELATED`；非法 ID 提示格式错误；
导航「店面健康」标题 + 「健康总览 ›」折叠 + 生产的「支付方式」「系统状态 ›」三者并存正常。

## 6. 独立评审

评审代理跑完（首次因 429 中断，第二次完成），确认核心要求达标，报 **2 个 Important，均已修复**：

1. 告警引擎关闭时首页仍显示绿色 OPERATIONAL + 「未检测到活跃问题。」——空列表不等于健康。
2. 一轮探针覆盖全部路由且共享同一 runId，导致 runs 列表 React key 重复、移动端点一行展开全轮。

另修两个 minor：迁移时间戳 out-of-order、两个证据永远无法产生的死枚举。

评审剩余 minor（**非缺陷，未处理**）：`occurrences` 计的是评估次数而非不同发生次数；60s 轮询不感知
页面隐藏；可用率 KPI 只对有数据的天求均值。

## 7. 已知边界

- **p95 只覆盖商品接口的后端处理耗时**，不等于 PDP 整页加载、TTFB 或 LCP。整页指标需要 Next 侧
  instrumentation 或边缘时间窗聚合，两者都未接通。**这是顾客实际感知慢的唯一缺口。**
- **前端有生产基线自带的不稳定测试**：`ProductOptionSelector`、`HomepageEditor`、结账草稿跟进等。
  用纯生产 worktree（零观测代码）跑全量 **3 次挂 2 次**证明与本次改动无关。**未修**——修它们要改生产
  自己的测试文件，会与支付那条线增加冲突。代价是这条分支的 CI 会间歇性红。
- **生产自己已有 4 对重复迁移时间戳**（`20261015100000`、`20261023120000`、`20261106120000`、
  `20261120150000`），migrate 历史本来就不单调。

## 8. 上生产需要授权的事

1. **备份生产库**，然后应用 5 个迁移。
2. **reconcile `OBSERVABILITY_VIEW`**（从未在任何环境应用；不做则导航对所有人不可见）。
3. 配置 `PROBE_BASE_URL` / `PROBE_PRODUCT_PATH` / `PROBE_INTERVAL_MS`（默认 120000）/
   `ALERT_ENABLED` / `ALERT_WEBHOOK_URL` / `API_METRICS_ENABLED` / `EXTERNAL_PROBE_SECRET`。
   飞书复用 `/etc/luwag/alert.env` 同一 webhook。
4. 把 `deploy/luwag-access-report.sh` 更新到主机（探针分类需要它）。
5. 推送分支——建议只推移植分支。
6. **定飞书告警的接收人与响应时限。** 没人负责看的告警，上线第一周就会变成噪声，比没有更糟。
7. （另开一轮）修生产自带的不稳定测试。

## 9. 回退

- 代码：`git reset --hard` 回生产 tip，或直接丢弃移植分支（生产从未包含这些提交）。
- 数据：5 个迁移纯 additive，回退只需 `DROP TABLE` / `DROP TYPE`；`api_request_metrics` 与
  `analytics_events` 的部分索引可独立删除。
- 运行时：三个开关逐个关闭即可分阶段停用，无需改代码。

备份分支：`backup/port-before-prod-move`、`backup/port-before-cos-move`（两次 rebase 前的快照）。
