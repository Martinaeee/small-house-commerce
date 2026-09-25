# Product Media UX Design

**Date:** 2026-09-25  
**Status:** Approved for implementation after Notifications V1  
**Scope:** Admin product-media presentation and workspace usability only

## Goal

Make shared gallery, gallery-driver, option-value galleries, exact-variant overrides, and PDP detail media understandable and efficient without changing any persisted media identity, resolver behavior, upload path, graph mutation, or save contract.

## Binding constraints

Do not modify:

- ProductForm ownership or submit semantics;
- Catalog Graph shape, versioning, identities, or patch contract;
- Media Resolver precedence or scope model;
- upload contracts, R2 storage, or `siteMediaUrl`;
- `catalogGraphVersion`, variant identity, `combinationKey`, `id ?? clientKey`, or scope XOR;
- `syncSharedMediaDraft`, `buildCatalogGraphPatch`, `stripUnsavableMedia`, or their execution order;
- Prisma schema, migrations, or dependencies.

The three data lines remain separate:

1. Shared Product Media (`ProductFormValue.images`)
2. Option Value / Exact Variant Scoped Media (`graphDraft.media`)
3. Detail Blocks (`ProductFormValue.detailBlocks`)

The public resolver remains:

1. Exact Variant
2. Media Driver Option Value
3. Shared Media

Scopes use REPLACE semantics, never MERGE semantics.

## Component boundaries

`ProductForm` remains the sole state owner. Focused controlled components may receive slices and callbacks but must not keep a second product/media draft.

- `SharedMediaWorkspace`: renders and edits the existing `value.images` array through ProductForm callbacks.
- `ProductMediaScopesEditor`: renders gallery-driver choice, option-value scope summaries/editors, and exact-variant override summaries/editors through the existing single `onChange(mutator)` graph callback.
- `DetailMediaWorkspace`: renders and edits the existing `detailBlocks` array through ProductForm callbacks.
- `ProductMediaPanel`: composes the three workspaces and does not copy their data.
- Pure summary helpers derive counts and effective-source labels; they never mutate the graph or replace the resolver.

## Shared Product Media

Redesign the shared workspace around 140–160px media cards while keeping all existing actions and uploader behavior:

- drag reorder;
- explicit move left/right;
- set cover;
- remove;
- expand/preview;
- URL or existing upload input;
- image/video type;
- alt text;
- add image/video.

Display only real derived facts:

- total media count;
- image/video counts;
- current 1-based order;
- cover designation;
- alt-text completion (`alt.trim()` non-empty) summary.

Blank unsaved cards remain valid droppable/editable rows and are not silently removed by layout changes.

## Gallery Driver

Present the existing single `isMediaDriver` choice as clear cards:

- Shared only;
- each active option group using its real label (for example Color/Finish or Size).

For each choice, derive an **impacted SKU count** from actual graph variants that have a SKU and reference one of the option’s active values. Shared only displays the actual SKU-bearing variant count. The count is informational and never changes selection semantics.

Selecting a driver continues to run one existing graph mutator that clears every option’s `isMediaDriver` and enables at most one active target. Switching driver does not delete old scoped media.

## Option Value Galleries

Each option value with an existing or currently editable scope gets a summary card containing:

- real value label;
- active/inactive state;
- media count and image/video breakdown;
- alt completeness;
- whether the scope is active under the current driver;
- truthful fallback copy when no scoped rows exist.

Editing reveals the existing scoped-row editor and uploader. Copy states explicitly that a non-empty option-value gallery replaces the shared gallery for matching variants. Inactive/legacy scopes remain visible and removable only through the existing explicit remove action.

## Exact Variant Override

Keep exact-variant overrides collapsed by default. Each real variant row shows a derived resolver summary:

- `Exact override · N items` when an exact-variant scope is non-empty;
- `Uses <option value> gallery · N items` when no exact scope exists and the active media-driver value scope is non-empty;
- `Uses shared gallery · N items` otherwise.

This summary is a read-only mirror of current graph state. It must use stable option-value refs and variant identities, not labels, names, array indexes, or reimplemented persistence logic. Expanding a row exposes the existing exact-scope editor and preserves scope XOR.

## Detail Media

Move Detail Blocks into a visually separate workspace with explicit copy:

> PDP long-form media only. These blocks do not appear in the main product gallery or variant galleries.

Keep current type, upload/URL, alt, move up/down, remove, and add image/video behavior. Preserve block order and every URL/type/alt value. Do not add semantic classification or layout metadata.

## Localization and accessibility

- Add complete Chinese and English keys for new headings, summaries, fallback explanations, actions, and accessible labels.
- Continue using the existing Admin i18n provider.
- Summary/expand controls use native buttons or `<details>` semantics, visible focus, accurate expanded state, and touch targets.
- Toolbars wrap at narrow widths; media cards do not create page-level horizontal overflow.

## Verification and screenshots

Automated tests must prove:

- shared-gallery edits still serialize through the one existing source;
- blank cards, stable sort orders, cover selection, and alt edits survive;
- driver choice remains exactly one or none and never deletes scoped rows;
- impacted SKU counts come from real graph refs;
- option-value summaries include inactive scopes and honest fallback;
- exact-variant summaries follow exact → driver value → shared precedence;
- summary calculations do not mutate graph input;
- scope XOR, row identity, driver switching, and shared/scoped separation remain unchanged;
- detail media edits preserve ProductForm’s existing payload and never enter scoped media;
- existing new/edit save orchestration, graph versioning, inventory retry, and public PDP media resolution remain green.

Browser verification uses the existing disposable Admin product fixture, covers 375×812, 768×1024, 1440×900, and 1920×1080, and captures shared gallery, driver/value summaries, exact override, and detail media screenshots. The saved API graph must be read back to prove identities, scope separation, and order are unchanged. Console/page errors, hydration warnings, failed uploads, and page-level overflow are blockers.

## Out of scope

- Resolver, persistence, upload, R2, or schema changes
- Merging shared/scoped/detail media
- Automatic deletion of inactive scopes
- AI/OCR/filename-based classification
- Public PDP video behavior
- Import/export
- Push, merge, PR, or production deployment
