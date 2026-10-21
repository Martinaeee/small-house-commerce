import { request as playwrightRequest, expect, test, type Page } from "@playwright/test";
import { E2E_API } from "./e2e-origins";

/**
 * Order notes across both COD forms (2026-10-12 spec).
 *
 * The note is optional free text: it must reach the draft, survive
 * Review -> Confirm -> Place -> Success, come back when the shopper edits, and
 * never leak into tracking. Runs against the disposable seeded database the
 * other storefront gates use (see playwright.config.ts).
 */

const SLUG = "e2e-color-size";
const NOTE = "Call before delivery";

/** The PDP renders the shared selector twice; option lookups are hero-scoped. */
async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  const value = page
    .locator("#pdp-purchase")
    .getByRole("group", { name: optionName, exact: true })
    .getByRole("button", { name: valueLabel, exact: true });
  await expect(async () => {
    await value.click();
    await expect(value).toHaveAttribute("aria-pressed", "true");
  }).toPass({ timeout: 15_000 });
}

/** Cart entry into the checkout form: PDP -> cart -> /checkout. */
async function gotoCheckoutViaCart(page: Page): Promise<void> {
  await page.goto(`/products/${SLUG}`);
  await selectValue(page, "Color", "Red");
  await selectValue(page, "Size", "Medium");
  await page.getByTestId("add-to-cart").click();
  const picker = page.getByRole("dialog", { name: "Add to cart" });
  await expect(picker).toBeVisible();
  await picker.getByTestId(`picker-confirm-${SLUG}`).click();

  await page.goto("/cart");
  await page.getByTestId("proceed-checkout").click();
  await expect(page).toHaveURL(/\/checkout/);
}

async function fillCheckoutAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("checkout-postal-code").fill("1100");
  await page.getByPlaceholder("House no., street, subdivision").fill("12 E2E Street");
}

async function fillPdpAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("psgc-barangay").fill("Bagong Silangan");
  await page.getByRole("option", { name: "Bagong Silangan", exact: true }).first().click();
  await page.getByPlaceholder("House no., street, subdivision").fill("12 E2E Street");
}

async function draftNote(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem("luwag_checkout_draft");
    return raw ? (JSON.parse(raw).customerNote ?? null) : null;
  });
}

/** The inline COD submit only enables once a sellable combination is set. */
async function sellableVariantId(): Promise<string> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(`${E2E_API}/storefront/products/${SLUG}`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as
      | { product: { variants: { id: string; sku: { id: string } | null }[] } }
      | { variants: { id: string; sku: { id: string } | null }[] };
    const product = "product" in body ? body.product : body;
    const variant = product.variants.find((candidate) => candidate.sku !== null);
    if (!variant) throw new Error("seed has no sellable variant");
    return variant.id;
  } finally {
    await context.dispose();
  }
}

test.describe("order notes", () => {
  test("cart checkout renders the optional note field and stores it in the draft", async ({
    page,
  }) => {
    await gotoCheckoutViaCart(page);

    const notes = page.getByTestId("checkout-order-notes");
    await expect(notes).toBeVisible();
    await expect(notes).toHaveAttribute("maxlength", "200");
    await expect(notes).toHaveAttribute(
      "placeholder",
      "Any special delivery instructions? (e.g. Please call before delivery)",
    );

    await fillCheckoutAddress(page);
    await notes.fill(NOTE);
    await page.getByTestId("review-order").click();

    await expect(page).toHaveURL(/\/checkout\/confirm/);
    expect(await draftNote(page)).toBe(NOTE);
  });
});

test.describe("PDP inline COD order notes", () => {
  test("matches the checkout two-column layout and keeps the note through review", async ({
    page,
  }) => {
    const variantId = await sellableVariantId();
    await page.goto(`/products/${SLUG}?variant=${variantId}`);

    const notes = page.getByTestId("quick-cod-order-notes");
    await expect(notes).toBeVisible();
    await expect(notes).toHaveAttribute("maxlength", "200");
    await expect(page.getByRole("heading", { name: "Contact Information" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delivery Address" })).toBeVisible();

    // Desktop: Full Name and Mobile Number share one row (two-column grid).
    const name = await page.getByLabel("Full Name *").boundingBox();
    const phone = await page.getByLabel("Mobile Number *").boundingBox();
    expect(name && phone && Math.abs(name.y - phone.y)).toBeLessThan(4);
    expect(phone!.x).toBeGreaterThan(name!.x + 100);

    await fillPdpAddress(page);
    await notes.fill(NOTE);
    await page.getByTestId("quick-cod-submit").click();
    await expect(page).toHaveURL(/\/checkout\/confirm\?/);
    expect(await draftNote(page)).toBe(NOTE);
  });

  test("does not overflow horizontally at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/products/${SLUG}`);
    await page.getByTestId("quick-cod-order-notes").fill("x".repeat(200));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("multi-ZIP cities use the compact searchable postal control", async ({
    page,
  }) => {
    await gotoCheckoutViaCart(page);
    await page.getByTestId("psgc-province").fill("Metro Manila");
    await page.getByRole("option", { name: /Metro Manila/i }).first().click();
    await page.getByTestId("psgc-city").fill("Quezon");
    await page.getByRole("option", { name: "Quezon", exact: true }).first().click();

    const postal = page.getByTestId("checkout-postal-code-pick");
    await expect(postal).toBeVisible();
    // SearchableSelect is an <input role=combobox>, not a native <select>.
    expect(await postal.evaluate((el) => el.tagName)).toBe("INPUT");
    await postal.click();
    await page.getByRole("option").first().click();
    await expect(page.getByTestId("checkout-postal-code")).not.toHaveValue("");
  });
});

const ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const ADMIN_PASSWORD = "E2eAdminPass123!";

async function adminLogin(): Promise<{ accessToken: string; refreshToken: string }> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.post(`${E2E_API}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(response.ok(), `admin login ${await response.text()}`).toBeTruthy();
    return (await response.json()) as { accessToken: string; refreshToken: string };
  } finally {
    await context.dispose();
  }
}

async function openAdminOrder(page: Page, orderId: string): Promise<void> {
  const { refreshToken } = await adminLogin();
  await page.addInitScript((token) => {
    window.localStorage.setItem("sh_admin_refresh", token);
    window.localStorage.setItem("luwag_admin_lang", "zh");
  }, refreshToken);
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

test.describe("admin order detail note", () => {
  test("a placed order note is stored, returned by the admin API and shown on the detail page", async ({
    page,
  }) => {
    await gotoCheckoutViaCart(page);
    const notes = page.getByTestId("checkout-order-notes");
    await fillCheckoutAddress(page);
    await notes.fill(NOTE);
    await page.getByTestId("review-order").click();
    await expect(page).toHaveURL(/\/checkout\/confirm/);
    await expect(page.getByTestId("confirm-order-notes")).toContainText(NOTE);
    await page.getByTestId("confirm-place-order").click();
    await expect(page).toHaveURL(/\/order-success\/PH\d+$/);
    const orderNumber = new URL(page.url()).pathname.split("/").pop()!;

    const { accessToken } = await adminLogin();
    const context = await playwrightRequest.newContext();
    let orderId: string;
    try {
      const list = await context.get(
        `${E2E_API}/admin/orders?search=${encodeURIComponent(orderNumber)}&page=1&pageSize=1`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(list.ok(), `list ${await list.text()}`).toBeTruthy();
      const listed = (await list.json()) as { items: { id: string }[] };
      expect(listed.items.length).toBeGreaterThanOrEqual(1);
      orderId = listed.items[0]!.id;

      const detail = await context.get(`${E2E_API}/admin/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(detail.ok(), `detail ${await detail.text()}`).toBeTruthy();
      const order = (await detail.json()) as { customerNote?: string | null };
      expect(order.customerNote).toBe(NOTE);
    } finally {
      await context.dispose();
    }

    await openAdminOrder(page, orderId);
    await expect(page.getByText("订单备注")).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();
  });
});
