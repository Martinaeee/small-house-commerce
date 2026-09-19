# Philippines Small House Ecommerce Design System

Version: V1.0


Project:

Philippines Small House COD Ecommerce Platform



---

# 1. Purpose


This document defines the global frontend design system.


The purpose:


- Maintain consistent visual language
- Standardize frontend components
- Improve development efficiency
- Prevent page-specific design inconsistency


All frontend pages MUST follow this document.



Applicable pages:


- Homepage
- Collection Page
- Product Detail Page
- Cart
- Checkout



---

# 2. Design Philosophy


The website is positioned as:


A Philippines-focused small-space furniture brand.



The design should communicate:


- Warm
- Practical
- Modern
- Comfortable
- Trustworthy
- Affordable



The website is NOT:


- Luxury furniture showroom
- Industrial marketplace
- Technical product catalog



Core feeling:


"Helping customers create better homes in smaller spaces."



---

# 3. Brand Visual Direction


## Overall Style


Design direction:


Modern Japandi + Condo Living Style



Visual keywords:



Warm

Minimal

Natural

Clean

Comfortable

Functional




Reference feeling:


- Muji
- IKEA Small Space
- Castlery
- Modern Condo Interior



---

# 4. Design Token System


All frontend styles MUST use design tokens.



No page should define independent colors or spacing.



Example:


Wrong:



Homepage button color = #123456

PDP button color = #654321




Correct:



Primary Button Token

↓

All pages use same value




---

# 5. Color System


## 5.1 Primary Brand Color


Purpose:


Brand highlights

Selected states

Important actions



Example:



Primary

Warm Beige

#C9A77B




Usage:


- Logo highlights
- Navigation active state
- Decorative elements



---

# 5.2 Main Background


Purpose:


Website background.




Background

#FAF8F5




Usage:


Homepage sections

Collection sections



---

# 5.3 Card Background



Card Background

#FFFFFF




Usage:


Product cards

Review cards

Checkout cards



---

# 5.4 Text Colors


Primary Text:



#222222



Usage:


Headings

Product names



Secondary Text:



#666666



Usage:


Descriptions

Supporting information



Muted Text:



#999999



Usage:


Small information



---

# 5.5 CTA Color


Primary purchase action:



Deep Brown

#6B4F3A




Usage:


- ORDER NOW
- BUY NOW
- Main CTA



---

# 5.6 Promotion Color


Sale:



#D9534F




Usage:


Only:


- Discount badge
- Sale label
- Promotion information



Do not use excessively.



---

# 6. Typography System


Primary font:


Recommended:



Inter

or

Poppins




Reason:


- Mobile readability
- Modern ecommerce style
- International support



---

# 6.1 Heading


## H1


Desktop:



40px (hero) / 34px (product title — tokens `text-product-title-desktop`)

Weight:

600




Mobile:



32px (hero) / 26px (product title — token `text-product-title`)

Weight:

600




Usage:


Hero title



---

## H2


Desktop:



32px




Mobile:



24px




Usage:


Section titles



---

## H3



22px

Weight:

500-600




Usage:


Product sections



---

## Body Text



16px

Line-height:

1.6




---

## Small Text



14px




Usage:


Metadata

Reviews

Shipping information



---

# 7. Layout System


## Container Width


Desktop:



max-width:

1200px




Purpose:


Keep comfortable reading width.



---

# 7.1 Page Padding


Desktop:



24px - 32px




Mobile:



16px




---

# 7.2 Section Spacing


Desktop:



80px




Mobile:



48px




All sections should have consistent spacing.



---

# 8. Responsive System


The website follows:


Mobile First Design.



Primary users:


Philippines mobile shoppers.



---

# Breakpoints



Mobile:

<768px

Tablet:

768px-1024px

Desktop:

1024px




---

# 8.1 Mobile Rules


Required:


- Single column layout
- Large buttons
- Large images
- Easy thumb interaction
- Simple navigation



Priority:


Mobile Conversion

>

Desktop Layout



---

# 8.2 Desktop Rules


Support:


- Multi-column layout
- Product comparison
- Large lifestyle images
- Hover interaction



---

# 9. Spacing System


Use 4px spacing system.



Allowed values:



4

8

12

16

24

32

48

64

80

96




Do not use random spacing.



---

# 10. Button System


All buttons share same component.



---

# 10.1 Primary Button


Purpose:


Main conversion action.



Examples:



ORDER NOW

SHOP NOW

BUY NOW




Style:



Height:

52px mobile

Radius:

8px

Font:

16px

Bold




---

# 10.2 Secondary Button


Examples:



ADD TO CART

VIEW DETAILS




Style:


Transparent background

Border



---

# 10.3 Text Button


Examples:



View More

Learn More




---

# 11. Navigation System


Header is shared across:


- Homepage
- Collection
- PDP
- Checkout



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




Navigation data comes from backend Collection API.



Frontend MUST NOT hard-code navigation.



---

# 12. Product Card System


Product Card is a core reusable component.



Used in:


- Homepage
- Collection Page
- Related Products



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




---

# Product Card Rules


Required:


- Clear image
- Simple title
- Visible price
- Clear CTA



Avoid:


Long descriptions

Technical specifications



---

# 13. Product Image System


Furniture purchase depends heavily on visualization.



Image priority:



Lifestyle Image

↓

Product Image

↓

Dimension Image

↓

Function Image

↓

Detail Image




---

# Image Ratio


Collection:



4:5




PDP:



1:1 Main Gallery




---

# 14. Collection Card System


Used for:


Homepage navigation modules.



Structure:



Image

↓

Collection Name

↓

Short Description




Example:



Storage & Organization

Make every corner useful




---

# 15. Section Component System


All pages use reusable sections.



Basic structure:



Section Container

Title

Subtitle

Content

CTA




Examples:


Homepage:


Featured Products Section



Collection:


Product Grid Section



PDP:


Feature Section



---

# 16. Trust Component System


Important for Philippines COD.



Standard Trust Bar:



✓ Cash On Delivery

✓ Nationwide Delivery

✓ Customer Support




Rules:


Keep simple.


Do not overload with guarantees.



---

# 17. Review Component System


Structure:



Rating

Customer Image

Comment

Customer Name

Location




Purpose:


Build purchase confidence.



---

# 18. Price Component System


Price display must be consistent.



Structure:



Original Price

↓

Discount Price

↓

Saving Amount




Example:



₱1,999

₱999

Save ₱1,000




---

# 19. Offer Component System


Used in PDP.



Examples:



Buy More Save More

Bundle Offer

Limited Promotion




Position:


Near CTA.



---

# 20. Checkout Component System


Checkout focuses on:


- Speed
- Trust
- Simple input



Components:


- Customer Form
- Order Summary
- Payment Method
- Submit Button



---

# 21. Form System


Input height:



48px




Requirements:


- Clear labels
- Large touch area
- Mobile friendly



---

# 22. Card System


All cards:


Border radius:



12px




Shadow:


Light shadow only.



Purpose:


Clean modern appearance.



---

# 23. Animation Rules


Animation should improve experience.



Allowed:


- Fade in
- Hover lift
- Image transition



Avoid:


- Heavy animation
- Long transitions
- Complex effects



Reason:


Mobile performance.



---

# 24. Loading System


Required:


Skeleton Loading.



Avoid:


Blank loading screen.



---

# 25. Accessibility


Requirements:


- Readable contrast
- Large clickable areas
- Clear button labels
- Alt text for images



---

# 26. Frontend Development Rules


Agent MUST follow:


1. No page-specific styles.


2. Reuse components.


3. Use design tokens.


4. Mobile first.


5. Keep visual consistency.


6. Commercial content comes from CMS.


7. Product data comes from API.



---

# 27. Required Shared Components


The frontend should implement:




Header

Footer

Button

Product Card

Collection Card

Review Card

Price Box

Offer Box

Trust Bar

FAQ Accordion

Checkout Form




---

# 28. Design System Acceptance Criteria


The system is considered correct when:


1.

Homepage, Collection, PDP share same visual language.


2.

Buttons are consistent.


3.

Product cards are reusable.


4.

Mobile experience is optimized.


5.

Backend can control commercial content.



END