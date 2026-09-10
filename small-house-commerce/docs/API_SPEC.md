# API_SPEC.md

# Philippines Small House Ecommerce API Specification

Version: V1.1.1


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines the API contract between:


Frontend

↓

API Layer

↓

Backend Services

↓

Database



The purpose:


- Standardize frontend/backend communication
- Separate business logic from frontend
- Ensure data consistency
- Protect critical business operations


This document works together with:


- README.md
- SYSTEM_ARCHITECTURE.md
- BUSINESS_RULES.md
- DATABASE.md
- ORDER_FLOW.md
- ADMIN_SPEC.md
- FRONTEND_SPEC.md



---

# 2. API Design Principles


## 2.1 REST API


The system uses RESTful API design.


HTTP Methods:


GET

Retrieve data


POST

Create resource or execute business action


PUT

Update resource


DELETE

Avoid physical deletion.


Use:

- Cancel
- Archive
- Disable



---

# 2.2 Business Logic Responsibility


API Layer is responsible for:


- Request validation
- Authentication
- Permission checking
- Business rule execution
- Transaction control
- Data consistency


Frontend MUST NOT:


- Calculate customer risk
- Calculate inventory availability
- Calculate profit
- Modify attribution
- Directly change order status
- Execute COD business rules



All critical business operations MUST be processed by backend services.



Example:


Wrong:


Frontend:

```javascript
if(previousDenied){

risk="RECHECK"

}

Correct:

Frontend:

Submit order

Backend:

↓

Check customer history

↓

Apply business rules

↓

Return result

3. Authentication

The system uses:

JWT Authentication

Authentication consists of:

Access Token

Short-term authorization.

Contains:

user_id

role

permission

expiration

Refresh Token

Long-term session renewal.

API:

POST /api/v1/auth/refresh
4. API Response Standard

All APIs return:

{
"success":true,

"data":{},

"message":"",

"error":null

}

Error:

{
"success":false,

"data":null,

"message":"Invalid phone",

"error":"INVALID_PHONE"

}
5. Error Codes

Common error codes:

INVALID_PHONE

CUSTOMER_RISK_RECHECK

DUPLICATE_ORDER

OUT_OF_STOCK

ORDER_LOCKED

PERMISSION_DENIED

INVALID_STATUS_TRANSITION

PRODUCT_NOT_FOUND

SKU_NOT_AVAILABLE

UNAUTHORIZED

6. API Version

All APIs MUST use:

/api/v1/

Examples:

GET /api/v1/products

GET /api/v1/orders

POST /api/v1/orders

7. API Scope

The system contains two API categories.

Storefront APIs

Used by:

Customer frontend.

Examples:

Product
Collection
Cart
Checkout
Review
Admin APIs

Used by:

Backend management system.

Requirements:

Admin APIs require:

Authentication
Role permission check

Examples:

Orders:

Allowed:

ADMIN
CUSTOMER_SERVICE
CONFIRMOR

Inventory:

Allowed:

ADMIN
WAREHOUSE

Analytics:

Allowed:

ADMIN
Limited OPTIMIZER
8. Authentication APIs
POST /api/v1/auth/login

Admin login.

Request:

{
"email":"",

"password":""

}

Response:

{

"access_token":"",

"refresh_token":"",

"user":{

"id":1,

"role":"ADMIN"

}

}
POST /api/v1/auth/refresh

Refresh access token.

9. Product APIs
GET /api/v1/products

Purpose:

Product listing.

Filters:

keyword

category

collection

page

limit

sort


Response:

{

"id":1,

"name":"Foldable Chair",

"images":[],

"price":999,


collections:[

{
"type":"NAVIGATION",
"name":"Chairs & Stools"
},

{
"type":"LIFESTYLE",
"name":"Small Balcony"
},

{
"type":"SYSTEM",
"name":"Best Sellers"
}

]

}
GET /api/v1/products/{id}

Purpose:

Product Detail Page.

Returns:

Product information
Images
SKU
Reviews
Related products
10. SKU APIs
GET /api/v1/products/{id}/sku

Returns product variants.

Example:

[
{

"sku":"CHAIR-BLACK",

"variant":"Black",

"price":999,

"stock_status":"AVAILABLE"

}
]
11. Category API
GET /api/v1/categories

Returns:

Product categories.

Example:

Chair

Table

Cabinet

12. Collection API

Purpose:

Scenario-based shopping.

Examples:

Small Bedroom

Home Office

Storage Solution

Condo Living


API:

GET /api/v1/collections/{slug}


Response:

{

"name":"Small Bedroom",

"banner":"",

"description":"",

"products":[],

"seo":{}

}
13. Homepage CMS API
GET /api/v1/homepage

Returns homepage content.

Controls:

Hero
Sections
Featured Products
Reviews
Promotions

Frontend MUST NOT hard-code homepage content.

14. Landing Page API
GET /api/v1/landing-pages/{slug}

Purpose:

Campaign conversion pages.

Used for:

Facebook Ads
Promotion Campaigns
Product Campaigns

Returns:

Hero

Problem

Solution

Product

Review

Offer

FAQ

CTA

15. Promotion API
GET /api/v1/promotions/active

Returns active promotions.

Example:

{

"name":"Holiday Sale",

"type":"DISCOUNT",

"content":{}

}
16. Review API
GET /api/v1/products/{id}/reviews

Returns:

Rating
Text
Images
Customer information

Used by PDP.

17. Cart APIs
POST /api/v1/cart/items

Add item.

Request:

{

"sku_id":1,

"quantity":1

}
PUT /api/v1/cart/items/{id}

Update quantity.

DELETE /api/v1/cart/items/{id}

Remove item.

GET /api/v1/cart/{id}/summary

Returns:

subtotal

discount

shipping

total

18. Checkout / Order Creation API
POST /api/v1/orders

Create COD order.

Request:

{

"customer":{

"name":"",

"phone":"",

"province":"",

"city":"",

"barangay":"",

"address":""

},


"items":[],



"attribution":{

"aid":"",

"source_type":"FB_POST"

}

}

Backend Process:

Validate customer information

Match existing customer

Check customer history

Apply risk rules

Create order

Create attribution snapshot

Return order result

Response:

{

"order_number":"PH100001",

"order_status":"NEW",

"confirmation_status":"PENDING_CONFIRM",

"risk_type":"RECHECK",

"requires_review":true

}
19. Customer APIs
GET /api/v1/customers/{phone}

Returns:

Customer profile
Order history
Risk history
20. Risk APIs
GET /api/v1/risk/orders

Double Check Workspace.

Filters:

RECHECK

RPT

AGAIN

GET /api/v1/customers/{id}/history

Returns:

Previous orders
Signed orders
Denied orders
Risk events
21. Order APIs
GET /api/v1/orders

Admin order list.

Filters:

status

risk_type

optimizer

date

province

city

product

GET /api/v1/orders/{id}

Returns:

Customer
Items
Attribution
Risk
Shipment
Status Logs
22. Order Business Actions

Frontend MUST NOT directly modify order status.

22.1 Confirm Order

API:

POST /api/v1/orders/{id}/confirm

Purpose:

Confirm COD order after customer verification.

Backend Transaction Process:

Validate order status

Check:

Order exists
Order is not cancelled
Order is not shipped

Check inventory availability

Validate:

SKU exists
Available quantity >= ordered quantity

Reserve SKU inventory

Update:

Reserved Quantity

Update confirmation status

From:

PENDING_CONFIRM

To:

CONFIRMED

Update order status

From:

NEW

To:

CONFIRMED

Create order status log

Create inventory log

If any step fails:

Rollback transaction.

22.2 Cancel Order

API:

POST /api/v1/orders/{id}/cancel

Process:

Validate order status

Allowed:

NEW

CONFIRMED

PROCESSING

Not allowed:

SHIPPING

SIGNED

Update order:

CANCELLED

Release reservation only when:

Reservation exists

AND

Order has not shipped

Create:

Order Status Log
Inventory Log
22.3 Ship Order

API:

POST /api/v1/orders/{id}/ship

Purpose:

Warehouse shipping action.

This endpoint internally creates:

Shipment Resource

Equivalent internal action:

POST /api/v1/shipments


Process:

Validate order status

Create shipment

Deduct inventory

Update order status:

SHIPPING

Create logs

22.4 Merge Orders

API:

POST /api/v1/orders/merge


Purpose:

Merge duplicate COD orders.

Used for:

RPT
Duplicate review
23. Inventory APIs
GET /api/v1/inventory

Returns:

on_hand

reserved

available

POST /api/v1/inventory/reserve

Reserve SKU inventory.

POST /api/v1/inventory/release

Release reserved inventory.

POST /api/v1/inventory/deduct

Deduct physical inventory after shipment.

POST /api/v1/inventory/adjust

Manual inventory adjustment.

24. Shipment APIs
POST /api/v1/shipments

Create shipment resource.

Request:

{

"order_id":1001,

"tracking_number":"",

"carrier":""

}
25. Logistics API
POST /api/v1/logistics/webhook

Receive logistics events.

Request:

{

"carrier":"J&T",

"tracking":"",

"event":"SIGNED",

"time":"",

"raw_payload":{}

}

Backend updates:

Shipment
Order
Signed Analytics
26. Attribution API
POST /api/v1/attribution

Save traffic attribution.

Fields:

utm_source

utm_campaign

fbclid

aid

campaign_id

ad_id

post_id

landing_page_id

Attribution Rules

Before order creation:

Traffic attribution can update.

After order creation:

Attribution becomes immutable snapshot.

Cannot modify:

AID

Campaign ID

Ad ID

Post ID

Landing Page ID

Optimizer ID


Any correction requires:

Audit record.

27. FB Order View API

Important:

FB Order is NOT an independent table.

It is a business view based on:

Orders

+

Attribution

+

Shipment


API:

GET /api/v1/fb-orders


Returns:

Page

Post

Orders

Signed Orders

Revenue

Profit

Signed Rate

28. Signed Orders View API

Important:

Signed Orders is NOT an independent order table.

Source:

Orders

+

Shipment

+

Logistics Events


API:

GET /api/v1/signed-orders


Filters:

date

province

city

product

sku

optimizer


Returns:

Signed Orders

Revenue

Profit

Signed Rate Calculation

Formula:

Signed Rate

=

Signed Orders

/

All Created Orders


Denominator includes:

Cancelled Orders
Invalid Orders
Denied Orders

Do NOT calculate:

Signed Orders

/

Confirmed Orders


unless explicitly requested.

29. Analytics API
Dashboard
GET /api/v1/dashboard


Returns:

Orders

Revenue

Confirmed

Shipping

Signed

Profit

Profit
GET /api/v1/profit


Filters:

date

product

campaign

optimizer

30. Permission Rules
ADMIN

Full access.

OPTIMIZER

Allowed:

Own orders
Own attribution
Own performance

Forbidden:

Other optimizer data
Total profit
CONFIRMOR

Allowed:

Confirm orders
View customer history
WAREHOUSE

Allowed:

View shipping orders
Update shipment
31. Development Priority
Phase 1

Core:

Authentication

Products

SKU

Customers

Orders

Checkout

Inventory

Phase 2

Operations:

Risk

Shipment

Attribution

Landing Pages

Signed Orders

Phase 3

Analytics:

Profit

Dashboard

Reports

Performance

Agent Instructions

Before implementing API:

Read:

README.md

SYSTEM_ARCHITECTURE.md

BUSINESS_RULES.md

DATABASE.md

ORDER_FLOW.md

ADMIN_SPEC.md

FRONTEND_SPEC.md

API_SPEC.md


# Collection API


## GET /api/v1/collections


Purpose:

Header navigation and collection discovery.



Response:


[
{
"id":1,
"name":"Storage & Organization",
"slug":"storage-organization",
"image":"",
"type":"NAVIGATION"
}
]



---


## GET /api/v1/collections/{slug}



Purpose:


Collection landing page.



Returns:


- Collection information
- Hero
- Sections
- Products
- SEO



Response:


{
"name":"",
"description":"",
"hero":"",
"sections":[],
"products":[]
}





Rules:

API is not CRUD only.
Business rules belong to backend services.
Frontend cannot execute business decisions.
Do not create duplicate order tables.
FB Order and Signed Orders are analytical views.
Preserve historical data.
All inventory and order operations requiring consistency must use transactions.

END