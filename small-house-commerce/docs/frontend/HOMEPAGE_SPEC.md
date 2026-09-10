# Philippines Small House 独立站

# HOMEPAGE_SPEC.md

版本：V0.1
市场：Philippines
语言：English / en-PH
货币：PHP / ₱
主要设备：Mobile First
主要获客：Facebook Organic Posts + Meta Ads

---

# 1. 首页的核心任务

首页不是简单的“商品列表页”。

它需要在用户进入网站后的很短时间内回答三个问题：

### ① 这个网站是卖什么的？

Small-space furniture & storage solutions。

### ② 为什么这些产品和普通家具不一样？

因为它们主要解决：

* Small Bedroom
* Condo
* Studio Apartment
* Rental
* Narrow Space
* Limited Storage
* Flexible Living

### ③ 我应该从哪里开始买？

用户可以按照：

* Space
* Product Category
* Solution
* Best Sellers

快速进入商品。

---

# 2. 品牌核心定位

首页所有内容围绕：

> **Make Small Spaces Work Better.**

品牌不是“大而全家具商城”。

不是：

> Sofa / Bed / Dining / Furniture Mall

而是：

> 为菲律宾 Condo、Apartment、Rental、小卧室和有限居住空间选择更灵活、更节省空间的家具。

核心品牌关键词：

* Compact
* Flexible
* Foldable
* Narrow
* Mobile
* Smart Storage
* Multi-functional
* Rental Friendly

---

# 3. 首页整体设计原则

## 3.1 视觉方向

整体建议：

**Warm Minimal + Japandi + Mid-Century + Small Space Lifestyle**

综合色彩：

* Warm Ivory
* Cream
* Light Beige
* Walnut
* Natural Wood
* Chrome / Silver accents

避免：

* 过度电商红
* 大面积高饱和促销色
* 类似 Shopee/Lazada 的密集商品墙
* 首页到处都是价格标签
* 同时出现大量不同风格产品图

首页应该首先像：

> 一个有明确选品逻辑的 Small Space 家居品牌

其次才是：

> 一个商城。

---

# 4. Desktop 顶部导航

建议第一版：

```text
LOGO

New Arrivals

Storage & Organization

Tables & Desks

Chairs & Stools

Bedroom Essentials

Small-Space Solutions

Best Sellers

                      Search   Cart
```

V1 不强制展示 Account。

如果 V1 不做用户账号：

不要显示一个点进去没有完整功能的 Account 图标。

---

# 5. Mega Menu

## Storage & Organization

展开：

```text
Clothes Racks

Wardrobes

Shoe Storage

Bookcases & Shelving

Storage Cabinets

Rolling Carts

Under-Bed Storage
```

---

## Tables & Desks

展开：

```text
Computer Desks

Bedside Tables

Side Tables

Folding Tables

Dining Tables

Vanity Desks
```

---

## Chairs & Stools

第一版：

```text
Folding Chairs

Bar Stools
```

以后产品增加再扩展。

---

## Bedroom Essentials

可以包含：

```text
Bedside Tables

Clothes Racks

Wardrobes

Storage Cabinets

Under-Bed Storage

Small Desks
```

Bedroom Essentials 属于“按空间购物”。

允许和其他分类出现重复商品。

---

## Small-Space Solutions

这是品牌核心导航。

展开：

```text
Foldable

Narrow Space

Mobile

Multi-functional

Hidden Storage

Rental Friendly
```

后续可以增加：

```text
Corner Space
```

---

# 6. Mobile Navigation

Mobile 不直接复制 Desktop Mega Menu。

建议：

```text
Shop All

New Arrivals

Best Sellers

Storage & Organization      >

Tables & Desks              >

Chairs & Stools             >

Bedroom Essentials          >

Shop by Solution            >
```

点击二级菜单后展开。

例如：

```text
Shop by Solution

Foldable
Narrow Space
Mobile
Multi-functional
Hidden Storage
Rental Friendly
```

---

# 7. 首页完整结构

首页从上至下：

```text
Announcement Bar

Header / Navigation

01 Hero

02 Trust / USP Bar

03 Shop by Space

04 Small-Space Favorites

05 Made for Real Small Spaces

06 Shop by Solution

07 Hero Product Story

08 Before / After

09 Small Upgrades

10 Room Inspiration

11 Real Homes / UGC

12 Brand Story

13 Purchase Confidence

Footer
```

不要求 V1 每一块都非常复杂。

但是页面结构和 CMS 数据模型应该允许以后开启这些模块。

---

# 8. Announcement Bar

页面最顶部。

高度尽量控制。

内容示例：

```text
Cash on Delivery Available Across the Philippines
```

或者：

```text
Smart Furniture for Small-Space Living
```

如果以后确定免运费活动，可以动态改成：

```text
Free Shipping on Selected Items
```

---

## 后台需要支持

```text
Enabled

Text

Link

Start Date

End Date
```

不要把 Announcement 文案硬编码。

---

# 9. SECTION 01 — HERO

这是用户进入首页看到的第一屏。

## 目标

3秒以内让消费者理解：

> 这是一个专门解决小空间生活问题的家具品牌。

---

## 推荐 Hero 内容

不要单独拍：

一把椅子放白底。

更推荐：

### 一个真实 Small Condo / Small Bedroom 场景。

场景中自然出现：

* Narrow Bedside Table
* Clothes Rack
* Small Desk
* Rolling Cart
* Foldable Chair

让消费者第一眼理解：

> 这些产品是怎么进入小空间生活的。

---

# 10. Hero Video 方案

如果使用视频，推荐展示：

```text
Small / cluttered room
↓
Furniture enters / unfolds / moves
↓
Storage becomes organized
↓
More usable floor space
```

视频重点不是品牌大片。

而是：

**空间变化。**

建议视频长度：

约 6–12 秒循环。

默认：

```text
autoplay
muted
loop
playsinline
```

禁止首页自动播放声音。

---

# 11. Hero 文案

建议第一版：

## Headline

**Small Space. More Possibilities.**

## Subtitle

**Furniture made for condos, rentals and everyday small-space living.**

## Primary CTA

**SHOP SMALL-SPACE PICKS**

## Secondary CTA

**SHOP BY ROOM**

文字不要覆盖大面积画面。

---

# 12. Hero Desktop / Mobile 分开

后台必须支持：

```text
Desktop Hero Image

Mobile Hero Image

Desktop Hero Video

Mobile Hero Video

Poster Image

Headline

Subtitle

Primary CTA

Primary Link

Secondary CTA

Secondary Link
```

不要只上传一张 Desktop 横图，然后手机强制裁切。

---

# 13. Hero Mobile

Mobile 是最高优先级。

因为主要流量来自 Facebook。

原则：

* 产品必须在第一屏明显可见
* 主标题不要超过3行
* CTA无需用户滚动很久才能看到
* 不要因为视频尺寸导致页面加载很慢
* 视频加载失败时立即显示 Poster Image

建议 Hero 高度：

约 65–80vh。

不建议长期使用完整 9:16 视频占据整个首页第一屏。

---

# 14. SECTION 02 — TRUST / USP BAR

Hero 下方立即增加轻量信任条。

建议第一版只放3项：

```text
Cash on Delivery

Philippines Delivery

Made for Small Spaces
```

未来真实政策确认以后可以替换：

```text
Easy Returns
Secure Checkout
Customer Support
```

这一块必须非常轻。

不要做成大型 Icon Section。

---

# 15. SECTION 03 — SHOP BY SPACE

这是 Hero 后第一个真正的重要模块。

标题：

# Shop by Space

副标题：

**Find smarter furniture for the way you actually live.**

设置四个核心空间。

---

## CARD 01

### Small Bedroom

对应商品：

* Narrow Bedside Cabinet
* Mobile Bedside Clothes Rack
* Wardrobe
* Narrow Bookcase
* Under-Bed Storage
* Small Desk

文案：

> **More storage. Less floor space.**

---

## CARD 02

### Storage & Organization

对应：

* Clothes Racks
* Folding Wardrobe
* Shoe Cabinet
* Bookcases
* Storage Cabinets
* Rolling Carts
* Under-Bed Storage

文案：

> **Make every corner useful.**

---

## CARD 03

### Work & Study

对应：

* Narrow Desk
* Mobile Computer Desk
* Bedside Table
* Folding Desk
* Vanity Desk
* Lap Desk

文案：

> **A workspace when you need it.**

---

## CARD 04

### Dining & Living

对应：

* Folding Dining Table
* Folding Bar Stool
* Side Table
* Lift-up Sofa Table
* Mobile Kitchen / Side Cart

文案：

> **Flexible furniture for everyday living.**

---

# 16. Shop by Space 视觉

不要使用单产品白底图。

必须使用：

**生活场景图。**

例如：

Small Bedroom 卡片：

真实卧室环境。

Dining & Living：

小户型餐厅/Studio空间。

Desktop：

4卡或2×2。

Mobile：

建议2×2。

不要让用户横滑才能发现所有Space。

---

# 17. SECTION 04 — SMALL-SPACE FAVORITES

这是首页第一组真正商品区。

标题：

# Small-Space Favorites

副标题：

**Designed to do more with less space.**

V1：

首页展示约 6–8 个产品。

不要直接显示全部商品。

---

# 18. 第一批首页推荐产品

结合当前产品池，建议优先从这些里面筛选：

### A. 17cm Ultra-Slim Shoe Cabinet + Mirror

原因：

**17cm deep**

是非常强的小空间视觉卖点。

适合：

Narrow Space / Entryway。

---

### B. Narrow Mobile Bedside Table

约：

```text
30cm width
```

带移动能力。

适合：

Small Bedroom。

---

### C. Narrow Mobile Desk / Bedside Table

当前候选约：

```text
70 × 35cm
```

适合同时表达：

```text
Desk
Bedside Table
Sofa Side Table
```

属于典型 Multi-functional 产品。

---

### D. Foldable / Extendable Dining Table

折叠前后变化明显。

非常适合：

Hero Product / Facebook视频 / 首页展示。

---

### E. Mobile Bedside Clothes Rack

具备：

```text
Bedside Storage
+
Clothes Rack
+
Mobile
```

品牌逻辑非常强。

---

### F. 19cm Narrow Rolling Storage Cart

宽度约：

```text
19cm
```

很适合：

Narrow Space。

同时属于低门槛Entry Product。

---

### G. Under-Bed Rolling Storage

属于：

Hidden Storage。

消费理解成本低。

适合低价入口。

---

### H. Foldable High Stool / Folding Chair

属于：

Foldable。

折叠后体积变化可以非常直观展示。

---

# 19. Product Card

首页 Product Card 建议保持干净。

显示：

```text
Product Image

Small badge

Product Name

Price

Rating（以后有真实评价后）

Color / Variant preview（如有必要）
```

Badge 可以是：

```text
BEST SELLER

NEW

NARROW

FOLDABLE

LOW STOCK

PRE-ORDER
```

不要同时出现3–4个Badge。

每张卡最多突出一个。

---

# 20. Product Card 不建议放太多信息

不要显示：

* 完整材质
* 完整尺寸
* 大段卖点
* SKU
* 物流说明

这些进入 PDP。

首页卡片重点：

**看懂 → 感兴趣 → 点进去。**

---

# 21. Out of Stock

按照 BUSINESS_RULES：

库存为 0 时不要删除商品。

Product Card：

显示：

**Out of Stock**

并禁用直接购买。

如果启用 Pre-order：

显示：

**Pre-order**

不能显示 In Stock。

---

# 22. SECTION 05 — MADE FOR REAL SMALL SPACES

这是首页建立品牌选品逻辑的重要模块。

标题：

# Made for Real Small Spaces

建议展示3个核心概念。

---

## 01 NARROW

产品示例：

17cm Shoe Cabinet。

视觉：

产品放进狭窄门厅 / 床边 / 过道。

Headline：

**NARROW**

Copy：

> Big function without taking over the room.

可以突出真实尺寸：

**ONLY 17CM DEEP**

---

## 02 FOLDABLE

产品：

Foldable Dining Table / Folding Chair。

视觉：

折叠前

→

展开使用

→

折回。

Headline：

**FOLDABLE**

Copy：

> Use the space when you need it. Get it back when you don't.

---

## 03 MOBILE

产品：

Mobile Cart / Mobile Bedside Table / Mobile Clothes Rack。

Headline：

**MOBILE**

Copy：

> Move it where life needs it.

---

# 23. SECTION 06 — SHOP BY SOLUTION

标题：

# Shop by Solution

建议六个入口：

```text
Foldable

Narrow Space

Mobile

Multi-functional

Hidden Storage

Rental Friendly
```

---

# 24. Solution → Product Mapping

## Foldable

例如：

* Folding Dining Table
* Folding High Stool
* Folding Chair
* Folding Wardrobe
* Folding Desk
* Portable Folding Table

---

## Narrow Space

例如：

* 17cm Shoe Cabinet
* 19cm Rolling Cart
* 30cm Bedside Cabinet
* 30cm Narrow Bookcase
* 35cm Deep Desk

---

## Mobile

例如：

* Mobile Bedside Cabinet
* Mobile Desk
* Mobile Clothes Rack
* Rolling Cart
* Mobile File Cabinet

---

## Multi-functional

例如：

* Vanity + Desk + Bookcase
* Bedside Cabinet + Clothes Rack
* Shoe Cabinet + Mirror
* Kitchen Cart + Extendable Table
* Lift-up / Folding Sofa Table

---

## Hidden Storage

例如：

* Under-Bed Storage
* Drawer Cabinets
* Folding Storage Box
* Closed Storage Cabinet

---

## Rental Friendly

优先：

* No permanent installation
* Foldable
* Mobile
* Easy to move
* Compact

必须根据产品实际属性标记。

不能所有商品都强行加 Rental Friendly。

---

# 25. Solution Card 视觉

建议：

每个卡片用：

```text
产品真实使用场景
+
一个关键词
+
极短文案
```

不要用复杂Icon。

例如：

```text
NARROW SPACE

Fits where ordinary furniture won't.
```

---

# 26. SECTION 07 — HERO PRODUCT STORY

这里不要继续放普通产品Grid。

选择一个最能代表品牌的产品，做大面积内容。

第一批建议优先：

### Foldable / Extendable Dining Table

或者：

### Foldable Vanity + Desk + Bookcase

---

# 27. Hero Product Story 推荐逻辑

例如 Foldable Dining Table：

左边：

大视频。

展示：

```text
Closed
↓
Half Open
↓
Fully Open
↓
Family / couple using it
↓
Fold back
```

右边：

### MORE TABLE WHEN YOU NEED IT.

**Less space when you don't.**

并显示：

```text
Closed size
Open size
```

CTA：

**SEE HOW IT WORKS**

或者：

**SHOP THE TABLE**

---

# 28. Hero Product Story 原则

这里重点卖：

**Transformation**

而不是：

参数列表。

用户要明显看到：

> “这个东西为什么适合小户型？”

---

# 29. SECTION 08 — BEFORE / AFTER

标题：

# Small Changes. More Room.

这里非常适合 Small House。

不是做装修前后。

而是：

### 同一个房间。

Before：

* 东西乱
* 家具占空间
* 没有合理收纳

After：

增加少量Small House产品：

* Narrow Cabinet
* Mobile Clothes Rack
* Under-Bed Storage

空间明显更有秩序。

---

# 30. Before / After 文案核心

不是：

> Transform your luxurious home.

而是：

> **You don't need a bigger room. You need smarter furniture.**

这句话可以作为首页重要品牌Hook候选。

---

# 31. SECTION 09 — SMALL UPGRADES

这里主要承接第一次访问网站、还不准备买高客单家具的消费者。

标题候选：

# Small Upgrades, Big Difference

未来价格稳定后可以：

# Small-Space Upgrades Under ₱1,999

---

# 32. Small Upgrades 产品

优先放：

* Under-Bed Storage
* 19cm Rolling Cart
* Portable Folding Table
* Folding Stool
* Small Plastic Bedside Storage
* Compact Organizer

这部分属于：

**Entry Products**

目标是降低第一次成交门槛。

---

# 33. 首页产品角色

建议后台增加内部字段：

```text
productRole
```

支持：

```text
HERO

CORE

ENTRY

PREMIUM
```

同时另外增加首页推荐字段：

```text
featuredOnHomepage

homepageSection

homepagePriority
```

不要通过商品创建日期猜首页顺序。

---

# 34. SECTION 10 — ROOM INSPIRATION

标题：

# Real Rooms. Smarter Ideas.

目标：

不是卖一个单品。

而是：

**展示Small House产品怎么组成一个空间。**

---

# 35. Room Inspiration 01

## Small Bedroom

场景中：

① Narrow Bedside Table
② Mobile Clothes Rack
③ Under-Bed Storage

消费者点击产品Hotspot进入PDP。

---

# 36. Room Inspiration 02

## Studio Apartment

例如：

① Foldable Dining Table
② Folding Stool
③ Mobile Cart

---

# 37. Room Inspiration 03

## Home Office Corner

例如：

① Narrow Desk
② Mobile Drawer Cabinet
③ Tree Bookshelf

---

# 38. Room Inspiration V1

如果第一版开发时间有限：

不需要立即开发复杂图片Hotspot。

V1可以：

```text
Room Image

Room Name

3 recommended product cards

SHOP THIS SPACE
```

V1.5 再开发交互Hotspot。

---

# 39. SECTION 11 — REAL HOMES / UGC

标题建议：

# Small Spaces, Real Homes

用于未来真实消费者内容。

显示：

```text
Customer photo/video

First name

City / Province

Product

Rating

Short Review
```

---

# 40. V1 UGC 原则

如果现在没有真实菲律宾消费者UGC：

**不要制造假的Customer Review。**

可以：

暂时隐藏本Section。

CMS必须允许：

```text
enabled = false
```

以后有真实订单后再打开。

---

# 41. SECTION 12 — BRAND STORY

品牌故事不要放在首页前半段。

放到接近页面尾部。

标题：

# Furniture That Earns Its Space

短文案方向：

> We choose furniture for the way small homes actually work — compact, flexible and useful.

> Made for condos, rentals and rooms where every square meter matters.

CTA：

**ABOUT US**

---

# 42. Brand Story 不要写什么

避免：

```text
We are committed to creating a better future...

We provide premium solutions...

Quality is our mission...
```

这种泛品牌套话。

品牌故事必须继续围绕：

**Small Space。**

---

# 43. SECTION 13 — PURCHASE CONFIDENCE

Footer之前增加购买保障。

第一版仅使用已经确定真实存在的能力。

例如：

```text
Cash on Delivery

Philippines Delivery

Secure Checkout

Customer Support
```

以后退换货政策确认以后：

才能加入：

```text
Easy Returns
```

不要提前宣传不存在的服务。

---

# 44. Footer

建议结构：

## SHOP

```text
New Arrivals
Best Sellers
Storage
Tables & Desks
Chairs & Stools
Small-Space Solutions
```

## HELP

```text
Shipping & Delivery
Returns & Refunds
Track Order
FAQ
Contact Us
```

## ABOUT

```text
Our Story
Privacy Policy
Terms & Conditions
```

## CONTACT

Messenger / Email / WhatsApp 根据最终客服体系确定。

---

# 45. 首页 CMS 原则

首页不能以后每改一次Banner都让 Codex 改代码。

后台建议：

```text
Homepage
```

作为独立 CMS 页面。

至少支持管理：

```text
Announcement

Hero

Shop by Space

Featured Products

Brand Benefits

Shop by Solution

Hero Product Story

Before / After

Small Upgrades

Room Inspiration

UGC

Brand Story

Trust Section
```

---

# 46. 每个 Section 通用字段

每个 Section 最好支持：

```text
enabled

title

subtitle

desktopImage

mobileImage

video

mobileVideo

ctaLabel

ctaUrl

sortOrder
```

根据模块需要再扩展。

---

# 47. Section 排序

V1不需要Webflow级拖拽Builder。

可以让后台支持：

```text
Sort Order

10
20
30
40
```

以后调整顺序即可。

---

# 48. Shop by Space 后台数据

不要写死：

```text
Bedroom
Storage
Work
Living
```

后台保存：

```text
Title
Slug
Image Desktop
Image Mobile
Subtitle
Collection Link
Sort Order
Enabled
```

这样以后扩展：

```text
Entryway
Kitchen
```

不用重新开发首页。

---

# 49. Homepage Featured Products

后台管理员应能选择：

哪些Product进入首页。

不要默认：

```text
Newest 8 Products
```

推荐字段：

```text
Featured On Homepage
Homepage Priority
Homepage Label
```

---

# 50. 图片规则

首页主要视觉图：

不使用杂乱1688供应商图直接作为品牌场景图。

建议分：

### Product Image

用于Product Card。

### Lifestyle Image

用于：

* Hero
* Shop by Space
* Solution
* Room Inspiration

### Function Image

用于：

* Foldable
* Narrow
* Mobile
* Before / After

---

# 51. 首页图片比例建议

### Hero

Desktop：

宽屏横图 / 视频。

Mobile：

单独移动版素材。

### Shop by Space

建议：

4:5 或接近竖版生活场景。

### Product Card

建议：

统一 1:1 或 4:5。

整个站必须统一。

不要每个商品卡图片比例不同。

---

# 52. 首页性能要求

Facebook流量很多来自移动网络。

首页不能因为追求视频效果导致加载非常慢。

开发要求：

### Above the Fold

优先加载：

```text
Header
Hero
Hero Poster
```

### Below the Fold

图片 Lazy Load。

### Hero Video

必须：

* 压缩
* Muted
* Playsinline
* Poster fallback
* 不阻塞页面核心交互

如果网络较差：

优先展示Poster。

---

# 53. Mobile First 验收

不能：

Desktop做好以后简单缩小。

必须优先检查：

```text
375px
390px
430px
```

常见Mobile宽度。

重点：

* Header
* Hero
* CTA
* Product Grid
* Menu
* Cart
* Typography
* Touch targets

---

# 54. 首页字体

英文市场建议保持：

Headline：

简洁、偏现代家居。

Body：

高可读性Sans Serif。

V1不要同时用：

4–5种字体。

建议：

```text
1 Display / Heading font
+
1 Body font
```

或者统一Sans Serif。

---

# 55. 首页文字长度

原则：

视觉模块：

**少字。**

例如：

```text
NARROW

Only 17cm deep.
Made for tighter spaces.
```

不要：

一整段解释产品历史。

详细参数进PDP。

---

# 56. Price 展示

Product Card 使用：

```text
₱X,XXX
```

如果存在真正促销：

可以显示：

```text
Sale Price
Compare-at Price
```

必须来自后台真实价格。

不要把首页促销价格硬写在Banner图片中作为唯一价格来源。

---

# 57. Analytics Tracking

首页每个核心Section建议带：

```text
sectionId
sectionName
position
```

记录用户行为。

例如：

```text
homepage_hero

shop_by_space

small_space_favorites

shop_by_solution

hero_product_story

room_inspiration
```

---

# 58. 建议追踪事件

至少：

```text
homepage_view

hero_cta_click

navigation_click

collection_click

homepage_product_click

solution_click

room_click

add_to_cart
```

点击商品时尽量保存：

```text
productId

homepageSection

position
```

以后可以回答：

> 首页哪个模块真正带来最多订单？

---

# 59. 与 Attribution 的关系

首页分析不能破坏原始来源。

例如用户：

```text
Facebook Post
↓
Homepage
↓
Foldable Collection
↓
Product
↓
Order
```

订单原始来源仍然应该保留：

```text
sourceType = FB_POST
AID
Post ID
```

同时可以保存：

Homepage interaction。

不要因为用户经过首页，就把Source变成：

DIRECT。

---

# 60. SEO 基础

Homepage：

需要独立：

```text
SEO Title

Meta Description

OG Image
```

初期Title方向例如：

**Smart Furniture for Small Spaces in the Philippines | Small House**

最终品牌名确定后再调整。

---

# 61. 第一版首页建议真正上线的模块

虽然完整架构有很多Section，

但 V1 建议先把以下模块做到高质量：

```text
Announcement

Header

Hero

USP

Shop by Space

Small-Space Favorites

Made for Real Small Spaces

Shop by Solution

Hero Product Story

Small Upgrades

Brand Story

Trust

Footer
```

---

# 62. V1.5 再加入

```text
Before / After

Room Inspiration

UGC / Real Homes

Advanced Interactive Hotspots
```

原因：

这些模块对素材质量要求更高。

不应该为了“首页模块多”而用低质量内容填充。

---

# 63. 首页核心转化路径

首页不要只有一个：

Shop Now。

至少提供四种浏览入口：

```text
Shop by Product

Shop by Space

Shop by Solution

Best Sellers
```

用户能够按照自己的思考方式进入。

---

# 64. 用户路径示例

## 用户A

Facebook看到Small Bedroom广告。

```text
Homepage
↓
Small Bedroom
↓
Narrow Bedside Table
↓
PDP
↓
Checkout
```

---

## 用户B

不知道具体买什么，只知道房间很窄：

```text
Homepage
↓
Small-Space Solutions
↓
Narrow Space
↓
17cm Shoe Cabinet
↓
PDP
```

---

## 用户C

第一次进入网站：

```text
Homepage
↓
Small-Space Favorites
↓
Best Seller
↓
PDP
```

---

# 65. 首页最重要的三个品牌视觉表达

首页必须让用户明显看到：

## ① Space Saving

产品真的少占空间。

## ② Transformation

Fold / Expand / Move / Store。

## ③ Real Context

产品放在：

Small Bedroom / Condo / Apartment

真实空间里。

---

# 66. 首页不应该变成什么

禁止把首页设计成：

```text
Hero

Products × 12

Products × 12

Products × 12

Sale Banner

Products × 12
```

这会变成：

普通铺货商城。

---

# 67. 首页真正应该讲的故事

完整浏览体验应该是：

```text
你住的小空间我们理解
↓
可以按照你的房间找到东西
↓
这些是别人最喜欢的小空间产品
↓
为什么它们适合Small Space
↓
按具体问题寻找解决方案
↓
看看家具如何真正改变空间
↓
不想买大件，也有小升级产品
↓
放心购买
```

而不是：

```text
我们有很多SKU。
```

---

# 68. 首页第一批 Product Role 建议

结合当前产品池：

## HERO 候选

* Foldable / Extendable Dining Table
* 17cm Ultra-Slim Shoe Cabinet + Mirror
* Foldable Vanity + Desk + Bookcase
* Mobile Bedside Clothes Rack

这些负责：

**建立品牌认知。**

---

## CORE 候选

* Narrow Mobile Desk
* Mobile Computer Desk
* Open Clothes Rack
* Narrow Bookcase
* Modular Bookcase
* Storage Cabinet
* Folding Chair

负责：

**主要销售结构。**

---

## ENTRY 候选

* Under-Bed Storage
* Narrow Rolling Cart
* Portable Folding Table
* Small Bedside Storage
* Folding Stool

负责：

**第一次低门槛成交。**

---

## PREMIUM 候选

* Foldable Vanity / Bookcase System
* Large Storage Cabinet
* Premium Desk
* Premium Dining Table

负责：

**拉高AOV和品牌感。**

---

# 69. Agent 开发要求

实现 Homepage 前：

必须先读取：

```text
BUSINESS_RULES.md

HOMEPAGE_SPEC.md
```

然后检查选定 Commerce Engine：

哪些CMS / Collection / Product / Metadata能力可以复用。

禁止：

为了首页重新创建第二套Product数据。

---

# 70. 技术实现原则

Homepage 应该：

```text
CMS / Admin Configuration
↓
Homepage API / Server
↓
Storefront
```

而不是：

所有标题、图片、商品ID全部写死在React组件中。

---

# 71. 首页数据应该来自哪里

Product：

Commerce Engine Product。

Price：

Commerce Engine Pricing。

Inventory：

Commerce Engine Inventory。

Collection：

Commerce Engine Collection / Category。

Homepage模块：

Custom CMS / Homepage Configuration。

Attribution：

现有 Attribution 模块。

---

# 72. 首页验收标准

V1 Homepage 完成后至少满足：

### Navigation

所有一级导航可进入正确Collection。

### Hero

Desktop / Mobile素材独立。

CTA正常工作。

### Shop by Space

四个空间入口有效。

### Favorites

商品来自后台配置。

### Shop by Solution

六个Solution有效。

### Product Status

In Stock / Out of Stock / Pre-order逻辑正确。

### Mobile

手机浏览无横向溢出。

### Performance

Hero不能阻塞页面正常使用。

### Attribution

FB Post / Meta Ad进入首页后，原始AID和来源不能丢失。

### CMS

常规首页Banner、标题、产品推荐调整不需要修改代码。

---

# 73. 第一版最终页面顺序

建议正式采用：

```text
01 Announcement Bar

02 Header

03 Hero Video / Image

04 USP Bar

05 Shop by Space

06 Small-Space Favorites

07 Made for Real Small Spaces

08 Shop by Solution

09 Hero Product Story

10 Small Upgrades, Big Difference

11 Brand Story

12 Purchase Confidence

13 Footer
```

等素材和用户数据积累以后加入：

```text
Before / After

Room Inspiration

Small Spaces, Real Homes
```

---

# 74. 最核心设计原则

首页所有设计决策最终都需要回答一个问题：

> **这块内容有没有强化“Small Space”这个品牌定位？**

如果一个模块只是因为：

“其他家具网站都有”

而存在，

但不能帮助：

* 理解品牌
* 找到产品
* 理解产品优势
* 建立信任
* 完成购买

则不应该加入首页。

---

# FINAL POSITIONING

首页不是：

**A furniture catalog.**

首页应该让消费者感觉：

> **A smarter place to shop for smaller homes.**

核心品牌表达：

# Small Space. More Possibilities.

辅助表达：

**Furniture that earns its space.**

**Made for condos, rentals and everyday small-space living.**
