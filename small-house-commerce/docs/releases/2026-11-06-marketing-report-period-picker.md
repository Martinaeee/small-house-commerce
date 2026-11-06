# 核算页日期选择器改版：生产发布记录

日期：2026-11-06。

- 生产域名：https://luwag.shop
- 发布提交：`3a52c37f`（核算页改版）、`62d1c233`（打包修复）
- 基线：`cd7188de`
- 分支：服务器 `staging/luwag-shop-domain`；部署 ref `deploy/report-picker-20261106b`
- 迁移：无
- 镜像范围：仅前端
- 回滚镜像：`small-house-prod-frontend:rollback-pre-report-picker-20261106` → `c3197225030e`

## 需求

1. 核算页把「触达区间」和「发帖日期」各自收进一个日期表（弹窗日历），选中区间即统计口径；日期左侧给「今天 / 昨天 / 今天和昨天 / 近 7 天」等快捷口径，参考 Facebook 广告后台的日期筛选。
2. 发帖日期用同一套交互。
3. 「统计层级 / 商品 / 负责人」依次紧凑排布。
4. 两个日期选择器放在同一行。
5. 页面列表的「投放周期」改成同款选择器。

## 改动

- 新增 `src/components/admin/marketing/DateRangePicker.tsx`：触发按钮显示「预设 · 起 – 止」，弹窗左侧为预设列（11 个：今天 / 昨天 / 今天和昨天 / 近 7 天 / 近 14 天 / 近 28 天 / 近 30 天 / 本周 / 上周 / 本月 / 上月），中间是双月日历（马尼拉日历日、未来日期禁用），底部「清除 / 取消 / 更新」；点选后才应用，`Escape` 与外部点击关闭。
- 核算页（`ReportTable`）筛选卡：触达日期、发帖日期两个选择器并排一行，勾选框与「查询」按钮同行右对齐；第二行「统计层级 → 商品 → 负责人」紧凑排布；原有口径说明收进可展开的「说明」，毛利口径告警保持常显。
- 页面列表（`MarketingPagesList`）「投放周期」换成同一个选择器，选择即查询（与点「搜索」等价）。
- `src/lib/quick-date-range.ts` 扩展：预设从 4 个到 11 个，新增 `monthGrid`、`presetForRange`、`monthStart`，供日历渲染与「当前区间命中哪个预设」回填。
- 删除旧的 `QuickDateRange.tsx` 与 `quickRangePresets`，避免两套日期交互并存。
- 中英文案新增「触达日期（马尼拉）/ 发帖日期（马尼拉）/ 投放周期（马尼拉）」等键。
- `62d1c233`：`checkout-draft-follow-up.ts` 的模板翻译函数参数类型改为 `(key: TKey) => string`。这个类型错误来自另一条工作线的草稿订单代码，生产源在 `cd7188de` 上已经无法通过 `next build`；本次发布顺手修掉，否则前端镜像打不出来。
- 无后端改动（`git diff --name-only cd7188de..62d1c233` 中 backend 文件数 = 0）。

## 验收

| 检查 | 结果 |
| --- | --- |
| 前端 `pnpm run build`（服务器 docker build） | `BUILD_EXIT=0` |
| 单元测试 `src/components/admin/marketing` + `src/lib/quick-date-range.spec.ts` | 26 文件 / 205 测试全过（含 `DateRangePicker` 6 个：预设、双点选区间保序、取消/Esc、清除、双月与未来日禁用） |
| `tsc --noEmit` | 无输出 |
| 生产镜像 | `small-house-prod-frontend:latest` = `bfc70632040d`（本次构建） |
| 容器 | backend / frontend / db healthy，caddy 正常 |
| 宿主机内页面（容器内 fetch `127.0.0.1:3000`） | `/`、`/admin/login`、`/admin/marketing`、`/admin/marketing/reports`、`/admin/marketing/compare`、`/admin/marketing/optimizers` 全 200 |
| 公网 HTTPS | `/`、`/admin/login`、`/admin/marketing/reports` 全 200 |
| 新 UI 已进产物 | `.next/static/chunks/3d1h4zr6scu9x.js` 与 SSR chunk 内含「触达日期（马尼拉）」，证明线上为本次构建而非旧镜像 |
| 核算接口 | `GET /api/v1/admin/marketing/reports?from=2026-10-30&to=2026-11-05&groupBy=PAGE` → 200，`total=5`，`asOf=2026-11-06T01:15:42Z` |

注：用容器内签发的管理员令牌做接口验收时，`sub` 必须是真实用户 UUID（`users` 表主键），否则 `/api/v1` 的鉴权会先在 `prisma.user.findUnique()` 上报 UUID 语法错误（500）。

## 回滚

纯前端、无迁移：

```bash
docker tag small-house-prod-frontend:rollback-pre-report-picker-20261106 small-house-prod-frontend:latest
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d frontend
```
