# Homepage BEFORE baseline — Visual Homepage Builder P1 (Task 0)

Frozen record of the homepage editor + storefront hero as they exist **before**
the Visual Homepage Builder P1 changes. Task 22 (final acceptance) compares
against these artifacts; the implementation tasks replace the admin homepage
editor and the storefront hero, so this directory is the only record of the
current state.

## Environment

| Item | Value |
| --- | --- |
| Capture time (Asia/Manila, UTC+8) | 2026-09-27 19:13–19:19 PST |
| Worktree HEAD (branch `feature/homepage-builder`) | `3ac6cdff08786a98929bb87ba11ef1382cfaff07` |
| Production HEAD (`/opt/small-house-commerce/small-house-commerce`) | `1f62c08d9dc28686dfa894318c0a7e6fc91f2b58` |
| Storefront origin | `http://43.135.75.99/` (production, read-only) |
| Admin screenshots source | **local isolated E2E stack** (`localhost:3211` + `127.0.0.1:3210` backend, disposable DB `small_house_variant_test`), same code as production — never the production admin |

No production writes, orders, or login-state changes were made. The production
access was read-only: public storefront pages + one read-only SQL query over
SSH.

## Inventory

| File | Size | Dimensions (px) | What it shows |
| --- | --- | --- | --- |
| `storefront-1440.png` | 7,872,846 B | 2850×8580 (1440 px viewport × DPR 2; content 1425 CSS px = viewport minus 15 px scrollbar, full page) | Production homepage, desktop: full nav bar, hero "Small Space. Big Luwag.", trust badges, Shop by Category / Small-Space Favorites (both "coming soon"), Made For Real Small Spaces, Shop by Solution (6 tiles), Small Upgrades, Room Inspiration, UGC testimonial, brand story, confidence, footer |
| `storefront-768.png` | 3,610,364 B | 1506×8054 (768 px viewport × DPR 2; content 753 CSS px, full page) | Same page at tablet width: hamburger header, 2-col trust badges, 2-col solutions grid |
| `storefront-390.png` | 3,064,612 B | 780×10886 (390 px viewport × DPR 2, mobile emulation, full page) | Same page at mobile width: single column, mobile bottom nav |
| `admin-homepage-list.png` | 594,252 B | 1440×6390 (full page) | `/admin/homepage` list state: "首页装修 (12)" header + 保存发布, collapsed preview details, 添加新区块 toolbar, and all 12 section cards (主视觉 Hero, 信任承诺条, 分类瓷砖, 商品网格 ×2, 商品故事 ×2, 方案入口, 房间灵感, 真实买家秀, 品牌故事, 购买保障) |
| `admin-homepage-edit.png` | 68,919 B | 1136×591 (HERO card element) | One expanded section-edit state: the 主视觉 Hero card with 区块标题/副标题, desktop/mobile image URL fields, video URL + poster fields, and both CTA text/link pairs |
| `legacy-homepage-snapshot.json` | 9,504 B | — | Read-only production DB dump of `homepage_sections` (12 rows) + `homepage_section_products` (4 joins) |

SHA-256 (first 16 hex) for integrity: `storefront-1440` `eda5f76017fb8d60`,
`storefront-768` `35ef82b4ce3cb592`, `storefront-390` `0943eb258516a872`,
`admin-homepage-list` `fb97411d3dda9d71`, `admin-homepage-edit`
`b7e74c112268dce4`, snapshot `804c543127a9f7ba`.

## Legacy snapshot

- Valid JSON (`JSON.parse` verified), top-level keys `sections` and `products`.
- **12 sections**, sort orders 0–110: HERO, USP, CATEGORY_TILES, PRODUCT_GRID
  ("Small-Space Favorites"), PRODUCT_STORY ("Made For Real Small Spaces"),
  SOLUTIONS ("Shop by Solution"), PRODUCT_STORY (disabled in production),
  PRODUCT_GRID ("Small Upgrades"), ROOM_INSPIRATION, UGC ("Real Homes"),
  BRAND_STORY, CONFIDENCE.
- 4 product joins, all on the "Small-Space Favorites" grid (badges: new
  arrival ×2, best seller ×2).
- Notable pre-existing content captured as-is: the UGC testimonial
  `daady / "googgooggoog…"` (production test data).

## Exact commands used

Storefront screenshots — Chrome DevTools MCP browser, new page on
`http://43.135.75.99/`, CDP viewport emulation (window-size independent),
`fullPage: true` per viewport:

- `emulate viewport "1440x900x2"` → reload → screenshot `storefront-1440.png`
- `emulate viewport "768x1024x2"` → reload → screenshot `storefront-768.png`
- `emulate viewport "390x844x2,mobile,touch"` → reload → screenshot
  `storefront-390.png` (verified `innerWidth=390`, `DPR=2` in-page)

Admin screenshots — local isolated stack via the repo Playwright E2E harness
(the config auto-starts its own backend :3210 + frontend :3211 and migrates /
seeds the disposable `small_house_variant_test` database; it never touches
production). A throwaway spec `e2e/_homepage-before.spec.ts` opened
`/admin/homepage` with a stored-session zero-login admin context
(`e2e-admin@smallhouse.test` refresh token seeded into
`localStorage["sh_admin_refresh"]`, same pattern as
`openEditorWithStoredSession()`), asserted 12 section cards rendered, then
captured the list (full page) and the HERO card element. Exact command:

```bash
pnpm --dir small-house-commerce/frontend exec playwright test e2e/_homepage-before.spec.ts --project=chromium
```

Result: `1 passed` — `[capture] admin homepage section cards rendered: 12`.
The throwaway spec was **deleted after the successful capture**; it is not part
of the committed suite.

Legacy snapshot — read-only production query over SSH (here-doc avoids the
single-quote quoting hazard of an inline `-c` query):

```bash
ssh smallhouse-prod "docker exec -i small-house-prod-db-1 psql -U smallhouse -d small_house -tA -f -" > legacy-homepage-snapshot.json <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'sections', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order) FROM homepage_sections s),
  'products', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.section_id, p.sort_order) FROM homepage_section_products p)
));
SQL
```

Production HEAD:

```bash
ssh smallhouse-prod 'cd /opt/small-house-commerce/small-house-commerce && git rev-parse HEAD'
```

## Notes for Task 22 comparison

- Admin screenshots come from the local isolated stack (same code as
  production `1f62c08`). Its seeded section list matches production's 12
  sections; one intentional state difference: the sort-60 PRODUCT_STORY row is
  `enabled=true` in the fresh local seed but `enabled=false` in production
  (both are captured as-is here).
- The local stack was prepared for this capture only (`pnpm install` +
  `prisma generate` in `backend/`); no application code was modified.
