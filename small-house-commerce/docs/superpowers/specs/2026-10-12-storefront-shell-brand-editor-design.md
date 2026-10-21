# Storefront Shell and Brand Editor Design

**Date:** 2026-10-12
**Status:** Approved for implementation planning
**Branch:** `feature/homepage-builder`

## 1. Context

The storefront currently has one shared shell, but its editable inputs are fragmented:

- Header navigation is assembled from category roots plus three hard-coded collection links.
- The LUWAG wordmark and square mark are rendered from code.
- Footer brand copy, column headings, utility text, links, and copyright are hard-coded.
- Footer support email and service hours are stored in the `SiteSetting` singleton.
- Messenger and Newsletter display settings share the existing `/admin/settings` page.
- Storefront colors are compile-time CSS variables in `globals.css`.
- Homepage Builder does not own Header or Footer editing. The approved complete-preview design explicitly keeps those global components outside the homepage document.

The requested outcome is an independent, versioned **Header & Footer** workspace that also manages uploaded brand marks and a constrained storefront-wide base theme. Changes must be drafted, previewed, and explicitly published without coupling them to homepage publication.

This design supersedes the previous decision to defer the Header/Footer editing entry and the previous non-goal excluding Logo upload and basic brand theming. It does not reactivate the separately deferred complete-homepage-shell preview or rich announcement/countdown work.

## 2. Confirmed Product Decisions

1. Add a dedicated global-shell editor rather than placing Header/Footer controls inside Homepage Builder.
2. Edit Header/Footer content and links, not arbitrary layout structure.
3. Use a separate draft and publish lifecycle. Saving never changes the public site.
4. Manage two brand assets:
   - a horizontal Logo for the desktop Header and Footer;
   - a square mark for the mobile Header, favicon, and the slow-load splash.
5. Apply the base brand theme to the complete shopper-facing storefront, not only Header/Footer.
6. Keep spacing, component layout, responsive behavior, interaction logic, radius, and shadow rules constrained by the existing design system.
7. Keep the admin application on its independent green visual system.
8. Preserve the current LUWAG shell as the exact migration and runtime fallback.

## 3. Goals

1. Give authorized operators one discoverable place to edit and preview the global storefront shell.
2. Preserve one production implementation of Header, MainNav, Footer, and theme tokens across public rendering and admin preview.
3. Allow safe curation of Header items while retaining live category trees and current entity truth.
4. Allow safe editing of Footer brand copy, columns, links, contact text, and copyright.
5. Support horizontal and square Logo uploads without granting product-management permissions.
6. Support a constrained, accessible, storefront-wide base color and font theme.
7. Prevent drafts, partial uploads, invalid links, poor contrast, and concurrent edits from silently reaching shoppers.
8. Preserve current storefront output before the first explicit shell publication.
9. Degrade to the existing LUWAG defaults if shell data or uploaded assets are unavailable.
10. Prove the behavior with unit, integration, build, and real-browser checks before any release decision.

## 4. Non-goals

- Free-form Header or Footer layout building.
- Arbitrary CSS, HTML, scripts, embeds, or runtime stylesheets supplied by an operator.
- Editing component spacing, container width, radius, shadows, sticky behavior, breakpoints, search behavior, account behavior, or cart behavior.
- Uploading arbitrary font files or loading fonts from an operator-provided remote URL.
- Editing semantic error, warning, success, sale, or star-rating colors.
- Editing Announcement Bar rich text/countdowns, Messenger, MobileTabBar, BackToTop, or CartDrawer in this workspace.
- Adding the complete storefront shell to Homepage Builder preview in this phase.
- Coupling Header/Footer publication to homepage publication.
- Multi-language storefront content in this phase; shopper-facing copy remains English.
- Automatically replacing a deleted target with a similarly named entity.
- Building a general digital-asset library or deleting unreferenced uploads automatically.
- Product, SKU, price, inventory, cart, checkout, order, customer, risk, fulfillment, or marketing-attribution changes.
- Production deployment as part of design or planning.

## 5. Admin Information Architecture and Permission

The Website area exposes three distinct destinations:

```text
Website
├─ Homepage
├─ Header & Footer
└─ Site Settings
```

The new page is `/admin/storefront-shell` and is labeled **Header & Footer**.

A dedicated permission, `STOREFRONT_SHELL_MANAGE`, controls:

- navigation visibility;
- reading the admin draft;
- uploading shell brand assets;
- saving the draft;
- publishing.

The permission is initially granted to `SUPER_ADMIN`. It is not inferred from `PRODUCT_MANAGE` or from the broad `SYSTEM_SETTINGS_EDIT` check. Other roles can receive it explicitly through RBAC later.

Unauthorized API access is rejected by the existing JWT and permission guards. The public published-shell endpoint remains anonymous and read-only.

## 6. Editor Workflow

The editor has a sticky status/action bar and two content tabs.

### 6.1 Status and actions

The header shows:

- current draft version;
- current published revision;
- local unsaved state;
- saved-but-unpublished state;
- last update/publish metadata;
- **Save draft**;
- **Preview saved draft**;
- **Publish to storefront**;
- **Restore LUWAG defaults** as a confirmed draft-only action.

Publishing is disabled while local changes or uploads remain unsaved. Operators save first, then publish the exact server draft version.

### 6.2 Header tab

The Header tab contains:

- horizontal Logo upload/replacement/removal;
- square mark upload/replacement/removal;
- accessible brand name;
- ordered navigation rows;
- the base brand-theme controls.

Navigation rows support add, remove, enable/hide, drag reorder, and keyboard up/down alternatives.

### 6.3 Footer tab

The Footer tab contains:

- brand tagline;
- brand description;
- ordered content columns;
- column titles;
- ordered link or plain-text rows;
- support email;
- support hours;
- COD message;
- Track Order link;
- copyright brand/company text.

The year is generated at render time and is not manually stored.

### 6.4 Preview

The same unsaved local document drives an inert preview at:

- desktop: 1200 px;
- tablet: 768 px;
- mobile: 390 px.

Header links, search, account, cart, Footer links, and external links are visible but inert. Preview never reads customer authentication, opens a cart, emits marketing visits, navigates, or writes shopper state.

Switching content tabs, device, or admin language does not discard input. Navigating away with unsaved changes prompts explicitly.

## 7. Header Content Model

The Header presentation remains structurally fixed:

```text
Logo | Navigation | Search | Account | Cart
```

Search, account, cart, hamburger behavior, desktop Mega Menu behavior, and responsive breakpoints are not editable.

### 7.1 Navigation item kinds

A top-level item is one of:

1. `CATEGORY_ROOT`
   - stores a stable category id;
   - uses the live category tree for children and imagery;
   - allows a display-label override without renaming the category.
2. `COLLECTION`
   - stores a stable collection id;
   - renders as a direct link using the current slug;
   - allows a display-label override.
3. `STRUCTURED_LINK`
   - uses the existing structured-link concepts for Product, Collection, Category, Landing Page, an internal path, or an HTTPS external URL;
   - stores a stable item id and editable label.

The Header supports at most eight enabled top-level items. Empty labels and labels over 40 characters are invalid for publication.

### 7.2 Live entity behavior

A category root keeps using current children and category media; the shell document never snapshots a second category tree. Collections and other entity links resolve against live ids so renamed slugs do not leave stale URLs.

A target that becomes unavailable after publication is omitted from the public projection. It remains visible as an issue in the admin document and blocks the next publication until repaired or removed.

## 8. Footer Content Model

The responsive Footer skeleton remains fixed: brand area followed by content columns on desktop, stacked vertically on narrow screens.

### 8.1 Brand area

Editable fields:

- tagline: maximum 100 characters;
- description: maximum 300 characters.

The horizontal Logo is shared by the desktop Header and Footer; the mobile Header uses the square mark. If an asset is absent or unavailable, the corresponding current code-rendered LUWAG mark is used.

### 8.2 Columns

The document supports up to four columns, each with:

- stable id;
- title, maximum 40 characters;
- zero to eight ordered rows.

A row is either:

- a structured link with editable label; or
- plain text, maximum 120 characters.

Columns and rows support drag reorder plus keyboard up/down controls.

### 8.3 Contact and utility content

Support email, support hours, COD copy, and Track Order are edited in this workspace. The initial document imports the current `SiteSetting` support values and current hard-coded Footer defaults.

The old Site Settings page no longer exposes a second writable copy of support email/hours. It shows their current published values and links to Header & Footer. Messenger and Newsletter settings remain in Site Settings.

The existing `SiteSetting.supportEmail` and `supportHours` columns remain as compatibility mirrors. Shell publication updates those values in the same transaction. The general settings mutation no longer changes them, preventing two competing sources of truth.

## 9. Brand Assets

### 9.1 Horizontal Logo

Used by the desktop Header and Footer. It is rendered with preserved aspect ratio, without crop or stretch, at component-controlled maximum dimensions. The shell document stores the uploaded asset id; the server-owned asset record stores:

- uploaded path and storage key;
- detected MIME type;
- intrinsic width and height;
- storage kind and durability;
- creator and creation time.

The document separately stores the accessible brand name.

### 9.2 Square mark

Used by:

- the mobile Header;
- favicon;
- slow-load splash;
- future compact brand placements that explicitly consume the square mark.

The decoded raster must be between 64×64 and 4096×4096 pixels, and its width/height ratio must be between 0.9 and 1.1 inclusive. The editor reports detected dimensions before save. The server creates a metadata-stripped 512×512 square PNG derivative using contain-with-transparent-padding rather than cropping the operator's artwork.

### 9.3 Accepted files

Initial accepted types:

- PNG;
- WebP;
- JPEG.

Each file is capped at 5 MB. A mature server-side raster decoder verifies the actual bytes and dimensions, strips metadata, and emits bounded application-owned derivatives rather than trusting the request MIME or filename. Only single-frame PNG, WebP, and JPEG inputs are accepted even if the decoder supports more formats. Horizontal artwork must decode within 32–4096 pixels on each axis; the server emits a metadata-stripped WebP fitted inside 1200×400 without enlargement or crop. SVG is excluded in this phase because safe arbitrary SVG sanitization and external-resource removal would materially expand the security surface.

The endpoint is shell-scoped, guarded by `STOREFRONT_SHELL_MANAGE`, and reuses the bounded storage implementation rather than the product upload route. Upload completion adds an asset only to the local draft; publication is still required.

Removing a draft reference does not delete the stored object because the same path may still be published. Asset garbage collection is outside this phase.

If production persistent media storage is unavailable, publication of a newly uploaded brand asset is blocked; the current built-in marks remain usable. The design does not silently publish deployment-local paths that would disappear on restart.

### 9.4 Favicon and splash delivery

A stable same-origin brand-mark route serves the current published square asset with safe content headers, ETag/revalidation behavior, and the built-in LUWAG square fallback. Root metadata points to this stable route, avoiding a frontend rebuild for each favicon change.

The root layout remains synchronous so the existing slow-load splash behavior is preserved. The splash requests the stable published mark and falls back to the built-in mark. It does not wait for a settings API call before initial HTML can stream.

## 10. Base Brand Theme

Theme values are part of the same draft/published shell document as Header, Footer, and Logo assets.

### 10.1 Editable source tokens

Operators edit only:

- brand primary color;
- action/CTA color;
- page background color;
- card/surface color;
- primary text color;
- heading-font preset;
- body-font preset (`SYSTEM` is the only v1 body choice and remains an explicit versioned field).

Colors are strict six-digit hexadecimal values. The document stores no CSS fragments.

### 10.2 Derived tokens

Application code derives deterministic, bounded values for:

- primary dark;
- primary light;
- CTA hover;
- secondary text;
- muted text;
- border;
- focus ring;
- disabled treatment.

The derivation and contrast calculations use one shared, established color implementation selected after compatibility research; backend validation and frontend preview must agree on fixtures. Operators do not edit dozens of technical states independently.

### 10.3 Fixed semantic colors

The following remain application-controlled:

- error/danger;
- warning;
- success;
- sale/promotional price;
- star rating.

Theme publication cannot make those semantic states indistinguishable.

### 10.4 Font presets

No arbitrary font upload or remote URL is allowed. Initial presets use only self-hosted or system-safe assets:

- heading enum `SYSTEM`: current system sans stack;
- heading enum `POPPINS_HEADING`: existing self-hosted Poppins 700 for headings;
- heading enum `SERIF_HEADING`: safe serif heading stack;
- body enum `SYSTEM`: current system sans stack for body copy.

Typography size, line-height, breakpoint, and component hierarchy remain controlled by the design system.

### 10.5 Theme scope

The published theme applies to every shopper-facing route and fixed storefront component, including Homepage, category/collection pages, search, PDP, marketing landing pages, cart, checkout, authentication/account, order tracking, Header, Footer, and Newsletter UI.

Admin surfaces retain their independent tokens and do not inherit storefront branding.

### 10.6 Runtime application

The public storefront layout injects validated CSS custom properties at its root. Existing token-based Tailwind classes inherit them. The async storefront segment may stream a small validated `:root` token style so the root-level splash can adopt the published palette without making the synchronous root layout fetch data.

Admin preview applies the same computed variables to its isolated canvas. No arbitrary operator string is interpolated into CSS; values originate from normalized hex tokens and fixed font enums.

## 11. Accessibility Rules

The editor displays and the server enforces contrast for:

- primary text on page background;
- primary text on card background;
- CTA text on CTA background;
- Header text on Header surface;
- Footer text on Footer surface;
- visible focus indicators against relevant surfaces.

Publication requires WCAG AA:

- at least 4.5:1 for normal text;
- at least 3:1 for large text and key graphical/focus indicators.

Invalid combinations identify the exact pair and block publication. The system does not silently rewrite selected colors.

All editor controls, sorting alternatives, upload actions, issue links, device selection, save, and publish are keyboard accessible. Uploaded Logos have a configurable accessible brand name; decorative duplicate marks are hidden from assistive technology.

## 12. Data Model and Versioning

Add a singleton `StorefrontShell` record with a fixed id and fields equivalent to:

```text
id
schemaVersion
draftDocument        JSON
publishedDocument    JSON nullable
version              integer CAS version
publishedRevision    integer
draftUpdatedByUserId
publishedByUserId
createdAt
updatedAt
publishedAt nullable
```

Add a supporting `StorefrontShellAsset` registry with a generated id, storage key, public URL, detected MIME, intrinsic dimensions, storage kind, durable flag, creator, and creation timestamp. The document references an asset id rather than trusting a client-supplied URL or metadata. Uploaded asset rows are append-only in this phase; removing a draft reference does not delete a row or object that an older published revision may still need.

The JSON documents use `schemaVersion: 1`. The backend owns normalization, limits, defaults, entity validation, asset lookup, derived theme tokens, and public projection.

### 12.1 Save

`PATCH /admin/storefront-shell` accepts:

- expected version;
- raw structured draft.

It validates document shape and safe scalar bounds, normalizes it, and writes by id/version CAS. A draft may contain incomplete or currently unresolved link targets so operators can work incrementally. Save never updates the published document, public compatibility fields, or storefront cache.

### 12.2 Publish

`POST /admin/storefront-shell/publish` accepts the exact expected draft version. In one database transaction it:

1. reloads the current draft;
2. performs strict publication validation, including target availability, asset persistence, limits, and contrast;
3. copies the normalized draft to `publishedDocument`;
4. increments `version` and `publishedRevision`;
5. records publisher/timestamp;
6. mirrors published support email/hours into `SiteSetting` compatibility columns.

Only after the transaction succeeds does the application request storefront cache/path revalidation. Revalidation remains best-effort and cannot roll back a successfully published database version.

### 12.3 Public read

`GET /storefront/shell` returns only the normalized published projection. It batch-resolves entity targets and current slugs, omits unavailable links, and never returns draft content, internal issues, user ids, or raw storage metadata. Its cache validator combines `publishedRevision` with a deterministic hash of the resolved projection, so a live target status/slug change cannot receive a stale 304 merely because the shell revision stayed constant.

If no published document exists or reading fails, callers receive the built-in LUWAG default projection.

## 13. API Surface

```text
GET   /admin/storefront-shell
PATCH /admin/storefront-shell
POST  /admin/storefront-shell/validate
POST  /admin/storefront-shell/publish
POST  /admin/storefront-shell/upload?slot=horizontal|square
GET   /admin/storefront-shell/preview
GET   /storefront/shell
```

The frontend owns a same-origin, request-time `/brand-mark` Route Handler. It reads the tagged public shell projection, proxies the published square PNG when present, and otherwise returns the built-in LUWAG SVG with `ETag` and `Cache-Control: no-cache`. Root metadata points to `/brand-mark`; the old static `app/icon.svg` is removed so browsers do not receive two competing icon declarations.

`/admin/storefront-shell/preview` is authenticated, private/no-store, and returns the currently saved server draft projection. The frontend page at the same pathname renders that projection under the admin origin; the global `/api/v1` backend prefix keeps the API and page URLs distinct. It does not accept a reusable public draft token. The editor's embedded preview continues to render unsaved local input separately.

All admin responses include the current version and structured issues. The public response carries cache validators and the published revision.

## 14. Shared Rendering Architecture

Production and preview share presentation components:

```text
StorefrontShellPresentation
├─ Header
│  └─ MainNav
├─ content slot / inert preview placeholder
└─ Footer
```

Production supplies interactive adapters for navigation, search, account, and cart. Admin preview supplies inert adapters. Header/Footer markup and styles are not forked.

`buildNav` evolves from hard-coded flat links into a resolver that consumes the published Header configuration plus current category/collection data. The existing default function remains available as the failure/migration fallback.

`Footer` consumes the resolved published Footer view rather than hard-coded English strings and separate support props.

`BrandWordmark` becomes asset-aware while preserving the current generated LUWAG lockup as a zero-network fallback.

## 15. Error and Conflict Behavior

### 15.1 Local and network failures

- Failed saves, publishes, uploads, and validations preserve local input.
- Upload-in-progress locks save, publish, restore, and destructive row actions that could orphan the result.
- Late responses are ignored when page identity, account, version, or request generation no longer matches.
- Changing admin language relabels controls without replacing the document.

### 15.2 CAS conflict

A stale expected version returns 409. The UI keeps local content and offers an explicit server-draft reload. It never silently merges or overwrites. A forced-overwrite endpoint is not introduced.

### 15.3 Publication issues

Publication is blocked by:

- no enabled Header item;
- malformed or over-limit content;
- unavailable referenced entity;
- unsafe external URL;
- unavailable/non-persistent brand asset;
- unsupported file metadata;
- invalid theme token;
- insufficient contrast;
- stale version.

Each issue identifies a stable Header/Footer/theme field or item id so the editor can focus it.

### 15.4 Public failures

- Shell endpoint failure: use built-in LUWAG defaults.
- Category/collection failure: omit unresolved navigation without blanking the page.
- Logo request failure: use the generated wordmark/built-in square.
- Deleted target after publication: omit only that target and retain the rest of the shell.
- Theme failure: use current compile-time LUWAG tokens.

No public failure may prevent the main route content from rendering.

## 16. Migration and Compatibility

One additive Prisma/SQL migration:

1. creates the singleton shell table and append-only shell-asset registry;
2. seeds draft and published documents equivalent to current production Header/Footer and theme;
3. copies current support email/hours into the seeded Footer;
4. adds and assigns `STOREFRONT_SHELL_MANAGE` to `SUPER_ADMIN` through the existing RBAC mechanism;
5. retains existing SiteSetting contact columns for rollback compatibility.

The migration must use a bounded lock timeout and must not rewrite catalog, inventory, order, customer, marketing, Homepage, or Newsletter data.

Implementation coordinates the shared Prisma schema/generate window. Only the dedicated local test database may receive the migration during development. Production migration requires a separate release-risk approval and backup/rehearsal evidence.

Before first publication, and after migration, public output must remain structurally and visually equivalent to the current LUWAG shell.

## 17. Caching and Publication Visibility

After successful publication:

1. invalidate the shared storefront data tag;
2. invalidate the storefront layout/path scope needed by Next 16;
3. invalidate/revalidate the stable brand-mark response;
4. preserve the old published response until the transaction commits;
5. expose the new revision on the next navigation/refresh.

Save-draft and upload calls do not invalidate public caches.

## 18. Testing Strategy

### 18.1 Backend unit tests

Cover:

- schema/default normalization;
- exact current-LUWAG seeded document;
- draft-safe versus publish-strict validation;
- Header and Footer limits;
- structured internal link and HTTPS validation;
- live id/slug resolution and unavailable-target omission;
- color parsing, deterministic derivation, and contrast fixtures;
- fixed font enums and arbitrary CSS rejection;
- save/publish separation;
- CAS conflicts;
- atomic publication and SiteSetting compatibility mirroring;
- permission and anonymous boundaries;
- raw upload MIME/magic-byte/size/dimension/aspect checks;
- persistent-storage publication gate;
- public/default projection;
- cache revalidation calls.

### 18.2 PostgreSQL integration tests

Against the dedicated local database, prove:

- singleton creation and migration seed;
- CAS under competing clients;
- draft remains private;
- publish transaction atomically updates shell and compatibility fields;
- permission assignment;
- referenced target deletion/disable behavior;
- unrelated table row counts and representative hashes remain unchanged.

### 18.3 Frontend component tests

Cover:

- content-field editing;
- add/delete/reorder and keyboard alternatives;
- entity selection and label override;
- Logo upload/replacement/removal/fallback;
- upload locks;
- device and language switching without input loss;
- theme preview and contrast errors;
- save/publish distinction;
- 409 preservation and explicit reload;
- issue focusing;
- navigation-away warning;
- defaults restoration confirmation;
- admin permission filtering;
- production/preview shared Header/Footer presentation;
- inert preview with zero customer/tracking actions.

### 18.4 Full and browser gates

Run backend/frontend full tests, type checks, lint, builds, migration validation/diff, and focused integration suites.

Real browser verification uses normal role login and covers:

1. edit local document and verify public shell remains unchanged;
2. save draft and verify public shell remains unchanged;
3. preview saved draft at 1200/768/390;
4. upload real horizontal and square images;
5. publish content, links, Logos, colors, and fonts together;
6. verify the same shell on Homepage, category, collection, search, PDP, marketing LP, cart, checkout, login/account, and order tracking;
7. verify desktop Mega Menu and mobile drawer remain functional;
8. verify Footer links, email, and Track Order destination;
9. verify favicon/slow-load splash route and fallback;
10. verify insufficient contrast cannot publish;
11. verify 409 keeps local edits;
12. verify read-only/unauthorized roles cannot view or mutate drafts;
13. verify 390/768/1440 layouts have no root horizontal overflow;
14. verify no console/page errors and no cart, auth, marketing-visit, or order writes from preview.

Screenshots are visually inspected rather than treated as proof by capture alone.

## 19. Delivery and Risk Boundaries

Implementation follows RED → GREEN TDD and a written implementation plan after this spec is approved.

The current shared worktree contains concurrent Marketing, FAQ, Newsletter, Product Card, Bundle, and other changes. Implementation must:

- preserve all existing dirty work;
- use a dedicated scoped manifest/ledger;
- never restore or stage unrelated files wholesale;
- coordinate Prisma generate/migration windows;
- use separately owned local ports and the dedicated test database;
- avoid user/peer dev servers and production;
- perform a fresh final review and one TDD fix pass for Critical/Important findings.

No commit, push, merge, PR, production database migration, or deployment is implied by design approval. Release requires a separate scoped packaging and risk decision, including persistent brand-asset storage readiness.

## 20. Acceptance Criteria

The design is complete when all of the following hold:

- A permission-filtered Header & Footer entry exists independently of Homepage and Site Settings.
- Header/Footer, Logo assets, and base theme share one versioned draft/publish lifecycle.
- Saving never changes public output; publishing updates the complete shell atomically.
- Existing LUWAG output is the migration and runtime fallback.
- Header navigation can curate live category roots, collections, and structured links without copying category trees.
- Footer brand copy, columns, rows, contact content, and copyright are editable within bounded limits.
- Horizontal and square Logos upload through a shell-scoped secure path and fall back safely.
- The favicon can change after publication without rebuilding the frontend.
- The synchronous slow-load splash remains fast-path invisible and has a safe published-mark fallback.
- The five editable base colors and fixed font presets apply across all shopper routes but not admin.
- Derived state tokens are deterministic and meet enforced contrast rules.
- Production and preview share Header/Footer rendering; preview remains inert.
- Conflicts, invalid targets, missing assets, unsafe URLs, and poor contrast preserve drafts and cannot silently publish.
- Existing Site Settings no longer provide a competing support-contact write path.
- Schema changes are additive and leave commerce/marketing facts untouched.
- Full automated, integration, build, and real-browser gates pass before any release request.
