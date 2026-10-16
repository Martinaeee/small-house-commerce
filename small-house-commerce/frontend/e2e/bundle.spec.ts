import { test, expect } from "@playwright/test";

const email = process.env.BUNDLE_E2E_EMAIL;
const password = process.env.BUNDLE_E2E_PASSWORD;
const slug = process.env.BUNDLE_E2E_PRODUCT_SLUG;
const soldOutSlug = process.env.BUNDLE_E2E_SOLD_OUT_SLUG;
const skuId = process.env.BUNDLE_E2E_SKU_ID;
const componentId = process.env.BUNDLE_E2E_COMPONENT_ID;
const componentProductId = process.env.BUNDLE_E2E_COMPONENT_PRODUCT_ID;
const database = process.env.BUNDLE_E2E_DATABASE;
const API = "http://127.0.0.1:3240/api/v1";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.beforeEach(async ({ baseURL }) => {
  test.skip(!email || !password || !slug || !soldOutSlug || !skuId || !componentId || !componentProductId || !database, "Requires the owned Bundle fixture driver");
  expect(baseURL).toBe("http://127.0.0.1:3241");
  expect(database).toMatch(/^small_house_bundle_20261016_[a-z0-9]+$/);
});

for (const width of [1440, 390, 375]) {
  test(`purchases and cancels one visible Bundle line at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/products/${slug}`, { waitUntil: "load" });
    await page.locator("#boot-splash").waitFor({ state: "detached" });
    await expect(page.getByTestId("add-to-cart")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`bundle-pdp-${width}.png`), fullPage: width === 375 });

    await page.getByTestId("add-to-cart").click();
    const cart = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /Your Cart/ }) });
    await expect(cart).toBeVisible();
    await expect(cart.getByText("₱2,499.00", { exact: true }).first()).toBeVisible();
    await cart.getByRole("link", { name: "CHECKOUT", exact: true }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await page.getByTestId("proceed-checkout").click();
    await expect(page).toHaveURL(/\/checkout/);
    const phone = `0994${String(Date.now() % 10000000).padStart(7, "0")}`;
    await page.getByPlaceholder("Juan Dela Cruz").fill("Bundle Browser Buyer");
    await page.getByPlaceholder("0917 123 4567").fill(phone);
    await page.getByTestId("psgc-province").fill("Metro Manila");
    await page.getByRole("option", { name: /Metro Manila/i }).first().click();
    await page.getByTestId("psgc-city").fill("Quezon");
    await page.getByRole("option", { name: /Quezon/i }).first().click();
    await page.getByTestId("checkout-postal-code").fill("1100");
    await page.getByPlaceholder("House no., street, subdivision").fill("12 Bundle Browser Street");
    await page.getByTestId("review-order").click();
    await expect(page.getByTestId("confirm-place-order")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const checkoutResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/storefront/orders" && response.request().method() === "POST");
    await page.getByTestId("confirm-place-order").click();
    const placed = await checkoutResponse;
    expect(placed.status()).toBe(201);
    const receipt = await placed.json();
    await expect(page.getByTestId("order-number")).toContainText(receipt.orderNumber);
    await page.screenshot({ path: test.info().outputPath(`bundle-order-${width}.png`), fullPage: true });
    const lookup = await fetch(`${API}/storefront/orders/lookup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderNumber: receipt.orderNumber, phone }) });
    expect(lookup.status).toBe(200);
    const visible = await lookup.json();
    expect(visible.items).toHaveLength(1);
    expect(visible.items[0]).toMatchObject({ skuId, quantity: 1 });
    expect(visible.items[0]).not.toHaveProperty("bundleSnapshot");
    expect(Number(visible.grandTotal)).toBe(2499);
    expect(JSON.stringify(visible.items)).not.toContain(componentId!);

    await page.goto(`/admin/login?next=${encodeURIComponent(`/admin/orders/${visible.id}`)}`, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      return form && Object.keys(form).some(key => key.startsWith("__reactProps$"));
    });
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[type="password"]').fill(password!);
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/login" && response.request().method() === "POST");
    await page.locator('button[type="submit"]').click();
    const login = await loginResponse;
    expect(login.status()).toBe(200);
    const auth = await login.json();
    await page.waitForURL(url => !url.pathname.includes("/login"));
    const headers = { authorization: `Bearer ${auth.accessToken}` };
    const before = await fetch(`${API}/admin/products/${componentProductId}`, { headers });
    expect(before.status).toBe(200);
    const component = (await before.json()).variants[0].sku;
    expect([component.onHand, component.reserved, component.availableInventory]).toEqual([9, 2, 7]);
    await page.getByRole("button", { name: "Cancel order", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel order", exact: true });
    await expect(dialog).toBeVisible();
    const cancelResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/admin/orders/${visible.id}/cancel` && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Cancel order", exact: true }).click();
    expect((await cancelResponse).status()).toBe(201);
    await expect(dialog).toBeHidden();
    const after = await fetch(`${API}/admin/products/${componentProductId}`, { headers });
    expect(after.status).toBe(200);
    const released = (await after.json()).variants[0].sku;
    expect([released.onHand, released.reserved, released.availableInventory]).toEqual([9, 0, 9]);
    expect(errors).toEqual([]);
  });
}

test("shows the ordinary out-of-stock purchase boundary for an unusable Bundle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto(`/products/${soldOutSlug}`, { waitUntil: "load" });
  await page.locator("#boot-splash").waitFor({ state: "detached" });
  await expect(page.getByTestId("oos-contact")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath("bundle-out-of-stock-375.png"), fullPage: true });
  expect(errors).toEqual([]);
});
