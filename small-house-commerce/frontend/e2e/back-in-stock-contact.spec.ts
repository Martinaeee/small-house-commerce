import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { E2E_API as API } from "./e2e-origins";

const RUN_ID = `${Date.now()}-${process.pid}`;
const CARD_EMAIL = `stock-card-${RUN_ID}@example.com`;
const PDP_EMAIL = `stock-pdp-${RUN_ID}@example.com`;
const STICKY_EMAIL = `stock-sticky-${RUN_ID}@example.com`;
const CANCEL_EMAIL = `stock-cancel-${RUN_ID}@example.com`;
const ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const ADMIN_PASSWORD = "E2eAdminPass123!";
const SUPPORT_MESSENGER = "https://m.me/luwag-e2e";
const SUPPORT_EMAIL = "support-e2e@example.com";
const SUPPORT_PHONE = "+63 (917) 555-0101";
const SUPPORT_PHONE_HREF = "tel:+639175550101";

interface ProductJson {
  id: string;
  name: string;
  slug: string;
  options: {
    id: string;
    name: string;
    values: { id: string; label: string }[];
  }[];
  variants: {
    id: string;
    name: string;
    sku: {
      id: string;
      skuCode: string;
      availableInventory: number;
    } | null;
  }[];
}

interface BackInStockRow {
  id: string;
  email: string;
  skuId: string;
  status: "PENDING" | "SENT" | "CANCELLED";
  productName: string;
  productSlug: string;
  skuCode: string;
  variantName: string;
  lastError: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BackInStockPage {
  page: number;
  pageSize: number;
  total: number;
  items: BackInStockRow[];
}

interface StockBatchResult {
  skuId: string;
  ok: boolean;
  onHand?: number;
  reserved?: number;
  available?: number;
  error?: string;
}

let api: APIRequestContext;
let accessToken = "";
let refreshToken = "";
let sizeOnly: ProductJson;
let colorSize: ProductJson;
let relatedOos: ProductJson;
let sizeSmallSku: NonNullable<ProductJson["variants"][number]["sku"]>;
let blueSmallVariant: ProductJson["variants"][number];
let blueSmallSku: NonNullable<ProductJson["variants"][number]["sku"]>;
let relatedSku: NonNullable<ProductJson["variants"][number]["sku"]>;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function responseJson<T>(response: APIResponse, label: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${label}: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function adminGet<T>(path: string): Promise<T> {
  return responseJson<T>(
    await api.get(`${API}${path}`, { headers: authHeaders() }),
    `GET ${path}`,
  );
}

async function adminPut<T>(path: string, data: unknown): Promise<T> {
  return responseJson<T>(
    await api.put(`${API}${path}`, { headers: authHeaders(), data }),
    `PUT ${path}`,
  );
}

async function fetchProduct(slug: string): Promise<ProductJson> {
  const body = await responseJson<ProductJson | { product: ProductJson }>(
    await api.get(`${API}/storefront/products/${slug}`, {
      headers: { "Cache-Control": "no-cache" },
    }),
    `GET product ${slug}`,
  );
  return "product" in body ? body.product : body;
}

function skuByCode(product: ProductJson, skuCode: string) {
  const variant = product.variants.find((row) => row.sku?.skuCode === skuCode);
  if (!variant?.sku) throw new Error(`Missing seeded SKU ${skuCode}`);
  return { variant, sku: variant.sku };
}

async function setStock(skuId: string, onHand: number): Promise<void> {
  const results = await adminPut<StockBatchResult[]>(
    "/admin/inventory/stock/batch",
    [{ skuId, onHand, reason: `Back-in-stock E2E ${RUN_ID}` }],
  );
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ skuId, ok: true, onHand });
}

async function alertRows(): Promise<BackInStockRow[]> {
  const result = await adminGet<BackInStockPage>(
    "/admin/newsletter/back-in-stock?page=1&pageSize=100",
  );
  return result.items;
}

async function alertFor(email: string): Promise<BackInStockRow> {
  const rows = (await alertRows()).filter((row) => row.email === email);
  expect(rows, `one stock alert row for ${email}`).toHaveLength(1);
  return rows[0]!;
}

async function primeBrowser(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("luwag_newsletter_popup_seen", "1");
      window.sessionStorage.setItem("luwag_chat_nudge_dismissed", "1");
      if (window.localStorage.getItem("sh_admin_refresh") === null) {
        window.localStorage.setItem("sh_admin_refresh", token);
      }
      window.localStorage.setItem("luwag_admin_lang", "zh");
    },
    { token: refreshToken },
  );
}

async function submitNotify(
  page: Page,
  scope: Locator,
  email: string,
  skuId: string,
): Promise<Locator> {
  await scope
    .getByRole("button", { name: "Notify me when back in stock", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Back in stock alert" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email address").fill(email);
  const request = page.waitForRequest(
    (candidate) =>
      candidate.method() === "POST" &&
      candidate.url().endsWith("/api/v1/storefront/back-in-stock"),
  );
  await dialog.getByRole("button", { name: "Notify me", exact: true }).click();
  const submitted = await request;
  expect(submitted.postDataJSON()).toEqual({ email, skuId });
  await expect(dialog).toContainText("We'll email you when it's back in stock.");
  return dialog;
}

function adminAlertRow(page: Page, email: string): Locator {
  return page.getByRole("row").filter({ hasText: email });
}

async function openBackInStockAdmin(page: Page): Promise<void> {
  await page.goto("/admin/newsletter");
  await expect(page).not.toHaveURL(/\/admin\/login/);
  await page.getByRole("tab", { name: "有货通知", exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(
  locator: Locator,
  width: number,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
}

const browserErrors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
  });
  const login = await responseJson<{
    accessToken: string;
    refreshToken: string;
  }>(
    await api.post(`${API}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }),
    "admin login",
  );
  accessToken = login.accessToken;
  refreshToken = login.refreshToken;

  [sizeOnly, colorSize, relatedOos] = await Promise.all([
    fetchProduct("e2e-size-only"),
    fetchProduct("e2e-color-size"),
    fetchProduct("e2e-related-oos"),
  ]);
  sizeSmallSku = skuByCode(sizeOnly, "E2E-SIZE-S").sku;
  ({ variant: blueSmallVariant, sku: blueSmallSku } = skuByCode(
    colorSize,
    "E2E-CS-BLUE-S",
  ));
  relatedSku = skuByCode(relatedOos, "E2E-RELATED-OOS").sku;

  await setStock(sizeSmallSku.id, 0);
  await setStock(blueSmallSku.id, 0);
  await setStock(relatedSku.id, 0);
});

test.afterAll(async () => {
  await api?.dispose();
});

test.beforeEach(async ({ page }) => {
  const login = await responseJson<{
    accessToken: string;
    refreshToken: string;
  }>(
    await api.post(`${API}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }),
    "fresh browser admin login",
  );
  accessToken = login.accessToken;
  refreshToken = login.refreshToken;

  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await primeBrowser(page);
});

test.afterEach(async ({ page }) => {
  const errors = browserErrors.get(page) ?? [];
  expect(
    errors,
    `expected zero console/page/hydration errors, got:\n${errors.join("\n")}`,
  ).toEqual([]);
});

test.describe.serial("back-in-stock and contact channels", () => {
  test("ProductCard submits the exact OOS SKU, leaks no tracking data, and appears PENDING in admin", async ({
    page,
  }) => {
    await page.goto("/categories/e2e-catalog");
    const card = page
      .locator(`article[data-product-id="${sizeOnly.id}"]`)
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Out of Stock", { exact: true })).toBeVisible();

    const postRequests: { url: string; body: string }[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") {
        postRequests.push({ url: request.url(), body: request.postData() ?? "" });
      }
    });
    await page.evaluate(() => {
      const target = window as unknown as {
        __stockAlertPixelCalls: unknown[][];
        fbq: (...args: unknown[]) => void;
      };
      target.__stockAlertPixelCalls = [];
      target.fbq = (...args: unknown[]) => {
        target.__stockAlertPixelCalls.push(args);
      };
    });

    const dialog = await submitNotify(page, card, CARD_EMAIL, sizeSmallSku.id);
    const alertRequest = postRequests.filter((entry) =>
      entry.url.endsWith("/api/v1/storefront/back-in-stock"),
    );
    expect(alertRequest).toHaveLength(1);
    const forbiddenRequests = postRequests.filter(
      (entry) =>
        !entry.url.endsWith("/api/v1/storefront/back-in-stock") &&
        (/marketing\/touch|\/orders(?:\/|$)|facebook\.com\/tr/i.test(entry.url) ||
          entry.body.includes(CARD_EMAIL) ||
          entry.body.includes(sizeSmallSku.id)),
    );
    expect(forbiddenRequests).toEqual([]);
    const pixelCalls = await page.evaluate(() =>
      (window as unknown as { __stockAlertPixelCalls: unknown[][] })
        .__stockAlertPixelCalls,
    );
    expect(JSON.stringify(pixelCalls)).not.toContain(CARD_EMAIL);
    expect(JSON.stringify(pixelCalls)).not.toContain(sizeSmallSku.id);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();

    await expect(alertFor(CARD_EMAIL)).resolves.toMatchObject({
      email: CARD_EMAIL,
      skuId: sizeSmallSku.id,
      skuCode: "E2E-SIZE-S",
      variantName: "Small",
      status: "PENDING",
      notifiedAt: null,
    });

    await openBackInStockAdmin(page);
    const row = adminAlertRow(page, CARD_EMAIL);
    await expect(row).toContainText("E2E-SIZE-S");
    await expect(row).toContainText("Small");
    await expect(row).toContainText("待发送");
  });

  test("manual zero-to-positive stock sends through the log gateway once", async ({
    page,
  }) => {
    await setStock(sizeSmallSku.id, 1);
    const sent = await alertFor(CARD_EMAIL);
    expect(sent).toMatchObject({
      status: "SENT",
      lastError: null,
      notifiedAt: expect.any(String),
    });

    await openBackInStockAdmin(page);
    const row = adminAlertRow(page, CARD_EMAIL);
    await expect(row).toContainText("已发送");
    await expect(row.getByRole("button", { name: `重发 ${CARD_EMAIL}` })).toHaveCount(0);

    await setStock(sizeSmallSku.id, 2);
    const afterPositiveAdjustment = await alertFor(CARD_EMAIL);
    expect(afterPositiveAdjustment.status).toBe("SENT");
    expect(afterPositiveAdjustment.notifiedAt).toBe(sent.notifiedAt);
    expect((await alertRows()).filter((item) => item.email === CARD_EMAIL)).toHaveLength(1);
  });

  test("PDP and sticky Notify controls bind the current Blue / Small SKU", async ({
    page,
  }) => {
    await page.goto("/products/e2e-color-size");
    const purchase = page.locator("#pdp-purchase");
    await purchase
      .getByRole("group", { name: "Color", exact: true })
      .getByRole("button", { name: "Blue", exact: true })
      .click();
    await purchase
      .getByRole("group", { name: "Size", exact: true })
      .getByRole("button", { name: "Small", exact: true })
      .click();
    await expect(page.getByTestId("stock-state")).toHaveText("Out of Stock");

    const mainDialog = await submitNotify(
      page,
      page.getByTestId("oos-contact"),
      PDP_EMAIL,
      blueSmallSku.id,
    );
    await mainDialog.getByRole("button", { name: "Done", exact: true }).click();

    await page.locator("#details").evaluate((node) =>
      node.scrollIntoView({ block: "start" }),
    );
    const sticky = page.getByTestId("sticky-buy");
    await expect(sticky).toBeVisible();
    await expect(
      sticky.getByRole("button", {
        name: "Notify me when back in stock",
        exact: true,
      }),
    ).toBeVisible();
    const stickyDialog = await submitNotify(
      page,
      sticky,
      STICKY_EMAIL,
      blueSmallSku.id,
    );
    await stickyDialog.getByRole("button", { name: "Done", exact: true }).click();

    for (const email of [PDP_EMAIL, STICKY_EMAIL]) {
      await expect(alertFor(email)).resolves.toMatchObject({
        email,
        skuId: blueSmallSku.id,
        skuCode: "E2E-CS-BLUE-S",
        variantName: "Blue / Small",
        status: "PENDING",
      });
    }

    await purchase
      .getByRole("group", { name: "Size", exact: true })
      .getByRole("button", { name: "Medium", exact: true })
      .click();
    await expect(page.getByTestId("oos-contact")).toHaveCount(0);
  });

  test("admin resend delivers a pending row and removes its resend action", async ({
    page,
  }) => {
    await openBackInStockAdmin(page);
    const row = adminAlertRow(page, STICKY_EMAIL);
    await row.getByRole("button", { name: `重发 ${STICKY_EMAIL}` }).click();
    await expect(row).toContainText("已发送");
    await expect(row.getByRole("button", { name: `重发 ${STICKY_EMAIL}` })).toHaveCount(0);
    await expect(alertFor(STICKY_EMAIL)).resolves.toMatchObject({
      status: "SENT",
      lastError: null,
      notifiedAt: expect.any(String),
    });
  });

  test("order cancellation releases the final reservation and sends exactly once", async () => {
    await setStock(relatedSku.id, 1);
    const phone = `0917${String(Date.now() % 10_000_000).padStart(7, "0")}`;
    const checkout = await responseJson<{ orderNumber: string }>(
      await api.post(`${API}/storefront/orders`, {
        data: {
          customer: {
            name: "Stock Alert E2E Buyer",
            phone,
            province: "Metro Manila",
            city: "Quezon City",
            postalCode: "1100",
            streetAddress: "12 Stock Alert Street",
          },
          items: [{ skuId: relatedSku.id, quantity: 1 }],
          attribution: { sourceType: "ORGANIC" },
          customerNote: null,
          promoCode: null,
        },
      }),
      "stock-alert checkout",
    );
    const orderList = await adminGet<{ items: { id: string }[] }>(
      `/admin/orders?search=${encodeURIComponent(checkout.orderNumber)}&page=1&pageSize=1`,
    );
    expect(orderList.items).toHaveLength(1);
    const orderId = orderList.items[0]!.id;

    await responseJson<{ ok: true }>(
      await api.post(`${API}/storefront/back-in-stock`, {
        data: { email: CANCEL_EMAIL, skuId: relatedSku.id },
      }),
      "cancellation alert subscription",
    );
    await expect(alertFor(CANCEL_EMAIL)).resolves.toMatchObject({
      status: "PENDING",
      notifiedAt: null,
    });

    await responseJson(
      await api.post(`${API}/admin/orders/${orderId}/cancel`, {
        headers: authHeaders(),
      }),
      "cancel reserved order",
    );
    const sent = await alertFor(CANCEL_EMAIL);
    expect(sent).toMatchObject({
      status: "SENT",
      lastError: null,
      notifiedAt: expect.any(String),
    });

    const repeated = await api.post(`${API}/admin/orders/${orderId}/cancel`, {
      headers: authHeaders(),
    });
    expect(repeated.ok()).toBe(false);
    expect(repeated.status()).toBe(400);
    const afterRepeatedCancel = await alertFor(CANCEL_EMAIL);
    expect(afterRepeatedCancel.notifiedAt).toBe(sent.notifiedAt);
    expect((await alertRows()).filter((row) => row.email === CANCEL_EMAIL)).toHaveLength(1);

    const refreshed = await fetchProduct(relatedOos.slug);
    expect(skuByCode(refreshed, "E2E-RELATED-OOS").sku.availableInventory).toBe(1);
    const orderDetail = await adminGet<Record<string, unknown>>(
      `/admin/orders/${orderId}`,
    );
    const attribution = JSON.stringify(orderDetail.attribution ?? null);
    expect(attribution).not.toContain(CANCEL_EMAIL);
    expect(attribution).not.toContain(relatedSku.id);
  });

  test("settings UI publishes phone, footer link, and all support channels", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
    await page.goto("/admin/settings");
    await expect(page).not.toHaveURL(/\/admin\/login/);
    await page.locator("#settings-messenger-url").fill(SUPPORT_MESSENGER);
    await page.locator("#settings-support-email").fill(SUPPORT_EMAIL);
    await page.locator("#settings-support-phone").fill(SUPPORT_PHONE);
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByTestId("settings-saved")).toHaveText("已保存");

    await expect(
      responseJson<{
        messengerUrl: string;
        supportEmail: string;
        supportPhone: string;
      }>(await api.get(`${API}/storefront/settings`), "public settings"),
    ).resolves.toMatchObject({
      messengerUrl: SUPPORT_MESSENGER,
      supportEmail: SUPPORT_EMAIL,
      supportPhone: SUPPORT_PHONE,
    });

    await page.goto(`/?support-e2e=${encodeURIComponent(RUN_ID)}`);
    const footerPhone = page.getByRole("link", {
      name: SUPPORT_PHONE,
      exact: true,
    });
    await expect(footerPhone).toHaveAttribute("href", SUPPORT_PHONE_HREF);

    const fab = page.getByRole("button", { name: "Contact support", exact: true });
    await fab.click();
    const stack = page.getByTestId("support-channel-stack");
    await expect(stack).toBeVisible();
    await expect(stack.getByRole("link", { name: "Messenger", exact: true }))
      .toHaveAttribute("href", SUPPORT_MESSENGER);
    await expect(stack.getByRole("link", { name: "Messenger", exact: true }))
      .toHaveAttribute("target", "_blank");
    await expect(stack.getByRole("link", { name: "Email", exact: true }))
      .toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    await expect(stack.getByRole("link", { name: "Call", exact: true }))
      .toHaveAttribute("href", SUPPORT_PHONE_HREF);
  });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    test(`${viewport.width}px Notify dialog and support stack stay inside the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
      await page.goto(
        `/products/${colorSize.slug}?variant=${encodeURIComponent(blueSmallVariant.id)}&stock-e2e=${encodeURIComponent(RUN_ID)}`,
      );
      const contact = page.getByTestId("oos-contact");
      await contact
        .getByRole("button", {
          name: "Notify me when back in stock",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", { name: "Back in stock alert" });
      await expect(dialog).toBeVisible();
      await expectInsideViewport(dialog, viewport.width);
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();

      const fab = page.getByRole("button", {
        name: "Contact support",
        exact: true,
      });
      await expect
        .poll(() => fab.evaluate((node) => getComputedStyle(node).pointerEvents))
        .not.toBe("none");
      await fab.click();
      const stack = page.getByTestId("support-channel-stack");
      await expect(stack).toBeVisible();
      await expectInsideViewport(stack, viewport.width);
      await expectNoHorizontalOverflow(page);
    });
  }
});
