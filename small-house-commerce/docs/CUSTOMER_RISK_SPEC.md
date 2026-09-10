# CUSTOMER_RISK_SPEC.md

# Philippines Small House Ecommerce Customer Risk Specification

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines the customer risk evaluation system for COD ecommerce.


The purpose:


Reduce:


- Failed delivery
- Customer refusal
- Fake orders
- Repeated invalid orders
- Logistics loss


Improve:


- Delivery success rate
- COD profitability
- Customer confirmation efficiency



---

# 2. Core Principle


COD orders have higher operational risk.


The system must evaluate customers before shipment.



Core logic:



New Order

↓

Customer History Check

↓

Risk Evaluation

↓

Confirmation Strategy

↓

Shipping Decision




---

# 3. Risk System Scope


The risk system evaluates:


Customer level:


- Phone number
- Previous orders
- Delivery history
- Payment behavior


Order level:


- Product
- SKU
- Quantity
- Address
- Order frequency
- Previous related orders



---

# 4. Customer Identity Matching


Customer identity is determined by:


Primary:



Normalized Phone Number



Example:


Input:



09171234567

+639171234567



System converts:



+639171234567



as the same customer.



Secondary matching:


Future support:


- Name
- Address
- Email



Phone number is the main COD customer identifier.



---

# 5. Risk Level Definition


Risk levels:



NORMAL

↓

AGAIN

↓

RPT

↓

RECHECK



Priority:



RECHECK

RPT

AGAIN

NORMAL




Higher risk always overrides lower risk.



---

# 6. Risk Type Description


## 6.1 NORMAL


Definition:


Customer has no meaningful history.


Condition:



No previous orders

OR

No risk records



Action:



Normal confirmation process




---

# 6.2 AGAIN


Definition:


Returning good customer.



Condition:


Customer has:



Previous SIGNED orders

AND

No DENIED history



Example:


Customer:


Order 1:

SIGNED


Order 2:

New purchase



Risk:



AGAIN




Action:


- Faster confirmation
- Higher trust score



---

# 6.3 RPT


Definition:


Customer requires additional verification.



Conditions:


## Case A


Previous order:



PENDING

CONFIRMED

SHIPPING



Customer places another order.



Reason:


Possible duplicate order.



---


## Case B


Same SKU history:


Previous:



DENIED

FAILED DELIVERY

CANCELLED



Customer orders again.



Reason:


Product-level delivery risk.



Action:



Manual confirmation required




---

# 6.4 RECHECK


Definition:


High-risk customer.



Conditions:


Previous:



DENIED

REFUSED DELIVERY

FAILED DELIVERY



or:


Multiple cancelled COD orders.



Action:



Customer service review required

Before shipment




---

# 7. Risk Evaluation Algorithm


When order created:


System executes:



## Step 1

Find customer:



phone_normalized




---


## Step 2

Load customer history:


Retrieve:



Total Orders

Signed Orders

Cancelled Orders

Denied Orders

Failed Delivery

Recent Orders

Previous SKU




---


## Step 3

Calculate risk:


Pseudo:



IF previous denied > 0

risk = RECHECK

ELSE IF previous failed delivery > 0

risk = RECHECK

ELSE IF previous pending/shipping order exists

risk = RPT

ELSE IF previous signed order exists

risk = AGAIN

ELSE

risk = NORMAL



---


# 8. Risk Override Rules


Risk cannot be manually downgraded without permission.



Example:


Current:



RECHECK



Cannot directly change:



NORMAL



unless:



ADMIN approval

Risk note




---

# 9. Customer Risk Score


Future extension.


V1 only uses:



Rule Based Risk




Future:



Risk Score 0-100




Possible factors:


Positive:


- Signed orders
- Repeat purchase


Negative:


- Denied orders
- Wrong address
- Multiple cancellations



---

# 10. Customer Risk History


Every risk decision must be recorded.



Table:



customer_risk_logs




Fields:



id

customer_id

order_id

risk_type

previous_order_id

reason

operator_id

created_at




Example:



Customer:

+639171234567

Risk:

RECHECK

Reason:

Previous refused delivery

Related Order:

#10001




---

# 11. Double Check Queue


High-risk orders enter:



Double Check Center




Included:



RPT

RECHECK




AGAIN can optionally display.



---

# 12. Customer Service Workflow


Flow:



Risk Detected

↓

Double Check Queue

↓

Customer History Review

↓

Call Customer

↓

Decision




Actions:



Confirm

Cancel

Request Information

Add Note




---

# 13. Customer Notes


Customer communication records must be stored.



Table:



customer_notes




Fields:



id

customer_id

order_id

operator_id

note

created_at




Examples:



Customer confirmed address

Customer requested delivery after 6PM

Wrong phone number




---

# 14. Duplicate Order Detection


Purpose:


Avoid repeated COD orders.



Detection:


Same:



phone

AND

similar product

AND

short time interval




Example:


Within:



24 hours



Multiple orders:


System marks:



POSSIBLE_DUPLICATE




---

# 15. Order Merge Rules


Allowed:


Orders:



NEW

PENDING_CONFIRM



Same:



Customer

Phone

Address




Action:



Merge items

Cancel duplicate

Keep oldest order

Create audit log




Not allowed:



SHIPPING

SIGNED




---

# 16. Risk Display Rules


Admin order list:


Display:



Risk Badge

Reason

Previous Orders




Example:



🟢 AGAIN



Previous signed order: 3




🟡 RPT



Previous active order exists




🔴 RECHECK



Previous failed delivery




---

# 17. Confirmation Strategy


Risk determines confirmation priority.



## NORMAL


Standard:



Confirmation Queue




## AGAIN


Priority:



Fast Confirmation




## RPT


Required:



Manual Confirmation




## RECHECK


Required:



Customer Review

Before Shipping




---

# 18. Analytics


Risk system should provide:



## Customer Risk Report


Metrics:



Total Customers

NORMAL %

AGAIN %

RPT %

RECHECK %




## Delivery Risk Report


Metrics:



Denied Rate

Failed Delivery Rate

Risk Type Conversion




## Optimizer Risk Report


Analyze:



Orders

Risk Rate

Signed Rate




---

# 19. Audit Requirements


Record:


- Risk calculation
- Manual changes
- Customer notes
- Confirmation actions



Required:



Operator

Time

Before

After

Reason




---

# 20. Future Extensions


Reserved:


- AI risk prediction
- SMS verification
- OTP confirmation
- Customer blacklist
- Loyalty system
- Credit score system



---

# Agent Development Instructions


Before implementing customer risk:


Read:



README.md

BUSINESS_RULES.md

DATABASE.md

ORDER_FLOW.md

ADMIN_SPEC.md




Development order:


1. Customer matching

2. Customer history query

3. Risk rules engine

4. Risk logs

5. Double Check integration

6. Analytics



END