# 投放工作台快捷日期范围：生产发布记录

日期：2026-11-05。

- 生产域名：https://luwag.shop
- 发布提交：`bc3a7e95`（基线 `4c1501ae`）
- 分支：服务器 `staging/luwag-shop-domain`；部署 ref `deploy/quick-dates-20261105`
- 迁移：无
- 回滚镜像：
  - `small-house-prod-backend:rollback-pre-quick-dates-20261105` → `d06a19b924fb`
  - `small-house-prod-frontend:rollback-pre-quick-dates-20261105` → `0f437b997afc`

## 需求

投放工作台的时间筛选增加快捷按钮：今天 / 昨天 / 今天和昨天 / 最近 7 天（参考 Facebook 广告后台的日期预设）。用户确认要加在三处：性能视图「日期范围」、核算页「报告日期」、页面列表「投放周期」。

## 改动

- 新增 `src/lib/quick-date-range.ts`：按马尼拉日历日解析四个快捷范围（`Intl.DateTimeFormat` + `Asia/Manila`，与页面原有默认值同一口径）。
- 新增共享组件 `QuickDateRange`：四个圆角按钮，当前生效范围高亮（`aria-pressed`），点击即填入并重新查询。
- 页面列表「投放周期」：点快捷按钮直接填入起止并触发查询（与点「搜索」等价）。
- 核算页「报告日期」：点快捷按钮直接填入起止并重新拉取报告。
- 性能视图（商品比较 / 优化师总览）「日期范围」：四个快捷按钮 + 下拉扩展到 12 个预设；对比窗口规则：
  - 本周/本月按「上一个自然周 / 上一个自然月」对比（本月不会再拿一个等长的滑动窗口对比）；
  - 其余按相邻等长区间对比。
- 修正 `/admin/marketing/compare`、`/admin/marketing/optimizers` 路由里写死的五个预设白名单——新预设通过 URL 传入时会被静默落回最近 7 天，现在接受全部预设。
- 按钮高亮用主题令牌 `text-cta-foreground`，不写死 `text-white`（主题守卫测试会拦）。

## 验收

| 检查 | 结果 |
| --- | --- |
| 后端 `src/modules/marketing` | 187 passed / 38 skipped |
| 前端全量 | 3591/3591（`tsc --noEmit` 无输出） |
| `quick-date-range` 单测 | 4/4（含 16:00 UTC 马尼拉换日、跨月跨年） |
| 后端窗口单测 | 今天/昨天/今天和昨天/14 天/28 天/本月/上个月 + 对比区间全部通过 |
| 本地浏览器 `/admin/marketing` | 四个按钮渲染，点「今天和昨天」高亮并把 统计日期从/至 填为 2026-11-04 / 2026-11-05，列表重新查询 |
| 本地浏览器 `/admin/marketing/reports` | 点「今天和昨天」→ 报告请求 `from=2026-11-04&to=2026-11-05` 200 |
| 本地浏览器 `/admin/marketing/compare` | 点「今天和昨天」→ 性能请求 `preset=TODAY_AND_YESTERDAY` 200 |
| 无 pageerror（三个页面） | 通过 |
| 生产 `/`、`/admin/marketing`、`/compare`、`/reports` | 全 200 |
| 生产 API 六个预设 | `TODAY` 11-05、`YESTERDAY` 11-04、`TODAY_AND_YESTERDAY` 11-04~11-05、`LAST_14_DAYS` 10-23~11-05、`THIS_MONTH` 11-01~11-05、`LAST_MONTH` 10-01~10-31，全部 200 |
| 容器 | backend / frontend / db healthy，caddy 正常 |

已知无关失败：后端全量套件里 `uploads.service.spec.ts › stores the transcoded bytes for a large mp4` 在并行负载下超时，单独跑该文件 12/12 通过；与本次改动无关。

## 回滚

纯代码、无迁移：

```bash
docker tag small-house-prod-backend:rollback-pre-quick-dates-20261105 small-house-prod-backend:latest
docker tag small-house-prod-frontend:rollback-pre-quick-dates-20261105 small-house-prod-frontend:latest
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend frontend
```
