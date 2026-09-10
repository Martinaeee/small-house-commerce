

# Philippines Small House Ecommerce Component Library

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines all reusable frontend components.


The purpose:


- Create consistent UI components
- Avoid duplicated frontend development
- Improve development efficiency
- Maintain visual consistency
- Separate business data and UI components



All frontend pages MUST use components defined in this document.


Applicable pages:


- Homepage
- Collection Page
- Product Detail Page
- Cart
- Checkout



---

# 2. Component Design Principles


## 2.1 Component Reuse


The same business component MUST be reused.



Example:


Correct:



Product Card

Homepage

Collection

Related Products






Wrong:



HomepageProductCard

CollectionProductCard

RelatedProductCard






---

## 2.2 Data Driven


Components only control:


- Layout
- Interaction
- Display


Commercial data comes from:



Backend API

↓

Component






Frontend MUST NOT hard-code:


- Price
- Product name
- Promotion
- Inventory
- Reviews



---

## 2.3 CMS Compatible


Marketing components should support CMS control.


Examples:


- Hero Banner
- Promotion Banner
- Lifestyle Section
- Reviews
- FAQ



---

# 3. Component Architecture


Frontend components are divided into:




COMPONENT_LIBRARY

│

├── Global Components

│

├── Navigation Components

│

├── Product Components

│

├── Content Components

│

├── Conversion Components

│

├── Checkout Components

│

└── Utility Components






---

# 4. Global Components



# 4.1 Header Component


## Purpose


Global website navigation.



Used in:


- Homepage
- Collection
- PDP
- Checkout



---


## Structure


Desktop:



Logo

Navigation

Search

Cart

Account






Mobile:



Logo

Search

Cart

Menu






---

## Data Source


Header navigation comes from:



Collection API






Frontend MUST NOT hard-code navigation items.



Example:



Storage & Organization

Tables & Desks

Chairs & Stools






---

## Data Structure


```json

{

"logo":"",

"navigation":[

{

"name":"Storage & Organization",

"slug":"storage-organization",

"url":"/collections/storage-organization"

}

],

"cart_count":0

}


4.2 Footer Component

Purpose

Global website information.

Used in:

All pages.

Structure




Brand Information

↓

Shop Links

↓

Customer Service

↓

Policies

↓

Social Media

↓

Payment Information



CMS Controlled:

Logo

Description

Links

Policies

5. Navigation Components

5.1 Announcement Bar

Purpose

Display important messages.

Examples:




COD Available

Free Delivery Nationwide

Holiday Sale



Data




{

"text":"",

"url":"",

"status":true,

"start_time":"",

"end_time":""

}


5.2 Mega Menu

Purpose

Desktop navigation expansion.

Example:

User hover:

Storage & Organization

Display:




Storage Furniture

Bedroom Storage

Condo Storage

Featured Products



Data:




{

"collection":"",

"sub_categories":[],

"featured_products":[],

"image":""

}


6. Product Components

6.1 Product Card

Purpose

Core product display component.

Used in:

Homepage

Collection Page

Related Products

Structure:




Product Image

↓

Badge

↓

Product Name

↓

Rating

↓

Price

↓

CTA



Required Fields:




{

"id":"",

"name":"",

"image":"",

"price":"",

"compare_price":"",

"rating":"",

"badge":"",

"url":""


}


Badge Types:




NEW

BEST SELLER

SALE

LOW STOCK



Rules:

Product title should use:

Function



Scenario

Example:

Wrong:

Modern Chair Model X123

Correct:

Foldable Chair For Small Spaces

6.2 Product Gallery

Purpose

Display product images on PDP.

Structure:

Desktop:




Thumbnail

↓

Main Image



Mobile:




Main Image

↓

Image Slider



Supported Media:




Lifestyle Image

Product Image

Dimension Image

Function Image

Detail Image

Video



6.3 Price Box

Purpose

Display product pricing.

Used:

PDP

Structure:




Original Price

↓

Discount Price

↓

Saving Amount



Example:




₱1999


₱999


Save ₱1000



Data:




{

"price":"",

"compare_price":"",

"discount":"",

"currency":"PHP"

}


6.4 Variant Selector

Purpose

Select product options.

Examples:

Color:




Black

White

Wood



Size:




Small

Large



Rules:

Only show available variants.

Unavailable SKU:

Disabled state.

6.5 Quantity Selector

Structure:




-

1

+


Rules:

Minimum quantity:

1

7. Content Components

7.1 Hero Banner Component

Purpose

Large visual introduction.

Used:

Homepage

Collection

Landing Page

Structure:




Image

↓

Title

↓

Description

↓

CTA



Data:




{

"image":"",

"title":"",

"description":"",

"button_text":"",

"url":""


}


7.2 Collection Card

Purpose

Display navigation collections.

Used:

Homepage.

Structure:




Image

↓

Collection Name

↓

Short Description



Example:




Storage & Organization


Make every corner useful



7.3 Lifestyle Section

Purpose

Show furniture usage scenarios.

Used:

Homepage

Collection

PDP

Structure:




Lifestyle Image

↓

Title

↓

Description

↓

CTA



Example:




Small Bedroom Ideas


Create more space with smart furniture.



7.4 Before After Component

Purpose

Show space improvement.

Example:




Before:

Messy Corner


After:

Organized Space



Usage:

Collection:

Small-Space Solutions

PDP:

Product Benefits

7.5 Feature List Component

Purpose

Display product benefits.

Used:

PDP.

Structure:




Icon

Title

Description



Example:




✓ Foldable Design

Save space when not needed.



8. Conversion Components

8.1 Trust Bar

Purpose

Reduce COD purchase hesitation.

Used:

PDP

Checkout

Content:




✓ Cash On Delivery

✓ Nationwide Delivery

✓ Customer Support



Rules:

Keep simple.

Do not overload with:

Too many guarantees

Excessive badges

8.2 Offer Box

Purpose

Display promotions.

Used:

PDP.

Examples:




SPECIAL OFFER


Buy More Save More


Bundle Discount



Data:




{

"title":"",

"description":"",

"discount":"",

"expire_time":""


}


8.3 Sticky Buy Bar

Purpose

Mobile conversion component.

Used:

PDP.

Structure:




---------------------

Product Name

Price


[ORDER NOW]


---------------------


Requirements:

Fixed bottom

Easy thumb click

Always visible while scrolling

8.4 Review Card

Purpose:

Display customer proof.

Structure:




Rating

Customer Image

Comment

Name

Location



Example:




★★★★★


Perfect for my condo room.


Maria

Manila



9. Checkout Components

9.1 Customer Form

Purpose:

Collect COD order information.

Fields:




Full Name

Phone

Province

City

Barangay

Address

Landmark

Order Note



Requirements:

Mobile friendly

Large input area

Simple layout

9.2 Order Summary

Display:




Product

Quantity

Subtotal

Shipping

Discount

Total



9.3 Payment Method

Current:

Default:




Cash On Delivery



Future:




Airwallex Payment



Rules:

If payment method unavailable:

Hide option.

9.4 Order Success Component

After order:

Display:




Thank You

Order Number

Product

Amount

COD Reminder

Delivery Information



10. Utility Components

10.1 Loading Skeleton

Purpose:

Improve loading experience.

Used:

Product list

Product detail

Checkout

10.2 Empty State

Examples:

Cart empty:




Your cart is empty


Continue Shopping



10.3 Error State

Examples:




Product unavailable


Try another product



11. Component Priority

P0 Required

Must implement:




Header

Footer

Button

Hero Banner

Product Card

Product Gallery

Price Box

CTA

Customer Form

Order Summary



P1 Important




Mega Menu

Offer Box

Trust Bar

Review Card

Lifestyle Section

FAQ Accordion



P2 Future




Before After

AI Recommendation

Personalized Product

Advanced Filtering



12. Component Development Rules

Agent MUST:

Build reusable components first.

Avoid duplicated UI logic.

Follow DESIGN_SYSTEM.md.

Components must support API data.

Marketing content must support CMS.

No page-specific component duplication.

13. Component Relationship

Final frontend structure:




Homepage


=

Header

+

Hero

+

Collection Cards

+

Product Cards

+

Lifestyle Sections

+

Reviews

+

Footer



Collection Page


=

Header

+

Hero

+

Product Grid

+

Filters

+

Lifestyle Sections

+

Reviews

+

Footer



PDP


=

Header

+

Product Gallery

+

Price Box

+

Offer Box

+

Feature List

+

Reviews

+

FAQ

+

Sticky Buy Bar



Checkout


=

Customer Form

+

Order Summary

+

Payment

+

Order Success



14. Acceptance Criteria

Component system is complete when:



All pages share the same UI components.



Product cards are reusable.



Commercial data comes from APIs.



CMS can control marketing sections.



Mobile experience is consistent.

END
