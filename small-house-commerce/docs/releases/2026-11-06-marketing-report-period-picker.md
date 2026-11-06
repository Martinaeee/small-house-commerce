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

（见下方「生产验收」小节）

## 回滚

纯前端、无迁移：

```bash
docker tag small-house-prod-frontend:rollback-pre-report-picker-20261106 small-house-prod-frontend:latest
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d frontend
```
