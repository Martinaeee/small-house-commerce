# Philippines Small House Ecommerce Tracking Specification

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines frontend tracking requirements.


The purpose:


- Track customer behavior
- Support Facebook advertising optimization
- Support COD order attribution
- Support optimizer performance analysis
- Connect frontend activity with backend orders


Tracking system must support:



Traffic

↓

Website Behavior

↓

Checkout

↓

Order

↓

Signed Order

↓

Profit Analysis




---

# 2. Tracking Principles


## 2.1 Backend Is Source Of Truth


Frontend tracking is responsible for:


- Collecting user behavior
- Passing attribution parameters
- Sending events



Backend is responsible for:


- Saving attribution
- Connecting orders
- Calculating performance


Frontend MUST NOT calculate:


- Profit
- ROAS
- Signed Rate
- Optimizer Performance



---

# 2.2 Attribution Must Be Preserved


When user enters website:


Tracking information must be stored.


Example:



Facebook Ad

↓

Website

↓

Checkout

↓

Order



Original attribution must remain unchanged.



---

# 3. Traffic Sources


System supports:



## 3.1 Facebook Advertisement


Source Type:



META_AD




Example:



Facebook Ad

↓

PDP

↓

Order




---

## 3.2 Facebook Organic Post


Source Type:



FB_POST




Example:



Facebook Page Post

↓

Homepage

↓

Product

↓

Order




Important:


FB Organic Order ≠ Meta Advertisement Order.



---

## 3.3 Organic Search


Source Type:



ORGANIC




---

## 3.4 Direct Traffic


Source Type:



DIRECT




---

# 4. Attribution Parameters


Frontend must capture:



## Standard Parameters



utm_source

utm_medium

utm_campaign

utm_content

fbclid




---

## Facebook Parameters


Required:



campaign_id

adset_id

ad_id




---

## Business Parameters


Required:



aid

landing_page_id

post_id

page_id




---

# 5. AID Tracking


## Purpose


Identify optimizer ownership.



Example:


Optimizer:

A


AID:



b2267034f5aef6b79bf15a0c2e2e30c1




Every order must preserve AID.



---

## AID Source


AID can come from:


Facebook Ad URL:



?aid=xxxx




Facebook Post URL:



?aid=xxxx&adid=fb0909




---

## Rules


Once captured:


AID cannot be overwritten.



Example:


Customer:


Day 1:

Facebook Ad AID=A001



Day 5:


Returns directly.



Order still belongs to:


A001



---

# 6. FB Organic Post Tracking


## Purpose


Measure Facebook Page post performance.



FB Order is based on:



Order

Attribution

Facebook Post




---

## Required Data


Save:



facebook_page_id

facebook_post_id

post_url

post_date

aid




---

## Example


Post:



FB Page:

Ellen Ella Furniture

Post:

Storage Cabinet Promotion




Order:



Source:

FB_POST

Post ID:

123456




---

# 7. Landing Page Tracking


## Purpose


Analyze landing page performance.



Required:



landing_page_id

landing_page_url

product_id




---

Example:


Campaign:


Small Bedroom Promotion



Landing:



/landing/small-bedroom




Orders must record:



landing_page_id




---

# 8. Cookie / Storage Rules


Tracking information should be stored.



Recommended:


Cookie


or


Local Storage



Storage:



first_touch_attribution

last_touch_attribution




---

# 9. First Touch Attribution


Purpose:


Understand original customer acquisition source.



Example:


Customer:


First visit:


Facebook Ad


Later:


Direct visit



First touch:


Facebook Ad



---

Stored:



first_source

first_campaign

first_aid

first_ad_id




---

# 10. Last Touch Attribution


Purpose:


Understand final conversion source.



Stored:



last_source

last_campaign

last_aid

last_ad_id




---

# 11. Order Attribution Snapshot


When customer creates order:


Frontend sends:



attribution:

{

source_type:"META_AD",

aid:"",

campaign_id:"",

ad_id:"",

post_id:"",

landing_page_id:""

}




Backend saves snapshot.



Historical attribution cannot change.



---

# 12. Meta Pixel Events


Frontend must support:



## PageView


Trigger:


Every page visit.



Data:



page_url

page_title




---

# ViewContent


Trigger:


Product Detail Page viewed.



Data:



product_id

product_name

category

price

currency




---

# AddToCart


Trigger:


User adds product.



Data:



product_id

sku_id

quantity

price

currency




---

# InitiateCheckout


Trigger:


Checkout started.



Data:



products

value

currency




---

# Purchase


Trigger:


Order successfully created.



Important:


COD order creation = Purchase event.



Data:



order_id

value

currency

products




---

# 13. COD Order Tracking


Important:


COD purchase happens before payment.



Therefore:


Purchase event means:


Customer submitted COD order.



Not:


Customer paid.



Final revenue analysis depends on:


Signed Orders.



---

# 14. Frontend Event List


Complete event flow:




PageView

↓

ViewContent

↓

AddToCart

↓

InitiateCheckout

↓

Purchase




---

# 15. Event Implementation Rules


Each event must include:



Common:



timestamp

page_url

user_session_id




Business:



product_id

sku_id

value

currency




Attribution:



aid

campaign_id

ad_id

landing_page_id




---

# 16. Facebook Conversion API Support


Future support:



Frontend:


Browser Event



+

Backend:


Server Event



Purpose:


Improve tracking accuracy.



Required preparation:


Save:



event_id




Used for:


Deduplication.



---

# 17. Optimizer Attribution


Every order must support optimizer analysis.



Relationship:



Order

↓

Attribution

↓

AID

↓

Optimizer




Optimizer performance:


Based on:



AID

Orders

Signed Orders

Profit




---

# 18. Tracking Components


Frontend components requiring tracking:



## Product Card


Events:



Product Click




---

## Product Detail Page


Events:



ViewContent




---

## Add Cart Button


Events:



AddToCart




---

## Checkout Button


Events:



InitiateCheckout




---

## Order Submit Button


Events:



Purchase




---

# 19. Tracking Data Flow



Complete flow:




User Clicks Facebook

↓

Capture Attribution

↓

Store Browser Data

↓

Browse Product

↓

Send Events

↓

Checkout

↓

Create Order

↓

Save Attribution Snapshot

↓

Backend Analysis




---

# 20. CMS Tracking Requirements


CMS controlled pages must support:



Landing Page ID

Campaign ID

Product ID




---

# 21. Analytics Requirements


System must answer:



## Advertising


Which ad generated orders?



## Organic


Which FB post generated orders?



## Product


Which product converts best?



## Optimizer


Which optimizer generated profit?



## Landing Page


Which page converts better?



---

# 22. Development Priority


## P0


Must implement:



AID Capture

UTM Capture

FB Pixel Events

Order Attribution

Purchase Event




---

## P1


Implement:



FB Post Tracking

Landing Page Tracking

First Touch Attribution

Last Touch Attribution




---

## P2


Future:



Meta CAPI

Advanced Attribution Model

Server Side Tracking




---

# 23. Agent Development Rules


Before implementing tracking:


Read:



README.md

BUSINESS_RULES.md

DATABASE.md

API_SPEC.md

ORDER_FLOW.md

FRONTEND_SPEC.md




Rules:


1. Do not overwrite attribution data.


2. Do not calculate business metrics in frontend.


3. Every order must keep attribution snapshot.


4. FB Order and Advertisement Order must remain separated.


5. Tracking must support optimizer performance analysis.


END