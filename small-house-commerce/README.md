# Small House Philippines Ecommerce Platform

## 1. Project Overview

This project is a Philippines-focused small-space furniture ecommerce platform.

The goal is to build a branded DTC (Direct-to-Consumer) ecommerce website instead of a traditional marketplace store.

The website focuses on:

- Condo living
- Small bedrooms
- Studio apartments
- Rental homes
- Limited-space households

The core brand positioning:

"Small Space. More Possibilities."

The website helps customers discover furniture based on:

- Room
- Space problem
- Product solution

rather than only traditional furniture categories.

---

# 2. Business Background

## Market

Country:

Philippines

Currency:

PHP (₱)

Primary customers:

- Condo residents
- Young professionals
- Renters
- Small apartment residents
- Families living in limited spaces


Main acquisition channels:

- Facebook Ads
- Facebook Organic Posts
- Social Media Traffic


Primary payment:

Cash on Delivery (COD)

Optional payment:

Airwallex Online Payment

---

# 3. Product Positioning

This is NOT a general furniture marketplace.

The product strategy is:

Small Space Furniture Solutions.

Main product characteristics:

- Compact
- Foldable
- Mobile
- Narrow
- Multi-functional
- Storage-focused


Examples:

- Foldable tables
- Narrow cabinets
- Mobile desks
- Clothes racks
- Storage solutions
- Space-saving furniture

---

# 4. Brand Philosophy

The brand believes:

People do not always need a bigger home.

They need smarter ways to use their current space.

Every product should answer:

"How does this furniture make a small space work better?"

---

# 5. Project Goals

## Business Goals

Build a scalable ecommerce system that supports:

- Product sales
- COD workflow
- Inventory management
- Logistics tracking
- Facebook attribution
- Optimizer attribution
- Signed order analytics


## Technical Goals

Build a system that supports:

- Custom storefront
- Custom homepage
- Product pages
- Checkout
- Order management
- Inventory
- Analytics
- CMS


The system should be maintainable by AI coding agents and human developers.

---

# 6. Development Philosophy

Important:

This project should NOT be built as a simple Shopify theme clone.

The goal is:

Commerce Engine Core
+
Custom Business Logic
+
Custom Frontend Experience


Preferred architecture:

Existing open-source commerce framework

+

Custom modules/extensions

+

Custom storefront


Avoid unnecessary rewriting of ecommerce fundamentals.

---

# 7. Reference Documents

Before making any changes, AI Agents MUST read:

## Business Rules

Location:

docs/BUSINESS_RULES.md


Contains:

- Order rules
- Inventory rules
- Attribution rules
- Signed Orders rules
- Signed Rate rules
- COD workflow
- Customer risk rules


This file has the highest business priority.


---

## Homepage Specification

Location:

docs/HOMEPAGE_SPEC.md


Contains:

- Homepage structure
- Brand expression
- Navigation
- CMS requirements
- Homepage modules


---

## Commerce Engine Research

Location:

docs/research/


Contains:

- Open-source framework comparison
- License analysis
- Architecture evaluation
- Gap analysis


---

# 8. Core Business Rules Summary

## Order

One unified order system.

Do not create separate order databases.

---

## Attribution

AID must be preserved.

AID is required for optimizer attribution.

Never overwrite historical attribution.

---

## Facebook Orders

FB Order means:

Orders generated from Facebook organic posts.

It is different from Meta paid advertising orders.

---

## Signed Orders

Signed Orders source:

Logistics API.

Signed Rate:

Signed Orders / All Backend Created Orders.

Cancelled and invalid orders remain included in denominator.

---

## Inventory

Cancelled orders release inventory reservation.

Stock cannot be permanently locked by cancelled orders.

---

# 9. Technical Principles for AI Agents

Before coding:

1. Read all docs.
2. Understand existing architecture.
3. Prefer extending existing modules.
4. Avoid modifying core framework code.
5. Avoid creating duplicate systems.
6. Explain architecture decisions before major changes.


---

# 10. Coding Rules

AI Agents should:

- Write maintainable code.
- Add comments for complicated business logic.
- Create tests for important workflows.
- Avoid hard-coded business data.


Do NOT:

- Hard-code homepage products.
- Hard-code prices.
- Hard-code inventory logic.
- Create duplicate Product/Order systems.


---

# 11. Current Development Stage

Current phase:

Phase 0 — Architecture Selection


Tasks:

- Evaluate Commerce Engines
- Select technical foundation
- Define database architecture
- Define frontend architecture


Not yet:

- Large-scale frontend implementation
- Production deployment


---

# 12. Future Development Roadmap

## Phase 1

Commerce Engine Setup

- Backend
- Database
- Admin
- Product
- Inventory
- Order


## Phase 2

Storefront

- Homepage
- Collection pages
- PDP
- Cart
- Checkout


## Phase 3

Business Extensions

- FB Order tracking
- Optimizer attribution
- Signed Orders
- Logistics integration
- Analytics


## Phase 4

Optimization

- SEO
- Performance
- CRO
- Marketing automation


---

# 13. Deployment Target

Production environment:

Philippines ecommerce website.

Requirements:

- Fast mobile performance
- SEO friendly
- Stable COD checkout
- Scalable order management


---

# 14. Important Reminder for AI Agents

This project is not just a website.

It is a complete ecommerce operating system.

Every technical decision should consider:

- Customer experience
- Operations
- Attribution
- Inventory accuracy
- Future scalability


When uncertain:

Do not guess.

Check:

docs/BUSINESS_RULES.md

or ask for clarification.