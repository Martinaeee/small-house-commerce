# HOMEPAGE_SPEC.md

# Small House Ecommerce Homepage Specification

Version: 1.0

Project:
Small House Ecommerce Platform

Market:
Philippines

Purpose:
Define homepage product requirements, functional requirements, CMS requirements and frontend implementation rules.

---

# 1. Homepage Positioning

## 1.1 Brand Position

Small House is a small-space furniture brand with full ecommerce capability.

The homepage must combine:

- Brand building
- Product discovery
- Ecommerce conversion


The homepage is NOT:

- A pure brand landing page
- A simple product listing page
- A marketplace homepage


The homepage goal:

Create a trusted small-space furniture brand experience while maximizing conversion.

---

# 2. Homepage Business Goals


Priority order:


## Priority 1: Conversion

Homepage should help users:

- Discover products
- Browse categories
- Search products
- View product details
- Add to wishlist
- Add to cart


## Priority 2: Brand Recognition

Users should understand:

Small House provides furniture solutions for:

- Condos
- Apartments
- Rentals
- Small homes


Brand message:

"Small Space. More Possibilities."


---

# 3. User Acquisition Context


Primary traffic source:

Facebook Ads


Important:

Most Facebook users will NOT know the brand before entering.


Homepage must quickly communicate:

1. What is Small House?
2. What problem does it solve?
3. What products are available?
4. How can users purchase?


Typical Facebook flow:


Facebook Ad

↓

Product Detail Page

↓

Cart

↓

Checkout

↓

Order


Homepage mainly supports:

- Direct traffic
- Organic traffic
- Returning visitors
- Brand exploration


---

# 4. Visual Direction


## Brand Style


Required:

- Warm Minimal
- Japandi
- Mid-Century
- Functional living


Visual keywords:

- Warm
- Clean
- Comfortable
- Practical
- Space-saving


Avoid:

- Marketplace style
- Cheap furniture catalog feeling
- Overcrowded product grids
- Excessive discount banners


---

# 5. Homepage Information Architecture


Homepage structure:


1. Announcement Bar

2. Header Navigation

3. Hero Section

4. USP Trust Bar

5. Shop By Product Category

6. Small-Space Favorites

7. Made For Real Small Spaces

8. Shop By Solution

9. Hero Product Story

10. Small Upgrades

11. Room Inspiration

12. Real Homes / UGC

13. Recently Viewed

14. Recommended Products

15. Brand Story

16. Purchase Confidence

17. Footer


---

# 6. Header Requirements


## Desktop Header


Navigation:


- New Arrivals
- Storage
- Tables
- Chairs
- Bedroom
- Solutions
- Best Sellers


Utility:


- Search
- Account
- Wishlist
- Cart


---

## Mobile Header


Required:

- Menu
- Logo
- Search
- Cart


Mobile sticky navigation:


- Home
- Categories
- Search
- Wishlist
- Account


---

# 7. Account System


## Authentication


Required:


Primary:

Email + Password


Optional:

Phone Number


---

## User Account Features


Support:


- Register
- Login
- Profile
- Order History
- Saved Address
- Wishlist


---

# 8. Checkout Requirement


Users MUST NOT need registration before purchase.


Support:


Guest Checkout


Flow:


Product

↓

Cart

↓

Checkout

↓

COD Order


Account registration is optional.


---

# 9. Wishlist System


Users can:

- Save products
- View saved products
- Return later for purchase


Data relationship:


Customer

↓

Wishlist

↓

Product


Future support:

- Price change reminder
- Marketing campaigns


---

# 10. Search System


Search is a core homepage feature.


Search scope:


## Product Search


Examples:

- Desk
- Chair
- Cabinet


---

## Category Search


Examples:

- Storage
- Bedroom
- Tables


---

## Attribute Search


Examples:

- Foldable
- Narrow
- Mobile
- Compact


---

## Solution Search


Examples:

- Small Bedroom
- Rental Friendly
- Home Office


---

# Search V1


Implement:

- Keyword matching
- Product matching
- Category matching
- Attribute matching


Future:

- Typo tolerance
- Synonym matching
- Search analytics
- AI search


---

# 11. Hero Section


## Purpose


Within first screen:

Users understand:

- Brand
- Problem
- Solution
- CTA


---

## Content


Headline:


Small Space.
More Possibilities.


Subtitle:


Furniture designed for condos, rentals and everyday small-space living.


CTA:


Primary:

Shop Small-Space Picks


Secondary:

Explore Solutions


---

# Hero CMS Requirements


Hero content must NOT be hardcoded.


CMS fields:


- Desktop Image
- Mobile Image
- Video
- Poster Image
- Title
- Subtitle
- CTA Text
- CTA Link
- Display Status
- Sort Order


---

# 12. USP Trust Bar


Position:

After Hero


Default:


- Cash On Delivery
- Made For Small Spaces
- Secure Checkout
- Philippines Delivery


CMS editable.


---

# 13. Product Category Section


Purpose:

Help users browse products.


Categories:


- New Arrivals
- Storage
- Tables
- Chairs
- Bedroom
- Best Sellers


CMS fields:


- Category Name
- Image
- Description
- Link
- Sort Order
- Enabled


---

# 14. Featured Product Section


Section:

Small-Space Favorites


Product selection:

Controlled by Admin CMS.


NOT automatic in V1.


Fields:


- Product
- Display Order
- Badge
- Enabled


---

# 15. Product Card Requirement


Product card contains:


- Product Image
- Badge
- Product Name
- Price
- Rating
- Wishlist Button
- Add Cart Button


Avoid:

- Long descriptions
- Too much information


---

# 16. Solution Section


Users can browse by problem/solution.


Solutions:


- Small Bedroom
- Home Office
- Rental Friendly
- Foldable Furniture
- Narrow Space
- Storage Solution


Relationship:


Solution

↓

Collection

↓

Products


---

# 17. Hero Product Story


Purpose:

Explain product transformation.


Example:

Foldable Table


Content:


Before

↓

Transformation

↓

After


Focus:

How product improves small-space living.


---

# 18. Room Inspiration


Show complete room solutions.


Examples:


Small Bedroom:

- Storage
- Bedside Cabinet
- Wardrobe


Home Office:

- Desk
- Chair
- Storage


Feature:

Shop This Room


---

# 19. UGC / Real Homes


Purpose:

Build trust.


Content:


- Customer image
- Customer name
- Location
- Product
- Review


Only use real customer content.


No fake reviews.


---

# 20. Recently Viewed


Support:


Track user viewed products.


Purpose:


Improve return conversion.


---

# 21. Recommended Products


V1:

Rule-based recommendation.


Example:


Viewed:

Desk


Recommend:

Chair


Future:

AI recommendation.


---

# 22. Brand Story


Position:

After commercial modules.


Purpose:

Strengthen brand.


Content:


- Small-space philosophy
- Design principles
- Brand story


---

# 23. Purchase Confidence


Before Footer.


Content:


- COD
- Secure Checkout
- Delivery Support
- Customer Service


---

# 24. Footer


Sections:


## Shop

- New Arrivals
- Storage
- Tables
- Chairs
- Bedroom
- Best Sellers


## Help

- Shipping
- Returns
- FAQ
- Track Order


## Account

- Login
- Register
- Wishlist


## About

- Story
- Privacy
- Terms


---

# 25. Homepage CMS Requirements


Homepage must be CMS-driven.


Do NOT hardcode homepage content.


CMS must support:


## Section Management


Fields:


- Section Type
- Title
- Subtitle
- Image
- Mobile Image
- Video
- CTA
- Product Selection
- Collection Selection
- Sort Order
- Enable/Disable


---

Supported sections:


- Hero
- Banner
- USP
- Category
- Product Grid
- Solution
- Room Inspiration
- UGC
- Brand Story


---

# 26. Analytics Requirements


Track:


Homepage:


- homepage_view
- hero_click
- category_click
- solution_click
- product_click
- search
- wishlist_add
- add_to_cart


Each event should include:


- section_id
- section_name
- position


---

# 27. SEO Requirements


Homepage supports:


- SEO Title
- Meta Description
- OG Image
- Schema Markup


Target keywords:


- Small Space Furniture Philippines
- Compact Furniture Philippines
- Condo Furniture Philippines


---

# 28. Data Dependency


Homepage depends on:


Product System:

- Product
- Category
- Collection
- Solution Tags
- Featured Products


Customer System:

- Account
- Wishlist


CMS System:

- Homepage Sections


Analytics System:

- Event Tracking


---

# 29. Development Rules


Agent MUST:


1. Read BUSINESS_RULES.md before implementation.

2. Use existing Product data model.

3. Do NOT create duplicate product structures.

4. Do NOT hardcode homepage products.

5. Use CMS configuration.

6. Implement V1 scope first.

7. Do not implement future features unless requested.


---

# 30. V1 Development Scope


Must implement:


- Header
- Navigation
- Search UI
- Account UI
- Wishlist UI
- Hero
- Category Section
- Featured Products
- Solution Section
- CMS Structure
- SEO Structure
- Analytics Events


---

# 31. Future Scope


Not required in V1:


- AI recommendation
- Advanced search engine
- Personalization
- Dynamic AI homepage
- Marketing automation


END OF SPECIFICATION