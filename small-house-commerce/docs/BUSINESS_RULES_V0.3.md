# BUSINESS_RULES.md

# Philippines Small House Ecommerce

## Business Rules --- V0.3

This document is the business source of truth for the Philippines COD
ecommerce project.

All developers and AI agents MUST read this file before modifying:

-   Orders
-   Customers
-   Payments
-   Inventory
-   Logistics
-   Attribution
-   Facebook Post tracking
-   Customer Risk
-   Analytics

If implementation conflicts with this document: - STOP - Report the
conflict - Do not silently invent business rules

------------------------------------------------------------------------

# 1. System Principles

## BR-001 Unified Order System

All order scenarios must use one unified Order model.

Do NOT create separate databases:

-   FB Order
-   Ad Order
-   Signed Orders
-   COD Order

These are business views/workflows only.

Example:

Order - Customer - Attribution - Payment - Shipment - Order History -
Risk Flags

Admin may provide:

-   New Orders
-   FB Order
-   Customer Order
-   Double Check Order
-   Signed Orders
-   Cancel Orders

but all reference the same Order data.

------------------------------------------------------------------------

# 2. Order Lifecycle

## BR-010 Order Status

Order status represents the business progress.

Recommended states:

NEW

PENDING_CONFIRMATION

CONFIRMED

PROCESSING

SHIPPING

SIGNED

CANCELLED

DENIED

AFTER_SALES

ABNORMAL

Payment status and Order status are independent.

Example:

Order Status: SIGNED

Payment Status: SETTLEMENT_PENDING

------------------------------------------------------------------------

# 3. Inventory Rules

## BR-020 Inventory deduction timing

Confirmed business rule:

Inventory is deducted when shipment is created.

Lifecycle:

Order Created: - No inventory deduction

Order Confirmed: - Optional reservation

Order Shipped: - Deduct inventory

Inventory concepts:

-   On Hand
-   Reserved
-   Available

Cancelled orders must release reservation.

All inventory movements must be auditable.

------------------------------------------------------------------------

# 4. Customer Identity Rules

## BR-030 Phone is the primary identity

Customer matching priority:

1.  Normalized Philippine phone number
2.  Email
3.  Name/address as supporting information

Phone is used for:

-   Customer history
-   Duplicate detection
-   COD risk detection
-   Customer service lookup

------------------------------------------------------------------------

# 5. Customer Risk Rules

Risk labels:

## AGAIN

Definition:

Customer has previous order(s) that:

-   Were successfully signed
-   Have no refusal/denied history

New order receives:

AGAIN

## RPT (Repeat Problem Transaction)

Definition:

Customer creates another order while:

-   Previous order is not completed
-   Previous order is shipping/pending

OR:

Customer has previous denied/refused order with the same product model.

New order receives:

RPT

## RECHECK

Definition:

Customer has historical refusal/denied orders.

Requires manual confirmation.

Priority:

RECHECK \> RPT \> AGAIN \> NORMAL

------------------------------------------------------------------------

# 6. Double Check Order

Double Check Order is an independent admin workspace.

It is NOT a separate order table.

Purpose:

Review risky customers and orders.

Display:

-   Current order
-   Customer history
-   Previous signed orders
-   Previous denied orders
-   Product history
-   Phone history

Actions:

-   Confirm
-   Merge
-   Cancel
-   Add note

------------------------------------------------------------------------

# 7. Customer Order Workspace

Customer Order is an order management view.

Requirements:

-   Filter by optimizer
-   Filter by customer
-   View all customer orders

If customer has multiple orders:

Support:

-   Merge review
-   Cancel duplicate order
-   Keep multiple orders

------------------------------------------------------------------------

# 8. Facebook Order Rules

## BR-040 Definition

FB Order means:

An order generated from an organic Facebook public page post.

It is NOT a Meta paid advertisement order.

Must distinguish:

FB_POST

META_AD

FB Order analytics must preserve:

-   Facebook Page
-   Post ID
-   Post URL
-   Post Date
-   Product
-   AID
-   Optimizer
-   Order
-   Signed Order
-   Province
-   City

Goal:

Answer:

-   Which post generated orders?
-   Which page performs best?
-   Which post generated signed revenue?

------------------------------------------------------------------------

# 9. Attribution Rules

At order creation snapshot:

-   AID
-   Optimizer
-   Source Type
-   Facebook Post ID
-   Ad ID
-   Landing Page ID

Historical orders must not change when attribution ownership changes.

------------------------------------------------------------------------

# 10. Signed Orders

The business term MUST remain:

Signed Orders

Do not rename to Delivered Orders.

Signed Orders source:

LOGISTICS API

Required fields:

-   Order ID
-   Product
-   SKU
-   Customer
-   Province
-   City
-   Tracking Number
-   Shipping Date
-   Signed Date
-   Signed Source

Analysis dimensions:

-   Date
-   Product
-   SKU
-   Province
-   City
-   Optimizer
-   AID
-   Facebook Post
-   Ad ID

------------------------------------------------------------------------

# 11. Signed Rate

Business definition:

Signed Rate = Signed Orders / All Created Orders

Denominator includes:

-   Cancelled orders
-   Invalid orders
-   Denied orders

Do not use:

Signed / Shipped

unless report name explicitly says Shipping-to-Signed Rate.

Support filtering by:

-   Order creation date
-   Signed date
-   Product
-   Province
-   City

------------------------------------------------------------------------

# 12. Landing Page Rules

Landing Page is required from V1.

One product can have multiple landing pages.

Examples:

-   Product page
-   UGC landing page
-   Promotion landing page

V1 builder supports:

-   Hero
-   Problem
-   Solution
-   Product Demo
-   Reviews
-   Offer
-   FAQ
-   CTA

Need backend editing capability.

------------------------------------------------------------------------

# 13. Profit Calculation

Profit calculation is required.

Formula:

Revenue

-   Product Cost
-   Shipping Cost
-   COD Fee
-   Payment Fee
-   Advertising Cost
-   Return Loss

=

Profit

Support:

-   Expected Profit
-   Realized Profit

------------------------------------------------------------------------

# 14. Province and City Analytics

Address must separate:

-   Province
-   City/Municipality
-   Barangay

Analytics:

-   Signed Rate by Province
-   Signed Rate by City
-   Revenue by Province
-   Profit by Province

------------------------------------------------------------------------

# 15. Product SKU

Purchase SKU is required from launch.

SKU is the primary product analytics dimension.

Track:

-   Orders
-   Signed Orders
-   Revenue
-   Profit
-   Inventory

------------------------------------------------------------------------

# 16. Audit Rules

All important changes require logs.

Examples:

-   Status change
-   Attribution change
-   Inventory adjustment
-   Manual Signed correction

Record:

-   Operator
-   Time
-   Before value
-   After value
-   Reason

------------------------------------------------------------------------

# 17. Data Rules

Orders must never be deleted.

Allowed:

-   Cancel
-   Void
-   Archive

Historical data must remain available for analytics.

------------------------------------------------------------------------

# 18. V1 Priority

P0:

-   Product
-   SKU
-   Storefront
-   Checkout
-   COD
-   Order System
-   Attribution
-   FB Order
-   Inventory
-   Shipment
-   Signed Orders
-   Signed Rate
-   Customer Risk
-   Landing Page Editing
-   Profit Calculation

------------------------------------------------------------------------

# 19. TBD Items

The following require future confirmation:

-   Duplicate detection time window
-   Whether blocked customers can checkout
-   Partial cancellation rules
-   Exact logistics API
-   COD settlement workflow
-   Return/exchange workflow

------------------------------------------------------------------------

# Agent Instruction

Before coding:

1.  Read BUSINESS_RULES.md
2.  Check native Commerce Engine capability
3.  Prefer extension over core modification
4.  Preserve analytics data even if dashboard is not built
5.  Do not change business terminology:

-   FB Order
-   Signed Orders
-   AID
-   AGAIN
-   RPT
-   RECHECK

Business correctness has priority over implementation convenience.
