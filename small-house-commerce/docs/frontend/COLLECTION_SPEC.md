# Philippines Small House Ecommerce Collection Page Specification

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


Collection Page is the main product discovery page of the ecommerce website.


It connects:


Homepage Navigation

↓

Collection Page

↓

Product Detail Page

↓

Checkout

↓

COD Order



Collection Page is responsible for:


- Product discovery
- Category browsing
- Scenario inspiration
- Product comparison
- SEO traffic landing
- Conversion assistance



Collection Page is NOT a simple product category listing page.


It should help customers answer:


"What products are suitable for my home?"



---

# 2. Collection Architecture


The website uses a two-level collection system.



## Level 1: Navigation Collection


These are displayed in the website header navigation.



Current navigation:



New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers




Each navigation item MUST have one corresponding Collection Page.



Example:



Header:

Storage & Organization

↓

Collection Page:

/collections/storage-organization




---

# 3. Collection Relationship


Collection structure:



Homepage

↓

Navigation Collection

↓

Product List

↓

Product Detail Page

↓

Checkout




Products can belong to multiple collections.



Example:


Foldable Chair:


Primary Collection:


Chairs & Stools



Additional Collections:


Small-Space Solutions

Best Sellers

Small Balcony Scenario



---

# 4. Collection Page Goals


## Goal 1

Help customers discover products.


Customer enters:


"Storage & Organization"


The page should explain:


How storage products improve small homes.



---

## Goal 2

Help customers visualize usage.


Furniture purchase depends on imagination.


Collection pages should show:


Product

+

Room Scenario

+

Lifestyle



---

## Goal 3

Guide users to PDP.


The final goal:


Move users from:


Collection

↓

Product Detail Page



---

# 5. Global Page Structure


All Collection Pages follow:



Header Navigation

↓

Collection Hero

↓

Collection Introduction

↓

Problem / Lifestyle Section

↓

Featured Products

↓

Product Grid

↓

Scenario Inspiration

↓

Reviews

↓

FAQ

↓

Final CTA




---

# 6. Header Requirement


Header must be consistent across:


- Homepage
- Collection Page
- Product Detail Page
- Checkout



Contains:


Logo

Navigation

Search

Cart



Navigation:



Home

New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers




---

# 7. Collection Hero Section


Purpose:


Within first 5 seconds:


Customer understands:


- What this collection provides
- Why they need it
- What products are included



Structure:



Hero Image

↓

Title

↓

Description

↓

CTA




Requirements:


Hero image should show:


Product

+

Real home environment



Avoid:


Only isolated product images.



---

# 8. Collection Content Rules


Collection pages should combine:


Product Category

+

Lifestyle Scenario



Example:


Wrong:


"Storage Products"



Correct:


"Smart Storage Solutions For Small Homes"



---

# 9. Collection Page Definitions



# 9.1 New Arrivals


URL:



/collections/new-arrivals



Purpose:


Show latest products and new designs.



Customer psychology:


"What's new?"



Content:


Hero:


Discover Our Latest Home Solutions



Modules:


- Latest Products
- New Design Features
- Lifestyle Scenes
- Product Recommendations



Product priority:


Recently added products.



---

# 9.2 Storage & Organization


URL:



/collections/storage-organization



Purpose:


Solve:


- Small space
- Clutter
- Lack of storage



Products:


- Storage Cabinets
- Shelves
- Organizers
- Drawers
- Storage Solutions



Hero:


Make Every Corner More Organized



Internal scenarios:


- Bedroom Storage
- Condo Storage
- Kitchen Organization
- Small Apartment



---

# 9.3 Tables & Desks


URL:



/collections/tables-desks




Purpose:


Create functional working and living spaces.



Products:


- Computer Desk
- Folding Desk
- Study Table
- Side Table



Hero:


Create Your Perfect Small Workspace



Internal scenarios:


- Work From Home
- Study Corner
- Bedroom Workspace
- Condo Office



---

# 9.4 Chairs & Stools


URL:



/collections/chairs-stools




Purpose:


Provide flexible seating solutions.



Products:


- Folding Chairs
- Bar Stools
- Office Chairs
- Dining Chairs



Hero:


Comfort Without Taking Too Much Space



Internal scenarios:


- Dining Area
- Balcony
- Home Office
- Small Condo



---

# 9.5 Bedroom Essentials


URL:



/collections/bedroom-essentials




Purpose:


Improve bedroom functionality.



Products:


- Bedside Tables
- Storage Furniture
- Bedroom Cabinets
- Bedroom Accessories



Hero:


Create A Better Bedroom With Less Space



Internal scenarios:


- Small Bedroom
- Condo Bedroom
- Storage Bedroom



---

# 9.6 Small-Space Solutions


URL:



/collections/small-space-solutions




Purpose:


Core brand differentiation.



This is not a product category.


It is a lifestyle solution collection.



Products:


- Foldable Furniture
- Multi-functional Furniture
- Compact Storage
- Space Saving Products



Hero:


Make Your Small Space Work Better



Internal scenarios:


- Condo Living
- Rental Apartment
- Small Rooms
- Flexible Spaces



---

# 9.7 Best Sellers


URL:



/collections/best-sellers




Purpose:


Reduce purchase hesitation through popularity.



Customer psychology:


"Others are buying this."



Content:


- Most Purchased Products
- Customer Reviews
- Customer Photos
- Social Proof



Hero:


Customer Favorites For Small Homes



---

# 10. Product Grid


Purpose:


Display products inside collection.



Layout:


Desktop:


3-4 columns



Mobile:


2 columns



Each Product Card:


Required:



Image

Product Name

Short Benefit

Price

Promotion Badge

Rating

CTA




---

# 11. Product Card Naming Rules


Do not use supplier naming.



Wrong:


Modern Chair Model A123



Correct:


Foldable Chair For Small Spaces



Formula:


Function

+

Usage Scenario



Examples:


Compact Storage Cabinet For Condo Living


Foldable Desk For Small Home Office



---

# 12. Product Filtering


Filters should help customers choose.



Supported filters:


## Product Type


Example:


Chair

Desk

Cabinet



## Function


Example:


Foldable

Storage

Multi-purpose



## Price


Example:


Under ₱1000


₱1000-3000


Above ₱3000



## Space Scenario


Example:


Bedroom

Office

Balcony



---

# 13. Scenario Inspiration Module


Purpose:


Help customers imagine products in their homes.



Examples:


Storage Collection:



Before:

Messy corner

After:

Organized storage space




Tables Collection:



Small empty corner

↓

Functional workspace




---

# 14. Reviews Module


Required.



Display:


Rating


Customer Comment


Customer Image


Location



Example:


★★★★★


"Perfect for my small condo."


Maria

Manila



---

# 15. FAQ Module


Required.



Questions:


Delivery:


How long does delivery take?



Payment:


Do you accept COD?



Product:


Is assembly required?



Size:


Will it fit my room?



---

# 16. Final CTA


Purpose:


Convert browsing users.



Example:


Ready to improve your space?



Button:


Shop Now



---

# 17. CMS Requirements


Collection content must be editable.



Backend controls:


- Hero image
- Title
- Description
- Product sorting
- Product selection
- Scenario content
- Reviews
- FAQ
- SEO information



No frontend code modification required.



---

# 18. SEO Requirements


Each Collection Page supports:


SEO Title


Meta Description


URL


Structured Data


Image Alt Text



Example:


URL:



/collections/storage-organization




---

# 19. Analytics Requirements


Track:


Page View


Collection View


Product Click


View Product


Add To Cart


Checkout Start



Parameters:



Collection ID

Product ID

Landing Page ID

Campaign ID

Ad ID

AID




---

# 20. Mobile Requirements


Primary users:


Philippines mobile shoppers.



Requirements:


- Fast loading
- Large images
- Simple filters
- Clear CTA
- Easy scrolling



Mobile structure:



Hero

↓

Introduction

↓

Products

↓

Scenario

↓

Reviews

↓

CTA




---

# 21. Development Priority


## P0


Must Have:


- Header
- Hero
- Product Grid
- Product Card
- Product Navigation
- Product Link


## P1


- Scenario Content
- Reviews
- FAQ
- Filters


## P2


- Personalization
- AI Recommendation
- Advanced Filtering



---

# Final Goal


Every Collection Page visitor should understand:


What products are available?


↓

Why do these products fit my lifestyle?


↓

Which product should I choose?


↓

Can I trust this store?


↓

Go to Product Detail Page



END