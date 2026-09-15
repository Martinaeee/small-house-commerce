# 线 B 阶段 1：Checkout P0 + 类目页增强 + 统一徽章 + 加购抽屉（纯前端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不动后端、不加依赖，交付 checkout P0 修补、类目页 SEO/错误态/子类图卡/URL 筛选、集合成员统一徽章、全站加购右侧抽屉。

**Architecture:** 全部改动落在线 B 前端（Next.js App Router，客户端 islands + 服务端类目页）。纯逻辑放 `lib/`（手机校验、URL 参数解析、徽章映射、JSON-LD 构建、推荐 hook），展示组件保持薄；抽屉由 CartContext 单一事实源驱动，`addItem` 成功即开，PDP/类目卡零行为改动。

**Tech Stack:** Next.js 16.3.4（App Router / RSC / `useSearchParams` 须 Suspense）、React 19、TypeScript、Tailwind CSS v4 设计 token；无前端测试框架（零新依赖，见全局约束）。

**Spec:** [../specs/2026-09-15-checkout-plp-cart-drawer-design.md](../specs/2026-09-15-checkout-plp-cart-drawer-design.md)（§4 阶段 1 是本计划的唯一范围；§5 阶段 2 后端 migration 另写计划）

## Global Constraints

- **零新 npm 依赖**；只用既有 Tailwind 设计 token（`cta/cta-hover/ink/ink-secondary/ink-muted/card/border/primary/primary-dark/background`，`sale` 色是既有全站例外）。
- 价格只显示 PHP，统一用 `formatPrice`（`components/ui/PriceBox.tsx`）。
- **COD 与配送既有文案一字不改**：包括 checkout 的 `"COD — calculated at checkout"`、`"Pay in cash when your order arrives. Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days."`、`"Cash on Delivery · No payment needed now"`；新文案仅限本计划明确列出的字符串。
- Meta Pixel 四事件（ViewContent/AddToCart/InitiateCheckout/Purchase）触发点不得断；抽屉本身**不打**任何 Pixel 事件。
- 前端没有测试框架且禁止新增依赖：每个任务的自动验证 = `npx tsc --noEmit` + `npx eslint <改动文件>`；任务 7、13 后跑 `npm run build`（`useSearchParams` 的 Suspense 要求只在 build 暴露）；行为验收统一在任务 14 用浏览器手测。
- dev 环境：`cd small-house-commerce/frontend && PORT=3003 npm run dev`，走 next rewrite 代理用户的后端 3000。**绝不重启用户的 3000 后端 / 3001 前端**。
- 提交只在 `feat/checkout-category` 分支；`git add <显式路径>`，禁止 `git add -A`；每个任务结束即提交。
- 共享/线 A 文件（`lib/api.ts`、`components/product/PlpProductCard.tsx`、`app/(storefront)/layout.tsx`）只做任务内注明的最小增量改动，动之前完成任务 8 开头的通报步骤。
- Next 16 API 行为有疑义先查 `frontend/node_modules/next/dist/docs/01-app/`，不凭记忆。

## File Structure

新建（全部线 B 独占）：

| 文件 | 职责 |
|---|---|
| `frontend/src/lib/checkoutValidation.ts` | 纯函数：菲律宾手机号校验 + checkout 必填校验，返回字段错误 map |
| `frontend/src/lib/category-jsonld.ts` | 纯函数：构建类目页 BreadcrumbList / CollectionPage / ItemList 三段 JSON-LD |
| `frontend/src/lib/plpUrl.ts` | 纯函数：PLP 筛选/排序 ↔ URL query 双向解析（非法值回退默认） |
| `frontend/src/lib/plpBadges.ts` | 纯函数 + 类型：集合成员 → 商品 slug → 最多两枚徽章的映射与优先级 |
| `frontend/src/lib/useCartRecommendations.ts` | hook：购物车推荐数据池 + 排序（从 CartRecommendations 抽出），导出现成辅助函数 |
| `frontend/src/components/cart/CartDrawer.tsx` | 右侧加购抽屉：遮罩/a11y/服务条/商品行/推荐/结算区 |

修改：

| 文件 | 归属 | 改动概述 |
|---|---|---|
| `frontend/src/components/checkout/CheckoutForm.tsx` | 线 B | C1 手机校验、C4 字段错误、C2 移动 DOM 顺序、C3 Buy Now 独立错误/加载态 |
| `frontend/src/app/(storefront)/categories/[slug]/page.tsx` | 线 B | JSON-LD 注入、首屏失败区分、root 子类图卡、Suspense 包裹 |
| `frontend/src/components/category/CategoryPlpClient.tsx` | 线 B | URL 状态、错误态、徽章集合动态拉取、Suspense 包装导出 |
| `frontend/src/components/product/PlpProductCard.tsx` | **线 A 拥有** | badge prop 结构化（最多两枚），通报后改 |
| `frontend/src/components/cart/CartContext.tsx` | 线 B | `isOpen/openCart/closeCart`，`addItem` 成功自动开抽屉 |
| `frontend/src/components/cart/CartRecommendations.tsx` | 线 B | 删除内联数据逻辑，改用 `useCartRecommendations`，展示不变 |
| `frontend/src/lib/api.ts` | **共享** | `Collection` 接口加可选 `badgeLabel?: string \| null`（只加不改） |
| `frontend/src/app/(storefront)/layout.tsx` | **共享** | 只加两行：import + `<CartDrawer />` |

任务依赖顺序：1→2→3（checkout）；4→5→6→7（PLP）；8→9（徽章，8 先通报）；10→11→12→13（抽屉）。两条链互不阻塞，但提交顺序按编号。

---

### Task 1: Checkout 手机号校验 + 字段级错误（C1/C4）

**Files:**
- Create: `frontend/src/lib/checkoutValidation.ts`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`（import、state、placeOrder、5 个必填输入）

**Interfaces:**
- Produces:
  - `isValidPhilippineMobile(raw: string): boolean`
  - `validateCheckoutForm(values: CheckoutFormValues): CheckoutErrors`
  - 类型 `CheckoutFormValues`、`CheckoutField`、`CheckoutErrors`；常量 `PHONE_ERROR = "Please enter a valid Philippine mobile number."`、`CHECKOUT_FIELD_ORDER: CheckoutField[]`
- Consumes: 后端规则源 `backend/src/common/phone.util.ts`（只读核对，不改）：接受 11 位 `0…` 与 12 位 `63…`；前端按 spec §4.1 取菲律宾手机子集 `09XXXXXXXXX` / `639XXXXXXXXX`（带不带 `+` 都行，靠 `replace(/\D/g,"")` 归一）。

- [ ] **Step 1: 建纯函数文件**

创建 `frontend/src/lib/checkoutValidation.ts`：

```ts
/**
 * Client-side checkout validation (spec §4.1 C1/C4). The phone rule is the
 * Philippine-mobile subset of backend common/phone.util.ts: 09XXXXXXXXX
 * (11 digits) or 639XXXXXXXXX (12 digits, leading "+" optional).
 */

export interface CheckoutFormValues {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
}

export type CheckoutField = keyof CheckoutFormValues;
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

/** Spec-mandated wording — do not rephrase. */
export const PHONE_ERROR = "Please enter a valid Philippine mobile number.";

/** Focus order when the submit finds several invalid fields. */
export const CHECKOUT_FIELD_ORDER: CheckoutField[] = [
  "name",
  "phone",
  "province",
  "city",
  "streetAddress",
];

const REQUIRED_FIELDS: { field: CheckoutField; label: string }[] = [
  { field: "name", label: "name" },
  { field: "phone", label: "mobile number" },
  { field: "province", label: "province" },
  { field: "city", label: "city" },
  { field: "streetAddress", label: "full address" },
];

export function isValidPhilippineMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits.startsWith("09");
  if (digits.length === 12) return digits.startsWith("639");
  return false;
}

/** Validates the five required fields; barangay/postalCode/landmark stay optional. */
export function validateCheckoutForm(values: CheckoutFormValues): CheckoutErrors {
  const errors: CheckoutErrors = {};
  for (const { field, label } of REQUIRED_FIELDS) {
    if (!values[field].trim()) {
      errors[field] = `Please enter your ${label}.`;
    }
  }
  if (!errors.phone && !isValidPhilippineMobile(values.phone)) {
    errors.phone = PHONE_ERROR;
  }
  return errors;
}
```

- [ ] **Step 2: CheckoutForm 引入校验状态与辅助函数**

在 `CheckoutForm.tsx` 顶部 import 区（`import { readAttribution, track } ...` 之后）加：

```ts
import {
  CHECKOUT_FIELD_ORDER,
  PHONE_ERROR,
  validateCheckoutForm,
  type CheckoutField,
} from "@/lib/checkoutValidation";
```

在现有 `const [error, setError] = useState<string | null>(null);` 之后加：

```ts
const [errors, setErrors] = useState<Partial<Record<CheckoutField, string>>>({});
```

把现有 `set` 工厂替换为（改动时顺手清掉该字段错误）：

```ts
const set =
  (field: CheckoutField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  // Re-validate one field on blur so a corrected-but-still-bad value gets
  // flagged before submit.
const revalidate = (field: CheckoutField) => () =>
  setErrors((current) => {
    const fresh = validateCheckoutForm(form);
    const next = { ...current };
    if (fresh[field]) next[field] = fresh[field];
    else delete next[field];
    return next;
  });
```

在文件顶层（`PreviewRow` 旁）加错误展示小组件：

```tsx
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sale">
      {message}
    </p>
  );
}
```

- [ ] **Step 3: 替换 placeOrder 的必填判断**

删除现有的：

```ts
if (!form.name.trim() || !form.phone.trim() || !form.province.trim() ||
    !form.city.trim() || !form.streetAddress.trim()) {
  setError("Please fill in your name, phone, province, city and full address.");
  return;
}
```

替换为：

```ts
const validation = validateCheckoutForm(form);
setErrors(validation);
if (Object.keys(validation).length > 0) {
  const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
  if (firstInvalid) document.getElementById(`checkout-${firstInvalid}`)?.focus();
  return;
}
```

`if (orderItems.length === 0) { setError("No items to check out."); return; }` 保留在其后；顶部 `setError(null)` 保留。

- [ ] **Step 4: 给五个必填输入接入错误 UI**

五个字段统一处理（id 见下表），对每个 `<input>`：
1. 加 `id={`checkout-<suffix>`}`；
2. className 改为 `className={`${inputCls}${errors[field] ? " border-sale" : ""}`}`（phone 输入原来没有动态 class，照样套）；
3. 加 `onBlur={revalidate("<field>")}`、`aria-invalid={Boolean(errors.<field>)}`、`aria-describedby={errors.<field> ? "checkout-<suffix>-error" : undefined}`；
4. 在该 `</label>` 之前插入 `<FieldError id="checkout-<suffix>" message={errors.<field>} />`。

| 字段表达式 | suffix | 定位锚点（现有 input 独有特征） |
|---|---|---|
| `form.name` / `set("name")` | `name` | `placeholder="Juan Dela Cruz"` |
| `form.phone` / `set("phone")` | `phone` | `placeholder="0917 123 4567"` |
| `form.province` / `set("province")` | `province` | `placeholder="Metro Manila"` |
| `form.city` / `set("city")` | `city` | 同 label 内含 `value={form.city}` |
| `form.streetAddress` / `set("streetAddress")` | `address` | `placeholder="House no., street, subdivision"` |

注意 streetAddress 的 suffix 是 `address`（id `checkout-address`），字段名仍是 `streetAddress`。phone 的 `<FieldError>` 放在现有帮助文案 `"We use your mobile number for delivery updates."` 那一行之前；空值与格式错误共用同一位置，文案由 `validateCheckoutForm` 决定（空 → `"Please enter your mobile number."`，格式错 → `PHONE_ERROR`）。barangay/postalCode/landmark 不加校验。

`PHONE_ERROR` 在本文件被 import 但只在校验函数内使用——若 tsc 报未使用，删掉这一项 import（它是给未来阶段 2 对齐后端文案预留的，本任务不强求保留）。

- [ ] **Step 5: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/lib/checkoutValidation.ts src/components/checkout/CheckoutForm.tsx
```

Expected: 无错误、无新增 eslint warning。

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/lib/checkoutValidation.ts small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "fix(checkout): PH mobile validation and field-level errors (C1/C4)"
```

---

### Task 2: Checkout 移动端模块顺序（C2）

**Files:**
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`（仅 `return` 布局重排，约 302–437 行；不碰 placeOrder、像素事件、任何卡片内文案）

**Interfaces:**
- Consumes: Task 1 的字段错误 UI（Contact/Address 两张卡内部原样保留）。
- Produces: DOM 顺序 = 订单预览 → 联系信息 → 地址 → 摘要(含 COD 卡) → 下单按钮；lg 断点视觉保持"左 2 列预览+摘要 / 右 3 列表单+CTA"。

- [ ] **Step 1: 用五区块 grid 重写主 return 的内层布局**

`<h1>Checkout</h1>` 与最外层 `<div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">` 不动。把内层 `<div className="grid grid-cols-1 gap-8 lg:grid-cols-5">…</div>`（含现有 `<aside>` 与表单列）整体替换为下面的五区块结构。两张 `<section>`（Contact Information、Delivery Address）的内部 JSX **从现文件原样剪切**，错误 alert / Button / 小字注脚移动到第五区块；除容器外不得改动任何字符串：

```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
  {/* 1. Order preview (mobile first; desktop left column, row 1) */}
  <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1">
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-1 text-lg font-semibold text-ink">Your Order</h2>
      {isBuyNow && product === null && !productError ? (
        <p className="py-2 text-sm text-ink-muted">Loading item…</p>
      ) : lines.length === 0 ? (
        <p className="py-2 text-sm text-ink-muted">Item details unavailable.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <PreviewRow key={line.key} line={line} imageUrl={images.get(line.slug)} />
          ))}
        </ul>
      )}
    </div>
  </div>

  {/* 2. Contact information — existing <section> card moved here verbatim */}
  <div className="lg:col-start-3 lg:col-span-3 lg:row-start-1">
    {/* 现有的 Contact Information <section>（含 Task 1 的 FieldError）原样放入 */}
  </div>

  {/* 3. Delivery address — existing <section> card moved here verbatim */}
  <div className="lg:col-start-3 lg:col-span-3 lg:row-start-2">
    {/* 现有的 Delivery Address <section> 原样放入 */}
  </div>

  {/* 4. Totals + COD assurance (desktop left column, row 2) */}
  <div className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2 lg:row-start-2">
    <div className="rounded-lg border border-border bg-card p-5">
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Subtotal</dt>
          <dd className="font-medium text-ink">
            {isBuyNow && total === null
              ? "Calculated at checkout"
              : formatPrice(totals.subtotal)}
          </dd>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Discount</dt>
            <dd className="font-medium text-sale">−{formatPrice(totals.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Shipping</dt>
          <dd className="font-medium text-ink">COD — calculated at checkout</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-base">
          <dt className="font-semibold text-ink">Total (COD)</dt>
          <dd className="font-bold text-ink">
            {total !== null ? formatPrice(total) : "Calculated at checkout"}
          </dd>
        </div>
      </dl>
    </div>

    <div className="rounded-lg border border-border bg-card p-5 text-sm text-ink-secondary">
      <p className="font-semibold text-ink">Cash on Delivery</p>
      <p className="mt-1">
        Pay in cash when your order arrives. Estimated delivery:
        Metro Manila 3-5 days, provinces 5-7 days.
      </p>
    </div>
  </div>

  {/* 5. Submit error + CTA (mobile bottom; desktop right column, row 3) */}
  <div className="lg:col-start-3 lg:col-span-3 lg:row-start-3">
    {error && (
      <p role="alert" className="mb-3 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale">
        {error}
      </p>
    )}

    <Button onClick={placeOrder} disabled={submitting} className="w-full" data-testid="place-order">
      {submitting ? "Placing order…" : "PLACE COD ORDER"}
    </Button>
    <p className="mt-2 text-center text-xs text-ink-muted">
      Cash on Delivery · No payment needed now
    </p>
  </div>
</div>
```

要点：旧 `<aside className="order-2 … lg:order-1 lg:col-span-2">` 与旧表单列 `order-1 lg:order-2 lg:col-span-3` 删除；grid 靠 `lg:col-start/row-start` 定位，移动端按 DOM 自然流。旧的预览卡里 `<dl>` 整块移到区块 4（预览卡只留商品清单）。

- [ ] **Step 2: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/components/checkout/CheckoutForm.tsx
```

Expected: 无错误。检查 grep 确认四句冻结文案仍各出现一次：

```bash
grep -c "COD — calculated at checkout" src/components/checkout/CheckoutForm.tsx   # 1
grep -c "Metro Manila 3-5 days, provinces 5-7 days." src/components/checkout/CheckoutForm.tsx  # 1
grep -c "Cash on Delivery · No payment needed now" src/components/checkout/CheckoutForm.tsx   # 1
```

- [ ] **Step 3: Commit**

```bash
git add small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "fix(checkout): mobile section order preview→contact→address→summary→CTA (C2)"
```

---

### Task 3: Buy Now 解析失败阻断 + 独立错误态（C3）

**Files:**
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Produces: Buy Now 路径三种互斥屏：解析中（整屏 Loading item…）、失败（错误卡 + 两个链接）、可下单（现有表单）。购物车路径行为不变。

- [ ] **Step 1: 收紧 ready 判定**

把现有的：

```ts
const ready = isBuyNow
  ? Boolean(skuId)
  : !cartLoading && !cartBlocked && orderItems.length > 0;
```

替换为：

```ts
// Buy Now is only submittable once the product resolved AND the requested
// skuId exists on one of its variants. A hand-edited ?skuId is a dead end.
const buyNowMatchedSku =
  !isBuyNow || (product !== null && product.variants.some((v) => v.sku?.id === skuId));

const ready = isBuyNow
  ? product !== null && !productError && buyNowMatchedSku
  : !cartLoading && !cartBlocked && orderItems.length > 0;
```

- [ ] **Step 2: 在 cartBlocked 早返回之后、`if (!ready)` 之前插入两个早返回**

```tsx
if (isBuyNow && product === null && !productError) {
  return <p className="py-16 text-center text-ink-secondary">Loading item…</p>;
}

if (isBuyNow && (productError || (product !== null && !buyNowMatchedSku))) {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sale/10">
        <svg viewBox="0 0 20 20" className="h-6 w-6 text-sale" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="mb-3 text-2xl font-semibold text-ink">We couldn&apos;t load this item.</h1>
      <p className="mb-6 text-ink-secondary">
        The product may be unavailable or the link was incomplete. You can go back to the
        product page or continue shopping.
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        {slug && (
          <Link
            href={`/products/${slug}`}
            className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
          >
            Back to product
          </Link>
        )}
        <Link href="/collections" className="text-sm text-cta hover:underline">
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
```

说明：区块 1 预览卡里的 `"Loading item…"` / `"Item details unavailable."` 分支保留（正常流程中这两个早返回使它们几乎不可见，但不删除，防御性渲染不变）。`InitiateCheckout` effect 依赖 `orderItems`，sku 不命中时 `orderItems` 仍含 `[{skuId, qty}]`——给该 effect 加条件：把 effect 内首行改为 `if (orderItems.length === 0 || (isBuyNow && !buyNowMatchedSku)) return;`，避免坏 URL 发事件。

- [ ] **Step 3: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/components/checkout/CheckoutForm.tsx
```

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx
git commit -m "fix(checkout): block submit and show error state for broken Buy Now URL (C3)"
```

---

### Task 4: 类目页 JSON-LD（P1）

**Files:**
- Create: `frontend/src/lib/category-jsonld.ts`
- Modify: `frontend/src/app/(storefront)/categories/[slug]/page.tsx`

**Interfaces:**
- Produces: `buildCategoryJsonLd(node: Category, parent: Category | null, products: Product[]): Record<string, unknown>[]`（返回 0–3 个对象：BreadcrumbList、CollectionPage、ItemList（products 为空时省略））。
- Consumes: 既有 `SITE_URL`、`absoluteUrl`（`lib/product-jsonld.ts`），`representativeSku`、`isInStock`（`lib/plp.ts`），脚本转义写法照 `components/product/PdpView.tsx`（`JSON.stringify(...).replace(/</g, "\\u003c")`）。

- [ ] **Step 1: 创建 builder**

创建 `frontend/src/lib/category-jsonld.ts`：

```ts
import type { Category, Product } from "./api";
import { SITE_URL, absoluteUrl } from "./product-jsonld";
import { isInStock, representativeSku } from "./plp";

/**
 * Storefront category structured data (spec §4.2 P1): BreadcrumbList,
 * CollectionPage, and an ItemList of the server-rendered first page.
 * Values we cannot populate honestly are omitted.
 */
export function buildCategoryJsonLd(
  node: Category,
  parent: Category | null,
  products: Product[],
): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}/categories/${node.slug}`;

  const crumbs = [
    { name: "Home", item: SITE_URL },
    ...(parent
      ? [{ name: parent.name, item: `${SITE_URL}/categories/${parent.slug}` }]
      : []),
    { name: node.name, item: pageUrl },
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  };

  const isRoot = node.children.length > 0;
  const collectionPageLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: isRoot ? `Shop ${node.name}` : node.name,
    description: isRoot
      ? `Browse ${node.name} made for small homes in the Philippines. Cash on delivery, nationwide shipping.`
      : undefined,
    url: pageUrl,
  };

  const blocks: Record<string, unknown>[] = [breadcrumbLd, collectionPageLd];

  if (products.length > 0) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.map((product, index) => {
        const image = [...product.images]
          .sort((a, b) => a.sortOrder - b.sortOrder)[0];
        const sku = representativeSku(product);
        return {
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Product",
            name: product.name,
            image: image ? absoluteUrl(image.url) : undefined,
            url: `${SITE_URL}/products/${product.slug}`,
            offers:
              sku !== null
                ? {
                    "@type": "Offer",
                    priceCurrency: "PHP",
                    price: sku.price,
                    availability: isInStock(product)
                      ? "https://schema.org/InStock"
                      : "https://schema.org/OutOfStock",
                    url: `${SITE_URL}/products/${product.slug}`,
                  }
                : undefined,
          },
        };
      }),
    });
  }

  return blocks;
}
```

- [ ] **Step 2: 服务端注入三段 script**

在 `page.tsx` import 区加：

```ts
import { buildCategoryJsonLd } from "@/lib/category-jsonld";
```

在 `CategoryPage` 内 `const products = await fetchFirstPage(node.id);` 之后（`items/total` 旁）加：

```ts
const jsonLdBlocks = buildCategoryJsonLd(node, parent, items);
```

在面包屑 `<nav>` 之前（return 的最前面）注入：

```tsx
{jsonLdBlocks.map((block, index) => (
  <script
    key={index}
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(block).replace(/</g, "\\u003c"),
    }}
  />
))}
```

转义写法与 PdpView 完全一致（`<` 六个字符，markdown 源码里是 `replace(/</g, "\\u003c")`），不要漏掉反斜杠。

- [ ] **Step 3: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/lib/category-jsonld.ts 'src/app/(storefront)/categories/[slug]/page.tsx'
```

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/lib/category-jsonld.ts 'small-house-commerce/frontend/src/app/(storefront)/categories/[slug]/page.tsx'
git commit -m "feat(plp): BreadcrumbList/CollectionPage/ItemList JSON-LD on category pages"
```

---

### Task 5: 类目首屏失败错误态（区分真空类）（P4）

**Files:**
- Modify: `frontend/src/app/(storefront)/categories/[slug]/page.tsx`
- Modify: `frontend/src/components/category/CategoryPlpClient.tsx`

**Interfaces:**
- Produces: `CategoryPlpClient` 新增必填 prop `initialLoadFailed: boolean`；失败时客户端区域渲染错误卡 + Try again（`router.refresh()`），真空类维持现有空态文案。

- [ ] **Step 1: 服务端把 null 与空页分开传参**

`page.tsx` 中：

```ts
const items = products?.items ?? [];
const total = products?.total ?? 0;
```

之后加：

```ts
// null = the first-page request failed; an empty page is a genuinely empty
// category and must keep the normal empty state.
const initialLoadFailed = products === null;
```

客户端调用改为：

```tsx
<CategoryPlpClient
  categoryId={node.id}
  initialProducts={items}
  initialTotal={total}
  initialLoadFailed={initialLoadFailed}
/>
```

- [ ] **Step 2: 客户端错误卡**

`CategoryPlpClient.tsx`：import 行加 `useRouter`（`import { useRouter } from "next/navigation";`）。props 接口加字段：

```ts
interface CategoryPlpClientProps {
  categoryId: string;
  initialProducts: Product[];
  initialTotal: number;
  initialLoadFailed: boolean;
}
```

函数解构加 `initialLoadFailed`，并加 state：

```ts
const router = useRouter();
const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
```

在 `filterCount` 计算之后、主 `return (` 之前插入早返回：

```tsx
if (loadFailed) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-ink-secondary">We couldn&apos;t load these products.</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-3 rounded-lg bg-cta px-5 py-2 text-sm font-medium text-white hover:bg-cta-hover"
      >
        Try again
      </button>
    </div>
  );
}
```

`router.refresh()` 会重新请求服务端组件，首屏成功后服务端传入 `initialLoadFailed={false}` 完成替换（RSC 重渲染即重挂载客户端 island，state 同步）。

- [ ] **Step 3: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint 'src/app/(storefront)/categories/[slug]/page.tsx' src/components/category/CategoryPlpClient.tsx
```

- [ ] **Step 4: Commit**

```bash
git add 'small-house-commerce/frontend/src/app/(storefront)/categories/[slug]/page.tsx' small-house-commerce/frontend/src/components/category/CategoryPlpClient.tsx
git commit -m "fix(plp): distinguish first-page fetch failure from empty category, add retry"
```

---

### Task 6: Root 类目子类图片卡（P6）

**Files:**
- Modify: `frontend/src/app/(storefront)/categories/[slug]/page.tsx`

**Interfaces:**
- Produces: 有 `imageUrl` 的 child 渲染 4:3 图片卡（2/3/4 列响应式，名称压底）；无图 child 保留现有 pill；两种形态并存。

- [ ] **Step 1: 拆分有图/无图 children 并加图片网格**

`page.tsx` 中把现有的 `{node.children.length > 0 && ( <div className="mt-4 flex flex-wrap gap-2">…pill…</div> )}` 整块替换为：

```tsx
{node.children.length > 0 && (
  <>
    {node.children.filter((leaf) => !leaf.imageUrl).length > 0 && (
      <div className="mt-4 flex flex-wrap gap-2">
        {node.children
          .filter((leaf) => !leaf.imageUrl)
          .map((leaf) => (
            <Link
              key={leaf.id}
              href={`/categories/${leaf.slug}`}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:border-primary hover:text-cta"
            >
              {leaf.name}
            </Link>
          ))}
      </div>
    )}
    {node.children.some((leaf) => leaf.imageUrl) && (
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {node.children
          .filter((leaf) => leaf.imageUrl)
          .map((leaf) => (
            <Link
              key={leaf.id}
              href={`/categories/${leaf.slug}`}
              className="group relative block aspect-[4/3] overflow-hidden rounded-lg border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={leaf.imageUrl ?? ""}
                alt={leaf.name}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
              <span className="absolute bottom-2 left-3 right-3 text-sm font-semibold text-white">
                {leaf.name}
              </span>
            </Link>
          ))}
      </div>
    )}
  </>
)}
```

- [ ] **Step 2: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint 'src/app/(storefront)/categories/[slug]/page.tsx'
```

- [ ] **Step 3: Commit**

```bash
git add 'small-house-commerce/frontend/src/app/(storefront)/categories/[slug]/page.tsx'
git commit -m "feat(plp): image cards for subcategories with photos, pills kept for imageless"
```

---

### Task 7: 筛选/排序状态进 URL（P3）

**Files:**
- Create: `frontend/src/lib/plpUrl.ts`
- Modify: `frontend/src/components/category/CategoryPlpClient.tsx`

**Interfaces:**
- Produces:
  - `parsePlpState(search: { get(name: string): string | null }): { sort: SortKey; filters: PlpFilters }`（非法值静默回退默认）
  - `buildPlpQuery(sort: SortKey, filters: PlpFilters): string`（默认值不进 URL；`sort`、`room`、`solutions`(逗号)、`price`、`instock=1`）
- URL 为单一事实源：变更用 `router.replace(pathname + qs, { scroll: false })`；浏览器前进/后退经 searchParams 变化回写 state。`lib/plp.ts` 函数签名一律不动。

- [ ] **Step 1: 建纯函数**

创建 `frontend/src/lib/plpUrl.ts`：

```ts
import {
  DEFAULT_FILTERS,
  PRICE_BAND_OPTIONS,
  ROOM_OPTIONS,
  SOLUTION_OPTIONS,
  SORT_OPTIONS,
  type PlpFilters,
  type PriceBand,
  type Room,
  type Solution,
  type SortKey,
} from "./plp";

/**
 * URL <-> PLP state (spec §4.2 P3). The URL is the single source of truth:
 * ?sort=&room=&solutions=A,B&price=&instock=1. Unknown/illegal values fall
 * back to defaults so hand-edited links never break the page.
 */
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const ROOM_VALUES = new Set<string>(ROOM_OPTIONS.map((o) => o.value));
const SOLUTION_VALUES = new Set<string>(SOLUTION_OPTIONS.map((o) => o.value));
const PRICE_VALUES = new Set<string>(PRICE_BAND_OPTIONS.map((o) => o.value));

export function parsePlpState(search: {
  get(name: string): string | null;
}): { sort: SortKey; filters: PlpFilters } {
  const sortRaw = search.get("sort");
  const sort: SortKey =
    sortRaw && SORT_VALUES.has(sortRaw) ? (sortRaw as SortKey) : "recommended";

  const roomRaw = search.get("room");
  const room: Room | null =
    roomRaw && ROOM_VALUES.has(roomRaw) ? (roomRaw as Room) : null;

  const solutions: Solution[] = [];
  const solutionsRaw = search.get("solutions");
  if (solutionsRaw) {
    for (const value of solutionsRaw.split(",")) {
      const trimmed = value.trim();
      if (SOLUTION_VALUES.has(trimmed) && !solutions.includes(trimmed as Solution)) {
        solutions.push(trimmed as Solution);
      }
    }
  }

  const priceRaw = search.get("price");
  const priceBand: PriceBand | null =
    priceRaw && PRICE_VALUES.has(priceRaw) ? (priceRaw as PriceBand) : null;

  return {
    sort,
    filters: { ...DEFAULT_FILTERS, room, solutions, priceBand, inStockOnly: search.get("instock") === "1" },
  };
}

/** Serializes only non-default state; returns "" for the canonical clean URL. */
export function buildPlpQuery(sort: SortKey, filters: PlpFilters): string {
  const q = new URLSearchParams();
  if (sort !== "recommended") q.set("sort", sort);
  if (filters.room) q.set("room", filters.room);
  if (filters.solutions.length > 0) q.set("solutions", filters.solutions.join(","));
  if (filters.priceBand) q.set("price", filters.priceBand);
  if (filters.inStockOnly) q.set("instock", "1");
  return q.toString();
}
```

- [ ] **Step 2: 现有组件改名为 Inner 并加 Suspense 包装导出**

`CategoryPlpClient.tsx` 顶部 import 改为加：

```ts
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildPlpQuery, parsePlpState } from "@/lib/plpUrl";
```

把 `export function CategoryPlpClient({...}: CategoryPlpClientProps) {` 改为 `function CategoryPlpClientInner({...}: CategoryPlpClientProps) {`（去掉 export），文件末尾新增：

```tsx
export function CategoryPlpClient(props: CategoryPlpClientProps) {
  return (
    <Suspense
      fallback={
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-sm text-ink-muted">
          Loading products…
        </div>
      }
    >
      <CategoryPlpClientInner {...props} />
    </Suspense>
  );
}
```

- [ ] **Step 3: state 从 URL 初始化、双向同步**

在 Inner 组件中（`const router = useRouter();` 已有，保留；删除 `useRouter` 旧 import 行避免重复，统一用 Step 2 的新 import）加：

```ts
const searchParams = useSearchParams();
const pathname = usePathname();
```

把 sort/filters 的 useState 初始化改为懒读取 URL：

```ts
const [sort, setSort] = useState<SortKey>(() => parsePlpState(searchParams).sort);
const [filters, setFilters] = useState<PlpFilters>(
  () => parsePlpState(searchParams).filters,
);
```

在两个已有的 `useEffect`（加载 effect、drawer effect）之后加两个同步 effect：

```ts
// Back/forward (and the replace below) -> URL is the source of truth.
useEffect(() => {
  const next = parsePlpState(searchParams);
  setSort(next.sort);
  setFilters(next.filters);
}, [searchParams]);

// State -> URL via replace (history stays clean for the back button).
useEffect(() => {
  const qs = buildPlpQuery(sort, filters);
  if (qs !== searchParams.toString()) {
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sort, filters]);
```

工具栏的 Sort select、侧栏/drawer 的 onChange、Clear all 全部保持调用现有 `setSort` / `setFilters`，不改调用点。

- [ ] **Step 4: 验证 build 接受 useSearchParams**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/lib/plpUrl.ts src/components/category/CategoryPlpClient.tsx
npm run build
```

Expected: build 通过，不再有 "useSearchParams() should be wrapped in a suspense boundary" 报错。

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/plpUrl.ts small-house-commerce/frontend/src/components/category/CategoryPlpClient.tsx
git commit -m "feat(plp): keep sort/filters in URL query with Suspense boundary and back-forward sync"
```

---

### Task 8: 徽章结构化模型 + PlpProductCard 改造（先通报线 A）

**Files:**
- Create: `frontend/src/lib/plpBadges.ts`
- Modify: `frontend/src/components/product/PlpProductCard.tsx`（**线 A 拥有文件**）

**Interfaces:**
- Produces:
  - `type BadgeKind = "bestseller" | "new" | "promo"`、`interface CardBadge { kind: BadgeKind; label: string }`
  - `BESTSELLER_BADGE`（label `"Best Seller"`）、`NEW_BADGE`（label `"New"`）
  - `buildBadgeMap(entries: { slug: string; badge: CardBadge }[]): Map<string, CardBadge[]>`
  - `visibleBadges(map: Map<string, CardBadge[]>, slug: string): CardBadge[]`（无 promo 最多一枚身份徽章；有 promo = promo + 一枚身份，promo 优先；规则 spec §4.3）
  - `PlpProductCard` prop：`badge: PlpBadge` → **`badges: CardBadge[]`**（调用点只有 Task 9 的 PLP grid）。

- [ ] **Step 1: 通报线 A（必做，动手前）**

在执行会话中向用户/线 A 会话发出通报并记录：`PlpProductCard.tsx` 将做两处兼容改动——①badge prop 从字符串联合改为 `CardBadge[]`（唯一调用方是线 B 的 CategoryPlpClient，同批改）；②左上角徽章渲染改为最多两枚的 flex 排，promo 用 `bg-sale`，身份徽章配色不变。无行为/款式选择器/quickAdd 改动。等一个确认或超时说明后再继续（用户已在 spec §6 预授权该协商项，记录即可继续）。

- [ ] **Step 2: 建纯模型文件**

创建 `frontend/src/lib/plpBadges.ts`：

```ts
/**
 * Unified merchandise badges driven entirely by collection membership
 * (spec §4.3). A product can carry one promo badge (collection.badgeLabel)
 * plus at most one identity badge (best-sellers / new-arrivals). Discount is
 * never shown here — strikethrough pricing in PriceBox carries that alone.
 */
export type BadgeKind = "bestseller" | "new" | "promo";

export interface CardBadge {
  kind: BadgeKind;
  label: string;
}

export const BESTSELLER_BADGE: CardBadge = { kind: "bestseller", label: "Best Seller" };
export const NEW_BADGE: CardBadge = { kind: "new", label: "New" };

const KIND_PRIORITY: Record<BadgeKind, number> = { promo: 0, bestseller: 1, new: 2 };

/** Flatten "collection -> member slugs" into product-slug -> badges. */
export function buildBadgeMap(
  entries: { slug: string; badge: CardBadge }[],
): Map<string, CardBadge[]> {
  const map = new Map<string, CardBadge[]>();
  for (const { slug, badge } of entries) {
    const list = map.get(slug) ?? [];
    if (!list.some((existing) => existing.kind === badge.kind)) list.push(badge);
    map.set(slug, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  }
  return map;
}

/**
 * At most two chips, promo first. Without a promo the product gets a single
 * identity chip (bestseller wins over new), preserving the prior look.
 */
export function visibleBadges(
  map: ReadonlyMap<string, readonly CardBadge[]>,
  slug: string,
): CardBadge[] {
  const all = map.get(slug);
  if (!all || all.length === 0) return [];
  const promo = all.find((badge) => badge.kind === "promo");
  const identity =
    all.find((badge) => badge.kind === "bestseller") ??
    all.find((badge) => badge.kind === "new");
  if (promo && identity) return [promo, identity];
  if (promo) return [promo];
  return identity ? [identity] : [];
}
```

- [ ] **Step 3: PlpProductCard 换 prop 与渲染**

`PlpProductCard.tsx`：

1. 删除 `export type PlpBadge = "bestseller" | "new" | null;`，import 与 props 改为：

```ts
import type { CardBadge } from "@/lib/plpBadges";

interface PlpProductCardProps {
  product: Product;
  badges: CardBadge[];
}

export function PlpProductCard({ product, badges }: PlpProductCardProps) {
```

2. 把图片 Link 内的徽章 IIFE（`{(() => { const showOos … })()}`）替换为：

```tsx
{(() => {
  // Selecting an out-of-stock style replaces every merchandise badge.
  const showOos = !hasAnySellable || (sellable && !inStock);
  if (showOos) {
    return (
      <span className="absolute left-3 top-3 rounded bg-ink/85 px-2 py-1 text-xs font-semibold text-white">
        Out of Stock
      </span>
    );
  }
  if (badges.length === 0) return null;
  return (
    <span className="absolute left-3 top-3 flex gap-1.5">
      {badges.slice(0, 2).map((badge) => (
        <span
          key={`${badge.kind}-${badge.label}`}
          className={`rounded px-2 py-1 text-xs font-semibold text-white ${
            badge.kind === "promo"
              ? "bg-sale"
              : badge.kind === "new"
                ? "bg-primary-dark/90"
                : "bg-ink/85"
          }`}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
})()}
```

3. quickAdd、款式 pill、图片联动、Add to Cart/Added/Out of Stock 按钮一律不动。

- [ ] **Step 4: 验证旧类型无其他消费方 + 静态检查**

```bash
cd small-house-commerce/frontend
grep -rn "PlpBadge" src --include='*.ts*'   # Expected: 无结果
npx tsc --noEmit                            # Expected: 仅 CategoryPlpClient 一处类型错（badge 旧值），Task 9 修复
```

tsc 此刻预期报 CategoryPlpClient 的 badge prop 错（任务间临时红灯，Task 9 同分支立刻修复；如希望保持绿，可顺序调整为本任务 Step 2-3 后立刻执行 Task 9 Step 1-2 再一起验证）。

- [ ] **Step 5: Commit（与 Task 9 可合并提交；若分开，此提交先不跑 tsc 绿灯，commit message 注明依赖下一提交）**

```bash
git add small-house-commerce/frontend/src/lib/plpBadges.ts small-house-commerce/frontend/src/components/product/PlpProductCard.tsx
git commit -m "refactor(plp): structured CardBadge[] prop, up to two chips with promo color"
```

---

### Task 9: PLP 徽章集合动态拉取（badgeLabel 字段可选先行）

**Files:**
- Modify: `frontend/src/lib/api.ts`（**共享**，只加一个可选字段）
- Modify: `frontend/src/components/category/CategoryPlpClient.tsx`

**Interfaces:**
- Consumes: `api.getCollections()` 已存在且后端 storefront 控制器默认返回 50 条 ACTIVE 集合（无需加参数）；响应集合在阶段 2 前没有 `badgeLabel` 字段，`undefined` 时行为与现状完全一致（仅 bestseller/new 两枚来源）。
- Produces: `Collection.badgeLabel?: string | null`；PLP state `badgeMap: Map<string, CardBadge[]>`；推荐排序用的 bestseller slug 集由 badgeMap 派生。

- [ ] **Step 1: api.ts 加可选字段（只加不改）**

`lib/api.ts` 的 `export interface Collection { … }` 中，在 `seoDescription?: string | null;` 之后加：

```ts
  /** Admin-set promo chip text (e.g. "9.9 Sale"); absent until backend phase 2. */
  badgeLabel?: string | null;
```

同时在改动记录里通报线 A：`lib/api.ts` 仅新增一个可选字段，无任何现有字段变化。

- [ ] **Step 2: PLP client 拉徽章集合并构建 map**

`CategoryPlpClient.tsx` import 增加：

```ts
import { BESTSELLER_BADGE, NEW_BADGE, buildBadgeMap, visibleBadges, type CardBadge } from "@/lib/plpBadges";
import type { Collection } from "@/lib/api";
```

（`api` 与 `Product` 已在同一行 import，把它改为 `import { api, type Collection, type Product } from "@/lib/api";`。）

删除 state 中的 `bestsellerSlugs` / `newSlugs` 两个 `useState<Set<string>>`，替换为：

```ts
const [badgeMap, setBadgeMap] = useState<Map<string, CardBadge[]>>(new Map());
```

把加载 effect 内的 `Promise.all([... fetchCollectionSlugs("best-sellers"), fetchCollectionSlugs("new-arrivals")])` 整段替换。新 effect body：

```ts
useEffect(() => {
  let alive = true;
  void (async () => {
    const pageCount = Math.min(
      5,
      Math.max(1, Math.ceil(Math.min(initialTotal, PLP_MAX_PRODUCTS) / PLP_PAGE_SIZE)),
    );
    const pageRequests: Promise<Product[]>[] = [];
    for (let p = 2; p <= pageCount; p += 1) {
      pageRequests.push(
        api
          .getProducts({ categoryId, page: p, pageSize: PLP_PAGE_SIZE })
          .then((data) => data.items)
          .catch(() => []),
      );
    }

    // Badge sources: the two fixed-slug identity collections, plus up to four
    // promo collections carrying an admin badgeLabel (spec §4.3). The field
    // does not exist on the phase-1 backend, so until phase 2 this is the
    // exact bestseller/new behaviour already shipped.
    let collections: Collection[] = [];
    try {
      collections = (await api.getCollections()).items;
    } catch {
      collections = [];
    }
    const badgeCollections: { slug: string; badge: CardBadge }[] = [];
    for (const collection of collections) {
      if (collection.slug === "best-sellers") {
        badgeCollections.push({ slug: collection.slug, badge: BESTSELLER_BADGE });
      } else if (collection.slug === "new-arrivals") {
        badgeCollections.push({ slug: collection.slug, badge: NEW_BADGE });
      }
    }
    const promos = collections
      .filter(
        (collection) =>
          (collection.badgeLabel ?? "").trim() !== "" &&
          collection.slug !== "best-sellers" &&
          collection.slug !== "new-arrivals",
      )
      .slice(0, 4);
    for (const collection of promos) {
      badgeCollections.push({
        slug: collection.slug,
        badge: { kind: "promo", label: (collection.badgeLabel ?? "").trim() },
      });
    }

    const [rest, memberSets] = await Promise.all([
      Promise.all(pageRequests).then((pages) => pages.flat()),
      Promise.all(
        badgeCollections.map(async (source) => ({
          source,
          slugs: await fetchCollectionSlugs(source.slug),
        })),
      ),
    ]);
    if (!alive) return;
    if (rest.length > 0) {
      setAllProducts((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...rest.filter((p) => !seen.has(p.id))];
      });
    }
    const entries = memberSets.flatMap(({ source, slugs }) =>
      [...slugs].map((slug) => ({ slug, badge: source.badge })),
    );
    setBadgeMap(buildBadgeMap(entries));
    setLoading(false);
  })();
  return () => {
    alive = false;
  };
}, [categoryId, initialTotal, initialProducts.length]);
```

`sortProducts` 调用需要 bestseller 集合，在 `visibleProducts` useMemo 之前加派生：

```ts
const bestsellerSlugs = useMemo(() => {
  const slugs = new Set<string>();
  for (const [slug, badges] of badgeMap) {
    if (badges.some((badge) => badge.kind === "bestseller")) slugs.add(slug);
  }
  return slugs;
}, [badgeMap]);
```

grid 内卡片调用改为：

```tsx
<PlpProductCard
  key={product.id}
  product={product}
  badges={visibleBadges(badgeMap, product.slug)}
/>
```

- [ ] **Step 3: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/lib/api.ts src/components/category/CategoryPlpClient.tsx
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/lib/api.ts small-house-commerce/frontend/src/components/category/CategoryPlpClient.tsx
git commit -m "feat(plp): drive badges from collection list incl. optional badgeLabel promos"
```

---

### Task 10: CartContext 抽屉状态 + addItem 自动开抽屉

**Files:**
- Modify: `frontend/src/components/cart/CartContext.tsx`

**Interfaces:**
- Produces: context 新增 `isOpen: boolean`、`openCart(): void`、`closeCart(): void`；`addItem` 签名变为 `(input: { skuId: string; quantity: number }, opts?: { openDrawer?: boolean }) => Promise<CartSummary>`，默认成功后开抽屉，`{ openDrawer: false }` 静默。跨标签 storage reload 不开抽屉。所有现有调用点（PdpClient、PlpProductCard、CartRecommendations、未来 CartDrawer）不传第二参数即获得新行为。

- [ ] **Step 1: 扩展接口与 provider**

`CartContext.tsx`：

1. `CartContextValue` 接口中加三行（放在 `loading` 之后）：

```ts
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
```

并把 addItem 行改为：

```ts
  addItem: (
    input: { skuId: string; quantity: number },
    opts?: { openDrawer?: boolean },
  ) => Promise<CartSummary>;
```

2. provider 内 `const [loading, setLoading] = useState(true);` 后加：

```ts
const [isOpen, setIsOpen] = useState(false);
const openCart = useCallback(() => setIsOpen(true), []);
const closeCart = useCallback(() => setIsOpen(false), []);
```

3. `addItem` 实现替换为：

```ts
const addItem = useCallback(
  async (
    { skuId, quantity }: { skuId: string; quantity: number },
    opts?: { openDrawer?: boolean },
  ) => {
    const summary = await api.addToCart({ cartId: cartStorage.get(), skuId, quantity });
    cartStorage.set(summary.cartId);
    setCart(summary);
    if (opts?.openDrawer !== false) setIsOpen(true);
    return summary;
  },
  [],
);
```

4. `value` 对象加三字段（`loading,` 之后）：

```ts
    isOpen,
    openCart,
    closeCart,
```

其他 mutator、跨标签同步 effect 一律不动。

- [ ] **Step 2: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/components/cart/CartContext.tsx
```

- [ ] **Step 3: Commit**

```bash
git add small-house-commerce/frontend/src/components/cart/CartContext.tsx
git commit -m "feat(cart): drawer state in CartContext, addItem opens drawer by default"
```

---

### Task 11: 抽 useCartRecommendations hook，购物车页复用

**Files:**
- Create: `frontend/src/lib/useCartRecommendations.ts`
- Modify: `frontend/src/components/cart/CartRecommendations.tsx`

**Interfaces:**
- Produces:
  - `useCartRecommendations(cart: CartSummary | null): Product[]`（空车/加载中返回 `[]`，调用方以 length 判空整块不渲染）
  - 导出 `firstSku(product): Sku | null`、`discountPct(sku): number` 供两个展示组件复用
- 排序规则一字不动地搬迁：best-sellers → 跨类 → 同类填位，折扣优先，排除同 slug/缺货/无价，TAKE=3。

- [ ] **Step 1: 建 hook 文件**

创建 `frontend/src/lib/useCartRecommendations.ts`：

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CartSummary, type Product, type Sku } from "@/lib/api";
import { fetchProduct } from "@/lib/productCache";

/**
 * "You May Also Like" data for the cart page strip and the add-to-cart
 * drawer. Candidate sources, in priority order: the best-sellers collection,
 * general-catalog products from OTHER categories than the cart lines, and
 * same-category products only to fill gaps. Discounted in-stock products
 * rank first within every source; same-product slugs and OOS products are
 * never recommended. Logic moved verbatim from CartRecommendations.tsx.
 */
export const RECOMMENDATIONS_TAKE = 3;
const POOL_PAGE_SIZE = 24;

interface Pools {
  cartKey: string;
  cartCategoryIds: string[];
  bestSellers: Product[];
  general: Product[];
}

export function firstSku(product: Product): Sku | null {
  return product.variants.find((variant) => variant.sku)?.sku ?? null;
}

export function discountPct(sku: Sku): number {
  if (sku.price === null || !sku.compareAtPrice || sku.compareAtPrice <= sku.price) {
    return 0;
  }
  return Math.round((1 - sku.price / sku.compareAtPrice) * 100);
}

export function useCartRecommendations(cart: CartSummary | null): Product[] {
  const cartSlugs = useMemo(
    () => [...new Set((cart?.items ?? []).map((item) => item.productSlug))],
    [cart],
  );
  const cartKey = cartSlugs.join(",");
  const [pools, setPools] = useState<Pools | null>(null);

  useEffect(() => {
    if (cartKey === "") return;
    let cancelled = false;
    void (async () => {
      const cartProducts = (
        await Promise.all(cartSlugs.map((slug) => fetchProduct(slug)))
      ).filter((product): product is Product => product !== null);
      const cartCategoryIds = [...new Set(cartProducts.map((product) => product.categoryId))];

      const [bestSellersPage, generalPage] = await Promise.all([
        api.getCollectionProducts("best-sellers").catch(() => null),
        api.getProducts({ pageSize: POOL_PAGE_SIZE }).catch(() => null),
      ]);

      if (cancelled) return;

      setPools({
        cartKey,
        cartCategoryIds,
        bestSellers: bestSellersPage?.items ?? [],
        general: generalPage?.items ?? [],
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  return useMemo<Product[]>(() => {
    if (!pools || pools.cartKey !== cartKey) return [];
    const inCart = new Set(cartSlugs);
    const cartCategories = new Set(pools.cartCategoryIds);

    const eligible = (product: Product) => {
      if (inCart.has(product.slug)) return false;
      const sku = firstSku(product);
      return sku !== null && sku.price !== null && sku.availableInventory > 0;
    };

    const ranked = (list: Product[]) =>
      list
        .filter(eligible)
        .map((product) => ({ product, pct: discountPct(firstSku(product)!) }))
        .sort((a, b) => b.pct - a.pct)
        .map((entry) => entry.product);

    const otherCategory = pools.general.filter(
      (product) => !cartCategories.has(product.categoryId),
    );
    const sameCategory = pools.general.filter((product) =>
      cartCategories.has(product.categoryId),
    );

    const chosen: Product[] = [];
    const seen = new Set<string>();
    for (const product of [
      ...ranked(pools.bestSellers),
      ...ranked(otherCategory),
      ...ranked(sameCategory),
    ]) {
      if (seen.has(product.slug)) continue;
      seen.add(product.slug);
      chosen.push(product);
      if (chosen.length >= RECOMMENDATIONS_TAKE) break;
    }
    return chosen;
  }, [pools, cartKey, cartSlugs]);
}
```

- [ ] **Step 2: CartRecommendations 改为 hook 消费者**

`CartRecommendations.tsx`：

1. 删除文件内的 `TAKE`、`POOL_PAGE_SIZE`、`Pools`、本地 `firstSku`、`discountPct`、`pools` state、数据 effect、`recommendations` useMemo 整段；
2. import 改为：

```ts
import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "./CartContext";
import {
  discountPct,
  firstSku,
  useCartRecommendations,
} from "@/lib/useCartRecommendations";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";
```

（`useEffect/useMemo`、`api/Sku`、`fetchProduct` 的 import 随删除逻辑一起清掉。）

3. 组件顶部改为：

```tsx
export function CartRecommendations() {
  const { cart, addItem } = useCart();
  const recommendations = useCartRecommendations(cart);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);

  if (recommendations.length === 0) return null;
```

其后的 `quickAdd` 与整个 `<section>` 横向条 JSX 一字不动（`firstSku`、`discountPct`、`TAKE` 字样若在 JSX 中有引用——TAKE 原本只用于 hook 逻辑，JSX 不引用；确认 grep 无残留）。

- [ ] **Step 3: 静态验证 + 购物车页视觉核对（任务 14 浏览器复核）**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/lib/useCartRecommendations.ts src/components/cart/CartRecommendations.tsx
```

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/lib/useCartRecommendations.ts small-house-commerce/frontend/src/components/cart/CartRecommendations.tsx
git commit -m "refactor(cart): extract useCartRecommendations hook shared by cart page and drawer"
```

---

### Task 12: CartDrawer 右侧加购抽屉

**Files:**
- Create: `frontend/src/components/cart/CartDrawer.tsx`

**Interfaces:**
- Consumes: `useCart()` 的 `cart/isOpen/closeCart/updateItem/removeItem/reload/addItem`；`useCartRecommendations(cart)`；`useProductImages(slugs)`；`ButtonLink`、`formatPrice`、`PlaceholderImage`。
- Produces: 命名导出 `CartDrawer`（在 Task 13 挂进 storefront layout）。无 Pixel 事件。

- [ ] **Step 1: 创建组件（完整文件）**

创建 `frontend/src/components/cart/CartDrawer.tsx`：

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCart } from "./CartContext";
import { useProductImages } from "@/lib/productImages";
import {
  firstSku,
  useCartRecommendations,
} from "@/lib/useCartRecommendations";
import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";
import type { CartItem, Product } from "@/lib/api";

/**
 * Slide-in "Your Cart" drawer after every add-to-cart (spec §4.4). Right-side
 * panel, backdrop click-to-close, scroll lock, Escape and a focus trap mirror
 * the mobile nav drawer (components/layout/MainNav.tsx). The drawer fires no
 * pixel events itself: AddToCart stays at the PDP/card call sites.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

const SERVICE_LINES = [
  "Cash on Delivery — no payment now",
  "Nationwide delivery 3–7 days",
  "Phone confirmation before delivery",
];

export function CartDrawer() {
  const { cart, isOpen, closeCart, updateItem, removeItem, reload, addItem } = useCart();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);

  const recommendations = useCartRecommendations(cart);
  const slugs = useMemo(
    () => [...new Set((cart?.items ?? []).map((item) => item.productSlug))],
    [cart],
  );
  const images = useProductImages(slugs);
  const unitCount = (cart?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  // Scroll lock, initial focus, focus trap, Escape, and focus restoration.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeCart();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [isOpen, closeCart]);

  async function changeQty(item: CartItem, quantity: number) {
    if (busyId) return;
    const clamped = Math.min(Math.max(1, quantity), item.availableInventory || quantity);
    setLineError(null);
    setBusyId(item.itemId);
    try {
      await updateItem(item.itemId, clamped);
    } catch {
      setLineError("Could not update quantity. Please try again.");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove(item: CartItem) {
    setBusyId(item.itemId);
    try {
      await removeItem(item.itemId);
      setConfirmId(null);
    } catch {
      setLineError("Could not remove the item. Please try again.");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function quickAdd(product: Product) {
    const sku = firstSku(product);
    if (!sku || busySlug) return;
    setBusySlug(product.slug);
    try {
      await addItem({ skuId: sku.id, quantity: 1 }, { openDrawer: false });
      setAddedSlug(product.slug);
      setTimeout(() => {
        setAddedSlug((current) => (current === product.slug ? null : current));
      }, 1400);
    } catch {
      /* the row stays put; the visitor can open the PDP */
    } finally {
      setBusySlug(null);
    }
  }

  if (!isOpen) return null;

  const items = cart?.items ?? [];
  const hasItems = items.length > 0;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
      <button
        type="button"
        aria-label="Close cart"
        className="absolute inset-0 bg-ink/40"
        onClick={closeCart}
      />
      <aside
        ref={panelRef}
        className="absolute right-0 top-0 flex h-full w-full max-w-[400px] flex-col bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold uppercase tracking-wide text-ink">
            Your Cart ({unitCount})
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeCart}
            aria-label="Close cart"
            className="text-ink-secondary hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ul className="border-b border-border bg-background px-4 py-2">
          {SERVICE_LINES.map((line) => (
            <li key={line} className="flex items-center gap-2 py-1 text-xs text-ink-secondary">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-cta" fill="none" aria-hidden="true">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {line}
            </li>
          ))}
        </ul>

        <div className="flex-1 overflow-y-auto">
          {hasItems ? (
            <>
              <ul className="divide-y divide-border px-4">
                {items.map((item) => (
                  <li key={item.itemId} className="flex gap-3 py-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border">
                      {images.get(item.productSlug) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images.get(item.productSlug) ?? ""} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <PlaceholderImage label="" className="h-full w-full" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${item.productSlug}`}
                        onClick={closeCart}
                        className="line-clamp-2 text-sm font-medium text-ink hover:text-cta"
                      >
                        {item.productName}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-muted">{item.variantName}</p>
                      {item.unavailable && (
                        <p role="alert" className="mt-1 text-xs text-sale">Out of stock</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        {confirmId === item.itemId ? (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="text-ink-secondary">Remove item?</span>
                            <button
                              type="button"
                              disabled={busyId === item.itemId}
                              onClick={() => confirmRemove(item)}
                              className="font-semibold text-sale hover:underline"
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="text-ink-secondary hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-lg border border-border">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${item.productName}`}
                              disabled={busyId === item.itemId || item.unavailable}
                              onClick={() =>
                                item.quantity <= 1
                                  ? setConfirmId(item.itemId)
                                  : changeQty(item, item.quantity - 1)
                              }
                              className="flex h-7 w-7 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
                            >
                              −
                            </button>
                            <span className="w-8 text-center text-sm text-ink">
                              {busyId === item.itemId ? (
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
                              ) : (
                                item.quantity
                              )}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${item.productName}`}
                              disabled={
                                busyId === item.itemId ||
                                item.unavailable ||
                                item.quantity >= item.availableInventory
                              }
                              onClick={() => changeQty(item, item.quantity + 1)}
                              className="flex h-7 w-7 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
                            >
                              +
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${item.productName}`}
                          onClick={() => setConfirmId(item.itemId)}
                          className="text-xs text-ink-muted hover:text-sale"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold text-ink">
                      {formatPrice(item.lineTotal)}
                    </div>
                  </li>
                ))}
              </ul>

              {lineError && (
                <p role="alert" className="px-4 pt-2 text-xs text-sale">{lineError}</p>
              )}

              {recommendations.length > 0 && (
                <section className="border-t border-border px-4 py-3" aria-label="Recommended products">
                  <h3 className="mb-2 text-sm font-semibold text-ink">You May Also Like</h3>
                  <ul className="flex flex-col gap-3">
                    {recommendations.map((product) => {
                      const sku = firstSku(product)!;
                      const image = product.images[0];
                      const busy = busySlug === product.slug;
                      const added = addedSlug === product.slug;
                      return (
                        <li key={product.id} className="flex items-center gap-3">
                          <Link
                            href={`/products/${product.slug}`}
                            onClick={closeCart}
                            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border"
                          >
                            {image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={image.url} alt={image.altText ?? product.name} className="h-full w-full object-cover" />
                            ) : (
                              <PlaceholderImage label={product.name} className="h-full w-full" />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/products/${product.slug}`}
                              onClick={closeCart}
                              className="line-clamp-2 text-xs font-medium text-ink hover:text-cta"
                            >
                              {product.name}
                            </Link>
                            <p className="text-sm font-semibold text-ink">{formatPrice(sku.price!)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => quickAdd(product)}
                            disabled={busy}
                            aria-label={`Add ${product.name} to cart`}
                            data-testid={`drawer-rec-add-${product.slug}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cta text-white transition-colors hover:bg-cta-hover disabled:opacity-60"
                          >
                            {busy ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                            ) : added ? (
                              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                                <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="mb-4 text-sm text-ink-secondary">Your cart is empty</p>
              <button
                type="button"
                onClick={closeCart}
                className="text-sm font-semibold text-cta hover:underline"
              >
                Continue shopping
              </button>
            </div>
          )}
        </div>

        {hasItems && cart && (
          <div className="border-t border-border p-4">
            <dl className="mb-3 flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Subtotal</dt>
                <dd className="font-medium text-ink">{formatPrice(cart.subtotal)}</dd>
              </div>
              {cart.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">You save</dt>
                  <dd className="font-medium text-sale">−{formatPrice(cart.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Shipping</dt>
                <dd className="font-medium text-ink">COD — calculated at checkout</dd>
              </div>
            </dl>
            <ButtonLink href="/cart" className="w-full">
              CHECKOUT
            </ButtonLink>
            <button
              type="button"
              onClick={closeCart}
              className="mt-2 w-full text-center text-sm text-ink-secondary hover:text-ink"
            >
              Continue shopping
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
```

要点核对：推荐 quick-add 传 `{ openDrawer: false }`（抽屉已开，不重复触发；addItem 仍会刷新行与小计）；抽屉内任何 PDP 链接都 `onClick={closeCart}`，保证从抽屉进详情页时滚动锁解除；`"COD — calculated at checkout"` 是冻结原句复用；服务条三句严格按 spec §4.4（含 en dash `3–7`、em dash `—`）。

- [ ] **Step 2: 静态验证**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src/components/cart/CartDrawer.tsx
```

- [ ] **Step 3: Commit（暂未挂载，不影响运行）**

```bash
git add small-house-commerce/frontend/src/components/cart/CartDrawer.tsx
git commit -m "feat(cart): slide-in cart drawer with assurance strip, steppers, recommendations"
```

---

### Task 13: 挂载抽屉（通报线 A）+ 全量静态验证

**Files:**
- Modify: `frontend/src/app/(storefront)/layout.tsx`（**共享**，只加两行）

**Interfaces:** 抽屉在 `Providers`（CartProvider）内、全站挂载；无 props。

- [ ] **Step 1: 通报线 A（必做）**

记录/发送通报：共享文件 `app/(storefront)/layout.tsx` 只加 import 与 `<CartDrawer />` 一行，位于 `<Footer />` 之后、`<MessengerChat />` 之前；不改任何既有节点。

- [ ] **Step 2: 加两行**

`layout.tsx` import 区（`import { MessengerChat } ...` 附近）加：

```ts
import { CartDrawer } from "@/components/cart/CartDrawer";
```

在 `<Footer collections={footerCollections} />` 与 `<MessengerChat />` 之间插入：

```tsx
      <CartDrawer />
```

- [ ] **Step 3: 全量静态门禁**

```bash
cd small-house-commerce/frontend
npx tsc --noEmit
npx eslint src
npm run build
```

Expected: 三项全绿；build 输出里 `/categories/[slug]` 与 `/checkout` 正常生成。

- [ ] **Step 4: Commit**

```bash
git add 'small-house-commerce/frontend/src/app/(storefront)/layout.tsx'
git commit -m "feat(cart): mount CartDrawer globally inside Providers (additive, line-A notified)"
```

---

### Task 14: 浏览器手测验收（3003）+ ProductCard 协商收尾

**Files:** 无代码改动；本任务产出验收记录与协商结论。

- [ ] **Step 1: 启动（如未运行）并核对环境**

```bash
cd small-house-commerce/frontend
PORT=3003 npm run dev
```

确认用户的 3000 后端 / 3001 前端进程未被触碰。

- [ ] **Step 2: Checkout 验收**

- [ ] 购物车选商品进 /checkout：五个必填留空提交 → 五个字段下方红字 + 焦点落到 name；顶部不出现旧集合句。
- [ ] phone 输入 `123`、`0917123456`（10 位）失焦 → 红字 `"Please enter a valid Philippine mobile number."`；`09171234567`（11 位）、`+639171234567`（+63+10 位）无错；改正后红字消失。
- [ ] 375px 窄屏顺序：Your Order → Contact Information → Delivery Address → Subtotal/Total + COD 卡 → PLACE COD ORDER；桌面 1280px 仍是左预览+摘要、右表单+CTA。
- [ ] Buy Now 坏 URL（把 PDP 的 skuId 改成乱码）→ 独立错误卡 "We couldn't load this item."，两链接可点；`/checkout?skuId=...` 缺 slug 时不出现可提交表单。
- [ ] 正常下一单：成功页 Order Received；Pixel Helper/network 里 InitiateCheckout 与 Purchase 各一次（Pixel 事件本任务只做不断线确认，不新增）。COD/配送文案逐字未变。

- [ ] **Step 3: PLP 验收**

- [ ] 任一叶子类目：改 Sort、选 room/solutions/price/instock → URL 同步为 `?sort=…&room=…&solutions=…&price=…&instock=1`，默认值不出现；刷新后状态恢复；浏览器后退/前进正确还原；Clear all 清掉全部 query。
- [ ] 空筛选结果与真空类文案区分仍正确；root 类目有图 children 显示图卡、无图仍是 pill（当前数据若无图，pill 形态保持）。
- [ ] 查看页面源码：BreadcrumbList / CollectionPage / ItemList 三段 JSON-LD 在位（可贴到 Google Rich Results Test；ItemList 的 priceCurrency=PHP）。
- [ ] 停掉后端或阻断 products 接口后硬刷新 → "We couldn't load these products." + Try again；恢复后点击重试成功。

- [ ] **Step 4: 徽章验收（阶段 1 无 badgeLabel 数据）**

- [ ] best-sellers / new-arrivals 集合成员商品显示 "Best Seller" / "New" 单枚；同时属两集合只显示 Best Seller；卡片选中缺货款式 / 全无价 SKU 时 "Out of Stock" 覆盖徽章；Save% 徽章确认不存在。
- [ ] 浏览器 Network：PLP 一次加载内出现 `/collections` 请求（≤1）+ 每徽章集合 ≤3 个 members 请求；无 badgeLabel 时页面表现与改造前一致。

- [ ] **Step 5: 抽屉验收（PDP、类目两处入口）**

- [ ] 类目卡 Add to Cart、PDP Add to Cart → 右侧抽屉自动弹出；body 不可滚；Esc / 遮罩 / × 三种方式关闭，焦点回到触发按钮。
- [ ] Tab 焦点被圈在抽屉内（Shift+Tab 从关闭按钮跳到 CHECKOUT/最后元素）。
- [ ] 服务条三句逐字正确；商品行：图、名（点击进 PDP 且抽屉关闭）、款式、步进（上限库存、到 1 点减号出 Remove item? 二次确认）、Remove、行小计 PHP。
- [ ] 推荐最多 3 个、纵向、quick-add 后行入车且推荐不重复该车商品；空车时整块无推荐、显示 "Your cart is empty" + Continue shopping。
- [ ] 底部 Subtotal / 有折扣时 You save / Shipping 冻结句；CHECKOUT 进 /cart（购物车页原有勾选逻辑在）；Continue shopping 关闭。
- [ ] 加购只触发一次 AddToCart（调用点原有），抽屉本身无 Pixel 请求。
- [ ] 购物车页原有横向 You May Also Like 条显示与行为不变。

- [ ] **Step 6: ProductCard 协商（首页 Order Now）**

把协商请求交付给用户/线 A：`components/product/ProductCard.tsx` 是服务端组件，改快捷加购需客户端化（新建小 client wrapper 或转 "use client"），属线 A 独占文件。给出两个选项：①线 A 接受，另起最小提交把卡片改为 context.addItem + 自动弹抽屉；②拒绝，首页维持 Order Now 跳 PDP（抽屉在 PDP/类目/其他入口照常工作）。**在收到答复前不改该文件。**

- [ ] **Step 7: 收尾**

- [ ] `git log --oneline -14` 检查 13 个提交都在 `feat/checkout-category`，无 `-A` 添加。
- [ ] 测试产生的购物车数据可保留在游客 localStorage（不进共享库）；若下了真实测试订单，按交接文档清理（后端订单删除由用户确认后执行，不擅自操作共享库）。
- [ ] 向用户汇报：完成项、与线 A 的两个通报（PlpProductCard/layout/api.ts）、ProductCard 协商待答复、阶段 2 计划另写。

---

## Self-Review 记录（计划作者已核对）

- **Spec 覆盖**：§4.1 C1/C4→Task1、C2→Task2、C3→Task3；§4.2 JSON-LD→T4、错误态→T5、子类图卡→T6、URL→T7；§4.3 徽章类型/优先级/无 Save%/OOS 覆盖/可选先行→T8+T9；§4.4 context/抽屉/hook 抽取/挂载/三句服务条/CHECKOUT→/cart/空车态/无新事件→T10–T13；§9 验证→T13/T14；§3 ProductCard 协商→T14-S6。阶段 2（§5）明确不在本计划。
- **类型一致性**：`CardBadge`/`visibleBadges`/`buildBadgeMap` 在 T8 定义、T9 与卡片消费；`parsePlpState`/`buildPlpQuery` 同名同签名；`useCartRecommendations(cart): Product[]` 同时被 CartRecommendations 与 CartDrawer 使用；`initialLoadFailed` 在 T5 服务端/客户端同名字段；`addItem(input, opts?)` 第二参数可选，所有旧调用兼容。
- **冻结字符串**：四句 COD/配送文案在 T2/T12 均以原文搬运，服务条三句为 spec 新增白名单。
