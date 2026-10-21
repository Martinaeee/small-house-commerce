import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Product, CartSummary } from "../src/lib/api";
import type { AdminGraphMedia, AdminGraphVariant, AdminProduct, AdminOption, WireMediaWrite } from "../src/lib/admin-api";
import { emptyDocument } from "../src/lib/homepage-document";
import { defaultSection } from "../src/lib/homepage-section-factory";
import { assertProductCardTestTarget } from "../src/test/product-card-test-target";

const target = assertProductCardTestTarget(process.env.PRODUCT_CARD_TEST_DATABASE_URL, process.env.PRODUCT_CARD_TEST_ROOT);
const API = "http://127.0.0.1:3214/api/v1";
const SLUG = "e2e-color-size";
const NAME = "E2E Color x Size Cabinet";
const coverUrl = "/uploads/e2e/card-blue-medium-cover.svg";
const sceneUrl = "/uploads/e2e/card-blue-medium-scene.svg";
const longColorLabel = "Ocean blue upholstery with a wide seat and compact profile for small apartment living";
type GraphProduct = Omit<AdminProduct, "options" | "media" | "variants"> & {
  options: AdminOption[];
  variants: AdminGraphVariant[];
  media: AdminGraphMedia[];
};
let api: APIRequestContext;
let headers: { Authorization: string };
let adminRefreshToken: string;
let product: Product;
let sizeProduct: Product;
let longProduct: Product;

async function publicProduct(slug: string): Promise<Product> {
  const response = await api.get(`${API}/storefront/products/${slug}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function adminProduct(id: string): Promise<GraphProduct> {
  const response = await api.get(`${API}/admin/products/${id}`, { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function addSceneMedia(snapshot: GraphProduct, rows: Omit<WireMediaWrite, "id" | "clientKey">[], extra: Record<string, unknown> = {}): Promise<void> {
  const media = new Map<string, WireMediaWrite>();
  for (const row of snapshot.media.filter((image) => image.isScene)) {
    media.set(row.id, { id: row.id, url: row.url, type: row.type, altText: row.altText,
      sortOrder: row.sortOrder, isScene: false,
      ...(row.optionValueId ? { optionValueId: row.optionValueId } : {}),
      ...(row.variantId ? { variantId: row.variantId } : {}) });
  }
  rows.forEach((row, index) => {
    const old = snapshot.media.find((image) => image.url === row.url);
    const identity = old ? { id: old.id } : { clientKey: `card-media-${index}` };
    media.set(old?.id ?? `card-media-${index}`, { ...identity, ...row });
  });
  const response = await api.patch(`${API}/admin/products/${snapshot.id}`, {
    headers, data: { catalogGraphVersion: snapshot.catalogGraphVersion,
      catalogGraph: { media: [...media.values()], ...extra } },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const saved = await adminProduct(snapshot.id);
  for (const row of rows) {
    expect(saved.media.find((image) => image.url === row.url)?.isScene).toBe(row.isScene);
  }
}

function card(page: Page, id = product.id): Locator {
  return page.locator(`article[data-product-id="${id}"]`).first();
}

async function selectBlueMedium(page: Page): Promise<Locator> {
  const item = card(page);
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await item.getByRole("button", { name: "Medium", exact: true }).click();
  await expect(item.getByRole("button", { name: "Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByRole("button", { name: "Medium", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(item.locator("img").first()).toHaveAttribute("src", coverUrl);
  await expect(item.locator(".line-through")).toContainText("1,499");
  return item;
}

async function assertRealAdd(page: Page, item: Locator, click: () => Promise<void> = () => item.getByRole("button", { name: "Add to Cart", exact: true }).click()): Promise<void> {
  const expected = product.variants.find((variant) => variant.sku?.skuCode === "E2E-CS-BLUE-M")!.sku!;
  expect(expected.price).toBe(1199);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/storefront\/cart\/items$/.test(request.url())) writes.push(request.postData() ?? "");
  });
  const pending = page.waitForResponse((response) => response.request().method() === "POST" && /\/storefront\/cart\/items$/.test(response.url()));
  await click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0])).toMatchObject({ skuId: expected.id, quantity: 1 });
  const added: CartSummary = await response.json();
  const read = await api.get(`${API}/storefront/cart/${added.cartId}/summary`);
  expect(read.ok(), await read.text()).toBe(true);
  const summary: CartSummary = await read.json();
  expect(summary.items.find((row) => row.skuId === expected.id)?.quantity).toBe(1);
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function assertNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test.beforeAll(async () => {
  expect(realpathSync(target.root)).toBe(target.root);
  expect(readFileSync(join(target.root, ".product-card-owner"), "utf8")).toBe("unified-product-card-20261010");
  api = await playwrightRequest.newContext({ extraHTTPHeaders: { "Cache-Control": "no-cache" } });
  const login = await api.post(`${API}/auth/login`, { data: { email: "e2e-admin@smallhouse.test", password: "E2eAdminPass123!" } });
  expect(login.ok(), await login.text()).toBe(true);
  const tokens = await login.json();
  headers = { Authorization: `Bearer ${tokens.accessToken}` };
  adminRefreshToken = tokens.refreshToken;
  const svgNames = ["card-shared-scene", "card-red-scene", "card-blue-scene", "card-blue-medium-cover", "card-blue-medium-scene", "card-size-scene", "card-exact-scene"];
  for (const [index, name] of svgNames.entries()) {
    writeFileSync(join(target.root, "backend/uploads/e2e", `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${["#9b7861", "#c87974", "#527f98", "#dce8ed", "#315d75", "#a5a67e", "#8b7365"][index]}"/><text x="20" y="250" font-size="20">${name}</text></svg>`);
  }
  const base = await publicProduct(SLUG);
  const snapshot = await adminProduct(base.id);
  const color = snapshot.options.find((option) => option.kind === "COLOR")!;
  const blueMedium = snapshot.variants.find((variant) => variant.sku?.skuCode === "E2E-CS-BLUE-M")!;
  await addSceneMedia(snapshot, [
    { url: "/uploads/e2e/card-shared-scene.svg", type: "IMAGE", sortOrder: 20, isScene: true },
    ...color.values.map((value) => ({ url: `/uploads/e2e/card-${value.label.toLowerCase()}-scene.svg`, type: "IMAGE" as const, sortOrder: 20, isScene: true, optionValueId: value.id })),
    { url: coverUrl, type: "IMAGE", sortOrder: 0, isScene: false, variantId: blueMedium.id },
    { url: sceneUrl, type: "IMAGE", sortOrder: 1, isScene: true, variantId: blueMedium.id },
  ], { defaultDisplayVariant: null, variants: [{ id: blueMedium.id, position: blueMedium.position,
    optionValueRefs: blueMedium.optionValues.map((value) => ({ id: value.optionValueId })),
    sku: { skuCode: "E2E-CS-BLUE-M", status: "ACTIVE", price: 1199, compareAtPrice: 1499 } }] });
  product = await publicProduct(SLUG);
  sizeProduct = await publicProduct("e2e-size-only");
  await addSceneMedia(await adminProduct(sizeProduct.id), [{ url: "/uploads/e2e/card-size-scene.svg", type: "IMAGE", sortOrder: 20, isScene: true }]);
  sizeProduct = await publicProduct("e2e-size-only");
  const exact = await publicProduct("e2e-exact-override");
  const exactSnapshot = await adminProduct(exact.id);
  const redValueId = exactSnapshot.options.find((option) => option.kind === "COLOR")!.values.find((value) => value.label === "Red")!.id;
  const red = exactSnapshot.variants.find((variant) => variant.optionValues.some((value) => value.optionValueId === redValueId))!;
  await addSceneMedia(exactSnapshot, [{ url: "/uploads/e2e/card-exact-scene.svg", type: "IMAGE", sortOrder: 20, isScene: true, variantId: red.id }]);
  longProduct = await publicProduct("e2e-color-only");
  const longSnapshot = await adminProduct(longProduct.id);
  const longOption = longSnapshot.options.find((option) => option.kind === "COLOR")!;
  const longSave = await api.patch(`${API}/admin/products/${longProduct.id}`, { headers, data: {
    catalogGraphVersion: longSnapshot.catalogGraphVersion,
    catalogGraph: { options: [{ ...longOption, values: longOption.values.map((value) => ({ ...value,
      label: value.label === "Blue" || value.label === longColorLabel ? longColorLabel : value.label })) }] },
  } });
  expect(longSave.ok(), await longSave.text()).toBe(true);
  longProduct = await publicProduct("e2e-color-only");
  const legacy = await publicProduct("e2e-legacy-style");

  const draft = await api.get(`${API}/admin/homepage/draft`, { headers });
  expect(draft.ok(), await draft.text()).toBe(true);
  const revision = await draft.json();
  const document = emptyDocument();
  const hero = document.sections.find((section) => section.type === "HERO")!;
  hero.enabled = false;
  hero.payload.slides[0].elements.heading.text = "Local catalog";
  hero.payload.slides[0].media = {
    type: "IMAGE", image: { url: "/uploads/e2e/color-size-shared-1.svg", alt: "Local catalog" }, video: null,
    mobileOverride: { enabled: false, image: null, video: null }, fit: "COVER",
    focal: { x: 50, y: 50 }, objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
  };
  const grid = defaultSection("PRODUCT_GRID", crypto.randomUUID(), 10);
  grid.title = "Product card acceptance";
  grid.products = [product, sizeProduct, exact, longProduct, legacy].map((row, index) => ({ productId: row.id, sortOrder: index, badge: "Card test" }));
  document.sections.push(grid);
  const save = await api.put(`${API}/admin/homepage/draft`, { headers, data: { draft: document, expectedRev: revision.draftRev } });
  expect(save.ok(), await save.text()).toBe(true);
  const publish = await api.post(`${API}/admin/homepage/publish`, { headers, data: { note: "Local card acceptance", publishAt: null, unpublishAt: null, confirmWarnings: true } });
  expect(publish.ok(), await publish.text()).toBe(true);
  const homepage = await api.get(`${API}/storefront/homepage`);
  expect(homepage.ok(), await homepage.text()).toBe(true);
  expect((await homepage.json()).sections.flatMap((section: { products: Product[] }) => section.products).some((row: Product) => row.id === product.id)).toBe(true);

  const list = await api.get(`${API}/admin/collections?search=card-acceptance`, { headers });
  expect(list.ok()).toBe(true);
  const existing = (await list.json()).items.find((row: { slug: string }) => row.slug === "card-acceptance");
  const collection = existing
    ? await api.patch(`${API}/admin/collections/${existing.id}`, { headers, data: { productIds: [product.id], status: "ACTIVE" } })
    : await api.post(`${API}/admin/collections`, { headers, data: { name: "Card acceptance", slug: "card-acceptance", type: "NAVIGATION", productIds: [product.id], status: "ACTIVE" } });
  expect(collection.ok(), await collection.text()).toBe(true);
});

test.afterAll(async () => { await api?.dispose(); });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  Object.assign(page, { cardErrors: errors });
});

test.afterEach(async ({ page }, info) => {
  const errors = (page as Page & { cardErrors: string[] }).cardErrors;
  const expectedNetworkError = info.title.includes("failed add") ? /Failed to load resource.*500/
    : info.title.includes("failed scene") ? /Failed to load resource: net::ERR_FAILED/ : null;
  if (expectedNetworkError) expect(errors.filter((error) => expectedNetworkError.test(error))).toHaveLength(1);
  const unexpected = expectedNetworkError ? errors.filter((error) => !expectedNetworkError.test(error)) : errors;
  expect(unexpected, "console/page/hydration errors").toEqual([]);
});

for (const width of [375, 768, 1440]) {
  for (const [entry, url] of [["home", "/"], ["category", "/categories/e2e-catalog"], ["search", "/search?q=E2E%20Color"]]) {
    test(`${entry} ${width}: inline selection sends the real SKU once`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(url);
      const item = await selectBlueMedium(page);
      await expect(item.getByRole("link", { name: "Order Now", exact: true })).toHaveCount(0);
      await assertNoOverflow(page);
      await item.screenshot({ path: join(target.root, `${entry}-${width}-card.png`) });
      await assertRealAdd(page, item);
      await page.screenshot({ path: join(target.root, `${entry}-${width}.png`), fullPage: true });
    });
  }
}

test("collection uses the same inline cart flow", async ({ page }) => {
  await page.goto("/collections/card-acceptance");
  await assertRealAdd(page, await selectBlueMedium(page));
});

test("related card selection leaves the main PDP and its URL unchanged", async ({ page }) => {
  await page.goto("/products/e2e-size-only");
  const originalUrl = page.url();
  const checkedBefore = await page.locator("[aria-pressed=true]").allTextContents();
  const item = await selectBlueMedium(page);
  expect(page.url()).toBe(originalUrl);
  for (const label of checkedBefore) expect(await page.locator("[aria-pressed=true]").allTextContents()).toContain(label);
  await assertRealAdd(page, item);
});

test("recently viewed uses the same independent card", async ({ page }) => {
  await page.goto(`/products/${SLUG}`);
  await expect(page.getByRole("heading", { name: NAME, exact: true }).first()).toBeVisible();
  await page.goto("/");
  const recent = page.locator("section").filter({ has: page.getByRole("heading", { name: "Recently Viewed", exact: true }) });
  const item = recent.locator(`article[data-product-id="${product.id}"]`);
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await item.getByRole("button", { name: "Medium", exact: true }).click();
  await assertRealAdd(page, item);
});

test("image-only hover loads the exact scene, restores cover and never fetches PDP routes or product APIs", async ({ page }) => {
  await page.goto("/categories/e2e-catalog");
  const queries: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\/api\/v1\/(?:storefront|admin)\/(?:products|media)(?:\/|$)/.test(url.pathname) || url.pathname === `/products/${SLUG}`) queries.push(request.url());
  });
  const item = await selectBlueMedium(page);
  await item.getByRole("button", { name: "Blue", exact: true }).hover();
  await expect(item.locator("[data-card-scene]")).toHaveCount(0);
  const image = item.getByRole("link", { name: NAME, exact: true }).first();
  await image.hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", sceneUrl);
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  await expect.poll(() => item.evaluate((node) => getComputedStyle(node).translate)).toBe("0px -2px");
  expect(await item.locator("img").first().evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await item.getByRole("button", { name: "Blue", exact: true }).hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  expect(queries).toEqual([]);
});

test("late scene load after pointer leave never replaces the cover", async ({ page }) => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`**${sceneUrl}`, async (route) => { started(); await blocked; await route.continue(); });
  await page.goto("/categories/e2e-catalog");
  const item = await selectBlueMedium(page);
  await item.getByRole("link", { name: NAME, exact: true }).first().hover();
  await requested;
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await item.getByRole("button", { name: "Blue", exact: true }).hover();
  release();
  await expect.poll(() => item.locator("[data-card-scene]").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await expect(item.locator("img").first()).toHaveAttribute("src", coverUrl);
});

test("375px long option labels stay reachable without clipping the card", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/categories/e2e-catalog");
  const item = card(page, longProduct.id);
  const option = item.getByRole("button", { name: longColorLabel, exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  const bounds = await option.boundingBox();
  const cardBounds = await item.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeLessThanOrEqual(cardBounds!.width);
  await item.getByRole("button", { name: "Add to Cart", exact: true }).scrollIntoViewIfNeeded();
  await expect(item.getByRole("button", { name: "Add to Cart", exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await item.screenshot({ path: join(target.root, "long-option-375.png") });
});

test("option and shared scene projections remain scope-local in the browser", async ({ page }) => {
  await page.goto("/categories/e2e-catalog");
  const item = card(page);
  await item.getByRole("button", { name: "Red", exact: true }).click();
  await item.getByRole("button", { name: "Medium", exact: true }).click();
  await item.getByRole("link", { name: NAME, exact: true }).first().hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", "/uploads/e2e/card-red-scene.svg");
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await item.getByRole("button", { name: "Small", exact: true }).click();
  await item.getByRole("link", { name: NAME, exact: true }).first().hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", "/uploads/e2e/card-blue-scene.svg");
  await expect(item.getByRole("button", { name: "Save for Later", exact: true })).toBeVisible();
  const shared = card(page, sizeProduct.id);
  await shared.getByRole("button", { name: "Small", exact: true }).click();
  await shared.getByRole("link").first().hover();
  await expect(shared.locator("[data-card-scene]")).toHaveAttribute("src", "/uploads/e2e/card-size-scene.svg");
});

test("failed scene keeps its cover and does not carry failure into another scope", async ({ page }) => {
  await page.route(`**${sceneUrl}`, (route) => route.abort());
  await page.goto("/categories/e2e-catalog");
  const item = await selectBlueMedium(page);
  await item.getByRole("link", { name: NAME, exact: true }).first().hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await expect(item.locator("img").first()).toHaveAttribute("src", coverUrl);
  await item.getByRole("button", { name: "Red", exact: true }).click();
  await item.getByRole("link", { name: NAME, exact: true }).first().hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  await page.unroute(`**${sceneUrl}`);
});

test("touch opens details on its first tap without mounting a card hover scene", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true,
    extraHTTPHeaders: { "Cache-Control": "no-cache" } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const probe = { sceneMounts: 0 };
    Object.assign(window, { cardTouchProbe: probe });
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches("[data-card-scene]") || node.querySelector("[data-card-scene]"))) probe.sceneMounts++;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const scenes: string[] = [];
  const errors: string[] = [];
  let openingDetails = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/products/${SLUG}`) openingDetails = true;
    if (!openingDetails && /card-.*-scene\.svg/.test(url.pathname)) scenes.push(request.url());
  });
  await page.goto("http://localhost:3215/categories/e2e-catalog");
  const item = card(page);
  await expect(item.locator("[data-card-scene]")).toHaveCount(0);
  expect(openingDetails).toBe(false);
  await item.getByRole("link", { name: NAME, exact: true }).first().tap();
  await expect(page).toHaveURL(new RegExp(`/products/${SLUG}`));
  expect(scenes).toEqual([]);
  expect(await page.evaluate(() => (window as Window & { cardTouchProbe?: { sceneMounts: number } }).cardTouchProbe?.sceneMounts)).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("keyboard focus exposes scene while reduced motion removes transition and lift", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/categories/e2e-catalog");
  const item = await selectBlueMedium(page);
  const image = item.getByRole("link", { name: NAME, exact: true }).first();
  await item.getByRole("button", { name: "Blue", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(image).toBeFocused();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  await page.keyboard.press("Tab");
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await image.hover();
  expect(await item.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  expect(await item.locator("[data-card-scene]").evaluate((node) => getComputedStyle(node).transitionProperty)).toBe("none");
  expect(await item.evaluate((node) => getComputedStyle(node).translate)).toBe("none");
});

test("failed add retains selection and a retry submits the real SKU", async ({ page }) => {
  await page.goto("/categories/e2e-catalog");
  const item = await selectBlueMedium(page);
  let fail = true;
  await page.route("**/storefront/cart/items", async (route) => {
    if (fail) { fail = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Card test retry" }) }); }
    else await route.continue();
  });
  await item.getByRole("button", { name: "Add to Cart", exact: true }).click();
  await expect(item.getByRole("alert")).toContainText("Card test retry");
  await expect(item.getByRole("button", { name: "Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertRealAdd(page, item);
});

test("same-task double click sends one cart POST", async ({ page }) => {
  await page.goto("/categories/e2e-catalog");
  const item = await selectBlueMedium(page);
  await assertRealAdd(page, item, () => item.getByRole("button", { name: "Add to Cart", exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); }));
});

test("admin preview is inert and scrollable in all three fixed device canvases", async ({ page }) => {
  await page.addInitScript((token) => localStorage.setItem("sh_admin_refresh", token), adminRefreshToken);
  await page.goto("/admin/homepage");
  const preview = page.locator("[data-homepage-live-preview]");
  await expect(preview.locator(`article[data-product-id="${product.id}"]`)).toBeVisible();
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/storefront\/cart\/items$/.test(request.url())) writes.push(request.url()); });
  for (const [label, device] of [["桌面端", "desktop"], ["平板端", "tablet"], ["移动端", "mobile"]] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const item = preview.locator(`article[data-product-id="${product.id}"]`);
    for (const button of await item.getByRole("button").all()) await expect(button).toBeDisabled();
    await expect(item.getByRole("link")).toHaveCount(0);
    await expect(item.locator('[data-track-event="ProductClick"]')).toHaveCount(0);
    const scroll = await preview.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return { top: node.scrollTop, overflow: getComputedStyle(node).overflowY, height: node.clientHeight };
    });
    expect(scroll.overflow).toBe("auto");
    expect(scroll.height).toBe({ desktop: 900, tablet: 1024, mobile: 844 }[device]);
    expect(scroll.top).toBeGreaterThan(0);
    await page.screenshot({ path: join(target.root, `preview-${device}.png`), fullPage: true });
  }
  expect(writes).toEqual([]);
  await expect(page).toHaveURL(/\/admin\/homepage$/);
});
