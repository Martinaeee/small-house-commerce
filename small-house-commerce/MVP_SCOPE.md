# MVP_SCOPE.md

# Philippines Small House Ecommerce Platform MVP Scope

Version: V1.0


Project:

Philippines Small House COD Ecommerce Website



---

# 1. Purpose


This document defines the scope of Version 1.0 MVP development.


The purpose of MVP:


Build a functional ecommerce website that allows:


Customer:

Browse products

↓

Select products

↓

Submit COD order

↓

Receive order confirmation



Business:

Receive orders

↓

Process orders

↓

Ship products

↓

Complete delivery



The MVP focuses on validating:

Product demand

Customer conversion

Order fulfillment workflow



---

# 2. MVP Development Principle


The MVP is NOT a complete ecommerce operating system.


The MVP goal is:


"Launch a working sales channel."


Advanced operation systems will be developed after real business data is generated.



---

# 3. MVP Core User Journey


The complete MVP journey:



Facebook Traffic

↓

Homepage

↓

Collection Page

↓

Product Detail Page

↓

Cart

↓

COD Checkout

↓

Order Created

↓

Admin Receives Order

↓

Order Processing

↓

Shipment

↓

Customer Receives Product




---

# 4. MVP Included Features


## 4.1 Customer Frontend


### Homepage


Status:

MUST HAVE



Purpose:


Introduce brand positioning and guide customers to products.



Required sections:


- Hero banner
- Brand introduction
- Lifestyle scenarios
- Featured products
- Product categories
- Reviews
- CTA sections



---

### Collection Page


Status:

MUST HAVE



Purpose:


Help customers discover products by living scenarios.



Initial collections:


The storefront uses a two-layer collection system.


## Primary Navigation Collections


These collections are directly connected with the website header navigation.


Required V1 collections:


### New Arrivals

Purpose:

Show newly added products and latest inventory.


---


### Storage & Organization

Purpose:

Products that help customers organize limited living spaces.


Examples:

- Storage Cabinets
- Shelves
- Shoe Storage
- Wardrobes
- Rolling Carts



---


### Tables & Desks

Purpose:

Workspace and multifunctional table solutions.


Examples:

- Computer Desks
- Folding Tables
- Side Tables
- Study Desks



---


### Chairs & Stools

Purpose:

Seating solutions for small homes.


Examples:

- Folding Chairs
- Bar Stools
- Compact Chairs



---


### Bedroom Essentials

Purpose:

Small bedroom furniture solutions.


Examples:

- Bedside Tables
- Compact Wardrobes
- Bedroom Storage



---


### Small-Space Solutions

Purpose:

Multi-functional products designed for limited spaces.


Examples:

- Foldable Furniture
- Multi-purpose Furniture
- Space Saving Products



---


### Best Sellers

Purpose:

Display products with strongest sales performance.


Used for:

- Conversion optimization
- Social proof
- Homepage recommendation



---

# Secondary Lifestyle Collections


Lifestyle collections are NOT primary navigation.


They are used for:

- Homepage storytelling
- SEO landing pages
- Campaign pages
- Facebook traffic


Examples:


## Small Bedroom


Products suitable for:

- Small bedrooms
- Rental rooms
- Studio apartments



## Home Office


Products suitable for:

- Remote work
- Study spaces
- Condo work areas



## Condo Living


Products suitable for:

- Manila condos
- Apartment living
- Limited spaces



## Small Balcony


Products suitable for:

- Balcony corners
- Outdoor small spaces



## Living Room


Products suitable for:

- Compact living areas


Required:


- Collection banner
- Description
- Product list
- Filter
- Product card



---

### Product Detail Page (PDP)


Status:

MUST HAVE



Purpose:


Main conversion page.



Required:


Product information:


- Product images
- Lifestyle images
- Product description
- Price
- SKU selection
- Stock status
- Product specifications


Trust information:


- COD availability
- Delivery information
- Basic FAQ


Conversion:


- Add to cart
- Buy now



---

### Cart


Status:

MUST HAVE



Functions:


- Add product
- Remove product
- Change quantity
- Calculate total amount



---

### COD Checkout


Status:

MUST HAVE



Required customer information:



Full Name

Phone Number

Province

City

Barangay

Address

Landmark




Payment:


MVP supports:



Cash On Delivery (COD)




After submission:


Create order record.



---

# 5. MVP Backend Features


## 5.1 Product Management


Status:

MUST HAVE



Admin can:


- Create product
- Edit product
- Upload images
- Manage SKU
- Set price
- Set stock



---

## 5.2 Customer Management


Status:

MUST HAVE



Store:


- Customer name
- Phone
- Address
- Order history



Basic customer profile only.



---

## 5.3 Order Management


Status:

MUST HAVE



Admin can:


View:


- Order list
- Order detail


Actions:


- Confirm order
- Cancel order
- Update order status



MVP Order Status:



NEW

CONFIRMED

SHIPPING

COMPLETED

CANCELLED




---

## 5.4 Inventory Management


Status:

MUST HAVE



MVP supports:


- SKU inventory
- Stock quantity
- Inventory update
- Inventory deduction



Simplified rule:


Inventory deducted after shipment.



---

## 5.5 Shipment Management


Status:

MUST HAVE



Support:


- Tracking number
- Carrier
- Shipment status



---

# 6. MVP Database Scope


MVP database includes:


## User



users




Purpose:


Admin authentication.



---

## Customer



customers




Purpose:


Store buyer information.



---

## Product



products

categories

collections

skus




Purpose:


Product management.



---

## Cart



cart

cart_items




Purpose:


Shopping cart.



---

## Order



orders

order_items




Purpose:


Transaction records.



---

## Shipment



shipments




Purpose:


Delivery tracking.



---

# 7. MVP API Scope


MVP APIs:


## Product APIs


Include:



GET products

GET product detail

GET categories

GET collections




---

## Cart APIs


Include:



Add item

Update quantity

Remove item

Get cart summary




---

## Order APIs


Include:



Create COD order

Get order

Update order status




---

## Shipment APIs


Include:



Create shipment

Update shipment status




---

# 8. MVP Admin Scope


Admin system must support:


## Authentication


- Login
- Logout
- Permission basic control



---

## Product Management


- Product CRUD
- SKU management
- Inventory update



---

## Order Management


- View orders
- View customer information
- Update order status



---

## Basic Dashboard


Display:


- Total orders
- Revenue
- Order status summary



---

# 9. Features NOT Included in MVP


The following features are intentionally postponed.



---

# 9.1 Advanced COD Risk System


NOT included:



AGAIN

RPT

RECHECK

Double Check Workspace

Customer Risk Score




Reason:


Requires real order history.



---

# 9.2 Advanced Attribution System


NOT included:



Campaign Analytics

Ad Level Attribution

Optimizer Attribution

FB Order Analysis




MVP only keeps basic traffic source if needed.



---

# 9.3 Signed Order Analytics


NOT included:



Signed Rate Dashboard

Province Analysis

City Analysis

Delivery Performance




---

# 9.4 Profit System


NOT included:



Advertising Cost

Shipping Cost

COD Fee

Profit Dashboard

ROAS Analysis




---

# 9.5 Advanced CMS


NOT included:



Homepage Builder

Landing Page Builder

Promotion Builder




Initial content can be managed through simple admin fields or code configuration.



---

# 9.6 CRM System


NOT included:



Customer Segmentation

Customer Lifecycle

Retention Marketing

SMS Automation




---

# 10. MVP Technical Requirements


The MVP must support:


## Mobile First


Because primary traffic source:


Facebook Mobile Traffic.



---

## SEO Basic Support


Include:


- SEO title
- Meta description
- Friendly URL
- Image alt



---

## Performance


Requirements:


- Fast loading
- Optimized images
- Mobile friendly



---

## Security


Include:


- Authentication
- Permission control
- Data validation
- Secure API



---

# 11. MVP Acceptance Criteria


MVP is completed when:



## Customer Side


✓ Customer can open website


✓ Customer can browse products


✓ Customer can view PDP


✓ Customer can add cart


✓ Customer can submit COD order



---

## Backend Side


✓ Admin can login


✓ Admin can manage products


✓ Admin can receive orders


✓ Admin can update order status


✓ Admin can manage inventory



---

## Business Side


✓ Facebook traffic can enter website


✓ Customer can complete purchase


✓ Order can enter fulfillment process



---

# 12. Development Rule for Agent


When developing MVP:


Agent MUST:


1. Follow this MVP scope.


2. Do not implement postponed features.


3. Do not expand database unnecessarily.


4. Do not create future modules without requirement.


5. Ask before adding new business logic.



The following documents describe future architecture:


- DATABASE.md
- API_SPEC.md
- BUSINESS_RULES.md


However, only MVP scope should be implemented first.



END