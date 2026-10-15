import { test, expect, type Locator, type Page } from "@playwright/test";
import type { AdminProduct } from "../src/lib/admin-api";

const email = process.env.PHASE1_E2E_EMAIL;
const password = process.env.PHASE1_E2E_PASSWORD;
const productId = process.env.PHASE1_E2E_PRODUCT_ID;
const slug = process.env.PHASE1_E2E_PRODUCT_SLUG;
const landingSlug = process.env.PHASE1_E2E_LANDING_SLUG;
const database = process.env.PHASE1_E2E_DATABASE;
const apiOrigin = "http://127.0.0.1:3230/api/v1";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("saves isolated SKU dimensions and packaging, switches PDP variants, then restores dynamic inheritance", async ({ page, baseURL }) => {
  test.skip(!email || !password || !productId || !slug || !landingSlug || !database, "Requires the owned Phase1 fixture runner and in-memory credentials");
  expect(baseURL).toBe("http://127.0.0.1:3231");
  expect(database).toMatch(/^small_house_phase1_release_20261015_[a-z0-9]+$/);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && /\/(cart|checkout|orders)(\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.method());
  });
  await page.goto("/admin/login", { waitUntil: "load" });
  await page.locator("#boot-splash").waitFor({ state: "detached" });
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  const loginResponse = page.waitForResponse(response => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  await page.locator('button[type="submit"]').click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  const auth = await login.json();
  await page.waitForURL(url => !url.pathname.includes("/login"));
  async function readProduct(): Promise<AdminProduct> {
    const response = await fetch(`${apiOrigin}/admin/products/${productId}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
    if (!response.ok) throw new Error(`Owned fixture read HTTP${response.status}`);
    return response.json();
  }
  const before = await readProduct();
  async function editor(tab: "选项、价格与库存" | "商品规格" | "包装与物流") {
    await page.goto(`/admin/products/${productId}/edit`, { waitUntil: "load" });
    await page.locator("#boot-splash").waitFor({ state: "detached" });
    await page.getByRole("tab", { name: tab, exact: true }).click();
  }
  async function save() {
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/admin/products/${productId}` && response.request().method() === "PATCH");
    await page.locator('form button[type="submit"]').click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator('form button[type="submit"]')).toBeEnabled();
  }
  await editor("选项、价格与库存");
  for (const [axis, value] of [["长", "120"], ["宽", "60"], ["高", "75"]]) await page.getByLabel(`Large 的商品${axis}（cm）`, { exact: true }).fill(value);
  await page.getByRole("tab", { name: "包装与物流", exact: true }).click();
  const packageInput = page.getByLabel("粘贴包装信息").nth(1);
  const parsePackage = page.getByRole("button", { name: "解析包装信息", exact: true }).nth(1);
  await packageInput.fill("1,200x60x75cm");
  await parsePackage.click();
  await expect(page.getByRole("button", { name: "应用解析值", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await packageInput.fill("140x80x95cm 6kg");
  await parsePackage.click();
  await expect(page.getByLabel("Large 的外包装长", { exact: true })).toHaveValue("130");
  expect((await readProduct()).variants).toEqual(before.variants);
  await page.getByLabel("应用模式", { exact: true }).selectOption("replace");
  await page.getByRole("button", { name: "应用解析值", exact: true }).click();
  await save();
  await editor("选项、价格与库存");
  for (const [axis, value] of [["长", "120"], ["宽", "60"], ["高", "75"]]) await expect(page.getByLabel(`Large 的商品${axis}（cm）`, { exact: true })).toHaveValue(value);
  const applied = await readProduct();
  expect(applied.variants).toHaveLength(before.variants.length);
  const large = applied.variants.find(row => row.name === "Large")!.sku!;
  expect([large.productWidth, large.productDepth, large.productHeight]).toEqual([120, 60, 75]);
  expect([large.packageWidth, large.packageDepth, large.packageHeight, large.packageWeight, large.volumetricWeight]).toEqual([140, 80, 95, 6, 9]);
  const publicPath = `/products/${slug}`;
  await page.goto(publicPath, { waitUntil: "load" });
  await chooseSize(page, "Large");
  await expectDimensions(page, [120, 60, 75]);
  await expect(page.getByTestId("pdp-dimensions-line")).toHaveText("Dimensions: 120 × 75 × 60 cm");
  await page.getByRole("button", { name: "Size guide", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expectDimensionRow(dialog, "Width", 120);
  await expectDimensionRow(dialog, "Depth", 60);
  await expectDimensionRow(dialog, "Height", 75);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  for (const width of [1440, 390, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectDimensions(page, [120, 60, 75]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`variant-dimensions-${width}.png`), fullPage: width === 375 });
  }
  await chooseSize(page, "Small");
  await expectDimensions(page, [100, 50, 70]);
  await expect(page.getByTestId("pdp-dimensions-line")).toHaveText("Dimensions: 100 × 70 × 50 cm");
  await page.goto(`/lp/${landingSlug}`, { waitUntil: "load" });
  await chooseSize(page, "Large");
  await expectDimensions(page, [120, 60, 75]);
  await page.screenshot({ path: test.info().outputPath("landing-dimensions-375.png"), fullPage: true });
  await chooseSize(page, "Small");
  await expectDimensions(page, [100, 50, 70]);
  await editor("选项、价格与库存");
  await page.getByRole("button", { name: "恢复 Large 的商品尺寸继承", exact: true }).click();
  await page.getByRole("tab", { name: "商品规格", exact: true }).click();
  for (const [key, value] of [["width", "111"], ["depth", "55"], ["height", "77"]]) await page.locator(`#pf-${key}`).fill(value);
  await save();
  const inherited = (await readProduct()).variants.find(row => row.name === "Large")!.sku!;
  expect([inherited.productWidth, inherited.productDepth, inherited.productHeight]).toEqual([null, null, null]);
  await page.goto(publicPath, { waitUntil: "load" });
  await chooseSize(page, "Large");
  await expectDimensions(page, [111, 55, 77]);
  await expect(page.getByTestId("pdp-dimensions-line")).toHaveText("Dimensions: 111 × 77 × 55 cm");
  await page.goto(`/lp/${landingSlug}`, { waitUntil: "load" });
  await chooseSize(page, "Large");
  await expectDimensions(page, [111, 55, 77]);
  await editor("商品规格");
  for (const [key, value] of [["width", "100"], ["depth", "50"], ["height", "70"]]) await page.locator(`#pf-${key}`).fill(value);
  await page.getByRole("tab", { name: "包装与物流", exact: true }).click();
  for (const [label, value] of [["外包装长", "130"], ["外包装宽", "70"], ["外包装高", "85"], ["包装毛重", "5"]]) await page.getByLabel(`Large 的${label}`, { exact: true }).fill(value);
  await save();
  const final = await readProduct();
  expect(stripUpdatedAt(final.variants)).toEqual(stripUpdatedAt(before.variants));
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await fetch(`${apiOrigin}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: auth.refreshToken }) });
});

async function chooseSize(page: Page, size: string) {
  await page.getByTestId("pdp-purchase").getByRole("group", { name: "Size", exact: true }).getByRole("button", { name: size, exact: true }).click();
}

async function expectDimensionRow(scope: Locator, axis: string, value: number) {
  await expect(scope.getByText(axis, { exact: true }).first().locator("..").locator("dd")).toHaveText(`${value} cm`);
}

async function expectDimensions(page: Page, values: number[]) {
  for (const name of ["Product Specifications", "Material & Dimensions"]) {
    const region = page.getByRole("region", { name, exact: true });
    for (const [index, axis] of ["Width", "Depth", "Height"].entries()) await expectDimensionRow(region, axis, values[index]);
  }
}

function stripUpdatedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUpdatedAt);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updatedAt").map(([key, field]) => [key, stripUpdatedAt(field)]));
  return value;
}
