# J&T Express Tracking Integration Design

**Date:** 2026-10-28
**Status:** Approved for implementation planning
**Scope:** Poll J&T Express PH open platform for waybill traces, store them as logistics events, auto-sign delivered shipments, and show carrier wording plus rider phone on the guest order page.

## Goal

Stop asking customer service to type carrier events by hand. Once a shipment leaves the warehouse with a J&T waybill number, the site pulls the carrier's own scan trail every 30 minutes, records each scan as an append-only logistics event, signs the shipment automatically when J&T reports `Delivered`, and shows the shopper J&T's wording and the rider's phone number on `/track-order`.

## Non-goals

- No `order/addOrder` (J&T order creation), no `order/printOrder` (label PDF), no `billCode/getBatchBillCode`.
- No `trace/subscribe` webhook. Polling only; nothing has to be registered on J&T's side.
- No COD settlement / `settlementReturn`, no interception API, no address dictionary or `network/getInfo` coverage check.
- No change to how waybill numbers are entered. Staff still type the tracking number in the workbench.
- No signature photo shown to guests. It is stored for admin reference only.

## Which J&T API this targets

Two separate J&T PH APIs exist and must not be mixed:

| | Old (`ylopen.jtexpress.ph/docs`) | **Open platform (this spec)** |
| --- | --- | --- |
| Auth | `eccompanyid` + `key`, `logistics_interface` + `data_digest` | headers `apiAccount` / `timestamp` / `digest`, form field `bizContent` |
| Host | `test-api.jtexpress.ph` | `openapi.jtexpress.ph/webopenplatformapi/api` |

Prerequisites the business must obtain from J&T before this can run in production:

- `apiAccount` (the five-digit account id shown in the console; the example in the docs is `640826271705595946` and is **not** ours)
- `privateKey`
- `customerCode` (customer number issued by the shipping branch)
- the customer's plaintext password
- confirmation that the account is on the **open platform**, not the old `ylopen` one

Without all four credentials the integration stays disabled; it must never fire a request with an empty secret.

### Endpoint used

`POST {base}/logistics/trace`

Headers: `apiAccount`, `digest`, `timestamp` (epoch milliseconds, UTC+8).

Body: `application/x-www-form-urlencoded` with a single field `bizContent` containing JSON:

```json
{ "customerCode": "…", "digest": "…", "billCode": "JT0000008101561" }
```

Two independent signatures:

```
passwordCipher = MD5(customerPassword + "jadada236t2").toUpperCase()
bodyDigest     = base64(MD5(customerCode + passwordCipher + privateKey))
headerDigest   = base64(MD5(bizContentJson + privateKey))
```

Both MD5 outputs are raw bytes (not hex) before base64. The header digest signs the exact `bizContent` string that is sent, so the client must serialise once and reuse the same string for signing and for the body.

### Response shape

```json
{
  "code": "1",
  "msg": "success",
  "data": {
    "billCode": "JT0000008101561",
    "details": [
      {
        "scanTime": "2026-05-09 09:57:32",
        "desc": "Your package has been Delivered",
        "scanTypeName": "Delivered",
        "scanTypeCode": "113",
        "staffConcatPhone": null,
        "scanNetworkProvince": "METRO-MANILA",
        "scanNetworkCity": "TAGUIG",
        "scanNetworkArea": "CENTRAL SIGNAL VILLAGE",
        "sigPicUrl": "https://…",
        "timeZone": "UTC+8"
      }
    ]
  },
  "requestId": "…"
}
```

`details` is returned newest-first. `scanTime` carries no zone suffix; it is UTC+8, which is also Philippine local time, so it is parsed as `+08:00` and stored as an absolute instant.

## Status mapping

| `scanTypeCode` | J&T name | `LogisticsEventStatus` |
| --- | --- | --- |
| 106 | Picked Up | `SHIPPED` |
| 109 | Departure | `IN_TRANSIT` |
| 110 | Arrival | `IN_TRANSIT` |
| 112 | Out for Delivery | `OUT_FOR_DELIVERY` |
| 113 | Delivered | `SIGNED` |
| 116 | For Return | `RETURNING` |
| 117 | Return Delivered | `RETURNED` |
| 118 | Problematic | `FAILED_DELIVERY` |

Anything else is **not** stored as an event. An unknown code is logged with `billCode`, code and description, and skipped — a node we cannot classify must not reach the order state machine.

## Backend module

New module `backend/src/modules/jt/`, mirroring the shape of `modules/qianyi/`:

### `jt.config.ts`

Reads `jt.*` from the validated env tree. `enabled` is derived, never trusted alone:

```
enabled = JT_ENABLED === 'true'
       && JT_API_ACCOUNT && JT_PRIVATE_KEY && JT_CUSTOMER_CODE && JT_CUSTOMER_PASSWORD
```

| Env var | Default | Notes |
| --- | --- | --- |
| `JT_ENABLED` | `false` | Gate |
| `JT_BASE_URL` | `https://openapi.jtexpress.ph/webopenplatformapi/api` | Demo host swapped in for testing |
| `JT_API_ACCOUNT` | — | Digits |
| `JT_PRIVATE_KEY` | — | Secret |
| `JT_CUSTOMER_CODE` | — | Customer number |
| `JT_CUSTOMER_PASSWORD` | — | Used only to derive the body digest |
| `JT_POLL_MINUTES` | `30` | Worker cadence |
| `JT_CARRIER_NAME` | `J&T Express` | Exact carrier label written by the ship dialog |

Env validation follows `config/env.validation.ts`: every `JT_*` optional, plus conditional "required when `JT_ENABLED=true`" checks like the existing `QIANYI_*` block. A half-configured deployment must fail fast at boot rather than run with blanks.

### `jt.client.ts`

One responsibility: sign and send. Methods for this release: `trace(billCode): Promise<JtTraceDetail[]>`. No persistence, no logging of raw payloads beyond an error summary.

- 15 s timeout, single attempt; retries are the worker's job, not the client's.
- Error taxonomy: `JtNetworkError` (DNS/timeout/5xx), `JtBusinessError` (HTTP 200 with `code !== "1"`, carrying `msg` and `requestId`), `JtSignatureError` (a business error whose `msg` indicates signing, surfaced separately so a bad key is obvious in the status card).
- `appAccount` in the docs is a typo for `apiAccount`; the header name is `apiAccount`.

### `jt-tracking.mapper.ts`

Pure functions, no I/O:

- `mapScanType(code: string): LogisticsEventStatus | null`
- `toEventInput(detail): RecordLogisticsEventInput` with
  `externalEventId = "${scanTypeCode}:${scanTime}"`,
  `externalStatus = scanTypeName`,
  `eventTime = parseScanTime(scanTime)`,
  `province = scanNetworkProvince`, `city = scanNetworkCity`.

`externalEventId` is stable across polls, which is what makes ingestion idempotent against the existing `(shipment_id, external_event_id)` unique constraint.

### `jt-tracking.service.ts`

Worker owns all writes. `OnModuleInit` / `OnApplicationShutdown`, `setInterval` + `unref()`, `running` re-entrancy guard, and the same `NODE_ENV === 'test'` short-circuit as `QianyiSyncService`.

Each tick:

1. Select candidates:
   ```sql
   shipments
   WHERE status = 'SHIPPING'
     AND tracking_number IS NOT NULL
     AND lower(carrier) = lower(:carrierName)
     AND (tracking_checked_at IS NULL OR tracking_checked_at <= now - backoff)
   ORDER BY shipped_at ASC
   LIMIT 25
   ```
2. For each candidate, serial with a 200 ms gap: call `trace`, map details, insert events.
3. Insert via `LogisticsEventService.record()` so the append-only rules and the idempotency key stay in one place. Extend `RecordLogisticsEventInput` with `description`, `staffContact`, `signatureImageUrl`.
4. Auto-sign (see below).
5. Stamp `tracking_checked_at`, clear `tracking_error`, reset `tracking_failures` on success; on failure increment `tracking_failures` and store a truncated error message.

Backoff by `tracking_failures`: 0 → next tick, 1 → 1 h, 2 → 6 h, ≥3 → 24 h. Shipments shipped more than 30 days ago are polled at most once a day regardless. Terminal shipments (`SIGNED`, `RETURNED`, `PARTIALLY_RETURNED`) are never polled.

### Auto-sign

After ingesting a shipment's events:

```
newest = max(events by eventTime)
if newest.normalizedStatus === 'SIGNED'
   and shipment.status === 'SHIPPING'
   and order.orderStatus === 'SHIPPING'
then ordersService.sign(orderId, shipmentId, null, { source: 'CARRIER' })
```

- Return and problem codes (116/117/118) only record events. Returns must go through RTO acceptance, which counts goods back into stock; a scan trail must never skip that.
- If the order is not `SHIPPING` (already signed, after-sales, returned, cancelled) the scan is still recorded and the skip is logged — J&T data is a fact even when we cannot act on it.
- `OrdersService.sign` gains an optional fourth argument `{ source?: 'ADMIN' | 'CARRIER'; comment?: string }` defaulting to `'ADMIN'`, and `operatorId` becomes `string | null`. The status-history source and the order note say the carrier drove the transition, so a human action and a machine action stay distinguishable in audit. Existing callers are unchanged.

## Schema changes

One additive migration, `20261028170000_add_jt_tracking_detail`:

```sql
ALTER TABLE logistics_events
  ADD COLUMN external_description TEXT,
  ADD COLUMN staff_contact VARCHAR(40),
  ADD COLUMN signature_image_url TEXT;

ALTER TABLE shipments
  ADD COLUMN tracking_checked_at TIMESTAMPTZ(3),
  ADD COLUMN tracking_error VARCHAR(300),
  ADD COLUMN tracking_failures INTEGER NOT NULL DEFAULT 0;
```

No new tables, no changes to `orders`. All writes are additive; disabling the integration leaves existing data valid.

## Admin surface

- `POST /admin/orders/:id/shipments/:shipmentId/tracking/refresh` — permission `SHIPMENT_CREATE`, same path style as the existing `…/events` and `…/sign` routes. Ignores backoff, performs one fetch, returns `{ appended, skipped, signed, error }`. Returns `409` when the integration is disabled so the button can explain why nothing happened.
- `GET /admin/jt/status` — `{ enabled, lastTickAt, lastFetched, lastFailed, pendingShipments, lastError }`, rendered as a `JtTrackingHealthCard` next to the existing `MetaCapiHealthCard` on `/admin/status`. Reuses the system-status permission.
- `FulfillmentDialog` ship form gets a `J&T Express` preset button for the carrier field; the free-text field stays, and the tracking number stays manual.
- `LogisticsEventDialog` shows, per event, J&T's raw description, the rider phone and a link to the signature photo — admin only.

## Guest surface

`OrdersService.guestOrder()` currently maps events to `{ status, at }`. It gains:

```ts
tracking: events.map(e => ({
  status: e.normalizedStatus,
  at: iso(e.eventTime),
  description: personalDetailsIncluded ? e.externalDescription : null,
  riderPhone: personalDetailsIncluded ? e.staffContact : null,
}))
```

`personalDetailsIncluded` is already computed by the guest lookup (true only when the shopper was matched by phone, not by order number alone). The flag must be threaded into `guestOrder()`; today it is returned beside the orders and not passed in.

`/track-order` renders, under each timeline node: the normalised label and time (unchanged), then J&T's description in muted small text when present, and the rider phone as a `tel:` link. Signature photos never render on the storefront.

Tracking numbers and carrier names are already public on that page today, so no new class of data is exposed beyond the description and rider phone.

## Error handling

- Integration disabled → worker does nothing, admin refresh returns `409`, status card says "disabled".
- One shipment failing must not abort the tick; failures are per shipment and counted.
- A failed shipment's already-ingested events stay; partial success is acceptable.
- Unknown scan codes are skipped and logged, never persisted.
- A J&T error message is truncated to 300 chars before storage; the full response is only in the log line.
- Clock: only `scanTime` drives `eventTime`; `receivedAt` stays the ingest time so the two are distinguishable.

## Testing

- `jt.client.spec.ts` — fixed-vector signing (documented example values), form encoding, both error classes, timeout, and that the signed string is byte-identical to the transmitted `bizContent`.
- `jt-tracking.mapper.spec.ts` — all eight codes, unknown code → `null`, scan-time parsing with `+08:00`, stable `externalEventId`.
- `jt-tracking.service.spec.ts` with a fake client — candidate query (non-J&T carrier and terminal shipments excluded), insert, re-poll idempotency, auto-sign fires once, return code does not sign, failure increments and success resets backoff, disabled config is a no-op.
- `orders.service` sign test — `source: 'CARRIER'` writes the carrier source and accepts a null operator.
- Guest DTO test — `description`/`riderPhone` absent when the shopper matched by order number only.
- Migration smoke on a copy of the production dump.

## Rollout

1. Ship with `JT_ENABLED=false`; everything else is inert.
2. Set demo host + demo credentials, run one refresh against a demo waybill, confirm events appear and are classified correctly.
3. Switch to production credentials, enable, watch the status card for one tick.
4. Rollback = `JT_ENABLED=false` and restart; no data cleanup required.

## Risks

- **Carrier label drift.** Polling keys off `carrier` text. If staff type `JT`, `J&T`, or `J&T Express PH`, shipments silently stop being polled. Mitigation: preset button, case-insensitive comparison, and a status-card count of `SHIPPING` shipments with a tracking number but a non-matching carrier.
- **Rate limits are undocumented.** Batches are capped at 25 and serialised; the cadence is configurable without a deploy.
- **Waybill mistyped.** A wrong number returns a J&T error or an empty trail; it shows up in `tracking_error`, not as corrupted data.
- **Auto-sign trust.** A carrier `Delivered` scan becomes an order terminal state. If J&T misfires, the shipment must be corrected through the existing after-sales path — the same constraint that applies to a human mis-clicking sign today.
