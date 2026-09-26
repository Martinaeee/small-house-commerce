import {
  request as playwrightRequest,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";

/**
 * Phase 2 — inline COD ordering on the PDP, against the REAL stack.
 *
 * The point of this gate is that the inline form is not a second ordering
 * system: it must produce an ordinary order through the same endpoint, with
 * the same SKU, the same attribution and the same once-per-session tracking.
 * The order is read back through the storefront lookup endpoint, which is the
 * shopper-facing truth, not the admin projection.
 */

const API = "http://127.0.0.1:3210/api/v1";
const SLUG = "e2e-color-size";
const SCREENSHOTS = resolve(process.cwd(), "screenshots");

interface ProductJson {
  id: string;
  slug: string;
  options: {
    id: string;
    name: string;
    values: { id: string; label: string }[];
  }[];
  variants: {
    id: string;
    name: string;
    sku: { id: string; skuCode: string; price: string } | null;
  }[];
}

let product: ProductJson;

async function fetchProduct(): Promise<ProductJson> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(`${API}/storefront/products/${SLUG}`);
    expect(response.ok(), `GET storefront product ${SLUG}`).toBeTruthy();
    const body = (await response.json()) as
      | { product: ProductJson }
      | ProductJson;
    return "product" in body ? body.product : body;
  } finally {
    await context.dispose();
  }
}

/** The first variant that can actually be ordered. */
function sellableVariant(): ProductJson["variants"][number] {
  const variant = product.variants.find(
    (candidate) => candidate.sku !== null,
  );
  if (!variant) throw new Error("seed has no sellable variant");
  return variant;
}

async function lookupOrder(
  orderNumber: string,
  phone: string,
): Promise<{
  items: { skuId: string; quantity: number }[];
  attribution: { aidSnapshot: string | null; utmSource: string | null } | null;
}> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.post(`${API}/storefront/orders/lookup`, {
      data: { orderNumber, phone },
    });
    expect(response.ok(), `lookup ${orderNumber}`).toBeTruthy();
    return (await response.json()) as never;
  } finally {
    await context.dispose();
  }
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

function screenshotPath(name: string): string {
  return resolve(SCREENSHOTS, name);
}

async function gotoPdp(page: Page, query = ""): Promise<void> {
  await page.goto(`http://localhost:3211/products/${SLUG}${query}`);
  await expect(
    page.getByRole("main").getByTestId("pdp-purchase"),
  ).toBeVisible();
}

async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  const value = page
    .getByRole("main")
    .getByRole("group", { name: optionName, exact: true })
    .getByRole("button", { name: valueLabel, exact: true });
  await expect(async () => {
    await value.click();
    await expect(value).toHaveAttribute("aria-pressed", "true");
  }).toPass({ timeout: 15_000 });
}

/** Fills the inline COD form through its real controls. */
async function fillInlineAddress(page: Page, phone = "09171234567"): Promise<void> {
  const section = page.getByRole("main").locator("#quick-cod-order");
  await section.getByPlaceholder("Juan Dela Cruz").fill("E2E Quick Buyer");
  await section.getByPlaceholder("0917 123 4567").fill(phone);
  await section.getByTestId("psgc-province").fill("Metro Manila");
  await page
    .getByRole("option", { name: /Metro Manila/i })
    .first()
    .click();
  await section.getByTestId("psgc-city").fill("Quezon");
  await page
    .getByRole("option", { name: "Quezon", exact: true })
    .first()
    .click();
  await section
    .getByPlaceholder("House no., street, subdivision")
    .fill("12 E2E Street");
}

test.beforeAll(async () => {
  product = await fetchProduct();
});

test.describe("PDP inline COD order", () => {
  test("places a real order for the displayed variant and keeps its attribution", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    const variant = sellableVariant();
    const skuId = variant.sku!.id;

    // An optimizer link is what the form must not lose.
    await gotoPdp(
      page,
      `?variant=${variant.id}&aid=aid-e2e-1&utm_source=facebook&utm_campaign=e2e`,
    );

    const section = page.getByRole("main").locator("#quick-cod-order");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByTestId("quick-cod-variant")).toHaveText(
      variant.name,
    );
    await expect(section.getByTestId("quick-cod-quantity")).toHaveText("1");

    await fillInlineAddress(page);
    await page.screenshot({
      path: screenshotPath("phase2-inline-cod-desktop.png"),
    });

    let releaseOrder!: () => void;
    let markOrderStarted!: () => void;
    const orderMayContinue = new Promise<void>((resolve) => {
      releaseOrder = resolve;
    });
    const orderStarted = new Promise<void>((resolve) => {
      markOrderStarted = resolve;
    });
    await page.route("**/api/v1/storefront/orders", async (route) => {
      const request = route.request();
      const isCreate =
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/storefront/orders");
      if (!isCreate) {
        await route.continue();
        return;
      }
      markOrderStarted();
      await orderMayContinue;
      await route.continue();
    });

    await section.getByTestId("quick-cod-submit").click();
    await orderStarted;
    try {
      await expect(section.getByTestId("quick-cod-submit")).toBeDisabled();
      await expect(section.getByTestId("psgc-province")).toBeDisabled();
      await expect(section.getByTestId("psgc-city")).toBeDisabled();
      const hero = page.getByRole("main").getByTestId("pdp-purchase");
      await expect(hero.getByRole("button", { name: "Red" })).toBeDisabled();
      await expect(
        hero.getByRole("button", { name: "Increase quantity" }),
      ).toBeDisabled();
      const sticky = page.getByTestId("sticky-buy");
      await expect(sticky).toBeVisible();
      await expect(
        sticky.getByRole("button", { name: "Increase sticky quantity" }),
      ).toBeDisabled();
    } finally {
      releaseOrder();
    }

    await expect(page).toHaveURL(/\/order-success\/PH\d+$/);
    const orderNumber = page.url().split("/").pop()!;
    await expect(page.getByTestId("order-number")).toHaveText(orderNumber);

    const order = await lookupOrder(orderNumber, "09171234567");
    expect(order.items).toMatchObject([{ skuId, quantity: 1 }]);
    expect(order.attribution?.aidSnapshot).toBe("aid-e2e-1");
    expect(order.attribution?.utmSource).toBe("facebook");

    stopErrors();
  });

  test("shows field-level errors and focuses the first invalid field", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    const variant = sellableVariant();
    await gotoPdp(page, `?variant=${variant.id}`);

    const section = page.getByRole("main").locator("#quick-cod-order");
    await section.scrollIntoViewIfNeeded();
    await section.getByTestId("quick-cod-submit").click();

    await expect(page.getByText("Please enter your name.")).toBeVisible();
    await expect(
      page.getByText("Please enter your mobile number."),
    ).toBeVisible();
    await expect(page.getByText("Please enter your province.")).toBeVisible();
    await expect(page.getByText("Please enter your full address.")).toBeVisible();
    await expect(section.getByPlaceholder("Juan Dela Cruz")).toBeFocused();
    // Still on the PDP: nothing was created.
    await expect(page).toHaveURL(new RegExp(`/products/${SLUG}`));

    await page.screenshot({
      path: screenshotPath("phase2-inline-cod-validation.png"),
    });
    stopErrors();
  });

  test("rejects a malformed mobile number before any request", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    const variant = sellableVariant();
    const orderPosts: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/storefront/orders")
      ) {
        orderPosts.push(request.url());
      }
    });

    await gotoPdp(page, `?variant=${variant.id}`);
    const section = page.getByRole("main").locator("#quick-cod-order");
    await section.scrollIntoViewIfNeeded();
    await fillInlineAddress(page, "12345");
    await section.getByTestId("quick-cod-submit").click();

    await expect(
      page.getByText("Please enter a valid Philippine mobile number."),
    ).toBeVisible();
    expect(orderPosts).toEqual([]);
    stopErrors();
  });

  test("follows the hero selection and quantity into the order", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page);

    const main = page.getByRole("main");
    const section = main.locator("#quick-cod-order");
    await section.scrollIntoViewIfNeeded();
    // Nothing chosen yet: the form explains itself instead of ordering.
    await expect(section.getByTestId("quick-cod-submit")).toBeDisabled();
    await expect(
      page.getByText("Choose your options above to order this item."),
    ).toBeVisible();

    const color = product.options.find((option) => option.name === "Color");
    const size = product.options.find((option) => option.name === "Size");
    const blue = color?.values.find((value) => value.label === "Blue");
    const medium = size?.values.find((value) => value.label === "Medium");
    expect(color, "Color option exists").toBeTruthy();
    expect(size, "Size option exists").toBeTruthy();
    expect(blue, "Blue value exists").toBeTruthy();
    expect(medium, "Medium value exists").toBeTruthy();

    await selectValue(page, color!.name, blue!.label);
    await selectValue(page, size!.name, medium!.label);

    const target = product.variants.find(
      (candidate) =>
        candidate.name === `${blue!.label} / ${medium!.label}` &&
        candidate.sku !== null,
    );
    expect(target, "Blue / Medium sellable variant exists").toBeTruthy();

    const hero = main.getByTestId("pdp-purchase");
    await hero.getByRole("button", { name: "Increase quantity" }).click();

    await section.scrollIntoViewIfNeeded();
    await expect(section.getByTestId("quick-cod-variant")).toHaveText(
      target!.name,
    );
    await expect(section.getByTestId("quick-cod-quantity")).toHaveText("2");
    await expect(section.getByTestId("quick-cod-total")).toContainText(
      (Number(target!.sku!.price) * 2).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
      }),
    );

    const phone = "09171234568";
    await fillInlineAddress(page, phone);
    await section.getByTestId("quick-cod-submit").click();

    await expect(page).toHaveURL(/\/order-success\/PH\d+$/);
    const orderNumber = page.url().split("/").pop()!;
    const order = await lookupOrder(orderNumber, phone);
    expect(order.items).toMatchObject([
      { skuId: target!.sku!.id, quantity: 2 },
    ]);
    stopErrors();
  });

  test("keeps the mobile form usable at 375px", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const variant = sellableVariant();
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoPdp(page, `?variant=${variant.id}`);

    const section = page.getByRole("main").locator("#quick-cod-order");
    await section.scrollIntoViewIfNeeded();

    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.client + 1);

    await fillInlineAddress(page);
    await page.screenshot({
      path: screenshotPath("phase2-inline-cod-mobile-375.png"),
      fullPage: false,
    });
    await expect(section.getByTestId("quick-cod-submit")).toBeEnabled();
    stopErrors();
  });
});
