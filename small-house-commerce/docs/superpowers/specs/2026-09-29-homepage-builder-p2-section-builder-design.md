# Homepage Builder P2 — Section Builder and Add Section Design

> Status: approved conversational design, pending implementation-plan review.
> Scope: the next homepage-builder phase only. Footer and site-wide chrome remain P3.

## Goal

Turn the existing homepage module tree from a visibility/order navigator into a usable section builder. Operators will be able to add any currently supported homepage section, edit its content through a type-specific panel, configure the section's presentation, and save or publish through the existing versioned homepage document flow.

## Current baseline

P1 already provides:

- a versioned draft document with optimistic revision saves, autosave, publish, restore, and preview;
- a module tree with drag ordering, enabled/disabled toggles, and an Announcement node;
- full Hero and Announcement editing;
- storefront rendering for all current non-Hero section types;
- backend payload validators for every current section type.

The current frontend treats every non-Hero section as an opaque `Record<string, unknown>` payload. The module tree only permits duplicate/delete controls for `PRODUCT_GRID` and `PRODUCT_STORY`. P2 replaces those limitations without changing the stored document envelope or the backend section contract.

## Scope

### Add Section

Add an accessible Add Section control to the module tree. The picker lists these existing section types:

- USP
- Category Tiles
- Product Grid
- Solutions
- Product Story
- Room Inspiration
- UGC / Real Homes
- Brand Story
- Confidence

Choosing a type inserts one valid section after the selected section, or at the end when no section is selected. The new section receives a stable id, the next available sort order, a localized default title, and the smallest valid default payload for its type. It is selected immediately so its editor is visible.

The picker does not introduce new section types in this phase. Countdown Banner, Promo Banner, Trusted by Media, Newsletter Signup, and similar new storefront blocks require a separate contract/rendering decision and remain outside this first P2 slice.

### Section editors

The right pane routes by selected section type. Hero and Announcement keep their P1 routes. Non-Hero sections use a registry of editor metadata and render three consistent groups:

- **Content** — section title/subtitle and type-specific content;
- **Style** — presentation fields already supported by the section document's `style` object;
- **Advanced** — enabled state, schedule, and type-specific optional behavior that already exists in the wire contract.

The initial editor contract for each type mirrors the existing backend schemas:

| Type | Editable content |
|---|---|
| USP | Up to four items, icon, label, supporting text |
| Category Tiles | Up to six category ids, with category search/reordering |
| Product Grid | Ordered product rows, badge text, two/four columns |
| Solutions | Up to six title/blurb/link items |
| Product Story | Image, heading, body, CTA text/link, product |
| Room Inspiration | Image, heading, body, up to five scenes, scene hotspots |
| UGC | Up to six image/name/location/comment/product entries |
| Brand Story | Heading, body, up to six bullets |
| Confidence | Heading, body, up to six bullets |

Existing entity search, media URL/upload controls, and link lookup behavior are reused where their wire shape is compatible. Section payloads continue to store the current backend representation (for example, a section link remains the validated wire string); a UI picker must serialize through the existing link resolver rather than introducing a second link format.

### Existing module controls

P2 keeps the current controls and makes their behavior consistent:

- drag and keyboard reorder remain one reducer commit;
- enabled toggles remain one reducer commit;
- duplicate is available for every section type for which a valid default/clone can be produced;
- delete remains undoable in the module tree;
- Add Section and duplicate both select the resulting section;
- no operation silently changes another section's payload.

## Out of scope

- Footer, header, navigation, Mega Menu, and other site-wide chrome; these belong to P3.
- New backend section types or new database tables.
- Product, category, inventory, order, media-upload, or catalog-graph contract changes.
- A second save/publish path.
- Rewriting storefront section renderers except for type corrections required by an existing validated payload.
- Countdown, promo, newsletter, press, or other new blocks not represented by the current `SectionType` enum.

## Architecture

### Typed frontend section model

Replace the single opaque non-Hero payload type with a discriminated frontend model that mirrors the nine existing backend payload schemas. The document envelope remains:

```ts
{
  schemaVersion: 1,
  sections: HomepageSection[],
  announcement: AnnouncementBlock
}
```

The section factory and editor registry are the single frontend sources for:

- section label and Add Section metadata;
- default title and payload;
- section-specific editor component;
- clone/normalization behavior.

The registry must not become a second validation system. Backend validation remains authoritative at save/publish boundaries; frontend factories only create values that satisfy the existing schemas.

### Mutations and state

Add pure immutable mutators for:

- inserting a new section at a position;
- updating a section envelope field;
- updating a typed section payload;
- updating ordered product/category/item rows;
- duplicating and removing any supported section.

Every editor callback dispatches through the existing reducer. Buffered text/number fields use the current latest-document `mutate` path; discrete actions use `commit`. No editor may build a document from a render-captured stale value.

### Editor routing

`HomepageEditorShell` resolves in this order:

1. Announcement sentinel → `AnnouncementSettings`;
2. selected Hero element → existing `SettingsPanel`;
3. selected Hero slide → existing media/style panels;
4. selected non-Hero section → P2 section editor registry;
5. no selection → section-level empty state with Add Section guidance.

The section editor receives a narrow controlled slice and callbacks rather than owning document state. This keeps selection, undo/redo, autosave, conflict handling, and publish preconditions in `HomepageEditor`.

### Validation and error behavior

- The editor prevents impossible local values at the control boundary: maximum item counts, allowed enum values, bounded coordinates, and required text where the existing schema requires it.
- Empty optional arrays/fields remain valid and are represented using the current schema's optional-field semantics.
- A backend 422 remains a save/publish error surfaced through the existing error/conflict UI; the editor does not invent a parallel error model.
- Removing the last editable row uses the schema's existing optional/empty behavior. If a type requires one item, the remove action is disabled with a localized explanation.
- Media and entity lookup failures leave the prior value unchanged and show the existing field-level error pattern.

## UX requirements

- The Add Section picker is keyboard accessible, has an explicit close action, and returns focus to its trigger.
- The selected module is visually distinct from enabled state; enabled does not imply selected.
- Content, Style, and Advanced groups are collapsible but preserve unsaved local drafts while the same section remains selected.
- Switching sections flushes or cancels buffered edits using the existing target-identity safeguards.
- The module tree and right panel remain usable at 375px, 768px, and desktop widths; long item lists scroll inside their panel instead of widening the page.
- All new operator-facing labels have zh/en parity and do not expose raw enum names such as `CATEGORY_TILES`.
- The storefront remains English-only; admin copy follows the existing admin language setting.

## Testing strategy

### Unit and component tests

Write RED tests before production changes for:

- every section factory default passing the corresponding existing schema shape;
- Add Section insertion position, stable ordering, selection, undo, and duplicate behavior;
- typed payload mutations preserving unrelated sections and products;
- maximum item counts and required-item remove guards;
- editor routing for all nine non-Hero section types;
- latest-document behavior for buffered edits followed by section switching;
- zh/en key parity and accessible Add Section dialog behavior.

### Integration and browser tests

Extend the existing homepage builder tests to cover:

- adding USP, Category Tiles, and Product Grid sections;
- editing content, reordering rows, and saving through the existing draft API;
- conflict/save-error behavior remains the existing flow;
- desktop, tablet, and mobile layouts do not horizontally overflow;
- keyboard Add Section and section reorder paths;
- no console/page errors on the golden path.

A real browser smoke must verify that a newly added section appears in the draft preview, survives reload after save, and does not appear on the live storefront until publish.

## Acceptance criteria

1. An operator can add each of the nine existing section types without producing a backend 422.
2. An operator can edit the content of every existing non-Hero type through a type-specific panel.
3. Existing Hero/Announcement behavior and all P1 version/publish flows remain unchanged.
4. Add, edit, duplicate, delete, reorder, undo, autosave, conflict, and publish all use the existing document reducer and API path.
5. No schema, migration, catalog, inventory, order, upload, or Footer changes are required for this P2 slice.
6. Full frontend/backend gates and real-browser checks pass before the phase is considered complete.

## Follow-up phases

- **P2 follow-up:** new section types whose payloads and storefront rendering do not exist yet, such as Countdown Banner, Promo Banner, Trusted by Media, and Newsletter Signup.
- **P3:** site-wide Header/navigation/Footer management, Mega Menu, media library, and other global commerce surfaces.
