# Storefront Health P1.5 / P2-lite / P3 — 验收报告（2026-11-21）

> 状态：**本地完成，未推送、未部署、真实数据库未迁移**。
> 分支 `feat/observability-p1-20261110`，基线 `951f6ab1`（P1R 验收报告）。
> 本轮提交序列见 §6。P4（Page Experience）与 P5（Journey）按用户决定**暂停**。

---

## 1. 本轮交付了什么

| 阶段 | 内容 | 提交 |
|---|---|---|
| P1.5 | 合成探针（每分钟只读 GET）、外部节点 HMAC 上报、节点心跳、可用率与故障恢复 | `e3581772`（与 P2/P3 同批后端提交） |
| P2-lite | 告警引擎（指纹去重 / 恢复关闭 / 复开计数）、飞书通知、`PROBE_DOWN`/`PROBE_STALE`/`PDP_5XX_TIMEOUT`/`PDP_P95_SLOW` 四条规则 | `e3581772` |
| P3 | 接口样本采集（异步缓冲）、路由组 p50/p90/p95、结账技术链路、Request ID 关联、接口与结账诊断页 | `58a531d2`（请求 ID 链路）+ `e3581772` + `0f409292` |

## 2. 提交序列与可回滚粒度

```
69184d48 fix(orders): pin the receipt verification clock in the spec
c386dd48 feat(observability): add the Storefront Health schema
58a531d2 feat(checkout): carry a per-attempt request id through checkout
e3581772 feat(observability): add the backend health services
0f409292 feat(admin): add the Storefront Health pages
ab931e34 docs(observability): record the P3 acceptance evidence
7a9a2cb6 fix(frontend): give Testing Library waits enough room on a loaded machine
```

**为什么按依赖顺序而不是按阶段切**：P1.5/P2/P3 共用 `observability.service.ts`（+701 行）、管理控制器、
Nest 模块、`admin-api.ts`、`i18n/zh.ts`+`en.ts` 和 `HealthHomeView.tsx`，且这些文件内的 diff hunk 三个阶段
交错（实测 `observability.service.ts` 的 hunk 标记为 P1.5+P2+P3 混合）。按阶段切需要手工构造中间版本，
每个中间版本都得编译并通过全量测试——那正是会悄悄弄坏工作树的地方。

**分阶段回滚靠运行时开关，不靠 git revert**：

| 阶段 | 开关 | 关闭后表现 |
|---|---|---|
| P1.5 | `PROBE_ENABLED=false` | 探针不采集，可用性页面显示 NO DATA |
| P2-lite | `ALERT_ENABLED=false` | 不评估、不通知，活跃问题显示「未启用」 |
| P3 | `API_METRICS_ENABLED=false` | 不采集，接口诊断页显示「尚未启用」 |

三者独立，故障域互不影响。这与本功能实际的发布单元（一次发布、一次部署）一致。

## 3. 三条不可妥协的口径

1. **采集绝不阻塞业务**：样本只入队，数据库写入在 5 秒定时器里；队列有上限，丢样计数在页面上可见；
   采集器自身抛错不改变业务响应。
2. **缺证据不装作干净**：查询失败、采集未启用、样本不足、空窗口分别显示 UNKNOWN / 未启用 / NO DATA，
   绝不显示「没有异常」。
3. **不下超出证据的结论**：浏览器网络错误**不能**证明服务器没收到请求，因此关联状态只有
   `CORRELATED` / `SERVER_LOG_MISSING` / `UNKNOWN` 三态。原设计的 `NOT_RECEIVED_CONFIRMED`
   与 `SERVER_SAMPLE_DROPPED` 已删除（前者无法由浏览器证据推出，后者与「服务端样本存在」自相矛盾）。

## 4. 验证证据

### 4.1 自动化测试

| 范围 | 结果 |
|---|---|
| 后端全量 | **2790 passed / 277 skipped**（216 files） |
| 前端全量 | **3856 passed**（350 files） |
| 后端 build / oxlint / `prisma validate` | 全部 exit 0 |
| 前端 `tsc --noEmit` / build | 全部 exit 0 |

### 4.2 真实数据库验证（临时库，用后即删）

`.superpowers/p3-local-20261120/validate-db.cjs` 建临时库 → 依次应用 4 个迁移 → 断言 → 删库。
业务库全程未接触。

结果：
```
HTTP smoke PASS: storefront sample/header, admin report, correlated trace,
invalid-id 400, owner UNKNOWN/403.
{"migrations":4,"apiSamples":81,"productP95":2600,"trace":"CORRELATED",
 "privacy":"PASS","ownerScope":"PASS","p95AlertDedup":"PASS","database":"temporary-only"}
Temporary database removed; application databases untouched.
```

覆盖的断言：81 条样本落库且 p95 计算正确；浏览器事件与服务端样本按 requestId 关联成功；
响应头与样本用同一个 ID；非法 requestId 返回 400；owner 视图（无 `MARKETING_VIEW_ALL`）
整体 UNKNOWN 且追踪接口 403；响应中不含客户姓名/电话等 PII；p95 告警在同窗口内只通知一次。

> 这一步抓到过单元测试无法发现的问题：预算参数在 `CASE … THEN $n` 中被 PostgreSQL 推成 text，
> 报 `42883 integer > text`，诊断接口会静默返回 UNKNOWN。已改为显式 `::int`。

### 4.3 前端测试稳定性（一次真实缺陷的排查与修复）

切分提交后，前端全量测试**连续三次各失败一个不同的文件**（ProductFaqPanel、HomepageEditor、
ProductCard、结账草稿跟进），而这些文件本轮**完全未被改动**。排查结论：

1. 在干净基线 worktree（`951f6ab1`）上全量连跑 2 次全绿；但只要**多加一个只含
   `expect(1 + 1).toBe(2)` 的空测试文件**，基线就连跑 2 次失败。
2. 排除本轮新增的 3 个 spec 文件后，本分支全量连跑 2 次全绿。
3. 失败症状统一为「元素还没出现」：Testing Library 默认只等 1000 ms，而这些后台页面的
   `<select>` 选项与 toast 都要等一个 promise 落定后才渲染。

**修复**：在共享 `src/test/setup.ts` 里设 `configure({ asyncUtilTimeout: 5000 })`，
并把 vitest 的 `testTimeout` 定为 10000 ms。修复后**连跑 4 次全绿**，且在默认 worker 数下
依然全绿。

> 曾试过把 `maxWorkers` 降到 4：失败率下降但没消除（第 2 次仍失败），属于掩盖问题且拖慢 CI，
> 已回退。

### 4.4 浏览器验收

| 场景 | 结果 |
|---|---|
| 桌面 1440px | 无横向溢出、无 page error，接口健康卡片显示 DEGRADED 与 p95 2600ms |
| 手机 390px | 表格自动转为卡片，无横向溢出 |
| 点 request id | 出现 CORRELATED，服务端样本与浏览器事件两侧同时显示 |
| 填非法 ID | 显示「Request ID 格式无效。」 |
| 健康总览 | 结账健康卡片显示真实采样统计 |

截图：`p3-preview-shots/`（api-desktop / api-mobile / api-mobile-trace / health-home-checkout）。

## 5. 已知边界（不是缺陷，是尚未覆盖的范围）

- **p95 只覆盖商品接口的后端处理耗时**，不等于 PDP 整页加载、TTFB 或 LCP。整页指标需要
  Next 侧 instrumentation 或边缘时间窗聚合，两者都未接通。
- **访问诊断分支未整枝合并**（39 提交 / 85 文件）。P2-lite/P3 只读复用其 `access.json` 契约。
- **生产结账改版会撞 P3 的 `CheckoutConfirmView.tsx` / `lib/api.ts`**，移植时需按语义重放。
- **生产未 reconcile 过 `OBSERVABILITY_VIEW`**，部署时不做则导航项对所有人不可见。
- **探针 UA 未被访问诊断脚本识别**：`luwag-access-report.sh` 的 `BOT_MARKERS` 里没有
  `LUWAG-Probe`，探针请求会被计成真人流量并拉低图片命中率。上线前必须给脚本加 `probe` 分类。
- **探针流量规模待定**：1 分钟 × 5 路由 = 7,200 次/天从生产主机打自己。默认间隔建议放宽到
  2~5 分钟，或只打首页与结账两条关键路由。

## 6. 部署前需要授权的四件事

1. **移植到生产基线** `db04013f`（`prod/staging/luwag-shop-domain`），不是 merge 本分支。
   与生产的重叠文件仅 4 个（`AdminShell.tsx`、`i18n/zh.ts`、`i18n/en.ts`、`admin-api.ts`），
   另有 2 个结账文件需人工重放。
2. **迁移**：4 个新表/枚举，纯 additive。真实库执行前先备份。
3. **权限**：`OBSERVABILITY_VIEW` 从未 reconcile 过。
4. **环境变量**：`PROBE_*` / `ALERT_*` / `API_METRICS_*` / `EXTERNAL_PROBE_SECRET`，
   以及飞书 `ALERT_WEBHOOK_URL`（复用 `/etc/luwag/alert.env`）。

## 7. 独立审查状态

P3 的独立审查代理因 API 429 限额中断，按既定规则由主 Agent 收口自查。
**这不能替代独立评审**：若 P3 要上生产，建议在提交切分完成后另择时机重跑一次独立评审。
