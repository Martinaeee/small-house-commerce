import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";

const API = "http://127.0.0.1:3210/api/v1";
const WEB = "http://localhost:3211";
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
const SCREENSHOTS = resolve(__dirname, "../screenshots");
const PASSWORD = "E2eAdminPass123!";
const ACCOUNTS = {
  admin: "e2e-admin@smallhouse.test",
  warehouse: "e2e-warehouse@smallhouse.test",
  optimizer: "e2e-optimizer@smallhouse.test",
} as const;

const KINDS = [
  "ORDER_NEEDS_REVIEW",
  "ORDER_UNCONFIRMED",
  "PRODUCT_MISSING_MEDIA",
  "PRODUCT_NO_PRICED_SKU",
  "PRODUCT_INCOMPLETE_SHIPPING",
  "PRODUCT_STALE_DRAFT",
] as const;

type AccountEmail = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];
type NotificationKind = (typeof KINDS)[number];

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

interface NotificationItem {
  kind: NotificationKind;
  count: number;
  href: string;
}

interface NotificationsResponse {
  totalCount: number;
  items: NotificationItem[];
}

interface ProductCounts {
  attention: {
    missing_media: number;
    no_priced_sku: number;
    incomplete_shipping: number;
    stale_draft: number;
  };
}

let api: APIRequestContext;
const tokens = new Map<AccountEmail, LoginTokens>();
const stopErrorTracking = new WeakMap<Page, () => void>();

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function login(
  email: AccountEmail,
  options: { fresh?: boolean } = {},
): Promise<LoginTokens> {
  const cached = tokens.get(email);
  if (cached && !options.fresh) return cached;
  const response = await api.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(
    response.ok(),
    `login ${email}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as LoginTokens;
  tokens.set(email, body);
  return body;
}

async function authenticatedGet<T>(
  path: string,
  email: AccountEmail = ACCOUNTS.admin,
): Promise<T> {
  const { accessToken } = await login(email);
  const response = await api.get(`${API}${path}`, {
    headers: authHeaders(accessToken),
  });
  expect(
    response.ok(),
    `GET ${path}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as T;
}

async function notifications(
  email: AccountEmail = ACCOUNTS.admin,
): Promise<NotificationsResponse> {
  return authenticatedGet<NotificationsResponse>("/admin/notifications", email);
}

async function openSession(
  page: Page,
  email: AccountEmail,
  path: string,
): Promise<void> {
  const session = await login(email, { fresh: true });
  await page.addInitScript((refreshToken) => {
    window.localStorage.setItem("sh_admin_refresh", refreshToken);
    window.localStorage.setItem("luwag_admin_lang", "zh");
  }, session.refreshToken);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

function trackBrowserErrors(page: Page): () => void {
  const consoleErrors: string[] = [];
  const hydrationWarnings: string[] = [];
  const httpErrors: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") consoleErrors.push(text);
    if (/hydrat|server rendered html/i.test(text)) hydrationWarnings.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      (response.url().startsWith(WEB) || response.url().startsWith(API))
    ) {
      httpErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  return () => {
    expect(
      consoleErrors,
      `console/page errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
    expect(
      hydrationWarnings,
      `hydration warnings:\n${hydrationWarnings.join("\n")}`,
    ).toEqual([]);
    expect(httpErrors, `HTTP errors:\n${httpErrors.join("\n")}`).toEqual([]);
  };
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.client + 1);
  expect(widths.body).toBeLessThanOrEqual(widths.client + 1);
}

function bell(page: Page, totalCount: number) {
  return page.getByRole("button", {
    name:
      totalCount > 0
        ? `通知，${totalCount} 个待处理问题`
        : "通知",
  });
}

test.describe.serial("Admin Notifications V1 real stack", () => {
  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": "127.0.0.3" },
    });
  });

  test.beforeEach(async ({ page }) => {
    stopErrorTracking.set(page, trackBrowserErrors(page));
  });

  test.afterEach(async ({ page }) => {
    stopErrorTracking.get(page)?.();
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test("guards the test stack and derives exact RBAC-filtered counts from canonical endpoints", async ({}, testInfo) => {
    expect(assertE2EDatabaseUrl(DATABASE_URL)).toEqual({
      database: "small_house_variant_test",
      host: "localhost",
      port: "5432",
    });
    expect(new URL(API).origin).toBe("http://127.0.0.1:3210");
    expect(new URL(String(testInfo.project.use.baseURL)).origin).toBe(WEB);

    const unauthenticated = await api.get(`${API}/admin/notifications`);
    expect(unauthenticated.status()).toBe(401);

    const { accessToken } = await login(ACCOUNTS.admin);
    const response = await api.get(`${API}/admin/notifications`, {
      headers: authHeaders(accessToken),
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const body = (await response.json()) as NotificationsResponse;

    expect(body.items.map((item) => item.kind)).toEqual(KINDS);
    expect(body.items.every((item) => item.count > 0)).toBe(true);
    expect(body.totalCount).toBe(
      body.items.reduce((sum, item) => sum + item.count, 0),
    );

    const productCounts = await authenticatedGet<ProductCounts>(
      "/admin/products/counts",
    );
    const notificationByKind = new Map(
      body.items.map((item) => [item.kind, item.count]),
    );
    expect(notificationByKind.get("PRODUCT_MISSING_MEDIA")).toBe(
      productCounts.attention.missing_media,
    );
    expect(notificationByKind.get("PRODUCT_NO_PRICED_SKU")).toBe(
      productCounts.attention.no_priced_sku,
    );
    expect(notificationByKind.get("PRODUCT_INCOMPLETE_SHIPPING")).toBe(
      productCounts.attention.incomplete_shipping,
    );
    expect(notificationByKind.get("PRODUCT_STALE_DRAFT")).toBe(
      productCounts.attention.stale_draft,
    );

    for (const [kind, confirmation] of [
      ["ORDER_NEEDS_REVIEW", "NEEDS_REVIEW"],
      ["ORDER_UNCONFIRMED", "UNCONFIRMED"],
    ] as const) {
      const orders = await authenticatedGet<{ total: number }>(
        `/admin/orders?confirmation=${confirmation}&page=1&pageSize=1`,
      );
      expect(notificationByKind.get(kind)).toBe(orders.total);
    }

    await expect(notifications(ACCOUNTS.warehouse)).resolves.toEqual({
      totalCount: 0,
      items: [],
    });
    await expect(notifications(ACCOUNTS.optimizer)).resolves.toEqual({
      totalCount: 0,
      items: [],
    });
  });

  test("Bell exposes the exact count, refreshes on open, restores focus, and applies a real deep-link filter", async ({ page }) => {
    const current = await notifications();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSession(page, ACCOUNTS.admin, "/admin/products");

    const trigger = bell(page, current.totalCount);
    await expect(trigger).toBeVisible();
    const visualBadge = trigger.locator('span[aria-hidden="true"]');
    await expect(visualBadge).toHaveText(
      current.totalCount > 99 ? "99+" : String(current.totalCount),
    );

    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/notifications") &&
        response.status() === 200,
    );
    await trigger.click();
    await refreshed;
    const panel = page.getByRole("dialog", { name: "通知中心" });
    await expect(panel).toBeVisible();
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-notifications-v1-panel-1440.png"),
    });
    await assertNoHorizontalOverflow(page);

    await panel.getByRole("link", { name: "查看全部通知" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const secondRefresh = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/notifications") &&
        response.status() === 200,
    );
    await trigger.click();
    await secondRefresh;
    await panel
      .getByRole("link", { name: /商品没有已定价 SKU/ })
      .click();
    await expect(page).toHaveURL(
      /\/admin\/products\?attention=no_priced_sku$/,
    );
    const selectedFilter = page
      .locator('button[aria-pressed="true"]')
      .filter({ hasText: "已上架但没有定价 SKU" });
    await expect(selectedFilter).toHaveCount(1);
    await expect(selectedFilter).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTitle("E2E Notification No Price"),
    ).toBeVisible();
  });

  test("full workspace renders current rows at desktop and mobile widths without overflow", async ({ page }) => {
    const current = await notifications();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSession(page, ACCOUNTS.admin, "/admin/notifications");

    await expect(
      page.getByRole("heading", { name: "通知中心", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(`当前有 ${current.totalCount} 个待处理问题`),
    ).toBeVisible();
    const workspace = page.getByRole("region", { name: "当前通知" });
    await expect(workspace.getByRole("link")).toHaveCount(6);
    for (const item of current.items) {
      await expect(workspace.locator(`a[href="${item.href}"]`)).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-notifications-v1-page-1440.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-notifications-v1-page-1920.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoHorizontalOverflow(page);
    await expect(bell(page, current.totalCount)).toBeVisible();
    await page.screenshot({
      path: resolve(SCREENSHOTS, "phase-notifications-v1-mobile-375.png"),
      fullPage: true,
    });
  });

  for (const email of [ACCOUNTS.warehouse, ACCOUNTS.optimizer] as const) {
    test(`${email} sees an honest empty Bell and cannot mount the hidden workspace`, async ({ page }) => {
      await openSession(page, email, "/admin/notifications");
      const trigger = bell(page, 0);
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.getByRole("status")).toContainText(
        "目前没有需要处理的通知",
      );
      // No dead-end link: this account cannot mount the full workspace.
      await expect(
        page.getByRole("link", { name: "查看全部通知" }),
      ).toHaveCount(0);

      await expect(
        page.getByText("No modules available for your account."),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "通知中心", level: 1 }),
      ).toHaveCount(0);
    });
  }
});
