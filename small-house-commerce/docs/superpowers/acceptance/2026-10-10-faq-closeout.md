# FAQ 收尾验收 — 2026-10-10

## 结论与边界

**FAQ 的商品题复制与部分商品共享已完成本地实现和验收，尚未发布到生产。**

本轮不重做 FAQ 管理页布局，不复制 ProductFaq 数据，不修改商品、SKU、库存、订单或投放业务。与规格/包装会话错开共享文件编辑；完整测试数字来自两条工作线共用的当前树，不代表所有测试均由 FAQ 新增。

继承规则沿用此前约定：CUSTOM 仍只展示商品自己的问题；指定共享不会自动改变商品模式。界面明确说明这条规则，并标出 CUSTOM 候选商品。新增范围存在共享题目的 JSON 中，与题目内容共用 expectedVersion；本轮扩展不用新迁移，FAQ 基础迁移/权限初始化仍待生产发布。

## 需求对应的验收

| 原要求/边界 | 实现及证据 |
|---|---|
| 每行 More 都有 Duplicate | Shared/Product 均有；复制打开 Dialog，保存前不写库。新 UUID、复制后缀、内容/状态/defaultOpen 保留；商品题追加在末尾，完整组保存并携带原版本。取消不写入、冲突保留草稿、最长共享题标题复制均有单测。真实商品复制 E2E 通过。 |
| 全部商品或部分至少两个商品 | 每题 ALL / PRODUCTS；后台搜索、多选、缩略图、分页、已选移除与名称回填。零个/一个商品不能保存；后端拒绝重复/无效/不存在的商品 ID。ALL 包括未来新增且继承共享的商品，旧题没有 audience 仍等价 ALL。 |
| 前台只展示适用共享题 | 公共商品投影把实际 Product ID 传入唯一 resolver；所选两个商品显示定向题，第三个继承共享的对照商品不显示。Product Editor 共享预览也按自己的 ID 过滤；CUSTOM 排除所有共享。公开响应不带 audience/productIds。 |
| 不复制数据、不改变并发语义 | 仍是单例 SharedFaqSet 和每商品一个 ProductFaq。共享题保存完整库，不保存筛选子集；范围变更更新该题服务器时间，重排所选 ID 不更新时间。商品题写入剥离共享分类/范围元数据。 |
| 保留权限隔离 | 选品端点位于共享 FAQ 权限下，只返回商品 ID、名称、编码、slug、状态、缩略图和 FAQ 模式。没有复用完整商品管理响应，不暴露 SKU/成本，也不授予 PRODUCT_MANAGE。鉴权/权限元数据与投影测试通过。 |
| 筛选/汇总/密度 | 商品筛选也限定共享题范围；列表显示全部商品或指定数量，仍是两行紧凑展示。应用商品数按至少命中一道启用共享题的 ACTIVE、非 CUSTOM 商品去重；不是选中 ID 数。 |
| 手机可操作 | 390×844 验收：页面没有横向溢出，题目表格在本地容器横向滚动（343px容器/720px表格）。新增范围 fieldset 的默认最小宽度导致弹窗溢出，已用实际 Chromium RED→GREEN 回归修复；修复后弹窗 clientWidth/scrollWidth 均342px，保存/取消可达。未改全站 Dialog。 |
| 不影响其他工作线/服务 | 不编辑 ProductForm/规格助手/包装逻辑；只协调追加 FAQ 文案。用户3000/3001服务未重启。浏览器使用隔离3210/3211和测试库 small_house_variant_test；测试自己的FAQ变更在 finally 恢复，未操作同伴的 rehearsal 库。 |

## 最终门禁（当前树实际运行）

| 检查 | 结果 |
|---|---|
| 前端 pnpm test | **140文件 / 1391测试通过** |
| 后端 pnpm test | **70文件 / 998测试通过**；revalidation 失败场景测试会输出两条预期 WARN |
| FAQ Chromium E2E | **4/4通过，最终9.5s**：同源编辑/保存、定向共享、390px弹窗、商品复制 |
| 前端 tsc --noEmit | **exit0** |
| 前端完整 eslint（无临时目录 ignore） | **exit0，0 errors，1条既有warning**：admin-i18n 的 readStored 未使用 |
| 后端完整 lint | **exit0，2条既有warning**：collections controller 未使用导入、orders spec 空spread fallback |
| 前端生产构建 | **exit0，32个静态页面** |
| 后端构建 | **exit0** |
| 后端完整 tsc --noEmit | **exit2，仍有18条既有测试文件诊断，FAQ相关0条** |
| git diff --check | **exit0** |
| 浏览器管理页控制台 | **0 errors / 0 warnings**；见截图目录中的 console.md |
| 临时环境清理 | 隔离预览优雅停止；3210/3211均空闲；.e2e-isolated和backend-isolated均已移除；真实node_modules未删除 |

后端完整类型检查未通过的分布：RBAC permission reconciliation spec 1、auth spec 3、products.service spec 5、homepage controller spec 4、customer auth spec 4、app E2E spec 1。构建/单测通过不能替代这项发布门禁；本轮没有顺手修改这些无关测试。

## 验证过程中的限制与修正

- 首次直接用主前端目录启动 E2E 被已有3005开发服务的目录锁挡住；没有停止它，转用隔离复制。
- 前台定向题第一次验收未显示，API探针确认原因是公共商品调用 resolver 时漏传 Product ID；增加公共投影失败测试后修复并回归。
- 中文复制后缀实际为“（副本）”，E2E按真实中文界面验证，不按英文后缀硬编码。
- 手机溢出在经典滚动条浏览器上出现；无滚动条空间的headless首次未复现。回归测试保留滚动条占位后确认失败（345px内容/342px容器），修复后通过。
- 多次重跑触发测试后端真实登录限流429（10次/10分钟）。没有修改或关闭认证限流；最终重新启动本轮拥有的隔离后端，从干净环境完整4/4通过。
- E2E明确发送Cache-Control:no-cache，避免Next dev的HMR数据缓存粘连。API与前台/后台DOM分别断言；这不宣称已验证生产缓存失效配置。
- 截图验收临时复制测试SVG到隔离backend的uploads；最终随隔离目录清理，未改生产或真实媒体。
- 本轮最终核查由主会话完成，没有重启此前因API/stream故障失败的广泛多代理review；不将其描述为新的独立审查通过。

## 截图

- [桌面列表（1440px视口）](../../../../.playwright-mcp/faq-closeout-2026-10-10/desktop-list.png)
- [桌面指定商品编辑](../../../../.playwright-mcp/faq-closeout-2026-10-10/desktop-targeted-dialog.png)
- [390px指定商品编辑（保存/取消）](../../../../.playwright-mcp/faq-closeout-2026-10-10/mobile-targeted-dialog.png)
- [390px管理列表](../../../../.playwright-mcp/faq-closeout-2026-10-10/mobile-list.png)
- [商品问题复制菜单](../../../../.playwright-mcp/faq-closeout-2026-10-10/product-duplicate-menu.png)
- [控制台记录](../../../../.playwright-mcp/faq-closeout-2026-10-10/console.md)

截图在真实隔离测试库上拍摄，不是生产内容；桌面全页PNG宽度可能扣除浏览器滚动条。手机表格有意局部横向滚动，不应把720px表格宽度误判为页面溢出。

## 尚未完成的发布项

没有commit、push、merge、生产部署或生产数据库操作。当前工作树仍混有规格/包装/Bundle等改动；不能整树上线。FAQ发布需以实际生产版本整理独立范围、基础迁移/权限初始化、备份、Prisma generate、构建与生产冒烟/回滚；并处理或明确处置后端18条类型门禁。其他原始需求仍按[需求对账](2026-10-10-user-requirements-audit.md)保留，不因FAQ收尾而标记完成。
