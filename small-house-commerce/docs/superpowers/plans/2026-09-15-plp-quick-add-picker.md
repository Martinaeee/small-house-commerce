# 类目卡快捷加购 + 选款抽屉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 类目页多款式商品点购物车按钮时，在右侧抽屉内先选款式/数量再 Confirm 加购，成功后同一抽屉原地切换为购物车视图；单款式商品维持一键直加。

**Architecture:** 扩展阶段 1 的 CartContext/CartDrawer 为双视图（`cart | picker`），外壳（遮罩/滚锁/焦点陷阱/opener 归还）单实例复用；新增纯展示的 `QuickAddView`；`PlpProductCard` 移除卡面款式 pills，按可售款式数量分流直加或 `openPicker`。零后端/零 migration/零新依赖。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Tailwind（设计 token）；无前端测试框架，验证 = `npx tsc --noEmit` + `npx eslint src` + `npm run build` + 浏览器手测。

**Spec:** [../specs/2026-09-15-plp-quick-add-picker-design.md](../specs/2026-09-15-plp-quick-add-picker-design.md)（spec 是权威；本计划所有任务隐式包含 Global Constraints）。

## Global Constraints

- 分支 `feat/plp-quick-add`（堆叠在 `feat/checkout-category` 之上；BASE 起步 = 3d825bb）；worktree `.claude/worktrees/checkout-category`；前端 dev 端口 3003；**不重启 3000/3001/3100，不碰其他 worktree 的 git 索引；提交用显式路径 `git add <path>`，禁止 `git add -A`**。
- **零后端改动、零 migration、零新 npm 依赖**（package.json/lockfile 零 diff）。
- 只允许触碰本计划列出的文件：`src/lib/variantImages.ts`（新建）、`src/components/cart/CartContext.tsx`、`src/components/cart/QuickAddView.tsx`（新建）、`src/components/cart/CartDrawer.tsx`、`src/components/product/PlpProductCard.tsx`。**不许改** `lib/tracking.ts`、`lib/api.ts`、PDP、ProductCard、服务端组件、后端任何文件。
- 冻结的 COD/配送文案一字不动（含 CartDrawer 既有服务条三句与 "Shipping / COD — calculated at checkout"）；新增 UI 文案仅限本计划明示的英文串。
- Meta Pixel：AddToCart 仍在**真实加购成功后恰好一次**（卡片直加路径与 Confirm 路径各保留/新增一处）；打开选款抽屉、切款式、切视图、关抽屉零事件；不新增其他事件类型。
- eslint：不新增任何 `eslint-disable`（仓库零先例）；遵守 `react-hooks/set-state-in-effect`——open effect 内禁止 setState，状态重置走稳定事件回调。
- 价格只显示 PHP（经 `PriceBox`/`formatPrice`）；Tailwind 只用设计 token（cta/ink/border/sale/card/background/primary 等既有名称）。
- 每个任务结束必须三门禁绿：在 `small-house-commerce/frontend` 下 `npx tsc --noEmit`、`npx eslint src`、`npm run build`。
- 无测试框架：不新建测试运行器；纯函数的正确性由代码内确定性 + 最终浏览器验收覆盖。

---

### Task 1: CartContext 双视图状态 + 款式/图片纯函数

**Files:**
- Create: `small-house-commerce/frontend/src/lib/variantImages.ts`
- Modify: `small-house-commerce/frontend/src/components/cart/CartContext.tsx`

**Interfaces:**
- Produces（后续任务消费，名字必须逐字一致）：
  - `sellableVariants(product: Product): ProductVariant[]` — `v.sku !== null && v.sku.price !== null`。
  - `sortedProductImages(product: Product): ProductImage[]` — 按 `sortOrder` 升序的拷贝。
  - `variantImage(product: Product, index: number): ProductImage | null` — 位置映射，越界回退首图，无图 null。
  - CartContext 增项：`view: DrawerView`（`export type DrawerView = "cart" | "picker"`）、`pickerProduct: Product | null`、`openPicker: (product: Product) => void`、`goToCartView: () => void`。

- [ ] **Step 1: 新建 `src/lib/variantImages.ts`**

```ts
import type { Product, ProductImage, ProductVariant } from "@/lib/api";

/** Product images in backend display order (copy — never mutates props). */
export function sortedProductImages(product: Product): ProductImage[] {
  return [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Positional variant→image mapping used by PLP cards and the quick-add
 * drawer: variant array index N maps to the N-th image; out-of-range falls
 * back to the first image. This mirrors the legacy card behavior until the
 * backend links images to variants directly (ProductImage.variantId, a
 * future nullable migration).
 */
export function variantImage(
  product: Product,
  index: number,
): ProductImage | null {
  const images = sortedProductImages(product);
  return images[index] ?? images[0] ?? null;
}

/** Variants bound to a priced SKU — the styles that can be offered. */
export function sellableVariants(product: Product): ProductVariant[] {
  return product.variants.filter((v) => v.sku !== null && v.sku.price !== null);
}
```

- [ ] **Step 2: CartContext 增量改造**

在 `src/components/cart/CartContext.tsx` 做纯追加修改：

1. import 行 `import { api, cartStorage, type CartSummary } from "@/lib/api";` 改为：

```ts
import { api, cartStorage, type CartSummary, type Product } from "@/lib/api";
```

2. 在 `interface CartContextValue {` 之前加类型导出：

```ts
export type DrawerView = "cart" | "picker";
```

3. 在接口体内 `isOpen: boolean;` 之后加四行：

```ts
  view: DrawerView;
  pickerProduct: Product | null;
  /** Open the drawer in the variant-picker view for the given product. */
  openPicker: (product: Product) => void;
  /** Switch an open drawer from picker to cart view (after a successful add). */
  goToCartView: () => void;
```

4. 在 `CartProvider` 内 `const [isOpen, setIsOpen] = useState(false);` 之后加：

```ts
  const [view, setView] = useState<DrawerView>("cart");
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
```

5. 在 `drawerOpenerRef` 定义之后、`openCart` 之前抽出共享捕获函数：

```ts
  const captureOpener = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      drawerOpenerRef.current = active;
    }
  }, []);
```

6. 把现有 `openCart`/`closeCart` 替换为：

```ts
  const openCart = useCallback(() => {
    captureOpener();
    setView("cart");
    setIsOpen(true);
  }, [captureOpener]);
  const openPicker = useCallback(
    (product: Product) => {
      captureOpener();
      setPickerProduct(product);
      setView("picker");
      setIsOpen(true);
    },
    [captureOpener],
  );
  const goToCartView = useCallback(() => setView("cart"), []);
  const closeCart = useCallback(() => {
    setIsOpen(false);
    setPickerProduct(null);
    setView("cart");
  }, []);
```

注意：`addItem` 内的 opener 同步捕获逻辑**保持原样不动**（直加路径仍在 willOpen 分支开抽屉；close 已把 view 复位为 "cart"）。

7. 在 context `value` 对象内（`isOpen,` 之后）加：

```ts
    view,
    pickerProduct,
    openPicker,
    goToCartView,
```

- [ ] **Step 3: 门禁**

Run（cwd `small-house-commerce/frontend`）：`npx tsc --noEmit && npx eslint src && npm run build`
Expected: 全绿（新上下文字段尚无消费者，不报错；22/22 页构建通过）。

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/lib/variantImages.ts small-house-commerce/frontend/src/components/cart/CartContext.tsx
git commit -m "feat(cart): drawer view state and variant/image helpers for quick-add picker"
```

---

### Task 2: QuickAddView 选款视图组件

**Files:**
- Create: `small-house-commerce/frontend/src/components/cart/QuickAddView.tsx`

**Interfaces:**
- Consumes: Task 1 的 `useCart().addItem` / `goToCartView`（不直接调 goToCartView，由 CartDrawer 通过 `onAdded` 切换）；`sellableVariants`、`variantImage`（Task 1）；`PriceBox`（`src/components/ui/PriceBox`）、`PlaceholderImage`（`src/components/ui/PlaceholderImage`）、`track`（`src/lib/tracking`）、`next/link`。
- Produces: `export function QuickAddView({ product, onAdded, onClose }: QuickAddViewProps)`，填充整个 drawer `<aside>`（自带滚动区与底部按钮区，不含外壳/header/遮罩）。

**行为契约（spec §3.2/§5/§6）：**
- 款式列表渲染 `product.variants` 全部项；`sku === null` 的按钮 `disabled`；默认选中第一个 sellable（无则第一个，但正常入口不会出现）。
- 缩略图 = `variantImage(product, i)`（i 是 variants 数组下标）；有图渲染 `<img>`，无图渲染 `<PlaceholderImage>`。
- 选中款式切换时 qty 夹回 `[1, max(1, sku.availableInventory)]`。
- 库存文案：`availableInventory <= 0` → "Out of Stock"；`<= 5` → `Only N left`；否则无。
- Confirm：OOS/无 sku/busy 时禁用；成功后发一次 AddToCart（payload 与卡片现状逐字段一致，quantity 用 qty）再 `onAdded()`，**不**在成功路径 setState；失败显示固定文案 "Sorry, we couldn't add that right now. Please try again."（`role="alert"`），留在本视图。
- 商品名/大图是 `/products/${slug}` 链接，onClick={onClose}。

- [ ] **Step 1: 新建 `src/components/cart/QuickAddView.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "./CartContext";
import { track } from "@/lib/tracking";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { sellableVariants, variantImage } from "@/lib/variantImages";

interface QuickAddViewProps {
  product: Product;
  /** Called exactly once after a successful add; the drawer swaps to cart. */
  onAdded: () => void;
  /** Close the whole drawer (product link). */
  onClose: () => void;
}

function clampQty(qty: number, available: number): number {
  const max = Math.max(1, available);
  return Math.min(Math.max(1, qty), max);
}

export function QuickAddView({ product, onAdded, onClose }: QuickAddViewProps) {
  const { addItem } = useCart();
  const [selectedId, setSelectedId] = useState<string>(
    () => sellableVariants(product)[0]?.id ?? product.variants[0]?.id ?? "",
  );
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIndex = product.variants.findIndex((v) => v.id === selectedId);
  const variant = selectedIndex >= 0 ? product.variants[selectedIndex] : null;
  const sku = variant?.sku ?? null;
  const available = sku?.availableInventory ?? 0;
  const outOfStock = sku === null || sku.price === null || available <= 0;
  const image = selectedIndex >= 0 ? variantImage(product, selectedIndex) : null;
  const stockLabel =
    sku === null || sku.price === null
      ? null
      : available <= 0
        ? "Out of Stock"
        : available <= 5
          ? `Only ${available} left`
          : null;

  function selectVariant(id: string, index: number, variantAvailable: number) {
    setSelectedId(id);
    setQty((current) => clampQty(current, Math.max(1, variantAvailable)));
    setError(null);
  }

  async function confirmAdd() {
    if (!sku || sku.price === null || busy || available <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await addItem({ skuId: sku.id, quantity: qty }, { openDrawer: false });
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: qty }],
        value: sku.price,
        currency: "PHP",
      });
      onAdded();
    } catch {
      setError("Sorry, we couldn't add that right now. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-3 p-4">
          <Link
            href={`/products/${product.slug}`}
            onClick={onClose}
            className="h-32 w-28 shrink-0 overflow-hidden rounded-lg border border-border"
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={image.altText ?? product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <PlaceholderImage label={product.name} className="h-full w-full" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={`/products/${product.slug}`}
              onClick={onClose}
              className="line-clamp-2 text-sm font-semibold text-ink hover:text-cta"
            >
              {product.name}
            </Link>
            {variant && (
              <p className="mt-0.5 text-xs text-ink-muted">{variant.name}</p>
            )}
            <div className="mt-1.5">
              <PriceBox price={sku?.price ?? null} compareAtPrice={sku?.compareAtPrice ?? null} />
            </div>
            {stockLabel && (
              <p
                data-testid={`picker-stock-${product.slug}`}
                className={`mt-1 text-xs font-medium ${available <= 0 ? "text-sale" : "text-ink-secondary"}`}
              >
                {stockLabel}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <span className="text-sm font-medium text-ink-secondary">Color/Style</span>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {product.variants.map((v, i) => {
              const thumb = variantImage(product, i);
              const disabled = v.sku === null;
              const active = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  data-testid={`picker-variant-${product.slug}-${i}`}
                  onClick={() =>
                    selectVariant(v.id, i, v.sku?.availableInventory ?? 1)
                  }
                  className="flex w-16 flex-col items-center gap-1"
                >
                  <span
                    className={`h-16 w-16 overflow-hidden rounded-lg border-2 bg-card transition-colors ${
                      active
                        ? "border-cta"
                        : "border-border hover:border-primary"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <PlaceholderImage label="" className="h-full w-full" />
                    )}
                  </span>
                  <span
                    className={`w-full truncate text-center text-[11px] leading-tight ${
                      active ? "font-semibold text-cta" : "text-ink-secondary"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    {v.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-secondary">Quantity</span>
            <span className="inline-flex items-center rounded-lg border border-border">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={outOfStock || qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                −
              </button>
              <span className="w-9 text-center text-sm text-ink">{qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={outOfStock || qty >= available}
                onClick={() => setQty((q) => clampQty(q + 1, available))}
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
          {error && (
            <p role="alert" data-testid={`picker-error-${product.slug}`} className="mt-2 text-xs text-sale">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <button
          type="button"
          onClick={confirmAdd}
          disabled={outOfStock || busy}
          data-testid={`picker-confirm-${product.slug}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Adding…
            </>
          ) : outOfStock ? (
            "Out of Stock"
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </>
  );
}
```

注意：这里的 `// eslint-disable-next-line @next/next/no-img-element` 是仓库既有先例（CartDrawer/PlpProductCard 都有同样的图片豁免），**不是**被禁的 `react-hooks/set-state-in-effect`；允许保留。

- [ ] **Step 2: 门禁**

Run：`npx tsc --noEmit && npx eslint src && npm run build`
Expected：全绿（组件尚无消费者，导出未使用不报错）。

- [ ] **Step 3: Commit**

```bash
git add small-house-commerce/frontend/src/components/cart/QuickAddView.tsx
git commit -m "feat(cart): add QuickAddView variant-picker drawer body"
```

---

### Task 3: CartDrawer 双视图接线 + PlpProductCard 分流

**Files:**
- Modify: `small-house-commerce/frontend/src/components/cart/CartDrawer.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PlpProductCard.tsx`

**Interfaces:**
- Consumes: Task 1 context 增项（`view`/`pickerProduct`/`openPicker`/`goToCartView`）、Task 2 `QuickAddView`、Task 1 `sellableVariants`/`sortedProductImages`。
- Produces: 多款式类目卡按钮 → 选款抽屉；Confirm 后同抽屉购物车视图。

- [ ] **Step 1: CartDrawer 外壳双视图**

在 `src/components/cart/CartDrawer.tsx`：

1. import 区加：

```tsx
import { QuickAddView } from "./QuickAddView";
```

2. `useCart()` 解构里加 `view, pickerProduct, goToCartView`（其余字段不动）：

```tsx
  const {
    cart,
    isOpen,
    view,
    pickerProduct,
    closeCart,
    updateItem,
    removeItem,
    reload,
    addItem,
    takeDrawerOpener,
    goToCartView,
  } = useCart();
```

3. 外壳容器的 aria-label 按视图切换。把：

```tsx
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
```

改为：

```tsx
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={view === "picker" ? "Add to cart" : "Your cart"}
    >
```

4. header 标题按视图切换（关闭按钮与 ref 保持不动——它是跨视图常驻节点，视图切换时焦点落在它上面）：

```tsx
          <h2 className="text-base font-bold uppercase tracking-wide text-ink">
            {view === "picker" ? "Add to Cart" : `Your Cart (${unitCount})`}
          </h2>
```

5. 把 header 之后的三块内容（`<ul>` 服务条、`<div className="flex-1 overflow-y-auto">…</div>`、`{hasItems && cart && (…footer…)}`）整体包进条件渲染。即在 header `</div>` 之后写：

```tsx
        {view === "picker" && pickerProduct ? (
          <QuickAddView
            product={pickerProduct}
            onClose={handleClose}
            onAdded={() => {
              goToCartView();
              // The close button is chrome that survives the view swap;
              // move focus before the Confirm button unmounts.
              closeButtonRef.current?.focus();
            }}
          />
        ) : (
          <>
```

然后在原 footer 块结束之后、`</aside>` 之前加：

```tsx
          </>
        )}
```

（即服务条 + 滚动区 + footer 三块成为 Fragment 子节点，缩进不强制重排，但 JSX 结构必须如此。）

`handleClose`、open effect（滚锁/Esc/陷阱/opener）、`changeQty`/`confirmRemove`/`quickAdd` 等**一律不动**。陷阱的 `querySelectorAll(FOCUSABLE)` 发生在按键时刻，视图切换后自动拿到新视图的可聚焦元素，无需改 effect 依赖。

- [ ] **Step 2: PlpProductCard 移除 pills、按款式数分流**

在 `src/components/product/PlpProductCard.tsx`：

1. import 调整：删除 `useState` 以外不需要的符号——保留 `useState`（busy/added 仍用）；类型导入去掉 `ProductVariant`（若不再被引用）；新增 helper 导入。最终相关 import 为：

```tsx
import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { useCart } from "@/components/cart/CartContext";
import { sellableVariants, sortedProductImages } from "@/lib/variantImages";
import { track } from "@/lib/tracking";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { RatingStars } from "./RatingStars";
```

2. 删除 `firstSellableIndex` 函数；把组件顶部状态/派生改为：

```tsx
export function PlpProductCard({ product, badges }: PlpProductCardProps) {
  const { addItem, openPicker } = useCart();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const sellable = sellableVariants(product);
  const hasMultipleStyles = sellable.length > 1;
  const sku = sellable[0]?.sku ?? null;
  const inStock = sku !== null && sku.availableInventory > 0;
  const hasAnySellable = sellable.length > 0;

  const image = sortedProductImages(product)[0] ?? null;
```

3. `quickAdd` 函数体不动（仍 `addItem({ skuId: sku.id, quantity: 1 })` + track + busy/added），但其开头守卫 `if (!sku || busy || !inStock) return;` 保持。

4. 删除整个卡面款式 pills 块：

```tsx
        {product.variants.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${product.name} styles`}>
            …
          </div>
        )}
```

5. 购物车按钮的 `onClick`/`disabled`/文案改为分流（class 与 testid 不变）：

```tsx
            <button
              type="button"
              onClick={hasMultipleStyles ? () => openPicker(product) : quickAdd}
              disabled={hasMultipleStyles ? false : !inStock || busy}
              data-testid={`plp-add-${product.slug}`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2 text-sm font-medium text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
            >
              {hasMultipleStyles
                ? "Add to Cart"
                : busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Adding…
                  </>
                ) : added ? (
                  <>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                      <path
                        d="M3 8.5 6.5 12 13 4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Added
                  </>
                ) : inStock ? (
                  "Add to Cart"
                ) : (
                  "Out of Stock"
                )}
            </button>
```

徽章区 `showOos = !hasAnySellable || (sellable && !inStock)` 表达式里 `sellable` 现在是数组——改为 `!hasAnySellable || (!hasMultipleStyles && !inStock)`（多款式卡即使各款全 OOS 也只显示商品徽章，入口进抽屉后再显示各款 OOS；全店无任何 sellable 时仍出 "Out of Stock" 角标）：

```tsx
          const showOos = !hasAnySellable || (!hasMultipleStyles && !inStock);
```

主图区其余（Link/PlaceholderImage/loading lazy）不动。

- [ ] **Step 3: 门禁**

Run：`npx tsc --noEmit && npx eslint src && npm run build`
Expected：0 error / 0 warning；22/22 页。确认 `ProductVariant` 等未用 import 已清干净（tsc/eslint 会报）。

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/components/cart/CartDrawer.tsx small-house-commerce/frontend/src/components/product/PlpProductCard.tsx
git commit -m "feat(plp): open variant picker from multi-style cards; drawer swaps to cart view"
```

---

### Task 4: 浏览器验收

**Files:**
- 无代码改动；验收报告写入 SDD workspace（controller 用 sdd-workspace 脚本生成目录）。

**前置：** 3003 dev server 已在跑（`PORT=3003 npm run dev`，cwd `small-house-commerce/frontend`）；若未跑，向 controller 报告不要自行重启他线服务。真实数据可能缺多款式/缺货组合，允许用 chrome-devtools MCP 的 route 伪造成员（不写库、不下单），与 T14b 同法。

- [ ] **Step 1: 多款式选择联动**

类目页打开一个多款式商品的选款抽屉（`plp-add-<slug>` → 抽屉标题 "Add to Cart"）：逐个点 `picker-variant-<slug>-N`，断言大图/款式名/PriceBox 价格/划线价随选择切换；缩略图与商品图顺序对应；缺图商品显示占位渐变不裂图；`sku===null` 款式按钮 disabled。

- [ ] **Step 2: 数量与库存**

步进器默认 1；+ 到 `availableInventory` 后置灰，− 到 1 置灰；切到 OOS 款式后 Confirm 禁用且文案 "Out of Stock"、步进禁用；`Only N left`（≤5）文案与色值出现；再切回有货款，qty 被夹到该款库存范围内。

- [ ] **Step 3: Confirm 加车 + 视图切换**

选款式 X、qty 2 → Confirm：购物车出现该商品、variantName=X、数量 2、行小计正确（PHP）；同一抽屉原地变购物车视图（标题变 Your Cart、无第二遮罩、无闪烁）；CHECKOUT/Continue/服务条行为不变；body.overflow 在两视图与关闭后均正确（关闭后为 ""）。

- [ ] **Step 4: 像素计数**

假 pixel `990000000000001` 下 spy `_fbq`：一次 Confirm 恰好 1 条 AddToCart（contents.quantity=所选 qty）；打开抽屉、切换款式、操作步进、视图切换、关闭 = 0 条；单款式卡直加 = 1 条。

- [ ] **Step 5: 焦点与 a11y**

多款式卡按钮点击 → 真实 Esc/X/遮罩关闭后 activeElement 回到该卡 `plp-add-<slug>`（opener 复用阶段 1 机制）；选款视图内 Tab/Shift+Tab 不出面板（含从遮罩拉回）；Confirm 切视图后焦点在关闭按钮上，继续 Tab 在购物车视图内循环。

- [ ] **Step 6: 分流与回归**

单款式卡：点击直接加车 1 件并开购物车视图（阶段 1 行为，含 busy/Added）；0 可售款卡：整宽 View Details、无加购按钮；375px 抽屉全宽、缩略图换行不错乱；1280px 正常；首页/搜索/集合页行为零变化（ProductCard 未触）；全程 0 app console 错误（已知 fbevents 假 ID "Script error." 噪音忽略）。

- [ ] **Step 7: 失败态**

route 把 `POST /api/v1/storefront/cart/items` 伪造成 500：Confirm 后停留在选款视图、选择与 qty 不丢、出现 role=alert 固定文案；恢复后重试成功并切视图。

- [ ] **Step 8: 写验收报告**

报告记录：商品/slug、各款式 skuId/价格/库存、AddToCart 队列增量、activeElement testid、截图（选款视图、OOS、车视图切换各一张）。任何 FAIL 不改码，交 controller 裁决。

---

## Self-Review 记录（计划作者已核对）

- **Spec 覆盖**：§3.1 入口三分流→T3 Step 2；§3.2 选款视图全部元素→T2；§3.3 同抽屉切车视图→T3 Step 1 `onAdded`；§3.4 a11y/焦点→T1 opener 复用 + T3 closeButton 落点 + T4 Step 5；§4.1 context 增量→T1；§4.2 CartDrawer 双视图/handleClose 不动→T3；§4.3 QuickAddView→T2；§4.4 卡片移除 pills/分流/像素→T3；§5 像素→T2 Confirm + T3 直加保留 + T4 Step 4；§6 边界（全 OOS 可开、失败固定文案、迟到响应）→T2/T3/T4 Step 7；§7 验收→T4；§8 非目标不建任务。
- **无占位符**：所有代码块完整可贴；错误文案逐字给出；无 "适当处理" 类步骤。
- **类型一致性**：`DrawerView`/`openPicker`/`goToCartView`/`pickerProduct`/`view` 在 T1 定义、T3 消费；`QuickAddViewProps {product,onAdded,onClose}` T2 定义、T3 调用一致；`sellableVariants`/`variantImage`/`sortedProductImages` T1 定义、T2/T3 消费签名一致；`addItem({skuId,quantity},{openDrawer:false})` 与阶段 1 CartContext 签名一致。
- **约束自查**：5 个文件全部在 Global Constraints 白名单；tracking.ts/api.ts/PDP/ProductCard/后端零改动；无新依赖；无 `set-state-in-effect`（新状态全部在事件回调中变更；open effect 未改）。
