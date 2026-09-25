# Notifications V1 Design

**Date:** 2026-09-25  
**Status:** Approved for implementation after PDP UX Phase 1  
**Scope:** Permission-filtered, read-only notifications derived from existing database facts

## Goal

Replace the Admin header’s placeholder Bell with a real notification panel and full notifications page that surface current operational work. V1 derives facts at request time and does not pretend to provide durable unread history.

## Binding constraints

- No Notification table, Prisma schema edit, migration, destructive SQL, new dependency, or production database operation.
- No fake unread state, counts, timestamps, incidents, thresholds, campaigns, or schedule events.
- Backend permission checks are authoritative; frontend filtering is presentation only.
- All API behavior is read-only and must not change order, product, catalog, or media write contracts.
- Data categories without a current canonical source are omitted, not approximated.

## Data audit

### Supported in V1

| Notification | Existing source | Deep link | Required permission |
| --- | --- | --- | --- |
| Orders awaiting first confirmation | `Order.confirmationStatus = UNCONFIRMED` | `/admin/orders?confirmation=UNCONFIRMED` | `ORDER_CONFIRM` |
| Orders requiring manual review | `Order.confirmationStatus = NEEDS_REVIEW` | `/admin/orders?confirmation=NEEDS_REVIEW` | `ORDER_CONFIRM` |
| Products missing shared media | canonical `attentionWhere("missing_media")` | `/admin/products?attention=missing_media` | `PRODUCT_MANAGE` |
| Products with no priced SKU | canonical `attentionWhere("no_priced_sku")` | `/admin/products?attention=no_priced_sku` | `PRODUCT_MANAGE` |
| Products with incomplete shipping data | canonical `attentionWhere("incomplete_shipping")` | `/admin/products?attention=incomplete_shipping` | `PRODUCT_MANAGE` |
| Stale draft products | canonical `attentionWhere("stale_draft", now)` | `/admin/products?attention=stale_draft` | `PRODUCT_MANAGE` |

`ORDER_CONFIRM` is used for order work because the notification calls attention to confirmable work, not merely readable orders. This excludes Warehouse and Finance roles even though they can view all orders.

### Explicitly unsupported in V1

- Low inventory: no shared threshold/configuration exists; do not hard-code `10` or another number.
- Landing schedule: `ProductLandingPage` has no canonical schedule/start field.
- Campaign alerts: there is no Campaign model.
- Cross-device unread/read state: requires persistence and therefore schema work.
- Per-item event time: the current facts are aggregate states, not historical events, so no timestamp is shown.

## Backend contract

Add `GET /api/v1/admin/notifications` behind `JwtAuthGuard` with `Cache-Control: private, no-store`.

```ts
export type AdminNotificationKind =
  | "ORDER_UNCONFIRMED"
  | "ORDER_NEEDS_REVIEW"
  | "PRODUCT_MISSING_MEDIA"
  | "PRODUCT_NO_PRICED_SKU"
  | "PRODUCT_INCOMPLETE_SHIPPING"
  | "PRODUCT_STALE_DRAFT";

export interface AdminNotificationItem {
  kind: AdminNotificationKind;
  count: number;
  href: string;
}

export interface AdminNotificationsResponse {
  totalCount: number;
  items: AdminNotificationItem[];
}
```

Rules:

- Include an item only when its count is greater than zero and the active user has its required permission.
- `totalCount` is the sum of the returned active issue counts. A product matching two canonical attention predicates contributes one issue to each because those are two distinct actionable problems.
- Item order is deterministic: NEEDS_REVIEW, UNCONFIRMED, missing media, no priced SKU, incomplete shipping, stale draft.
- Query the active user and role permissions once. Missing or inactive users receive 403.
- Users with no supported notification permissions receive `{ totalCount: 0, items: [] }` and no domain count queries.
- Product counts must call the exported canonical `attentionWhere()` predicates. Do not duplicate shipping/readiness truth.
- Order counts use the existing `confirmationStatus` values.
- One domain query failure fails the whole response; do not show a partial count as complete.

## Frontend behavior

### Header Bell

Replace `NotificationBoundary` with `AdminNotifications` in the existing `notificationControl` slot.

- Fetch real data through `adminApi.notifications()`.
- Display `totalCount`; cap only the badge text visually as `99+`, while retaining the exact accessible label.
- Opening the panel refreshes the current derived response.
- Panel lists only returned categories, with localized factual copy and count.
- Each row is a typed internal link to the backend-provided allowlisted `/admin/` href.
- Include a link to `/admin/notifications`.
- Support loading, retryable error, honest empty state, Escape/outside-click close, focus return, and no horizontal overflow.
- Do not use “unread,” “read,” “new since,” or notification timestamps.

### Full page

Add `/admin/notifications` as a permission-backed hidden route. It renders the same response in a larger grouped list with current-state explanatory copy and the same deep links. It includes loading, retry, empty, and permission-filtered states.

The Admin shell may render this hidden route when the user has `ORDER_CONFIRM` or `PRODUCT_MANAGE`; the backend still decides which items are returned.

## Security and navigation

- Never trust or render arbitrary external hrefs. The frontend type guard accepts only the six exact route shapes in this contract.
- The backend returns only those fixed deep links.
- Existing Orders and Products pages already consume the `confirmation` and `attention` query parameters; V1 does not add new filter semantics.
- Responses are user-specific and non-cacheable.

## Verification and screenshots

Automated coverage must prove:

- exact counts and deterministic ordering;
- canonical `attentionWhere()` reuse;
- `ORDER_CONFIRM` versus `ORDER_VIEW_ALL` filtering;
- `PRODUCT_MANAGE` filtering;
- unsupported/empty user avoids domain queries;
- inactive/missing user 403;
- no-store header and JWT guard;
- frontend allowlist, loading/error/empty/results, badge, keyboard dismissal, focus return, and full-page deep links;
- real-stack Admin versus Warehouse/Optimizer permission matrix and deep-link filtering.

Browser verification captures the populated Bell panel and full page at 1440 and 1920 widths, checks mobile header behavior, console/page errors, hydration, and horizontal overflow.

## Out of scope

- Persistent read/unread semantics
- Push/email/SMS notifications
- Polling or background workers
- Inventory thresholds
- Campaign or landing schedule models
- Schema/migration changes
- Push, merge, PR, or production deployment
