# Philippines Small House Ecommerce Checkout Specification

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines the checkout experience and implementation requirements.


The checkout system is designed for:


- Philippines COD ecommerce
- Mobile-first shopping
- Facebook traffic conversion
- Low-friction order submission


The checkout page is responsible for:


- Collecting customer information
- Confirming order details
- Selecting delivery preference
- Creating COD orders
- Triggering conversion tracking


Checkout is NOT a product education page.


Its purpose is:


Reduce friction

↓

Collect accurate information

↓

Create valid orders



---

# 2. Checkout Business Principle


The checkout flow follows:



Customer Decision

↓

Information Collection

↓

Delivery Confirmation

↓

Payment Selection

↓

Order Creation




The system priority:


1. Fast completion

2. Accurate customer information

3. High COD order quality

4. Reduce failed delivery rate



---

# 3. Customer Journey


Main flow:



Product Detail Page

↓

Order Now

↓

Checkout

↓

Submit Order

↓

Order Created

↓

Risk Check

↓

COD Confirmation

↓

Shipping




---

# 4. Checkout Design Principle


## 4.1 Mobile First


Primary users:


Philippines mobile shoppers


Priority:



Mobile Conversion

Desktop Experience




Requirements:


- Fast loading
- Large input fields
- Simple steps
- Clear CTA
- Minimal distraction



---

# 4.2 Guest Checkout


The system MUST support guest checkout.


Customers do NOT need:


- Account registration
- Password creation
- Login


Reason:


COD customers prefer simple ordering.



---

# 5. Checkout Page Structure


Full checkout structure:



Checkout Header

↓

Order Preview

↓

Customer Information

↓

Delivery Address

↓

Delivery Date

↓

Payment Method

↓

Order Note

↓

Final Order Summary

↓

Place Order CTA

↓

Order Success Page




---

# 6. Checkout Header


Checkout should reduce distraction.


The header should NOT display full navigation.


Avoid:


- Product categories
- Shopping menu
- Marketing banners



Recommended:



Logo

Secure Checkout




Example:



SMALL HOUSE

Secure Checkout




---

# 7. Order Preview Module


Purpose:


Allow customers to confirm purchased items.



Display:



Product Image

Product Name

Variant

Quantity

Price




Example:



Foldable Storage Chair

Color: Black

Qty:1

₱999




---

# 8. Customer Information Module


Required fields:



## Full Name


Field:



full_name




---

## Phone Number


Required.


Support Philippines format:


Accepted:



09XXXXXXXXX

+639XXXXXXXXX




Backend normalizes phone number.



Error message:


Wrong:



INVALID_PHONE



Correct:



Please enter a valid Philippine mobile number.




---

# 9. Delivery Address Module


Furniture requires accurate delivery information.



Required:



Province

City / Municipality

Barangay

Full Address

Landmark




---

# 9.1 Location Permission


When entering checkout page:


Frontend may request location permission.


Purpose:


Assist address completion.



Example prompt:



Allow location access to help fill your delivery address faster.




Important:


Location permission is OPTIONAL.


Users can continue checkout without allowing location.



---

# 9.2 Location Usage Rules


Location data can be used for:


- Detect current province/city
- Suggest address fields
- Calculate delivery estimate


Location data MUST NOT:


- Automatically submit order
- Replace customer confirmation
- Override manually entered address



---

# 9.3 Address Selection


The system should support:


Cascade selection:



Province

↓

City / Municipality

↓

Barangay




Purpose:


Reduce:


- Wrong address
- Duplicate city names
- Logistics failure



---

# 10. Delivery Date Module


Purpose:


Improve customer confidence and delivery planning.



The module displays:


1. Estimated Delivery

2. Optional Preferred Delivery Date



---

# 10.1 Estimated Delivery


After address information is available:


System calculates:



estimated_delivery_start

estimated_delivery_end




Example:



Estimated Delivery:

Sep 18 - Sep 22




The frontend MUST NOT hard-code delivery time.



Data source:


Backend Delivery Estimate API



---

# 10.2 Preferred Delivery Date


Customers may select a preferred delivery date.



Label:



Preferred Delivery Date (Optional)




Example:



[ Select Delivery Date ]




---

# 10.3 Preferred Date Rules


Rules:


1. Selection is optional.

2. Customer can submit order without selecting date.

3. If customer does not select date, system uses default delivery schedule.

4. Preferred date is a request, not a guaranteed delivery commitment.

5. Only available dates returned from backend can be selected.



Example:


Customer selects:



Sep 20




Backend saves:



preferred_delivery_date:

2026-09-20




---

# 10.4 Delivery Date Message


Display:



We will do our best to deliver on your preferred date, subject to logistics availability.




Do NOT display:



Guaranteed delivery on Sep 20




---

# 11. Payment Method Module


COD is the default payment method.



Display:



Payment Method

● Cash On Delivery




Description:



Pay when your order arrives.




---

# 11.1 Online Payment


Support future:



Airwallex payment.



Rules:


If Airwallex is not configured:


Only show:



Cash On Delivery




Do NOT display disabled payment options.



If enabled:


Display:



● Cash On Delivery

○ Online Payment




COD remains default.



---

# 12. Order Note Module


Optional field.



Example:



Delivery notes (optional)




Examples:


- Call before delivery
- Leave at reception



---

# 13. Order Summary Module


Must clearly display:




Subtotal

Discount

Shipping Fee

Total Amount




Example:



Subtotal ₱1,999

Discount -₱200

Shipping ₱150

TOTAL ₱1,949




---

# 14. Promotion Code


Optional.



Should NOT distract customers.



Collapsed by default.



Example:



Have a promo code?




Expand:



[Enter Code]

[Apply]




---

# 15. Place Order CTA


Primary action:




PLACE ORDER




For COD:


Recommended:



PLACE COD ORDER




CTA requirements:


- Large
- Fixed position on mobile when appropriate
- Clear contrast



---

# 16. Duplicate Order Prevention


Frontend:


Prevent accidental repeated clicks.



After clicking:


Button state:



PLACE ORDER

↓

PROCESSING...




Button disabled until response.



Backend:


Must also prevent duplicate order creation.



Use:


- Phone matching
- Order time check
- Idempotency protection



Duplicate orders MUST NOT be automatically deleted.



They enter:



Double Check Workspace




---

# 17. Risk Control


Frontend does NOT calculate:


- AGAIN
- RPT
- RECHECK


Backend handles:



Customer History

↓

Risk Rules

↓

Risk Type




Customer should NOT see risk labels.



---

# 18. Order Creation


When customer submits:


Backend process:



Validate Input

↓

Create / Match Customer

↓

Check Risk

↓

Create Order

↓

Save Attribution

↓

Return Order Number




Initial order:



Order Status:

NEW

Confirmation Status:

PENDING_CONFIRM




---

# 19. Attribution Tracking


Checkout must preserve:


Traffic information:



utm_source

utm_medium

utm_campaign

utm_content

fbclid

aid

campaign_id

ad_id

post_id

landing_page_id




Attribution is saved when order is created.



Frontend cannot modify attribution after creation.



---

# 20. Analytics Events


Checkout must support:



## InitiateCheckout


Triggered:


Customer enters checkout.



---

## AddPaymentInfo


Triggered:


Payment section completed.



---

## Purchase


Triggered ONLY after:


Backend successfully creates order.



NOT when clicking button.



Purchase data:



order_id

product_id

sku

value

currency

campaign_id

ad_id

aid




---

# 21. Order Success Page


After successful order:


Redirect:



/order-success/{order_number}




---

Display:



Thank You!

Your order has been received.

Order Number:

PH100001




---

Order Information:



Product

Quantity

Total

Payment:

Cash On Delivery




---

Delivery Information:


If calculated:



Estimated Delivery:

Sep 18 - Sep 22




If customer selected:



Preferred Delivery Date:

Sep 20




---

Important:


Do NOT display:



Order Confirmed




Because COD orders still require confirmation.



Use:



Order Received




---

# 22. Error Handling


Frontend should provide friendly messages.



Examples:



Invalid phone:



Please check your phone number.




Out of stock:



Sorry, this item is currently unavailable.




Network failure:



Unable to place order. Please try again.




---

# 23. Backend Data Requirements


Orders should store:



Delivery:



estimated_delivery_start

estimated_delivery_end

preferred_delivery_date

delivery_date_status




Suggested status:



NONE

REQUESTED

CONFIRMED

UNAVAILABLE

RESCHEDULED




---

# 24. API Requirements


Checkout uses:



POST /api/v1/orders




Request:



customer

items

attribution

delivery




Delivery object:


```json
{
"estimated_delivery_start":"",
"estimated_delivery_end":"",
"preferred_delivery_date":""
}
25. Delivery Estimate API

Endpoint:


GET /api/v1/delivery/estimate



Parameters:


province

city

barangay

sku_id

quantity



Returns:


estimated_delivery_start

estimated_delivery_end

available_dates


26. Mobile Checkout Layout

Recommended:


Order Preview

↓

Customer Info

↓

Address

↓

Delivery Date

↓

Payment

↓

Summary

↓

PLACE ORDER


27. Development Priority
P0

Must Have:


Guest Checkout

Customer Information

Address

COD Payment

Order Creation

Success Page

Tracking


P1

Important:


Location Assistance

Delivery Estimate

Preferred Delivery Date

Duplicate Detection


P2

Future:


Online Payment

Advanced Address Intelligence

Automatic Delivery Scheduling


Agent Instructions

Before implementing checkout:

Read:


README.md

BUSINESS_RULES.md

DATABASE.md

ORDER_FLOW.md

API_SPEC.md

FRONTEND_SPEC.md

PDP_SPEC.md

COMPONENT_LIBRARY.md



Rules:

COD is the default payment method.
Frontend does not execute business rules.
Risk checking happens in backend.
Preferred delivery date is optional.
Customer can checkout without selecting delivery date.
Location permission is optional.
Purchase tracking happens only after successful order creation.
Historical order data must be preserved.

END