# SYSTEM_ARCHITECTURE.md

# Philippines Small House COD Ecommerce Platform

**Version:** V0.9
**Status:** ARCHITECTURE BASELINE — NOT YET FROZEN
**Architecture Style::**Modular Monolith
**Development Strategy:**Custom Ecommerce Core Development
**Market:** Philippines
**Primary Payment:** Cash on Delivery
**Optional Payment:** Airwallex
**Business Timezone:** Asia/Manila
**Storefront Currency:** PHP / ₱

---

# 1. Purpose

This document defines the system-level architecture for the Philippines Small House COD ecommerce platform.

The project is being built from scratch.

It will NOT use:

* Shopify as the commerce backend
* WooCommerce as the commerce backend
* Medusa as the commerce backend
* Bagisto as the commerce backend
* another open-source Commerce Engine as the transaction core

The project will implement its own ecommerce transaction system.

The platform must support both:

1. Consumer ecommerce storefront
2. Philippines COD operations backend

The target system is:

```text
Ecommerce Storefront
+
COD Operations
+
Inventory
+
Logistics
+
Facebook Attribution
+
Optimizer Attribution
+
Landing Pages
+
Signed Analytics
+
Profit Analytics
```

---

# 2. Project Positioning

This project is NOT only a website.

It is a small ecommerce operating platform designed specifically for Philippines COD business.

The complete business chain is:

```text
Traffic
│
├── Facebook Organic Post
├── Meta Advertising
├── Organic
├── Direct
└── Other
        │
        ▼
Storefront / Landing Page
        │
        ▼
Cart / Checkout
        │
        ▼
Order
        │
        ▼
Customer Risk Check
        │
        ▼
COD Confirmation
        │
        ▼
Inventory Reservation
        │
        ▼
Shipment
        │
        ▼
Logistics API
        │
        ├── Signed
        ├── Failed Delivery
        └── Returned
                │
                ▼
Analytics / Profit / Optimizer Performance
```

---

# 3. Core Architecture Decision

The V1 system will use:

# Modular Monolith

This means:

* one primary application codebase
* one primary transactional database
* clearly separated business modules
* modules communicate through explicit service interfaces
* no microservices in V1

Logical architecture:

```text
                    Browser
                       │
           ┌───────────┴───────────┐
           │                       │
      Storefront                Admin
           │                       │
           └───────────┬───────────┘
                       │
                 Application API
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      Catalog        Orders       Inventory
        │              │              │
     Customer      COD Ops       Fulfillment
        │              │              │
       Cart       Attribution      Analytics
        │              │              │
        └──────────────┼──────────────┘
                       │
                 PostgreSQL
```

---

# 4. Why Modular Monolith

V1 must NOT use microservices.

Do NOT build:

```text
Order Service

Inventory Service

Customer Service

Analytics Service

Attribution Service
```

as independent deployed applications.

Reason:

The business needs strong transactional consistency.

Example:

```text
Create Order
+
Reserve Inventory
+
Store AID Attribution
```

should be capable of succeeding or failing as one controlled business operation.

A distributed microservice architecture would introduce unnecessary complexity:

* distributed transactions
* network failures
* message queues
* service discovery
* retry orchestration
* compensation logic
* multiple deployments
* more difficult debugging

For the current project size and 30-day V1 target, this is unnecessary.

---

# 5. Proposed Technology Stack

## Application Language

```text
TypeScript
```

TypeScript should be used across frontend and backend where possible.

---

## Web Framework

Recommended:

```text
Next.js
```

Use Next.js for:

* Storefront
* Admin frontend
* Server-side rendering
* SEO pages
* API endpoints
* server-side application orchestration

---

## Database

```text
PostgreSQL
```

PostgreSQL is the primary transactional database.

Do NOT use SQLite in production.

SQLite may only be used for temporary local experiments.

---

## ORM

Recommended:

```text
Prisma
```

Prisma manages:

* schema
* migrations
* database access
* typed queries

Business logic must NOT live inside Prisma query code.

Prisma is the persistence layer.

---

## Media Storage

Use S3-compatible object storage.

Examples may include:

```text
Cloudflare R2

AWS S3

other S3-compatible storage
```

Provider is not frozen yet.

Database stores:

```text
media URL
metadata
ownership/reference
```

Do NOT store large images or videos directly inside PostgreSQL.

---

# 6. Deployment Architecture

V1 deployment should remain simple.

Logical deployment:

```text
Internet
   │
   ▼
CDN / HTTPS
   │
   ▼
Next.js Application
   │
   ├── Storefront
   ├── Admin
   ├── API
   ├── Webhooks
   └── Background Jobs
            │
            ▼
       PostgreSQL
```

External integrations:

```text
Application
│
├── Airwallex
├── Logistics API
├── Meta Pixel / CAPI
├── Email Provider
└── Object Storage
```

Exact hosting provider:

```text
TBD
```

Architecture must remain deployable to common Node.js hosting environments.

---

# 7. Repository Structure

Recommended project structure:

```text
small-house-commerce/
│
├── README.md
├── AGENTS.md
├── package.json
├── tsconfig.json
├── .env.example
│
├── docs/
│   ├── V1_SCOPE.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── BUSINESS_RULES.md
│   ├── DATABASE_DESIGN.md
│   ├── ORDER_FLOW.md
│   ├── ATTRIBUTION_SYSTEM.md
│   ├── HOMEPAGE_SPEC.md
│   ├── API_CONTRACTS.md
│   │
│   └── adr/
│       ├── README.md
│       └── 0001-architecture-baseline.md
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── src/
│   │
│   ├── app/
│   │   ├── (storefront)/
│   │   ├── admin/
│   │   └── api/
│   │
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── catalog/
│   │   ├── pricing/
│   │   ├── promotions/
│   │   ├── customers/
│   │   ├── customer-risk/
│   │   ├── cart/
│   │   ├── checkout/
│   │   ├── orders/
│   │   ├── cod-operations/
│   │   ├── inventory/
│   │   ├── purchasing/
│   │   ├── fulfillment/
│   │   ├── payments/
│   │   ├── attribution/
│   │   ├── facebook/
│   │   ├── landing-pages/
│   │   ├── analytics/
│   │   ├── cms/
│   │   └── audit/
│   │
│   ├── shared/
│   │   ├── database/
│   │   ├── errors/
│   │   ├── validation/
│   │   ├── security/
│   │   ├── logging/
│   │   ├── money/
│   │   └── time/
│   │
│   └── integrations/
│       ├── airwallex/
│       ├── logistics/
│       ├── meta/
│       ├── email/
│       └── storage/
│
└── tests/
    ├── integration/
    └── e2e/
```

---

# 8. Module Boundary Rule

Every business module owns a clear responsibility.

Modules may call another module's public service interface.

Modules must NOT arbitrarily modify another module's database state.

Example:

Bad:

```text
orders module

directly updates:

inventory.quantity
```

Correct:

```text
Orders
   │
   ▼
InventoryService.reserve()
```

---

# 9. Catalog Module

Location:

```text
src/modules/catalog/
```

Responsibilities:

* Products
* Product Variants
* SKU
* Categories
* Collections
* Product Media
* Furniture Attributes
* Product Dimensions
* Package Dimensions
* Product Status
* Product Role

Owns:

```text
Product
Variant
SKU
Category
Collection
ProductMedia
```

Does NOT own:

* inventory movements
* orders
* customer risk
* shipping
* attribution

---

# 10. Pricing Module

Responsibilities:

* Product selling price
* Compare-at price
* pricing rules
* price validation
* price snapshots supplied to checkout/order

Price must always be recalculated server-side during checkout.

Never trust price sent from browser.

---

# 11. Promotion Module

Responsibilities:

* Coupons
* Percentage discount
* Fixed discount
* Free shipping promotion
* future bundle / promotional rules

Promotion logic must not be hard-coded into frontend components.

---

# 12. Customer Module

Responsibilities:

* Customer identity
* Normalized Philippines phone
* Customer profile
* Customer addresses
* Historical customer lookup

Main COD identity:

```text
normalized phone number
```

Customer module does NOT independently decide order state.

---

# 13. Customer Risk Module

Responsibilities:

* risk history
* refusal history
* failed delivery history
* duplicate indicators
* AGAIN / RPT / RECHECK classification
* blocklist / watchlist
* customer risk events

Risk classifications must be auditable.

---

# 14. Cart Module

Responsibilities:

* Guest cart
* Cart items
* Quantity
* Current product references
* Cart expiration
* Cart totals before checkout

Cart is NOT a finalized commercial transaction.

Order price and inventory must be validated again during checkout.

---

# 15. Checkout Module

Checkout coordinates:

```text
Customer
+
Cart
+
Pricing
+
Promotion
+
Inventory
+
Attribution
+
Order
+
Payment
```

Checkout must act as an orchestration layer.

It does not own the underlying data of all modules.

---

# 16. Order Module

Responsibilities:

* Order creation
* Order items
* order totals
* order address snapshot
* order business state
* order history
* order notes
* historical snapshots

Critical relationship:

```text
Order
1:N
OrderItem
```

Order header must NOT directly represent only one SKU.

---

# 17. Order Snapshot Rule

When Order is created, preserve:

```text
Product Name Snapshot

SKU Snapshot

Variant Snapshot

Price Snapshot

Cost Snapshot

Customer Snapshot

Address Snapshot

AID Snapshot

Optimizer Snapshot

Attribution Snapshot
```

Historical Orders must remain stable even when current catalog or assignments change.

---

# 18. COD Operations Module

Responsibilities:

* COD confirmation
* Confirmor assignment
* Double Check
* Question Order
* Abnormal Order
* Again
* RPT
* Recheck
* customer-service notes
* confirmation history

Suggested confirmation states:

```text
UNCONFIRMED

NEEDS_REVIEW

CONFIRMED

REJECTED
```

Order Status and Confirmation Status must remain separate.

---

# 19. Inventory Module

Responsibilities:

* On Hand
* Reserved
* Available
* Damaged
* Inventory Reservation
* Inventory Release
* Inventory Movement
* stock consistency

Inventory must not be controlled directly by Order code.

---

# 20. Inventory Reservation Rule

Confirmed business rule:

When a production Order is created and inventory is available:

```text
Create Inventory Reservation
```

Conceptually:

```text
Available - quantity

Reserved + quantity
```

---

# 21. Cancellation Rule

If remaining order quantity is cancelled or denied:

```text
Release Reservation
```

Conceptually:

```text
Reserved - quantity

Available + quantity
```

Cancelled Orders remain in database.

They must NOT be deleted.

---

# 22. Shipment Inventory Rule

When shipment is created/confirmed according to the final fulfillment workflow:

reservation is converted into physical stock deduction.

This transition must be idempotent.

Inventory must never be deducted twice for the same shipment.

---

# 23. Purchasing Module

Responsibilities:

* Supplier
* Purchase Order
* Purchase Order Items
* Incoming stock
* Receive inventory

V1 does NOT need a full ERP.

Only lightweight purchase/incoming inventory workflow is required.

---

# 24. Fulfillment Module

Responsibilities:

* Shipment
* Shipment Items
* Tracking Number
* Carrier
* Shipping Date
* Shipping Cost
* Logistics Status
* Signed Date

Relationship:

```text
Order
1:N
Shipment
```

Never assume:

```text
1 Order = 1 Tracking Number
```

---

# 25. Logistics Integration

External Logistics API belongs in:

```text
src/integrations/logistics/
```

Responsibilities:

* send shipment request
* retrieve/push tracking
* receive logistics webhook
* normalize carrier status
* store raw/logical event
* detect Signed
* detect Failed Delivery

---

# 26. Signed Orders Rule

Confirmed business rule:

Normal Signed Orders source:

```text
Logistics API
```

Signed Orders is NOT a separate duplicated Order database.

It is derived from:

```text
Order
+
Shipment
+
Logistics Event
```

---

# 27. Multi-Shipment Signed Rule

If:

```text
Order
├── Shipment A = SIGNED
└── Shipment B = SHIPPING
```

Order must remain:

```text
SHIPPING
```

Only when all required shipments are signed:

```text
Order = SIGNED
```

---

# 28. Signed Timestamp

Use actual carrier signed time:

```text
signedAt
```

Also preserve:

```text
eventReceivedAt
```

Do not confuse the two.

---

# 29. Signed Rate

Confirmed business definition:

```text
Signed Rate
=
Signed Orders
/
All Backend-Created Production Orders
```

Cancelled / Denied / invalid business orders remain in the denominator.

Example:

```text
Total Orders = 100

Signed = 60

Cancelled = 15

Denied = 10

Other = 15
```

Then:

```text
Signed Rate = 60%
```

Agent must NOT change this formula to:

```text
Signed / Confirmed
```

or:

```text
Signed / Shipped
```

---

# 30. Shipping-to-Signed Rate

A separate logistics metric may exist:

```text
Shipping-to-Signed Rate
=
Signed Orders
/
Shipping Orders
```

It must never be labeled simply:

```text
Signed Rate
```

---

# 31. Payments Module

Responsibilities:

* Payment Method
* Payment attempt
* Payment transaction
* Online payment
* COD collection state
* refund
* settlement state

Payment state must be independent of Order state.

---

# 32. COD Payment

Default payment method:

```text
Cash on Delivery
```

COD is selected by default when available.

---

# 33. Airwallex

Airwallex is an optional payment provider.

If Airwallex integration is:

```text
NOT_CONFIGURED
or
DISABLED
```

Storefront must not display it.

Checkout shows COD only.

When:

```text
ENABLED
```

Checkout may display:

```text
Cash on Delivery

Online Payment
```

Integration code belongs in:

```text
src/integrations/airwallex/
```

Airwallex-specific code must not spread through Order or Checkout modules.

---

# 34. Payment Status

Suggested logical states:

```text
COD_PENDING

COLLECTED

SETTLEMENT_PENDING

SETTLED

ONLINE_PENDING

PAID

FAILED

REFUNDED

PARTIALLY_REFUNDED
```

Do NOT assume:

```text
SIGNED = SETTLED
```

---

# 35. Attribution Module

Responsibilities:

* Traffic source
* AID
* Optimizer
* campaign
* adset
* ad
* FB Page
* FB Post
* landing page
* UTM
* fbclid
* attribution persistence
* order attribution snapshot

---

# 36. AID Definition

AID means:

> Which optimizer owns this order for business attribution and performance settlement.

AID must be permanently retained.

AID is NOT:

* Ad ID
* Facebook Post ID
* Campaign ID

---

# 37. Attribution Dimensions

Must remain separate:

```text
AID
= Optimizer ownership

Post ID
= Facebook organic post

Ad ID
= Meta paid advertisement

Source Type
= Channel
```

---

# 38. Source Types

Initial:

```text
FB_POST

META_AD

ORGANIC

DIRECT

EMAIL

OTHER
```

---

# 39. AID Snapshot

When Order is created:

store:

```text
optimizerId

aidSnapshot

optimizerNameSnapshot
```

Historical Orders must not change if Page ownership or Optimizer assignments change later.

---

# 40. Facebook Module

Responsibilities:

* Facebook Pages
* Facebook Posts
* Post Tracking Code
* Post URL
* Post publishing date
* Post Product
* Post Optimizer
* FB Order queries

---

# 41. FB Order Definition

FB Order means:

> Order generated from a Facebook public Page organic post.

FB Order is NOT Meta Advertisement Order.

FB Order should be implemented as:

```text
Order
+
Attribution
WHERE sourceType = FB_POST
```

not as an independent second Order database.

---

# 42. Facebook Post Tracking

Legacy format may be supported:

```text
?aid=xxx&adid=fb0909
```

New architecture should use a unique post tracking identity.

Example:

```text
?aid=OPT001
&source=fb_post
&post=FBP8K2M4
```

The system should be able to identify:

```text
Optimizer
Facebook Page
Facebook Post
Product
Post Date
```

from the tracking information.

---

# 43. Attribution Persistence

Example:

```text
Facebook Post
↓
Homepage
↓
Collection
↓
PDP
↓
Checkout
↓
Order
```

Original FB Post attribution must remain attached.

Browsing through Homepage must not convert the order to DIRECT.

---

# 44. Landing Page Module

Responsibilities:

* Landing Page
* Product association
* structured page sections
* campaign association
* Post association
* Ad association
* attribution ID

V1 does NOT implement an arbitrary drag-and-drop builder.

---

# 45. Landing Page Sections

Initial modules:

```text
HERO

PROBLEM

SOLUTION

PRODUCT

BENEFITS

DEMO

DIMENSIONS

REVIEW

OFFER

FAQ

CTA
```

Admin may:

* enable / disable
* reorder
* edit content
* replace media

---

# 46. CMS Module

CMS handles non-transactional storefront content.

Examples:

* Homepage
* Announcement Bar
* Hero
* Shop by Space
* Shop by Solution
* Brand Story
* Static Pages
* FAQ

CMS must NOT contain canonical Product price or inventory data.

---

# 47. Homepage Data Rule

Homepage may reference Product IDs.

But:

Price comes from Pricing Module.

Stock comes from Inventory Module.

Product data comes from Catalog Module.

Do NOT hard-code product commercial truth inside homepage CMS JSON.

---

# 48. Analytics Module

Analytics consumes business facts from other modules.

It does NOT become the primary transaction database.

Sources:

```text
Orders

Order Items

Attribution

Shipments

Logistics Events

Inventory Movements

Payment

Cost Entries
```

---

# 49. Analytics V1 Goals

System must eventually answer:

```text
How many orders today?

Which product generates profit?

Which FB post generated real Signed Orders?

Which Ad ID generated profitable orders?

Which Province has the highest Signed Rate?

Which customers are high risk?

How much inventory remains?

How much Signed Revenue belongs to each Optimizer?
```

---

# 50. Cost / Profit Architecture

Do not store one permanent Profit field as the only truth.

Preserve original cost facts.

Examples:

```text
Product Cost

Shipping Cost

COD Fee

Payment Fee

Ad Spend

Refund Cost

Return Cost

Loss Cost
```

Profit is calculated from facts.

---

# 51. API Architecture

Storefront and Admin must communicate with server-side application logic.

Frontend must NEVER connect directly to PostgreSQL.

Flow:

```text
Browser
↓
API / Server Action
↓
Application Service
↓
Repository / Prisma
↓
PostgreSQL
```

---

# 52. Public API Namespace

Recommended:

```text
/api/v1/storefront/...
```

Examples:

```text
/api/v1/storefront/products

/api/v1/storefront/cart

/api/v1/storefront/checkout

/api/v1/storefront/orders/track
```

---

# 53. Admin API Namespace

Recommended:

```text
/api/v1/admin/...
```

Examples:

```text
/api/v1/admin/orders

/api/v1/admin/inventory

/api/v1/admin/customers

/api/v1/admin/facebook-posts

/api/v1/admin/signed-orders
```

Admin endpoints require role permissions.

---

# 54. Integration Webhooks

Recommended:

```text
/api/v1/webhooks/logistics/...

/api/v1/webhooks/airwallex/...
```

Webhook handlers must:

1. authenticate provider request
2. validate payload
3. implement idempotency
4. save raw/logical event
5. execute business transition
6. return quickly

---

# 55. Idempotency

Critical external and order operations must support idempotency.

At minimum:

* Place Order
* Airwallex callbacks
* Logistics callbacks
* Shipment creation
* Inventory deduction

Example:

Customer double-clicks:

```text
Place Order
```

System must not create two orders for the same idempotent request.

---

# 56. Database Transaction Boundaries

Use database transactions where multiple writes form one business action.

Example Order Creation:

```text
Validate Cart

↓

Validate Price

↓

Validate Inventory

↓

Create Order

↓

Create Order Items

↓

Create Address Snapshot

↓

Create Attribution Snapshot

↓

Create Inventory Reservation
```

If critical steps fail:

rollback.

Do not leave:

```text
Order created
but
Inventory not reserved
```

without explicit recovery strategy.

---

# 57. Concurrency

Inventory validation must occur server-side.

Two customers may attempt to buy the final SKU simultaneously.

System must prevent:

```text
Available Stock = 1

Customer A buys 1

Customer B buys 1

Result:
-1 stock
```

Use:

* transactional updates
* conditional updates
* appropriate database locking strategy

Final implementation details belong in `DATABASE_DESIGN.md`.

---

# 58. Security Architecture

Secrets must never be exposed to browser.

Examples:

```text
DATABASE_URL

Airwallex Secret

Meta Access Token

Logistics Secret

Email Secret
```

Use environment variables / secret management.

---

# 59. Admin Authentication

Admin authentication must be separate from normal storefront customer identity.

V1 customer checkout may remain guest checkout.

Admin requires authenticated sessions.

---

# 60. Authorization

Every Admin write endpoint must validate permission server-side.

Do NOT rely only on:

```text
hide button in frontend
```

Example:

Optimizer may be unable to see other Optimizers' Orders.

This must be enforced in API/database queries.

---

# 61. Audit Requirements

Critical operations must create audit records.

Examples:

```text
ORDER_CANCEL

ORDER_AID_CHANGE

INVENTORY_ADJUST

CUSTOMER_BLOCK

PRICE_CHANGE

SHIPPING_RATE_CHANGE

MANUAL_SIGNED_OVERRIDE
```

---

# 62. Storefront Architecture

Primary pages:

```text
Homepage

Collection

Product Detail Page

Cart

Checkout

Order Success

Track Order

Search

About

FAQ

Shipping & Delivery

Returns & Refunds

Privacy

Terms

Contact
```

---

# 63. Storefront Mobile First

Primary acquisition traffic is expected from Facebook mobile traffic.

Therefore:

Mobile is the primary storefront acceptance target.

Desktop is not allowed to be the only design baseline.

---

# 64. Product Detail Page Architecture

PDP must consume:

```text
Catalog
+
Pricing
+
Inventory
+
Reviews
+
CMS content where needed
```

PDP must not duplicate those data sources.

---

# 65. Admin Architecture

Admin is part of the same application/codebase.

Primary modules:

```text
Dashboard

Sales

Marketing

Product

Inventory

Reports

System
```

---

# 66. Admin Sales Views

Examples:

```text
Orders

Customer Risk Center

Customer History

FB Order

Signed Orders

Abnormal Order

Double Check Order
```

These are business workbenches/views over shared core data.

Do NOT implement each as a separate independent database system.

---

# 67. Background Jobs

V1 may require asynchronous work for:

* logistics synchronization
* email
* report aggregation
* stale reservation checks
* retryable external API operations

Background job infrastructure should remain inside the same repository.

Do NOT create a separate microservice architecture.

Exact job runner:

```text
TBD
```

---

# 68. Logging

Application must have structured logs for:

```text
Order Creation

Payment

Inventory

Shipment

Logistics Webhook

Attribution

Errors
```

Never log full secrets.

Avoid logging unnecessary full customer PII.

---

# 69. Error Handling

Use consistent application error types.

Examples:

```text
VALIDATION_ERROR

NOT_FOUND

OUT_OF_STOCK

DUPLICATE_ORDER_RISK

PAYMENT_FAILED

LOGISTICS_ERROR

UNAUTHORIZED

FORBIDDEN
```

Storefront should receive safe consumer-friendly messages.

Detailed internal error belongs in logs.

---

# 70. Time Architecture

Database timestamps:

```text
UTC
```

Business reporting:

```text
Asia/Manila
```

Do not mix server-local timezone into business calculations.

---

# 71. Money Architecture

Never use floating-point arithmetic for money.

Use:

* integer minor units where appropriate
  or
* precise decimal database types

Currency must be explicit.

Storefront base currency:

```text
PHP
```

---

# 72. Media Architecture

Product/media files:

```text
Object Storage
```

Database stores metadata:

```text
id

url

media_type

alt_text

width

height

sort_order
```

Large video files must not live in PostgreSQL.

---

# 73. SEO Architecture

Storefront pages must support server-rendered metadata.

Product:

```text
SEO Title

Meta Description

Slug

OG Image
```

Collection and Landing Page need equivalent fields.

---

# 74. Performance Strategy

V1 priorities:

* fast mobile loading
* image optimization
* lazy loading
* Hero video fallback poster
* server-side caching where safe
* database indexes for key filters

Do not prematurely build complex distributed caching.

---

# 75. Database Backup

Production database must have automated backups.

Required:

```text
Database backup

Restore procedure
```

Before major migrations:

backup.

---

# 76. Migration Rule

All database schema changes must use versioned migrations.

Do NOT manually alter production schema without migration history.

---

# 77. Testing Strategy

Minimum test layers:

```text
Unit Tests

Integration Tests

End-to-End Tests
```

Critical workflows require integration tests.

---

# 78. Mandatory Critical Tests

At minimum:

```text
Create COD Order

Reserve Inventory

Cancel → Release Inventory

Denied → Release Inventory

Multiple SKU Order

Duplicate Place Order Protection

AID Snapshot

FB Post Attribution Persistence

Logistics Signed Webhook

Duplicate Logistics Webhook

Multiple Shipment Signed Logic

Signed Rate Calculation

Airwallex Disabled → Hidden

Payment State Independent of Order State
```

---

# 79. Architecture Non-Goals for V1

Do NOT build in V1:

```text
Microservices

Kubernetes

Event-driven distributed architecture

Full ERP

Full CRM

Full WMS

Data warehouse

Complex BI platform

Webflow-style builder

Customer loyalty

Membership

Affiliate platform

Multi-language storefront

Multi-currency storefront

Advanced recommendation engine
```

---

# 80. V1 Development Order

## Phase 0 — Architecture

Complete:

```text
README.md

V1_SCOPE.md

SYSTEM_ARCHITECTURE.md

BUSINESS_RULES.md

DATABASE_DESIGN.md

ORDER_FLOW.md

ATTRIBUTION_SYSTEM.md
```

No large-scale coding before architecture review.

---

## Phase 1 — Commerce Core

Build:

```text
Auth / Admin Users

Catalog

Product

SKU

Customer

Cart

Checkout

Order

Order Items

Inventory

Reservation
```

Goal:

```text
Customer can place a real COD order.
```

---

## Phase 2 — COD Operations

Build:

```text
Customer Risk

Again / RPT / Recheck

Confirmation

Question Order

Abnormal Order

Double Check

Customer History
```

Goal:

```text
Operations team can process COD Orders.
```

---

## Phase 3 — Fulfillment

Build:

```text
Shipment

Tracking

Warehouse

Logistics API

Signed Orders
```

Goal:

```text
Order can move from confirmed to signed.
```

---

## Phase 4 — Attribution

Build:

```text
Optimizer / AID

FB Page

FB Post

Meta Attribution

Landing Page

FB Order
```

Goal:

```text
Every attributable order can be traced to its business source.
```

---

## Phase 5 — Analytics

Build:

```text
Dashboard

Signed Rate

Province Analysis

Product Performance

Optimizer Performance

Revenue

Profit
```

Goal:

```text
Operations can measure real business performance.
```

---

# 81. Architecture Freeze Rules

After this document becomes:

```text
Status: FROZEN
Version: 1.0
```

AI Agents must NOT independently change:

* technology stack
* modular monolith architecture
* PostgreSQL as primary database
* Order → OrderItem relationship
* Inventory Reservation model
* AID snapshot strategy
* FB Order definition
* Signed Orders source
* Signed Rate formula
* Order / Payment / Confirmation / Shipment status separation
* module ownership boundaries

---

# 82. Architecture Change Process

If an Agent believes a frozen architectural decision must change:

Do NOT change it directly.

Create:

```text
docs/adr/XXXX-description.md
```

The ADR must contain:

```text
Problem

Current Architecture

Proposed Change

Why Change Is Needed

Alternatives

Database Impact

API Impact

Migration Impact

Risk

Rollback Strategy
```

Wait for approval before implementation.

---

# 83. Architecture Decision Levels

## Level 1 — Normal implementation

Agent may perform without architectural approval:

```text
Add index

Add validation

Add test

Refactor internal code

Add nullable non-core field
```

---

## Level 2 — Requires explicit explanation

Examples:

```text
New business table

New module dependency

New status

New external integration
```

Agent must explain before implementation.

---

## Level 3 — Requires approved ADR

Examples:

```text
Change Order model

Change inventory semantics

Change AID ownership

Change Signed Rate formula

Replace PostgreSQL

Replace Prisma

Split into microservices

Change payment architecture

Remove historical data
```

---

# 84. Agent Startup Rules

Every AI coding Agent must first read:

```text
README.md

AGENTS.md

docs/V1_SCOPE.md

docs/SYSTEM_ARCHITECTURE.md

docs/BUSINESS_RULES.md

docs/DATABASE_DESIGN.md
```

When relevant also read:

```text
docs/ORDER_FLOW.md

docs/ATTRIBUTION_SYSTEM.md

docs/HOMEPAGE_SPEC.md
```

---

# 85. Conflict Rule

If user request, implementation, database schema, or existing code conflicts with a frozen business or architectural rule:

Agent must:

```text
STOP

REPORT CONFLICT

PROPOSE OPTIONS
```

Do NOT silently redesign the system.

---

# 86. Final V1 Architecture

```text
                          USERS
                            │
              ┌─────────────┴─────────────┐
              │                           │
        CUSTOMER STOREFRONT            ADMIN
              │                           │
              └─────────────┬─────────────┘
                            │
                     APPLICATION LAYER
                            │
    ┌──────────┬────────────┼────────────┬────────────┐
    │          │            │            │            │
 Catalog   Customer       Orders      Inventory    Attribution
    │          │            │            │            │
 Pricing  Customer Risk  COD Ops      Purchasing    Facebook
    │          │            │            │            │
 Promotion    Cart       Fulfillment   Warehouse   Landing Page
    │          │            │            │            │
    └──────────┴────────────┼────────────┴────────────┘
                            │
                         Payments
                            │
                            ▼
                       PostgreSQL
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   Logistics API        Airwallex            Meta
        │
        ▼
   Signed Orders
        │
        ▼
      Analytics
```

---

# 87. Final Architecture Principle

This system should remain:

```text
Simple enough to launch
+
Structured enough to grow
+
Strict enough to protect business data
```

The V1 goal is NOT to build the most technically complex ecommerce platform.

The goal is to build:

> A reliable Philippines COD ecommerce operating system that can be continuously extended without rewriting its transaction core.

---

# Architecture Status

Current:

```text
BASELINE V0.9
```

Do not change to:

```text
FROZEN V1.0
```

until the following documents are reviewed together:

```text
V1_SCOPE.md

BUSINESS_RULES.md

DATABASE_DESIGN.md

ORDER_FLOW.md

ATTRIBUTION_SYSTEM.md
```

After review, this architecture can be formally frozen for V1 development.
