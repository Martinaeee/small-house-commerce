# DATABASE_DESIGN.md

# Philippines Small House COD Ecommerce Platform

**Version:** V1.0
**Status:** Architecture Baseline
**Market:** Philippines
**Currency:** PHP
**Business Model:** DTC Ecommerce + COD Operations + Facebook Attribution
**Primary Payment:** Cash on Delivery
**Optional Payment:** Airwallex

---

# 0. Purpose

This document defines the logical database architecture for the Philippines Small House ecommerce platform.

The system is not only a normal online store.

It must support:

* Ecommerce transactions
* COD operations
* Customer risk control
* Optimizer / AID attribution
* Facebook organic post attribution
* Meta advertising attribution
* Inventory reservation
* Logistics API integration
* Signed Orders
* Signed Rate analysis
* Product / Province / Optimizer analytics
* Landing Pages
* Revenue and profit analysis

This document is a source of truth for database and backend architecture.

---

# 1. IMPORTANT IMPLEMENTATION RULE


This project uses a fully custom ecommerce architecture.


The platform does NOT depend on:

- Shopify
- WooCommerce
- Medusa
- Bagisto
- Other Commerce Engine frameworks


The system will implement its own:

- Product Management
- Customer Management
- Cart System
- Order System
- Inventory System
- COD Operation System
- Attribution System
- Analytics System


The reason:

The project requires custom Philippines COD business logic that is not available in standard ecommerce platforms.


The database design must prioritize:

- COD workflow
- Customer risk management
- Facebook attribution
- Optimizer tracking
- Signed order analytics
- Profit analysis


All business data must have one source of truth.

Preferred architecture:


Custom Ecommerce Core

+

Business Modules

+

Custom Frontend Experience
```

Avoid:

```text
Commerce Engine Orders
+
Custom Orders Table
```

or:

```text
Commerce Engine Inventory
+
Second Independent Inventory System
```

This document describes the required logical data model.

The actual implementation must first map these requirements onto native Commerce Engine models.

---

# 2. Database Design Principles

## DB-001 — One source of truth

Core transactional data must have one canonical source.

Examples:

Product data:

```text
Product / Product Variant
```

Order data:

```text
Order / Order Items
```

Inventory:

```text
Inventory Item / Location / Reservation
```

Do not maintain parallel competing copies.

---

## DB-002 — Facts before reports

Reports should normally be calculated from raw business facts.

For example:

Signed Rate must be calculated from:

```text
Orders
+
Shipment / Logistics Events
```

Do not manually maintain Signed Rate as the primary source of truth.

Cached aggregates or materialized views may be created later for performance.

---

## DB-003 — Historical snapshots

Historical transactions must not change when current master data changes.

When an order is created, preserve snapshots for:

* Product name
* SKU code
* Variant
* Selling price
* Discount
* Customer name
* Phone
* Shipping address
* AID
* Optimizer
* Attribution

---

## DB-004 — Important changes require history

Do not overwrite important state without an audit trail.

Must preserve history for:

* Order status
* Confirmation
* AID reassignment
* Inventory changes
* Logistics events
* Customer risk changes
* Manual Signed correction

---

# 3. High-Level Architecture

```text
Traffic
│
├── FB_POST
├── META_AD
├── ORGANIC
├── DIRECT
└── OTHER
        │
        ▼
Attribution
        │
        ▼
Customer / Lead
        │
        ▼
Order
        │
        ├── Order Items
        │
        ├── Payment
        │
        ├── Confirmation
        │
        └── Inventory Reservation
                    │
                    ▼
                Shipment
                    │
                    ▼
             Logistics Events
                    │
             ┌──────┴──────┐
             │             │
           SIGNED        FAILED
             │
             ▼
        Signed Analytics
             │
             ▼
        Profit Analytics
```

---

# 4. User / Admin System

Use the Commerce Engine's Admin authentication system if available.

Custom role requirements:

```text
SUPER_ADMIN
ADMIN
OPTIMIZER
CONFIRMOR
WAREHOUSE
FINANCE
```

---

# 5. users

Logical entity:

```text
users
```

Suggested fields:

| Field      | Type          | Description       |
| ---------- | ------------- | ----------------- |
| id         | UUID / bigint | User ID           |
| name       | string        | Display name      |
| email      | string        | Login email       |
| status     | enum          | ACTIVE / DISABLED |
| created_at | datetime      | Created time      |
| updated_at | datetime      | Updated time      |

Passwords should use the selected framework's authentication system.

Do not implement plain-text password storage.

---

# 6. roles / permissions

Prefer RBAC.

Logical relationship:

```text
User
N:M
Role
N:M
Permission
```

Example permissions:

```text
ORDER_VIEW_ALL

ORDER_VIEW_OWN

ORDER_CONFIRM

ORDER_CANCEL

ORDER_CHANGE_AID

CUSTOMER_RISK_VIEW

CUSTOMER_RISK_EDIT

INVENTORY_VIEW

INVENTORY_ADJUST

SHIPMENT_CREATE

REPORT_PROFIT_VIEW

SYSTEM_SETTINGS_EDIT
```

---

# 7. Optimizer / AID

AID is a core business identifier.

It represents:

> Which optimizer owns the order attribution.

It must not be confused with:

* Ad ID
* Post ID
* Campaign ID

---

# 8. optimizers

Suggested logical entity:

```text
optimizers
```

Fields:

| Field        | Description                       |
| ------------ | --------------------------------- |
| id           | Internal ID                       |
| user_id      | Related Admin user                |
| aid          | Unique optimizer attribution code |
| display_name | Optimizer name                    |
| status       | ACTIVE / DISABLED                 |
| created_at   | Created time                      |
| updated_at   | Updated time                      |

Constraints:

```text
aid UNIQUE
```

---

# 9. Customer System

The main identity key for Philippines COD customers is:

```text
Normalized Phone Number
```

Email is useful but not required as the primary identity.

---

# 10. customers

Suggested fields:

| Field              | Description           |
| ------------------ | --------------------- |
| id                 | Customer ID           |
| name               | Current customer name |
| normalized_phone   | Canonical phone       |
| email              | Email                 |
| current_risk_level | Current risk          |
| created_at         | First seen            |
| updated_at         | Last update           |

Risk:

```text
NORMAL
WATCHLIST
HIGH_RISK
BLOCKED
```

Do not make statistical counters in this table the only source of truth.

---

# 11. customer_addresses

Customers may have multiple addresses.

Fields:

```text
id

customer_id

full_name

phone

province

city

barangay

postal_code

street_address

landmark

created_at
```

Historical orders must still store their own address snapshot.

---

# 12. Phone Normalization

Phone numbers must be normalized before customer lookup.

Examples:

```text
09171234567

+639171234567

639171234567
```

must resolve to one canonical customer identity where valid.

Store:

```text
normalized_phone
```

separately from the user-entered display value if required.

---

# 13. Customer Risk Events

Do not only store:

```text
risk_level = HIGH_RISK
```

without knowing why.

Use:

```text
customer_risk_events
```

Suggested fields:

```text
id

customer_id

order_id nullable

risk_type

risk_score nullable

reason

source

created_by nullable

created_at
```

Possible `risk_type`:

```text
REFUSED_HISTORY

FAILED_DELIVERY_HISTORY

DENIED_HISTORY

REPEATED_CANCEL

POSSIBLE_DUPLICATE

UNREACHABLE

MANUAL_BLOCK

MANUAL_UNBLOCK
```

---

# 14. AGAIN / RPT / RECHECK

These are operational customer/order labels.

Do not use them as the only permanent customer risk model.

Suggested:

```text
order_customer_classification
```

Possible values:

```text
NEW

AGAIN

RPT

RECHECK
```

The classification is calculated when the new order enters the system and stored as a snapshot.

---

# 15. AGAIN Rule

Initial business rule:

```text
Customer has previous SIGNED order
AND
Denied history = 0
AND
places another order
```

Classification:

```text
AGAIN
```

---

# 16. RPT Rule

Initial conditions may include:

### Condition A

Previous active order exists:

```text
PENDING
CONFIRMED
SHIPPING
```

and customer orders again.

OR:

### Condition B

Same SKU has previous:

```text
DENIED
CANCELLED
```

and customer orders again.

Classification:

```text
RPT
```

Final detection details must follow BUSINESS_RULES.md.

---

# 17. RECHECK Rule

If customer history contains:

```text
DENIED
REFUSED
FAILED_DELIVERY
```

classification:

```text
RECHECK
```

Priority:

```text
RECHECK
>
RPT
>
AGAIN
>
NEW
```

---

# 18. Lead / Pre-Order Submission Layer

A Lead entity is useful only if the site captures information before a real Order is successfully created.

Examples:

* COD form partially submitted
* abandoned COD form
* invalid phone submission
* campaign lead without completed order

Logical entity:

```text
leads
```

This entity should NOT duplicate normal Orders.

If V1 does not capture pre-order form leads, this table can be deferred.

Suggested fields:

```text
id

name

normalized_phone

email

province

city

barangay

source_type

aid

landing_page_id

status

created_at
```

Possible status:

```text
NEW

ORDER_CREATED

ABANDONED

INVALID
```
# Product Collection System


## Purpose


Collections represent customer-facing shopping destinations.


Collections are different from Categories.



Category:

Used for product classification.



Collection:

Used for customer shopping discovery, navigation, merchandising and SEO.



Examples:


Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers

New Arrivals



Collections are used by:


- Homepage navigation
- Collection landing pages
- SEO pages
- Product recommendation
- Marketing campaigns



---


# collections


Logical entity:


collections



Purpose:


Store storefront collection destinations.



Fields:



| Field | Description |
|---|---|
| id | Collection ID |
| name | Display name |
| slug | URL slug |
| description | Collection description |
| short_description | Short introduction |
| banner_image | Collection hero image |
| thumbnail_image | Navigation image |
| collection_type | Collection classification |
| seo_title | SEO title |
| seo_description | SEO description |
| status | ACTIVE / DISABLED |
| sort_order | Display order |
| created_at | Created time |
| updated_at | Updated time |



---


# Collection Type



Possible values:



PRODUCT_CATEGORY


Customer product grouping.


Example:


Chairs & Stools

Tables & Desks



---


SCENE


Lifestyle scenario collection.


Example:


Small-Space Solutions

Condo Living



---


MARKETING


Campaign based collection.


Example:


New Arrivals



---


DYNAMIC


Automatically generated collection.


Example:


Best Sellers



---


# Collection Product Relationship



A product can belong to multiple collections.



Example:



Foldable Chair:



Belongs to:


Chairs & Stools


+

Small-Space Solutions


+

Best Sellers



Therefore:


Relationship:



Collection


N:M


Product



Use intermediate table:



collection_products



---


# collection_products



Purpose:


Connect products and collections.



Fields:



| Field | Description |
|---|---|
| id | ID |
| collection_id | Collection ID |
| product_id | Product ID |
| sort_order | Product display order |
| created_at | Created time |



Example:



Collection:

Small-Space Solutions



Products:


Foldable Chair


Compact Desk


Storage Cabinet



---


# Collection Landing Page Content



Collection pages require independent content management.



Examples:


Hero Banner


Lifestyle Introduction


Product Recommendation


FAQ


SEO Content



Use:



collection_sections



---


# collection_sections



Purpose:


Manage collection landing page modules.



Fields:



| Field | Description |
|---|---|
| id | Section ID |
| collection_id | Collection ID |
| section_type | Module type |
| content_json | Section content |
| sort_order | Display order |
| enabled | Enable status |
| created_at | Created time |
| updated_at | Updated time |



---


# Collection Section Types



Possible values:



HERO


Collection hero banner.



---


INTRO


Collection introduction.



---


LIFESTYLE


Lifestyle scenario content.



---


FEATURED_PRODUCTS


Featured products.



---


PRODUCT_GRID


Product listing.



---


ROOM_SCENE


Room usage scenario.



---


BENEFITS


Collection benefits.



---


FAQ


Frequently asked questions.



---


SEO_CONTENT


SEO content block.



---


CTA


Conversion section.



---


# Collection Relationship Summary




Homepage Navigation

    |

    |

Collections

    |

    |

collection_products

    |

    |

Products




Collection pages are not advertisements.


They are permanent storefront destinations.



Landing Pages remain separate:



Collection:

Organic website navigation


Landing Page:

Campaign traffic conversion page


---

# 19. Product System

Use Commerce Engine native Product models if possible.

Do not create a competing product engine.

---

# 20. Product Required Data

Logical Product:

```text
Product
```

Needs to support:

```text


Name

Slug

Description

Media

Category

Status
```

---

# 21. Product Variant / SKU

Each sellable variation must have an independent SKU.

Example:

```text
Foldable Chair
├ Black
├ White
└ Wood
```

Each can have:

* different cost
* different stock
* different package data

---

# 22. SKU / Variant Required Fields

Logical requirements:

```text
sku_code

product_id

variant_id

status

supplier_sku

supplier_id

supplier_cost

cost_currency

landed_cost
```

---

# 23. Furniture Dimensions

Furniture products must support structured dimensions.

Product dimensions:

```text
width

height

depth
```

Folded dimensions:

```text
folded_width

folded_height

folded_depth
```

If not foldable:

nullable.

---

# 24. Shipping / Package Dimensions

Each relevant SKU should support:

```text
product_weight

package_width

package_height

package_depth

package_weight

volumetric_weight
```

Do not mix:

```text
Product Size
```

with:

```text
Package Size
```

---

# 25. Furniture Attributes

Structured fields where applicable:

```text
material

load_capacity

assembly_required

assembly_time

tools_required
```

Do not put every structured field inside one uncontrolled JSON blob.

---

# 26. Product Classification

Initial merchandising dimensions:

## Room

```text
BEDROOM

STORAGE

DINING_LIVING

HOME_OFFICE
```

## Solution

```text
FOLDABLE

NARROW_SPACE

MOBILE

MULTIFUNCTIONAL

HIDDEN_STORAGE

RENTAL_FRIENDLY
```

## Internal Product Role

```text
HERO

CORE

ENTRY

PREMIUM

PRE_ORDER
```

---

# 27. Supplier System

Suggested logical entity:

```text
suppliers
```

Fields:

```text
id

name

contact

source_platform

supplier_url

currency

status
```

Sensitive supplier information must remain Admin-only.

---

# 28. Warehouse System

Even if V1 uses one warehouse, database architecture should support multiple warehouses.

Logical:

```text
warehouses
```

Fields:

```text
id

name

country

province

city

status
```

V1 may only use one active Philippines warehouse.

---

# 29. Inventory Architecture

Use native Commerce Engine inventory and reservation systems where possible.

Required business concepts:

```text
On Hand

Reserved

Available

Incoming

Damaged
```

Conceptually:

```text
Available
=
On Hand
-
Reserved
-
Unavailable Stock
```

`Available` may be calculated rather than stored.

---

# 30. Inventory Reservation

Confirmed business direction:

When a valid Order is created:

```text
Create Inventory Reservation
```

Do not immediately permanently reduce physical On Hand stock.

Conceptual flow:

```text
Order Created

Available -1
Reserved +1
```

---

# 31. Order Cancellation

When an order is:

```text
CANCELLED

DENIED

DUPLICATE_CANCELLED
```

its remaining inventory reservation must be released.

Conceptually:

```text
Reserved -1

Available +1
```

---

# 32. Inventory Shipment

At Shipment/Fulfillment:

reservation converts to physical stock movement according to the native Commerce Engine inventory model.

Do not implement two deductions.

Avoid:

```text
Reserve stock
AND
accidentally deduct again twice
```

---

# 33. Inventory Movements

Every meaningful stock mutation should be auditable.

Logical entity:

```text
inventory_movements
```

Possible types:

```text
PURCHASE_RECEIPT

ORDER_RESERVED

RESERVATION_RELEASED

SHIPMENT

RETURN_RESTOCK

DAMAGED

MANUAL_ADJUSTMENT
```

Suggested fields:

```text
id

sku_id

warehouse_id

movement_type

quantity

reference_type

reference_id

operator_id nullable

reason nullable

created_at
```

---

# 34. Purchase SKU

V1 should support simple purchasing/incoming inventory.

Use:

```text
purchase_orders
```

and:

```text
purchase_order_items
```

instead of one flat Purchase SKU table where possible.

---

# 35. purchase_orders

Fields:

```text
id

purchase_number

supplier_id

warehouse_id

status

purchase_date

expected_arrival_date

remark

created_by

created_at
```

Status:

```text
DRAFT

ORDERED

IN_TRANSIT

PARTIALLY_RECEIVED

RECEIVED

CANCELLED
```

---

# 36. purchase_order_items

Fields:

```text
id

purchase_order_id

sku_id

quantity_ordered

quantity_received

unit_cost

currency
```

---

# 37. Order Architecture

Use Commerce Engine native Order where possible.

Critical rule:

```text
One Order
can contain
many Order Items.
```

Never store:

```text
product_id
sku_id
quantity
```

only at Order header level.

---

# 38. orders

Logical requirements:

```text
id

order_number

customer_id

order_status

confirmation_status

payment_status

currency

subtotal

discount_total

shipping_total

grand_total

optimizer_id nullable

optimizer_aid_snapshot nullable

optimizer_name_snapshot nullable

customer_classification

created_at

updated_at
```

---

# 39. Order Status Domains

Do NOT overload one single status field for every business concept.

Separate:

```text
Order Status

Confirmation Status

Payment Status

Fulfillment / Shipment Status
```

---

# 40. Order Business Status

Suggested high-level business status:

```text
NEW

PENDING

QUESTION

CONFIRMED

ABNORMAL

SHIPPING

SIGNED

CANCELLED

DENIED

AFTER_SALES
```

If the Commerce Engine uses other native states, map them instead of forcing incompatible replacement.

---

# 41. Confirmation Status

Suggested:

```text
UNCONFIRMED

NEEDS_REVIEW

CONFIRMED

REJECTED
```

Fields:

```text
confirmed_by

confirmed_at

confirmation_note
```

---

# 42. Payment Status

Payment status is independent.

Possible values:

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

---

# 43. Order Items

Logical entity:

```text
order_items
```

Required snapshot fields:

```text
id

order_id

product_id

variant_id

sku_id

product_name_snapshot

sku_code_snapshot

variant_snapshot

quantity

unit_price

unit_discount

unit_cost_snapshot

line_total
```

This guarantees historical order accuracy even if catalog data changes later.

---

# 44. Order Address Snapshot

Do not only reference:

```text
customer_addresses
```

because customers may edit their current address.

Every order must preserve:

```text
order_shipping_address
```

with:

```text
full_name

phone

province

city

barangay

postal_code

street_address

landmark
```

---

# 45. Order History

Every important state change must be recorded.

Logical:

```text
order_status_history
```

Fields:

```text
id

order_id

status_domain

old_status

new_status

source

operator_id nullable

comment nullable

created_at
```

Possible `source`:

```text
SYSTEM

ADMIN

CUSTOMER_SERVICE

WAREHOUSE

LOGISTICS_API

PAYMENT_API
```

---

# 46. Order Notes

Internal notes:

```text
order_notes
```

Fields:

```text
id

order_id

user_id

note_type

content

created_at
```

---

# 47. Duplicate Orders

Duplicate detection must not automatically delete Orders.

Store:

```text
order_risk_flags
```

Example:

```text
POSSIBLE_DUPLICATE

CUSTOMER_RECHECK

CUSTOMER_BLOCKED
```

---

# 48. Order Merge

If the business allows merging unshipped orders, preserve history.

Logical:

```text
order_merge_records
```

Fields:

```text
id

primary_order_id

merged_order_id

operator_id

reason

created_at
```

Never delete the merged historical Order.

---

# 49. Attribution Architecture

AID and traffic attribution are critical.

Do not mix:

```text
AID
Post ID
Ad ID
```

---

# 50. Source Types

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

# 51. order_attributions

Each Order should preserve an attribution snapshot.

Suggested fields:

```text
id

order_id

source_type

optimizer_id nullable

aid_snapshot nullable

facebook_page_id nullable

facebook_post_id nullable

facebook_post_tracking_code nullable

campaign_id nullable

adset_id nullable

ad_id nullable

legacy_adid nullable

landing_page_id nullable

utm_source nullable

utm_medium nullable

utm_campaign nullable

utm_content nullable

utm_term nullable

fbclid nullable

attributed_at
```

---

# 52. Attribution Persistence

Traffic attribution must survive normal browsing.

Example:

```text
Facebook Post
↓
Homepage
↓
Collection
↓
Product
↓
Checkout
↓
Order
```

The final Order must still retain:

```text
sourceType = FB_POST

AID

Post ID
```

Do not overwrite attribution as DIRECT merely because the customer visited multiple pages.

---

# 53. AID Snapshot

AID must be copied into the Order attribution snapshot when the Order is created.

Historical attribution must not change when:

* Facebook Page ownership changes
* Optimizer assignment changes
* User names change

---

# 54. Facebook Pages

Logical:

```text
facebook_pages
```

Fields:

```text
id

facebook_page_id

page_name

page_url

default_optimizer_id nullable

status

created_at
```

---

# 55. Facebook Posts

Logical:

```text
facebook_posts
```

Fields:

```text
id

facebook_page_id

facebook_post_id nullable

tracking_code

post_url

product_id nullable

optimizer_id

aid_snapshot

published_at

created_at
```

Constraint:

```text
tracking_code UNIQUE
```

---

# 56. FB Order

FB Order must NOT become an independent second Order system.

FB Order Admin page is a view/query:

```text
Orders
JOIN
Order Attribution
WHERE
source_type = FB_POST
```

---

# 57. FB Post Tracking

Legacy format may be retained for migration:

```text
?aid=xxxx&adid=fb0909
```

New implementation should use a unique post tracking code.

Example:

```text
?aid=OPT001
&source=fb_post
&post=FBP8K2M4
```

---

# 58. Paid Meta Attribution

For paid Meta traffic preserve when available:

```text
campaign_id

adset_id

ad_id

fbclid

UTM fields

AID
```

FB organic post traffic and Meta advertising traffic must remain distinguishable.

---

# 59. Landing Pages

Logical:

```text
landing_pages
```

Fields:

```text
id

name

slug

primary_product_id nullable

status

created_at

updated_at
```

---

# 60. Landing Page Sections

V1 uses structured modules.

Logical:

```text
landing_page_sections
```

Fields:

```text
id

landing_page_id

section_type

content_json

sort_order

enabled

created_at

updated_at
```

Possible `section_type`:

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

Do not build a Webflow-style arbitrary builder in V1.

---

# 61. Shipment / Fulfillment

One Order may contain multiple shipments.

Never assume:

```text
1 Order = 1 Tracking Number
```

Logical relationship:

```text
Order
1:N
Shipment
```

---

# 62. shipments

Suggested fields:

```text
id

order_id

warehouse_id

carrier

tracking_number

status

shipping_cost

shipped_at

signed_at nullable

created_at

updated_at
```

---

# 63. Shipment Items

For correct multi-package fulfillment:

```text
shipment_items
```

Fields:

```text
id

shipment_id

order_item_id

quantity
```

This allows:

```text
Order

Chair ×1
Cabinet ×1

↓

Shipment A
Chair

Shipment B
Cabinet
```

---

# 64. Logistics Events

Signed Orders normal source is confirmed as:

```text
LOGISTICS API
```

Store raw/logical delivery events.

Logical:

```text
logistics_events
```

Fields:

```text
id

shipment_id

carrier

external_event_id nullable

external_status

normalized_status

event_time

received_at

province nullable

city nullable

raw_payload_reference nullable

created_at
```

---

# 65. Logistics Event Status

Normalized examples:

```text
SHIPPED

IN_TRANSIT

OUT_FOR_DELIVERY

SIGNED

FAILED_DELIVERY

RETURNING

RETURNED
```

---

# 66. Logistics Idempotency

Logistics APIs may send the same webhook multiple times.

The system MUST prevent duplicate processing.

Use:

```text
external_event_id
```

or:

```text
payload hash
+
shipment
+
event timestamp
```

as appropriate.

Duplicate webhook delivery must not:

* create duplicate events
* change inventory twice
* count Signed twice

---

# 67. Signed Orders

Signed Orders is not a separate competing order table.

It is a business view based on:

```text
Orders
+
Shipments
+
Logistics Events
```

---

# 68. Signed Date

Use actual carrier-supplied signed time:

```text
signed_at
```

Do not substitute:

```text
API received_at
```

for the true delivery time.

---

# 69. Multiple Shipment Signed Rule

If an Order has multiple required Shipments:

Order becomes:

```text
SIGNED
```

only after all required Shipments are Signed.

Example:

```text
Shipment A = SIGNED

Shipment B = SHIPPING

Order = SHIPPING
```

Only when:

```text
Shipment A = SIGNED

Shipment B = SIGNED
```

then:

```text
Order = SIGNED
```

---

# 70. Manual Signed Override

Normal Signed source:

```text
LOGISTICS_API
```

If exceptional manual correction is allowed:

only SUPER_ADMIN may perform it.

Record:

```text
manual_override

override_reason

operator_id

override_at
```

---

# 71. Signed Rate

This rule is CONFIRMED.

Business formula:

```text
Actual Signed Rate

=

Signed Orders
/
All Backend-Created Production Orders
```

Cancelled and invalid/denied orders remain in the denominator.

---

# 72. Total Orders

Total Orders means all successfully created production Orders within the selected scope.

Including:

```text
NEW

PENDING

QUESTION

CONFIRMED

DENIED

ABNORMAL

SHIPPING

SIGNED

CANCELLED
```

Test/sandbox orders should be explicitly marked so they can be excluded.

Recommended field:

```text
is_test_order
```

---

# 73. Shipping-to-Signed Rate

This is a separate metric:

```text
Shipping-to-Signed Rate

=

Signed Orders
/
Orders Entered Shipping
```

Do not label this:

```text
Signed Rate
```

---

# 74. Revenue

Preserve transaction components.

Order:

```text
subtotal

discount_total

shipping_total

grand_total
```

Analytics can derive:

```text
Product Revenue

Shipping Revenue

Placed Revenue
```

---

# 75. Signed Revenue

Signed Revenue only counts Orders that reached:

```text
SIGNED
```

Preserve separately:

```text
Signed Product Revenue

Signed Shipping Revenue

Signed Order Revenue
```

Exact dashboard default can be decided later.

---

# 76. Cost Architecture

Not every cost naturally belongs directly to one Order.

Therefore do not force:

```text
cost_events.order_id NOT NULL
```

for all costs.

Use flexible cost entries.

---

# 77. cost_entries

Suggested:

```text
id

cost_type

amount

currency

order_id nullable

shipment_id nullable

sku_id nullable

optimizer_id nullable

campaign_id nullable

ad_id nullable

cost_date

source

reference

created_at
```

Possible types:

```text
PRODUCT_COST

SHIPPING_COST

COD_FEE

PAYMENT_FEE

ADS_COST

REFUND_COST

RETURN_COST

LOSS_COST

MANUAL_COST
```

---

# 78. Product Cost Snapshot

Order Items should preserve:

```text
unit_cost_snapshot
```

at transaction time.

Do not calculate old order product costs using today's supplier cost.

---

# 79. Advertising Cost

Ad spend may be imported at:

```text
Ad ID
+
Date
```

rather than order level.

Future Meta Marketing API integration may populate these costs automatically.

V1 may support manual/imported spend.

---

# 80. Profit

Do not store one permanent `profit` value as the only source of truth.

Conceptual:

```text
Contribution Profit

=

Signed Revenue

-

Product Cost

-

Shipping Cost

-

COD / Payment Fees

-

Ad Spend

-

Refund / Return / Loss Costs
```

Exact accounting definition must be documented separately before final Finance implementation.

---

# 81. Shipping Rate Rules

Future shipping rate architecture needs to support:

```text
Province

City

Barangay

Weight

Volumetric Weight

Oversize

Base Fee

Additional Fee

ETA
```

---

# 82. shipping_rate_rules

Possible V1 logical structure:

```text
id

province nullable

city nullable

barangay nullable

min_weight nullable

max_weight nullable

min_volumetric_weight nullable

max_volumetric_weight nullable

oversize_rule nullable

base_fee

additional_fee

eta_min_days

eta_max_days

status
```

If a logistics API provides realtime shipping rates later, this table can act as fallback.

---

# 83. Homepage / CMS

Homepage content must not be hard-coded entirely into frontend components.

Logical:

```text
homepage_sections
```

Suggested:

```text
id

section_key

enabled

title

subtitle

content_json

sort_order

created_at

updated_at
```

Examples:

```text
HERO

SHOP_BY_SPACE

FEATURED_PRODUCTS

SHOP_BY_SOLUTION

HERO_PRODUCT

SMALL_UPGRADES

BRAND_STORY

TRUST
```

Refer to:

```text
docs/HOMEPAGE_SPEC.md
```

---

# 84. Reviews

Use native Commerce Engine / review functionality if available.

Logical requirements:

```text
review

customer

product

rating 1-5

content

status

verified_purchase

created_at
```

Do not use a 10-point rating system for the new storefront.

---

# 85. After Sales

V1 may keep the UI simple, but schema should support future:

```text
RETURN

REFUND

EXCHANGE

TRANSIT_DAMAGE

MISSING_PARTS
```

Suggested logical entity:

```text
after_sales_cases
```

Fields:

```text
id

order_id

order_item_id nullable

case_type

reason

status

resolution

created_by

created_at

resolved_at nullable
```

---

# 86. Audit Log

Critical Admin operations require audit logs.

Logical:

```text
audit_logs
```

Fields:

```text
id

user_id

action

entity_type

entity_id

before_data nullable

after_data nullable

reason nullable

created_at
```

Important actions:

```text
ORDER_CANCEL

ORDER_AID_CHANGE

CUSTOMER_BLOCK

CUSTOMER_UNBLOCK

INVENTORY_ADJUST

PRICE_CHANGE

SHIPPING_RATE_CHANGE

MANUAL_SIGNED_OVERRIDE
```

---

# 87. Reports Are Derived

Do not make these tables the canonical source of truth:

```text
optimizer_daily_report

product_daily_report

province_daily_report
```

They may later exist as:

* materialized views
* cache tables
* analytics warehouse tables

But source data remains:

```text
Orders

Order Items

Attribution

Shipments

Logistics Events

Inventory Movements

Cost Entries
```

---

# 88. Optimizer Performance

Future metrics:

```text
Optimizer

AID

Orders

Confirmed Orders

Shipping Orders

Signed Orders

Signed Rate

Revenue

Signed Revenue

Ad Spend

CPA

Signed CPA

Profit

Profit ROAS
```

Historical calculation must use the Order's AID snapshot.

---

# 89. FB Post Performance

Future metrics:

```text
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
```

---

# 90. Province Performance

Future:

```text
Province

Orders

Confirmed

Shipping

Signed

Signed Rate

Shipping-to-Signed Rate

Average Delivery Days

Revenue

Signed Revenue
```

Use Order shipping-address snapshot for geographic attribution.

Do not rely only on carrier event province text.

---

# 91. Product Performance

Future:

```text
Product

SKU

Orders

Quantity

Signed Orders

Signed Rate

Placed Revenue

Signed Revenue

Product Cost

Ad Spend

Profit
```

---

# 92. Dashboard Data

Dashboard should calculate or query from core data.

Examples:

### Today

```text
Orders

Confirmed

Shipping

Signed

Placed Revenue

Signed Revenue
```

### COD

```text
Confirmation Rate

Signed Rate

Cancel Rate

Denied Rate
```

### Marketing

```text
Ad Spend

CPA

Signed CPA

ROAS

Signed ROAS
```

### Inventory

```text
Low Stock

Out of Stock

Incoming
```

---

# 93. Secrets

Do not store sensitive credentials in normal application database fields where they can be shown in Admin.

Examples:

```text
Airwallex Secret

Logistics API Secret

Meta Token

SMTP Password
```

Use:

```text
Environment Variables
/
Secret Manager
```

Database may store:

```text
provider_enabled

provider_status
```

but not expose secret values.

---

# 94. Time

Database timestamps should preferably be stored in UTC.

Business display timezone:

```text
Asia/Manila
UTC+8
```

Reports must use a consistent Philippines business timezone.

---

# 95. Currency

Storefront:

```text
PHP
```

Internal costs may support:

```text
PHP
CNY
USD
```

Every cost entry must include:

```text
currency
```

Do not silently treat all supplier costs as PHP.

---

# 96. V1 Core Entities

Depending on Commerce Engine native coverage, the logical V1 system requires:

```text
Users / Roles

Optimizers

Customers

Customer Addresses

Customer Risk Events

Products

Variants / SKUs

Categories

Collections

Collection Products

Collection Sections

Suppliers

Warehouses

Inventory

Inventory Reservations

Inventory Movements

Purchase Orders

Orders

Order Items

Order Address Snapshot

Order Status History

Order Notes

Order Risk Flags

Order Attribution

Facebook Pages

Facebook Posts

Landing Pages

Landing Page Sections

Shipments

Shipment Items

Logistics Events

Cost Entries

Audit Logs
```

---

# 97. Recommended Implementation Priority

## Phase 1 — Transaction Core

Complete first:

```text
Commerce Engine setup

Users / permissions

Product

SKU / Variant

Customer

Order

Order Items

Order Address Snapshot

COD Checkout

Order History

Inventory

Reservation

Cancellation Release
```

---

## Phase 2 — COD Operations

```text
Optimizer / AID

Customer classification

AGAIN

RPT

RECHECK

Customer Risk

Confirmor Workflow

Double Check

Order Notes
```

---

## Phase 3 — Fulfillment

```text
Warehouse

Shipment

Shipment Items

Logistics API

Logistics Events

Signed Orders

Signed Rate
```

---

## Phase 4 — Attribution

```text
FB Page

FB Post Tracking

FB Order View

Meta Ad Attribution

Landing Page Attribution
```

---

## Phase 5 — Analytics / Finance

```text
Signed Revenue

Product Performance

Province Performance

Optimizer Performance

Advertising Performance

Cost Entries

Profit
```

---

# 98. Agent Rules

Before implementing this design:

1. Read `README.md`.
2. Read `docs/BUSINESS_RULES.md`.
3. Read `docs/DATABASE_DESIGN.md`.
4. Inspect the selected Commerce Engine native data model.
5. Create a mapping document:

   * Native
   * Extension Required
   * New Entity Required
6. Do not immediately generate all custom tables.

---

# 99. Forbidden Architecture Decisions

Agent MUST NOT:

### 1

Create:

```text
fb_orders
```

as a second independent Order system.

---

### 2

Create:

```text
signed_orders
```

as a second copy of Order records.

Signed Orders is a business view/state derived from Orders + Logistics.

---

### 3

Put only one:

```text
product_id
sku_id
quantity
```

inside Order header.

Use Order Items.

---

### 4

Use only:

```text
stock
```

for inventory.

Inventory needs reservation semantics.

---

### 5

Delete Cancelled / Denied Orders.

They remain historical data and remain part of Signed Rate denominator.

---

### 6

Recalculate historical AID using current Optimizer/Page assignment.

Use snapshots.

---

### 7

Allow duplicate logistics webhooks to count Signed multiple times.

Implement idempotency.

---

### 8

Modify Commerce Engine Core when an extension mechanism exists.

---

### 9

Store current Product price as the only source for historical Orders.

Use Order Item snapshots.

---

### 10

Treat reports as the only business facts.

Reports are derived from raw transactions/events.

---

# 100. Required Acceptance Tests

The final implementation must be testable for at least:

### Order

* Order with one SKU
* Order with multiple SKUs
* Price snapshot remains stable after product price changes

### Inventory

* Order creates reservation
* Cancel releases reservation
* Denied releases reservation
* Shipment consumes reserved inventory
* Duplicate webhook does not double-change inventory

### Customer Risk

* Previous Signed → AGAIN
* Relevant previous active/duplicate order → RPT
* Refused/Denied/Failed history → RECHECK

### Attribution

* FB Post order preserves AID
* Meta Ad order preserves Ad ID
* Navigating through Homepage does not erase source attribution
* Optimizer reassignment does not rewrite historical Orders

### Logistics

* Logistics API event stored once
* Signed timestamp uses carrier event time
* Duplicate webhook ignored
* Multi-shipment Order does not become Signed prematurely

### Signed Rate

Given:

```text
100 total production Orders

60 Signed

10 Cancelled

10 Denied

20 other
```

Expected:

```text
Signed Rate = 60%
```

NOT:

```text
60 / Confirmed
```

### Payment

* COD remains available by default
* Airwallex not configured → hidden from storefront
* Airwallex enabled → available as second payment option
* Payment status remains separate from Order Signed status

---

# 101. Required Agent Output Before Coding

Before database implementation begins, Agent must produce:

```text
docs/COMMERCE_MODEL_MAPPING.md
```

with a table:

| Requirement | Native Commerce Engine Model | Extension Required | New Table Required | Notes |
| ----------- | ---------------------------- | ------------------ | ------------------ | ----- |

At minimum map:

```text
Product

Variant

Customer

Order

Order Item

Inventory

Reservation

Payment

Shipment / Fulfillment

Optimizer / AID

Customer Risk

FB Post

Order Attribution

Landing Page

Logistics Event

Signed Orders

Cost Entries
```

The Agent must NOT begin large-scale schema generation until this mapping is reviewed.

---

# XX. Collection System


## Purpose


Collection represents merchandising and marketing groups.


Collection is NOT the same as Product Category.


Difference:


Category:

Product classification.


Example:


Chair

Desk

Cabinet



Collection:

Customer shopping journey / marketing grouping.


Example:


Chairs & Stools

Storage & Organization

Small-Space Solutions

Best Sellers



A product can belong to multiple Collections.



Example:


Foldable Chair:


Category:

Chair


Collections:


- Chairs & Stools

- Small-Space Solutions

- Best Sellers

- Small Balcony



---


# collections


Logical entity:



collections




Purpose:


Store website navigation collections and marketing landing pages.



Fields:


| Field | Description |
|---|---|
| id | Collection ID |
| name | Display name |
| slug | URL slug |
| type | Collection type |
| description | Collection introduction |
| hero_image | Collection banner |
| status | ACTIVE / DISABLED |
| sort_order | Navigation order |
| seo_title | SEO title |
| seo_description | SEO description |
| created_at | Created time |
| updated_at | Updated time |



---


# Collection Type


Initial values:



NAVIGATION

MARKETING

SCENARIO

SYSTEM




Meaning:



## NAVIGATION


Used by Header Navigation.


Example:



New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers




## MARKETING


Temporary campaigns.


Example:



Holiday Sale

Apartment Upgrade Sale




## SCENARIO


Lifestyle grouping.


Example:



Small Bedroom

Home Office

Small Balcony

Condo Living




## SYSTEM


Automatic collections.


Example:



Best Sellers

Recently Viewed

Recommended




---


# Navigation Collection


Header navigation should map directly to Collections.



Example:



Header Menu

Storage & Organization

    ↓

Collection

storage-organization




Do not hard-code navigation categories in frontend.



---


# collection_products


Relationship:



Collection

N:M

Product




Purpose:


Allow one product to belong to multiple collections.



Fields:


| Field | Description |
|-|-|
| id | ID |
| collection_id | Collection |
| product_id | Product |
| sort_order | Product order |
| is_featured | Featured product |
| created_at | Created time |



Example:



Foldable Chair

collection_products:

Chair Collection

Small Space Collection

Best Seller Collection




---


# Collection Display Rules


Collection page product ordering supports:



Manual:


Admin selects priority.



Automatic:


Based on rules.



Possible rules:



NEWEST

BEST_SELLING

HIGH_RATING

LOW_PRICE

PROMOTION




---


# collection_sections


Purpose:


CMS controlled collection page content.



Collection pages are not only product grids.



They contain:


- Hero

- Lifestyle sections

- Scenario images

- Reviews

- FAQ

- CTA



Fields:


| Field | Description |
|-|-|
| id | Section ID |
| collection_id | Collection |
| section_type | Module type |
| content_json | Section content |
| sort_order | Display order |
| enabled | Active status |
| created_at | Created time |
| updated_at | Updated time |



---


# Collection Section Types


Example:



HERO

INTRODUCTION

PROBLEM

SOLUTION

FEATURED_PRODUCTS

PRODUCT_GRID

SCENARIO

REVIEWS

FAQ

CTA




---


# Collection Relationship Summary



Product Category

1:N

Product

Product

N:M

Collection

Collection

1:N

Collection Sections




---


# Collection Analytics


Collection performance should be calculated from:




Collection

Product Views

Add To Cart

Orders

Revenue




Metrics:



Collection Views

Product Clicks

Add To Cart

Orders

Revenue

Conversion Rate




---


# V1 Core Collections


Required:



New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers




---


# Collection Rules


Agent MUST:


1. Do not create separate tables for every navigation category.


Wrong:


storage_products

chair_products

desk_products



Correct:


collections

+

collection_products



2. Do not duplicate products.



3. Collection pages should be CMS controlled.



4. Product membership changes should not modify historical orders.





# FINAL ARCHITECTURE PRINCIPLE

The database should be built around:

```text
Transaction Facts
+
Event History
+
Attribution Snapshots
+
Inventory Accuracy
```

not around manually maintained report tables.

The target architecture is:

```text
Commerce Engine
        │
        ├ Product / SKU
        ├ Customer
        ├ Order / Order Items
        ├ Payment
        ├ Inventory
        └ Fulfillment
                │
                ▼
Small House Extensions
        │
        ├ Optimizer / AID
        ├ COD Customer Risk
        ├ FB Page / FB Post
        ├ Attribution
        ├ Logistics Events
        ├ Signed Analytics
        ├ Landing Pages
        ├ Cost Entries
        └ Audit Logs
                │
                ▼
Analytics
        │
        ├ Product
        ├ Advertising
        ├ FB Post
        ├ Province
        ├ Optimizer
        └ Profit
```

This architecture should remain extensible without rewriting the core ecommerce transaction system.


END