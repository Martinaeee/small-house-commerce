# Checkout 体验补强（B 批）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 checkout 升级为「真实 ETA 日期（跳过周日）+ 四项保障条 + 隐私行 + /checkout/confirm 复核页」的纯前端改造。

**Architecture:** 共享纯函数模块 `deliveryWindow.ts` 升级为工作日算法（PDP 信任条自动一致）；新增确认路由页，用 sessionStorage 草稿在「表单页 → 确认页」间传递客户信息；抽取商品解析为共享 hook 供两页复用；下单逻辑整体迁移到确认页。

**Tech Stack:** Next.js 16 App Router、React 19（StrictMode）、Tailwind design tokens、原生 sessionStorage（无新依赖、无日期库）。

**Spec:** `docs/superpowers/specs/2026-09-16-checkout-experience-design.md`

## Global Constraints

（逐字取自 spec §2，所有任务隐式包含）
- 纯前端：不新建/修改任何后端文件、无迁移。
- 零新 npm 依赖。
- 冻结 COD 文案逐字保留：`PLACE COD ORDER`（迁移到确认页作主按钮）、`COD — calculated at checkout`、`Total (COD)`、`Cash on Delivery · No payment needed now`、`Cash on Delivery`（卡标题）、`Pay in cash when your order arrives.`、CartDrawer 的 `COD — calculated at checkout`（本批不动）。唯一授权替换：配送预计句（见任务 3）。
- 前台文案英文；Meta Pixel 调用点不变，本批不新增事件（`InitiateCheckout` 仍在表单页触发，确认页不得重复触发）。
- 无 wishlist/heart 图标；仅用现有 Tailwind design tokens；内联 SVG 图标风格沿用 PdpClient 货车 glyph。
- `frontend/src/lib/api.ts` 禁止修改（`createOrder` 现成）。
- `frontend/src/lib/deliveryWindow.ts` 为线 A 区域消费的值模块：改动前通知线 A；`DeliveryWindows` 类型形状不变，PdpClient/PdpView/产品页/lp 页零改动。
- 门禁：`cd frontend && npx tsc --noEmit` 0 错、`npx eslint src` 0/0、`npm run build` 通过。
- 提交仅显式 `git add <path>`，禁止 `git add -A`；全部提交落在 `feat/checkout-experience`。

---

### Task 1: deliveryWindow 工作日算法 + NCR 判定

**Files:**
- Modify: `frontend/src/lib/deliveryWindow.ts`
- Scratch (验证后删除): `frontend/tmp-eta-check.ts`

**Interfaces:**
- Consumes: 无（纯模块，现导出 `deliveryWindows(now?)`、`formatDeliveryRange(now, min, max)`、`DeliveryWindows` 类型——均保持可用）
- Produces: `addBusinessDays(date, n)`、`isMetroManila(province)`、`deliveryWindowFor(province, now?)`（任务 3/4/5 消费）

- [ ] **Step 1: 写确定性断言脚本（失败态）**

创建 `frontend/tmp-eta-check.ts`（**必须在 `frontend/` 根目录，不在 src 下**，避免被 tsc/eslint 收录）：

```ts
// SCRATCH — deterministic ETA-math verification; delete after Task 1.
import { addBusinessDays, isMetroManila, deliveryWindowFor, formatDeliveryRange } from "./src/lib/deliveryWindow";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got ${String(actual)} want ${String(expected)}`);
}

const WED = new Date("2026-09-16T12:00:00+08:00"); // Wednesday
const SUN = new Date("2026-09-20T12:00:00+08:00"); // Sunday

eq("addBusinessDays Wed+3", addBusinessDays(WED, 3).toDateString(), "Sat Sep 19 2026");
eq("addBusinessDays Wed+5", addBusinessDays(WED, 5).toDateString(), "Tue Sep 22 2026");
eq("addBusinessDays Wed+7", addBusinessDays(WED, 7).toDateString(), "Thu Sep 24 2026");
eq("addBusinessDays Sun+1", addBusinessDays(SUN, 1).toDateString(), "Mon Sep 21 2026");
eq("addBusinessDays Sun+0", addBusinessDays(SUN, 0).toDateString(), "Sun Sep 20 2026");
eq("addBusinessDays Fri+1 skips Sun", addBusinessDays(new Date("2026-09-18T12:00:00+08:00"), 1).toDateString(), "Mon Sep 21 2026");

eq("MM window Wed", deliveryWindowFor("Metro Manila", WED), "Sep 19–22");
eq("province window Wed", deliveryWindowFor("Cebu", WED), "Sep 22–24");
eq("lowercase+spaces NCR", deliveryWindowFor("  metro manila ", WED), "Sep 19–22");
eq("NCR alt name", deliveryWindowFor("National Capital Region", WED), "Sep 19–22");
eq("empty → provincial", deliveryWindowFor("", WED), "Sep 22–24");
eq("cross-month MM", deliveryWindowFor("NCR", new Date("2026-09-28T12:00:00+08:00")), "Oct 1 – Oct 5");

eq("isMetroManila MM", isMetroManila("Metro Manila"), true);
eq("isMetroManila ncr", isMetroManila("NCR"), true);
eq("isMetroManila NCR alt", isMetroManila("National Capital Region"), true);
eq("isMetroManila Cebu", isMetroManila("Cebu"), false);
eq("isMetroManila empty", isMetroManila(""), false);

if (failures > 0) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log("ALL PASS");
```

- [ ] **Step 2: 运行脚本确认失败**

从 backend 目录用现成 tsx（仓库唯一 tsx 源，不新增依赖）：
`cd ../backend && pnpm exec tsx ../frontend/tmp-eta-check.ts`
预期：`FAIL addBusinessDays …` 多条（函数尚不存在）+ `Cannot find name` 之外还应出现引用错误。

- [ ] **Step 3: 升级 deliveryWindow.ts**

保留现有注释、`TIME_ZONE`、`manilaDayParts`、`formatDeliveryRange`、`deliveryWindows()` 导出与签名。新增/替换：

```ts
/** n 个工作日（跳过周日）后的 Date；n=0 返回原日期。 */
export function addBusinessDays(date: Date, n: number): Date {
  const next = new Date(date.getTime());
  let remaining = n;
  while (remaining > 0) {
    next.setDate(next.getDate() + 1);
    if (next.getDay() !== 0) remaining--; // Sunday is not a business day
  }
  return next;
}

const METRO_MANILA_ALIASES = new Set([
  "metro manila",
  "ncr",
  "national capital region",
]);

export function isMetroManila(province: string): boolean {
  const normalized = province.trim().toLowerCase().replace(/\s+/g, " ");
  return METRO_MANILA_ALIASES.has(normalized);
}

/** Province-aware range: Metro Manila 3–5 business days, provinces 5–7. */
export function deliveryWindowFor(province: string, now: Date = new Date()): string {
  return isMetroManila(province)
    ? formatDeliveryRange(now, 3, 5)
    : formatDeliveryRange(now, 5, 7);
}
```

并把 `deliveryWindows()` 的两个分支从 `formatDeliveryRange(now, 3, 5)` / `(now, 5, 7)` 改为 `formatDeliveryRange(addBusinessDays(now, 3), 0, 2)` / `(addBusinessDays(now, 5), 0, 2)`。理由：`deliveryWindows()` 无省份入参，须保持「3–5 / 5–7 工作日」语义且不重复实现算法——用 `addBusinessDays(now, 3)` 起算再加 0–2 天。模块顶部注释更新为工作日（跳过周日）语义，其余注释风格照旧。

- [ ] **Step 4: 运行断言脚本确认全 PASS**

`cd ../backend && pnpm exec tsx ../frontend/tmp-eta-check.ts` → `ALL PASS`。

- [ ] **Step 5: 门禁 + 删除临时脚本**

`cd frontend && npx tsc --noEmit`（0 错）→ `npx eslint src`（0/0）→ `rm ../frontend/tmp-eta-check.ts`（回到仓库根执行 `git status` 确认无残留）。不跑 build（本任务不改任何组件/页面）。

- [ ] **Step 6: 提交**

```bash
git add small-house-commerce/frontend/src/lib/deliveryWindow.ts
git commit -m "feat(eta): business-day delivery windows with NCR detection"
```

---

### Task 2: 抽取共享 checkout 解析（重构，行为零变化）

**Files:**
- Create: `frontend/src/components/checkout/checkoutItems.ts`（纯函数+类型）
- Create: `frontend/src/components/checkout/useCheckoutLines.ts`（client hook）
- Create: `frontend/src/components/checkout/OrderPreview.tsx`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: 现状 CheckoutForm 内部 `PreviewLine`/`PreviewRow`/`requestedIds`/`lines`/`orderItems`/`totals`/`selectedItems` 全部逻辑（:146-235）、`useCart`、`api.getProductBySlug`、`useProductImages`
- Produces: `CheckoutLine`、`parseItemsParam`、`clampQty`、`totalsFor`、`checkoutQueryString`（任务 5 消费）、`useCheckoutLines`（任务 4/5 消费）、`OrderPreview`（任务 4 消费）

- [ ] **Step 1: 建 `checkoutItems.ts`（纯函数）**

把以下逻辑**逐字迁移**（无行为变化）为模块导出：
- `CheckoutLine` 类型（现 `PreviewLine` 同形状，改名导出）
- `parseItemsParam(itemsParam?: string): string[]`（现 :148-155 的 split/trim/filter）
- `clampQty(qty?: string): number`（现 :146：`Math.min(99, Math.max(1, Number(qty) || 1))`）
- `totalsFor`（现 :114-123，含注释「Selling-price subtotal…」）
- 新增 `checkoutQueryString({ skuId, qty, itemsParam, slug }: { skuId?: string; qty?: string; itemsParam?: string; slug?: string }): string`：返回 `?` 开头的查询串，规则——有 `itemsParam` 且非空 → `?items=${itemsParam}`；否则若 `skuId` → 拼 `?skuId=${skuId}`，qty 存在且非 "1" 时追加 `&qty=${qty}`，slug 存在追加 `&slug=${slug}`；全空返回 `""`。（与 checkout/page.tsx 的 searchParams 键名一致。）

- [ ] **Step 2: 建 `useCheckoutLines.ts`（client hook）**

```ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type CartItem, type Product } from "@/lib/api";
import { useCart } from "@/components/cart/CartContext";
import { clampQty, parseItemsParam, totalsFor, type CheckoutLine } from "./checkoutItems";

export interface CheckoutLineInput {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}

export interface CheckoutLines {
  isBuyNow: boolean;
  cartLoading: boolean;
  product: Product | null;
  productError: boolean;
  cartBlocked: boolean;
  buyNowMatchedSku: boolean;
  ready: boolean;
  lines: CheckoutLine[];
  orderItems: { skuId: string; quantity: number }[];
  cartItemIds: string[];
  totals: { subtotal: number; discount: 0; total: number };
  total: number | null;
}

export function useCheckoutLines({ skuId, qty, itemsParam, slug }: CheckoutLineInput): CheckoutLines
```

实现体 = 现 CheckoutForm :146-235 的**逐字迁移**（`buyNowQty`→`clampQty(qty)`、`requestedIds`→`parseItemsParam(itemsParam)`、product fetch effect、`selectedItems`、`lines`、`orderItems`、`totals`、`total`、`cartBlocked`、`buyNowMatchedSku`、`ready`），并新增 `cartItemIds = selectedItems.map((i) => i.itemId)`。`ready` 判定与现状完全一致。

- [ ] **Step 3: 建 `OrderPreview.tsx`**

把现 `PreviewRow`（:51-95，含 `eslint-disable-next-line @next/next/no-img-element` 注释）与 `<ul className="divide-y divide-border">` 列表迁入，导出：

```tsx
"use client";
import Link from "next/link";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import type { CheckoutLine } from "./checkoutItems";

export function OrderPreview({ lines, images }: {
  lines: CheckoutLine[];
  images: ReadonlyMap<string, string | null | undefined>;
})
```
渲染结构 = 现 :429-434 的 `<ul>` + 各行（PreviewRow 原样，`line` 类型改 `CheckoutLine`）。

- [ ] **Step 4: 改 CheckoutForm 消费新模块**

删除局部定义（改由 hook 提供）：`isBuyNow`/`buyNowQty`/`requestedIds`/`selectedItems`/`lines`/`orderItems`/`totals`/`total`/`cartBlocked`/`buyNowMatchedSku`/`ready`/`product`/`productError` 及其对应 useState/useMemo/useEffect（含 product fetch effect）、`totalsFor`、`PreviewLine`/`PreviewRow` 局部类型与组件；`useCart` 解构改为只保留需要者。改为：

```tsx
const checkout = useCheckoutLines({ skuId, qty, itemsParam, slug });
const { isBuyNow, cartLoading, product, productError, cartBlocked, ready, lines, orderItems, total } = checkout;
```
（其余解构按需。）`useCart` 的 `cart`/`cartLoading` 若不再被直接引用则一并移除（hook 内部已用）；`api` import 若只剩 product fetch 使用（已入 hook）则移除——`npx eslint src` 会以 unused 拦截，Step 5 门禁兜底。加载门禁 `:321-323` 改为 `if (!isBuyNow && cartLoading)`（`cartLoading` 来自 hook）。`:429-434` 的 `<ul>` 替换为 `<OrderPreview lines={lines} images={images} />`。其余 JSX（含 `PreviewRow` 旧引用、`:306` 的 `selectedItems.map(...)` 改为 `checkout.cartItemIds.map(...)`、`:239-246` 的 InitiateCheckout effect、`:212` 的 `total` 引用）全部改由 `checkout.*` 提供，**渲染结果必须与现状逐字节一致**。InitiateCheckout effect **保留在本组件**（确认页不得重复触发）。

- [ ] **Step 5: 门禁 + build + 冒烟**

`cd frontend && npx tsc --noEmit`（0 错）→ `npx eslint src`（0/0）→ `npm run build`（通过，22+ 页）。
冒烟（若 dev 未起，按任务 6 Step 1 的启动命令起 :3003/:3004）：购物车勾选结账与 PDP Buy Now 两条链路页面渲染与之前一致（商品清单/金额/COD 卡/按钮文案不变）。

- [ ] **Step 6: 提交**

```bash
git add small-house-commerce/frontend/src/components/checkout/checkoutItems.ts small-house-commerce/frontend/src/components/checkout/useCheckoutLines.ts small-house-commerce/frontend/src/components/checkout/OrderPreview.tsx small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "refactor(checkout): extract shared line derivation and order preview"
```

---

### Task 3: CheckoutTrustStrip + 表单页 ETA/隐私接入

**Files:**
- Create: `frontend/src/components/checkout/CheckoutTrustStrip.tsx`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: `deliveryWindowFor`（任务 1）、`useSiteSettings()`（A 批，现成）
- Produces: `CheckoutTrustStrip({ deliveryRange: string })`（任务 4 复用）

- [ ] **Step 1: 建 `CheckoutTrustStrip.tsx`**

```tsx
"use client";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

// 24x24 viewBox 内联 SVG，stroke=currentColor，风格同 PdpClient 货车 glyph。
const icons = {
  banknote: (
    <path d="M3 7h18v10H3z M6 9v1 M18 14v1 M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M15 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  ),
  calendar: (
    <path d="M4 5h16v16H4z M4 9h16 M8 3v4 M16 3v4" />
  ),
  bubble: (
    <path d="M4 5h16v11H11l-4 4v-4H4z" />
  ),
  shield: (
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4" />
  ),
} as const;

interface TrustItem { icon: keyof typeof icons; label: string }
const TRUST_ITEMS: TrustItem[] = [
  { icon: "banknote", label: "COD & Free Shipping" },
  { icon: "calendar", label: "Estimated delivery {range}" },
  { icon: "bubble", label: "Support {hours}" },
  { icon: "shield", label: "Inspect at delivery · 48h exchange for defects" },
];

export function CheckoutTrustStrip({ deliveryRange }: { deliveryRange: string }) {
  const { supportHours } = useSiteSettings();
  return (
    <ul
      data-testid="checkout-trust-strip"
      className="flex flex-col gap-3 text-xs text-ink-secondary sm:flex-row sm:flex-wrap sm:gap-x-6"
    >
      {TRUST_ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-cta" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icons[item.icon]}
          </svg>
          <span>
            {item.label === "Estimated delivery {range}"
              ? `Estimated delivery ${deliveryRange}`
              : item.label === "Support {hours}"
                ? `Support ${supportHours}`
                : item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
```
（四项最终文案与 spec §3.2 逐字一致；图标 path 用上列即可，也可换成同风格等价的 stroke path——语义须匹配：钱/日历/气泡/盾。）

- [ ] **Step 2: COD 卡接入动态 ETA**

CheckoutForm :578-581 第二段 `<p>` 改为：

```tsx
<p className="mt-1">
  Pay in cash when your order arrives.{" "}
  {form.province.trim()
    ? `Estimated delivery: ${deliveryWindowFor(form.province)}`
    : "Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days."}
</p>
```
卡标题 `Cash on Delivery` 与第一句逐字不动。文件顶部新增 `import { deliveryWindowFor } from "@/lib/deliveryWindow";`。仅此一处授权文案替换。

- [ ] **Step 3: 表单页接入保障条 + 隐私行**

保障条：`:576` 的 COD 卡 `<div>` 之前插入：
```tsx
<CheckoutTrustStrip
  deliveryRange={
    form.province.trim()
      ? deliveryWindowFor(form.province)
      : "Metro Manila 3-5 days · provinces 5-7 days"
  }
/>
```
隐私行：`:541`（Landmark label）之后、`:542` 网格结束 `</div>` 之前插入：
```tsx
<p data-testid="checkout-privacy-note" className="mt-3 text-xs text-ink-secondary">
  Your information is used only to process and deliver your order.
</p>
```

- [ ] **Step 4: 门禁 + build**

`cd frontend && npx tsc --noEmit`（0 错）→ `npx eslint src`（0/0）→ `npm run build`（通过）。

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/components/checkout/CheckoutTrustStrip.tsx small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "feat(checkout): trust strip, province-aware ETA dates, privacy note"
```

---

### Task 4: /checkout/confirm 路由 + CheckoutConfirmView

**Files:**
- Create: `frontend/src/app/(storefront)/checkout/confirm/page.tsx`
- Create: `frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Create: `frontend/src/lib/checkoutDraft.ts`

**Interfaces:**
- Consumes: `useCheckoutLines`/`OrderPreview`/`checkoutQueryString`（任务 2）、`CheckoutTrustStrip`（任务 3）、`deliveryWindowFor`（任务 1）、`useSiteSettings`、`api.createOrder`、`readAttribution`、`useProductImages`、`useCart`
- Produces: `CheckoutConfirmView`（任务 5 接线后可达；本任务内：无草稿时重定向即验收入口）

- [ ] **Step 1: 建 `checkoutDraft.ts`（纯存储）**

```ts
export interface CheckoutDraftCustomer {
  name: string; phone: string; province: string; city: string;
  barangay: string; postalCode: string; streetAddress: string; landmark: string;
}
export interface CheckoutDraft { customer: CheckoutDraftCustomer; savedAt: string }
const DRAFT_KEY = "luwag_checkout_draft";

export function readCheckoutDraft(): CheckoutDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutDraft;
    if (!parsed || typeof parsed.customer !== "object") return null;
    return parsed;
  } catch { return null; }
}
export function writeCheckoutDraft(customer: CheckoutDraftCustomer): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, savedAt: new Date().toISOString() }));
  } catch { /* memory fallback: flow degrades per spec §5.3 */ }
}
export function clearCheckoutDraft(): void {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
```
（try/catch 容错风格同 A 批 `readNudgeDismissed`。）

- [ ] **Step 2: 建路由页**

`frontend/src/app/(storefront)/checkout/confirm/page.tsx`：
```tsx
import type { Metadata } from "next";
import { CheckoutConfirmView } from "@/components/checkout/CheckoutConfirmView";

export const metadata: Metadata = { title: "Confirm Your Order" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ skuId?: string; qty?: string; items?: string; slug?: string }>;
}) {
  const { skuId, qty, items, slug } = await searchParams;
  return <CheckoutConfirmView skuId={skuId} qty={qty} itemsParam={items} slug={slug} />;
}
```

- [ ] **Step 3: 建 `CheckoutConfirmView.tsx`**

`"use client"`。结构（自上而下，spec §3.4）：
1. `const router = useRouter();` `const checkout = useCheckoutLines({ skuId, qty, itemsParam, slug });` `const { cart, removeItems } = useCart();` `const { messengerUrl, supportEmail, supportHours } = useSiteSettings();` `const images = useProductImages(checkout.lines.map((l) => l.slug));` `const [submitting, setSubmitting] = useState(false);` `const [error, setError] = useState<string | null>(null);` `const [draft, setDraft] = useState<CheckoutDraft | null>(null);`
2. mount effect（一次性）：
```tsx
useEffect(() => {
  const d = readCheckoutDraft();
  if (!d || Object.keys(validateCheckoutForm(d.customer)).length > 0) {
    router.replace(`/checkout${checkoutQueryString({ skuId, qty, itemsParam, slug })}`);
    return;
  }
  setDraft(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```
（`validateCheckoutForm` 从 `@/lib/checkoutValidation` 引入；`draft.customer` 与表单 state 同形状。）
3. `draft === null` 且未跳转时渲染最小占位（`<p className="py-16 text-center text-ink-secondary">Loading…</p>`）——重定向是 replace，用户看不到。
4. `async function placeOrder()`（spec §3.4 第 7 项，逻辑同原 CheckoutForm :270-319 的提交段，但 customer 取自 `draft.customer` 且**不再校验/聚焦**；**空可选字段转 null**——与后端 DTO 兼容，同原提交行为）：
```tsx
setError(null); setSubmitting(true);
try {
  const order = await api.createOrder({
    customer: {
      name: draft.customer.name,
      phone: draft.customer.phone,
      province: draft.customer.province,
      city: draft.customer.city,
      barangay: draft.customer.barangay || null,
      postalCode: draft.customer.postalCode || null,
      streetAddress: draft.customer.streetAddress,
      landmark: draft.customer.landmark || null,
    },
    items: checkout.orderItems,
    attribution: readAttribution(),
  });
  if (!checkout.isBuyNow) await removeItems(checkout.cartItemIds);
  if (checkout.total !== null) sessionStorage.setItem("lastOrderTotal", String(checkout.total));
  clearCheckoutDraft();
  router.push(`/order-success/${order.orderNumber}`);
} catch (e) {
  setError(e instanceof Error ? e.message : "Could not place your order. Please try again.");
  setSubmitting(false);
}
```
5. 渲染（`mx-auto max-w-[1200px] px-4 py-8 sm:px-6`，布局风格与表单页一致，grid 可简化）：
   - `<h1 className="text-3xl font-semibold text-ink">Confirm your order</h1>`
   - `CheckoutTrustStrip deliveryRange={deliveryWindowFor(draft.customer.province)}`（`data-testid` 自带）
   - 商品清单卡：标题 `Your Order` + `<Link href="/cart">Edit</Link>`（右侧小字）→ 内嵌 `OrderPreview lines={checkout.lines} images={images}`；`data-testid="confirm-items"` 挂在卡容器。
   - 配送地址卡（`data-testid="confirm-address"`）：标题 `Delivery Address` + `<Link href={/checkout${checkoutQueryString({ skuId, qty, itemsParam, slug })}}>Edit</Link>`；地址块按序：
     ```
     {draft.customer.name} · {draft.customer.phone}
     {draft.customer.streetAddress}
     {[draft.customer.barangay, draft.customer.city].filter(Boolean).join(", ")}
     {draft.customer.province}{draft.customer.postalCode ? ` ${draft.customer.postalCode}` : ""}
     {draft.customer.landmark ? `Landmark: ${draft.customer.landmark}` : ""}
     ```
     （空行跳过；`text-sm text-ink-secondary`。）
   - 支付与合计卡：逐字 `Cash on Delivery · No payment needed now`、`COD — calculated at checkout`、`Total (COD)`（金额：`checkout.total !== null ? formatPrice(checkout.total) : "Calculated at checkout"`；Buy Now 未解析时同表单页逻辑）。
   - Need help 块：`data-testid="checkout-need-help"` 逐字复用表单页 :393-416 的 JSX（含 messengerUrl 条件、mailto supportEmail、supportHours）。
   - 隐私行：`data-testid="checkout-privacy-note"` 同文案同样式。
   - 错误框：`:588-590` 同款 `role="alert"`。
   - 主按钮：`<Button onClick={placeOrder} disabled={submitting} className="w-full" data-testid="confirm-place-order">{submitting ? "Placing order…" : "PLACE COD ORDER"}</Button>`；按钮下方 `Cash on Delivery · No payment needed now`（同 :596-598）。
6. 所有文案逐字取自 spec；不新增任何 track() 调用（InitiateCheckout 只在表单页）。

- [ ] **Step 4: 门禁 + build + 无草稿重定向验证**

`cd frontend && npx tsc --noEmit`（0 错）→ `npx eslint src`（0/0）→ `npm run build`（通过）。
浏览器（:3003/:3004 按任务 6 Step 1 启动）：新标签直达 `/checkout/confirm?items=…`（items 用购物车里真实 itemId 或任意串）→ 立即重定向到 `/checkout?items=…`（无 404、无报错）。再用 `evaluate_script` 种入合法草稿后访问 → 确认页渲染（标题/地址/按钮/保障条四项可见，`PLACE COD ORDER` 文案在位）。测后清理草稿。

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/lib/checkoutDraft.ts small-house-commerce/frontend/src/app/\(storefront\)/checkout/confirm/page.tsx small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.tsx
git commit -m "feat(checkout): confirm-your-order review route with session draft"
```

---

### Task 5: 表单页 REVIEW ORDER 接线

**Files:**
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: `writeCheckoutDraft`/`readCheckoutDraft`/`checkoutQueryString`（任务 2/4）、现有 `validateCheckoutForm`/`CHECKOUT_FIELD_ORDER`/`FIELD_ELEMENT_ID`
- Produces: 完整两步链路（表单 → 确认 → 下单）

- [ ] **Step 1: 删除表单页下单逻辑**

删除 `placeOrder`（:270-319 整个函数，T2 后仍在）及不再使用的 `submitting`、`error`、`setError` state（:131-132）；`api`/`useCart`/`readAttribution`/`track` 相关引用若已无使用者则随删除清理（eslint unused 兜底）。删除 `:593-598` 提交区 JSX 的按钮，替换为：

```tsx
<Button
  onClick={goToReview}
  className="w-full"
  data-testid="review-order"
>
  REVIEW ORDER
</Button>
<p className="mt-2 text-center text-xs text-ink-muted">
  Cash on Delivery · No payment needed now
</p>
```
错误框 `:587-591` 一并删除（表单页不再有提交错误；校验错误仍走字段级 `errors`）。删除 `:309` 的 `sessionStorage.setItem("lastOrderTotal", …)`（迁移到确认页）。

- [ ] **Step 2: 新增 goToReview + 草稿回填**

文件内新增（替换原 placeOrder 位置）：

```tsx
function goToReview() {
  const validation = validateCheckoutForm(form);
  setErrors(validation);
  if (Object.keys(validation).length > 0) {
    const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
    const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
    if (focusId) document.getElementById(focusId)?.focus();
    return;
  }
  if (orderItems.length === 0) return; // ready 门禁已挡住，双保险
  writeCheckoutDraft({
    name: form.name.trim(),
    phone: form.phone.trim(),
    province: form.province.trim(),
    city: form.city.trim(),
    barangay: form.barangay.trim() || "",
    postalCode: form.postalCode.trim() || "",
    streetAddress: form.streetAddress.trim(),
    landmark: form.landmark.trim() || "",
  });
  router.push(`/checkout/confirm${checkoutQueryString({ skuId, qty, itemsParam, slug })}`);
}
```

mount 回填（表单页首个 effect，放 product fetch effect 之前）：

```tsx
useEffect(() => {
  const d = readCheckoutDraft();
  if (d) {
    setForm((f) => ({ ...f, ...d.customer }));
  }
}, []);
```

imports：`writeCheckoutDraft`、`readCheckoutDraft`（`@/lib/checkoutDraft`）、`checkoutQueryString`（`./checkoutItems`）。

- [ ] **Step 3: 门禁 + build + 端到端冒烟**

`cd frontend && npx tsc --noEmit`（0 错）→ `npx eslint src`（0/0）→ `npm run build`（通过）。
浏览器（:3003/:3004）：购物车勾选 → 填合法表单 → `REVIEW ORDER` → 确认页地址/商品/合计正确 → `PLACE COD ORDER` → `/order-success/PH…`、草稿已清、购物车行已删。空表单点 `REVIEW ORDER` → 字段错误、不跳转、无草稿。

- [ ] **Step 4: 提交**

```bash
git add small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "feat(checkout): review-order step writes draft and routes to confirm"
```

---

### Task 6: 浏览器验收 + 回归 + 收尾

**Files:** 无代码改动（仅报告与通知）。

- [ ] **Step 1: 启动测试环境**

后端：`cd backend && PORT=3004 pnpm start:dev`（日志 /tmp/luwag-3004.log，bg）。前端：`cd frontend && API_TARGET=http://localhost:3004 PORT=3003 npm run dev`（bg）。确认 :3003 返回页面、:3004 的 `/api/v1/storefront/settings` 可访问（messenger 默认空、supportHours `Mon–Sat, 9am–6pm (PHT)`）。

- [ ] **Step 2: 全量验收（spec §5.2，Playwright 逐项）**

1. ETA 工作日规则（Metro Manila → 今日+3/+5 工作日区间，跳过周日；Cebu → +5/+7；清空 → 回退冻结句）
2. NCR 匹配（`metro manila`/空格/`National Capital Region` 命中；`Cebu` 走省区）
3. 保障条四项文案；管理员改 supportHours 后硬刷新第 3 项更新
4. 空表单 REVIEW ORDER → 错误不跳转无草稿；合法 → 跳确认页、草稿值正确
5. 确认页：清单/地址/合计/ETA/保障条/隐私/Need help 齐全；下单成功 → order-success、购物车行删、draft 清
6. Edit 回链 → 表单回填；改省再 REVIEW → 确认页更新
7. 无草稿直访确认页 → 重定向
8. Buy Now 全链路
9. 浏览器返回不丢数据
10. Discount 行不渲染（表单页+确认页多金额组）
11. PDP 信任条按新规则渲染（产品页+落地页）
12. 冻结文案 grep 核对（§2 清单逐串在 DOM）
13. console 0 errors/warnings；测试订单记录交控制器清理

- [ ] **Step 3: 冻结文案与约束 grep（脚本级）**

`grep -rn "PLACE COD ORDER\|COD — calculated at checkout\|Total (COD)\|No payment needed now\|Pay in cash when your order arrives" frontend/src` 只应命中：表单页/确认页的授权位置 + CartDrawer 原样 + 无其他漂移。`grep -rn "track("` 确认无新增调用点（InitiateCheckout 仅表单页）。

- [ ] **Step 4: 通知线 A + 台账**

向 home-pdp-6e 会话发送消息：`deliveryWindow.ts` 数值语义改为工作日（跳过周日），`DeliveryWindows` 类型与组件零改动；若线 A 有未提交改动冲突请协商。把本计划验收结果写入 `.superpowers/sdd/2026-09-16-checkout-experience/progress.md`（sdd-workspace 脚本生成）。

- [ ] **Step 5: 汇报**

返回：每项场景 PASS/FAIL + 门禁结果 + 测试订单号（若有，交控制器清理）+ 线 A 通知已发。
