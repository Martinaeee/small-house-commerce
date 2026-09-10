# FRONTEND_SPEC.md

# Philippines Small House Ecommerce Frontend Specification

Version: V1.2


Project:

Philippines Small House Ecommerce Platform



---

# 1. Document Purpose


This document defines the frontend architecture, design requirements, interaction rules, and development standards of the ecommerce storefront.


This document focuses on:


- Customer shopping experience
- Facebook advertising traffic conversion
- Mobile-first ecommerce design
- Brand presentation
- Product conversion optimization


This document does NOT define backend business logic.


Backend rules are defined in:


- BUSINESS_RULES.md
- DATABASE.md
- API_SPEC.md



Detailed page specifications:


- HOMEPAGE_SPEC.md
- COLLECTION_SPEC.md
- PDP_SPEC.md
- CHECKOUT_SPEC.md



All frontend development must follow this document first.



---

# 2. Project Overview


## Business Positioning


This project is a Philippines-focused COD ecommerce website.


Product categories:


- Small space furniture
- Multi-functional furniture
- Storage solutions
- Condo living products



The website is not only a product catalog.


The frontend must:


1. Build brand trust

2. Explain lifestyle solutions

3. Reduce COD purchase hesitation

4. Convert Facebook traffic

5. Support long-term brand building



---

# 3. Frontend Architecture


The storefront consists of:




Storefront

├── Homepage

├── Collection Page

├── Product Detail Page

├── Cart

├── Checkout

└── Campaign Landing Experience




---

# 4. Customer Journey


Main traffic source:


Facebook / Instagram Advertisement



Main purchase journey:



Facebook Advertisement

↓

Landing Experience

↓

Product Detail Page

↓

Cart

↓

COD Checkout

↓

Order Created

↓

Fulfillment




The frontend must optimize this complete journey.



---

# 5. Homepage Responsibility


Purpose:


Introduce brand positioning and help customers understand the lifestyle solution.



Homepage should answer:


Who are we?


What problems do we solve?


Why choose our products?


Which products fit my space?



---

# 6. Homepage Structure


Recommended sections:



## Hero Section


Purpose:


First impression and brand positioning.



Include:


- Lifestyle image/video
- Main value proposition
- CTA button



Example:



Make Your Small Space Feel Bigger

Smart Furniture For Condo Living

Shop Now




---

## Lifestyle Scenario Section


Purpose:


Show product usage situations.



Examples:



Small Bedroom

Home Office

Storage Solution

Condo Living




---

## Featured Products


Purpose:


Guide customers to products.



Include:


- Product image
- Product name
- Price
- CTA



---

## Trust Section


Include:


- Customer reviews
- Delivery information
- COD availability
- Brand story



---

# 7. Collection Page Specification


Purpose:


Organize products based on customer needs.



The website should NOT only organize products by product type.



Wrong:



Chair

Table

Cabinet




Correct:



Small Bedroom Solution

Home Office Setup

Storage Solution

Condo Living




Collection page includes:


- Banner
- Scenario introduction
- Product list
- Product cards
- Filters



---

# 8. Product Detail Page (PDP)


Purpose:


Main conversion page.



PDP must help customers answer:


Is this product suitable for my home?


Will it fit my space?


Is it worth buying?



---

# 9. PDP Structure


Recommended order:




Hero Product Section

↓

Customer Problem

↓

Lifestyle Solution

↓

Product Benefits

↓

Product Details

↓

Dimensions

↓

Materials

↓

Reviews

↓

FAQ

↓

Offer Section

↓

CTA




---

# 10. PDP Hero Section


Must include:


- Main product image
- Product title
- Price
- Promotion
- Rating
- CTA



Mobile priority:


The first screen must immediately communicate:


- What is the product?
- Why should I care?
- How much does it cost?
- How can I buy?



---

# 11. Product Image Requirements


Furniture products require strong visual communication.



Image order:


## 1. Lifestyle Image


Show:


- Real room environment
- Product usage
- Space improvement



## 2. Product Detail Image


Show:


- Material
- Structure
- Function



## 3. Dimension Image


Show:


- Size
- Measurement
- Space requirement



## 4. Feature Image


Explain:


- Function
- Convenience
- Design



---

# 12. PDP Offer Section


Purpose:


Create purchase motivation and reduce hesitation.



The Offer section should communicate:



- Current price
- Discount information
- Bundle offer
- Promotion
- COD availability
- Shipping information



Recommended structure:



Product Price

↓

Special Offer

↓

Purchase Benefits

↓

CTA




Offer information should be visually separated from normal product description.



---

# 13. Cart Specification


Functions:


- Add product
- Remove product
- Change quantity
- Calculate subtotal
- Display promotion



Cart should reduce friction before checkout.



---

# 14. Checkout Specification


Purpose:


Complete COD purchase with minimum hesitation.



Payment:


Primary:



Cash On Delivery (COD)




Required fields:



Full Name

Phone Number

Province

City

Barangay

Address

Landmark




Checkout design requirements:


- Simple layout
- Clear CTA
- Mobile friendly
- Avoid unnecessary fields



---

# 15. Header Specification


Header includes:



## Logo


Brand identity.



## Navigation


Recommended:



Home

Shop

Small Bedroom

Home Office

Storage

Best Sellers




## Cart


Display:


- Cart quantity
- Cart access



---

# 16. Footer Specification


Include:




About Us

Contact

Shipping Information

Return Policy

Privacy Policy

Terms

FAQ




---

# 17. Product Card Standard


Required:



Product Image

Product Name

Price

Promotion Label

Rating

CTA




Optional:



Badge

Stock Status

Quick Add




---

# 18. Design System Dependency


All frontend pages must follow:


DESIGN_SYSTEM.md



Including:


- Colors
- Typography
- Buttons
- Spacing
- Cards
- Components



No page should create independent styles.



---

# 19. Frontend Data Rules


Frontend MUST NOT hard-code:


- Product name
- Price
- Inventory
- Promotion
- Product images
- Reviews



Data flow:



Frontend

↓

API

↓

Backend

↓

Database




Frontend only displays backend data.



---

# 20. CMS Requirement


Frontend content must be manageable from backend.



The following content should NOT require code modification:


## Homepage


- Banner image
- Homepage sections
- Product binding
- Text content



## Collection


- Banner
- Description
- Product sorting



## Product


- Product information
- Images
- Price
- Promotion



## Marketing Content


- Reviews
- Promotion text
- Landing page content



Backend controls:



Content

Display Status

Sorting

Images

Text

Product Binding




---

# 21. Mobile First Requirement


Primary users:


Philippines mobile shoppers.



Frontend MUST follow:



Mobile First

Responsive Design

Fast Loading

Large CTA

Simple Navigation

Easy Checkout




Priority:


Mobile experience > Desktop experience



---

# 22. COD Ecommerce Requirements


The website uses COD as primary payment.



Frontend must:


1. Clearly display COD availability

2. Reduce customer hesitation

3. Build trust

4. Collect accurate customer information



---

# 23. SEO Requirements


Support:



SEO Title

Meta Description

Friendly URL

Structured Data

Image Alt Text




---

# 24. Meta Conversion Tracking Requirements


The website receives Facebook advertising traffic.


Frontend must support Meta conversion tracking.



Required events:



## PageView


Trigger:


User visits page.



---

## ViewContent


Trigger:


Product detail page viewed.



Parameters:



content_ids

content_type

value

currency




---

## AddToCart


Trigger:


Customer adds product.



Parameters:



product_id

quantity

value

currency




---

## InitiateCheckout


Trigger:


Customer enters checkout.



Parameters:



cart_value

items

currency




---

## Purchase


Trigger:


Successful order creation.



Parameters:



order_id

value

currency

content_ids

contents




---

# 25. Tracking Data Requirements


Frontend should capture:



utm_source

utm_medium

utm_campaign

utm_content

fbclid

campaign_id

ad_id

landing_page_id




Tracking information should be attached to customer order.



---

# 26. Facebook Landing Performance Requirements


Because Facebook is the main traffic source:



Frontend must optimize:



## Loading Speed


Priority:


- Hero image optimization
- Image compression
- Lazy loading
- Reduce unnecessary scripts



Target:


Fast mobile first-screen loading.



---

## Above The Fold


The first screen should clearly show:


- Product value
- Main image/video
- CTA



Users should understand the offer quickly.



---

# 27. Frontend Development Rules


## Rule 1


Frontend priority:


Conversion > Visual effect



---

## Rule 2


Do not over-design before conversion data exists.



Avoid unnecessary:


- Complex animations
- Heavy interactions
- Slow effects



---

## Rule 3


Frontend must prioritize:


- Mobile usability
- Purchase confidence
- Loading speed



---

## Rule 4


Business logic belongs to backend.



Frontend should not:


- Calculate risk
- Calculate profit
- Modify order status
- Control inventory



---

# 28. Frontend Acceptance Criteria


The frontend system should support:



Customer:


✓ Understand brand positioning

✓ Browse products

✓ View complete product information

✓ Add cart

✓ Complete COD checkout

✓ Submit order



Marketing:


✓ Receive Facebook traffic

✓ Track conversion events

✓ Support advertising optimization



Business:


✓ Content can be managed

✓ Product information can be updated

✓ Website can support long-term operation



END