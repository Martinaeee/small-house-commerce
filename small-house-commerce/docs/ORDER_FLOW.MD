# ORDER_FLOW.md

# Philippines Small House Ecommerce Order Flow Specification

Version: V1.1


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines the complete ecommerce order lifecycle.


It describes:

- Customer journey
- Traffic attribution
- Checkout process
- Order creation
- Customer risk checking
- COD confirmation
- Inventory reservation
- Shipment process
- Signed order generation
- Profit calculation
- Order operation rules


All order-related development MUST follow this document.


---

# 2. Core Order Principle


The order system follows:



Traffic

↓

Order

↓

Multiple Business Processes



An order is the central business entity.


An order connects:


- Customer
- Product
- Attribution
- Risk System
- Confirmation
- Inventory
- Shipment
- Profit
- Analytics


---

# 3. Complete Order Lifecycle


Main flow:



Traffic Source

↓

Website Visit

↓

Checkout

↓

Order Creation

↓

Customer Matching

↓

Risk Evaluation

↓

COD Confirmation

↓

Inventory Reservation

↓

Warehouse Processing

↓

Shipment

↓

Logistics Result

↓

Signed / Failed

↓

Profit Calculation



---

# 4. Traffic Entry Flow


## 4.1 Facebook Advertisement Traffic


Flow:



Facebook Advertisement

↓

Landing Page

↓

Product Detail Page

↓

Checkout

↓

Order



System captures:


- fbclid
- utm_source
- utm_medium
- utm_campaign
- campaign_id
- adset_id
- ad_id
- aid
- landing_page_id



---

## 4.2 Facebook Organic Post Traffic


Flow:



Facebook Page Post

↓

Homepage

↓

Collection

↓

Product Page

↓

Checkout

↓

Order



System captures:


- facebook_page_id
- facebook_post_id
- post_url
- post_date
- aid


Important:


FB Organic Order is NOT the same as Meta Advertisement Order.



---

# 5. Checkout Flow


Customer submits COD order.


Required information:



Full Name

Phone Number

Province

City

Barangay

Full Address

Landmark

Order Note

Product

Quantity




---

# 6. Order Creation Flow


When customer clicks:



Place Order



System performs:


---

## Step 1

Customer Matching


Search:



phone_normalized



If exists:



Existing Customer

↓

Attach Order



If not:



Create Customer

↓

Create Order



---

## Step 2

Create Order


Initial status:



Order Status:

NEW

Confirmation Status:

PENDING_CONFIRM



---

## Step 3

Save Attribution


Order attribution must be stored as snapshot.


Fields:



source_type

aid

campaign_id

adset_id

ad_id

facebook_page_id

facebook_post_id

landing_page_id

optimizer_id



Historical attribution cannot be modified.


---

# 7. Attribution Priority Rule


The system uses:



Last Touch Attribution



Meaning:


The latest valid traffic source before order creation receives attribution.


Example:


Customer journey:



Facebook Ad

↓

Website Visit

↓

Facebook Post

↓

Order



Final attribution:



Facebook Post



---

# 8. Customer Risk Checking


After order creation:


System evaluates:



Customer Phone

↓

Customer History

↓

Risk Rules

↓

Risk Level




Priority:



RECHECK

↓

RPT

↓

AGAIN

↓

NORMAL




---

# 9. Risk Classification


## 9.1 RECHECK


Condition:


Customer has previous:


- Denied order
- Refused delivery
- Failed delivery


System:



Risk Level:

RECHECK

Confirmation:

NEEDS_REVIEW



Requires customer service review.



---

## 9.2 RPT


Condition:


Case 1:


Customer has previous:



CONFIRMED

or

SHIPPING



and creates another order.



OR:


Same SKU previously:



DENIED

or

CANCELLED



System:



Risk:

RPT

Confirmation:

NEEDS_REVIEW



---

## 9.3 AGAIN


Condition:


Customer has:



Previous SIGNED order

AND

No denied history



System:



Risk:

AGAIN



Can enter faster confirmation process.



---

# 10. Order Lock System


Purpose:


Prevent multiple operators processing the same order.


When operator opens an order:


System creates lock:



locked_by

locked_at



Flow:



Operator opens order

↓

Lock Order

↓

Process

↓

Unlock



Rules:


- Locked orders cannot be modified by other operators.
- Admin can force unlock.
- Lock timeout must be supported.



---

# 11. Double Check Workspace


Double Check is an operation workspace.


It does NOT create another order.



Displayed:


## Customer



Name

Phone

Address History

Previous Orders

Risk Level



## Order



Product

SKU

Amount

Source

Optimizer



## Risk



Risk Type

Reason

Related Orders



Actions:



Confirm Order

Cancel Order

Merge Orders

Add Note

View Customer History




---

# 12. COD Confirmation Flow


Process:



NEW

↓

PENDING_CONFIRM

↓

CALLING

↓

CONFIRMED

OR

FAILED



---

## Successful Confirmation


Update:



confirmation_status:

CONFIRMED

order_status:

CONFIRMED



---

## Failed Confirmation


Update:



confirmation_status:

FAILED

order_status:

CANCELLED




---

# 13. COD Confirmation SLA


Purpose:


Avoid delayed customer processing.


Order confirmation tracking:


Fields:



confirmation_due_at

confirmed_at

confirmor_id



Example:



NEW

↓

24 hours no action

↓

OVERDUE



Overdue orders should be highlighted in Admin.



---

# 14. Inventory Flow


Inventory follows:



Reserve First

Deduct Later




---

# 14.1 Order Created


No inventory change.


Example:



On Hand:

100

Reserved:

0

Available:

100




---

# 14.2 Order Confirmed


Reserve inventory.


Example:


Before:



On Hand:

100

Reserved:

0



After:



On Hand:

100

Reserved:

1

Available:

99




Formula:



Available = On Hand - Reserved




---

# 14.3 Order Cancelled


Release reservation.


Example:



Reserved:

1 → 0




---

# 14.4 Shipping


Actual inventory deduction.


Example:


Before:



On Hand:

100

Reserved:

1



After:



On Hand:

99

Reserved:

0




---

# 15. Order Merge Rule


Purpose:


Handle duplicate COD orders.



Allowed:


Conditions:



Same Phone Number

Same Customer

Status:

NEW

or

PENDING_CONFIRM



Action:



Keep oldest order

Merge items

Cancel duplicate order

Create audit log




Not allowed:



SHIPPING

SIGNED



orders cannot be merged.



---

# 16. Shipment Flow


When warehouse ships:


Order:



PROCESSING

↓

SHIPPING




Create shipment:



tracking_number

carrier

shipment_status




---

# 17. Logistics Flow


Shipment statuses:



CREATED

↓

SHIPPED

↓

IN_TRANSIT

↓

SIGNED

OR

FAILED




Important:


Shipment status and Order status are different.


Example:



Shipment FAILED

↓

Business Evaluation

↓

Order DENIED



---

# 18. Signed Order Flow


When logistics confirms delivery:


Update:



Shipment:

SIGNED

Order:

SIGNED




Signed analytics generated from:



Order

Shipment




Data:



Order ID

Product

SKU

Revenue

Province

City

Signed Date

Source

AID

Optimizer




---

# 19. Failed Delivery Flow


Possible reasons:



Customer unavailable

Wrong address

Customer refused




Shipment:



FAILED



Then business decision:



Order:

DENIED

or

AFTER_SALES



Customer risk profile updates.



---

# 20. Order Notes System


Customer service notes must be stored separately.


Entity:



order_notes



Fields:



id

order_id

user_id

content

created_at



Purpose:


Store:


- Call records
- Customer requests
- Risk explanation



---

# 21. Profit Calculation Flow


Profit calculation:



Revenue

Product Cost

Shipping Cost

COD Fee

Payment Fee

Advertising Cost

Return Loss

=

Profit




---

# 22. Analytics Flow


System generates:



## Sales Analytics


Based on:


- Orders
- Revenue
- Products



## COD Analytics


Based on:


- Confirmation Rate
- Signed Rate
- Denied Rate



## Marketing Analytics


Based on:


- Campaign
- Ad
- Facebook Page
- Facebook Post
- Landing Page



## Geographic Analytics


Based on:


- Province
- City



---

# 23. Order Status Transition Rules


Valid:



NEW

↓

CONFIRMED

↓

PROCESSING

↓

SHIPPING

↓

SIGNED



Exception:



NEW

↓

CANCELLED

CONFIRMED

↓

DENIED

SHIPPING

↓

FAILED DELIVERY



Invalid transitions must be blocked.



---

# 24. Historical Snapshot Rules


When order is created:


Save:



Product Name Snapshot

SKU Snapshot

Price Snapshot

Cost Snapshot



Future product changes MUST NOT affect historical orders.



---

# 25. Audit Requirements


Record:


- Status changes
- Confirmation actions
- Risk changes
- Inventory changes
- Shipment updates
- Order merge actions


Required:



Operator

Time

Before

After

Reason




---

# 26. Future Extensions


Reserved:


- SMS confirmation
- Customer loyalty
- Subscription
- Affiliate tracking
- Multi warehouse
- Advanced CRM
- AI risk prediction



---

# Agent Development Instructions


Before implementing order system:


Read:



README.md

BUSINESS_RULES.md

DATABASE.md

ADMIN_SPEC.md

API_SPEC.md

FRONTEND_SPEC.md

ORDER_FLOW.md



Development priority:


1. Order Creation

2. Customer Matching

3. Attribution

4. Risk Classification

5. COD Confirmation

6. Inventory Reservation

7. Shipment

8. Signed Analytics

9. Profit Calculation



END