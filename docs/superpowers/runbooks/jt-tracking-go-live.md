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

Missing any of the four credentials keeps the integration off; the app still boots. With
`JT_ENABLED=true` and a credential missing, the app refuses to start (`env.validation.ts`).

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
