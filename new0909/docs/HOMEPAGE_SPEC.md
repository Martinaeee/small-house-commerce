# Philippines Small House Ecommerce

# HOMEPAGE_SPEC.md

版本：V1.0
页面：首页 / Homepage
市场：Philippines
语言：English / en-PH
货币：PHP / ₱
设备优先级：**Mobile First**
主要流量来源：Facebook Organic Posts + Meta Ads
主要支付方式：Cash on Delivery；Airwallex 配置启用后提供在线支付
核心定位：**Small-Space Furniture & Storage Solutions**

---

# 0. 文档定位

本文件是 Small House 首页的：

* 信息架构规范
* UI/UX规范
* 功能规范
* CMS规范
* 搜索规范
* 导航规范
* 用户账户入口规范
* 转化设计规范
* Analytics规范
* Agent开发验收规范

Agent 在实现首页前必须同时读取：

```text
docs/BUSINESS_RULES.md
docs/HOMEPAGE_SPEC.md
```

若技术实现与 `BUSINESS_RULES.md` 冲突：

**BUSINESS_RULES.md 优先。**

不得为了前端实现方便修改：

* AID
* Attribution
* Inventory
* Signed Orders
* Order
* Payment
* Customer

等底层业务规则。

---

# 1. 首页最终定位

Small House 首页不是：

> 一个把几十个家具 SKU 摆出来的商城首页。

而应该是：

> **A Small-Space Solution Store**

用户进入首页后应快速形成这种理解：

```text
我的房间比较小
↓
这个网站专门卖适合小空间的家具
↓
我可以按房间找
↓
也可以按空间问题找
↓
产品真的更窄 / 可折叠 / 可移动 / 多功能
↓
我能看到它放在真实房间里的效果
↓
价格、COD、配送方式清晰
↓
购买路径很短
```

核心品牌表达：

# Small Space. More Possibilities.

辅助表达：

**Smart furniture for condos, rentals and everyday small-space living.**

品牌语言：

**Furniture that earns its space.**

---

# 2. 首页必须解决的消费者潜在问题

页面设计不能只围绕“商品分类”。

必须围绕消费者真实问题。

## 2.1 空间不够

常见情况：

* Bedroom 太小
* 床边放不下普通床头柜
* Entryway 太窄
* Condo 空间有限
* 家具放进去以后过道变窄
* 一个房间需要承担多个功能

首页应主动展示：

* Narrow
* Foldable
* Mobile
* Multi-functional

解决方案。

---

## 2.2 收纳不够

用户可能不是来搜索：

`Storage Cabinet`

而是因为：

* 衣服没地方挂
* 鞋子乱
* 床下浪费
* 墙角浪费
* 厨房夹缝浪费
* 小物件没有收纳空间

因此需要：

```text
Shop by Space
+
Shop by Solution
+
Room Inspiration
```

帮助发现产品。

---

## 2.3 不知道买什么

Facebook 用户经常不是主动搜索购物。

因此首页不能依赖：

> 用户准确知道商品叫什么。

要给他：

* Best Sellers
* Small-Space Favorites
* Room Inspiration
* Shop by Solution
* Search Suggestions

---

## 2.4 不确定家具是否放得下

家具类消费者非常在意：

```text
Width
Depth
Height
Folded Size
```

首页应该逐渐建立“尺寸感”。

例如：

```text
ONLY 17CM DEEP
```

这类真实、明确的小空间卖点可以在首页出现。

---

## 2.5 不信任陌生独立站

Facebook 冷流量第一次看到品牌，需要快速确认：

* 能不能 COD
* 能不能配送到菲律宾
* 有没有订单查询
* 有没有客服联系
* 网站是不是正规的

所以需要：

* Trust Bar
* Track Order
* Account
* Contact
* Customer Support
* 清晰 Footer

---

# 3. 首页设计总原则

优先级：

```text
Mobile usability
>
Product discovery
>
Small-space problem solving
>
Trust
>
Conversion convenience
>
Brand aesthetics
>
Decorative complexity
```

任何模块若只是：

“看起来高级”

但不能帮助：

* 找产品
* 理解产品
* 建立信任
* 促进购买
* 获得运营数据

则不进入首页。

---

# 4. Mobile First

所有首页模块首先针对以下宽度设计：

```text
375px
390px
430px
```

再扩展到 Desktop。

禁止：

```text
Desktop completed
→ simply shrink to mobile
```

移动端是本项目的主要浏览和购买环境。

---

# 5. 首页完整信息架构

V1 推荐顺序：

```text
01 Announcement Bar

02 Global Header

03 Hero Image / Video

04 Quick Trust Bar

05 Shop by Space

06 Small-Space Favorites

07 Shop by Solution

08 Made for Real Small Spaces

09 Room Inspiration

10 Hero Product Story

11 Small Upgrades

12 Recently Viewed / Continue Shopping

13 Brand Story

14 Purchase Confidence

15 Footer

16 Mobile Sticky Navigation
```

部分没有数据时：

模块应自动隐藏。

例如：

```text
Recently Viewed = empty
→ hide

UGC = no verified content
→ hide
```

禁止展示空模块。

---

# 6. Unified Navigation System

导航必须设计成：

# 一个统一数据源，两套设备展示方式

不是独立开发：

```text
Desktop Menu
+
Mobile Menu
```

然后分别维护。

正确结构：

```text
Navigation Data
      ↓
Desktop Renderer
      ↓
Hover Mega Menu

Navigation Data
      ↓
Mobile Renderer
      ↓
Two-column Mega Menu
```

Desktop 和 Mobile 必须共用：

* 一级导航
* 二级导航
* 图片
* Collection Link
* Landing Page
* Sort Order
* Enabled 状态

只允许展示形式不同。

---

# 7. Desktop Header

建议三层逻辑。

## 第一层：Announcement Bar

例如：

```text
Cash on Delivery Available Across the Philippines
```

以后运营可替换：

```text
Free Shipping on Selected Items
```

---

## 第二层：Brand / Service Utility Navigation

建议：

```text
Small Space Living

Track Order

Help Center

Contact Us
```

右侧可以显示：

```text
Deliver to Philippines
```

---

## 第三层：Main Navigation

建议：

```text
New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom

Small-Space Solutions

Inspiration

Best Sellers

Sale
```

以及右侧：

```text
Search
Account
Wishlist
Cart
```

---

# 8. Desktop Mega Menu

鼠标 Hover 一级类目：

打开 Mega Menu。

例如：

```text
Storage & Organization
```

可展示：

```text
All Storage

Shoe Storage        [image]

Wardrobes           [image]

Storage Cabinets    [image]

Shelving            [image]

Rolling Carts       [image]

Under-Bed Storage   [image]
```

同时可增加：

```text
Featured

Small Bedroom Storage Ideas

Storage for Narrow Spaces
```

---

# 9. Mobile Header

推荐：

```text
☰      SMALL HOUSE      🔍   🛒
```

Cart 有商品时：

```text
🛒 2
```

主 Header V1 不必须显示 Account Icon。

Account 从 ☰ 菜单进入。

原因：

移动端空间有限，应优先：

```text
Menu
Search
Cart
```

---

# 10. Mobile Mega Menu

点击：

```text
☰
```

进入：

# Two-column Mobile Mega Menu

布局：

```text
┌────────────────────────────────┐
│ PH      SMALL HOUSE        ×   │
├────────────┬───────────────────┤
│ Storage    │ All Storage       │
│ Tables     │                   │
│ Chairs     │ Shoe Storage [img]│
│ Bedroom    │                   │
│ Solutions  │ Wardrobes    [img]│
│ Inspiration│                   │
│ New        │ Cabinets     [img]│
│ Best       │                   │
│ Sale       │ Carts        [img]│
│            │                   │
└────────────┴───────────────────┘
```

核心逻辑：

左侧：

一级导航。

右侧：

当前一级导航的二级内容。

---

# 11. Mobile Menu 一级导航

推荐：

```text
Storage

Tables & Desks

Chairs & Stools

Bedroom

Small-Space Solutions

Inspiration

New Arrivals

Best Sellers

Sale
```

底部服务区域：

```text
Track Order

Help Center

Contact Us

Wishlist

My Account
```

---

# 12. Storage 二级导航

```text
All Storage

Clothes Racks

Wardrobes

Shoe Storage

Storage Cabinets

Bookcases & Shelving

Rolling Carts

Under-Bed Storage
```

---

# 13. Tables & Desks 二级导航

```text
All Tables & Desks

Computer Desks

Bedside Tables

Side Tables

Folding Tables

Dining Tables

Vanity Desks
```

---

# 14. Bedroom 二级导航

```text
Shop All Bedroom

Bedside Tables

Clothes Racks

Wardrobes

Bedroom Storage

Under-Bed Storage

Small Desks

Small Bedroom Ideas
```

Bedroom 是：

**Shop by Space**

允许商品与 Storage 等分类重复。

---

# 15. Small-Space Solutions

这是品牌核心入口之一。

二级：

```text
Shop All Solutions

Narrow Space

Foldable

Mobile

Multi-functional

Hidden Storage

Rental Friendly
```

配代表产品：

```text
Narrow Space
→ Ultra Slim Shoe Cabinet

Foldable
→ Foldable Dining Table

Mobile
→ Rolling Cart

Multi-functional
→ Vanity + Desk

Hidden Storage
→ Under-Bed Storage
```

---

# 16. Inspiration

目的不是普通博客。

而是：

> 不知道买什么的人，从空间灵感进入。

内容：

```text
Small Bedroom Ideas

Studio Apartment Ideas

Work Corner Ideas

Storage Ideas

Small-Space Guide

Shop the Room
```

---

# 17. Menu 图片

Mobile 和 Desktop Mega Menu 都应支持图片。

图片作用：

帮助用户快速识别品类。

图片风格：

* 产品主体明显
* 场景清楚
* 无大量文字
* 同比例
* 同视觉体系

建议：

```text
4:3
```

或：

```text
1:1
```

全站统一。

---

# 18. Global Search

Search 是 V1 核心功能。

不能只做简单字符串精确搜索。

必须支持：

# Typo Tolerance

用户打错、少字、多字仍然能找到商品。

---

# 19. Search 容错示例

```text
storge
→ Storage

foldble table
→ Foldable Table

shoe cabnet
→ Shoe Cabinet

wardobe
→ Wardrobe

bedsid
→ Bedside Table

storagee
→ Storage

bed side table
→ Bedside Table
```

---

# 20. Search Synonyms

至少支持运营配置 Synonyms。

例如：

```text
Nightstand
↔ Bedside Table

Garment Rack
↔ Clothes Rack

Clothing Rack
↔ Clothes Rack

Trolley
↔ Rolling Cart

Computer Table
↔ Computer Desk

Shoe Rack
↔ Shoe Storage
```

Small-space需求：

```text
small room
tiny room
condo furniture
compact furniture
space saving
```

应能关联：

```text
Small-Space Solutions
```

---

# 21. Mobile Search UI

点击：

```text
🔍
```

进入全屏搜索。

顶部：

```text
←     Search furniture...
```

输入前：

```text
Popular Searches

Foldable Table
Narrow Cabinet
Bedside Table
Rolling Cart
Small Bedroom
```

有历史时：

显示：

```text
Recent Searches
```

---

# 22. Autosuggest

输入：

```text
fold
```

实时显示：

```text
CATEGORIES

Foldable Furniture


PRODUCTS

Foldable Dining Table

Foldable Stool

Foldable Vanity Desk


SOLUTIONS

Foldable
```

建议：

```text
minimum characters = 2

debounce = 150–250ms
```

---

# 23. Search Ranking

相关性优先级：

```text
1 Exact Product Name

2 Exact Category

3 Exact SKU

4 Product Name Prefix

5 Search Keywords

6 Synonym

7 Typo Match

8 Description
```

Typo Tolerance 不能压过准确匹配。

---

# 24. No Result Search

禁止只显示：

```text
No Results
```

应显示：

```text
We couldn't find an exact match.

Did you mean:

Foldable Table
```

下面显示：

```text
Popular Picks
```

---

# 25. Search Analytics

后台保存：

```text
query

normalizedQuery

resultsCount

clickedProductId

sessionId

createdAt
```

未来支持：

# Zero Result Searches

例如：

```text
dresser       98 searches

shoe bench    64 searches

study chair   52 searches
```

这是选品的重要运营数据。

---

# 26. V1 Customer Account

V1 正式支持：

```text
Register

Login

My Account

My Orders

Order Detail

Addresses

Wishlist

Profile

Password Reset

Logout
```

同时：

Guest Checkout 仍允许。

---

# 27. My Account

未登录：

进入 Sign In。

登录后：

```text
Hi, Maria

Orders

Wishlist

Addresses

Profile

Password & Security

Track Order

Logout
```

---

# 28. Wishlist

Product Card：

```text
♡
```

PDP：

```text
♡ Save
```

已登录：

存服务器。

未登录：

允许本地暂存。

登录以后：

尽可能 Merge。

---

# 29. Announcement Bar

建议高度：

```text
28–36px
```

内容后台配置。

字段：

```text
enabled

text

link

startAt

endAt

priority
```

适合：

* COD
* Shipping
* Payday
* Sale
* New Arrival

不要硬编码。

---

# 30. Hero Section

Hero 是首页品牌认知的核心。

用户在 3 秒左右应该知道：

> Small House = Small-space furniture.

推荐：

真实 Condo / Apartment / Small Bedroom。

不要：

单产品白底 Hero。

---

# 31. Hero Video

推荐：

```text
Small room
↓
Furniture unfolds / moves
↓
Storage improves
↓
More usable space
```

重点：

# Transformation

不是品牌空镜。

---

# 32. Hero Video 技术

必须：

```text
autoplay
muted
loop
playsinline
```

并提供：

```text
posterImage
```

网络较差：

优先静态图。

---

# 33. Hero Mobile

高度：

建议约：

```text
65–75vh
```

下一模块需要轻微露出。

避免用户误以为：

页面只有一个全屏视频。

---

# 34. Hero Copy

推荐：

# Small Space. More Possibilities.

Subtitle：

**Smart furniture for condos, rentals and everyday small-space living.**

Primary CTA：

```text
SHOP SMALL-SPACE PICKS
```

Secondary CTA：

```text
SHOP BY SPACE
```

最多两个 CTA。

---

# 35. Hero 运营能力

CMS 应允许调整：

```text
desktopImage

mobileImage

desktopVideo

mobileVideo

poster

headline

subtitle

primaryCTA

primaryURL

secondaryCTA

secondaryURL
```

未来允许 Hero A/B Test。

---

# 36. Quick Trust Bar

Hero 下方：

```text
Cash on Delivery

Philippines Delivery

Made for Small Spaces
```

以后 Airwallex 启用：

可以增加：

```text
Secure Online Payment
```

---

# 37. Location / Delivery

不要首页进入后立即强制弹系统定位权限。

建议：

顶部提供：

```text
Delivering to Philippines 🇵🇭
```

点击：

```text
Choose Province
```

后续用于：

* ETA
* Shipping Fee
* Delivery Availability

---

# 38. Shop by Space

Hero 后第一大浏览模块。

标题：

# Shop by Space

Subtitle：

**Find smarter furniture for the room you're working with.**

---

# 39. Shop by Space 四个入口

## Small Bedroom

```text
More storage. Less floor space.
```

商品：

* Bedside Tables
* Clothes Racks
* Wardrobes
* Under-Bed Storage
* Small Desks

---

## Storage

```text
Make every corner useful.
```

商品：

* Shoe Storage
* Cabinets
* Shelving
* Rolling Carts

---

## Work & Study

```text
A workspace when you need it.
```

商品：

* Narrow Desk
* Mobile Desk
* Folding Desk
* Drawer Cabinet

---

## Dining & Living

```text
Flexible furniture for everyday living.
```

商品：

* Folding Dining Table
* Folding Stool
* Side Table
* Rolling Cart

---

# 40. Shop by Space Mobile

建议：

```text
2 × 2
```

而不是横向滑动。

四个核心空间应该一次被看到。

每张：

```text
Lifestyle Image

Space Name

Short Copy
```

整张可点击。

---

# 41. Small-Space Favorites

首页第一组商品。

标题：

# Small-Space Favorites

Subtitle：

**Popular picks made for tighter spaces.**

展示：

约 6–8 个商品。

---

# 42. Favorites 推荐角色

第一批优先：

```text
Ultra-Slim Shoe Cabinet

Narrow Bedside Table

Mobile Bedside Clothes Rack

Narrow / Mobile Desk

Foldable Dining Table

Rolling Cart

Under-Bed Storage

Foldable Chair
```

后台人工配置。

不要自动：

```text
Newest 8
```

---

# 43. Product Card

Mobile：

2列。

包含：

```text
Product Image

1 Badge

Wishlist

Product Name

Price

Quick Add / Choose Options
```

Rating：

有真实数据以后再显示。

---

# 44. Badge

每卡最多一个。

允许：

```text
BEST SELLER

NEW

NARROW

FOLDABLE

LOW STOCK

PRE-ORDER

SALE
```

---

# 45. Quick Add

简单商品：

```text
+ Add
```

直接加入购物车。

多 Variant：

```text
Choose Options
```

打开 Bottom Sheet。

---

# 46. Quick View Bottom Sheet

显示：

```text
Image

Name

Price

Variant

Stock Status

ADD TO CART

VIEW DETAILS
```

避免消费者为了选一个颜色强制进入 PDP。

---

# 47. Cart Feedback

加入商品后：

不自动跳转 Cart Page。

显示 Bottom Drawer：

```text
Added to Cart ✓

Product

Subtotal

CHECKOUT

CONTINUE SHOPPING
```

---

# 48. Inventory UI

按照 `BUSINESS_RULES.md`。

## In Stock

正常购买。

## Low Stock

真实：

```text
Only 4 left
```

## Out of Stock

禁购。

## Pre-order

显示：

```text
Pre-order
Estimated Dispatch
```

---

# 49. Shop by Solution

品牌最核心首页模块之一。

标题：

# Shop by Solution

Subtitle：

**Start with the problem you want to solve.**

---

# 50. Solution

```text
Foldable

Narrow Space

Mobile

Multi-functional

Hidden Storage

Rental Friendly
```

Mobile：

```text
2 × 3 grid
```

---

# 51. Solution Card

例如：

```text
NARROW SPACE

Fits where ordinary furniture won't.
```

配真实：

超薄鞋柜 / 窄桌。

---

# 52. Made for Real Small Spaces

用于品牌教育。

重点三个：

```text
NARROW

FOLDABLE

MOBILE
```

---

# 53. Narrow

例如：

```text
ONLY 17CM DEEP
```

展示产品实际放进狭窄空间。

---

# 54. Foldable

展示：

```text
Closed
→
Open
```

不是只有成品图。

---

# 55. Mobile

展示带轮家具：

```text
Bedroom
→
Living Room
```

移动使用场景。

---

# 56. Room Inspiration

标题：

# Real Rooms. Smarter Ideas.

核心：

> 从空间进入购买，而不是从SKU进入购买。

---

# 57. Room Inspiration 示例

## Small Bedroom

```text
Narrow Bedside Table
Clothes Rack
Under-Bed Storage
```

## Studio Apartment

```text
Foldable Dining Table
Folding Stool
Mobile Cart
```

## Work Corner

```text
Narrow Desk
Mobile Drawer
Bookcase
```

---

# 58. V1 Room Inspiration

建议先：

```text
Large Room Image

Room Name

3 Products

SHOP THIS ROOM
```

---

# 59. V1.5 Hotspot

后续升级：

```text
Scene

image

hotspots[]

x

y

productId
```

用户点击场景里的圆点：

Bottom Sheet 出现产品。

---

# 60. Hero Product Story

首页不能一直是 Grid。

需要一个大型单品故事。

第一批建议：

```text
Foldable Dining Table
```

或：

```text
Foldable Vanity + Desk
```

---

# 61. Hero Product Story 示例

Headline：

# More table when you need it.

Subtitle：

**Less space when you don't.**

展示：

```text
Closed
↓
Open
↓
Use
↓
Fold Away
```

同时显示：

```text
Closed Dimensions
Open Dimensions
```

CTA：

```text
SEE HOW IT WORKS
```

---

# 62. Small Upgrades

目的：

不要求所有用户第一次就购买高客单家具。

标题：

# Small Upgrades. Big Difference.

价格成熟后：

```text
Small-Space Picks Under ₱1,999
```

---

# 63. Entry Products

例如：

```text
Under-Bed Storage

Rolling Cart

Folding Stool

Small Bedside Storage

Portable Table
```

---

# 64. Recently Viewed

用户有浏览历史：

显示：

# Recently Viewed

没有：

隐藏。

---

# 65. Continue Shopping

用户购物车中有商品但未完成购买：

首页后半段可显示：

```text
Still thinking about this?
```

以及：

```text
VIEW CART
```

不要强制弹窗。

---

# 66. Cart Persistence

使用 Commerce Engine 原生 Cart。

用户：

```text
Facebook
↓
Add to Cart
↓
Leave
↓
Return
```

购物车尽可能继续存在。

---

# 67. Brand Story

放在页面后半段。

标题：

# Furniture That Earns Its Space

文案方向：

> We choose furniture for the way small homes actually work — compact, flexible and useful.

> Made for condos, rentals and rooms where every square meter matters.

CTA：

```text
OUR STORY
```

---

# 68. Purchase Confidence

Footer 前：

仅使用真实能力。

```text
Cash on Delivery

Philippines Delivery

Secure Checkout

Customer Support
```

未来真实支持以后再增加：

```text
Easy Returns
```

---

# 69. Track Order

必须：

Header辅助导航

Mobile Menu

Footer

都有入口。

V1 不要求登录。

可以：

```text
Order Number

Phone
```

查询。

登录用户：

Account 内直接查看订单。

---

# 70. Mobile Sticky Bottom Navigation

推荐：

```text
Home

Shop

Search

Cart
```

如果未来需要：

可以增加 Account。

但避免底部超过5项。

---

# 71. 运营促销原则

首页不能做成 Shopee。

允许“小巧思”，但要克制。

推荐：

### Best Seller

真实销售表现。

### Low Stock

真实库存。

### Under ₱X

预算型入口。

### Campaign Slot

Payday / New Arrival。

---

# 72. Homepage Campaign Slot

CMS 预留：

```text
Homepage Campaign Slot
```

位置推荐：

Favorites 后。

Mobile：

全宽小 Banner。

例如：

```text
Payday Small-Space Picks

SHOP NOW
```

不要大面积压过整个品牌视觉。

---

# 73. Bundle

后续可以在 Room Inspiration 出现：

```text
Small Bedroom Set
```

例如：

```text
Bedside Table

Clothes Rack

Under-Bed Storage
```

V1 数据结构可以预留。

---

# 74. Delivery Estimator

以后用户选择 Province：

商品 / PDP 可以显示：

```text
Estimated Delivery
3–5 days
```

数据必须真实。

---

# 75. Homepage CMS

首页所有运营模块必须可后台修改。

建议：

```text
Admin
→ Content
→ Homepage
```

---

# 76. Homepage CMS Modules

```text
Announcement

Navigation

Hero

Trust Bar

Shop by Space

Featured Products

Shop by Solution

Small Space Benefits

Room Inspiration

Hero Product Story

Small Upgrades

Campaign Slot

Brand Story

Purchase Confidence
```

---

# 77. 通用 Section Fields

尽量统一：

```text
id

type

enabled

title

subtitle

desktopImage

mobileImage

desktopVideo

mobileVideo

ctaLabel

ctaUrl

sortOrder

startAt

endAt
```

---

# 78. 不做任意 Page Builder

V1 不开发 Webflow。

采用：

```text
Fixed Modules
+
CMS Editing
+
Sorting
```

运营人员可以：

```text
10 Hero
20 Space
30 Favorites
40 Solutions
```

调整顺序。

---

# 79. Navigation CMS

建议数据：

```text
NavigationMenu

NavigationItem
```

字段：

```text
label

url

parentId

collectionId

landingPageId

image

sortOrder

enabled
```

同一个数据源：

Desktop / Mobile 共用。

---

# 80. 首页 Featured Products

商品后台增加：

```text
featuredOnHomepage

homepagePriority

homepageBadge

homepageSection
```

不要把首页商品ID写死在组件。

---

# 81. 图片系统

首页图片分：

## Product

Product Cards。

## Lifestyle

Hero / Space / Room。

## Functional

Foldable / Narrow / Mobile。

---

# 82. Mobile Images

大型模块必须支持：

```text
mobileImage
```

不能依赖：

Desktop Auto Crop。

---

# 83. 首页文案规则

短。

例如：

正确：

```text
NARROW

Only 17cm deep.
```

不建议：

大段产品说明。

详细信息进入 PDP。

---

# 84. Product Naming

首页商品名称不得直接使用供应商长标题。

例如：

不使用：

```text
多功能移动卧室床边家用...
```

前台：

```text
Mobile Bedside Clothes Rack
```

---

# 85. Analytics

首页每个模块必须有唯一：

```text
sectionId
```

例如：

```text
homepage_hero

shop_by_space

small_space_favorites

shop_by_solution

small_space_benefits

room_inspiration

hero_product

small_upgrades

campaign_slot
```

---

# 86. Homepage Events

至少追踪：

```text
homepage_view

menu_open

menu_click

search_open

search_query

search_result_click

hero_click

space_click

solution_click

product_click

quick_add

wishlist_add

room_click

campaign_click

cart_open

checkout_click
```

---

# 87. Product Click Attribution

记录：

```text
productId

section

position

page = homepage
```

以后可以分析：

> 首页哪个位置真正带订单。

---

# 88. 保留原始流量 Attribution

例如：

```text
FB Post
↓
Homepage
↓
Product
↓
Order
```

用户打开首页以后：

原来的：

```text
aid
sourceType
facebookPostId
adId
```

不得丢失。

---

# 89. Homepage 不得覆盖 Source

如果：

```text
sourceType = FB_POST
```

用户浏览 Homepage，

不能被改成：

```text
DIRECT
```

首页只是：

内部浏览路径。

不是新的 Traffic Source。

---

# 90. Homepage Analytics 后台目标

未来支持：

```text
Section

Views

Clicks

CTR

Product Clicks

Add to Cart

Orders

Signed Orders

Signed Revenue
```

例如：

```text
Shop by Solution

Views: 12,000

Clicks: 1,500

Orders: 120

Signed: 82
```

运营人员可以决定：

这个模块是不是应该往上移动。

---

# 91. Search Analytics

后台：

```text
Top Search Queries

Zero Result Queries

Search → Product CTR

Search → Add to Cart

Search → Orders

Search → Signed Orders
```

搜索数据以后也用于：

选品。

---

# 92. 首页性能

Facebook 用户网络环境不可假设永远优秀。

必须控制：

* JS
* Image
* Video
* Fonts

---

# 93. Hero Performance

优先加载：

```text
Hero Poster
```

视频非关键情况下可以：

延迟加载。

禁止 Hero Video 阻塞：

```text
LCP
Interaction
Scroll
```

---

# 94. Below the Fold

默认：

Lazy Load。

包括：

* Room Inspiration
* Product images
* Brand Story
* Campaign images

---

# 95. Touch Target

移动端：

按钮 / Close / Menu / Hotspot 等：

建议至少：

```text
44 × 44px
```

---

# 96. Accessibility

至少考虑：

```text
Image alt

Keyboard navigation on Desktop

Visible focus

Button labels

Contrast

No text only inside images
```

---

# 97. SEO

Homepage：

```text
seoTitle

metaDescription

ogImage

canonical
```

Title 初始方向：

```text
Smart Furniture for Small Spaces in the Philippines | Small House
```

最终品牌确定后调整。

---

# 98. Structured Content

Collection / Product 必须使用真实：

```text
Product
Collection
Category
```

不能全部作为：

静态 CMS 页面。

---

# 99. V1 必须完成

### Navigation

```text
Unified Navigation
Desktop Mega Menu
Mobile Two-column Mega Menu
```

### Search

```text
Typo Tolerance
Autocomplete
Synonyms
Recent Search
Popular Search
No-result Handling
```

### Account

```text
Register
Login
My Account
Orders
Addresses
Wishlist
Password Reset
```

### Homepage

```text
Hero
Trust
Shop by Space
Favorites
Shop by Solution
Small-Space Benefits
Room Inspiration Basic
Hero Product Story
Small Upgrades
Brand Story
Trust Footer
```

---

# 100. V1.5

```text
Interactive Room Hotspots

Advanced Homepage Recommendations

Bundles

Delivery Estimator

Recently Viewed Advanced Logic

Continue Shopping Personalization
```

---

# 101. V2

```text
UGC Automation

Advanced A/B Testing

Search Personalization

AI Recommendations

Advanced Homepage Analytics

Automatic Facebook Creative → Landing Experience
```

---

# 102. 首页禁止项

Agent 不得自行加入：

```text
Huge Flash Sale Popup

Forced Location Permission

Forced Registration Before Browsing

Fake Countdown

Fake Stock

Fake Reviews

Fake Sold Count

Auto-playing Sound

Multiple Full-screen Popups

3+ Hero CTAs
```

---

# 103. 首页不得重复建设 Commerce 数据

Product 来自：

Commerce Engine。

Price 来自：

Commerce Engine Pricing。

Inventory 来自：

Commerce Engine Inventory。

Cart 来自：

Commerce Engine Cart。

Customer 来自：

Commerce Engine Customer / Auth。

首页只读取。

不要：

为了 Homepage 重新建立：

```text
HomepageProduct
HomepagePrice
HomepageInventory
```

三套业务数据。

---

# 104. 推荐架构

```text
Commerce Engine

├ Product
├ Variant
├ Pricing
├ Inventory
├ Collection
├ Customer
├ Cart
└ Order

Custom Modules

├ Homepage CMS
├ Unified Navigation
├ Search Configuration
├ Room Inspiration
└ Analytics Events

Storefront

├ Desktop Homepage
└ Mobile Homepage
```

---

# 105. Agent 开发步骤

实现首页前：

### Step 1

读取：

```text
BUSINESS_RULES.md
HOMEPAGE_SPEC.md
```

### Step 2

审计 Commerce Engine 原生能力：

```text
Navigation
Search
Customer
Wishlist
CMS
Collection
Cart
```

### Step 3

制作 Gap Analysis。

明确：

```text
Native

Extension Required

Custom Module

Do Not Modify Core
```

### Step 4

先做 Mobile UI。

### Step 5

扩展 Desktop。

### Step 6

加入 Analytics。

### Step 7

测试 Attribution。

---

# 106. Mobile 首页验收

分别测试：

```text
375px
390px
430px
```

必须：

* 无横向溢出
* Header正常
* Menu正常
* Search正常
* Product Grid稳定
* Bottom Sheet正常
* Cart正常
* 视频不阻塞
* CTA不被遮挡
* Sticky Navigation不覆盖内容

---

# 107. Navigation 验收

Desktop：

```text
Hover primary category
→ correct Mega Menu
```

Mobile：

```text
Tap ☰
→ same navigation content
→ mobile-specific layout
```

后台改一个分类：

Desktop 与 Mobile 同时更新。

---

# 108. Search 验收

以下输入应至少能合理返回：

```text
storge

foldble

wardobe

shoe cabnet

bed side

storagee
```

不得简单全部返回0结果。

---

# 109. Account 验收

必须测试：

```text
Register

Login

Logout

Password Reset

Add Address

Edit Address

Wishlist

View Orders

Order Detail
```

---

# 110. Cart 验收

```text
Quick Add
↓
Cart Drawer
↓
Continue Shopping
↓
Cart preserved
```

必须正常。

---

# 111. Attribution 验收

测试：

```text
?aid=XXX
&source=fb_post
&post=XXX
```

进入：

```text
Homepage
↓
Collection
↓
Product
↓
Cart
↓
Order
```

最终订单：

AID / Source / Post attribution 仍然存在。

---

# 112. CMS 验收

运营人员无需改代码即可：

```text
Change Hero

Change Hero CTA

Change Announcement

Change Featured Products

Change Space Images

Change Solution Images

Change Menu Thumbnail

Change Room Inspiration

Enable / Disable Section

Change Section Order

Schedule Campaign
```

---

# 113. 首页第一阶段设计重点

如果设计资源有限：

优先做好：

```text
Mobile Navigation

Search

Hero

Shop by Space

Favorites

Shop by Solution

Product Cards

Cart Experience
```

这些比：

复杂动画

3D

豪华转场

更重要。

---

# 114. 最终用户体验目标

用户进入：

> 我马上知道这个站是做Small Space家具的。

打开菜单：

> 分类很好理解，而且有图片。

不知道商品名：

> 我可以按房间和问题找。

想直接搜：

> 就算拼错也能搜得到。

看到产品：

> 我能理解它为什么更适合小空间。

想买：

> 可以Quick Add、Wishlist、Cart。

回来：

> 我的账号、订单、地址、收藏还在。

下单以后：

> 可以Track Order。

---

# 115. 最终运营体验目标

运营人员可以：

```text
管理导航

管理Hero

管理首页商品

管理Campaign

调整模块排序

查看Search需求

查看Homepage点击

分析Add to Cart

分析Orders

分析Signed Orders

分析Signed Revenue
```

而不用：

频繁让开发人员改React代码。

---

# 116. 最终定义

Small House 首页不是：

# Furniture Catalog

也不是：

# Sale Landing Page

而应该是：

# Small-Space Shopping & Discovery System

它需要同时完成：

```text
Brand
+
Navigation
+
Search
+
Discovery
+
Education
+
Trust
+
Conversion
+
Retention
+
Analytics
```

最终核心目标：

> **让菲律宾消费者更快找到适合自己有限空间的家具，并且更顺畅地完成购买。**
