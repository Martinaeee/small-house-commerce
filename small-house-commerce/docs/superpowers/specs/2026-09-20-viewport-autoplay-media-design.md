# Viewport Autoplay Media 设计

日期：2026-09-20
状态：已确认，待统一实施计划
依赖：`2026-09-20-variant-options-media-design.md`
关联：`2026-09-20-pdp-inline-cod-order-design.md`
范围：商品 Gallery、详情、Lightbox、评论、商品卡与现有 Homepage Hero 的视口自动播放

## 1. 背景

当前视频行为不一致：

- Homepage Hero 已使用 muted/loop/playsInline 自动播放；
- PDP Gallery 主区域只显示第一帧和播放标识，必须进入 Lightbox；
- Product Detail 明确禁止自动播放；
- Lightbox 仅显示 controls；
- 评论只支持 `photos: string[]`，没有视频数据模型；
- ProductCard/PlpProductCard 总是渲染 `<img>`，即使 ProductImage.type=VIDEO；
- Related Products、Recently Viewed、类目、集合和搜索因此无法正确显示商品封面视频；
- 没有共享的 IntersectionObserver 播放协调器。

目标是在视频进入顾客视口时自动播放，同时控制流量、性能、浏览器限制和无障碍风险。

## 2. 已确认决策

1. 覆盖 PDP Gallery、Product Detail、Lightbox、Reviews、首页/类目/集合/搜索/Related/Recently Viewed 商品卡，以及现有 Homepage Hero。
2. 暂不为 Category Tile、Room Scene、UGC、Product Story 等纯营销模块新增视频字段。
3. 所有自动播放默认 muted + playsInline。
4. Gallery、商品卡和 Hero 属于短展示视频：自动播放、循环、离开暂停。
5. Product Detail 和 Review 属于长内容视频：自动播放一次、不循环、保留 controls。
6. 同屏只播放可见度最高的一条视频。
7. `prefers-reduced-motion` 或 Save-Data 下不自动播放，显示 poster + play。
8. 每个视频支持 poster；非当前视频不下载完整内容。
9. 评论媒体升级为 IMAGE/VIDEO 结构化模型。
10. 自动播放失败必须静默回退，不产生 console error。

## 3. 目标

### 3.1 顾客目标

- 滚动到商品视频时无需先点播放；
- 离开视频后不继续消耗资源；
- 详情和评论视频可暂停、开声和拖动；
- 多视频页面不会同时播放造成干扰；
- 慢网、Data Saver 和 reduced motion 下仍可正常浏览 poster；
- 视频封面、商品变体和评论来源清楚。

### 3.2 运营目标

- 商品短视频在 PDP 和列表页自动获得曝光；
- 广告落地页视频首帧与变体素材一致；
- 评论可上传真实使用视频；
- 衡量视频开始、完成、手动开声和与购买转化的关系；
- 不以 LCP、流量或跳出率恶化换取表面播放次数。

### 3.3 工程目标

- 所有页面使用同一播放状态机；
- observer、document visibility、play promise 和 cleanup 只实现一次；
- ProductImage.type 在所有商品卡中得到正确处理；
- 与变体媒体 resolver 共用 effective media；
- 评论图片迁移不丢失；
- server components 只传媒体数据，播放控制集中在小 client island；
- 可单元测试和浏览器验证。

## 4. 非目标

本期不做：

- 带声音自动播放；浏览器不会稳定允许；
- Category Tile/Room Scene/UGC/Product Story 视频 CMS；
- 自动视频转码、压缩或自适应 HLS；
- 自动从任意视频生成 poster；
- 同时播放多个可见视频；
- 背景标签页继续播放；
- 把视频播放当作 Meta 标准转化事件；
- 为每个媒体新建独立详情页；
- 更改现有视频上传 100MiB 上限。

## 5. 媒体类型与播放模式

统一模式：

```text
TEASER
CONTENT
LIGHTBOX
HERO
```

### 5.1 TEASER

适用：

- PDP Gallery 当前主媒体；
- 首页/类目/集合/搜索商品卡；
- Related Products；
- Recently Viewed。

行为：

- 进入视口自动 muted play；
- loop=true；
- controls=false；
- 提供自定义 Pause/Play 按钮；
- 离开暂停，回来继续；
- 点击商品卡仍导航商品；
- Gallery 提供独立 Expand/Lightbox 动作；
- 缩略图不播放。

### 5.2 CONTENT

适用：

- Product Detail 视频；
- Review 视频。

行为：

- 进入视口 muted play；
- loop=false；
- controls=true；
- 离开暂停，回来继续；
- 播放结束后保持末帧和 replay 能力；
- 用户可通过 controls 开声；
- 不因再次滚入自动从头循环。

### 5.3 LIGHTBOX

- Lightbox 打开且该项为 VIDEO 时 muted play；
- controls=true；
- loop=false；
- 切换媒体暂停旧视频；
- 关闭停止并释放 active registration；
- 用户点击打开属于手势，但仍默认 muted，不突然出声；
- 手动开声只影响当前视频。

### 5.4 HERO

- 延续 muted/loop/playsInline；
- 加入 viewport pause、document visibility 和 reduced-motion/Save-Data fallback；
- 桌面和移动端使用同一政策；
- 移动端是否有 video URL 决定是否播放，无视频或受保护模式使用 poster/image；
- 不预加载页面下方视频。

## 6. 数据模型

### 6.1 ProductImage

现有 ProductImage 已有 type/url/altText/sortOrder，并由变体规格增加 optionValueId/variantId。新增：

```text
posterUrl String?
```

适用 Gallery 和商品卡。IMAGE 类型忽略 posterUrl。VIDEO 缺 poster 时允许兼容现有数据，但后台显示警告，前台回退浏览器首帧或视频占位。

### 6.2 ProductDetailBlock

新增：

```text
posterUrl String?
```

type=VIDEO 时供 CONTENT 模式使用。

### 6.3 ProductReviewMedia

新增表：

```text
id
reviewId
type          IMAGE | VIDEO    // 复用现有 DetailBlockType
url
posterUrl     nullable
altText       nullable
sortOrder
createdAt
updatedAt
```

关系：

- ProductReview 1:N ProductReviewMedia；
- 删除 review 级联删除 media rows；
- 删除数据库行不自动删除对象存储文件；
- URL 使用现有 site media validation；
- `type=IMAGE` 时 posterUrl 必须为空或忽略；
- `type=VIDEO` 缺 poster 允许迁移兼容但后台警告；
- Storefront serializer 继续扩展现有 `StorefrontReviewShape/serializeReview`，不能新增一套丢失 verified/helpful/date 语义的 mapper。

### 6.4 评论迁移

现有 `ProductReview.photos String[]` 采用一个有明确结束时间的兼容窗口：

1. 创建 product_review_media；
2. 每个 photos[index] 插入 IMAGE、sortOrder=index；
3. compatibility backend 的 `serializeReview` 始终同时返回结构化 `media` 和由当前 IMAGE rows 按 sortOrder 投影的 legacy `photos`；尚未 backfill/由旧写入产生时，先把 photos 投影为 IMAGE media，因此旧 frontend 在 backend-first 阶段继续显示图片，新 frontend 读取 media；
4. create/update/batch endpoint 同时接受旧 `photos` 和新 `media` payload：只有 `photos` 时只替换/重排 IMAGE rows，并原样保留现有 VIDEO rows；只有显式 `media` payload 才能新增、修改、排序或删除 VIDEO；
5. 兼容窗口内每次 media 写入后，事务内把按 sortOrder 的 IMAGE URLs 投影回 legacy photos；VIDEO 无法投影，但不得被旧 payload 删除；
6. 后台评论页和批量工具切到 media；
7. 使用 backfill watermark/audit 确认 review 数量、IMAGE URL 与顺序一致；
8. 所有 clients 稳定一个发布周期后，先停止 dual-write、做最终审计，再单独 migration 删除 photos。

这是一段有界迁移机制，不是永久双真相。回滚窗口内保证新建/编辑图片不丢，旧客户端不能误删自己不认识的 VIDEO；Review VIDEO 在旧应用中不可见但数据库行不丢，恢复新版本后重新显示。

### 6.5 API 类型

Product media 和 detail blocks 增加 `posterUrl`。Review：

```text
media[] = {
  id,
  type,
  url,
  posterUrl,
  altText,
  sortOrder
}
```

前端不再依赖 `review.photos`。Admin create/update/batch 输入同步接受 media；Storefront 只返回 visible review media。

## 7. 后台媒体编辑

### 7.1 Product Gallery/Detail

VIDEO 卡片增加：

- video URL/upload；
- poster URL/upload；
- poster preview；
- alt/accessibility label；
- autoplay mode 只读提示，由所在区域决定；
- 缺 poster warning；
- 上传视频成功后可继续上传 poster；
- 不在浏览器后台同时播放多个 admin preview。

poster 可以：

- 上传独立 JPG/PNG/WebP；
- 选择同一套图中的 IMAGE 作为 URL；
- 暂无自动截图。

### 7.2 Review Admin

单条评论与 batch dialog 的 `photos` 改为 media slots：

- Add image；
- Add video；
- 视频 poster；
- 顺序；
- 删除；
- 上传状态；
- 类型具名错误；
- 最大媒体数量沿用或明确现有 6 项上限；本设计统一为最多 6 项 IMAGE/VIDEO 总和。

Verified Purchase 仍只来自真实订单，不能因支持视频而允许伪造。

## 8. ViewportVideo 组件

### 8.1 公共 API

概念接口：

```text
ViewportVideo
- id
- src
- poster
- label
- mode: TEASER | CONTENT | LIGHTBOX | HERO
- active?: boolean
- className
- onExpand?
```

组件内部：

- video ref；
- observer registration；
- muted state；
- manualPause state；
- completed state；
- play promise catch；
- cleanup；
- controls/loop/preload 根据 mode 派生。

不得让调用方重复传互相矛盾的 autoPlay/loop/controls 组合。

### 8.2 单一全站协调器

Storefront root layout 挂载唯一 `ViewportPlaybackProvider`。Hero、PDP、Lightbox、Reviews、商品卡全部注册到该 Provider；不得同时保留 module singleton、局部 Provider 或 Hero 私有 autoplay policy。Admin preview 不加入 Storefront coordinator，也不自动播放。

每个 mounted player 使用 Provider 生成的唯一 `instanceToken`，媒体业务身份另存 `mediaId`：

```text
instanceToken          每次 mount 唯一，Lightbox/Gallery 同一 media 也不冲突
mediaId
videoElement
mode
realViewportRatio
preloadNear
manualPaused
manualPlayIntent
active
commandGeneration
sourceGeneration
```

同一 media 在 Gallery、Lightbox、多个 ProductCard 出现时各有独立 instance；unregister 只能删除自己的 token。比例相同用实际 DOM 节点 `compareDocumentPosition` 或调用方稳定 layout index 决胜，不能用 Strict Mode 会改变的 registration time。

### 8.3 自动 winner 与手动 override

自动候选条件：

1. document visible；
2. 未启用 reduced motion/Save-Data；
3. realViewportRatio >= 0.6；
4. active=true；
5. 非 manualPaused；
6. ratio 最大，tie 按稳定 DOM/layout 顺序。

用户点击 Play 产生 `manualPlayIntent`：

- 可以绕过 reduced-motion、Save-Data 和 0.6 自动阈值，因为这是明确用户手势；
- 仍必须通过同一 Provider 获得全站唯一 winner，先暂停旧 winner；
- 离开真实视口、document 变为 hidden、手动 pause、ended、unmount 或**媒体身份/source prop 改变**时释放 override；
- 为同一媒体在 Save-Data/manual Play 时挂载此前缺失的 DOM `src` 只是资源加载，不属于 source identity change，不得误清刚产生的手动意图；
- document 恢复 visible 后不得恢复旧 manual intent，受保护模式必须等待新的用户手势；正常模式只按当前真实 viewport 条件重新竞选自动 winner；
- 不允许绕开 coordinator 直接与另一视频并播。

LIGHTBOX active instance 拥有最高优先级；打开时背景全部暂停，关闭后重新选自动 winner。

### 8.4 两类可见性信号

不能用一个带 rootMargin 的 observer 同时做预加载和播放判断。

- Playback observer：`rootMargin: 0`，thresholds 至少 0、0.25、0.6、0.75、1；它的 ratio 是唯一 autoplay eligibility；
- Preload observer：可用 `rootMargin: 300px 0px`，只产生 `preloadNear`，永不参与 winner；
- 两者可分别共享实例，不能每条视频各建 observer；
- unmount/route change 必须按 instanceToken cleanup；
- Strict Mode 双挂载不得留下 entry。

### 8.5 模式化资源加载

```text
TEASER card far/near   → poster only，DOM 中不渲染 src/source
TEASER card winner     → 挂 src 后 play；离开真实视口 pause、remove src、load() 释放 buffer/decoder
Gallery active/current → 可 preload=metadata；非 current 不挂完整 src
CONTENT near           → 挂 src/preload=metadata
CONTENT winner/manual  → play；离开 pause 并保留 currentTime
LIGHTBOX active        → 立即挂 src，关闭释放
unmounted/source change→ pause、generation++、remove source/cleanup
```

列表卡不因进入 300px preload margin 就挂 src；最多 winner（实施若证明必要，可加一个明确 warm successor）加载视频。CONTENT/Gallery 才使用 near-viewport metadata。`preload="none"` 只是提示，不能替代真正省流量所需的“未挂 src”。

### 8.6 命令与事件同步

Coordinator 调用 `play()/pause()` 时标记 command origin/generation。原生 play/pause 事件只有在非 coordinator command 时才更新 manual intent：

- winner 切换导致的 programmatic pause 不得把旧视频记成 manualPaused；
- 用户 controls pause 才设置 manualPaused；
- 用户 controls play 设置 manualPlayIntent；
- source 每次变化递增 sourceGeneration；
- 每次 play attempt 捕获 instanceToken、sourceGeneration、commandGeneration；Promise resolve/reject 时若任一已变化则忽略，不能把旧视频 AbortError 标到新 source；
- play reject 回退 poster/Play，不记录 console error。

### 8.7 手动控制

- manual Pause 持续到顾客再次 Play；
- unmute 属于用户手势，只对当前 instance；
- 当前视频失去 winner 后暂停，不把声音迁移到下一条；
- 新视频自动播放始终 muted；
- CONTENT 原生 controls 与 Provider 通过上面的 origin/generation 协议同步。

## 9. 浏览器保护模式

### 9.1 Autoplay policy

所有自动调用 `play()` 前确保：

- muted=true；
- playsInline=true；
- element 已有可播放 source；
- catch NotAllowedError/AbortError；
- 失败时保持 poster 和 Play 控件；
- 不记录 console error。

带声音自动播放不支持，也不尝试规避浏览器策略。

### 9.2 Reduced motion

`prefers-reduced-motion: reduce`：

- 不调用自动 play；
- poster + Play；
- 顾客手动播放仍允许；
- 循环动画不自动启动。

### 9.3 Save-Data

`navigator.connection?.saveData === true`：

- 不自动加载视频 src；
- poster + Play；
- 点击后挂载 src 并播放；
- 无 Network Information API 的浏览器按正常策略。

### 9.4 Page visibility

`document.visibilityState !== "visible"`：

- 立即暂停所有视频；
- 清除 manualPlayIntent/手动 override，使受 reduced-motion/Save-Data 保护的视频恢复可见后不会自行续播；
- 回到 visible 后只根据当前真实 observer 状态和 autoplay policy 重新选择自动 winner，不无条件恢复旧视频；若顾客仍希望受保护模式播放，必须再次点击 Play。

## 10. PDP Gallery 与 Lightbox

### 10.1 Gallery 主区域

当前 video 嵌套在“打开 Lightbox”的 button 中。加入播放控制后必须重构，避免 button 内嵌 controls/button：

- media stage 改为语义 div；
- ViewportVideo 独立；
- Expand/Open gallery 为单独 overlay button；
- Play/Pause 为独立 button；
- 键盘可分别操作；
- VIDEO 当前项使用 TEASER；
- 切换 thumbnail 暂停旧 media 并重置 active resolver；
- 变体套图切换按变体规格重置 gallery index。

### 10.2 缩略图

- IMAGE：img；
- VIDEO：poster img + video badge；
- 无 poster：视频占位 + badge；
- 永不自动播放 thumbnail；
- alt/aria label 包含 media index 和 video 类型。

### 10.3 Lightbox

现有 desktop/mobile Lightbox 均改用 LIGHTBOX mode：

- 当前项 active=true；
- 非当前视频不挂载完整 src 或保持 paused；
- 移动 swipe/observer 更新 index 后切 winner；
- desktop arrows/keyboard 同步；
- 关闭释放优先权并恢复页面候选。

## 11. Product Detail

ProductDetailBody 的 VIDEO 改用 CONTENT mode：

- poster；
- controls；
- muted default；
- plays once；
- viewport pause/resume；
- full-width 保持；
- 多个详情视频同屏只播最显眼一个；
- altText 作为 accessible label；
- 无 JS/保护模式下仍可手动播放。

当前“Never autoplay”注释和相关规格同步更新，明确新政策取代旧决定。

## 12. Review Media

### 12.1 布局

评论图片保持缩略图/Lightbox行为；视频不能塞进现有 64×64 缩略图自动播放。建议：

- 有一个 VIDEO 时，在评论文字下显示最大宽度约 360px 的 16:9 CONTENT player；
- 多媒体按 sortOrder：首个 VIDEO 为主 player，其他媒体作为可选 thumbnails；
- 点击 IMAGE 打开 review lightbox；
- 点击其他 VIDEO thumbnail 切主 player；
- 移动端宽度 100%；
- 视频仍属于具体 review，不进入产品 Gallery。

### 12.2 播放

- Review player 进入视口自动 muted play once；
- controls=true；
- 离开暂停；
- helpful/report 操作不受播放状态影响；
- 评论卡卸载立即 unregister；
- 不自动播放不可见分页/折叠评论。

## 13. 商品卡与列表页

### 13.1 Effective cover

商品卡封面来自变体规格的 defaultDisplayVariant effective media first item：

- IMAGE → 现有图片卡；
- VIDEO → TEASER；
- 无 media → placeholder。

删除 variant index→image heuristic。

### 13.2 覆盖页面

共用 ProductCard/PLP media abstraction：

- homepage product grids；
- category；
- collection；
- search；
- Related Products；
- Recently Viewed；
- Quick Add header image/video poster。

Quick Add 内不播放视频，只显示 effective poster/thumbnail，避免 drawer 与背景争抢。

### 13.3 卡片交互

- video 本身不吞掉商品链接点击；
- 自定义 Pause/Play 是独立按钮；
- 避免 button/anchor 非法嵌套；
- hover 不是播放必要条件；触屏滚动同样生效；
- 卡片离开视口暂停；
- grid 中只播 ratio 最高一条；
- ProductCard server component 只保留数据/layout，媒体可用小 client island，避免整卡客户端化。

## 14. Homepage Hero

现有 Hero 必须把内联 `<video>` 替换为同一个 `ViewportVideo` HERO mode，并注册到 Storefront root `ViewportPlaybackProvider`；不允许保留“兼容但独立”的播放实现：

- Hero 在首屏通常赢得播放；
- 滚离后暂停，让商品卡/详情候选接管；
- mobile 有 video 时按 HERO 播放；
- reduced motion/Save-Data 使用 poster/image；
- 保留文字 CTA 可点击性；
- 不因 Hero 播放阻止页面下方视频在滚动后接管。

## 15. 性能预算

### 15.1 网络

- 页面初始只下载首屏 winner 的必要视频数据；
- TEASER 商品卡保持 poster-only，只有 winner 挂 src，离开后强制 remove src/load() 释放 buffer/decoder；
- CONTENT/Gallery 才允许独立 preload observer 在近视口加载 metadata；
- 其他视频 poster 优先；
- 非当前 variant galleries 不加载文件；
- Review 后方媒体保持 lazy；
- 列表页不为每卡 preload metadata；
- poster 使用缩略尺寸而非原始大图；
- 视频继续走站内 uploads/R2 URL abstraction。

### 15.2 CPU/GPU

- 同时最多一个 autoplay video；
- TEASER paused/far-offscreen 必须卸载 src 并释放 decoder；CONTENT 暂停可保留 currentTime；
- hidden document 全停；
- unmounted media release；
- 不用多个独立 observer；
- 不在 64px thumbnails 解码视频。

### 15.3 Core Web Vitals

- Poster 可作为稳定尺寸占位，避免 CLS；
- 商品卡 aspect ratio 固定；
- Hero poster 优先参与 LCP；
- autoplay 不能阻塞 hydration；
- client island 尽量局部；
- 上线前分别测移动 Fast 3G/Slow 4G 和 desktop。

性能验收预算由实施计划结合现有 Lighthouse baseline确定，不在设计中虚构数值门槛；必须至少证明无明显 LCP/CLS 回归和非当前视频无批量下载。

## 16. 可访问性

- 自动播放超过 5 秒必须提供 Pause；
- Play/Pause 有可见或 focus-visible 控件与 aria-label；
- muted 状态明确，controls 可开声；
- 不仅靠动态图传达商品信息；
- poster/alt/label 描述内容；
- reduced motion 尊重系统偏好；
- 键盘可打开 Lightbox、切媒体、播放/暂停；
- controls 不嵌套在 button/anchor；
- focus 不因 winner 切换而移动；
- 播放状态变化不使用干扰性 live announcement；
- 视频失败仍显示可理解的 poster/placeholder。

## 17. 追踪

视频事件用于内部分析，不冒充 Meta 标准购买事件：

```text
video_autoplay_start
video_manual_play
video_pause
video_unmute
video_complete
```

属性：

```text
media_id/url_key
product_id
variant_id?
review_id?
placement
autoplay/manual
current_time
duration?
```

规则：

- autoplay start 每 media/placement/session 最多一次；
- observer 抖动不重复刷事件；
- complete 只对 CONTENT/LIGHTBOX 或真正完成的非循环播放；
- TEASER loop 不每轮发 complete；
- 不把仅加载 poster 记为播放；
- tracking 失败不影响播放。

## 18. 迁移与部署

### 18.1 数据库

加性迁移：

- ProductImage.posterUrl；
- ProductDetailBlock.posterUrl；
- ProductReviewMedia table。

回填 review photos。兼容窗口由 backend 事务内双写 IMAGE projection 和 dual-read fallback 保证旧/新客户端交错安全；VIDEO 只存在 ReviewMedia，旧版本回滚时隐藏但不丢数据。确认所有 clients、backfill watermark 和审计稳定后，单独发布停止 dual-write并最终删除 photos；不在同一发布中强删。

### 18.2 部署顺序

1. 生产备份，应用 Product poster/ReviewMedia additive migration，执行 Prisma generate/build；
2. compatibility backend：旧 photos/new media 输入均可接受，IMAGE dual-write、dual-read fallback；
3. set-based backfill 与 URL/order audit；
4. admin review/product media editor；
5. Storefront root ViewportPlaybackProvider 与 shared ViewportVideo；
6. PDP Gallery/Detail/Lightbox；
7. Reviews；
8. ProductCard/PLP/Related/RecentlyViewed 和 Hero；
9. browser/performance/accessibility 验收；
10. 生产真实媒体冒烟；稳定期后另发 cleanup migration。

### 18.3 回滚

- 新表/列加性，不影响旧 app；
- 兼容窗口内 IMAGE 写入同步投影到 photos，旧 frontend/backend 回滚仍看到最新图片；
- Review VIDEO 在旧前端不显示，但 ReviewMedia rows 保留，forward fix 后恢复；
- 前端回滚后 Product VIDEO 恢复当前 first-frame/lightbox 行为；
- 播放协调器可前端单独回滚；
- 不删除媒体文件；
- 停止 dual-write/删除 photos 后不再承诺回滚到 media-unaware backend，故障处理使用 forward fix 或先 reverse-backfill。

## 19. 测试策略

### 19.1 数据/API

- ProductImage/DetailBlock poster round-trip；
- Review photos 全量迁移为 IMAGE media，兼容窗口 IMAGE dual-write/dual-read 和 watermark audit；
- IMAGE/VIDEO DTO；
- media max 6；
- invalid URL/type；
- sort order；
- admin create/update/batch；
- storefront visible reviews；
- Verified Purchase、Helpful、Report 回归。

### 19.2 播放状态机

- playback observer real ratio <0.6 不播，preload observer rootMargin 不影响 winner；
- real ratio >=0.6 自动播；
- 两候选择最大，tie 使用稳定 DOM/layout order；
- 同 media 多 instance（Gallery/Lightbox/cards）不互相覆盖/unregister；
- winner 变化先以 coordinator command 暂停旧，不能误记 manualPaused；
- leave pause/re-enter resume；
- manual pause 持续；
- reduced motion/Save-Data 自动禁用但 manualPlayIntent 可获得唯一 winner；
- stale play promise/source generation 不污染新媒体；
- play reject fallback；
- document hidden；
- TEASER far-offscreen remove src/释放资源；
- CONTENT 保留 currentTime；
- unmount cleanup；
- Strict Mode 无重复 registry；
- Lightbox priority；
- Hero 与其他 placement 共用唯一 root Provider。

### 19.3 组件

- Gallery IMAGE/VIDEO；
- thumbnails poster only；
- variant media switch；
- Detail play once；
- Review media layout；
- ProductCard type-aware；
- Related/RecentlyViewed；
- Hero fallback；
- valid DOM without nested controls；
- keyboard and ARIA。

### 19.4 浏览器验收

至少 Chrome desktop、Safari/WebKit、移动 viewport：

1. Gallery 主视频滚入自动播、滚出暂停；
2. 详情长视频一次播放；
3. 评论视频一次播放且 controls 正常；
4. 同屏两视频只播一个；
5. Gallery→Detail winner handoff；
6. Lightbox priority/close restore；
7. 首页→商品卡 handoff；
8. 类目/集合/搜索/Related/Recently Viewed；
9. muted autoplay 与手动开声；
10. reduced motion；
11. Save-Data 可通过 mock/浏览器 context 验证；
12. background tab pause；
13. Slow 4G 不批量下载；
14. 0 autoplay promise console error；
15. Lighthouse/Performance trace 无明显回归。

## 20. 成功标准

- 指定范围的视频进入视口无需点击即可开始；
- 所有自动播放默认静音；
- 短视频循环、长视频一次播放；
- 同屏最多一条播放；
- 离开/后台暂停；
- reduced motion/Save-Data 正确回退；
- 评论视频数据和后台编辑完整；
- 商品卡正确识别 VIDEO，不再用 img 打开视频 URL；
- 变体有效媒体与 autoplay 一致；
- 无批量视频预载、无明显 Core Web Vitals 回归；
- 有暂停能力和键盘可达；
- 现有图片、评论、Helpful/Report、Hero、Lightbox 无回归。
