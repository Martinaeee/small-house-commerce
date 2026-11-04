# 后台商品页 SKU 列 + 搜索缩略图：生产发布记录

日期：2026-11-04。

- 生产域名：https://luwag.shop
- 发布提交：`51b88e59`（基线 `f1eeec8`）
- 分支：服务器 `staging/luwag-shop-domain`；部署 ref `deploy/sku-search-20261104`
- 迁移：无（纯代码改动）
- 回滚镜像：
  - `small-house-prod-backend:rollback-pre-sku-search-20261104` → `b18f2e935512`
  - `small-house-prod-frontend:rollback-pre-sku-search-20261104` → `d82edfd7532d`

## 需求

1. 商品页显示 SKU（如气动桌 `TB001`）。
2. 搜索栏支持按 SKU 搜索并模糊匹配。
3. 全局搜索下拉结果带商品缩略图。

## 改动

- 前端商品列表「SKU」列：显示该商品各变体的 SKU 码，最多 2 个 + `+N` 余数，下面是变体数量；无 SKU 的商品只显示数量。
- 前端全局搜索下拉：产品命中项在名称前显示 36px 缩略图（首个共享图片），无图时给同尺寸占位块。
- 后端全局搜索（`/api/v1/admin/search`）：产品命中新增 `thumbnailUrl`；同时修正此前缩略图子查询只写进 `candidates` CTE、外层 SELECT 没带出的问题（真实数据下 `thumbnailUrl` 会整个缺失）。
- 后端后台商品列表搜索（`/api/v1/admin/products?search=`）：新增按变体 SKU 码部分匹配（`contains`，不区分大小写）。**仅后台**，前台商品搜索保持只匹配名称/别名，SKU 码属后台内部编号。

## 验收

| 检查 | 结果 |
| --- | --- |
| 后端单测 `src/modules/search` | 34/34 |
| 后端单测 `src/modules/catalog` | 773 passed / 61 skipped |
| 前端全量 | 3582/3582（`tsc --noEmit` 无输出） |
| 本地浏览器：商品页 SKU 列 | `E2E-CS-RED-S · E2E-CS-RED-M +2`，8 行渲染正常，无 pageerror |
| 本地浏览器：全局搜索 `cs-blue` | 命中 SKU_CODE 结果，缩略图 `src` 为真实共享图 |
| 本地浏览器：商品页筛选 `cs-blue` | 1 行，SKU 模糊匹配生效 |
| 生产 `GET /admin/products?search=SC007-6b` | 200，1 条 `Expandable Transparent Shoe Cabinet` |
| 生产 `GET /admin/products?search=6b` | 200，1 条（部分匹配，2 字符也生效） |
| 生产 `GET /admin/search?q=SC002-2` | 200，`SKU_CODE` 命中，`thumbnailUrl=/uploads/catalog/2026/f9fcdc78-….png` |
| 生产 `GET /admin/search?q=007-6b`（中段片段） | 200，`SKU_CODE|SC007-6b`，带缩略图 |
| 生产 `GET /admin/search?q=6b`（2 字符中段） | 空——全局搜索的 `contains` 仍是 ≥3 字符规则，短码请输入前缀（如 `SC007`）或到商品页筛选 |
| 生产页面 `/`、`/admin/products`、`/admin/search?q=SC007`、PDP | 全 200 |
| 容器 | backend / frontend / db healthy，caddy 正常 |

已知无关失败：全量后端套件有一次 `uploads.service.spec.ts › stores the transcoded bytes for a large mp4` 超时失败，单独跑该文件 12/12 通过，属并行负载下的转码计时抖动，与本次改动无关。

## 回滚

纯代码、无迁移：把两个 `rollback-pre-sku-search-20261104` 镜像重新打成对应仓库的 `latest` 并 `up -d` 即可。

```bash
docker tag small-house-prod-backend:rollback-pre-sku-search-20261104 small-house-prod-backend:latest
docker tag small-house-prod-frontend:rollback-pre-sku-search-20261104 small-house-prod-frontend:latest
cd /opt/small-house-commerce/small-house-commerce
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend frontend
```
