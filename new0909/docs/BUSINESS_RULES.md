# BUSINESS_RULES.md

# Philippines Small House Ecommerce
## Business Rules — V0.2

This file is the business source of truth for the Philippines Small House ecommerce project.

All agents and developers must read this file before modifying:

- Orders
- Payments
- Inventory
- Logistics
- Attribution
- Facebook Post tracking
- Customer risk
- Analytics

If implementation conflicts with this document:

STOP and report the conflict.

Do NOT silently invent a new business rule.

If a rule is marked `TBD`, do not make a permanent business decision without asking.

---

# 1. SYSTEM PRINCIPLES

## BR-001 — One unified Order system

All order types must use one underlying Order model.

Do NOT create separate independent order databases such as:

- FBOrder
- AdOrder
- SignedOrder
- CODOrder

These may exist as separate Admin views, filters, workflows, or extensions, but must reference the same underlying Order.

Example:

Order
├ Attribution
├ Payment
├ Shipment
├ OrderHistory
└ Customer

Admin may expose:

- FB Order
- New Orders
- Question Orders
- Confirmed Orders
- Shipping Orders
- Signed Orders
- Cancel Orders

But these must not become disconnected order systems.

---

# 2. PAYMENT RULES

## BR-010 — COD is the default payment method

The default payment method for the Philippines storefront is:

Cash on Delivery (COD)

Checkout should default-select COD when it is available.

---

## BR-011 — Airwallex is the optional online payment provider

The system must support two payment categories:

1. Cash on Delivery
2. Airwallex Online Payment

If Airwallex is not configured or not enabled:

- Do NOT show Airwallex as a disabled payment option.
- Only show COD.

Example:

Cash on Delivery
● Selected

If Airwallex becomes configured and enabled:

Display:

● Cash on Delivery

○ Online Payment

The storefront must determine payment availability from server-side configuration.

Do not hard-code Airwallex availability in frontend UI.

---

## BR-012 — Order status and Payment status are independent

Never assume:

SIGNED = PAID

For COD, an order may be signed by the customer while merchant settlement is still pending.

Example:

Order Status:
SIGNED

Payment Status:
SETTLEMENT_PENDING

Suggested payment states:

COD_PENDING
COLLECTED
SETTLEMENT_PENDING
SETTLED

ONLINE_PENDING
PAID
FAILED
REFUNDED
PARTIALLY_REFUNDED

Use the native Commerce Engine payment model where possible.

Do not duplicate native payment functionality unnecessarily.

---

# 3. ORDER STATUS

Current business order workflow must support the following concepts:

NEW
PENDING
QUESTION
CONFIRMED
DENIED
ABNORMAL
SHIPPING
SIGNED
CANCELLED
AFTER_SALES

Admin may expose business views such as:

- New Orders
- Pending Orders
- Question Orders
- Confirmed Orders
- Denied Orders
- Abnormal Orders
- Shipping Orders
- Signed Orders
- Cancel Orders
- After Sales Orders

Implementation should reuse one Order model and filters/workflows.

Do not build an independent database table for every view.

---

# 4. ORDER CREATION

## BR-020 — Order creation must create a historical snapshot

When an Order is successfully created, preserve the transaction-time values required for future auditing and analytics.

At minimum preserve:

- Order number
- Product / SKU
- Quantity
- Product name snapshot
- Unit price snapshot
- Discount snapshot
- Shipping fee
- Order total
- Customer information
- Shipping address snapshot
- AID
- Optimizer attribution
- Source type
- Facebook Post attribution if applicable
- Meta Ad attribution if applicable
- Landing Page attribution if applicable
- Created timestamp

Historical orders must not change simply because the current product, optimizer, Facebook Page assignment, or price changes later.

---

# 5. OPTIMIZER / AID

## BR-030 — AID is a core business field

`aid` must be retained.

AID represents:

WHO receives attribution for the order.

It is used for:

- Optimizer order attribution
- Performance calculation
- Commission / settlement calculation
- FB Order attribution
- Paid advertising order attribution
- Signed Order attribution

AID is not optional for traffic that belongs to an optimizer.

---

## BR-031 — AID, Post ID, and Ad ID are different concepts

Never treat them as interchangeable.

AID
= Which optimizer owns the order

Facebook Post ID
= Which organic Facebook Page post generated the visit/order

Ad ID
= Which paid Meta advertisement generated the visit/order

Source Type
= Which traffic channel generated the order

---

## BR-032 — Snapshot AID into the Order

When an Order is created, store an attribution snapshot such as:

optimizerId
optimizerAid
optimizerNameSnapshot

Do NOT dynamically determine historical optimizer ownership from current Facebook Page assignments.

Example:

September:
Page A belongs to Sam

October:
Page A belongs to Betty

September orders must remain attributed to Sam.

Changing page ownership later must not rewrite historical orders.

---

## BR-033 — Optimizer entity

The system should support an Optimizer entity.

Suggested fields:

id
name
aid
status
createdAt
updatedAt

Possible relations:

Optimizer
→ Facebook Pages
→ Facebook Posts
→ Ad IDs
→ Orders

---

# 6. FACEBOOK PAGE / FB ORDER

## BR-040 — FB Order definition

FB Order specifically means:

An order originating from an organic post published on a Facebook public Page.

FB Order is NOT the same as a Meta paid advertising order.

The system must keep these traffic types analytically separate.

---

## BR-041 — FB Order must remain an independent Admin view

The Admin must provide an `FB Order` view/module.

Do not remove this concept.

The underlying record still references the unified Order model.

---

## BR-042 — Legacy tracking format

The current business may use legacy URLs such as:

?aid=xxxx&adid=fb0909

Legacy values such as:

fb0909

may be supported for migration / compatibility.

However:

`fb + date`

must NOT be the primary long-term unique identifier for a Facebook post.

---

## BR-043 — Every Facebook organic post should have a unique tracking identity

Future implementation should support one unique tracking record per Facebook post.

Example internal tracking code:

FBP8K2M4

Suggested FacebookPost entity:

id
trackingCode

facebookPageId
facebookPostId

postUrl

productId

optimizerId
aid

publishedAt

createdAt
updatedAt

---

## BR-044 — Facebook Post tracking URL

Preferred future format:

/products/foldable-chair
?aid=OPT001
&source=fb_post
&post=FBP8K2M4

or:

/p/FBP8K2M4

The exact URL format may depend on the selected Commerce Engine.

The business requirement is:

One post must be uniquely identifiable.

---

## BR-045 — FB Order attribution

When a customer enters through an organic Facebook post, preserve:

sourceType = FB_POST

aid
optimizerId

facebookPageId
facebookPostId
facebookPostTrackingCode

productId if known

landingPageId if applicable

This attribution must survive normal browsing before checkout.

Use a server-safe attribution cookie/session strategy.

Exact attribution window is TBD.

---

## BR-046 — FB Order Admin fields

FB Order should eventually support at least:

Order Number
Order Date

AID
Optimizer

Facebook Page
Post ID
Post Date
Post URL

Product
SKU

Customer

Order Total
Order Status

Signed Date
Province

Signed Revenue

---

## BR-047 — FB Post analytics goals

The system must eventually be able to answer:

- Which post generated the most orders?
- Which post generated the most Signed Orders?
- Which post has the highest Signed Rate?
- Which post generated the highest Signed Revenue?
- Which Facebook Page performs best?
- Which optimizer's posts perform best?
- What happened on a specific posting date?

These reports do not all need to be V1 UI.

But the data model must preserve the required data from launch.

---

# 7. META PAID AD ATTRIBUTION

## BR-050 — Meta paid ads are separate from FB organic posts

Paid advertising traffic should use:

sourceType = META_AD

and should be distinguishable from:

sourceType = FB_POST

---

## BR-051 — Paid attribution fields

Preserve where available:

aid
optimizerId

campaignId
adSetId
adId

utmSource
utmMedium
utmCampaign
utmContent
utmTerm

fbclid

landingPageId

Do not require all values to be present.

The system must tolerate incomplete attribution data.

---

# 8. SOURCE TYPE

Initial source types:

FB_POST
META_AD
DIRECT
ORGANIC
EMAIL
OTHER

Future possible sources:

TIKTOK
GOOGLE_AD
AFFILIATE

Do not add these future values unless required.

---

# 9. DUPLICATE ORDERS

## BR-060 — Duplicate orders must not be automatically cancelled

If the system detects a suspected duplicate order:

Do NOT immediately cancel it.

Instead:

riskFlag = POSSIBLE_DUPLICATE

and route it for customer-service review.

---

## BR-061 — Initial duplicate detection concept

Potential duplicate signals include:

Same normalized phone
+
Same Product / SKU
+
Orders created within a defined time window

The exact duplicate time window is:

TBD

Suggested starting candidate:

24 hours

Do not hard-code permanently until confirmed.

---

## BR-062 — Customer service actions for duplicate orders

Customer service may:

- Confirm
- Cancel
- Mark Duplicate
- Keep Both
- Add internal note

If an order is cancelled:

Inventory reservation must be released.

---

# 10. CUSTOMER COD RISK

## BR-070 — COD risk must be tracked

Customers with history including:

- Refused delivery
- Denied orders
- COD failed
- Repeated cancellations
- Repeated unreachable contact

should be risk-flagged.

Initial risk states:

NORMAL
WATCHLIST
HIGH_RISK
BLOCKED

---

## BR-071 — Previous refusal history requires customer-service review

If the customer has refused/signature-failed history:

Do not treat the order exactly like a normal order.

Mark the order for review.

Customer service should contact the customer and decide whether to:

Confirm

or

Cancel

---

## BR-072 — Phone is a major customer identity key

Phone number must be normalized.

Examples of different representations of the same Philippine number must be normalized into one canonical format.

Phone is used for:

- Customer identification
- Duplicate detection
- COD risk detection
- Order lookup
- Customer service
- Blocklist / risk history

---

## BR-073 — Blocked customers

Current recommended V1 behavior:

Do not silently delete or discard attempted orders.

Flag them clearly as:

BLOCKED / HIGH_RISK

and require manual review.

Whether BLOCKED should completely prevent COD checkout is:

TBD

---

# 11. INVENTORY

## BR-080 — Prefer native Commerce Engine inventory

If the selected open-source Commerce Engine already supports:

- Stock location
- Inventory
- Reservation
- Adjustment
- Fulfillment stock deduction

use the native implementation.

Do not create a conflicting second inventory engine.

---

## BR-081 — Required inventory concepts

Business reporting should be capable of representing:

On Hand
Reserved
Available
Incoming
Damaged

Exact physical calculation should follow the selected Commerce Engine's inventory model.

---

## BR-082 — Order creation reserves inventory

When an order is successfully created:

inventory must be reserved.

Conceptually:

Available decreases

Reserved increases

Do not permanently treat inventory as sold immediately at checkout if the engine supports proper reservation.

---

## BR-083 — Cancelled orders release inventory

Confirmed business rule:

When an Order is cancelled:

Release its inventory reservation.

This applies to:

- Customer cancellation
- Duplicate cancellation
- Denied order
- Invalid order cancellation

Reservation must not remain locked.

---

## BR-084 — Inventory movement history

All meaningful inventory mutations should be auditable.

Examples:

PURCHASE
ORDER_RESERVED
RESERVATION_RELEASED
SHIPMENT
RETURN
DAMAGED
MANUAL_ADJUSTMENT

If the Commerce Engine already offers equivalent inventory transaction history, reuse it.

---

# 12. STOCK AVAILABILITY ON STOREFRONT

## BR-090 — In Stock

If inventory is available:

Show:

In Stock

Enable:

Add to Cart
Buy Now

---

## BR-091 — Low Stock

If real stock falls below a configured threshold:

The storefront may show:

Only X left

This must be based on real inventory.

Do not create fake scarcity.

---

## BR-092 — Out of Stock

If:

Available = 0

and

Pre-order is disabled

Show:

Out of Stock

Disable:

Add to Cart
Buy Now

Recommended future CTA:

Notify Me When Available

---

## BR-093 — Pre-order

If:

Available = 0

and

Pre-order is enabled

Show:

Pre-order

Do NOT show:

In Stock

The PDP should display an estimated dispatch date/window.

Example:

Estimated dispatch:
Sep 20–25

CTA:

Pre-order Now

Whether pre-order supports COD is:

TBD

---

## BR-094 — Out-of-stock products must not automatically disappear

Stock = 0 must NOT automatically:

- delete the product
- produce 404
- destroy the PDP URL

The PDP should remain available.

---

## BR-095 — Collection behavior for out-of-stock products

Default behavior:

Keep the product visible.

Show an Out of Stock badge.

The system may rank it lower.

Future optional field:

hideFromCollection

Even when hidden from Collection:

PDP URL should remain valid unless the product is intentionally archived.

---

# 13. SIGNED ORDERS

## BR-100 — Name must remain `Signed Orders`

The Admin page and business terminology must use:

Signed Orders

Do NOT rename this business concept to:

Delivered Orders

unless used internally as a carrier status mapping.

---

## BR-101 — Signed Orders source

Confirmed business rule:

The normal source of Signed Orders is:

LOGISTICS API

The system should receive carrier/logistics status updates and map the relevant signed/delivered carrier state to the business state:

SIGNED

---

## BR-102 — Signed timestamp

Use the actual signed timestamp returned by the logistics provider where available.

Do NOT substitute:

- API receive time
- Admin view time
- Sync execution time

for the real signed time.

Suggested fields:

signedAt
signedEventReceivedAt

---

## BR-103 — Signed source

Normal source:

LOGISTICS_API

If future exception correction is supported:

signedSource may support:

LOGISTICS_API
IMPORT
MANUAL_OVERRIDE

Manual override must not be the normal workflow.

---

## BR-104 — Manual Signed correction

If implemented:

Only highly privileged users such as SUPER_ADMIN may perform manual correction.

Must record:

manualOverride = true
overrideReason
operator
overrideAt

Never allow unlogged manual Signed changes.

---

## BR-105 — Signed Orders fields

Signed Orders should eventually support:

Order Number

AID
Optimizer

Product
SKU
Product Option

Customer

Province
City

Carrier
Tracking Number

Shipping Date
Signed Date

Shipping-to-Signed Days

Order Value
Shipping Fee

Source Type

Facebook Post ID
Ad ID

---

## BR-106 — Signed Orders analysis dimensions

Signed Orders must eventually support filtering/analysis by:

Date
Product
SKU
Province
City
AID
Optimizer
Source
Facebook Post
Ad ID
Carrier

---

# 14. MULTIPLE SHIPMENTS

## BR-110 — One Order may have multiple Shipments

Never assume:

1 Order = 1 Tracking Number

Data model must allow:

Order
1:N
Shipment

This is especially important for furniture.

---

## BR-111 — Order Signed condition with multiple shipments

If an Order has multiple required Shipments:

The Order must NOT become SIGNED after only one required Shipment is signed.

Default rule:

Order becomes SIGNED only when all required shipments for the order are signed.

Example:

Shipment A = SIGNED
Shipment B = SHIPPING

Order remains SHIPPING.

When:

Shipment A = SIGNED
Shipment B = SIGNED

Then:

Order = SIGNED

If the selected Commerce Engine has partial fulfillment semantics, extend them rather than replacing them.

---

# 15. SIGNED RATE

## BR-120 — Signed Rate definition

Confirmed business rule:

Signed Rate denominator is:

ALL BACKEND-CREATED ORDERS

including:

- Cancelled orders
- Invalid orders
- Denied orders
- Other unsuccessful order outcomes

Formula:

Signed Rate
=
Signed Orders
/
Total Orders Created
× 100%

---

## BR-121 — Total Orders definition

For production analytics:

Total Orders means all successfully created business orders in the backend for the selected scope/date range.

Cancelled and invalid orders remain in the denominator.

Do NOT recalculate Signed Rate using only:

- Confirmed Orders
- Shipped Orders
- Valid Orders

unless the report is explicitly named differently.

Test/sandbox order exclusion policy is:

TBD

---

## BR-122 — Shipping-to-Signed Rate is a different metric

If required:

Shipping-to-Signed Rate
=
Signed Orders
/
Orders Entered Shipping

This metric must NOT be labeled simply:

Signed Rate

The business-standard `Signed Rate` always uses Total Orders as denominator.

---

## BR-123 — Related funnel metrics

Recommended definitions:

Confirmation Rate
=
Confirmed Orders / Total Orders

Shipping Rate
=
Orders Entered Shipping / Total Orders

Signed Rate
=
Signed Orders / Total Orders

Cancel Rate
=
Cancelled Orders / Total Orders

Denied Rate
=
Denied Orders / Total Orders

Shipping-to-Signed Rate
=
Signed Orders / Orders Entered Shipping

Keep metric naming consistent across all reports.

---

# 16. SIGNED REVENUE

## BR-130 — Signed Revenue must be separate from placed revenue

The system must distinguish:

Placed Revenue

from:

Signed Revenue

Signed Revenue only applies to orders that have reached business status:

SIGNED

---

## BR-131 — Preserve revenue components

Prefer preserving separately:

Product Revenue
Shipping Revenue
Discount
Order Revenue

For Signed Orders, allow calculation of:

Signed Product Revenue
Signed Shipping Revenue
Signed Order Revenue

Exact financial reporting default is:

TBD

Do not collapse all revenue concepts into one irreversible number.

---

# 17. PRODUCT / FURNITURE DATA

Use native Commerce Engine entities where possible for:

Product
Variant
Category
Collection
Price
SKU
Media

Add furniture-specific extensions only where required.

---

## BR-140 — Furniture dimensions

Support:

width
height
depth

For foldable products:

foldedWidth
foldedHeight
foldedDepth

Non-foldable products may leave folded dimensions empty.

---

## BR-141 — Logistics dimensions

Support:

productWeight

packageWidth
packageHeight
packageDepth
packageWeight

volumetricWeight

These values may be required for future shipping-rate calculation.

---

## BR-142 — Furniture attributes

Support where applicable:

material
color
loadCapacity
assemblyRequired
assemblyTime

Do not invent these values.

They must come from verified product data.

---

## BR-143 — Internal supply-chain information

Internal fields may include:

supplier
supplierSKU
supplierURL
supplierCost
costCurrency
landedCost

These are Admin/internal data.

Do not expose supplier-sensitive data to the storefront by default.

---

# 18. PRODUCT CLASSIFICATION

Initial Room structure:

Bedroom
Storage
Dining & Living
Home Office

Initial Solution tags:

Foldable
Narrow
Mobile
Under-bed
Hidden Storage
Multi-functional
Rental Friendly

Internal Product Role:

Hero
Core
Entry
Premium
Pre-order

Use native tags/categories/metadata/relations where appropriate.

Do not put every structured field into one giant JSON metadata object.

---

# 19. LOGISTICS

## BR-150 — Shipment entity

At minimum Shipment should support:

orderId
warehouseId
carrier
trackingNumber
shippingCost
shippedAt
signedAt
status

Use native fulfillment/shipment models from the selected Commerce Engine where possible.

---

## BR-151 — Shipping Rate future requirements

Shipping rules should eventually be capable of considering:

Province
City
Barangay

Weight
Volumetric Weight

Oversize

Base Shipping Fee
Additional Fee

Estimated Delivery Days

V1 may initially use a simpler Shipping Rate table if logistics API integration is not ready.

---

# 20. CUSTOMER CHECKOUT

## BR-160 — Guest checkout first

V1 should not require customers to register an account before purchase.

Preferred flow:

Product
→ Cart
→ Checkout
→ Shipping Information
→ Payment
→ Place Order

Customer records may be created or matched by Phone / Email.

---

## BR-161 — Philippines shipping address

Expected fields:

Full Name
Mobile Number
Email

Province
City / Municipality
Barangay
Street Address
Landmark
Postal Code

Order Note

Required/optional rules are:

TBD

---

# 21. LANDING PAGES

## BR-170 — One Product may have multiple Landing Pages

Example:

/products/foldable-chair

/lp/foldable-chair-condo

/lp/foldable-chair-ugc

/lp/foldable-chair-promo

---

## BR-171 — Landing Page relation

A Landing Page should support relation to:

Product

and where applicable:

Facebook Post
Campaign
Ad ID

Orders must preserve:

landingPageId

when attribution is available.

---

## BR-172 — V1 Landing Page Builder scope

Do NOT build a Webflow-style arbitrary page builder in V1.

Use structured sections such as:

Hero
Problem
Solution
Product Demo
Benefits
Before / After
Dimensions
Reviews
Offer
FAQ
CTA

Allow:

- Enable / Disable
- Reorder
- Edit copy
- Replace media

---

# 22. ANALYTICS DATA PRESERVATION

## BR-180 — Data first, dashboards second

V1 does NOT need every analytics dashboard implemented.

But V1 must preserve the data required to calculate future analytics.

Do not discard attribution timestamps, status timestamps, cost fields, or logistics timestamps merely because a report is not yet built.

---

## BR-181 — Future FB Post analytics

Must eventually support:

Facebook Page
Post
Post Date
Product
AID
Optimizer

Orders
Signed Orders
Signed Rate

Revenue
Signed Revenue

---

## BR-182 — Future Advertising analytics

Must eventually support:

AID
Optimizer

Campaign
Ad Set
Ad

Landing Page

Spend
Orders
CPA

Signed Orders
Signed CPA

ROAS
Signed ROAS

Ad-spend synchronization from Meta Marketing API is not required for the first implementation.

---

## BR-183 — Future Product analytics

Should eventually support:

Product
Orders
Signed Orders
Signed Rate

Revenue
Signed Revenue

Profit

7D Trend
Stock Days

---

## BR-184 — Future Operations analytics

Should eventually support:

Confirmation Rate
Shipping Rate
Signed Rate

Average Confirmation Time
Average Shipping Time
Average Shipping-to-Signed Time

Province Performance
Logistics Performance

---

# 23. ORDER HISTORY / AUDIT

## BR-190 — Order status changes must be recorded

Every meaningful order-state change must preserve history.

Suggested fields:

orderId
fromStatus
toStatus
comment
operatorId
changedAt
source

Possible source:

SYSTEM
ADMIN
LOGISTICS_API
PAYMENT_API

---

## BR-191 — Business attribution changes must be auditable

If AID or optimizer attribution can ever be changed manually:

Never silently overwrite.

Record:

oldAid
newAid
changedBy
changedAt
reason

Whether Admin may change AID is:

TBD

---

# 24. SECURITY

## BR-200 — Secrets must not be exposed in Admin UI

Never expose full:

Airwallex Secret
Meta Access Token
Logistics API Secret
Email API Secret
Database URL

Secrets belong in:

Environment Variables
or
Secret Management

Admin may display:

Connected

or masked values such as:

••••••4A21

---

# 25. TIMEZONE

## BR-210 — Business timezone

Philippines business timezone:

Asia/Manila
UTC+8

Recommended storage strategy:

Store timestamps in UTC.

Render business reports in:

Asia/Manila

This applies to:

Order Date
Facebook Post Date
Shipping Date
Signed Date
Daily Analytics

---

# 26. CURRENCY

## BR-220 — Storefront currency

Customer-facing currency:

PHP

Symbol:

₱

Internal supply-chain costs may eventually use:

CNY
PHP
USD

Business reporting should eventually normalize to a base reporting currency.

Recommended base reporting currency:

PHP

---

# 27. OPEN-SOURCE COMMERCE ENGINE RULE

## BR-230 — Prefer native capability + extension

If the selected Commerce Engine supports a required standard ecommerce feature natively:

Use it.

Preferred architecture:

Commerce Engine Core
+
Custom Module
+
Custom Workflow
+
Admin Extension

Avoid:

Direct Core modification

unless a technical review proves extension is impossible.

---

# 28. CURRENT V1 PRIORITY

P0 — Required for initial commerce launch:

Product
Variant
Category
Collection

Storefront
PDP

Cart
Checkout

COD

Airwallex configuration capability

Order

AID attribution

FB Post tracking

Meta attribution fields

Inventory
Reservation

Cancel releases reservation

Shipment

Logistics API integration

Signed Orders

Signed Rate data

Customer risk

Basic Landing Pages

Admin

---

# 29. CURRENT TBD ITEMS

The following rules are NOT confirmed yet.

Do not make permanent assumptions.

1. Duplicate-order detection time window.
2. Whether BLOCKED customers are fully prevented from COD checkout.
3. Whether Pre-order supports COD.
4. Exact Philippines checkout required fields.
5. Inventory reservation expiry / stale-order handling.
6. Facebook organic attribution window.
7. Meta attribution window used by internal reports.
8. Whether AID can be manually reassigned after order creation.
9. Whether one Facebook Page can have multiple active Optimizers.
10. Final shipping-fee calculation rules.
11. Whether one Order may be partially cancelled at item level.
12. Exact after-sales rules:
    - Return
    - Exchange
    - Transit Damage
    - Missing Parts
13. Signed Revenue default reporting formula.
14. Test/sandbox order exclusion from production Signed Rate.
15. COD remittance / settlement reconciliation workflow.
16. Airwallex refund workflow.
17. Pre-order inventory reservation behavior.

When implementation reaches one of these items:

STOP and ask for clarification instead of inventing a rule.

---

# 30. AGENT IMPLEMENTATION INSTRUCTION

Before implementing any feature affected by this file:

1. Read BUSINESS_RULES.md.
2. Inspect the selected Commerce Engine's native model.
3. Identify what can be implemented natively.
4. Identify what requires an extension.
5. Avoid duplicating native Commerce Engine features.
6. Avoid modifying Core unless absolutely required.
7. Report any conflict between platform behavior and business rules.
8. Do not silently change confirmed business terminology such as:
   - FB Order
   - Signed Orders
   - AID
9. Preserve future analytics data even if the dashboard is not part of V1.
10. Add tests for:
    - order creation
    - inventory reservation
    - cancellation release
    - logistics Signed update
    - duplicate logistics webhook processing
    - attribution persistence
    - AID snapshot preservation

Business correctness takes priority over implementation convenience.