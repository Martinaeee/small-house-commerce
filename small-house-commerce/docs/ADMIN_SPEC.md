# ADMIN_SPEC.md

# Philippines Small House COD Ecommerce Platform

## Admin System Specification

Version: V1.0

Status: Architecture Baseline

---

# 1. Purpose

This document defines the Admin System requirements for the Philippines Small House COD Ecommerce Platform.

The Admin System is not only a product management backend.

It is an operational control center designed for:

- COD order operations
- Customer confirmation
- Customer risk management
- Inventory control
- Facebook attribution
- Optimizer performance tracking
- Logistics tracking
- Signed order analysis
- Profit analysis

The Admin System must support daily ecommerce operation workflows.

---

# 2. Admin Design Principle

The Admin System follows:


Business Action
↓
Admin Page
↓
Data Source
↓
Operation
↓
Business State Change
↓
Audit Record


Example:

Customer confirmation:


Confirmor opens order

↓

View:

Order

Customer History

Risk Events

Attribution

↓

Action:

Confirm

Cancel

Add Note

↓

Update:

Order Status

Confirmation Status

Audit Log


---

# 3. Admin Roles

The system must support role-based access control.

Roles:


SUPER_ADMIN

ADMIN

OPTIMIZER

CONFIRMOR

WAREHOUSE

FINANCE


---

# 4. Role Permission Matrix

## SUPER_ADMIN

Full access:

- All orders
- All products
- All inventory
- All reports
- User management
- System settings

---

## ADMIN

Access:

- Product management
- Order management
- Inventory
- Customer management
- Reports

Cannot:

- Modify system security configuration

---

## OPTIMIZER

Purpose:

Marketing performance management.

Can view:

- Own orders
- Own AID attribution
- Own Facebook Posts
- Own performance reports

Cannot view:

- Other optimizer data
- Total company profit

---

## CONFIRMOR

Purpose:

COD confirmation.

Can:

- View pending orders
- View customer history
- Confirm orders
- Cancel risky orders
- Add notes

Cannot:

- Modify product
- Modify inventory manually
- View profit

---

## WAREHOUSE

Purpose:

Fulfillment.

Can:

- View shipping orders
- Update shipment status
- View inventory

Cannot:

- View customer profit data
- Change attribution

---

## FINANCE

Purpose:

Financial analysis.

Can view:

- Revenue
- Cost
- Profit
- Signed Revenue

Cannot:

- Modify operational data

---

# 5. Admin Navigation Structure



ADMIN

Dashboard

Sales

├── Orders

├── Customer Risk Center

├── Customer History

├── Double Check Orders

├── Signed Orders

└── Abnormal Orders

Marketing

├── Optimizers

├── Facebook Pages

├── Facebook Posts

├── Ads Attribution

└── Landing Pages

Catalog

├── Products

├── Categories

├── Collections

└── SKU

Inventory

├── Stock

├── Reservations

├── Purchase Orders

└── Inventory Movement

Reports

├── Revenue

├── Profit

├── Signed Rate

├── Province Analysis

├── Product Performance

└── Optimizer Performance

System

├── Users

├── Roles

├── Permissions

└── Settings


---

# 6. Dashboard Specification


## Purpose

Dashboard answers:

"How is the business performing today?"


---

## 6.1 Sales Overview


Display:


Orders

Confirmed Orders

Shipping Orders

Signed Orders

Revenue

Signed Revenue



Filters:


Today

Yesterday

7 Days

30 Days

Custom Date



---

## 6.2 COD Metrics


Display:



Confirmation Rate

Signed Rate

Cancel Rate

Denied Rate



Important:

Signed Rate calculation follows BUSINESS_RULES.md.


Formula:


Signed Orders
/
All Backend Created Production Orders



---

## 6.3 Marketing Overview


Display:


Ad Spend

CPA

Signed CPA

ROAS

Profit ROAS



---

## 6.4 Inventory Alert


Display:



Low Stock SKU

Out Of Stock SKU

Incoming Stock



---

# 7. Orders Management


## Page:


Sales

→ Orders



Purpose:

Main order operation center.


---

# 7.1 Order List


Required fields:



Order Number

Created Time

Customer Name

Phone

Product

SKU

Quantity

Amount

Customer Type

Risk Level

AID

Optimizer

Source

Province

Order Status

Payment Status

Shipment Status



---

# 7.2 Order Filters


Must support:



Date

Order Status

Confirmation Status

Payment Status

Product

SKU

Optimizer

AID

Province

City

Customer Risk

Traffic Source



---

# 7.3 Order Actions


Admin:



View Detail

Confirm

Cancel

Assign Optimizer

Add Note

Create Shipment

Print Shipping Information



---

# 8. Order Detail Specification


Order detail page must include:


## Order Information



Order Number

Created Time

Status

Payment

Amount



---

## Customer Information



Name

Phone

Address

Risk Level

Customer Type

Historical Orders



---

## Product Information



Product

SKU

Variant

Quantity

Selling Price

Cost Snapshot



---

## Attribution Information


Display:



Source Type

AID

Optimizer

Facebook Page

Facebook Post

Campaign ID

Adset ID

Ad ID

Landing Page



---

## Timeline


Display:



Order Created

Confirmation

Shipment

Signed

Cancelled

Status Changes



---

# 9. Customer Risk Center


Purpose:

COD customer risk control.


---

## Display:



Recheck Orders

RPT Orders

Again Orders

Duplicate Risk Orders

High Risk Customers



---

# 9.1 Customer Risk Card


Display:



Customer Phone

Total Orders

Signed Count

Cancelled Count

Denied Count

Failed Delivery Count

Risk Level

Last Order Date



---

# 9.2 Actions


Allow:



Approve

Block

Add Note

View History



---

# 10. Customer History


Purpose:

Help Confirmor judge COD orders.


---

Display:


## Customer Profile



Name

Phone

Address

Risk Level



---

## Order Timeline


Example:



Order #001

Product:

Chair

Status:

SIGNED

Order #002

Product:

Cabinet

Status:

DENIED



---

## Risk Events


Display:



Denied History

Failed Delivery

Refused Delivery

Manual Risk Note



---

# 11. Double Check Orders


Purpose:

COD manual verification center.


Contains:



RECHECK

RPT

AGAIN

Duplicate Risk



---

Workflow:



Open Order

↓

Check Customer History

↓

Review Risk

↓

Confirm

OR

Cancel



---

# 12. Confirmation Workflow


Order flow:



NEW

↓

PENDING_CONFIRM

↓

CONFIRMED

↓

SHIPPING

↓

SIGNED



Exception:



CANCELLED

DENIED

FAILED DELIVERY



---

# Confirmor Actions:



Confirm Order

Cancel Order

Add Note

Contact Result

Mark Follow-up



---

# 13. Inventory Management


## Stock Page


Display:



SKU

Product

Warehouse

On Hand

Reserved

Available

Incoming



---

# Inventory Actions


Allow:



Receive Stock

Adjust Stock

View Movement History



---

# 14. Inventory Movement


Every stock change requires record.


Example:



Time:

2026-09-09

SKU:

CHAIR001

Action:

RESERVED

Quantity:

-1

Reference:

Order #12345

Operator:

Admin



---

# 15. Marketing Module


## 15.1 Optimizer Management


Display:



Optimizer Name

AID

Orders

Signed Orders

Signed Rate

Revenue

Profit



---

# 15.2 Facebook Page


Display:



Page Name

Page ID

Assigned Optimizer

Status



---

# 15.3 Facebook Post


Display:



Page

Post ID

Post URL

Product

AID

Optimizer

Post Date

Orders

Signed Orders

Signed Rate



---

# 15.4 Advertisement Attribution


Display:



Campaign ID

Adset ID

Ad ID

Optimizer

Orders

Revenue

Profit



---

# 16. FB Order Specification


Important:

FB Order is NOT a separate order system.


Definition:



FB Order

=

Order

Attribution Record

WHERE

source_type = FB_POST



The Admin should provide a filtered view:



Marketing

↓

Facebook Posts

↓

Orders Generated



---

# 17. Landing Page Management


Purpose:

Manage campaign landing pages.


---

Functions:



Create Page

Edit Page

Assign Product

Publish

Disable



---

# Landing Page Sections:



Hero

Problem

Solution

Product

Benefits

Demo

Reviews

FAQ

CTA



---

# 18. Reports


## Revenue Report


Display:



Orders

Revenue

Signed Revenue

Average Order Value



---

## Product Report


Display:



Product

Orders

Quantity

Signed Orders

Revenue

Cost

Profit



---

## Province Report


Display:



Province

Orders

Signed Orders

Signed Rate

Revenue



---

## Optimizer Report


Display:



Optimizer

AID

Orders

Signed Orders

Signed Rate

Revenue

Profit



---

# 19. System Settings


## Payment Settings


Manage:



COD Enabled

Airwallex Enabled



Rule:


If Airwallex is not configured:

Frontend must only show COD.


---

## Logistics Settings


Manage:



Carrier

API Status

Webhook Status



---

## User Management


Manage:



Create User

Assign Role

Disable User



---

# 20. Audit Log


All important operations must create audit records.


Examples:



Cancel Order

Change AID

Adjust Inventory

Change Price

Block Customer

Manual Signed Override



Display:



User

Action

Target

Before

After

Time



---

# 21. Table Component Requirements


All admin data tables should support:



Search

Filter

Sort

Pagination

Export CSV



---

# 22. UI Requirements


Admin:

Desktop First.


Reason:

Admin users mainly operate from computer.


---

Status display:


Green:


SIGNED

CONFIRMED

PAID



Yellow:


PENDING

RECHECK



Red:



DENIED

CANCELLED

FAILED



---

# 23. API Requirements


Admin APIs:



/api/v1/admin/orders

/api/v1/admin/customers

/api/v1/admin/inventory

/api/v1/admin/products

/api/v1/admin/reports



Every API must:

- Verify authentication
- Verify permission
- Validate input
- Create audit log when necessary


---

# 24. Development Priority


## Phase 1


Must complete:



Authentication

Roles

Products

SKU

Orders

Order Detail

Customer History

Inventory



Goal:


Admin can operate basic ecommerce.


---

## Phase 2


Complete:



COD Confirmation

Customer Risk

Double Check

FB Attribution

Landing Pages



Goal:


Admin can operate Philippines COD workflow.


---

## Phase 3


Complete:



Reports

Profit

Optimizer Dashboard

Province Analysis

Signed Analytics



Goal:


Admin becomes business intelligence center.


---

# 25. Acceptance Criteria


System must answer:



How many orders today?

Which product generates revenue?

Which product generates profit?

Which FB post generated signed orders?

Which optimizer generated profit?

Which province has higher signed rate?

Which customers are risky?

How much inventory remains?



---

# 26. Agent Development Rules


Before implementing Admin:


Read:



README.md

SYSTEM_ARCHITECTURE.md

BUSINESS_RULES.md

DATABASE_DESIGN.md

ORDER_FLOW.md



Do NOT:


- Create duplicate order systems
- Create duplicate inventory systems
- Put business logic only in frontend
- Allow unauthorized data access
- Modify database without migration
- Ignore audit requirements


---

# END