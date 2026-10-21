# 订单备注、缺货说明与结账表单一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在两条 COD 表单上新增非必填的 Order Notes（≤200 字符，持久化到订单并在后台可见），把 PDP 内嵌 COD 表单的布局对齐结账页并把多 ZIP 邮编控件换成紧凑可搜索控件，并在商品卡缺货时说明缺的是哪个组合。

**Architecture:** 备注是订单级数据，走「新增可空列 → DTO 顶层可选字段 → 草稿顶层可选字段 → 两条表单 → 确认页透传 → 后台只读展示」这一条既有链路，不新建实体、不复用客服内部备注表。表单布局与邮编控件都是既有共享组件的复用（`checkoutInputCls`、`PsgcAddressSelects`、`SearchableSelect`），只做最小扩参。商品卡说明是纯展示行，不进入任何选择/SKU/库存判定。

**Tech Stack:** NestJS 12 + Prisma 7.10 + Zod 4 + PostgreSQL 18（backend）；Next.js 16 App Router + React 19 + Tailwind 4 + Vitest 3 + Playwright（frontend）。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-12-order-notes-and-checkout-form-parity-design.md`

## Global Constraints

- **不 commit、不 push、不 merge、不 PR、不 deploy。** 所有任务以「跑通门禁 + 记账」收尾，不产生 commit。
- 不改 SKU、库存、价格、运费、COD、风控分类、下单确认、重复单判定与归因快照逻辑。
- 备注**不得**进入 Meta Pixel 或任何归因事件（`commerce-events.ts` 各事件负载保持显式字段，不整表透传）。
- 备注 ≤200 字符、非必填；空串一律存 `NULL`。
- 前台文案全英文；后台该字段文案固定为「订单备注」。
- 不触碰生产数据、`small-house-commerce/backend/uploads/`、用户自有 3000/3001、marketing-workbench 占用的 3210/3211、本会话自有的 3216/3217。
- 共享 PostgreSQL 5432 上的迁移必须串行；本计划只对一次性 e2e 库 `small_house_variant_test` 执行 `migrate deploy`。
- 每次 `prisma/schema` 变更后必须 `pnpm exec prisma generate`，否则 `tsc` 看不到新字段。

## Review Focus

规格隐含、但单个任务测试不会覆盖的输入类别，按最可能伤到真实用户排序：

1. **多字节字符的长度语义**：`.max(200)` 与 `<textarea maxLength={200}>` 都按 UTF-16 单元计数，一个 emoji 记 2。200 个 emoji 会在 100 个字符处被截断。要求：客户端与服务端对同一字符串给出一致结论（Task 2/4 各自加一条代理对断言）。
2. **纯空白/纯换行备注**：`"\n\n"` 与 `"   "` 必须归一为 `NULL`，而不是存一个看不见的字符串（Task 2/4）。
3. **备注里的 HTML/脚本字符**：`<script>alert(1)</script>` 必须原样作为文本渲染，不能成为标记（Task 6 后台、Task 7 确认页各加一条断言）。
4. **无空格长串**：连续 200 个非空格字符不得把卡片、确认页或后台行撑出横向滚动（Task 7 的 390px 断言 + 容器 `break-words`）。
5. **超长草稿**：手工塞进 sessionStorage 的超长/非字符串 `customerNote` 必须被收敛为 ≤200 的字符串或 `null`，且不影响同草稿其它字段的恢复（Task 3）。

---

### Task 1: 浏览器验收通道（e2e 端口可覆盖）

**Files:**
- Modify: `small-house-commerce/frontend/playwright.config.ts:38-39`
- Test: 现有 `e2e/pdp-quick-cod.spec.ts`（不改文件，作为回归证据）

**Interfaces:**
- Consumes: 无。
- Produces: `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` 环境变量（缺省 3210/3211 不变）。后续所有浏览器任务用 `E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221` 运行，避免与 marketing-workbench 运行副本（PID 7646/7653，占用 3210/3211）冲突。

**为什么需要：** 当前 `playwright.config.ts` 把端口写死为 3211/3210，而 marketing-workbench 计划的运行副本正占着这两个端口。硬跑会绑定失败；改端口是唯一不动别人进程的办法。

- [ ] **Step 1: 改端口为环境变量（保留原缺省）**

`small-house-commerce/frontend/playwright.config.ts`：

```ts
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3211);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3210);
```

（`FRONTEND_ORIGIN`、两个 `webServer` 条目与 `BACKEND_ENV.PORT` 已经引用这两个常量，无需再改。）

- [ ] **Step 2: 用覆盖端口跑一遍既有 e2e，确认通道可用**

Run（工作目录 `small-house-commerce/frontend`）:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/pdp-quick-cod.spec.ts
```
Expected: 全部通过（这是既有测试，只换端口）；`lsof -nP -iTCP:3220 -iTCP:3221` 在结束后不再有监听。

- [ ] **Step 3: 确认缺省端口行为未变**

Run:
```bash
grep -n "E2E_FRONTEND_PORT\|E2E_BACKEND_PORT" playwright.config.ts
```
Expected: 只有 `?? 3211` / `?? 3210` 两处默认值，没有其它调用点被改写。

---

### Task 2: 后端订单备注（迁移 + DTO + 持久化）

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/order.prisma`（`confirmationNote` 附近，第 187 行前后）
- Create: `small-house-commerce/backend/prisma/migrations/20261014180000_add_order_customer_note/migration.sql`
- Modify: `small-house-commerce/backend/src/modules/orders/dto/order.dto.ts:4-15`
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:170-173`
- Test: `small-house-commerce/backend/src/modules/orders/dto/order.dto.spec.ts`（新建）
- Test: `small-house-commerce/backend/src/modules/orders/orders.service.attribution.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: 无。
- Produces: `checkoutSchema` 顶层 `customerNote: string | null`（缺省 `null`）；`Prisma.OrderCreateInput.customerNote?: string | null`；订单行 `customer_note TEXT NULL`。

- [ ] **Step 1: 写失败测试 — DTO 契约**

Create `small-house-commerce/backend/src/modules/orders/dto/order.dto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './order.dto.js';

const SKU = '66666666-6666-4666-a666-666666666666';
const base = {
  customer: {
    name: 'Jane',
    phone: '09171234567',
    province: 'Metro Manila',
    city: 'Manila',
    streetAddress: '1 Main St',
  },
  items: [{ skuId: SKU, quantity: 1 }],
  attribution: {},
};

describe('checkoutSchema customer note', () => {
  it('keeps a trimmed note', () => {
    expect(checkoutSchema.parse({ ...base, customerNote: '  Call before delivery  ' }).customerNote)
      .toBe('Call before delivery');
  });

  it('normalizes empty and whitespace-only notes to null', () => {
    expect(checkoutSchema.parse({ ...base, customerNote: '' }).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: '   ' }).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: '\n\n' }).customerNote).toBeNull();
  });

  it('treats an omitted or explicit null note as null', () => {
    expect(checkoutSchema.parse(base).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: null }).customerNote).toBeNull();
  });

  it('accepts 200 characters and rejects 201', () => {
    expect(checkoutSchema.parse({ ...base, customerNote: 'x'.repeat(200) }).customerNote)
      .toBe('x'.repeat(200));
    expect(checkoutSchema.safeParse({ ...base, customerNote: 'x'.repeat(201) }).success).toBe(false);
  });

  it('counts a surrogate pair as two units, matching the browser maxLength', () => {
    // '\u{1F600}' is two UTF-16 units; 100 of them is exactly 200 units.
    const hundred = '\u{1F600}'.repeat(100);
    expect(checkoutSchema.parse({ ...base, customerNote: hundred }).customerNote).toBe(hundred);
    expect(checkoutSchema.safeParse({ ...base, customerNote: hundred + '\u{1F600}' }).success).toBe(false);
  });

  it('rejects a non-string note', () => {
    expect(checkoutSchema.safeParse({ ...base, customerNote: 42 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, customerNote: { text: 'x' } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/orders/dto/order.dto.spec.ts
```
Expected: FAIL —— `expected undefined to be 'Call before delivery'` 等（字段尚不存在），不是导入错误。

- [ ] **Step 3: 写失败测试 — 持久化**

在 `small-house-commerce/backend/src/modules/orders/orders.service.attribution.spec.ts` 末尾追加（复用该文件既有的 `setup()` harness）：

```ts
describe('customer note persistence', () => {
  it('writes the customer note on the order row', async () => {
    const h = setup();
    const input = h.input(undefined, {});
    input.customerNote = 'Call before delivery';
    await h.service.checkout(input);
    expect(h.writes[0]).toMatchObject({ customerNote: 'Call before delivery' });
  });

  it('writes null when the shopper left the note empty', async () => {
    const h = setup();
    await h.service.checkout(h.input(undefined, {}));
    expect(h.writes[0]).toMatchObject({ customerNote: null });
  });

  it('never copies the note into the attribution snapshot', async () => {
    const h = setup();
    const input = h.input(undefined, {});
    input.customerNote = 'Call before delivery';
    await h.service.checkout(input);
    expect(Object.keys(h.writes[0].attribution!.create!)).not.toContain('customerNote');
    expect(JSON.stringify(h.writes[0].attribution)).not.toContain('Call before delivery');
  });
});
```

- [ ] **Step 4: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/orders/orders.service.attribution.spec.ts
```
Expected: 新 3 条 FAIL（`customerNote` 未写入 / `input.customerNote` 不存在于类型），原 6 条仍通过。

- [ ] **Step 5: 最小实现 — schema 与迁移**

`small-house-commerce/backend/prisma/schema/order.prisma`，在 `confirmationNote` 下一行插入：

```prisma
  /// Shopper-supplied delivery note at checkout (≤200 chars). Distinct from
  /// `confirmationNote` (service confirmation log) and from `OrderNote`
  /// (internal append-only service notes, §46).
  customerNote           String?            @map("customer_note")
```

Create `small-house-commerce/backend/prisma/migrations/20261014180000_add_order_customer_note/migration.sql`:

```sql
SET lock_timeout = '5s';
ALTER TABLE "orders" ADD COLUMN "customer_note" TEXT;
```

- [ ] **Step 6: 最小实现 — DTO 与写入**

`small-house-commerce/backend/src/modules/orders/dto/order.dto.ts`，在 `preferredDeliveryDate` 之前插入：

```ts
  // Shopper-supplied delivery note. Trimmed, empty -> null, ≤200 UTF-16 units
  // (same unit the browser textarea maxLength counts). Never sent to pixels.
  customerNote: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null),
```

`small-house-commerce/backend/src/modules/orders/orders.service.ts`，在 `preferredDeliveryDate: ...` 之后插入：

```ts
          customerNote: input.customerNote ?? null,
```

- [ ] **Step 7: 生成 client 并跑绿**

Run:
```bash
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend exec vitest run src/modules/orders/
pnpm --dir small-house-commerce/backend exec tsc --noEmit
```
Expected: `order.dto.spec.ts` 6/6 通过；attribution spec 9/9 通过；`tsc` EXIT=0。

- [ ] **Step 8: 把迁移应用到一次性 e2e 库并验证列存在**

Run:
```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public' \
  pnpm --dir small-house-commerce/backend exec prisma migrate deploy
docker exec small-house-postgres psql -U postgres -d small_house_variant_test -c '\d orders' | grep customer_note
```
Expected: `migrate deploy` 应用 1 个新迁移；`customer_note | text |` 一行出现。

---

### Task 3: 草稿契约（customerNote 往返 + 旧草稿兼容）

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/checkoutDraft.ts:11-17,54-85`
- Test: `small-house-commerce/frontend/src/lib/checkoutDraft.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `CheckoutDraft.customerNote?: string | null`；`writeCheckoutDraft(customer, preferredDeliveryDate?, selection?, customerNote?)`；`readCheckoutDraft()` 返回的草稿**始终**带 `customerNote: string | null`。

- [ ] **Step 1: 写失败测试**

追加到 `small-house-commerce/frontend/src/lib/checkoutDraft.spec.ts`：

```ts
const DRAFT_KEY = "luwag_checkout_draft";
const customer = {
  name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila",
  barangay: "Barangay 1", postalCode: "1100", streetAddress: "1 Main St", landmark: "Blue gate",
};

describe("checkout draft order note", () => {
  it("round-trips the note through write and read", () => {
    writeCheckoutDraft(customer, null, undefined, "Call before delivery");
    expect(readCheckoutDraft()?.customerNote).toBe("Call before delivery");
  });

  it("stores null when the caller omits the note", () => {
    writeCheckoutDraft(customer, null);
    expect(readCheckoutDraft()?.customerNote).toBeNull();
  });

  it("loads a legacy draft written before the field existed", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, savedAt: "2026-10-01T00:00:00.000Z" }));
    const draft = readCheckoutDraft();
    expect(draft?.customerNote).toBeNull();
    expect(draft?.customer.name).toBe("Jane");
  });

  it("coerces a non-string or over-long stored note instead of dropping the draft", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, savedAt: "x", customerNote: 42 }));
    expect(readCheckoutDraft()?.customerNote).toBeNull();

    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ customer, savedAt: "x", customerNote: "x".repeat(400) }));
    expect(readCheckoutDraft()?.customerNote).toHaveLength(200);
    expect(readCheckoutDraft()?.customer.phone).toBe("09171234567");
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/checkoutDraft.spec.ts
```
Expected: 新 4 条 FAIL（`customerNote` 为 `undefined`），原有断言仍通过。

- [ ] **Step 3: 最小实现**

`checkoutDraft.ts` 接口新增：

```ts
  /** 客户填写的订单备注（≤200 字符）；null/缺省 = 未填。订单级数据，故在顶层。 */
  customerNote?: string | null;
```

`readCheckoutDraft()` 在 `return parsed;` 之前插入归一化：

```ts
    const note =
      typeof parsed.customerNote === "string" && parsed.customerNote.trim() !== ""
        ? parsed.customerNote.trim().slice(0, 200)
        : null;
    return { ...parsed, customerNote: note };
```

`writeCheckoutDraft` 增加第 4 个参数：

```ts
export function writeCheckoutDraft(
  customer: CheckoutDraftCustomer,
  preferredDeliveryDate: string | null = null,
  selection?: CheckoutDraftSelection,
  customerNote: string | null = null,
): void {
  ...
      JSON.stringify({
        customer,
        preferredDeliveryDate,
        customerNote,
        selection,
        savedAt: new Date().toISOString(),
      }),
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/checkoutDraft.spec.ts
```
Expected: 全绿；既有 `writeCheckoutDraft(customer, date, selection)` 调用点不受影响。

---

### Task 4: 结账页（Cart Checkout）Order Notes 字段

**Files:**
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx:93-103,153-160,666-669,358-380`
- Create: `small-house-commerce/frontend/e2e/order-notes.spec.ts`

**Interfaces:**
- Consumes: `writeCheckoutDraft(..., customerNote)`（Task 3）；`readCheckoutDraft().customerNote`（Task 3）。
- Produces: 表单状态 `customerNote: string`；`data-testid="checkout-order-notes"`；草稿中的 `customerNote`。测试 id 供 Task 5/6 的浏览器断言复用。

- [ ] **Step 1: 写失败测试 — 浏览器（Cart Checkout 路径）**

Create `small-house-commerce/frontend/e2e/order-notes.spec.ts`（自带最小 helper，不改动其它 spec）：

```ts
import { expect, test, type Page } from "@playwright/test";

const SLUG = "e2e-color-size";
const NOTE = "Call before delivery";

async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
}

/** PDP -> order-now -> confirm dialog -> /checkout (Buy Now entry of the same form). */
async function gotoCheckoutViaCart(page: Page): Promise<void> {
  await page.goto(`/products/${SLUG}`);
  await page.getByTestId("add-to-cart").click();
  const picker = page.getByRole("dialog", { name: "Add to cart" });
  await expect(picker).toBeVisible();
  await picker.getByTestId(`picker-confirm-${SLUG}`).click();
  await goto(page, "/cart");
  await page.getByTestId("proceed-checkout").click();
  await expect(page).toHaveURL(/\/checkout/);
}

async function fillAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("checkout-postal-code").fill("1100");
  await page.getByPlaceholder("House no., street, subdivision").fill("12 E2E Street");
}

async function draftNote(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem("luwag_checkout_draft");
    return raw ? (JSON.parse(raw).customerNote ?? null) : null;
  });
}

test.describe("order notes", () => {
  test("cart checkout renders the optional note field and stores it in the draft", async ({ page }) => {
    await gotoCheckoutViaCart(page);
    const notes = page.getByTestId("checkout-order-notes");
    await expect(notes).toBeVisible();
    await expect(notes).toHaveAttribute("maxlength", "200");
    await expect(notes).toHaveAttribute(
      "placeholder",
      "Any special delivery instructions? (e.g. Please call before delivery)",
    );

    await fillAddress(page);
    await notes.fill(NOTE);
    await page.getByTestId("review-order").click();
    await expect(page).toHaveURL(/\/checkout\/confirm/);
    expect(await draftNote(page)).toBe(NOTE);
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run（工作目录 `small-house-commerce/frontend`）:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
```
Expected: FAIL —— `getByTestId('checkout-order-notes')` 找不到元素（locator timeout）。

- [ ] **Step 3: 最小实现**

`CheckoutForm.tsx` 表单状态加字段（第 93-103 行）：

```ts
    landmark: "",
    customerNote: "",
    preferredDeliveryDate: defaultPreferredDeliveryDate(),
```

草稿恢复（第 155-159 行）：

```ts
        setForm((f) => ({
          ...f,
          ...d.customer,
          customerNote: d.customerNote ?? "",
          preferredDeliveryDate: d.preferredDeliveryDate ?? "",
        }));
```

提交写入（`goToReview()` 内的 `writeCheckoutDraft({...}, form.preferredDeliveryDate.trim() || null)` 调用处，第 358-380 行）追加第 4 个实参：

```ts
      form.preferredDeliveryDate.trim() || null,
      form.customerNote.trim() || null,
```

字段渲染（紧跟 Landmark 的 `</label>` 之后，第 669 行后）：

```tsx
              <label className="col-span-full flex flex-col gap-1 text-sm font-medium text-ink">
                Order Notes (Optional)
                <textarea
                  id="checkout-order-notes"
                  data-testid="checkout-order-notes"
                  className={`${inputCls} min-h-[3.5rem] resize-y`}
                  rows={2}
                  maxLength={200}
                  value={form.customerNote}
                  onChange={(e) => setForm((f) => ({ ...f, customerNote: e.target.value }))}
                  placeholder="Any special delivery instructions? (e.g. Please call before delivery)"
                />
              </label>
```

（备注不进 `CheckoutField`、不进 `validateCheckoutForm`：非必填、不阻塞提交。）

- [ ] **Step 4: 跑测试确认 GREEN**

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
pnpm exec tsc --noEmit
```
Expected: 1 passed；`tsc` EXIT=0。

---

### Task 5: PDP 内嵌 COD 表单布局对齐 + Order Notes

**Files:**
- Modify: `small-house-commerce/frontend/src/components/product/PdpQuickCodOrder.tsx:178-188,223-226,319-330,533-575,796-1025`
- Test: `small-house-commerce/frontend/e2e/order-notes.spec.ts`（追加 describe）
- Test: `small-house-commerce/frontend/src/components/product/PdpQuickCodOrder.spec.tsx`（追加断言）

**Interfaces:**
- Consumes: Task 3 的草稿契约。
- Produces: 表单状态 `customerNote: string`；`data-testid="quick-cod-order-notes"`；分区标题 `Contact Information` / `Delivery Address`；外层网格 `grid grid-cols-1 gap-4 sm:grid-cols-2`。

- [ ] **Step 1: 写失败测试 — 浏览器**

追加到 `e2e/order-notes.spec.ts`：

```ts
test.describe("PDP inline COD order notes", () => {
  test("matches the checkout two-column layout and keeps the note through review", async ({ page }) => {
    await page.goto(`/products/${SLUG}`);
    await expect(page.getByTestId("quick-cod-order-notes")).toBeVisible();
    await expect(page.getByTestId("quick-cod-order-notes")).toHaveAttribute("maxlength", "200");
    await expect(page.getByRole("heading", { name: "Contact Information" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delivery Address" })).toBeVisible();

    // Desktop: Full Name and Mobile Number share one row (two-column grid).
    const name = await page.getByLabel("Full Name *").boundingBox();
    const phone = await page.getByLabel("Mobile Number *").boundingBox();
    expect(name && phone && Math.abs(name.y - phone.y)).toBeLessThan(4);
    expect(phone!.x).toBeGreaterThan(name!.x + 100);

    await page.getByTestId("quick-cod-order-notes").fill(NOTE);
    await page.getByTestId("quick-cod-review").click();
    await expect(page).toHaveURL(/\/checkout\/confirm/);
    expect(await draftNote(page)).toBe(NOTE);
  });

  test("does not overflow horizontally at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/products/${SLUG}`);
    await page.getByTestId("quick-cod-order-notes").fill("x".repeat(200));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
```

（`quick-cod-review` 是 PDP 表单提交按钮的既有 testid；若实际不同，先 `grep -n 'data-testid' PdpQuickCodOrder.tsx` 取真实值再写死。）

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
```
Expected: Task 4 的 1 条通过；新增 2 条 FAIL（找不到备注字段/标题）。

- [ ] **Step 3: 最小实现 — 状态、恢复与提交**

表单状态加 `customerNote: ""`（`landmark` 之后）。

草稿恢复（第 223-226 行）改为：

```ts
      setForm({
        ...draft.customer,
        customerNote: draft.customerNote ?? "",
        preferredDeliveryDate: draft.preferredDeliveryDate ?? "",
      });
```

`goToReview()` 的 `writeCheckoutDraft(customer, date, selection)` 调用追加第 4 个实参：

```ts
      form.customerNote.trim() || null,
```

- [ ] **Step 4: 最小实现 — 网格与分区**

外层 `<div className="grid gap-4 sm:grid-cols-2">`（第 796 行）改为：

```tsx
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
```

`Full Name` 与 `Mobile Number` 两个 `<div className="sm:col-span-2">` 各去掉 `sm:col-span-2`（变为 `<div>`），使其在 `sm` 断点并排；手机号说明 `<p>` 保留 `sm:col-span-2`。

在 Full Name 之前插入分区标题，并把 `Use my location` 从独立整行移到 Delivery Address 标题行右侧：

```tsx
            <h3 className="col-span-full text-base font-semibold text-ink">Contact Information</h3>
```
```tsx
            <div className="col-span-full mt-2 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-ink">Delivery Address</h3>
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={submitting || locating}
                className="text-sm font-medium text-cta hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {locating ? "Locating…" : "Use my location"}
              </button>
            </div>
```

（原先那个含定位按钮与两条提示的 `sm:col-span-2` 容器只保留两条提示，标题行不再重复按钮；`locationError` / `locationNotice` 的渲染与 testid 不动。）

- [ ] **Step 5: 最小实现 — 备注字段**

在 Landmark 的 `</div>`（第 987 行）之后、Preferred delivery date 之前插入：

```tsx
            <div className="col-span-full">
              <label
                htmlFor="quick-cod-order-notes"
                className="text-sm font-medium text-ink"
              >
                Order Notes (Optional)
              </label>
              <textarea
                id="quick-cod-order-notes"
                name="customerNote"
                data-testid="quick-cod-order-notes"
                className={`mt-1 ${inputCls} min-h-[3.5rem] resize-y`}
                rows={2}
                maxLength={200}
                value={form.customerNote}
                onChange={(event) =>
                  setForm((current) => ({ ...current, customerNote: event.target.value }))
                }
                placeholder="Any special delivery instructions? (e.g. Please call before delivery)"
                disabled={submitting}
              />
            </div>
```

- [ ] **Step 6: 单测断言（表单状态与草稿写入）**

追加到 `PdpQuickCodOrder.spec.tsx`：渲染后 `screen.getByTestId("quick-cod-order-notes")` 可见且 `maxLength === 200`；输入后提交，断言 `checkoutDraft.writeCheckoutDraft` 的第 4 个实参等于输入值；断言备注不进入 `api.createOrder`（PDP 表单不直接下单）。

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/product/PdpQuickCodOrder.spec.tsx
```
Expected: 先 RED（找不到元素），实现后全绿。

- [ ] **Step 7: 跑绿**

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
pnpm exec tsc --noEmit && pnpm exec vitest run src/components/product/PdpQuickCodOrder.spec.tsx
```
Expected: 3 passed；`tsc` EXIT=0；单测全绿。

---

### Task 6: 确认页显示 + 请求体透传

**Files:**
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.tsx:164-175,401-409`
- Test: `small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.spec.tsx`

**Interfaces:**
- Consumes: 草稿的 `customerNote`（Task 3）；`POST /storefront/orders` 的 `customerNote`（Task 2）。
- Produces: 请求体顶层 `customerNote`；`data-testid="confirm-order-notes"`。

- [ ] **Step 1: 写失败测试**

追加到 `CheckoutConfirmView.spec.tsx`（该文件已有 `validDraft` 与 `api.createOrder` mock）：

```tsx
it("sends the order note in the checkout payload", async () => {
  draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "Call before delivery" });
  render(<CheckoutConfirmView />);
  await userEvent.click(await screen.findByTestId("confirm-place-order"));
  await waitFor(() => expect(api.createOrder).toHaveBeenCalled());
  expect(api.createOrder.mock.calls[0][0]).toMatchObject({ customerNote: "Call before delivery" });
});

it("shows the order note read-only on the confirm page and omits the line when empty", async () => {
  draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "Call before delivery" });
  const { unmount } = render(<CheckoutConfirmView />);
  expect(await screen.findByTestId("confirm-order-notes")).toHaveTextContent("Call before delivery");
  unmount();

  draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: null });
  render(<CheckoutConfirmView />);
  await screen.findByTestId("confirm-address");
  expect(screen.queryByTestId("confirm-order-notes")).toBeNull();
});

it("renders note markup as literal text", async () => {
  draftMock.readCheckoutDraft.mockReturnValue({ ...validDraft, customerNote: "<b>bold</b>" });
  render(<CheckoutConfirmView />);
  expect(await screen.findByTestId("confirm-order-notes")).toHaveTextContent("<b>bold</b>");
  expect(screen.queryByText("bold", { selector: "b" })).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/checkout/CheckoutConfirmView.spec.tsx
```
Expected: 3 条 FAIL（payload 无 `customerNote`；找不到 `confirm-order-notes`）。

- [ ] **Step 3: 最小实现**

请求体（第 164-175 行）加一行：

```ts
        preferredDeliveryDate: draft.preferredDeliveryDate ?? null,
        customerNote: draft.customerNote ?? null,
```

只读展示（`Preferred delivery date` 段落之后，第 409 行后）：

```tsx
            {draft.customerNote ? (
              <p className="mt-3 text-sm text-ink-secondary" data-testid="confirm-order-notes">
                <span className="font-medium text-ink">Order Notes: </span>
                <span className="whitespace-pre-wrap break-words">{draft.customerNote}</span>
              </p>
            ) : null}
```

- [ ] **Step 4: 跑绿**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/checkout/CheckoutConfirmView.spec.tsx
```
Expected: 全绿。

---

### Task 7: 后台订单详情「订单备注」

**Files:**
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/orders/[id]/page.tsx:733-745`
- Test: `small-house-commerce/frontend/src/app/admin/(shell)/orders/[id]/page.spec.tsx`（若不存在则新建最小渲染测试）

**Interfaces:**
- Consumes: 订单详情响应的 `customerNote`（Task 2，`include` 取整行标量，无需改 select）。
- Produces: 配送信息区只读行 `订单备注`。

- [ ] **Step 1: 写失败测试**

若已有该页的渲染测试，追加一条；否则新建并复用页面现有 mock 约定：

```tsx
it("shows the customer order note as a read-only delivery row", async () => {
  renderOrderDetail({ ...baseOrder, customerNote: "Call before delivery" });
  expect(await screen.findByText("订单备注")).toBeInTheDocument();
  expect(screen.getByText("Call before delivery")).toBeInTheDocument();
});

it("shows the placeholder when the note is null and renders markup literally", async () => {
  const { unmount } = renderOrderDetail({ ...baseOrder, customerNote: null });
  expect(await screen.findByText("订单备注")).toBeInTheDocument();
  unmount();

  renderOrderDetail({ ...baseOrder, customerNote: "<b>bold</b>" });
  expect(await screen.findByText("<b>bold</b>")).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/orders/[id]/page.spec.tsx'
```
Expected: FAIL（找不到「订单备注」）。

- [ ] **Step 3: 最小实现**

`addressRows` 数组（第 733-737 行 Landmark 之后）追加：

```tsx
        {
          label: "订单备注",
          value: <span className="whitespace-pre-wrap break-words">{textOrDash(order.customerNote)}</span>,
        },
```

（与既有 `Order Notes (N)` 卡片分开：那张卡是客服内部 append-only 备注，本行是客户填写的订单备注。后台不提供编辑入口。）

- [ ] **Step 4: 跑绿**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run 'src/app/admin/(shell)/orders/[id]/page.spec.tsx'
pnpm exec tsc --noEmit
```
Expected: 全绿；`tsc` EXIT=0。

---

### Task 8: 邮编控件改为紧凑可搜索

**Files:**
- Modify: `small-house-commerce/frontend/src/components/checkout/SearchableSelect.tsx:16-30,71-79,186-207`
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx:612-640`
- Modify: `small-house-commerce/frontend/src/components/product/PdpQuickCodOrder.tsx:904-934`
- Test: `small-house-commerce/frontend/src/components/checkout/SearchableSelect.spec.tsx`（新建）

**Interfaces:**
- Consumes: 无。
- Produces: `SearchableSelect` 新增可选 `optionLabel?: (value: string) => string`（缺省恒等，仅影响展示与筛选文本，提交值不变）。

- [ ] **Step 1: 写失败测试**

Create `SearchableSelect.spec.tsx`：

```tsx
it("labels options through optionLabel while committing the raw value", async () => {
  const onChange = vi.fn();
  render(
    <SearchableSelect
      id="postal" testId="postal" value="" options={["1422", "1400"]}
      onChange={onChange} placeholder="Pick a postal code" searchPlaceholder="Search a ZIP code"
      ariaLabel="Pick a postal code" optionLabel={(zip) => `${zip} — Area ${zip}`}
    />,
  );
  await userEvent.click(screen.getByTestId("postal"));
  await userEvent.click(screen.getByRole("option", { name: "1422 — Area 1422" }));
  expect(onChange).toHaveBeenCalledWith("1422");
});

it("filters on the label text", async () => {
  render(<SearchableSelect id="postal" testId="postal" value="" options={["1422", "1400"]}
    onChange={vi.fn()} placeholder="p" searchPlaceholder="s" ariaLabel="a"
    optionLabel={(zip) => (zip === "1422" ? "1422 — Novaliches" : "1400 — Tondo")} />);
  await userEvent.type(screen.getByTestId("postal"), "Novaliches");
  expect(screen.getByRole("option", { name: "1422 — Novaliches" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "1400 — Tondo" })).toBeNull();
});

it("keeps identity labelling when optionLabel is omitted", async () => {
  render(<SearchableSelect id="p" testId="p" value="Manila" options={["Manila", "Cebu"]}
    onChange={vi.fn()} placeholder="p" searchPlaceholder="s" ariaLabel="a" />);
  await userEvent.click(screen.getByTestId("p"));
  expect(screen.getByRole("option", { name: "Manila" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/checkout/SearchableSelect.spec.tsx
```
Expected: 前两条 FAIL（`optionLabel` 未生效/类型不存在）；第三条通过。

- [ ] **Step 3: 最小实现（SearchableSelect）**

新增可选 prop：

```ts
  /** Display/filter text for an option; the committed value stays `options[i]`. */
  optionLabel?: (value: string) => string;
```

组件内：

```ts
  const label = optionLabel ?? ((value: string) => value);
```

`filtered` 改为按 label 匹配（保持「已选值永远置顶」逻辑）：

```ts
    const base = q ? options.filter((o) => label(o).toLowerCase().includes(q)) : options;
```

`<li>` 的 `key`/`aria-selected`/比较仍用原始值，仅 `<span className="truncate">` 内容改为 `{label(name)}`。

- [ ] **Step 4: 写失败测试（两条表单的邮编控件）**

追加到 `e2e/order-notes.spec.ts`：

```ts
test("multi-ZIP cities use the compact searchable postal control on both forms", async ({ page }) => {
  await gotoCheckoutViaCart(page);
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("psgc-barangay").fill("Bagong Silangan");
  await page.getByRole("option", { name: "Bagong Silangan", exact: true }).first().click();

  const postal = page.getByTestId("checkout-postal-code-pick");
  await expect(postal).toBeVisible();
  await expect(postal).toHaveAttribute("role", "combobox");
  await postal.click();
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("checkout-postal-code")).not.toHaveValue("");
});
```

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
```
Expected: 该条 FAIL（仍是原生 `<select>`，没有 `role="combobox"`）。

- [ ] **Step 5: 最小实现（两条表单）**

`CheckoutForm.tsx` 第 615-640 行的 `<select>` 替换为：

```tsx
                {postalLookup.options.length > 1 ? (
                  <SearchableSelect
                    id="checkout-postal-code-pick"
                    testId="checkout-postal-code-pick"
                    value={postalLookup.options.some((o) => o.zip === form.postalCode) ? form.postalCode : ""}
                    options={postalLookup.options.map((o) => o.zip)}
                    onChange={(zip) => setForm((f) => ({ ...f, postalCode: zip }))}
                    placeholder={postalLookup.auto ? "Change postal code" : "Pick a postal code"}
                    searchPlaceholder="Search a ZIP code"
                    ariaLabel="Pick a postal code"
                    optionLabel={(zip) => {
                      const match = postalLookup.options.find((o) => o.zip === zip);
                      return match ? `${match.zip} — ${match.label}` : zip;
                    }}
                  />
                ) : null}
```

`PdpQuickCodOrder.tsx` 第 904-934 行的 `<select>` 做同样替换（`onChange` 用 `setForm((current) => ({ ...current, postalCode: zip }))`，保留 `disabled={submitting}` 语义）。

两个文件都需要 `import { SearchableSelect } from "./SearchableSelect";`（PDP 文件用相对路径 `@/components/checkout/SearchableSelect`）。

- [ ] **Step 6: 跑绿**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/checkout/SearchableSelect.spec.tsx
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts
pnpm exec tsc --noEmit
```
Expected: 单测全绿；e2e 5 passed；`tsc` EXIT=0。

---

### Task 9: 商品卡缺货说明

**Files:**
- Modify: `small-house-commerce/frontend/src/components/product/ProductCard.tsx:100-111`
- Test: `small-house-commerce/frontend/src/components/product/ProductCard.spec.tsx`
- Test: `small-house-commerce/frontend/e2e/product-card-v2.spec.ts:470-481`

**Interfaces:**
- Consumes: `primaryLine.selectedValueIds`、`primaryDerived.resolvedVariant`、`product.options`。
- Produces: `data-testid="card-out-of-stock-note"`，文本 `<值1> / <值2> is out of stock`。

- [ ] **Step 1: 写失败测试 — 单测**

追加到 `ProductCard.spec.tsx`（该文件已有把某个变体库存设为 0 的 helper，见第 292 行附近）：

```tsx
it("explains which selected combination is out of stock", async () => {
  const product = buildProduct();
  product.variants[1]!.sku!.availableInventory = 0;
  renderCard(product);
  await userEvent.click(screen.getByRole("button", { name: "Blue" }));
  const note = await screen.findByTestId("card-out-of-stock-note");
  expect(note).toHaveTextContent(/out of stock/i);
  expect(note.textContent).toMatch(/Blue/);
});

it("shows no out-of-stock line when the resolved combination is available", () => {
  renderCard(buildProduct());
  expect(screen.queryByTestId("card-out-of-stock-note")).toBeNull();
});
```

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/product/ProductCard.spec.tsx
```
Expected: 第 1 条 FAIL（找不到 `card-out-of-stock-note`）；第 2 条通过。

- [ ] **Step 2: 最小实现**

`ProductCard.tsx`，在 `const outOfStock = ...` 之后加入标签推导（按 `option.position` 顺序，取已选真实选项值）：

```ts
  const outOfStockLabels = outOfStock
    ? [...product.options]
        .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
        .map((option) => {
          const valueId = primaryLine.selectedValueIds[option.id];
          return option.values.find((value) => value.id === valueId)?.label;
        })
        .filter((label): label is string => Boolean(label))
    : [];
```

在 `<Button ...>` 之前渲染：

```tsx
    {outOfStockLabels.length > 0 ? (
      <p data-testid="card-out-of-stock-note" className="mb-2 text-xs text-ink-muted">
        {`${outOfStockLabels.join(" / ")} is out of stock`}
      </p>
    ) : null}
```

（只在缺货时渲染，正常款式不增加任何高度；`Save for Later`、`Out of Stock` 标记、× 缺货标记、加购请求与 SKU 判定全部不动。）

- [ ] **Step 3: 跑单测确认 GREEN**

Run:
```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/product/ProductCard.spec.tsx
```
Expected: 全绿。

- [ ] **Step 4: 写失败测试 — 浏览器（真实缺货组合）**

在 `e2e/product-card-v2.spec.ts` 既有的 sparse 测试（第 470-481 行）内追加：

```ts
  const note = item.getByTestId("card-out-of-stock-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/is out of stock$/);
```

并在同一个文件里加一条「有货卡片没有该行」的断言（用 `main` 商品）：

```ts
  await expect(card(page, main).getByTestId("card-out-of-stock-note")).toHaveCount(0);
```

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/product-card-v2.spec.ts
```
Expected: sparse 那条 FAIL（找不到 `card-out-of-stock-note`），其余通过。

- [ ] **Step 5: 跑绿**

Run:
```bash
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/product-card-v2.spec.ts
```
Expected: 全绿。

---

## 最终验收

- [ ] **后端全量**

```bash
pnpm --dir small-house-commerce/backend exec vitest run
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend run lint
```
Expected: 全绿（既有 717 条 + 本计划新增）；`tsc` EXIT=0；lint 无新增 error。

- [ ] **前端全量**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend run lint
```
Expected: 全绿（既有 1765 条 + 新增）；`tsc` EXIT=0。

- [ ] **浏览器全量（覆盖端口，不打扰 peer 的 3210/3211）**

```bash
cd small-house-commerce/frontend
E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/order-notes.spec.ts e2e/pdp-quick-cod.spec.ts e2e/product-card-v2.spec.ts e2e/variant-options-media.spec.ts
```
Expected: 全绿；结束后 3220/3221 无残留监听。

- [ ] **人工核对（DevTools）**

1. 结账页与 PDP 内嵌 COD 表单：桌面下 Full Name / Mobile Number 并排，Order Notes 独占一行且约两行高；390px 无横向滚动。
2. 多 ZIP 城市：邮编控件为可键入筛选的紧凑控件，选择后主输入框填入 ZIP，区域名在列表内可见。
3. sparse 商品卡：切换到缺货组合时出现 `Blue / Small is out of stock`，按钮为 `Save for Later`；有货组合无该行。
4. 后台订单详情：配送信息区出现「订单备注」，与 `Order Notes (N)` 卡片分开。
5. Network：`POST /storefront/orders` 请求体含 `customerNote`；Pixel/归因事件负载中不出现备注文本。
6. 回读订单行：`SELECT customer_note FROM orders WHERE order_number = '...'` 与填写值一致；旧订单该列为 `NULL`。

- [ ] **记账**

把每个任务的 RED/GREEN 证据、`Ruling:` 行与最终门禁结果写入 `.superpowers/sdd/2026-10-12-order-notes-and-checkout-form-parity/progress.md`；不产生 commit。

## Self-Review

**1. 规格覆盖**

| 规格条目 | 对应任务 |
|---|---|
| §3 商品卡缺货说明 | Task 9 |
| §4 邮编控件 | Task 8 |
| §5 PDP 表单布局对齐 | Task 5 |
| §6.1 数据模型 | Task 2 |
| §6.2 接口 | Task 2 |
| §6.3 草稿 | Task 3 |
| §6.4 界面（两条表单） | Task 4、Task 5 |
| §6.5 流程保留 | Task 4、Task 5、Task 6 |
| §6.6 后台展示 | Task 7 |
| §6.7 追踪与隐私边界 | Task 2（服务层断言）、最终验收（Network 核对） |
| §7 测试与验收 | 每个任务的 RED/GREEN + 最终验收 |
| §8 不做与发布边界 | Global Constraints + 各任务「不动」清单 |

**2. 占位符扫描**：无 TBD/TODO；所有代码步骤均给出可粘贴代码与真实文件行号。

**3. 类型一致性**：`customerNote`（DTO 顶层、草稿顶层、表单状态、请求体、后台行）全程同名；`optionLabel` 在 `SearchableSelect` 定义处与两条表单调用处签名一致；`writeCheckoutDraft` 第 4 参数在两个调用点（CheckoutForm、PdpQuickCodOrder）顺序一致。

**4. Review Focus 归属**：多字节长度语义 → Task 2 Step 1；纯空白 → Task 2 Step 1；HTML 字面量 → Task 6 Step 1、Task 7 Step 1；无空格长串 → Task 5 Step 1（390px）；超长草稿 → Task 3 Step 1。
