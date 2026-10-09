# Homepage Complete Preview and Rich Announcement Design

**Date:** 2026-10-09  
**Status:** Approved in design review  
**Branch:** `feature/homepage-builder`

## 1. Context

The Homepage Builder currently renders only the editable homepage sections inside its central live preview. It does not render the storefront announcement bar, header/navigation, footer, or the fixed storefront chrome. The existing announcement editor supports plain text, colors, scheduling, one structured link, and rotation, but does not support rich text or an activity countdown.

The required outcome is a continuous, internally scrollable preview of the complete storefront homepage:

```text
Announcement Bar
Header / Navigation
Homepage Sections
Footer
+ Cart Drawer (closed)
+ Messenger
+ Mobile Tab Bar
+ Back To Top
```

The preview must render the current unsaved homepage document in real time while remaining inert: it must not navigate, search, authenticate, read a real cart, contact Messenger, emit tracking, or mutate customer state.

The announcement bar must support an optional per-item countdown. The chosen visual is the compact inline treatment:

- Desktop: `1 DAY 02 HR 06 MIN 44 SEC`
- Mobile: `1D 02H 06M 44S`

When the countdown expires, the entire announcement item disappears. The next active item takes over immediately; if no active item remains, the whole announcement bar disappears.

The announcement authoring UI will use a mature full typography editor, with a separate structured CTA picker and separate generated-countdown style controls.

## 2. Goals

1. Reuse one storefront-shell presentation across production, full-screen draft preview, and the embedded Homepage Builder live preview.
2. Render the full page from announcement through footer, including the complete visible storefront chrome.
3. Keep embedded preview controls visually faithful but operationally inert.
4. Add a safe rich-text announcement model without storing arbitrary HTML.
5. Add an optional, styleable, absolute-deadline countdown to each announcement item.
6. Preserve existing drafts, published versions, preview tokens, schedules, links, Promo Banner, Countdown Banner, and Hero countdown behavior.
7. Keep the existing V2 JSON document and `schemaVersion: 1`; do not create a second CMS or a relational announcement model.
8. Require no Prisma schema change or SQL migration.
9. Provide exact validation issues that can return the operator to the affected announcement item.
10. Prove behavior through backend, frontend, browser, and E2E tests before stopping at the local review gate.

## 3. Non-goals

- Editing Header, Footer, Messenger, mobile navigation, cart, or site settings inside Homepage Builder.
- Making storefront controls functional inside the embedded or token preview.
- Reading customer authentication, cart, search history, or recently viewed state in preview.
- Adding inline links inside rich text; links remain a dedicated CTA.
- Supporting arbitrary HTML, arbitrary CSS, scripts, embeds, images, video, tables, code blocks, or third-party fonts in announcements.
- Changing the semantics of `PROMO_BANNER`, `COUNTDOWN_BANNER`, or `HeroSlideCountdown`.
- Changing production data, pushing, merging, opening a PR, or deploying in this phase.

## 4. Fixed Product Decisions

### 4.1 Full shell

The embedded preview includes all storefront chrome:

- Announcement bar
- Header and navigation
- Search, account, and cart affordances
- Footer
- Messenger affordance
- Mobile tab bar
- Back-to-top affordance
- Cart drawer in its normal closed state

The embedded preview uses complete visual presentation but no operational behavior.

### 4.2 Personalized content

`RecentlyViewed` remains absent in preview because preview intentionally has no visitor localStorage or product-history context. This matches a first-time storefront visitor. Production continues to render `RecentlyViewed` according to its existing local state.

### 4.3 Announcement expiry

At `now >= effectiveDeadline`, the announcement item is inactive. `effectiveDeadline` is the earlier of:

- the countdown `endsAt`, and
- the item schedule `unpublishAt`.

Expiry removes the whole item; it never leaves `00:00:00` behind and never leaves an empty bar.

### 4.4 Rich text

The chosen authoring experience is a full typography editor rather than a plain input or a minimal inline toolbar. It remains constrained to content that can safely fit an announcement bar.

The selected link model is a separate CTA controlled by the existing structured `LinkPicker`; rich text cannot contain links.

## 5. Shared Storefront Shell Architecture

### 5.1 New presentational boundary

Introduce a shared `StorefrontShell` with a data-only interface:

```ts
type StorefrontShellMode = "STOREFRONT" | "PREVIEW";
type StorefrontPreviewDevice = "desktop" | "tablet" | "mobile";

type StorefrontShellProps = {
  mode: StorefrontShellMode;
  previewDevice?: StorefrontPreviewDevice;
  announcement: AnnouncementBlockView | null;
  navItems: NavItem[];
  footerCollections: Array<{ id: string; slug: string; name: string }>;
  settings: SiteSettings;
  children: ReactNode;
  previewScrollRoot?: RefObject<HTMLElement | null>;
};
```

The component owns only page composition. It does not fetch.

```text
StorefrontShell
├─ AnnouncementBar
├─ Header
├─ main
│  └─ children
├─ Footer
├─ CartDrawer / inert closed equivalent
├─ MessengerChat / inert preview equivalent
├─ MobileTabBar / inert preview equivalent
└─ BackToTop / preview-scroll-root equivalent
```

### 5.2 Production mode

`app/(storefront)/layout.tsx` continues to load categories, collections, settings, and announcement data on the server. It continues to own:

- `Providers`
- `MetaPixelInit`
- customer auth/cart providers
- real interactive controllers
- tracking and production navigation behavior

It passes already-loaded view data to `StorefrontShell mode="STOREFRONT"`.

### 5.3 Preview mode

`StorefrontShell mode="PREVIEW"` renders the same visual view components but never mounts provider-dependent controllers.

Each interactive shell component is split at the controller/view boundary where necessary:

```text
Interactive controller ─┐
                        ├─ shared view/presentation
Inert preview adapter ──┘
```

This avoids conditional hook misuse and prevents preview from requiring production providers.

Preview mode guarantees:

- no auth refresh or `/me` request;
- no cart localStorage read or cart request;
- no product search request;
- no Messenger navigation;
- no Pixel, homepage tracking, or JSON-LD;
- no link prefetch;
- no navigation;
- no portal mounted into `document.body`;
- no mutation of customer state.

Header menus, search overlays, and cart drawer remain closed. Their triggers are visible but inert.

### 5.4 Fixed and sticky positioning

In production, fixed/sticky behavior remains relative to the browser viewport.

In embedded preview:

- Header sticky behavior is relative to the internal preview scroll root.
- Messenger, mobile tab bar, and back-to-top are positioned inside the simulated device viewport.
- Back-to-top visibility reads the internal scroll root, not `window.scrollY`.
- Preview overlays must never escape into the admin document body.
- The existing admin page itself must remain at `window.scrollY === 0` while preview content scrolls.

## 6. Preview Shell Data Flow

### 6.1 Embedded live preview

Add one client-side `usePreviewShellData` owner above or inside `HomepageLivePreview`. It loads shell data once per editor mount from public storefront endpoints:

```ts
Promise.all([
  api.getCategories(),
  api.getCollections(),
  api.getSiteSettings(),
]);
```

A browser-safe public `api.getSiteSettings()` helper is added; the server-only `fetchSiteSettings()` remains server-only.

The hook:

- caches the in-flight/result promise to survive development Strict Mode;
- uses `AbortController` on final unmount;
- maps categories and collections through the existing `buildNav()`;
- filters navigation collections for Footer;
- falls back to empty navigation and `DEFAULT_SITE_SETTINGS` on failure;
- never depends on the changing homepage draft, so text/style edits do not refetch shell data.

Do not use `adminApi.getSettings()`: it requires `SYSTEM_SETTINGS_EDIT` and would incorrectly restrict Homepage Builder to SUPER_ADMIN users.

### 6.2 Draft announcement view

The embedded preview derives `AnnouncementBlockView` directly from the current unsaved `HomepageDocument.announcement`.

Because all preview links are inert, it does not need to resolve draft link entities to live hrefs. It preserves CTA text and renders a non-navigating visual target.

### 6.3 Full-screen token preview

`/preview/homepage?token=...` continues to fetch the token-protected draft homepage and announcement with `private, no-store`. It also loads the same server-side shell data as production and renders `StorefrontShell mode="PREVIEW"`.

It remains outside the production route group so it does not inherit tracking/providers. It renders the full page, not only announcement plus sections.

### 6.4 Production storefront

The published storefront continues to use backend-resolved links and effective published versions. Extraction of the shared shell must not add a second fetch or change cache tags/revalidation.

## 7. Responsive Preview Contract

`DeviceFrame` uses transformed fixed-size child canvases, so CSS media queries observe the admin browser viewport rather than the simulated child width. Shell components therefore receive an explicit `previewDevice` and cannot rely only on `sm/md/lg/xl` classes in preview mode.

The shared views support both modes:

- Production: existing media-query behavior.
- Preview: deterministic classes/markup selected by `previewDevice`.

### Desktop

- Full desktop navigation and search appearance
- Three-column Footer
- Full countdown units: `DAY / DAYS`, `HR`, `MIN`, `SEC`

### Tablet

- Explicit tablet navigation/layout
- Tablet Footer arrangement
- Full English units unless available width requires the compact formatter

### Mobile

- Hamburger/navigation affordance
- Mobile header composition
- Mobile Footer composition
- Mobile tab bar visible
- Compact countdown units: `D`, `H`, `M`, `S`

Device changes retain the selected section and recompute the internal scroll position after layout settles.

## 8. Announcement Rich Text Contract

### 8.1 Backward-compatible item shape

Extend the existing item with optional fields:

```ts
type AnnouncementItem = {
  id: string;
  text: string;
  content?: AnnouncementRichTextDocument;
  link: LinkValue | null;
  linkLabel: string | null;
  textColor: string;
  backgroundColor: string;
  schedule: Schedule;
  countdown?: AnnouncementCountdownConfig | null;
  enabled: boolean;
  sortOrder: number;
};
```

`text` remains required and is always the plain-text projection of `content`. It serves as:

- compatibility fallback;
- accessible text source;
- safe fallback for older frontend/backend versions;
- the existing 200-character validation target.

Existing documents without `content` or `countdown` remain valid under `schemaVersion: 1`.

### 8.2 Canonical rich document

```ts
type AnnouncementRichTextDocument = {
  version: 1;
  doc: {
    type: "doc";
    content: AnnouncementParagraphNode[];
  };
};

type AnnouncementParagraphNode = {
  type: "paragraph";
  attrs: {
    textAlign: "left" | "center" | "right";
  };
  content: AnnouncementTextNode[];
};

type AnnouncementTextNode = {
  type: "text";
  text: string;
  marks?: AnnouncementTextMark[];
};

type AnnouncementTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | {
      type: "textStyle";
      attrs: {
        color?: string;
        fontFamily?: "SANS" | "POPPINS";
        fontSize?: "XS" | "SM" | "MD" | "LG";
      };
    }
  | {
      type: "highlight";
      attrs: {
        color: string;
      };
    };
```

Token mapping:

```text
SANS     -> var(--font-sans)
POPPINS  -> self-hosted Poppins display face, weight 700
XS       -> 11px
SM       -> 12px
MD       -> 14px
LG       -> 16px
```

Constraints:

- one or two paragraph nodes;
- total plain-text length at most 200;
- no empty unknown nodes;
- no duplicate/unknown marks;
- colors must match the existing six-digit hex contract;
- at least one text-style attribute when the mark exists;
- no hard breaks, headings, lists, blockquotes, code, images, video, tables, embeds, HTML, style strings, or arbitrary font names;
- responsive rendering caps the message region at two visual lines with ellipsis; the editor displays the exact preview so truncation is visible before publication.

### 8.3 Editor implementation

Use Tiptap 3.x in a client-only leaf component with `immediatelyRender: false`.

Install only required extensions rather than `StarterKit`:

- document
- paragraph
- text
- bold
- italic
- underline
- strike
- history/undo-redo
- text style
- color
- multicolor highlight
- text align
- controlled font-family and font-size extensions

The editor toolbar exposes:

- Storefront Sans / Poppins Display
- 11 / 12 / 14 / 16px
- bold / italic / underline / strike
- text color
- highlight color
- left / center / right alignment
- undo / redo
- clear formatting

Paste handling strips unsupported blocks, marks, attributes, scripts, inline styles, and embeds before writing canonical JSON.

The renderer maps validated nodes and marks to React elements. It never uses `dangerouslySetInnerHTML`.

### 8.4 Separate CTA

Rich text has no link mark.

The existing structured `link` and `linkLabel` remain the sole CTA source. New rich-text items render the CTA as a separate sibling link after the message/countdown.

For a rich-text item, `link !== null` requires a non-empty `linkLabel` at publish time. Add:

```text
ANNOUNCEMENT_CTA_LABEL_REQUIRED
```

Legacy items without `content` keep current whole-item-link behavior so existing published versions do not change visually.

## 9. Countdown Contract

```ts
type AnnouncementCountdownConfig = {
  endsAt: string | null;
  color: string | null;
  fontFamily: "SANS" | "POPPINS";
  fontSize: "SM" | "MD" | "LG";
  fontWeight: 400 | 500 | 600 | 700 | 800;
};
```

- `countdown` absent/null: countdown disabled.
- `countdown` present with `endsAt: null`: valid draft, not publish-ready.
- color null: inherit item text color.
- generated timer is not stored in rich content.
- Desktop formatter is always English and uses `DAY`/`DAYS`, `HR`, `MIN`, `SEC`.
- Mobile formatter is always English and uses `D`, `H`, `M`, `S`.
- Admin language does not change storefront units.

Runtime uses absolute time:

- recompute parts from `Date.now()`;
- tick once per second;
- schedule an exact deadline timeout;
- recalibrate on `visibilitychange`;
- clear interval/timeout/listener on changes and unmount;
- use stable hydration output;
- never announce every second through an aria-live region.

The active announcement list applies:

```text
item.enabled
AND schedule.publishAt <= now
AND (schedule.unpublishAt == null OR now < schedule.unpublishAt)
AND (countdown == null OR countdown.endsAt == null OR now < countdown.endsAt)
```

Published data can never contain an enabled countdown with a null/expired deadline because the publish gate blocks it. The defensive frontend predicate protects stale caches and malformed payloads.

When the active item expires:

1. remove it from the client active list;
2. clamp/advance the rotation index;
3. immediately display the next active item;
4. render `null` if no item remains.

## 10. Backend Validation and Storefront Delivery

### 10.1 Schema

Extend `announcementItemSchema` with strict optional `content` and `countdown` schemas. Optionality preserves all historic JSONB documents and versions.

No Prisma model, column, relation, migration, or backfill is required because:

- `HomepageDocument.draft` is JSON;
- `HomepageVersion.document` is JSON;
- announcement items have no relational columns.

### 10.2 Publish validation

Draft save validates structural JSON but permits incomplete countdown dates.

For enabled items, publish validation emits blocking issues:

```text
ANNOUNCEMENT_CONTENT_INVALID
ANNOUNCEMENT_CTA_LABEL_REQUIRED
ANNOUNCEMENT_END_REQUIRED
ANNOUNCEMENT_END_NOT_FUTURE
ANNOUNCEMENT_WINDOW_EMPTY
```

Rules:

- structural JSON is always schema-validated on draft save;
- publish-readiness countdown/link/content issues apply only when the announcement block and item are both enabled;
- disabled blocks/items may keep incomplete countdown configuration without blocking publish;
- canonical rich content must parse strictly;
- derived plain text must equal `text` after normalization;
- plain text length remains at most 200;
- a rich item with a link requires a CTA label;
- countdown config requires a finite valid ISO datetime at publish;
- `endsAt` must be later than validation time;
- if item `publishAt` exists, `endsAt > publishAt`;
- the effective interval must not be empty;
- existing link-target validation remains unchanged.

Add to `PublishIssue`:

```ts
announcementItemId?: string;
```

Every announcement-specific issue includes the affected item id. `PublishPanel` selects the announcement pseudo-node and scrolls to `data-item-id` after closing the dialog.

Low foreground/background contrast is a warning, not a draft error. Publishing uses the existing warning confirmation flow.

### 10.3 Storefront service

`storefrontGetAnnouncement()` additionally filters expired countdown items at the single captured `now`, then sorts and resolves links as before.

The response includes `content`, `countdown`, schedule information needed for client expiry, and resolved CTA `linkHref`.

The published and matching preview-token paths share identical filtering and projection. A malformed, expired, or revision-mismatched token retains the existing fallback behavior.

## 11. Announcement Renderer

`AnnouncementBar` becomes responsible for:

- defensive item normalization;
- active schedule/deadline filtering;
- rotation and hover pause;
- reduced-motion behavior;
- rich-text React rendering;
- compact countdown formatting;
- separate CTA rendering;
- preview-device layout;
- inert preview presentation.

Visual order for rich items:

```text
Rich message · Countdown · CTA
```

The separator is present only between rendered siblings.

Legacy plain items keep their existing rendering path.

Accessibility:

- stable bar accessible name includes message, countdown deadline summary, and CTA;
- timer receives `role="timer"` with a stable English label;
- seconds update visually without per-second live announcements;
- color is never the only indication of CTA/interactivity;
- keyboard focus exists only in real storefront mode;
- preview mode removes interactive semantics or intercepts them before navigation.

## 12. Admin Editing Experience

`AnnouncementSettings` continues to manage block enablement, rotation, item enablement, schedule, colors, ordering, duplication/removal, and structured CTA.

Each item adds:

1. Tiptap rich-text editor;
2. item background/default text color controls;
3. countdown enable toggle;
4. `datetime-local` deadline;
5. countdown color;
6. countdown font family;
7. countdown size;
8. countdown weight;
9. immediate expiry/window/contrast messages;
10. inline device preview for the current item.

The editor remains buffered/race-safe:

- local editor state belongs to item id;
- switching items flushes or cancels correctly;
- one typing burst creates one reducer commit where practical;
- undo/redo in Tiptap does not conflict with Homepage Builder global undo shortcuts;
- Cmd/Ctrl+S still saves the homepage draft;
- editor-specific keyboard events do not trigger section-level shortcuts.

## 13. Selection and Scroll Behavior

The announcement pseudo-node becomes a real preview target with a stable data attribute.

- Selecting announcement scrolls the internal preview to the absolute top and highlights the bar.
- Selecting a homepage section uses the existing context-preserving centering logic, now accounting for announcement/header height.
- A selected section already fully visible remains still.
- Final sections clamp against the complete page bottom, including Footer.
- Device switching repositions the selected target after the device-specific shell layout settles.
- Footer remains view-only and is managed through Site Settings.

## 14. Error and Fallback Behavior

### Shell data failure

- Categories fail: empty category navigation.
- Collections fail: omit collection links/Footer collection list.
- Settings fail: `DEFAULT_SITE_SETTINGS`.
- Homepage draft remains editable and visible.
- One readable non-blocking preview notice may be shown in admin; production behavior is unchanged.

### Malformed rich content

- Draft API rejects structurally invalid content.
- Frontend normalization falls back to safe plain `text` for stale/corrupt responses.
- Renderer never renders unknown nodes/marks.

### Countdown failure

- Invalid/null countdown deadline in a draft shows the item without a timer plus an editor warning.
- Published API defensively removes impossible expired countdown items.
- Client also removes stale cached items at deadline.

## 15. Testing Strategy

### 15.1 Backend unit/integration tests

Cover:

- legacy item without optional fields;
- null/valid/invalid countdown config;
- strict rich document nodes, marks, attributes, colors, fonts, sizes, paragraphs, and total text length;
- unknown-node and arbitrary-style rejection;
- plain-text projection equality;
- rich CTA label requirement;
- countdown deadline now - 1ms, exact now, and now + 1ms;
- `endsAt <= publishAt` empty-window rejection;
- `unpublishAt` earlier than `endsAt`;
- disabled item exemption where appropriate;
- announcement-specific issues include `announcementItemId`;
- storefront filtering/sorting/link hydration remains immutable;
- one expired item switches out without removing valid siblings;
- all expired items return null;
- matching preview-token and published behavior;
- malformed/revision-mismatched token fallback;
- no Prisma migration.

### 15.2 Frontend unit/component tests

Cover:

- Tiptap initializes from legacy text;
- Tiptap writes canonical JSON and synchronized fallback text;
- paste strips scripts, unsupported HTML, lists, images, tables, inline CSS, arbitrary fonts, and links;
- supported typography round-trips;
- item switching does not cross-write;
- editor/global shortcut isolation;
- countdown styles and English unit formatting;
- exact expiry and visibility-change recalibration;
- active-index clamp/next-item transition;
- reduced-motion rotation behavior;
- hydration-safe initial output;
- rich CTA sibling rendering and legacy whole-link compatibility;
- contrast warning;
- shell production and preview modes;
- all preview controls inert;
- no provider-dependent calls in preview;
- explicit desktop/tablet/mobile layouts;
- fixed/sticky elements stay within preview root;
- announcement/section scroll positioning;
- shell-data fallback.

### 15.3 Browser and E2E

Use isolated rehearsal services/database only. Verify:

1. Add/edit/reorder/delete rich announcement items.
2. Apply font, size, bold/italic/underline/strike, text/highlight colors, and alignment.
3. Configure separate CTA and countdown styles.
4. Save/reload preserves JSON and fallback text.
5. Version restore preserves rich content/countdown.
6. Empty/past countdown can save draft but blocks publish.
7. Future countdown publishes.
8. Announcement disappears at deadline without reload and next item appears without blank time.
9. Embedded preview shows Announcement, Header, all homepage sections, Footer, and all selected shell chrome.
10. Full-screen token preview shows the same structure.
11. Desktop 1440×900, Tablet 768×1024, Mobile 390×844 have no horizontal overflow.
12. Mobile tab bar/Messenger/BackToTop stay inside the preview frame.
13. Preview links, search, account, cart, and Messenger do not navigate or request.
14. No `/me`, cart, search, Pixel, or tracking request occurs.
15. Outer admin `window.scrollY` remains zero.
16. No console, hydration, or accessibility errors.
17. Capture desktop/tablet/mobile screenshots for visual review.

E2E cleanup restores the original draft/version and removes test versions even when a test fails. It never connects to production.

## 16. Expected File Boundaries

### Backend

- `backend/src/modules/cms/homepage-document.ts`
- `backend/src/modules/cms/homepage-validation.ts`
- `backend/src/modules/cms/homepage.service.ts`
- related document/validation/service/controller specs

No changes to:

- Prisma homepage models
- migrations
- legacy homepage enum/tables
- `backend/uploads/`

### Frontend model/editor

- `frontend/package.json`
- `frontend/pnpm-lock.yaml`
- `frontend/src/lib/homepage-document.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/admin-api.ts`
- new rich-text normalization/render helpers
- `AnnouncementSettings.tsx`
- new client-only announcement editor
- editor/document/api specs

### Frontend storefront shell

- new shared `StorefrontShell`
- `app/(storefront)/layout.tsx`
- `app/preview/homepage/page.tsx`
- `AnnouncementBar.tsx`
- `Header.tsx`
- `MainNav.tsx`
- `SiteSearch.tsx`
- `Footer.tsx`
- `MessengerChat.tsx`
- `MobileTabBar.tsx`
- `BackToTop.tsx`
- relevant shell/announcement specs

### Frontend admin preview

- `HomepageEditor.tsx`
- `HomepageLivePreview.tsx`
- new preview-shell-data hook
- `ModuleTree.tsx` / `PublishPanel.tsx` only for item targeting
- Homepage Editor/Live Preview specs
- `frontend/e2e/homepage-builder.spec.ts`

## 17. Implementation and Review Boundaries

Implementation will be planned as four independently reviewable local commits:

1. **Announcement document contract** — backend/frontend schemas, validation, storefront filtering, compatibility tests.
2. **Rich editor and announcement renderer** — Tiptap, canonical JSON, countdown UI/runtime, component tests.
3. **Shared complete storefront shell** — production extraction, inert preview adapters, explicit device rendering, shell data loading.
4. **E2E and review closure** — full lifecycle, screenshots, network/console checks, cleanup hardening.

Every behavior change follows RED → GREEN TDD. After all tasks:

- run backend full test/lint/build;
- run frontend full test/typecheck/lint/build;
- run targeted homepage E2E;
- run browser verification at all three devices;
- run fresh-context whole-branch review;
- fix every Critical/Important finding in one TDD fix pass;
- stop at the local review gate.

No push, merge, PR, production data change, or deploy occurs without separate authorization.

## 18. Acceptance Criteria

The design is complete when all of the following are true:

- Embedded preview visibly starts with the current draft Announcement Bar and Header.
- It contains every enabled homepage section in order and ends with the real Footer.
- Requested fixed shell chrome appears in its correct simulated-device location.
- Preview remains fully inert and emits no customer/tracking side effects.
- Header/Footer visual changes are shared with production rather than copied.
- Announcement content supports the approved rich typography toolbar and safe structured storage.
- Generated countdown colors/fonts are editable separately from rich message content.
- Countdown output uses only English units.
- Expiry removes the entire item and switches without blank space.
- Existing plain announcements and historical versions remain valid and visually compatible.
- No SQL migration is introduced.
- All automated and browser checks are green, with any pre-existing unrelated warnings reported accurately.
