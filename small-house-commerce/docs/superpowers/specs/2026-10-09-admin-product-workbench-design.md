# Admin Product Workbench Compacting and Media Workspace Design

**Date:** 2026-10-09
**Status:** Approved in design review
**Branch:** `feature/homepage-builder`
**Scope:** Sub-project ① of the product-admin program (requirements 1, 2, 5, 8)

## 1. Context

The admin product editor currently works but reads as not compact and not clear:

- The main column and right rail split 72/28, with the rail never narrower than 320px, so the editing column is squeezed while the read-only rail holds little information.
- Short fields (name, code, tagline, SEO) span the full column width, stretching the page vertically.
- The media tab renders every image as a 140–160px square card with its own URL input, upload button, and action row — roughly 180–200px per image — so only a few images fit on screen and there is no thumbnail overview.
- Upload accepts a single file per picker, so adding ten images means ten picker round-trips.
- Product preview uses the shared `DeviceFrame` without `scrollable`, so the preview is clipped to the device viewport and cannot be scrolled to see the full product page.
- Nested card borders give every block similar visual weight, so no section reads as primary.

This document specifies the first sub-project only: the product workbench skeleton, form density, media workspace, and preview scrolling. It does not change the save/publish contract, the database, or the backend.

## 2. Program Roadmap (context, not in this sub-project)

The eight reported requirements were decomposed into four sub-projects:

1. **Admin product workbench** — this document (requirements 1, 2, 5, 8). Pure frontend.
2. **Variant specs and packaging** (requirements 3, 4). Adds per-variant product dimensions on `Sku`, a uniform-dimension apply action, and paste-to-parse packaging text with units. Small additive migration.
3. **Storefront product cards** (requirement 6). Unifies `ProductCard` and `PlpProductCard`, changes the card CTA to Add to cart, adds hover second image, fixes `compareAtPrice` presentation for multi-variant products, and adds card-level variant selection. Requires a media-role dimension on `ProductImage` (scene vs white background), which does not exist today.
4. **Bundle and inventory** (requirement 7). New subsystem: `Bundle`/`BundleComponent` schema, sellable stock = min over components, order expansion, cancel/refund release. No existing foundation.

Sub-projects ②③④ are deferred until ① is delivered and verified. They are listed here so the file boundaries of this sub-project stay honest.

## 3. Fixed Decisions

- **Keep the existing seven tabs** (`basic, media, variants, specs, shipping, seo, preview`) and the existing sticky action bar. Compact each tab internally rather than merging tabs or removing the tab structure.
- **Media workspace becomes a thumbnail grid with click-to-edit**, replacing the per-image large card. Batch multi-file upload is added. No new backend endpoint; the existing single-file upload endpoint is called per file.
- **Product preview becomes scrollable** so the full product page can be inspected inside the device frame.
- **Right rail narrows to 280px** and stays read-only.

## 4. Design A — Page Skeleton and Form Density

### 4.1 Grid

- Main grid changes from `xl:grid-cols-[minmax(0,72fr)_minmax(20rem,28fr)]` to a fixed rail: main `minmax(0, 1fr)` plus `280px` rail.
- The rail keeps `xl:sticky` and contains only read-only status: publish state, validation warnings, storefront visibility, last saved, and the open-preview action.
- Sticky header and tab bar behavior is preserved; Save/Preview/Publish remain reachable while scrolling.

### 4.2 Density scale

- Backend inputs: 36px height.
- Labels above fields; helper text below only where it exists today.
- Field gap: 12–16px. Section gap: 20–24px.
- Section titles plus hairline separators replace nested bordered boxes where a block currently has no interactive grouping need. Blocks that group real controls keep one border level, not two.
- Checkout and storefront pages are not affected; their 44px touch targets stay.

### 4.3 Two-column short fields

Per tab, short fields pair into two columns while long fields stay full width:

- `basic`: name + product code, category + tagline; description stays full width.
- `seo`: SEO title + meta description side by side where width allows; canonical/link fields full width.
- `specs`, `shipping`, `variants`: density changes apply, but their structural changes belong to sub-project ② and are out of scope here beyond spacing and input-height consistency.

Column pairing must not reorder the serialized field set or change the save diff; it is presentation only.

## 5. Design B — Media Workspace

### 5.1 Layout

```text
┌──────────────────────────────────────────────────────────┐
│ [上传图片（可多选）]  [粘贴图片 URL ............] [添加]  │  one compact row
├──────────────────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                        │  thumbnail grid ~96px
│ │封面│ │    │ │    │ │    │ │ +  │                        │  drag to sort
│ └────┘ └────┘ └────┘ └────┘ └────┘                        │  hover: ←/→/设封面/删除
├──────────────────────────────────────────────────────────┤
│ Selected image detail: preview, Alt text, set cover,      │  click a thumbnail
│ remove                                                    │
└──────────────────────────────────────────────────────────┘
```

- Thumbnails approximately 96px square in an auto-fill grid; the cover thumbnail carries a visible cover badge.
- Hover reveals per-thumbnail actions: move left, move right, set cover, remove. Keyboard focus exposes the same actions.
- Clicking a thumbnail selects it and opens the detail panel below the grid with a larger preview, Alt text input, set-cover, and remove.
- Drag-to-sort reorders the gallery through the existing ordering model; the existing move actions remain as the accessible fallback.

### 5.2 Batch upload

- The upload control accepts multiple image files in one picker.
- Files upload sequentially through the existing single-file admin upload endpoint, preserving picker order.
- Each file shows its own progress/failure state; one failure reports that file and continues with the rest.
- Successful uploads append to the gallery in picker order.
- The 5MB per-image limit and existing validation messages are unchanged.
- When the gallery was empty, the first appended image becomes the visible cover by normal ordering.

### 5.3 Scoped and detail media

`ProductMediaScopesEditor` and `DetailMediaWorkspace` keep their current structure and inherit the compact input height, spacing, and action styling. Their small `h-16 w-16` thumbnails are already compact and are not converted to the new grid.

## 6. Design C — Preview and Right Rail

### 6.1 Scrollable product preview

- The product preview must allow scrolling inside the simulated device to inspect the full product page, at both desktop and mobile frames.
- Implementation reuses the existing `DeviceFrame scrollable` capability (the homepage builder already passes `flat scrollable`).
- Browser verification is required because the preview may be iframe-based or direct-child based; whichever mechanism is in place must be proven to scroll the full page, not merely to keep the viewport in flow.
- Landing-page preview consumers of the same shared preview components are audited so the change either improves them identically or is scoped to the product preview only.

### 6.2 Right rail

- Rail width 280px; content unchanged and read-only.
- Rail cards keep their current information; no new editable fields are added to the rail.

## 7. Testing Strategy

### 7.1 Unit and component tests

- Batch upload: multi-file selection order, per-file progress, partial failure continues, appended order, empty-gallery cover.
- Thumbnail grid: drag sort, set cover, remove, move left/right, click selects and opens the detail panel, Alt text edit commits through the existing buffered save path.
- Preview: scrollable marker passed to the device frame; existing non-scrollable consumers do not regress.
- Form: two-column pairing does not change the serialized form value or the save diff; existing `ProductForm`, `SharedMediaWorkspace`, `ProductMediaScopesEditor`, `DetailMediaWorkspace`, `ProductPreviewPanel`, and editor-page tests all pass.
- Rail: width and read-only content unchanged behaviorally.

### 7.2 Browser verification

- New and edit product pages at 1280px and 1440px widths: no horizontal overflow, visibly higher information density, sticky header works.
- Media tab: batch-upload several images in one picker, reorder by drag, set cover, edit Alt, remove; verify against the isolated rehearsal services only.
- Preview tab: scroll the desktop and mobile frames through the full product page.
- No console or hydration errors.

## 8. File Boundaries

Expected touches:

- `frontend/src/components/admin/ProductForm.tsx` (grid, tab internals, spacing)
- `frontend/src/components/admin/product-form/ProductFormHeader.tsx` (if density touches the header)
- `frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx` (grid, detail panel, batch upload)
- `frontend/src/components/admin/ImageUrlInput.tsx` (multi-file support where used by the gallery; single-file behavior preserved elsewhere)
- `frontend/src/components/admin/product-form/ProductEditorRail.tsx` (width only, if applicable)
- `frontend/src/components/admin/product-form/ProductPreviewPanel.tsx` (scrollable)
- `frontend/src/components/admin/PreviewPane.tsx` (only if the scrollable mechanism requires it)
- Colocated spec files for the above

Not touched:

- Backend, Prisma schema, migrations
- Save/publish contract, DTOs, catalog graph
- `backend/uploads/`
- Storefront pages
- Homepage builder

## 9. Acceptance Criteria

- Product editor main column is wider and the rail is 280px; short fields pair into two columns.
- Density scale applied consistently across tabs: 36px inputs, tightened gaps, reduced nested borders.
- Media tab shows a ~96px thumbnail grid with drag sort, hover actions, cover badge, and a click-to-edit detail panel.
- One picker accepts multiple images; uploads proceed in order with per-file state; partial failures do not abort the batch.
- Product preview scrolls through the full page in desktop and mobile frames.
- All existing product-editor tests pass; new tests cover the behaviors above.
- Browser verification passes at 1280/1440 with no console errors.
- No database, backend, or save-contract change in this sub-project.

## 10. Process Boundaries

- TDD for every behavior change; RED before GREEN.
- Local commits only. No push, merge, PR, or deploy without separate authorization.
- No production data changes. Isolated rehearsal services only.
- After implementation: full frontend test/typecheck/lint/build, browser verification, and a fresh-context review before stopping at the local review gate.
