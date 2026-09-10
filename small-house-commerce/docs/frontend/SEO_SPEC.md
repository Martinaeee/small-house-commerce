# Philippines Small House Ecommerce SEO Specification

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines SEO requirements for the ecommerce platform.


The purpose:


- Improve search engine understanding
- Support Google indexing
- Build long-term organic traffic
- Improve product discoverability
- Reduce dependency on paid traffic



SEO applies to:


- Homepage
- Collection Pages
- Product Detail Pages
- Landing Pages
- Blog / Content Pages (Future)



All frontend and backend SEO implementation must follow this document.



---

# 2. SEO Principles


## 2.1 SEO Is A Long-Term Traffic System


The website primary traffic source is:



Facebook Ads

↓

COD Orders



SEO is designed for:



Brand Growth

↓

Organic Search

↓

Lower Customer Acquisition Cost




---

## 2.2 SEO Content Must Match Customer Intent


The website should not only target product keywords.


It should target:


Customer problems

+

Living scenarios

+

Product solutions



Example:


Wrong:



Foldable Chair



Correct:



Space Saving Foldable Chair For Small Condo Living




---

# 3. SEO Architecture


Website SEO structure:



Homepage

↓

Collection Pages

↓

Product Pages

↓

Content Pages




Search engine should understand:


Brand

↓

Category

↓

Product

↓

Use Scenario



---

# 4. URL Structure


All URLs must be:


- Short
- Meaningful
- Human readable
- Keyword related



---

# 4.1 Homepage


URL:



/




---

# 4.2 Collection Pages


Format:



/collections/{slug}




Examples:



/collections/storage-organization

/collections/tables-desks

/collections/chairs-stools

/collections/bedroom-essentials

/collections/small-space-solutions




---

# 4.3 Product Pages


Format:



/products/{slug}




Example:



/products/space-saving-foldable-chair




---

# 4.4 Landing Pages


Format:



/landing/{slug}




Example:



/landing/small-bedroom-sale




---

# 5. SEO Metadata System


All indexable pages must support:



Required fields:



seo_title

seo_description

seo_keywords

canonical_url




---

# 5.1 SEO Title Rules


Format:



Main Keyword

Customer Scenario

Brand




Example:



Space Saving Furniture For Small Homes Philippines | Brand Name




Rules:


Maximum:



50-60 characters




---

# 5.2 Meta Description Rules


Purpose:


Explain page value.


Format:



Problem

Solution

Product Category

CTA




Example:



Discover practical furniture designed for small condos and homes in the Philippines. Shop space-saving solutions with COD available.




Length:



150-160 characters




---

# 6. Homepage SEO Requirements


Homepage represents:


Brand authority.



Required:



## SEO Title


Example:



Small Space Furniture Solutions Philippines | Brand Name




## Meta Description


Should explain:


- Brand positioning
- Product category
- Customer benefit



---

## Homepage Content SEO


Homepage should include:



- Brand introduction
- Small-space living concept
- Main collections
- Featured products
- Customer reviews



---

# 7. Collection SEO Requirements


Collection pages are important SEO landing pages.



Each collection must include:



## Collection Information


Fields:



name

slug

description

banner_image

seo_title

seo_description




---

# 7.1 Collection Content Structure


Recommended:



Hero Banner

↓

Collection Introduction

↓

Featured Products

↓

Lifestyle Scenario

↓

FAQ

↓

Products




---

# 7.2 Collection SEO Copy


Content should focus on:


Scenario + Problem + Solution



Example:


Collection:


Storage & Organization



SEO content:



Smart storage solutions for small homes and condos in the Philippines.




---

# 8. Product SEO Requirements


Every product page must support SEO.



Required:



product_name

slug

description

images

price

availability

reviews

seo_title

seo_description




---

# 8.1 Product Title Rules


Avoid supplier naming.



Wrong:



Model X123 Modern Cabinet




Correct:



Compact Storage Cabinet For Small Condo Rooms




Formula:



Function

Scenario

Customer Benefit




---

# 8.2 Product Description SEO Structure


Recommended:



Product Introduction

↓

Problem

↓

Solution

↓

Features

↓

Dimensions

↓

Usage Scenario

↓

FAQ




---

# 9. Image SEO Requirements


Furniture depends heavily on images.



All images must support:



Fields:



image_url

alt_text

filename

caption




---

# 9.1 Image Alt Rules


Alt text should describe:


Product

+

Scene

+

Purpose



Example:


Wrong:



IMG001.jpg




Correct:



foldable-chair-for-small-condo-living-room




---

# 9.2 Image Optimization


Requirements:


Support:


- WebP
- AVIF
- Lazy Loading
- Responsive Images



Large images must not slow page loading.



---

# 10. Structured Data


Frontend must support Schema.org.



Required schemas:



## Product Schema


Product pages:



Include:



name

image

description

price

availability

review

rating




---

## Review Schema


Include:



ratingValue

reviewCount

customerReview




---

## FAQ Schema


FAQ sections should generate:


FAQ structured data.



---

## Breadcrumb Schema


All product pages should support:



Example:



Home

Storage

Storage Cabinet




---

# 11. Internal Linking


The website should create logical connections.



---

## Homepage Links


Homepage links to:



Collections

Featured Products

Best Sellers




---

## Collection Links


Collection links to:



Related Collections

Products

Lifestyle Content




---

## Product Links


PDP links to:



Related Products

Recommended Collections

FAQ




---

# 12. Sitemap Requirements


System must generate:



## sitemap.xml


Include:



Homepage

Collections

Products

Landing Pages

Blog Pages (Future)




Automatically update when:


- Product created
- Collection created
- Page published



---

# 13. Robots.txt


System must support:




robots.txt




Rules:


Allow:



Public product pages

Public collections




Block:



Admin pages

Private APIs

Checkout private URLs




---

# 14. Canonical URL Rules


Every indexable page must have canonical URL.



Purpose:


Prevent duplicate content.



Example:



/products/chair

canonical:

https://domain.com/products/chair




---

# 15. SEO Fields In CMS


CMS must support:



Homepage:



SEO Title

SEO Description




Collection:



SEO Title

SEO Description

SEO Content




Product:



SEO Title

SEO Description

Alt Text




Landing Page:



SEO Title

SEO Description




---

# 16. Performance SEO Requirements


SEO depends on page speed.



Frontend requirements:



- Image optimization
- CDN
- Lazy loading
- Code splitting
- Mobile optimization



Target:


Fast mobile loading.



---

# 17. Mobile SEO Requirements


Primary users:


Philippines mobile users.



Requirements:


- Responsive layout
- Mobile friendly navigation
- Large readable text
- Fast interaction
- Avoid intrusive popups



---

# 18. Analytics Integration


SEO pages should support:



Google Analytics:



Page View

User Behavior

Conversion Tracking




Google Search Console:


Support:



Index Monitoring

Search Performance

Coverage Reports




---

# 19. Future Content SEO


Future support:



Blog system:



Examples:



Small Bedroom Ideas For Filipino Homes

How To Organize A Small Condo

Best Space Saving Furniture Philippines




Content should link to:


Collections

Products



---

# 20. SEO Development Priority


## P0


Must implement:



SEO Metadata

Friendly URL

Product Schema

Collection Schema

Image Alt

Sitemap




---

## P1


Important:



Breadcrumb

FAQ Schema

Internal Linking

Search Console




---

## P2


Future:



Blog System

Content Marketing

Advanced Keyword Strategy




---

# 21. Agent Development Rules


Before implementing SEO:


Read:



README.md

SYSTEM_ARCHITECTURE.md

DATABASE.md

API_SPEC.md

FRONTEND_SPEC.md

DESIGN_SYSTEM.md

COMPONENT_LIBRARY.md




Rules:


1. SEO fields must come from backend/CMS.


2. Do not hard-code SEO content in frontend.


3. Product pages must support structured data.


4. Collection pages are SEO landing pages.


5. All images require alt text.


6. SEO implementation must not damage mobile conversion.



END