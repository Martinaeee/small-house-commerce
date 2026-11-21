# 2026-11-21 新上架商品图片不加载 + 类目跳转慢：发布即预热图片缓存

## 现象

1. 新上架商品（P-000038 All-in-One Pet Feeding & Storage Station，11-21 13:56 上架）在手机上
   首图与详情图显示裂图（Safari 的 "?" 图标）。
2. 手机点类目跳转要等很久，期间显示带 LUWAG 字标的加载动画。

## 根因（两个问题同源）

Next 图片优化器的缓存里没有新商品的任何变体。首个手机访客并发请求 21 张
1254×1254 PNG 的 1280 宽变体，2 vCPU 机器上 sharp 转码排队：

- 访问日志实证（11-21 14:11，iPhone，IP 103.172.182.27）：队尾请求 **19 秒**；
  中途有 9 个响应体被截断（4096B / 69177B，Content-Length 应为 176260B 等）——
  Safari 等不及主动断流，收到残缺 WebP → 裂图。
- 同一时段客户端导航（RSC）请求 99.16% < 0.5s，但所有 >3s 的慢请求
  **全部**与 7–16 个并发图片转码重叠——CPU 被优化器占满，类目页 RSC 被挤到
  12.6 秒。

预热为何没覆盖到：

- 预热脚本只抓渲染 HTML 里的 `/_next/image` 链接，而详情折叠区只即时渲染前 4 个模块，
  13 张详情图里 9 张根本不在 HTML 中——每日 04:00 的预热也从未覆盖。
- 新商品 13:56 上架，距下一次每日预热还有 14 小时；cron 的"冷缓存"判断阈值
  （<100 个缓存文件才触发）在 3000+ 文件时永远不触发。

## 修复（生产 commit 716a115f，基线 e25415e2，无迁移）

1. **后台保存即预热**（`backend/src/common/image-warming.ts` + products.service 接线）：
   创建/更新（含媒体或上下架状态变更）/批量上架后，向
   `REVALIDATE_URL/_next/image` 请求该商品全部 IMAGE（含变体范围）在
   96/384/640/1280/1440 宽度的变体。宽度取自生产访问日志实测（1280 为主，
   750/1080/1200 为 0 请求）。fire-and-forget，失败只记 warn，不阻塞保存；
   REVALIDATE_URL/SECRET 未配置时为 no-op。
2. **预热脚本补详情图**（`deploy/luwag-warm-image-cache.sh`）：除抓 HTML 外，
   再从商品 API 的 `images`+`detailBlocks` 构造全部变体 URL；PRODUCT_LIMIT 24→48。
   服务器上已安装至 `/usr/local/sbin/luwag-warm-image-cache.sh`。
3. **加载占位去 logo**（`StorefrontRouteLoading.tsx`）：不再渲染 LUWAG 字标
   （也不再请求品牌图），改为 200ms 延迟淡入的极简细条；
   `prefers-reduced-motion` 下静止。

## 验收

- 单测：后端 image-warming 10 例 + 写入路径接线 7 例；前端加载占位 3 例。
  全量后端 2775 通过（1 个既有日期过期用例失败，与本改动无关）；
  前端 3886 通过（HomepageEditor 在负载下 5s 超时的既有 flake，单跑仅 1 例超时且每次不同）。
- 部署后 `/usr/local/sbin/luwag-warm-image-cache.sh`：1960 个 URL，
  hits=1189 misses=771 errors=0，59s（慢速项为补转码，最长 6.3s）。
- 复测事故场景：21 张 1280 变体并发全部 HIT、响应体全部完整，3.4s 内完成。
- 后端容器 → `http://frontend:3000/_next/image` 预热桥 200 HIT。
- 真机视角（390×844 Playwright）滚动整页：57 张图，0 裂图。
- 关键页回归：首页/类目/合集/PDP/checkout/search/track-order 全部 200。

## 回滚

服务器 `cd /opt/small-house-commerce && git reset --hard e25415e2`，重新
`docker compose build backend frontend && up -d --no-deps --wait backend frontend`。
无数据库迁移，数据不受影响。
