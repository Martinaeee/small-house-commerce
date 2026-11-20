# SUNRATE online payments — dev-complete handoff (2026-11-20)

Branch: `feat/sunrate-payments-20261120` (worktree `.claude/worktrees/sunrate-payments-20261120`, base `ecbc413a`).
Design: `docs/superpowers/specs/2026-11-20-sunrate-online-payments-design.md`.
Plan: `docs/superpowers/plans/2026-11-20-sunrate-online-payments.md`.

**Status: development complete, NOT deployed, NOT switched on.** Every
SUNRATE switch defaults to off; a production deployment that skips the
env block below behaves exactly as before this branch.

## What was built

- **Checkout payment choice** — `COD | CARD | GCASH | BPI`, COD default. The
  choice rides in the order payload and (non-COD only) in the idempotency
  fingerprint, so the same retry key can never switch payment paths. The old
  COD fingerprint is byte-identical (pinned by a fixture test).
- **Per-method switches** — `payment_method_configs` (COD on, online off).
  Storefront visibility = DB switch AND gateway readiness. Backend refuses a
  disabled method inside the checkout transaction (`PAYMENT_METHOD_DISABLED`),
  leaving no order, reservation, promo redemption or customer row behind.
- **Order + payment + attempt in one transaction** — an online order is
  `ONLINE_PENDING` with a `SUNRATE` payment row and a `CREATING`
  `sunrate_payment_attempts` row (merchant order number `AT` + Manila
  timestamp + 6 digits).
- **Gateway session** — card: `POST /api/v5/createcashier` (`paySession`,
  mounted by the SDK); GCash/BPI: `POST /api/v5/createorder` (`payUrl`,
  allow-listed hosts). A timeout/5xx leaves the attempt `UNKNOWN` with the
  SAME merchant order number; a repeated initiation never opens a second
  session.
- **Capability cookie** — `luwag_pay_return` (HttpOnly, SameSite=Lax,
  `Path=/api/v1/payments`, 24h, HMAC): names the order for the payment
  status / retry endpoints. Every failure answers the same 404.
- **Payment return page** `/payment-return/[orderNumber]` — polls the status
  endpoint (1s → 5s, stops after 60s), PAID renders the success state, fires
  the Purchase event once and clears the ordered cart lines; PENDING shows
  the waiting state (and mounts the card SDK only with an explicit env);
  FAILED offers a retry; nothing is ever guessed from the URL.
- **Notifications** — `POST /api/v1/payments/sunrate/notify`, signature
  verified, answers plain `OK` (400 on a bad signature, 500 on a DB failure
  so the gateway retries). Applied by a single-transaction state machine
  under a per-merchant-order-number advisory lock: exact merchant / PURC /
  PHP / amount / channel-brand checks, PAID never downgraded, cancelled
  orders go to REVIEW, duplicates are no-ops.
- **Purchase event** — online orders send no Purchase at checkout; the
  verified PAID result queues it (`purchase-<orderNumber>`, consent from the
  checkout snapshot, never the payment server's IP).
- **Reconciliation + retry** — `POST /api/v1/admin/payments/orders/:orderNumber/query`
  (ORDER_VIEW_ALL, 10s per attempt) and `POST /api/v1/payments/retry`
  (new attempt, new merchant order number, consent carried over).
- **Order-workbench protection** — cancel / hard delete refuse an order with
  a blocking attempt (`ONLINE_PAYMENT_ACTIVE_CONFIRM_VIA_QUERY`); merge
  refuses an order with a non-failed SUNRATE payment
  (`ONLINE_PAYMENT_ORDER_NOT_MERGEABLE`).
- **Qianyi guard** — an online order is never queued before PAID; at send
  time a non-PAID online order FAILS (`ONLINE_ORDER_NOT_PAID`) and a PAID one
  FAILS until `QIANYI_PREPAID_VERIFIED=true`
  (`QIANYI_PREPAID_MAPPING_UNVERIFIED`, `pendingReview`). CLOSE_ORDER is
  unaffected.
- **Admin** — independent "Payment" column (Card / GCash / BPI / COD /
  Unknown, separate from the payment status), a drawer block with the masked
  gateway trail (`Visa ···· 4242`, transID, attempt timeline, 30-minute
  awaiting badge) and a "Query payment status" button; CSV export carries the
  method; `/admin/settings/payments` switches the four methods with a
  keep-one guard and a revision-locked save.
- **PDP quick COD** — the inline cash form disappears when COD is switched
  off (a failed methods request keeps it; the backend refuses the submit).

## Migrations

Two additive migrations on top of the live set:

- `20261120100000_add_sunrate_enum` — `ALTER TYPE "PaymentMethod" ADD VALUE 'SUNRATE'`.
- `20261120150000_add_sunrate_payment_tables` — `SunrateAttemptStatus` enum,
  `payment_method_configs` (seeded COD=true, CARD/GCASH/BPI=false),
  `sunrate_payment_attempts`, `sunrate_notification_events`, the partial
  unique index `sunrate_attempt_active_per_order` (one active attempt per
  order) and `sunrate_attempt_transid_unique`.

## Environment (all off/empty by default)

| Variable | Notes |
| --- | --- |
| `SUNRATE_ENABLED` | `true`/`false`; default false. |
| `SUNRATE_ENV` | `test` or `production`; unset = module off. |
| `SUNRATE_MERCHANT_ID` | Merchant id (the email's test id works for test). |
| `SUNRATE_SIGN_KEY` | Signing key; server-only, never logged or sent to the browser. |
| `SUNRATE_BASE_URL` | Optional; may only be one of the two official hosts (a mismatch switches the module off). |
| `PAYMENTS_PUBLIC_BASE_URL` | Site origin used to build `frontURL`/`backURL`, e.g. `https://luwag.shop`. Never derived from request headers. |
| `QIANYI_PREPAID_VERIFIED` | `true` only after Qianyi confirms the prepaid enum; default false. |

The gateway host is bound to `SUNRATE_ENV` (`test-api.xunhuiacq.com` /
`api.acq.sunrate.com`); the module stays off while any credential or the
public base URL is missing.

## Verification run for this handoff

- Backend: `pnpm test` → **2860 passed, 281 skipped, 0 failed**; `pnpm build` green.
- Backend typecheck: `tsc --noEmit` → 111 errors, **all pre-existing on the
  base commit** (marketing/qianyi/customers specs); **0 in any file this
  branch touched**.
- Frontend: `pnpm test` → **3927 passed, 0 failed** (one product-gallery
  case is flaky under parallel load; passes alone and on re-run);
  `pnpm build` green.
- Local boot smoke (dev DB, SUNRATE off): `GET /api/v1/storefront/payments/methods`
  → `COD true, CARD/GCASH/BPI false`; forged GCash checkout → `409
  PAYMENT_METHOD_DISABLED`; COD checkout reaches normal SKU validation
  (`400 SKU_UNAVAILABLE`, not the payment gate); status/retry without the
  capability cookie → `404`.
- The smoke also caught and fixed a real DI defect: `PaymentsModule` had not
  imported `AuthModule`, so the backend would not boot with the admin
  payment controllers registered (`90ba8336`).

## Known unverified items (external dependencies)

1. **Signature key attachment** — the signing key used is the one in the
   emailed documentation (`SUNRATE_signatureKey…txt` = the email's Secret
   key). The contract's own key attachment is not verified.
2. **Sandbox accounts** — the GCash/BPI test credentials from 周涛 have not
   arrived; no real gateway transaction (card, GCash, BPI) has been made. The
   client was exercised against the official examples and local fakes only.
3. **Qianyi prepaid enum** — the paid/prepaid payment type Qianyi expects
   for online orders is not confirmed. Until it is, PAID online orders are
   held back (`QIANYI_PREPAID_MAPPING_UNVERIFIED`).
4. **backURL reporting** — production requires reporting the notification
   URL (`<PAYMENTS_PUBLIC_BASE_URL>/api/v1/payments/sunrate/notify`) to
   SUNRATE in advance. Not done yet.
5. **Pay-url allow-list** — the wallet cashier host family
   (`*.xunhuiacq.com`, `*.sunrate.com`) is taken from the official example;
   sandbox evidence may widen or narrow it.
6. **Card brand mapping** — `cardBrand` stores the notification's
   `paymentBrand` for every channel; the notification never carries a card
   number, so `cardLast4` stays empty until the channel actually returns one.

## Production enablement checklist (each step needs its own authorization)

1. Apply the two migrations (`prisma migrate deploy`).
2. `prisma generate` (the deploy build does not generate the client).
3. Rebuild and deploy backend + frontend.
4. Set the env block with `SUNRATE_ENV=test` first and report the backURL.
5. Run the sandbox acceptance: card, GCash, BPI test payments; notification
   delivery and the `OK` answer; the payment return page; the admin query.
6. Only then `SUNRATE_ENV=production`; switch individual methods on in
   `/admin/settings/payments`.
7. Confirm the Qianyi prepaid enum and set `QIANYI_PREPAID_VERIFIED=true`
   before online orders are pushed to Qianyi.

## Rollback notes

- Turning `SUNRATE_ENABLED` off (or any method off) stops new online
  payments; existing orders keep their notification, query and recovery
  paths.
- Do not roll back to a backend that does not understand SUNRATE while an
  online payment is open: the frontend may fall back to COD-only display,
  but the notification endpoint must keep running.
- Never delete payment/notification rows and never downgrade a PAID order
  back to COD.

## Explicitly out of scope this round

Production deployment and switching any method on; sandbox transaction
acceptance; Qianyi prepaid enum mapping (only the refusal guard exists);
refund automation; settlement reports; scheduled timeout release of stale
attempts.
