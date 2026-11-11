# Meta 投放链接：CL + AID + 动态 AdID 归因闭环

> 需求来源：用户 2026-11-11 的《LUWAG 广告投放链接及 Meta 动态归因调整需求》。
> 本文件把需求固化为可执行的设计决策；实施步骤见
> `docs/superpowers/plans/2026-11-11-meta-attribution-cl-aid-adid.md`。

## 1. 业务目标

后台负责创建落地页、生成 CL、读取优化师 AID；优化师在 Meta Ads Manager
自行配置 CL、AID 与动态 AdID；Meta 用户点击后，网站读取所有参数并贯穿
访问、商品浏览、加购、结账和订单。

目标闭环：

```
Meta 广告
  Website URL  = 干净的落地页 URL（不带任何追踪参数）
  URL 参数     = cl=<CL>&aid=<AID>&adid={{ad.id}}
        │
        ▼
落地页 / 商品页
  MarketingTouchService 验签并签发 credential（含链接、优化师、AdID、来源）
        │
        ├─ 第一方 analytics_events（按验签 claims 落库）
        ├─ 购物车 / 结账 / CreateOrder（同一 credential）
        └─ order_attributions（不可变快照）
        │
        ▼
后台：
  - CL 登记访问（campaign_link_visits，保留）
  - AdID / AID 归因报表（analytics_events + order_attributions）
```

## 2. 需求原文要点（验收口径）

1. 创建成功后只显示三个独立信息：Landing Page URL（干净）、CL、AID；
   三者分别可复制。
2. Landing Page URL 不自动拼接 `?cl=` 或 `?aid=`；不需要人工填写 AdID。
3. Meta 的 Tracking → URL Parameters 由优化师填写
   `cl=<CL>&aid=<AID>&adid={{ad.id}}`（不带问号；`{{ad.id}}` 必须原样保留）。
4. 前端独立读取 `cl`、`aid`、`adid`、`ad_id`、`campaign_id`、`adset_id`、
   `utm_*`、`fbclid`，不再让 CL 与 AID 互斥。
5. 后端以 CL 定位链接/商品/落地页，以 AID 识别优化师，AdID 优先使用
   Meta 动态值；静态 AdID 仅作动态值缺失时的兼容回退。
6. 记录 `adid_source`、`adid_missing_reason`；CL 绑定优化师与传入 AID
   不一致时必须记录冲突，不能静默错配。
7. 凭据必须包含完整归因信息；不信任客户端直接提交的未验证归因字段。
8. 订单创建时固化：`optimizerId`、`aidSnapshot`、`adId`、`adidSource`、
   `adidMissingReason`、`campaignId`、`adsetId`、`linkId`、`productId`、
   `landingPageId`、`fbclid`、UTM；历史订单不被后续链接修改覆盖。
9. 报表保留 CL 登记访问；新增 AID/优化师、商品、AdID、CL 维度；同一 CL
   下不同 AdID 分开统计；网站总访问、CL 登记访问、AdID 归因访问不得混算。
10. Staging 完成 12 项验收后才能进入生产；未经审核不改生产、不部署、
    不制造生产测试订单。

## 3. 关键设计决策

### D1. 链接创建只出示三件套，Meta 参数由后端按链接生成

- `CampaignLinkRow` 新增 `cleanPath`（`/products/<slug>` 或 `/lp/<slug>`，
  仅保留 `variant`，不含 `cl`/`aid`/UTM）。**只有 `META_AD` 链接使用
  `cleanPath`；`FB_POST` 继续使用原来的追踪 `path` 与短链，行为不变。**
- `metaUrlParameters` 由后端按链接生成（AID 固定取链接创建时的
  `aidSnapshot`，不取当前登录人或传入的 aid）：
  `cl=<code>&aid=<aidSnapshot>&adid={{ad.id}}`。前端只复制，不自行拼接。
- `path`（旧追踪链接）继续保留，保证已有短链、帖子链接与历史行为不变。
- 复制 `metaUrlParameters` 时 `{{ad.id}}` 原样输出，禁止 URL 编码
  （`%7B%7Bad.id%7D%7D` 不会被 Meta 替换，这正是 2026-11-11 生产上观测到的
  `adid=%7B%7Bad.id%7D` 现象）。
- 只放 `cl/aid/adid` 三个参数时，订单的 `campaignId`/`adsetId`/UTM 允许为空
  （当前生产事件原本也没有这些值）。**不得为了测试通过而增加追踪参数**；
  若未来需要保留，追加 `campaign_id={{campaign.id}}&adset_id={{adset.id}}`
  与 UTM 模板即可，代码已支持。

### D2. 新链接默认用 CL 识别；旧 AID 链接保持可读；FB_POST 完全不动

- 前端创建 META_AD 链接时固定提交 `attributionMode: "CL"`，并隐藏模式选择。
- 后端 `mint()` 的默认值不改（仍为 AID），避免破坏 API 兼容与已有测试；
  CL 由前端显式传入。
- 已有 AID 模式链接不迁移、不改写；其 `code` 仍存在，Meta 参数带上 `cl`
  后同样会记录 `campaign_link_visits`（`resolveTouch` 不检查 attributionMode）。
- 链接列表不再对 AID 模式隐藏「核算」入口；报表是否可看由数据决定。
- **FB_POST 的追踪 URL、短链、结果弹窗、复制按钮全部保持现状**；不做
  `cleanPath`，不改成 Meta 三件套。

### D3. AdID 优先级（Meta 真实 ID），统一 `AdidSource` 类型

- 在 `marketing-attribution.ts` 定义唯一联合类型，claims、订单、analytics
  共用，不再出现未定义字符串：
  ```ts
  export type AdidSource = 'LINK' | 'META_DYNAMIC' | 'META_DYNAMIC_FALLBACK' | 'LEGACY' | 'NONE';
  ```
- 有效动态 AdID（`^\d{6,20}$`）优先，来源 `META_DYNAMIC`。
- 动态缺失时使用链接静态 AdID（`campaign_links.ad_id`），来源 `LINK`。
- 两者都缺失：付费流量记录 `MISSING_META_AD_ID`，自然流量记录
  `ORGANIC_TOUCH`；若传入的是 `{{ad.id}}`/非法字符串，记录
  `INVALID_META_AD_ID`。
- 订单的展示广告编号 `order_attributions.adid` 在动态 AdID 存在且与链接
  编号不一致时改用动态值（`adid_source='META_DYNAMIC'`）；一致时仍为
  `LINK`；动态缺失时回退链接编号（`LINK`）；链接没有编号但动态存在时用
  `META_DYNAMIC_FALLBACK`（该值已在生产 schema 与订单逻辑中存在，本次只是
  把它纳入共享类型）。静态 AdID 永远不会覆盖动态值。

### D4. CL 解析失败不阻断 AID

- `code` 无效 / 链接停用 / 路径不匹配时，若同时带有效 `aid`，回退到 AID
  触达（`linkId=null`，`linkResolution='AID_FALLBACK'`），并记录
  `attributionConflict` 与原因。
- CL 有效但传入 AID 无效：保留链接归因，记录冲突（`conflictDetail`）。
- CL 有效且 AID 有效但不同：优化师归属以 AID 为准，**链接身份继续保留**
  （修复现有实现冲突时 `linkId` 被置空的问题），并记录冲突。

### D5. 第一方事件的归因字段只来自验签 claims

- `analytics_events` 新增可空列：`optimizer_id`、`aid_snapshot`、`ad_id`、
  `ad_id_source`、`ad_id_missing_reason`、`adset_id`、`attribution_paid`、
  `link_resolution`、`attribution_conflict`、`conflict_detail`。
  其中 `ad_id_source` 使用 D3 的 `AdidSource` 联合类型。
- ingest 只从 `MarketingTouchService.resolve()` 的 claims 写入这些列；
  客户端 body 里的 `campaignId` 不再直接落库（当前前端本来也不发送）。
- 身份字段（owner/link/product/landingPage）只来自 DB 校验；
  `campaignId/adsetId/utm_*` 是 Meta 透传的描述字段，服务端只做长度/格式
  校验并签入 claims，不用来选归因对象；`adId` 只接受 `^\d{6,20}$`。
- 历史事件不回填、不假设；新增报表明确标注「自上线起累计」。

### D6. 报表口径分栏，不混算

- 保留「已登记链接访问」= `campaign_link_visits`（只有 CL 能记）。
- 新增「AdID 归因访问」= `analytics_events` 中 `ad_id` 非空的
  `(session_id, event_day)` 去重；同一 CL 下按 AdID 分行。
- 新增 AID/优化师视图 = 验签 claims 的 `optimizer_id` + `attribution_paid`。
- AdID 视图的「已登记链接访问」列显示 `—`，因为历史 CL 访问无法可靠拆到
  AdID；不得用 AdID 访问倒推或相加。
- 订单指标继续来自 `order_attributions`，按 `ad_id` / `optimizer_id` 分组；
  缺失 AdID 的订单单独成行并显示缺失原因。

### D7. 历史数据边界

- 生产现有 22 条链接：12 条 FB_POST/CL、8 条 META_AD/CL、2 条 META_AD/AID；
  1,092 条 CL 访问全部来自 CL 链接，AID 链接 0 条。
- 生产现有 10 张订单（2026-11-04 至 11-07），均早于 `adid_source` 迁移，
  因此历史订单的 `adid_source`/`adid_missing_reason` 为空是预期，不回填。
- `analytics_events` 现有 5,446 条，其中 2,239 条 URL 含 `cl`、1,461 条含
  数字 `adid`、957 条已解析 `campaign_link_id`；历史 AdID 无法从凭据恢复。
  **本次不回填历史数据；计划里的 Task 16（page_url 回填）不实施。**

### D8. 不改的部分

- 付款、库存、Qianyi、CAPI Purchase 去重逻辑不动。
- 已有 CL 链接的 `path`/短链目标不改写。
- **FB_POST 的追踪 URL、短链、结果弹窗与复制按钮全部保持现状。**
- 商品漏斗的 ADS 口径不改（仍以 `campaign_link_id` 判定）；切换广告参数后
  广告流量会自然从 ORGANIC 变为 ADS，这是预期变化。
- 性能视图（落地页维度）不改。

## 4. 验收（Staging 12 项）

1. 创建 META_AD 链接：返回的 Landing Page URL 不含任何追踪参数；
   FB_POST 链接仍返回原追踪 `path` 与短链。
2. 复制 URL 直接打开：页面正常。
3. 模拟 `cl + aid + adid`：三个参数都被读取。
4. 同一个 CL 用三个不同 AdID：访问分别归属。
5. 不同 AID 的优化师归属正确（ADID 报表读验签 `optimizer_id/aid_snapshot`）。
6. 商品浏览、加购、结账参数不丢失。
7. 创建测试订单：`optimizer/aid/adId/adid_source/linkId/productId/landingPageId`
   完整；`campaign_id`、`adset_id`、UTM 允许为空，**不得为了通过测试增加
   追踪参数**。
8. 后台按优化师、商品、AdID、CL 筛选/分组结果正确。
9. 旧版 AID-only 链接兼容，并能接收动态 AdID。
10. 短链 302 不丢 `cl/aid/adid/fbclid`。
11. 未知/停用 CL + 有效 AID 时回退且记录冲突。
12. Meta Pixel/CAPI 事件及去重不受影响。
    - 注意：Staging 的 compose 明确关闭 Pixel/CAPI（`NEXT_PUBLIC_META_PIXEL_ID=""`），
      第 12 项只能在本地/预览环境用 Meta 测试事件编号验证，或由单元测试
      覆盖 event_id 去重；不得在生产制造测试事件。

## 5. 执行边界（用户 2026-11-11 审核决定）

- 只在生产基线 `1a3cbaf4` 的新 worktree 开发。
- 同一个 Agent Native 顺序执行，不切换代理。
- 每个 Task 测试通过后再提交，再进入下一项。
- Task 14 只部署 Staging；不在生产执行。
- Task 16（历史回填）不实施。
- Task 15（生产发布清单）不执行，不修改生产代码或生产数据库。
- 所有 Task 完成后先提交完整审核报告，等待用户确认后再讨论生产部署。
- 最终参数固定为 `cl`、`aid`、`adid` 三个；访问、商品浏览、加购、结账、
  订单、优化师核算和 AdID 报表使用同一份验签归因。
