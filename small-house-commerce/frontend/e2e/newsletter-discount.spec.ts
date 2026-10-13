import {
  request as playwrightRequest,
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { E2E_API as API } from "./e2e-origins";

const SLUG = "e2e-color-size";
const RUN_ID = `${Date.now()}-${process.pid}`;
const PROMO_CODE = `E2E10-${RUN_ID}`;
const NEXT_PROMO_CODE = `E2E20-${RUN_ID}`;
const POPUP_EMAIL = `newsletter-popup-${RUN_ID}@example.com`;
const FOOTER_EMAIL = `newsletter-footer-${RUN_ID}@example.com`;
const UPDATED_OFFER_TITLE = `E2E settings saved ${RUN_ID}`;
const NEWSLETTER_EYEBROW = `E2E furniture notes ${RUN_ID}`;
const NEWSLETTER_FORM_TITLE = `E2E ideas by email ${RUN_ID}`;
const NEWSLETTER_PLACEHOLDER = `E2E email ${RUN_ID}`;
const NEWSLETTER_CONSENT = `E2E useful updates ${RUN_ID}. Unsubscribe anytime.`;
const UPDATED_EYEBROW = `E2E saved eyebrow ${RUN_ID}`;
const UPDATED_FORM_TITLE = `E2E saved form ${RUN_ID}`;
const UPDATED_PLACEHOLDER = `E2E saved email ${RUN_ID}`;
const UPDATED_CONSENT = `E2E saved consent ${RUN_ID}. Unsubscribe anytime.`;
const ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const ADMIN_PASSWORD = "E2eAdminPass123!";

interface ProductJson {
  variants: {
    id: string;
    sku: { id: string; price: string } | null;
  }[];
}

interface PromotionJson {
  id: string;
  code: string;
  status: "ACTIVE" | "ARCHIVED";
}

let api: APIRequestContext;
let accessToken = "";
let refreshToken = "";
let skuId = "";
let unitPrice = 0;
let promotionId = "";
let placedOrderId = "";
let placedOrderNumber = "";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function responseJson<T>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  label: string,
): Promise<T> {
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

async function adminPost<T>(path: string, data: unknown): Promise<T> {
  return responseJson<T>(
    await api.post(`${API}${path}`, { headers: authHeaders(), data }),
    `POST ${path}`,
  );
}

async function adminPatch<T>(path: string, data: unknown): Promise<T> {
  return responseJson<T>(
    await api.patch(`${API}${path}`, { headers: authHeaders(), data }),
    `PATCH ${path}`,
  );
}

function trackBrowserErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return () => {
    expect(
      errors,
      `expected zero console/page errors, got:\n${errors.join("\n")}`,
    ).toEqual([]);
  };
}

async function suppressPopup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("luwag_newsletter_popup_seen", "1");
  });
}

async function gotoDirectCheckout(page: Page): Promise<void> {
  await page.goto(
    `/checkout?skuId=${encodeURIComponent(skuId)}&qty=1&slug=${SLUG}`,
  );
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
}

async function applyPromo(page: Page, code: string): Promise<void> {
  const input = page.getByLabel("Promo code");
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Have a promo code?" }).click();
  }
  await input.fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
}

async function fillCheckoutAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("Newsletter E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("checkout-postal-code").fill("1100");
  await page
    .getByPlaceholder("House no., street, subdivision")
    .fill("12 Newsletter E2E Street");
}

async function storefrontPreview(code: string): Promise<{
  valid: boolean;
  discountAmount: number;
  message: string;
}> {
  return responseJson(
    await api.post(`${API}/storefront/checkout/promo-code/preview`, {
      data: { code, subtotal: unitPrice },
    }),
    `preview ${code}`,
  );
}

test.beforeAll(async () => {
  api = await playwrightRequest.newContext();

  const login = await responseJson<{ accessToken: string; refreshToken: string }>(
    await api.post(`${API}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }),
    "admin login",
  );
  accessToken = login.accessToken;
  refreshToken = login.refreshToken;

  const productBody = await responseJson<
    ProductJson | { product: ProductJson }
  >(await api.get(`${API}/storefront/products/${SLUG}`), "seeded product");
  const product = "product" in productBody ? productBody.product : productBody;
  const sellable = product.variants.find((variant) => variant.sku !== null);
  if (!sellable?.sku) throw new Error("seeded product has no sellable SKU");
  skuId = sellable.sku.id;
  unitPrice = Number(sellable.sku.price);

  const promotion = await adminPost<PromotionJson>(
    "/admin/newsletter/promotions",
    {
      code: PROMO_CODE,
      discountType: "PERCENT",
      discountValue: 10,
      minSpend: 0,
      maxUses: 1,
      perCustomerLimit: 1,
      validFrom: null,
      validUntil: null,
    },
  );
  promotionId = promotion.id;

  const settings = await adminGet<{
    messengerUrl: string;
    supportEmail: string;
    supportHours: string;
  }>("/admin/settings");
  await adminPatch("/admin/settings", {
    messengerUrl: settings.messengerUrl,
    supportEmail: settings.supportEmail,
    supportHours: settings.supportHours,
    newsletterBandEnabled: true,
    newsletterPopupEnabled: true,
    newsletterPopupDelaySeconds: 0,
    newsletterOfferTitle: "E2E Subscribe and save",
    newsletterOfferBody: "Join the list for a real checkout discount.",
    newsletterEyebrow: NEWSLETTER_EYEBROW,
    newsletterFormTitle: NEWSLETTER_FORM_TITLE,
    newsletterEmailPlaceholder: NEWSLETTER_PLACEHOLDER,
    newsletterConsentText: NEWSLETTER_CONSENT,
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe.serial("newsletter subscription and discount lifecycle", () => {
  test("first visit subscribes in the popup once and the footer subscribes separately", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.goto("/");

    const popup = page.getByTestId("newsletter-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("E2E Subscribe and save");
    await expect(popup).toContainText(NEWSLETTER_EYEBROW);
    await expect(
      popup.getByRole("heading", { name: NEWSLETTER_FORM_TITLE }),
    ).toBeVisible();
    await expect(popup.getByTestId("newsletter-subscribe-email")).toHaveAttribute(
      "placeholder",
      NEWSLETTER_PLACEHOLDER,
    );
    await expect(popup).toContainText(NEWSLETTER_CONSENT);
    await popup.getByTestId("newsletter-subscribe-email").fill(POPUP_EMAIL);
    await popup.getByTestId("newsletter-subscribe-submit").click();
    const popupSuccess = page.getByTestId("newsletter-success-dialog");
    await expect(
      popupSuccess.getByRole("heading", { name: "Thank You!" }),
    ).toBeVisible();
    await expect(popupSuccess.getByTestId("newsletter-subscribe-code")).toHaveText(
      PROMO_CODE,
    );
    const successBox = await popupSuccess.boundingBox();
    expect(successBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(500);
    expect(successBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(360);
    await popupSuccess
      .getByRole("button", { name: "Close success message" })
      .click();
    await expect(popupSuccess).toBeHidden();
    await expect(popup).toBeHidden();

    await page.reload();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("newsletter-popup")).toHaveCount(0);

    const band = page.getByTestId("newsletter-band");
    await expect(band).toBeVisible();
    await expect(band).toContainText(NEWSLETTER_EYEBROW);
    await expect(band.getByTestId("newsletter-form-title")).toHaveText(
      NEWSLETTER_FORM_TITLE,
    );
    await expect(band.getByTestId("newsletter-subscribe-email")).toHaveAttribute(
      "placeholder",
      NEWSLETTER_PLACEHOLDER,
    );
    await expect(band).toContainText(NEWSLETTER_CONSENT);
    await band.getByTestId("newsletter-subscribe-email").fill(FOOTER_EMAIL);
    await band.getByTestId("newsletter-subscribe-submit").click();
    const footerSuccess = page.getByTestId("newsletter-success-dialog");
    await expect(
      footerSuccess.getByRole("heading", { name: "Thank You!" }),
    ).toBeVisible();
    await expect(footerSuccess.getByTestId("newsletter-subscribe-code")).toHaveText(
      PROMO_CODE,
    );
    await footerSuccess
      .getByRole("button", { name: "Close success message" })
      .click();
    await expect(footerSuccess).toBeHidden();

    const subscribers = await adminGet<{
      items: { email: string; source: string }[];
    }>("/admin/newsletter/subscribers?page=1&pageSize=100");
    expect(subscribers.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: POPUP_EMAIL, source: "POPUP" }),
        expect.objectContaining({ email: FOOTER_EMAIL, source: "FOOTER" }),
      ]),
    );
    stopErrors();
  });

  test("checkout previews errors, applies the discount, places once, and exhausts the slot", async ({
    browser,
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await suppressPopup(page);
    await gotoDirectCheckout(page);

    await applyPromo(page, "NO-SUCH-CODE");
    await expect(page.getByTestId("promo-code-message")).toContainText(
      "isn't valid",
    );

    await adminPatch(`/admin/newsletter/promotions/${promotionId}`, {
      minSpend: unitPrice + 1_000,
    });
    await applyPromo(page, PROMO_CODE);
    await expect(page.getByTestId("promo-code-message")).toContainText(
      "minimum order",
    );

    await adminPatch(`/admin/newsletter/promotions/${promotionId}`, {
      minSpend: 0,
    });
    await applyPromo(page, PROMO_CODE);
    await expect(page.getByTestId("promo-code-message")).toContainText(
      "Promo code applied",
    );

    await fillCheckoutAddress(page);
    await page.getByTestId("review-order").click();
    await expect(page).toHaveURL(/\/checkout\/confirm/);
    const storedPromo = await page.evaluate(() => {
      const raw = sessionStorage.getItem("luwag_checkout_draft");
      return raw
        ? (JSON.parse(raw) as { promoCode?: string | null }).promoCode
        : null;
    });
    expect(storedPromo).toBe(PROMO_CODE);
    await expect(page.getByTestId("confirm-promo-discount")).toBeVisible();

    const discount = Math.round(unitPrice * 0.1 * 100) / 100;
    const expectedTotal = unitPrice - discount;
    await expect(page.getByText("Total (COD)", { exact: true }).locator("+ dd"))
      .toContainText(expectedTotal.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }));

    await page.getByTestId("confirm-place-order").click();
    await expect(page).toHaveURL(/\/order-success\/PH\d+$/);
    placedOrderNumber = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(placedOrderNumber).toMatch(/^PH\d+$/);

    const listed = await adminGet<{ items: { id: string }[] }>(
      `/admin/orders?search=${encodeURIComponent(placedOrderNumber)}&page=1&pageSize=1`,
    );
    expect(listed.items).toHaveLength(1);
    placedOrderId = listed.items[0]!.id;
    const detail = await adminGet<{
      promoCode: string | null;
      discountTotal: string;
      grandTotal: string;
    }>(`/admin/orders/${placedOrderId}`);
    expect(detail.promoCode).toBe(PROMO_CODE);
    expect(Number(detail.discountTotal)).toBe(discount);
    expect(Number(detail.grandTotal)).toBe(expectedTotal);

    await gotoDirectCheckout(page);
    await applyPromo(page, PROMO_CODE);
    await expect(page.getByTestId("promo-code-message")).toContainText(
      "usage limit",
    );
    await expect(storefrontPreview(PROMO_CODE)).resolves.toMatchObject({
      valid: false,
      message: expect.stringMatching(/usage limit/),
    });

    const offerContext = await browser.newContext();
    const offerPage = await offerContext.newPage();
    const stopOfferErrors = trackBrowserErrors(offerPage);
    await offerPage.goto(new URL(page.url()).origin);
    await offerPage.waitForTimeout(300);
    await expect(offerPage.getByTestId("newsletter-popup")).toHaveCount(0);
    await expect(offerPage.getByTestId("newsletter-band")).not.toContainText(
      "E2E Subscribe and save",
    );
    stopOfferErrors();
    await offerContext.close();
    stopErrors();
  });

  test("admin shows the order promo and starts a fresh counted round while preserving history", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.addInitScript(
      ({ token }) => {
        if (window.localStorage.getItem("sh_admin_refresh") === null) {
          window.localStorage.setItem("sh_admin_refresh", token);
        }
        window.localStorage.setItem("luwag_admin_lang", "zh");
      },
      { token: refreshToken },
    );

    await page.goto(`/admin/orders/${placedOrderId}`);
    await expect(page).not.toHaveURL(/\/admin\/login/);
    await expect(page.getByText("Promo code")).toBeVisible();
    await expect(page.getByText(PROMO_CODE, { exact: true })).toBeVisible();
    await expect(page.getByText("Discount", { exact: true }).first()).toBeVisible();

    await page.goto("/admin/newsletter");
    await page.getByRole("tab", { name: "优惠活动" }).click();
    await expect(page.getByText(PROMO_CODE, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "开始新一轮" }).click();
    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: "历史计数与核销数据会永久保留" }),
    ).toContainText("历史计数与核销数据会永久保留");
    await page.getByLabel("优惠码").fill(NEXT_PROMO_CODE);
    await page.getByLabel("优惠数值").fill("20");
    await page.getByRole("button", { name: "创建并开始新一轮" }).click();
    await expect(page.getByRole("status")).toContainText("活动已保存");
    await expect(page.getByText(NEXT_PROMO_CODE, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(PROMO_CODE, { exact: true }).first()).toBeVisible();

    const promotions = await adminGet<PromotionJson[]>(
      "/admin/newsletter/promotions",
    );
    const old = promotions.find((row) => row.id === promotionId);
    const next = promotions.find((row) => row.code === NEXT_PROMO_CODE);
    expect(old?.status).toBe("ARCHIVED");
    expect(next?.status).toBe("ACTIVE");

    const oldUsage = await adminGet<{ effective: number; released: number }>(
      `/admin/newsletter/promotions/${promotionId}/usage`,
    );
    const nextUsage = await adminGet<{ effective: number; released: number }>(
      `/admin/newsletter/promotions/${next!.id}/usage`,
    );
    expect(oldUsage).toMatchObject({ effective: 1, released: 0 });
    expect(nextUsage).toMatchObject({ effective: 0, released: 0 });

    await page.goto("/admin/settings");
    await page.getByLabel("优惠标题").fill(UPDATED_OFFER_TITLE);
    await page
      .getByLabel("优惠正文")
      .fill("Saved through the real admin settings form.");
    await page.getByLabel("订阅区小标签").fill(UPDATED_EYEBROW);
    await page.getByLabel("表单标题").fill(UPDATED_FORM_TITLE);
    await page.getByLabel("邮箱占位文案").fill(UPDATED_PLACEHOLDER);
    await page.getByLabel("同意与退订说明").fill(UPDATED_CONSENT);
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByTestId("settings-saved")).toHaveText("已保存");

    await page.goto("/");
    const updatedPopup = page.getByTestId("newsletter-popup");
    await expect(updatedPopup).toContainText(UPDATED_OFFER_TITLE);
    await expect(updatedPopup).toContainText(UPDATED_EYEBROW);
    await expect(
      updatedPopup.getByRole("heading", { name: UPDATED_FORM_TITLE }),
    ).toBeVisible();
    await expect(
      updatedPopup.getByTestId("newsletter-subscribe-email"),
    ).toHaveAttribute("placeholder", UPDATED_PLACEHOLDER);
    await expect(updatedPopup).toContainText(UPDATED_CONSENT);
    stopErrors();
  });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    test(`${viewport.width}px popup and newsletter band have no horizontal overflow`, async ({
      page,
    }) => {
      const stopErrors = trackBrowserErrors(page);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate(() => {
        window.localStorage.removeItem("luwag_newsletter_popup_seen");
      });
      await page.reload();
      await expect(page.getByTestId("newsletter-popup")).toBeVisible();
      await expect(page.getByTestId("newsletter-band")).toBeVisible();

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) {
        // The subscribe block is the footer's own column now (one continuous
        // surface), so the bound that matters is the whole footer's height —
        // the old "band ≤190px above the footer" gate no longer applies.
        const footer = await page
          .locator("footer")
          .evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            containsBand:
              element.querySelector('[data-testid="newsletter-band"]') !== null,
          }));
        expect(footer.containsBand).toBe(true);
        expect(footer.height).toBeLessThanOrEqual(520);
      }
      stopErrors();
    });
  }
});
