# Homepage Builder P1 — Task 22 acceptance evidence (visual)

Side-by-side companion to the Task 0 baseline in
`../2026-09-27-homepage-before`. The baseline froze the OLD editor + legacy
storefront hero; this directory captures the V2 three-pane builder and the
new storefront hero (warning HeroSlider) + announcement bar AFTER the builder
P1 work, at the SAME viewports so the two can be compared directly.

## Environment

| Item | Value |
| --- | --- |
| Capture time (Asia/Manila) | 2026-09-29 01:04 PST |
| Worktree HEAD | `baa4c4d` + Task 22 commits ([see git log]) |
| Stack | isolated E2E backend `:3210` + frontend `:3211`, disposable DB `small_house_variant_test` (never production) |
| Storefront origin | `http://localhost:3211` (local isolated stack, same code as the branch) |
| Published state | The E2E stack published a clean v2 document: one HERO slide (image media) + the default announcement item, so the hero slider and the announcement bar are live on the storefront |

No production writes were made. The captures are read-only after the single
isolated-stack publish used to stand up the hero+announcement state.

## Viewports

Identical to the Task 0 baseline: **1440**, **768**, **390** (CSS px). The
baseline used DPR 2 emulation for the storefront; these captures use Playwright
default (DPR 1) so file sizes stay reasonable — the CSS viewport widths are what
matter for the side-by-side.

## Inventory

### Builder (three-pane editor)
| File | Viewport | What it shows |
| --- | --- | --- |
| `builder-1440.png` | 1440 | The desktop three-pane layout: Modules tree (left) + live hero preview with the v2 slide and element boxes (centre) + Settings (right). This is the state Task 22's `fix(homepage)` restored — earlier the preview/settings panes were `display:none` above 1280px due to the Tailwind v4 `[hidden] { display:none !important }` preflight beating `min-[1280px]:block`. |
| `builder-768.png` | 768 | The narrow-layout builder with the tab switcher on the **实时预览 (Live Preview)** pane: hero canvas in the device frame. |
| `builder-390.png` | 390 | Same narrow layout at mobile width: hero canvas + element chips fit without horizontal overflow. |

### Storefront
| File | Viewport | What it shows |
| --- | --- | --- |
| `storefront-1440.png` | 1440 | Full homepage with the new HeroSlider (heading "Small Space. Big Luwag.") at desktop width. |
| `storefront-768.png` | 768 | Full homepage at tablet width. |
| `storefront-390.png` | 390 | Full homepage at mobile width. |
| `storefront-hero-1440.png` | 1440 | The hero slider element (the v2 slide with responsive CSS-variable positions). Companion to the baseline `storefront-1440.png` hero region. |
| `storefront-hero-768.png` | 768 | Hero slider at tablet width. |
| `storefront-hero-390.png` | 390 | Hero slider at mobile width. |
| `storefront-announcement-1440.png` | 1440 | The announcement bar (served from the homepage document's `announcement` block via `GET /api/v1/storefront/announcement`). |
| `storefront-announcement-768.png` | 768 | Announcement bar at tablet width. |
| `storefront-announcement-390.png` | 390 | Announcement bar at mobile width. |

## How it was captured

A throwaway capture spec (`frontend/e2e/_homepage-builder-after.spec.ts`),
mirroring the baseline's `_homepage-before.spec.ts` approach, was run against
the isolated E2E stack and then **deleted** — it is not part of the committed
suite. The spec:

1. published a clean v2 document through the admin API (hero slide with image
   media + heading "Small Space. Big Luwag.", CTA links; warning confirmation);
2. opened the builder with the stored-session zero-login pattern and the
   storefront at each viewport;
3. asserted the hero slider, announce bar and the builder's hero element were
   visible before each capture.

Exact command:

```bash
pnpm --dir small-house-commerce/frontend exec playwright test e2e/_homepage-builder-after.spec.ts --project=chromium
```

Result: `1 passed`. The DB was recreated before the run
(`small_house_variant_test`), so the captured state is reproducible.

## Notes for comparison with the Task 0 baseline

- The Task 0 baseline `storefront-*` files were captured against **production**
  (`http://43.135.75.99/`, HEAD `1f62c08`) with DPR 2; these captures are
  against the **isolated stack** at DPR 1. Both use the same CSS viewports.
- The baseline's legacy hero rendered a `desktopImage/`C2A static hero; the
  builder hero now renders the v2 slide (image media + percentage-positioned
  elements driven by `heroCss` custom properties). The announcement bar exists
  in both but V2 serves from the document, not the hard-coded string.
- Baseline `admin-homepage-list/edit` vs `builder-1440` shows the replacement
  of the legacy section list editor by the three-pane visual editor.