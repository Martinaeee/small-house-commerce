# J&T Tracking Go-Live

J&T Express PH **open platform** (`openapi.jtexpress.ph/webopenplatformapi/api`). This is not
the older `ylopen.jtexpress.ph` API — the credentials are different and do not interchange.

## Credentials

| Env var | Value source |
| --- | --- |
| `JT_ENABLED` | `false` until the dry run passes |
| `JT_BASE_URL` | `https://demoopenapi.jtexpress.ph/webopenplatformapi/api` for the dry run |
| `JT_API_ACCOUNT` | J&T console |
| `JT_PRIVATE_KEY` | J&T console |
| `JT_CUSTOMER_CODE` | J&T shipping branch |
| `JT_CUSTOMER_PASSWORD` | J&T shipping branch |
| `JT_POLL_MINUTES` | `30` (optional) |
| `JT_CARRIER_NAME` | `J&T Express` (must match the ship dialog label) |

### When the integration is on

The switch and the credentials are checked in two places, and both agree:

| `JT_ENABLED` | Credentials | Result |
| --- | --- | --- |
| unset or blank | any | off — the app boots normally |
| `false` | any | off — the app boots normally |
| `true` | all four present | on — the worker polls |
| `true` | any of the four missing | **the app refuses to start** (`env.validation.ts`) |

"All four" means `JT_API_ACCOUNT`, `JT_PRIVATE_KEY`, `JT_CUSTOMER_CODE`, `JT_CUSTOMER_PASSWORD`.
`JT_BASE_URL`, `JT_POLL_MINUTES` and `JT_CARRIER_NAME` have defaults and are never required.

## Base fix carried by this branch

`6063a883 fix(qianyi): import the inbound service as a value so Nest can resolve it` is **not**
part of the J&T feature, but it must not be dropped when this branch is integrated:

- `qianyi-webhook.service.ts` imported `QianyiInboundService` with `import type`. Type-only
  imports are erased at runtime, so the constructor emitted `Function` as its parameter type and
  Nest failed with `UnknownDependenciesException` for `QianyiWebhookService` — the whole API
  refused to boot, on every environment, before this branch.
- The fix changes one word (`import type` → `import`). No behaviour changes; the module graph has
  no cycle.
- Verified by a boot smoke: `PORT=3999 HOST=127.0.0.1 node dist/main.js` logs
  "Nest application successfully started".

If this commit is dropped, the merge target will not start.

## Dry run

1. Set the demo base URL and demo credentials in `.env.deploy`.
2. Deploy with `--env-file .env.deploy`.
3. Open `/admin/status`; the J&T card must read "Enabled".
4. Ship one test order with carrier `J&T Express` and a known demo waybill.
5. Press "Refresh tracking" in the order drawer.
6. Confirm events appear with J&T wording, and that a Delivered scan signs the shipment with
   source `CARRIER` in the order status history.

## Production

1. Swap in production credentials and `https://openapi.jtexpress.ph/webopenplatformapi/api`.
2. Set `JT_ENABLED=true`, deploy, watch the card for one tick.
3. Confirm one real waybill's events land.

## Rollback

Set `JT_ENABLED=false` and restart. Existing events, signatures and the six new columns stay
valid; nothing needs cleaning up.

## Known failure modes

- **No events for a shipment** — check the carrier label equals `JT_CARRIER_NAME`
  (case-insensitive) and that the tracking number is the J&T **bill code**.
- **Signature errors in the card** — the private key or customer password is wrong; the message
  contains `sign`.
- **Waybill not found** — the number is not a J&T bill code for this account.
- **Backoff** — after a failure the same box is retried in 1 h, then 6 h, then daily. The worker
  never blocks other boxes.
