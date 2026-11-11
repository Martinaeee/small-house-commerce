# CL/AID/动态 AdID 归因闭环 — 实施审核报告

日期：2026-11-11
分支：`deploy/meta-attribution-20261111`
基线：`1a3cbaf4`（`prod/staging/luwag-shop-domain`）
范围：Task 0-14 + Task 17；**Task 15 未执行，Task 16 未实施；生产代码/数据库未改动。**

## 1. 结论

- 需求 1-9 已实现并通过单元/集成/Staging 验收。
- 追踪参数固定为 `cl`、`aid`、`adid` 三个；访问、商品浏览、加购、结账、订单、
  优化师核算和 AdID 报表共用同一份验签 claims。
- Staging 12 项验收全部通过（第 12 项 Pixel/CAPI 因 Staging 显式关闭，
  由单元测试覆盖）。
- 未做生产发布；等待用户确认后再讨论 Task 15。

## 2. 提交清单（16 个提交）

```
7b4dffac docs(marketing): spec and plan for CL/AID/dynamic AdID attribution
3f455a3c feat(analytics): attribution columns and indexes for CL/AID/AdID
965e6244 feat(marketing): record AdID provenance on signed touches
99d8d0e5 fix(marketing): keep link identity on AID conflict and fall back to AID
4fad254b feat(analytics): store verified touch attribution on events
549cd4c6 feat(orders): prefer the dynamic Meta ad ID for the advertising number
d60d9772 feat(marketing): expose clean URL, CL and per-link Meta parameters
793db942 feat(marketing): create Meta links as CL with no manual ad id
3253f0bc feat(marketing): show clean URL, CL and AID in the link result
7e243179 feat(marketing): show clean link URLs and CL/AID copy actions
4d8923f2 feat(short-link): forward the CL code through the redirect
350947e6 feat(marketing): add AdID and AID attribution report dimensions
fc7c766f feat(marketing): add AdID and AID report views
061daf47 chore(marketing): fix result dialog busy state for lint
0aae52d3 feat(marketing): include link names in attribution report rows
f34b9e68 docs(marketing): staging acceptance evidence for CL/AID/AdID attribution
```

改动：37 个文件，+3276 / −94。生产代码只加可空列与只读字段，不做数据重写。

## 3. 需求覆盖

| 需求 | 实现 | 证据 |
|---|---|---|
| R1 创建后只显示干净 URL / CL / AID | `cleanPath`、`cl`、`metaUrlParameters` 由后端生成；META_AD 结果弹窗三字段 + 复制 | `campaign-links.service.spec.ts`、`CreateCampaignLinkDialog.spec.tsx` |
| R2 不自动拼 `?cl=`/`?aid=`，不填 adid | 仅 META_AD 使用 `cleanPath`；创建表单固定 CL、隐藏手工 meta 字段 | 同上；FB_POST 保持原追踪 URL/短链 |
| R3 Meta 参数 `cl&aid&adid` | 按链接生成，AID 取链接创建时 `aidSnapshot`；`{{ad.id}}` 原样 | Staging 返回 `cl=rdmiTMfdJOMh1IQV&aid=OP-F06ECB704CC3&adid={{ad.id}}` |
| R4 前端独立读所有参数 | 生产原有 `marketingParams` 已满足；复跑 `tracking.touch.spec.ts` | 全量前端 3830 测试通过 |
| R5.1 CL 不阻断 AID | 未知/停用 CL + 有效 AID → `AID_FALLBACK`，记录冲突 | Staging claims；`marketing-touch.service.spec.ts` |
| R5.2 CL 定位链接/商品/落地页 | 原有 `resolveTouch` + path 校验 | Staging touch claims |
| R5.3 AID 识别优化师 | 有效 AID 覆盖 owner，保留 `linkId` | Staging `OP-E2E-OPT` 冲突 claims；ADID 报表 owner 为 E2E Optimizer |
| R5.4 AdID 动态优先 | `adIdProvenance`：动态 > 链接静态 | `marketing-touch.service.spec.ts` |
| R5.5 静态仅回退 | `adIdSource=LINK` 仅在动态缺失时 | 同上 |
| R5.6 记录 source / missing reason | claims、`analytics_events`、`order_attributions` 三层 | 迁移列；Staging `PH100021` |
| R5.7 冲突记录 | `attributionConflict`/`conflictDetail`；冲突保留链接身份 | Staging 冲突 claims |
| R5.8 凭据完整归因 | claims v2 新增 `adIdSource`/`adIdMissingReason`/`linkResolution` | Staging claims |
| R5.9 不信任客户端字段 | ingest 只写 claims；客户端 `campaignId` 被忽略 | `analytics.service.spec.ts` |
| R6 跨页/订单快照 | 沿用 credential + 首触/末触 cookie；订单固化 | Staging `PH100021` |
| R7 报表维度 | 新增 `ADID`/`AID` 分组、`adVisits/productViews/linkCount/adCount` | Staging 报表；`marketing-report.integration.spec.ts` |
| R8 Staging 12 项 | 全部执行 | `docs/superpowers/plans/2026-11-11-meta-attribution-staging-evidence.md` |
| R9 只读审查/不部署 | 第 0 节审计；Task 15 冻结、Task 16 不实施 | 本报告 |

## 4. 数据库迁移

`backend/prisma/migrations/20261111120000_add_analytics_attribution/migration.sql`：

- `analytics_events` 新增可空列：
  `optimizer_id`、`aid_snapshot`、`ad_id`、`ad_id_source`、
  `ad_id_missing_reason`、`adset_id`、`attribution_paid`、`link_resolution`、
  `attribution_conflict`、`conflict_detail`。
- 索引：`(ad_id,event_name,event_day)`、`(optimizer_id,event_name,event_day)`、
  `(campaign_link_id,ad_id,event_day)`、`order_attributions(link_id,ad_id)`、
  `order_attributions(ad_id,attributed_at)`。
- 无数据回填、无列删除、无 NOT NULL；旧代码可继续运行。

Staging 已应用（`2026-11-11 04:31:49+00`）；生产未应用。

## 5. 验证结果

| 项目 | 结果 |
|---|---|
| backend `vitest run` | 205 文件通过 / 27 skipped；2742 测试通过 / 280 skipped |
| backend 报表集成（独立 DB） | 15/15 通过（含 3 个新 AdID/AID 用例） |
| frontend `vitest run` | 346 文件 / 3830 测试全部通过 |
| backend `nest build` | 通过 |
| frontend `next build` | 通过（`API_TARGET=http://backend:3000`） |
| frontend `tsc --noEmit` | 0 error |
| backend `tsc --noEmit` | 219 条错误均在 spec/e2e 文件（qianyi 既有类型问题、集成测试宽松 fixture 等）；**新增/修改的非 spec 文件无错误**，`nest build` 通过 |
| backend lint | 无 error（仅既有 warning） |
| frontend lint | 4 个 error 均为既有无关文件（orders/drafts、ChangePasswordDialog、ResetPasswordDialog、TeamMemberDialog）；本次新增/修改文件无 error |
| Staging | backend/frontend/db healthy；12 项验收见证据文档 |

## 6. Staging 关键证据

- 链接：`rdmiTMfdJOMh1IQV` / AID `OP-F06ECB704CC3`；
  `cleanPath=/products/e2e-legacy-style`；
  `metaUrlParameters=cl=...&aid=...&adid={{ad.id}}`。
- 3 个 AdID 的 touch/事件分别归属；ADID 报表 3 行，`adVisits=1`，
  `visits=null`。
- 冲突 AID：`owner=E2E Optimizer`、`linkId` 保留、冲突有值；
  ADID 报表该行 owner 取自 claims。
- AID-only：`linkId=null`、`linkResolution=AID`、动态 AdID 正常。
- 订单 `PH100021`：`optimizer_id`、`aid_snapshot`、`adid`、`ad_id`、
  `adid_source=META_DYNAMIC`、`link_id`、`product_id` 有值；
  `campaign_id/adset_id/UTM` 为空（允许）。
- 短链 302 完整转发 `cl/aid/adid/fbclid`。
- 未知 CL + 有效 AID：`AID_FALLBACK` + 冲突记录。

## 7. 未执行 / 边界

- **Task 15（生产发布）未执行**；生产 compose、容器、数据库未动。
- **Task 16（历史 page_url 回填）未实施**；历史 AdID 报表自上线起累计。
- 三参数口径下 `campaign_id`/`adset_id`/UTM 为空；需要时在 Meta 参数追加，
  代码已支持。
- 订单 `adid` 在动态 Meta AdID 与链接编号不一致时改为动态值；这是本次
  行为变化（符合“Meta 真实 ID 优先”）。
- FB_POST 的追踪 URL、短链、结果弹窗、复制按钮保持原样。
- 商品漏斗 ADS 口径未改；广告改为 `cl+aid` 后 aid-only 流量会从 ORGANIC
  转为 ADS，这是预期变化。
- Staging 的 Pixel/CAPI 关闭；第 12 项由单元测试覆盖，未发送真实 Pixel 事件。
- claims 仍为 version 2，只增加可选字段；旧凭据可解析。滚动重启期间新凭据
  可能被旧实例的 `.strict()` 拒绝，单实例低峰发布可规避。

## 8. 生产变更清单（仅列出，未执行）

1. 应用迁移 `20261111120000_add_analytics_attribution`（可空列/索引）。
2. 重建 backend → 重建 frontend（先后端后前端）。
3. 生产非下单冒烟：真实商品页带 `?cl=...&aid=...&adid=...`，确认
   `campaign_link_visits` 与 `analytics_events` 写入；不制造测试订单。
4. 回滚：回滚镜像，保留新列（可空，不影响旧代码）。

## 9. 建议

请先审阅本报告与 Staging 证据。确认后再决定是否进入 Task 15（生产发布）；
在得到明确授权前，不修改生产代码或数据库。
