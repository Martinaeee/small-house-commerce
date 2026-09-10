# COMMERCE_MODEL_MAPPING.md

**Status:** DRAFT — REQUIRES REVIEW BEFORE SCHEMA GENERATION
**Produced for:** `docs/DATABASE.md` §98 Agent Rules and §101 Required Agent Output Before Coding

---

## 1. Why this document exists

`docs/DATABASE.md` §101 requires a mapping document before database implementation,
and §98 forbids generating all custom tables up front. This document satisfies both.

**However, §101 was written against a premise that does not hold for this project.**
It asks for a table with the columns:

| Requirement | Native Commerce Engine Model | Extension Required | New Table Required | Notes |
| ----------- | ---------------------------- | ------------------ | ------------------ | ----- |

That format assumes a third-party Commerce Engine supplies part of the data model.
`docs/SYSTEM_ARCHITECTURE.md` §1 rules this out:

> The project is being built from scratch.
> It will NOT use: Shopify / WooCommerce / Medusa / Bagisto / another open-source
> Commerce Engine as the transaction core.
> The project will implement its own ecommerce transaction system.

There is therefore **no native model to map against**. Every entity below is custom.
The required table is still produced (§4) so the §101 gate is honoured, but the
architecture column is degenerate by construction. §101's real value — force a
reviewed entity list before mass table generation — is preserved in §5.

### Referenced files

| Referenced in §98 | Actual file in this repository |
| ----------------- | ------------------------------ |
| `docs/BUSINESS_RULES.md` | `docs/BUSINESS_RULES_V0.3.md` |
| `docs/DATABASE_DESIGN.md` | `docs/DATABASE.md` |

Content is present under both; only the filenames differ. 17 references across the
documentation use the old names.

---

## 2. Classification rules

Every entity in `docs/DATABASE.md` falls into exactly one class. This classification
comes from §99 Forbidden Architecture Decisions and §99's closing principle
("reports are derived from raw transactions/events").

| Class | Meaning | Becomes |
| ----- | ------- | ------- |
| **TABLE** | Owns rows; the source of truth | A Prisma model |
| **DERIVED VIEW** | Computed from tables; storing it would duplicate truth | NOT a table; computed at query time |
| **SNAPSHOT** | Historical fact frozen at write time, embedded in a parent row | Columns on the parent table, not a separate table |
| **EXTERNAL** | Owned by a third party; we store references and events locally | TABLE + local mirror columns |

Three §99 rules are load-bearing here and are the reason several entries below are
**not** tables:

- **§99.2** — `signed_orders` must not exist as a second copy of Order records.
  Signed Orders is a derived business state (Orders + Logistics Events).
- **§99.10** — reports are derived from raw transactions/events, never stored as facts.
  This forbids `*_daily_report` tables as sources of truth.
- **§99.1** — `fb_orders` must not exist as a second independent Order system.
  Facebook orders are Orders carrying attribution, not a parallel table.

---

## 3. Build order

`docs/DATABASE.md` §97 defines five phases. Reproduced here with the entity list from
§96 assigned to each, so implementation order is unambiguous.

### Phase 1 — Transaction Core (complete first)

| Entity | Class | Prisma model |
| ------ | ----- | ------------ |
| Commerce Engine setup | — | **Already satisfied** — `backend/` (NestJS 12 + Prisma 7 + PostgreSQL 18) |
| Users / Roles / Permissions | TABLE | `User`, `Role`, `Permission`, `UserRole` |
| Categories | TABLE | `Category` |
| Products | TABLE | `Product` |
| Variants / SKUs | TABLE | `ProductVariant` |
| Product Images | TABLE | `ProductImage` |
| Customers | TABLE | `Customer` |
| Customer Addresses | TABLE | `CustomerAddress` |
| Orders | TABLE | `Order` |
| Order Items | TABLE | `OrderItem` |
| Order Address Snapshot | SNAPSHOT | Columns on `Order` (not a table) |
| Order Status History | TABLE | `OrderStatusHistory` |
| COD Checkout | — | API behaviour, not a table |
| Payments | TABLE | `Payment` |
| Inventory | TABLE | `Inventory` |
| Inventory Reservations | TABLE | `InventoryReservation` |
| Cancellation Release | — | Inventory movement behaviour, see `InventoryMovement` |

### Phase 2 — COD Operations

| Entity | Class | Prisma model |
| ------ | ----- | ------------ |
| Optimizers | TABLE | `Optimizer` |
| Optimizer / AID | SNAPSHOT | Snapshot columns on `Order` (§99.6 forbids recomputing historically) |
| Customer classification | SNAPSHOT | Columns on `Order` + `Customer` |
| AGAIN / RPT / RECHECK | DERIVED | Rules over `CustomerRiskEvent` + order history |
| Customer Risk Events | TABLE | `CustomerRiskEvent` |
| Confirmor Workflow | — | Admin workflow state on `Order` |
| Double Check | — | `OrderNote` type |
| Order Notes | TABLE | `OrderNote` |
| Order Risk Flags | TABLE | `OrderRiskFlag` |
| Lead / Pre-Order Submission | TABLE | `Lead` (deferrable — §18 says so explicitly) |

### Phase 3 — Fulfillment

| Entity | Class | Prisma model |
| ------ | ----- | ------------ |
| Warehouses | TABLE | `Warehouse` |
| Suppliers | TABLE | `Supplier` |
| Purchase Orders | TABLE | `PurchaseOrder`, `PurchaseOrderItem` |
| Inventory Movements | TABLE | `InventoryMovement` |
| Shipments | TABLE | `Shipment` |
| Shipment Items | TABLE | `ShipmentItem` |
| Logistics Events | TABLE | `LogisticsEvent` (idempotent — §99.7) |
| Signed Orders | **DERIVED VIEW** | NOT a table (§99.2) |
| Signed Rate | DERIVED | Computed |

### Phase 4 — Attribution

| Entity | Class | Prisma model |
| ------ | ----- | ------------ |
| Facebook Pages | EXTERNAL | `FacebookPage` |
| Facebook Posts | EXTERNAL | `FacebookPost` |
| FB Order View | DERIVED | Orders with attribution (§99.1) |
| Meta Ad Attribution | SNAPSHOT | Columns on `OrderAttribution` |
| Order Attribution | TABLE | `OrderAttribution` |
| Landing Pages | TABLE | `LandingPage` |
| Landing Page Sections | TABLE | `LandingPageSection` |

### Phase 5 — Analytics / Finance

| Entity | Class | Prisma model |
| ------ | ----- | ------------ |
| Cost Entries | TABLE | `CostEntry` |
| Product Cost Snapshot | SNAPSHOT | Columns on `OrderItem` |
| Shipping Rate Rules | TABLE | `ShippingRateRule` |
| Reviews | TABLE | `Review` |
| After Sales | TABLE | `AfterSalesCase` |
| Homepage / CMS | TABLE | `HomepageSection` |
| Audit Logs | TABLE | `AuditLog` |
| Signed Revenue / Profit | DERIVED | Computed |
| Product / Province / Optimizer / Advertising Performance | DERIVED | Computed |
| `*_daily_report` | **DERIVED VIEW** | NOT tables (§99.10) |

---

## 4. Required mapping table (§101 format)

`Native Commerce Engine Model` is `—` for every row: there is no engine
(see §1). `Extension Required` is likewise `—`. The column is retained so the
§101 gate format is satisfied.

| Requirement | Native Commerce Engine Model | Extension Required | New Table Required | Notes |
| ----------- | ---------------------------- | ------------------ | ------------------ | ----- |
| Product | — | — | Yes | `Product`; §19 warns against a competing product engine |
| Variant | — | — | Yes | `ProductVariant`; carries SKU code and dimensions |
| Customer | — | — | Yes | `Customer`; phone is the primary identity (§12, BR-030) |
| Order | — | — | Yes | `Order`; single unified Order system (BR-001, §99.1) |
| Order Item | — | — | Yes | `OrderItem`; carries price/cost snapshots (§99.9) |
| Inventory | — | — | Yes | `Inventory`; §99.4 forbids a bare `stock` column |
| Reservation | — | — | Yes | `InventoryReservation`; required by §99.4 |
| Payment | — | — | Yes | `Payment`; COD primary, Airwallex optional |
| Shipment / Fulfillment | — | — | Yes | `Shipment`, `ShipmentItem` |
| Optimizer / AID | — | — | Yes | `Optimizer` + AID snapshot columns on `Order` (§99.6) |
| Customer Risk | — | — | Yes | `CustomerRiskEvent`; drives AGAIN / RPT / RECHECK |
| FB Post | — | — | Yes | `FacebookPage`, `FacebookPost` |
| Order Attribution | — | — | Yes | `OrderAttribution`; snapshots, never recomputed |
| Landing Page | — | — | Yes | `LandingPage`, `LandingPageSection` |
| Logistics Event | — | — | Yes | `LogisticsEvent`; must be idempotent (§99.7) |
| Signed Orders | — | — | **No** | Derived view of Orders + Logistics (§99.2) |
| Cost Entries | — | — | Yes | `CostEntry`; feeds Profit |

---

## 5. Open questions requiring a decision

These are unresolved in the source documentation and must be settled before the
affected models are written.

| # | Question | Affects | Blocking? |
| - | -------- | ------- | --------- |
| 1 | `docs/DATABASE.md` §19 still says "Use Commerce Engine native Product models if possible", and §102's architecture diagram still shows a "Commerce Engine" layer. Both contradict `SYSTEM_ARCHITECTURE.md` §1. Should they be reworded to "Transaction Core"? | Documentation consistency | No |
| 2 | §102 Collections defines `type` with values NAVIGATION / MARKETING / SCENARIO / SYSTEM. The superseded duplicate defined `collection_type` with PRODUCT_CATEGORY / SCENE / DYNAMIC and carried two extra fields (`short_description`, `thumbnail_image`). The superseded version was removed in the same commit that added this file; confirm those two fields are genuinely not wanted. | `Collection` model | Phase 1 only if Collections ships in V1 |
| 3 | §18 marks `leads` as deferrable if V1 does not capture pre-order form leads. Confirm whether V1 captures them. | `Lead` model | No — deferrable |
| 4 | `Payment` is listed in §96 only indirectly (`payment_status` exists on Order). Confirm whether Payments is a table in V1 or a status field only. | `Payment` model | Yes, for Phase 1 |
| 5 | `Category` appears in §96 as "Categories" but has no dedicated numbered section, unlike Products and Collections. Confirm the intended category model and its relationship to Collections. | `Category` model | Yes, for Phase 1 |

---

## 6. What this document does NOT do

- It does not define field-level schemas. Fields come from the numbered sections
  of `docs/DATABASE.md`.
- It does not generate Prisma models. Per §101, schema generation waits for review
  of this document.
- It does not resolve the open questions in §5.
