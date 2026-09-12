# Admin Panel V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the V1 admin panel — the last V1.0 launch gap (DEVELOPMENT_PLAN Phase 4) — so the business can process orders manually: admin login, order list + detail with Confirm/Cancel, inventory stock adjust, and product/category management, all permission-aware and grounded on the existing backend admin API.

**Architecture:** The admin panel lives inside the existing Next.js app as its own route group at `frontend/src/app/admin/**` with **no storefront chrome** (a `(storefront)` route group takes over the current header/footer layout; root layout becomes minimal — URLs unchanged). A separate client `lib/admin-auth.ts` mirrors `lib/auth.ts` (single-flight refresh, session epoch, safeNext) but uses dedicated localStorage keys `sh_admin_access` / `sh_admin_refresh`. The backend (NestJS 12 + Prisma 7) is the RBAC authority and **needs no changes**; any endpoint gap is documented in the spec §14 and explicitly NOT designed here.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (design tokens in `frontend/src/app/globals.css`); no new npm dependencies; no test framework added (frontend has none). Backend untouched.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-09-12-admin-panel-v1-design.md` — read it alongside this plan; the spec is the binding authority on screens, fields, enums, permissions, and wording.

## Global Constraints

- **No new npm dependencies** (frontend or backend). No backend edits, no migrations. If the UI needs an endpoint/serializer field that does not exist, it is NOT designed here — it is listed under spec §14 "Backend gaps" for the human to authorize separately.
- Admin tokens use their own localStorage keys (`sh_admin_access`, `sh_admin_refresh`); the storefront client (`sh_refresh`, cart keys) is never touched. Admin fetches go to relative `/api/v1/auth/*` and `/api/v1/admin/*` (proxied by `next.config.ts`).
- Exact backend enums, never invented values: `OrderStatus` (NEW/PENDING/QUESTION/CONFIRMED/ABNORMAL/SHIPPING/SIGNED/CANCELLED/DENIED/AFTER_SALES), `ConfirmationStatus` (UNCONFIRMED/NEEDS_REVIEW/CONFIRMED/REJECTED), `PaymentStatus`, `ProductStatus` (DRAFT/ACTIVE/DISABLED), `SkuStatus`, `CategoryStatus`, `SourceType`, `MovementType`, `PermissionCode`.
- No fake data anywhere; real empty states. Storefront COD copy stays "Cash on Delivery"; status labels match the storefront account page's `STATUS_LABELS` wording where applicable.
- Repo root for commands is `small-house-commerce/`; all frontend commands run in `frontend/`. Frontend gates per task: `pnpm lint && pnpm exec tsc --noEmit && pnpm build`.
- **Never stage** `docs/frontend/HOMEPAGE_SPEC.md`, `docs/superpowers/plans/2026-09-11-pdp-refinement.md`, or `docs/research/`. Always `git add <explicit paths>` (quote `(storefront)` paths).
- Commits are per task with explicit paths; do not push without asking.
- Chrome verification runs against the running app (backend `:3000` from `backend/dist/main`, frontend `next start -p 3001`) with seeded admin accounts from `backend/prisma/seed.ts` (SUPER_ADMIN/ADMIN at `dev@smallhouse.test`; create a CONFIRMOR, WAREHOUSE and OPTIMIZER user via `POST /api/v1/users` as SUPER_ADMIN, or ask the human for credentials).

---

## File structure

**Frontend — restructure (Task 1)**
- Modify `frontend/src/app/layout.tsx` — become the minimal root (html/body + globals + metadata only).
- Create `frontend/src/app/(storefront)/layout.tsx` — the current storefront chrome (AnnouncementBar + Header + Footer + Providers + MetaPixelInit + `getNavData`).
- Move `frontend/src/app/{page,cart,account,categories,checkout,collections,login,order-success,products,register,search}` into `frontend/src/app/(storefront)/` (`git mv`; URLs unchanged). `robots.ts`, `sitemap.ts`, `globals.css` stay at root.

**Frontend — admin (Tasks 2–11)**
- Create `frontend/src/lib/admin-auth.ts` — admin token storage, single-flight refresh, epoch guard, `adminAuthedFetch`, `adminApi.login/logout/me`, `hasPermission`, `safeNext` re-export.
- Create `frontend/src/lib/admin-api.ts` — admin response types (`AdminOrder`, `AdminOrderDetail`, `AdminProduct`, `AdminCategoryNode`, `Paged<T>`, enums) + typed client methods over `adminAuthedFetch`.
- Create `frontend/src/components/admin/AdminAuthProvider.tsx` — client provider (status/loading/authed/guest, `admin`, `hasPermission`, `login`, `logout`).
- Create `frontend/src/components/admin/AdminShell.tsx` — client shell: sidebar + topbar + route guard + "no modules" empty state.
- Create `frontend/src/components/admin/Badge.tsx` — status pill with enum→color map (spec §12).
- Create `frontend/src/components/admin/Dialog.tsx` — modal with focus trap, Esc, backdrop, initial focus.
- Create `frontend/src/components/admin/Field.tsx` — `Field`, `TextInput`, `Select`, `Textarea` label+control+error wrappers.
- Create `frontend/src/components/admin/EmptyState.tsx`, `frontend/src/components/admin/Skeleton.tsx`, `frontend/src/components/admin/Pagination.tsx`, `frontend/src/components/admin/PageHeader.tsx`.
- Create `frontend/src/app/admin/layout.tsx` — `AdminAuthProvider` + admin-scoped metadata.
- Create `frontend/src/app/admin/login/page.tsx` — standalone login (no shell).
- Create `frontend/src/app/admin/(shell)/layout.tsx` — wraps children in `AdminShell`.
- Create `frontend/src/app/admin/(shell)/orders/page.tsx`, `frontend/src/app/admin/(shell)/orders/[id]/page.tsx`.
- Create `frontend/src/app/admin/(shell)/inventory/page.tsx`.
- Create `frontend/src/app/admin/(shell)/products/page.tsx`, `frontend/src/app/admin/(shell)/products/new/page.tsx`, `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`.
- Create `frontend/src/app/admin/(shell)/categories/page.tsx`.

**Backend** — none. No schema, no controllers, no DTOs, no migrations.

---

## Task 1: Route-group restructure — chrome-free `/admin` + `(storefront)` group

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Create: `frontend/src/app/(storefront)/layout.tsx`
- Move: `frontend/src/app/{page,cart,account,categories,checkout,collections,login,order-success,products,register,search}` → `frontend/src/app/(storefront)/`

**Interfaces produced (consumed by all later tasks):** `RootLayout` becomes chrome-free; `StorefrontLayout` exports the previous chrome. All page routes are URL-identical (route groups do not change URLs), so no storefront page code changes.

- [ ] **Step 1: Move the storefront routes into `(storefront)`**

Run in `frontend/`:
```bash
mkdir -p 'src/app/(storefront)'
git mv src/app/page.tsx 'src/app/(storefront)/page.tsx'
git mv src/app/cart 'src/app/(storefront)/cart'
git mv src/app/account 'src/app/(storefront)/account'
git mv src/app/categories 'src/app/(storefront)/categories'
git mv src/app/checkout 'src/app/(storefront)/checkout'
git mv src/app/collections 'src/app/(storefront)/collections'
git mv src/app/login 'src/app/(storefront)/login'
git mv src/app/order-success 'src/app/(storefront)/order-success'
git mv src/app/products 'src/app/(storefront)/products'
git mv src/app/register 'src/app/(storefront)/register'
git mv src/app/search 'src/app/(storefront)/search'
```
Leave `layout.tsx`, `globals.css`, `robots.ts`, `sitemap.ts` at the root.

- [ ] **Step 2: Rewrite `src/app/layout.tsx` to the minimal root**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Small House PH — Smart Furniture for Small Homes",
    template: "%s | Small House PH",
  },
  description:
    "Space-saving furniture for Philippine small homes. Cash on delivery, nationwide delivery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
```
(`<body>` keeps `flex min-h-full flex-col` so `(storefront)` and admin each control their own inner shell.)

- [ ] **Step 3: Create `src/app/(storefront)/layout.tsx`**

Move the current root-layout body here verbatim: the `getNavData()` helper, `<Providers>`, `<MetaPixelInit>`, `<AnnouncementBar>`, `<Header navItems>`, `<main className="flex-1">{children}</main>`, `<Footer>`. Imports (`@/lib/nav`, `@/lib/api`, components) are alias-based and unaffected by the move. MetaPixelInit and storefront AuthProvider now load only on storefront routes.

- [ ] **Step 4: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: clean; build lists the same routes as before (home, `/collections`, `/categories/[slug]`, `/products/[slug]`, `/cart`, `/checkout`, `/login`, `/register`, `/account`, `/order-success/[orderNumber]`, `/search`) plus `robots`/`sitemap`. No `/admin` yet.

- [ ] **Step 5: Chrome verification (regression)**

At `http://localhost:3001/` (backend running):
1. Homepage renders with announcement bar + header + footer exactly as before.
2. Mega-menu desktop hover still opens; mobile 390px drawer still works (no regression from the layout move).
3. `/collections` grid, a PDP, `/cart`, `/checkout` all render with header/footer.
4. View source / page title unchanged ("… | Small House PH").

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/app/layout.tsx small-house-commerce/frontend/src/app/'(storefront)'
git commit -m "feat(admin): restructure app into (storefront) group for a chrome-free /admin"
```
Do NOT stage any docs.

---

## Task 2: Admin auth client + API client (`lib/admin-auth.ts`, `lib/admin-api.ts`)

**Files:**
- Create: `frontend/src/lib/admin-auth.ts`
- Create: `frontend/src/lib/admin-api.ts`

**Interfaces produced (consumed by Task 3+):**

`admin-auth.ts`:
```ts
export interface AdminUser {
  id: string; name: string; email: string; status: string;
  roles: { code: string; name: string }[];
  permissions: string[];            // PermissionCode[]
}
export type AdminAuthStatus = "loading" | "authed" | "guest";
export type AdminAuthEvent = "admin-session-start" | "admin-session-end";

export const adminTokenStorage: {
  getAccess(): string | null; setAccess(t: string): void; clearAccess(): void;
  getRefresh(): string | null; setRefresh(t: string): void; clearRefresh(): void;
};

export function onAdminAuthEvent(cb: (e: AdminAuthEvent) => void): () => void;
export function clearAdminSession(): void;
export function refreshAdminAccess(): Promise<string | null>;   // single-flight, epoch-guarded
export function hasPermission(admin: AdminUser | null, code: string): boolean;

export const adminApi: {
  login(email: string, password: string): Promise<AdminUser>;   // POST /auth/login + GET /auth/me
  logout(): Promise<void>;                                      // local clear sync, then POST /auth/logout best-effort
  me(): Promise<AdminUser>;                                     // GET /auth/me via authedFetch
};
export { safeNext } from "./auth";
```

`admin-api.ts` (types + client, all over a shared `adminAuthedFetch` imported from `./admin-auth`):
```ts
export type OrderStatus = "NEW"|"PENDING"|"QUESTION"|"CONFIRMED"|"ABNORMAL"|"SHIPPING"|"SIGNED"|"CANCELLED"|"DENIED"|"AFTER_SALES";
export type ConfirmationStatus = "UNCONFIRMED"|"NEEDS_REVIEW"|"CONFIRMED"|"REJECTED";
export type PaymentStatus = "COD_PENDING"|"COLLECTED"|"SETTLEMENT_PENDING"|"SETTLED"|"ONLINE_PENDING"|"PAID"|"FAILED"|"REFUNDED"|"PARTIALLY_REFUNDED";
export type ProductStatus = "DRAFT"|"ACTIVE"|"DISABLED";
export type SourceType = "FB_POST"|"META_AD"|"ORGANIC"|"DIRECT"|"EMAIL"|"OTHER";

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; }

// MONEY TYPES: the admin controllers return raw Prisma rows, so every Decimal
// field arrives over the wire as a STRING (Prisma Decimal.toJSON() -> string).
// The storefront paths convert with Number() — admin does NOT. Render through
// formatAmount() below. Int fields (quantity, sortOrder, onHand, reserved,
// available) are JSON numbers.

export function formatAmount(value: string | number | null, currency = "₱"): string;
// null/"" -> "—"; otherwise Number(value) via formatPrice from PriceBox.

export interface AdminOrderListRow { id: string; orderNumber: string; orderStatus: OrderStatus; confirmationStatus: ConfirmationStatus;
  paymentStatus: PaymentStatus; currency: string; subtotal: string; discountTotal: string; shippingTotal: string; grandTotal: string; createdAt: string;
  customer: AdminOrderCustomer; items: { id: string; skuCodeSnapshot: string; productNameSnapshot: string; quantity: number; lineTotal: string }[]; }

export interface AdminOrderCustomer { id: string; name: string | null; normalizedPhone: string; email: string | null; currentRiskLevel: string; }
// (Customer has no "phone" column — normalizedPhone is the E.164 identity key.)

export interface AdminOrderItem { id: string; productNameSnapshot: string; skuCodeSnapshot: string; variantSnapshot: string; quantity: number; unitPrice: string; unitDiscount: string; unitCostSnapshot: string | null; lineTotal: string; }
export interface AdminStatusHistory { id: string; statusDomain: string; oldStatus: string | null; newStatus: string; source: string; operatorId: string | null; comment: string | null; createdAt: string; }
export interface AdminOrderDetail extends AdminOrderListRow { items: AdminOrderItem[];
  shippingAddress: { fullName: string; phone: string; province: string; city: string; barangay: string | null; postalCode: string | null; streetAddress: string; landmark: string | null } | null;
  attribution: { sourceType: SourceType; aidSnapshot: string | null; optimizerId: string | null; optimizerNameSnapshot: string | null;
    customerClassification: string | null; facebookPageId: string | null; facebookPostId: string | null; facebookPostTrackingCode: string | null; campaignId: string | null; adsetId: string | null; adId: string | null;
    landingPageId: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null; fbclid: string | null; attributedAt: string } | null;
  payments: { id: string; method: string; status: PaymentStatus; amount: string; reference: string | null; paidAt: string | null }[];
  statusHistory: AdminStatusHistory[];
  reservations: { id: string; skuId: string; quantity: number; status: string; createdAt: string }[]; }

export interface AdminSku { id: string; skuCode: string; status: "ACTIVE"|"DISABLED"; price: string | null; compareAtPrice: string | null;
  supplierSku: string | null; supplierCost: string | null; costCurrency: string | null; landedCost: string | null;
  productWeight: number | null; packageWidth: number | null; packageHeight: number | null; packageDepth: number | null;
  packageWeight: number | null; volumetricWeight: number | null; }
export interface AdminVariant { id: string; name: string; position: number; sku: AdminSku | null; }
export interface AdminProductImage { id: string; url: string; altText: string | null; sortOrder: number; }
export interface AdminProduct { id: string; name: string; slug: string; description: string | null; categoryId: string; status: ProductStatus;
  room: string | null; internalRole: string | null; solutions: string[]; width: number | null; height: number | null; depth: number | null;
  foldedWidth: number | null; foldedHeight: number | null; foldedDepth: number | null; createdAt: string; updatedAt: string;
  images: AdminProductImage[]; variants: AdminVariant[]; }
export interface AdminCategoryNode { id: string; parentId: string | null; name: string; slug: string; sortOrder: number; imageUrl: string | null; status: "ACTIVE"|"DISABLED"; children: AdminCategoryNode[]; }

export const adminApi: {
  listOrders(p: { status?: OrderStatus; search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<Paged<AdminOrderListRow>>;
  getOrder(id: string): Promise<AdminOrderDetail>;
  confirmOrder(id: string): Promise<AdminOrderDetail>;   // returns updated order row
  cancelOrder(id: string): Promise<AdminOrderDetail>;
  listProducts(p: { search?: string; status?: ProductStatus; categoryId?: string; page?: number; pageSize?: number }): Promise<Paged<AdminProduct>>;
  getProduct(id: string): Promise<AdminProduct>;
  createProduct(input: CreateProductInput): Promise<AdminProduct>;
  updateProduct(id: string, input: Partial<CreateProductInput>): Promise<AdminProduct>;
  deleteProduct(id: string): Promise<{ ok: boolean }>;
  listCategories(): Promise<AdminCategoryNode[]>;
  createCategory(input: CreateCategoryInput): Promise<AdminCategoryNode>;
  updateCategory(id: string, input: Partial<CreateCategoryInput>): Promise<AdminCategoryNode>;
  deleteCategory(id: string): Promise<{ ok: boolean }>;
  adjustStock(input: { skuId: string; quantity: number; reason?: string }): Promise<{ onHand: number; reserved: number; available: number }>;
};
export interface CreateProductInput { name: string; slug: string; description: string | null; categoryId: string; status: ProductStatus;
  room: string | null; internalRole: string | null; solutions: string[];
  width: number | null; height: number | null; depth: number | null;
  foldedWidth: number | null; foldedHeight: number | null; foldedDepth: number | null;
  images: { url: string; altText?: string; sortOrder?: number }[];
  variants: { name: string; position?: number; sku?: { skuCode: string; status?: "ACTIVE"|"DISABLED"; price?: number; compareAtPrice?: number; supplierSku?: string; supplierCost?: number; costCurrency?: string; landedCost?: number; productWeight?: number; packageWidth?: number; packageHeight?: number; packageDepth?: number; packageWeight?: number; volumetricWeight?: number } }[];
}
export interface CreateCategoryInput { name: string; slug: string; parentId?: string | null; sortOrder?: number; imageUrl?: string | null; status?: "ACTIVE"|"DISABLED"; }
```
The *request* DTOs above send numbers (zod `z.number()`); only the *response* types are strings for Decimal columns — see the MONEY TYPES note at the top of this interface block. `serializeFormValue` (Task 9) parses form strings to numbers for the request.

- [ ] **Step 1: Write `lib/admin-auth.ts`**

Port `lib/auth.ts` exactly, with these changes: two storage keys under `ADMIN_ACCESS_KEY = "sh_admin_access"` and `ADMIN_REFRESH_KEY = "sh_admin_refresh"`; refresh hits `POST /api/v1/auth/refresh` (NOT the customer refresh route); `login` posts `POST /api/v1/auth/login`, stores both tokens, then returns `me()`; `logout` clears synchronously (epoch bump + wipe both keys + emit) then best-effort `POST /api/v1/auth/logout` with the refresh token; keep `refreshAdminAccess` single-flight + `endAdminSessionIfCurrent` epoch guard + `clearAdminSession` exactly as the storefront version. `adminAuthedFetch` is module-private and mirrors `authedFetch` (401 → refresh once → retry; errors thrown with `readError` message).

- [ ] **Step 2: Write `lib/admin-api.ts`**

Export the types above and the client methods. `listProducts`/`listOrders` build query strings with `URLSearchParams` (page/pageSize defaulted server-side). Every method calls `adminAuthedFetch<T>(path, init)`.

- [ ] **Step 3: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: clean (no consumers yet beyond exports; unused-export lint is fine for a lib module).

- [ ] **Step 4: Chrome verification (smoke via console)**

Obtain tokens with `curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"dev@smallhouse.test","password":"<ADMIN_PASSWORD>"}'`, then in the browser console at `localhost:3001`:
1. `localStorage.setItem('sh_admin_access', '<SUPER_ADMIN access token>'); localStorage.setItem('sh_admin_refresh', '<refresh token>')`.
2. `fetch('/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('sh_admin_access') } })` returns the seeded SUPER_ADMIN `permissions` array containing all 14 codes.
3. Replace `sh_admin_access` with a **customer** token: `/api/v1/auth/me` returns 401 (backend rejects `kind:'customer'`).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/admin-auth.ts small-house-commerce/frontend/src/lib/admin-api.ts
git commit -m "feat(admin): admin auth client (dedicated keys, refresh-flight, epoch guard) + API client"
```

---

## Task 3: AdminAuthProvider, route guard shell, and login page

**Files:**
- Create: `frontend/src/components/admin/AdminAuthProvider.tsx`
- Create: `frontend/src/components/admin/AdminShell.tsx`
- Create: `frontend/src/app/admin/layout.tsx`
- Create: `frontend/src/app/admin/(shell)/layout.tsx`
- Create: `frontend/src/app/admin/login/page.tsx`

**Interfaces produced (consumed by Tasks 4–11):**
```ts
// AdminAuthProvider.tsx
export function AdminAuthProvider({ children }: { children: ReactNode }): ReactNode;
export function useAdminAuth(): {
  status: AdminAuthStatus; admin: AdminUser | null;
  hasPermission(code: string): boolean;
  login(email: string, password: string): Promise<AdminUser>;
  logout(): Promise<void>;
};

// AdminShell.tsx
export function AdminShell({ children }: { children: ReactNode }): ReactNode;
```
The `AdminShell` owns the route guard: `guest → router.replace('/admin/login?next=…')`, `loading →` skeleton, `authed →` shell chrome. It also renders the **"No modules available"** empty state when `nav.length === 0`.

- [ ] **Step 1: `AdminAuthProvider.tsx`**

Port `AuthProvider.tsx` 1:1: `useEffect` bootstrap (`refreshAdminAccess()` → `adminApi.me()` → authed; failure → `clearAdminSession()` → guest), `onAdminAuthEvent('admin-session-end')` listener, `alive` ref guard, `useMemo` context value. `login` = `adminApi.login` then set state; `logout` = `adminApi.logout` then set guest. `hasPermission = (code) => hasPermission(admin, code)`.

- [ ] **Step 2: `src/app/admin/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { AdminAuthProvider } from "@/components/admin/AdminAuthProvider";

export const metadata: Metadata = {
  title: { default: "Admin — Small House PH", template: "%s | Small House Admin" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-background text-ink">
      <AdminAuthProvider>{children}</AdminAuthProvider>
    </div>
  );
}
```

- [ ] **Step 3: `src/app/admin/(shell)/layout.tsx`**

```tsx
import { AdminShell } from "@/components/admin/AdminShell";
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 4: `AdminShell.tsx` (client)**

`NAV_ITEMS` (spec §4.2) with `{ href, label, permission }`: `/admin/orders`→`ORDER_VIEW_ALL`, `/admin/inventory`→`INVENTORY_VIEW`, `/admin/products`→`PRODUCT_MANAGE`, `/admin/categories`→`PRODUCT_MANAGE`. Guard effect per §6 of the spec; render sidebar (desktop `hidden md:flex w-56`, `NavLink` active = `bg-primary-light/40 text-cta`), top bar (title from `usePathname` in plain `text-lg font-semibold` markup — `PageHeader` arrives in Task 4 — user name + first role code chip, Log out `Button variant="text"`), `<main className="md:pl-56">{children}</main>`, and a mobile drawer reusing the mega-menu interaction (hamburger → `fixed inset-y-0 left-0 w-64` + backdrop + Esc + focus return). Loading → a simple centered `animate-pulse` block inline in this task (Task 4's `TableSkeleton` supersedes page-level skeletons later); guest → return `null` (the redirect effect runs). This task depends only on `Button` (exists) — all other primitives arrive in Task 4.

- [ ] **Step 5: `src/app/admin/login/page.tsx` (client)**

Reuse the storefront login page structure (`inputCls`, pending/error state) with: email + password; `login(email, password)` from `useAdminAuth`; on success `router.push(safeNext(searchParams.get('next')) || '/admin/orders')`; 401 → "Invalid email or password."; centered card, heading "Small House Admin", no storefront chrome. Add a "← Back to store" link to `/`.

- [ ] **Step 6: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: build includes `/admin/login`, `/admin/orders`, `/admin/inventory`, `/admin/products`, `/admin/categories`.

- [ ] **Step 7: Chrome verification**

1. `/admin/login` renders the centered card with **no** storefront header/footer.
2. Wrong password → inline "Invalid email or password."
3. Log in as SUPER_ADMIN → lands on `/admin/orders`, sidebar shows Orders / Inventory / Products / Categories, top bar shows name + role + Log out.
4. Log in as **OPTIMIZER** → lands on the "No modules available for your account" empty state (spec §4.2) with working Log out.
5. `/admin/orders` reload while logged out → redirected to `/admin/login?next=%2Fadmin%2Forders`.
6. `?next=https://evil.com` → `safeNext` falls back to `/admin/orders` (no open redirect).

- [ ] **Step 8: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/AdminAuthProvider.tsx small-house-commerce/frontend/src/components/admin/AdminShell.tsx small-house-commerce/frontend/src/app/admin
git commit -m "feat(admin): auth provider, route-guard shell, and login page"
```

---

## Task 4: Admin UI primitives (Badge, Dialog, Field, EmptyState, Skeleton, Pagination, PageHeader)

**Files (all under `frontend/src/components/admin/`):**
- Create: `Badge.tsx`, `Dialog.tsx`, `Field.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `Pagination.tsx`, `PageHeader.tsx`

**Interfaces produced (consumed by Tasks 5–11):**
```ts
// Badge.tsx
export function Badge({ value, tone }: { value: string; tone?: "green"|"amber"|"red"|"neutral" }): ReactNode;
export function statusTone(value: string): "green"|"amber"|"red"|"neutral";   // spec §12 mapping

// Dialog.tsx
export function Dialog({ open, onClose, title, children, width? }: {
  open: boolean; onClose(): void; title: string; children: ReactNode; width?: "sm"|"md";
}): ReactNode | null;   // role=dialog aria-modal, focus trap, Esc, backdrop, initial focus

// Field.tsx
export function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: ReactNode; htmlFor?: string }): ReactNode;
export const inputCls: string;   // shared control classes (storefront inputCls + select/textarea variants)
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): ReactNode;
export function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }): ReactNode;
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode;

// EmptyState.tsx
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): ReactNode;
// Skeleton.tsx
export function TableSkeleton({ rows, cols }: { rows?: number; cols?: number }): ReactNode;
// Pagination.tsx
export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange(p: number): void }): ReactNode;
// PageHeader.tsx
export function PageHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }): ReactNode;
```

- [ ] **Step 1: `Badge.tsx` + `statusTone`**

`statusTone` implements spec §12: green = `CONFIRMED, SIGNED, PAID, COLLECTED, SETTLED, CONSUMED, RELEASED`; amber = `NEW, PENDING, QUESTION, ABNORMAL, SHIPPING, NEEDS_REVIEW, COD_PENDING, ONLINE_PENDING, DRAFT, ACTIVE`; red = `CANCELLED, DENIED, REJECTED, FAILED, REFUNDED, PARTIALLY_REFUNDED, DISABLED`; default neutral. `Badge` renders `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold` with `bg-emerald-100 text-emerald-800` / `bg-amber-100 text-amber-800` / `bg-red-100 text-red-800` / `bg-border/40 text-ink-secondary`, always with the raw enum text (color is enhancement, never the only signal).

- [ ] **Step 2: `Dialog.tsx`**

A `createPortal`-free fixed overlay: backdrop `fixed inset-0 bg-black/50` (click → onClose), panel `fixed left-1/2 top-1/2 w-[min(92vw,<width>)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl`. On `open`: focus the first focusable (or a close button); keydown handler: `Escape` → onClose; a lightweight focus trap cycling `querySelectorAll('button, [href], input, select, textarea')`. `document.body` scroll lock while open. Initial focus on the primary button passed as the last child (callers order buttons Cancel→Confirm).

- [ ] **Step 3: `Field.tsx`**

`Field` = `<label className="flex flex-col gap-1 text-sm font-medium text-ink">{label}<div>{children}</div></label>` + error `<p className="text-xs text-red-700" role="alert">`. `inputCls` reuses the storefront `inputCls` string; `Select`/`Textarea` add `w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none`.

- [ ] **Step 4: `EmptyState`, `Skeleton`, `Pagination`, `PageHeader`**

`EmptyState` = `rounded-xl border border-border bg-card p-6 text-center` with title + muted hint + optional action. `TableSkeleton` = `cols` skeleton `<div className="h-12 animate-pulse rounded bg-border" />` rows. `Pagination` = Prev/Next `Button variant="secondary" size="md"` + `"Page {page} of {max(1, Math.ceil(total/pageSize))}"`; disable Prev at 1, Next when `page >= Math.ceil(total/pageSize)`; no-op when total 0. `PageHeader` = flex row: `text-xl font-semibold text-ink` title + muted `({count})` + right-aligned actions.

- [ ] **Step 5: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 6: Chrome verification**

Place each primitive in a throwaway `src/app/admin/(shell)/__primtest/page.tsx` temporarily (delete before Task 5):
1. Badges render all four tones with readable text on `bg-background`.
2. Dialog: open via button; Tab cycles within the dialog; Esc closes and returns focus to the trigger; backdrop click closes.
3. Pagination at page 1/5 of 100: Prev disabled, "Page 1 of 5", Next enabled; at 5/5 Next disabled.
4. `TableSkeleton` shows pulse rows, no layout shift.

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/Badge.tsx small-house-commerce/frontend/src/components/admin/Dialog.tsx small-house-commerce/frontend/src/components/admin/Field.tsx small-house-commerce/frontend/src/components/admin/EmptyState.tsx small-house-commerce/frontend/src/components/admin/Skeleton.tsx small-house-commerce/frontend/src/components/admin/Pagination.tsx small-house-commerce/frontend/src/components/admin/PageHeader.tsx
git commit -m "feat(admin): UI primitives — Badge, Dialog, Field, EmptyState, Skeleton, Pagination, PageHeader"
```

---

## Task 5: Orders list (`/admin/orders`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/orders/page.tsx` (client)

**Interfaces consumed:** `adminApi.listOrders/confirmOrder/cancelOrder`, `Badge/statusTone`, `Pagination`, `PageHeader`, `EmptyState`, `TableSkeleton`, `Field`/`TextInput`/`Select`, `Dialog`, `useAdminAuth`, `formatAmount` (from `@/lib/admin-api`). **Produced:** none (leaf page).

- [ ] **Step 1: State + URL filters**

`useSearchParams` is the source of truth: `search`, `status`, `dateFrom`, `dateTo`, `page`. A `useEffect` refetches `adminApi.listOrders({...})` on param change (debounce search by 300ms; keep params in sync via `router.replace` with `URLSearchParams`). Loading → `TableSkeleton`; error → inline alert + Retry.

- [ ] **Step 2: Table**

Columns per spec §8.3: Order Number (link `Link href={/admin/orders/${id}}`), Created (`toLocaleString`), Customer (`customer.name` or `—`), Phone (`customer.normalizedPhone`), Items (`{items.length} items` + first `productNameSnapshot`), Total (`formatAmount(grandTotal, currency)`), Order Status / Confirmation Status / Payment Status (`Badge`), Actions.

- [ ] **Step 3: Confirm / Cancel**

Confirm button rendered only when `hasPermission('ORDER_CONFIRM')` AND row eligible (`orderStatus ∉ {CANCELLED, DENIED, SHIPPING, SIGNED}` and `confirmationStatus !== 'CONFIRMED'`); Cancel when `hasPermission('ORDER_CANCEL')` AND not terminal (`∉ {CANCELLED, DENIED, SIGNED, AFTER_SALES}`) and `!== 'SHIPPING'`. Each opens a `Dialog`; Confirm wording: *"Confirm order {orderNumber}? This marks it confirmed for fulfillment."*; Cancel: *"Cancel order {orderNumber}? Reserved stock is released."* On submit: disable buttons, call `confirmOrder(id)` / `cancelOrder(id)`; on success update that row's status cells from the returned order and close; on 400/409 keep the dialog open showing the backend message; on success with a terminal state re-run the current query (server truth).

- [ ] **Step 4: Empty + error states**

Empty: `EmptyState title="No orders found." hint="Try clearing the filters."` when filters active, else `"No orders yet."`. Error: `role="alert"` + Retry.

- [ ] **Step 5: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 6: Chrome verification (seed a COD order first via `/checkout` or `POST /api/v1/storefront/orders`)**

1. List shows the seeded order; statuses render as badges with the correct tone.
2. Search `PH1` → narrows; clear → restores. Status filter `CONFIRMED` → subset. Date range today → the order appears; yesterday → empty state.
3. URL keeps `?page=2&status=…` on reload.
4. Confirm an `UNCONFIRMED` order → dialog → row badges become `CONFIRMED/CONFIRMED`; Confirm button disappears. Confirm again from a fresh reload → 409 message surfaces.
5. Cancel a `CONFIRMED` order → badges show `CANCELLED`; Confirm/Cancel buttons disappear.
6. As CONFIRMOR: list loads, Confirm/Cancel present. As WAREHOUSE: list loads, **no** Confirm/Cancel buttons (no permission). As FINANCE: list loads, read-only.

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/orders/page.tsx
git commit -m "feat(admin): orders list with filters, pagination, inline confirm/cancel"
```

---

## Task 6: Order detail (`/admin/orders/[id]`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/orders/[id]/page.tsx` (client)

**Interfaces consumed:** `adminApi.getOrder/confirmOrder/cancelOrder`, all primitives, `formatAmount`, `useAdminAuth`. **Produced:** none.

- [ ] **Step 1: Fetch + layout**

`useParams().id` → `adminApi.getOrder(id)`. Loading → `TableSkeleton`; 404 → `EmptyState "Order not found."` + back link. Header: back link "← Orders", `PageHeader title={orderNumber}`, Badge row (orderStatus, confirmationStatus, paymentStatus), action bar.

- [ ] **Step 2: Cards**

Per spec §8.4, render: **Order** (createdAt, currency, subtotal, discountTotal, shippingTotal, grandTotal — all via `formatAmount`); **Customer & address** (customer.name + customer.normalizedPhone + shippingAddress fields, em-dash for nulls); **Items** table (productNameSnapshot, variantSnapshot, skuCodeSnapshot, qty, unitPrice, unitDiscount, lineTotal — via `formatAmount`; `unitCostSnapshot` column only when `hasPermission('REPORT_PROFIT_VIEW')`, also via `formatAmount`); **Attribution** (read-only, `sourceType` label + every field, null → em-dash); **Payments** (method, status, amount via `formatAmount`, reference, paidAt); **Timeline** (`statusHistory` asc: `{statusDomain}` Badge-neutral + `{oldStatus ?? '—'} → {newStatus}` + `source` + `operatorId` muted + `comment` + createdAt); **Reservations** (skuId, quantity, status, createdAt).

- [ ] **Step 3: Confirm / Cancel actions**

Same eligibility + wording + error handling as Task 5, but on success **refetch the detail** so the whole page (including timeline) resyncs. Terminal/CONFIRMED orders show no action buttons.

- [ ] **Step 4: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 5: Chrome verification**

1. Open an order from the list → every section renders; attribution shows AID snapshot when present, em-dash otherwise.
2. Timeline lists the `NEW` SYSTEM row; after confirming, two new rows (ORDER_STATUS + CONFIRMATION_STATUS) with operatorId.
3. Confirm then Cancel → cancel works from CONFIRMED (releases reservation); cancel from CANCELLED is impossible (button gone).
4. As FINANCE: no cost-snapshot column. As ADMIN: cost-snapshot column present.
5. Unknown id → "Order not found." empty state.
6. As WAREHOUSE: detail loads, no Confirm/Cancel buttons.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/orders/'[id]'/page.tsx
git commit -m "feat(admin): order detail with attribution, timeline, and confirm/cancel"
```

---

## Task 7: Inventory — stock list + adjust (`/admin/inventory`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/inventory/page.tsx` (client)

**Interfaces consumed:** `adminApi.listProducts/adjustStock`, `Badge`, `Dialog`, `Field/TextInput`, `EmptyState`, `TableSkeleton`, `Pagination`, `PageHeader`, `useAdminAuth`, `formatAmount`. **Produced:** none.

**Scope note (spec §8.5, §14 gap #1):** there is **no stock GET endpoint**. The list is sourced from `GET /admin/products` (search matches product name/slug; SKU-code search is a client-side filter over the loaded page). Live On Hand / Reserved / Available render only for rows adjusted this session (the adjust response returns them); otherwise the Stock cell shows `—`. No movement history in V1.

- [ ] **Step 1: List**

Search input (server-side `search` for product name; client-side filter on `sku.skuCode` for SKU codes), status filter optional, `Pagination` over `Paged<AdminProduct>`. Table columns: SKU Code, Product (name), Variant (variant.name, one row per variant that has a SKU), Price (`formatAmount(sku.price)`), Sku Status + Product Status (Badge), Stock (after-adjust value or `—`), Actions (Adjust).

- [ ] **Step 2: Adjust dialog**

Opened per SKU. Shows SKU read-only; Quantity `TextInput type="number"` (int, nonzero, ±1_000_000); Reason `TextInput` (≤255, required by practice). Confirm wording: *"Adjust stock for {skuCode} by {±n}? Reason: {reason}."* → `adminApi.adjustStock({skuId, quantity, reason})`. On success: inline notice in the dialog *"Updated — on hand {onHand}, reserved {reserved}, available {available}"*, set the row's Stock cell, close on "Done". On 400 (negative on-hand / zero): keep open, show backend message. Adjust button rendered only with `hasPermission('INVENTORY_ADJUST')`.

- [ ] **Step 3: Empty + error**

`EmptyState "No SKUs found."` (no products yet). Error alert + Retry.

- [ ] **Step 4: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 5: Chrome verification**

1. List shows each SKU row (searchable by product name; a SKU code search narrows client-side on the loaded page).
2. Adjust +10 on a SKU → success notice shows the new `onHand/reserved/available`; Stock cell shows the value.
3. Adjust −9999999 on a 0-stock SKU → backend 400 "Adjustment would make on-hand negative" shown in the dialog; dialog stays open.
4. Adjust 0 → service 400 "Adjustment quantity must not be zero" surfaces.
5. As WAREHOUSE: Adjust button hidden. As ADMIN: present.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/inventory/page.tsx
git commit -m "feat(admin): inventory stock list + adjust-with-reason"
```

---

## Task 8: Products list (`/admin/products`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/products/page.tsx` (client)

**Interfaces consumed:** `adminApi.listProducts/deleteProduct/listCategories`, `Badge`, `Dialog`, `EmptyState`, `TableSkeleton`, `Pagination`, `PageHeader`, `Field/TextInput/Select`, `PlaceholderImage` (from `@/components/ui/PlaceholderImage`), `useAdminAuth`, `formatAmount`. **Produced:** none.

- [ ] **Step 1: Filters + table**

Search, Status select (`DRAFT/ACTIVE/DISABLED/All`), Category select (flatten `listCategories()` tree to indented options). Columns: Product (thumb `PlaceholderImage label={name}` + name), Slug, Category (lookup name from tree by categoryId), Status Badge, Price (`formatAmount(first variant SKU price)` else `—`), Variants (`N`), Updated, Actions (Edit link, Delete).

- [ ] **Step 2: Delete**

`hasPermission('PRODUCT_MANAGE')` gate; Dialog wording: *"Delete {name}? Its variants, SKUs and images are removed. This fails if any order references its SKUs."* → `adminApi.deleteProduct(id)`; optimistic row removal; on 400 (Restrict FK → "Referenced record does not exist") show the backend message inline and refetch.

- [ ] **Step 3: New product button**

`PageHeader actions` → `Link` to `/admin/products/new` (PRODUCT_MANAGE only).

- [ ] **Step 4: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 5: Chrome verification**

1. List renders seeded products with thumbnails; search/status/category filters drive the URL and table.
2. Delete an un-referenced product → row disappears (verify it's gone from the storefront too).
3. Delete a product whose SKU is on a seeded order → backend 400 surfaces, product stays.
4. As CONFIRMOR: Products nav absent (permission-filtered) — direct `/admin/products` URL → 401/403 surfaced as an error alert (backend authority).

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/products/page.tsx
git commit -m "feat(admin): products list with filters, pagination, delete"
```

---

## Task 9: Product create form (`/admin/products/new`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/products/new/page.tsx` (client)
- Create: `frontend/src/components/admin/ProductForm.tsx` (shared by new + edit; produces the form + its state serialization)

**Interfaces produced (consumed by Task 10):**
```ts
// ProductForm.tsx
export interface ProductFormValue { name: string; slug: string; description: string; categoryId: string; status: ProductStatus;
  room: string; internalRole: string; solutions: string[]; width: string; height: string; depth: string;
  foldedWidth: string; foldedHeight: string; foldedDepth: string;
  images: { url: string; altText: string; sortOrder: string }[];
  variants: { name: string; position: string; sku: { skuCode: string; status: "ACTIVE"|"DISABLED"; price: string; compareAtPrice: string;
    supplierSku: string; supplierCost: string; costCurrency: string; landedCost: string; productWeight: string;
    packageWidth: string; packageHeight: string; packageDepth: string; packageWeight: string; volumetricWeight: string } | null }[];
}
export function ProductForm({ initial, categories, onSubmit, submitLabel, pending, error }:
  { initial: ProductFormValue; categories: AdminCategoryNode[]; onSubmit(v: ProductFormValue): void;
    submitLabel: string; pending: boolean; error: string | null }): ReactNode;
```
Form keeps **string** state for numbers (so partial edits don't fight controlled inputs) and a pure `serializeFormValue(v): CreateProductInput | Partial<CreateProductInput>` that trims, coerces empty strings → `null` for nullable numbers/strings and `undefined` for omitted (edit) fields, and validates client-side per spec §9 (returns `{ ok: true, value }` or `{ ok: false, error }`).

- [ ] **Step 1: `ProductForm.tsx`**

Sectioned cards: **Basics** (name, slug with kebab hint `* "slug must be lowercase kebab-case (e.g. folding-chair)"`, description textarea, categoryId select from flattened tree, status select, room select + empty option, internalRole select + empty, solutions checkboxes), **Dimensions** (6 number inputs, placeholder optional), **Images** (rows: url + altText + sortOrder + remove; "Add image" appends), **Variants & SKUs** (cards: variant name + position + toggle "Has SKU" + SKU fields skuCode, status, price, compareAtPrice, supplierSku, supplierCost, costCurrency, landedCost, productWeight, packageWidth/Height/Depth, packageWeight, volumetricWeight; "Add variant" appends). Client validation on submit: required name/slug/categoryId; slug regex; skuCode present when a SKU block exists; numeric fields parse as nonnegative. Render `error` as a top `role="alert"`.

- [ ] **Step 2: `new/page.tsx`**

Load `adminApi.listCategories()` (empty tree → EmptyState with link to `/admin/categories`). Render `ProductForm` with `initial` = empty `ProductFormValue` (`status: "DRAFT"`, all numbers `""`). On valid submit → `adminApi.createProduct(serialize)` → `router.push('/admin/products/' + created.id + '/edit')`. On 409 → set error "A product with this slug already exists."; on 400 → backend message.

- [ ] **Step 3: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 4: Chrome verification**

1. New product with one variant + one SKU (price 1299.00) saves → lands on `/admin/products/[id]/edit`; the new product appears in `/admin/products` and on the storefront (status ACTIVE).
2. Duplicate slug → 409 message.
3. Bad slug `Folding Chair` → client validation message before any request.
4. Save with `status: DRAFT` → absent from storefront, visible in admin with DRAFT badge.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/ProductForm.tsx small-house-commerce/frontend/src/app/admin/'(shell)'/products/new/page.tsx
git commit -m "feat(admin): product create form"
```

---

## Task 10: Product edit form (`/admin/products/[id]/edit`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx` (client)
- Consume: `ProductForm` from Task 9.

**Interfaces produced:** `deserializeProduct(p: AdminProduct): ProductFormValue` — maps an admin product (numbers → strings, variant `sku` → sku block or `null`).

- [ ] **Step 1: `edit/page.tsx`**

Fetch `adminApi.getProduct(id)` + `adminApi.listCategories()`; 404 → EmptyState. Render `ProductForm` with `initial = deserializeProduct(product)`.

- [ ] **Step 2: Save semantics (critical)**

`serializeFormValue` for edit must honour `updateProductSchema`: **only changed top-level scalars are sent**; `images` and `variants` are sent **only when the user touched them**, and always as the **complete list** (whole-list replacement); `status` and `solutions` sent only when changed (never empty defaults — would wipe). The cleanest implementation: track a `dirty` set of top-level groups via the form's onChange; on submit build the PATCH from `{...changedScalars, ...(dirtyVariants ? { variants: fullList } : {}), ...(dirtyImages ? { images: fullList } : {})}`. Guard the UI with a note near Save: *"Variants and images are saved as a full replacement."*

- [ ] **Step 3: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 4: Chrome verification**

1. Open an existing product → all fields pre-filled; change name + slug → save → detail reflects it.
2. **Danger case:** edit only the description (do NOT touch variants) → save → variants/SKUs remain untouched (regression guard: the variant still exists with the same SKU).
3. Add a second variant + SKU → save → both variants present; storefront PDP shows the new SKU.
4. Change status ACTIVE → DISABLED → product disappears from storefront; admin shows DISABLED badge.
5. Change price on a SKU → storefront PDP shows the new price.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/products/'[id]'/edit/page.tsx
git commit -m "feat(admin): product edit form with SKU editing (whole-list replacement semantics)"
```

---

## Task 11: Categories CRUD (`/admin/categories`)

**Files:**
- Create: `frontend/src/app/admin/(shell)/categories/page.tsx` (client)

**Interfaces consumed:** `adminApi.listCategories/createCategory/updateCategory/deleteCategory`, `Badge`, `Dialog`, `Field/TextInput/Select`, `EmptyState`, `Skeleton`, `PageHeader`, `useAdminAuth`. **Produced:** none.

- [ ] **Step 1: Tree list**

Render the `listCategories()` tree indented (root rows; children nested with `pl-8`). Each row: name, slug (muted), status Badge, sortOrder (muted), actions (Edit, Delete). "New root category" button in PageHeader; "Add child" on each root.

- [ ] **Step 2: Create / Edit dialog**

Fields: name, slug (kebab), parentId `Select` (flat list of categories with indentation, option "None (root)"), sortOrder (int), imageUrl (url optional), status (ACTIVE/DISABLED). Edit pre-fills; **parentId guard**: the option set excludes the category's own id (client mirror of "A category cannot be its own parent"). Submit → `createCategory` / `updateCategory`; on 409 → "A category with this slug already exists."

- [ ] **Step 3: Delete**

Wording: *"Delete {name}? Child categories move to the root; this fails if any products use it."* → `deleteCategory(id)`; on 400 "Category still has products" show message inline.

- [ ] **Step 4: Gate**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 5: Chrome verification**

1. Tree renders; create a child under an existing root → appears nested; storefront mega menu gains the leaf.
2. Edit a category's slug → storefront `/categories/<new>` works.
3. Delete an empty category → gone. Delete one with products → 400 message, category remains.
4. New product form's category select reflects a newly created category after reload.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/app/admin/'(shell)'/categories/page.tsx
git commit -m "feat(admin): category tree CRUD"
```

---

## Task 12: End-to-end pass + docs

**Files:** none (fixes only if verification fails).

- [ ] **Step 1: Full gates**

```bash
cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build
```
Expected: clean; build includes all `/admin/*` routes plus the unchanged storefront routes.

- [ ] **Step 2: Role matrix Chrome run (desktop ≥1280px + 768px)**

1. **SUPER_ADMIN** — full nav + actions; can log out.
2. **ADMIN** — full nav; confirm/cancel/adjust/edit all work; user-management is NOT in the UI (nav absent).
3. **CONFIRMOR** — Orders only; confirm/cancel work; no Products/Inventory nav; direct `/admin/products` URL surfaces a 403-style error (backend authority).
4. **WAREHOUSE** — Orders (read) + Inventory (read); no Adjust/Confirm/Cancel.
5. **FINANCE** — Orders (read) only; order detail hides the cost-snapshot column.
6. **OPTIMIZER** — "No modules available" empty state.
7. At 768px: sidebar collapses to the top-bar drawer; dialogs stay within the viewport; no horizontal scroll on table pages (tables scroll inside their card).

- [ ] **Step 3: Regression sweep**

Storefront homepage, mega menu, a PDP, cart → checkout → order success still behave (the `(storefront)` move must be invisible). `robots.txt`/`sitemap.xml` still served. Meta Pixel fires only on storefront pages, not `/admin/*`.

- [ ] **Step 4: Docs + final commit if anything was touched**

Confirm the spec's §14 backend-gap list is accurate against what shipped. If verification required fixes, commit with explicit paths:
```bash
git add <paths>
git commit -m "fix(admin): e2e verification fixes"
```
Do NOT stage `docs/frontend/HOMEPAGE_SPEC.md`, the PDP plan file, or `docs/research/`. Do not push without asking.

---

## Notes for the implementer

- **Do not "fix" backend gaps.** If a screen needs data the API does not return (stock levels, movement history, confirmation-status filter, own-orders), the spec §14 list is the contract: implement the UI to the API as it exists, and surface the limitation honestly (spec §8.5). Backend changes await human authorization.
- **Admin pages must never render inside storefront chrome.** If a page appears with the storefront header, the route-group move was not applied correctly (Task 1).
- **Whole-list replacement semantics** (Task 10) are the single most dangerous edit path — the Task 10 Step 4 case #2 regression check exists specifically to catch it.
- Keep exact enum strings everywhere; `statusTone` and labels are the only place human-friendly text is introduced.
