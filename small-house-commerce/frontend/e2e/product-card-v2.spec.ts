import { expect, request, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Product, CartSummary } from "../src/lib/api";
import type { AdminProduct, AdminGraphVariant, AdminGraphMedia, AdminOption } from "../src/lib/admin-api";
import { assertProductCardV2TestTarget } from "../src/test/product-card-v2-test-target";

const target = assertProductCardV2TestTarget(process.env.CARD_V2_DB_URL, process.env.CARD_V2_ROOT);
const API = "http://127.0.0.1:3216/api/v1";
const sessionPath = join(target.root, "browser-admin-session.json");
type GraphProduct = Omit<AdminProduct, "options" | "variants" | "media"> & { options: AdminOption[]; variants: AdminGraphVariant[]; media: AdminGraphMedia[] };
let api: APIRequestContext;
let headers: { Authorization: string };
let main: Product, same: Product, twelve: Product, hundred: Product, single: Product, legacy: Product, sparse: Product;
const issues = new WeakMap<Page, string[]>();

async function getProduct(slug: string): Promise<Product> {
  const response = await api.get(`${API}/storefront/products/${slug}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function adminProduct(id: string): Promise<GraphProduct> {
  const response = await api.get(`${API}/admin/products/${id}`, { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function checkedPatch(id: string, data: object): Promise<GraphProduct> {
  const response = await api.patch(`${API}/admin/products/${id}`, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
function image(label: string, hover = false) {
  const name = `v2-${label}-${hover ? "hover" : "cover"}`;
  const color = hover ? "#8c9d89" : "#d7c4a7";
  writeFileSync(join(target.root, "uploads/e2e", `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${color}"/><rect x="120" y="140" width="560" height="270" rx="8" fill="#765946"/><path d="M155 410v100m490-100v100" stroke="#523e31" stroke-width="26"/><text x="30" y="560" font-size="22">${name}</text></svg>`);
  return { type: "IMAGE" as const, url: `/uploads/e2e/${name}.svg`, altText: name };
}
async function configure(slug: string, mode: "pair" | "same") {
  const original = await getProduct(slug);
  const snapshot = await adminProduct(original.id);
  const gallery = snapshot.media;
  const defaultVariant = snapshot.variants.find(v => v.sku?.skuCode.endsWith("BLUE-M")) ?? snapshot.variants.at(-1)!;
  await checkedPatch(snapshot.id, { status: "DRAFT" });
  await checkedPatch(snapshot.id, { status: "ACTIVE", catalogGraphVersion: snapshot.catalogGraphVersion, catalogGraph: {
    defaultDisplayVariant: { id: defaultVariant.id },
    variants: snapshot.variants.map(v => {
      const cover = image(v.sku!.skuCode.toLowerCase());
      return { id: v.id, position: v.position, optionValueRefs: v.optionValues.map(x => ({ id: x.optionValueId })),
        cardMedia: { cover, hover: mode === "same" ? cover : image(v.sku!.skuCode.toLowerCase(), true) },
        sku: { skuCode: v.sku!.skuCode, status: "ACTIVE", price: Number(v.sku!.price), compareAtPrice: 1499 } };
    }),
  } });
  expect((await adminProduct(snapshot.id)).media).toEqual(gallery);
  return getProduct(slug);
}
async function makeLong(count: number): Promise<Product> {
  const slug = `cardv2-long-${count}`;
  const existing = await api.get(`${API}/admin/products?search=${slug}`, { headers });
  const found = (await existing.json()).items.find((p: AdminProduct) => p.slug === slug);
  if (found) {
    const product = await getProduct(slug);
    const stock = await api.put(`${API}/admin/inventory/stock/batch`, { headers, data: product.variants.map(v => ({ skuId: v.sku!.id, onHand: 20 })) });
    expect(stock.ok(), await stock.text()).toBe(true);
    return getProduct(slug);
  }
  const created = await api.post(`${API}/admin/products`, { headers, data: { name: `CardV2 ${count} finishes`, slug, categoryId: main.categoryId,
    status: "DRAFT", images: [], variants: [] } });
  expect(created.ok(), await created.text()).toBe(true);
  const base: AdminProduct = await created.json();
  const cover = image(`long-${count}`);
  await checkedPatch(base.id, { status: "ACTIVE", catalogGraphVersion: base.catalogGraphVersion, catalogGraph: {
    options: [{ clientKey: "style", kind: "STYLE", name: "Style", position: 0, presentation: "TEXT", isMediaDriver: true, isActive: true,
      values: Array.from({ length: count }, (_, i) => ({ clientKey: `style-${i}`, label: `Performance Multi Twill, Cream with finish ${i}`, position: i, isActive: true })) }],
    variants: Array.from({ length: count }, (_, i) => ({ clientKey: `variant-${i}`, position: i, optionValueRefs: [{ clientKey: `style-${i}` }],
      cardMedia: { cover: { ...cover, altText: `Finish ${i}` }, hover: null },
      sku: { skuCode: `CARDV2-${count}-${i}`, status: "ACTIVE", price: count === 1 ? 0 : 500 + i, compareAtPrice: count === 1 ? null : 900 } })),
    defaultDisplayVariant: { clientKey: "variant-0" },
  } });
  const fresh = await getProduct(slug);
  const stock = await api.put(`${API}/admin/inventory/stock/batch`, { headers, data: fresh.variants.map(v => ({ skuId: v.sku!.id, onHand: 20 })) });
  expect(stock.ok(), await stock.text()).toBe(true);
  return getProduct(slug);
}
async function makeSpecial(): Promise<Product> {
  const kind = "sparse";
  const slug = `cardv2-${kind}`;
  const response = await api.get(`${API}/admin/products?search=${slug}`, { headers });
  const existing = (await response.json()).items.find((p: AdminProduct) => p.slug === slug);
  if (existing?.status === "ACTIVE") return getProduct(slug);
  const created = existing ?? await (await api.post(`${API}/admin/products`, { headers, data: {
    name: `CardV2 ${kind}`, slug, categoryId: main.categoryId, status: "DRAFT", images: [], variants: [],
  } })).json();
  const values = ["Red", "Blue", "Small", "Large"];
  const options = [{ clientKey: "color", kind: "COLOR", name: "Color", position: 0, presentation: "TEXT", isMediaDriver: true, isActive: true,
    values: values.slice(0, 2).map((label, i) => ({ clientKey: label.toLowerCase(), label, position: i, isActive: true })) },
    { clientKey: "size", kind: "SIZE", name: "Size", position: 1, presentation: "TEXT", isMediaDriver: false, isActive: true,
      values: values.slice(2).map((label, i) => ({ clientKey: label.toLowerCase(), label, position: i, isActive: true })) }];
  const combinations = [["red", "small"], ["red", "large"], ["blue", "small"]];
  const snapshot = created.catalogGraphVersion > 0 ? await adminProduct(created.id) : await checkedPatch(created.id, { catalogGraphVersion: created.catalogGraphVersion, catalogGraph: { options,
    variants: combinations.map((refs, i) => ({ clientKey: `variant-${i}`, position: i, optionValueRefs: refs.map(clientKey => ({ clientKey })),
      cardMedia: { cover: image(`${kind}-${i}`), hover: image(`${kind}-${i}`, true) },
      sku: { skuCode: `CARDV2-${kind}-${i}`, status: "ACTIVE", price: 700 + i, compareAtPrice: 900 } })),
    defaultDisplayVariant: { clientKey: "variant-0" },
  } });
  const stock = await api.put(`${API}/admin/inventory/stock/batch`, { headers, data: snapshot.variants.filter(v => v.sku !== null).map((v, i) => ({ skuId: v.sku!.id, onHand: i === 2 ? 0 : 10 })) });
  expect(stock.ok(), await stock.text()).toBe(true);
  await checkedPatch(created.id, { status: "ACTIVE" });
  return getProduct(slug);
}
function card(page: Page, product = main): Locator { return page.locator(`article[data-product-id="${product.id}"]`).first(); }
function pairFor(product: Product, skuCode: string) {
  const variant = product.variants.find(v => v.sku?.skuCode === skuCode)!;
  return { variant, pair: product.cardMedia!.variants.find(row => row.variantId === variant.id)! };
}
async function selectSecondary(page: Page, item: Locator, value: string) {
  await item.getByRole("button", { name: "More options", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Product options" });
  await dialog.getByRole("button", { name: value, exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}
async function selectBlueMedium(page: Page) {
  const item = card(page);
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await selectSecondary(page, item, "Medium");
  const chosen = pairFor(main, "E2E-CS-BLUE-M");
  await expect(item.locator("img").first()).toHaveAttribute("src", chosen.pair.cover!.url);
  await expect(item.getByTestId("price")).toContainText("1,199");
  await expect(item.locator(".line-through")).toContainText("1,499");
  return item;
}
async function assertAdd(page: Page, item: Locator, skuId: string, double = false) {
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /\/storefront\/cart\/items$/.test(request.url())) writes.push(request.postData()!); });
  const response = page.waitForResponse(r => r.request().method() === "POST" && /\/storefront\/cart\/items$/.test(r.url()));
  if (double) await item.getByRole("button", { name: "Add to Cart", exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  else await item.getByRole("button", { name: "Add to Cart", exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  const summary: CartSummary = await result.json();
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]!)).toMatchObject({ skuId, quantity: 1 });
  expect(summary.items).toEqual(expect.arrayContaining([expect.objectContaining({ skuId, quantity: 1 })]));
  const readback = await api.get(`${API}/storefront/cart/${summary.cartId}/summary`);
  expect(readback.ok(), await readback.text()).toBe(true);
  expect((await readback.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ skuId, quantity: 1 })]));
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function loginPage(page: Page) {
  const { refreshToken } = JSON.parse(readFileSync(sessionPath, "utf8"));
  await page.addInitScript(token => { if (!localStorage.getItem("sh_admin_refresh")) localStorage.setItem("sh_admin_refresh", token); }, refreshToken);
}

test.beforeAll(async () => {
  api = await request.newContext({ extraHTTPHeaders: { "Cache-Control": "no-cache" } });
  let login = existsSync(sessionPath)
    ? await api.post(`${API}/auth/refresh`, { data: JSON.parse(readFileSync(sessionPath, "utf8")) })
    : await api.post(`${API}/auth/login`, { data: { email: "e2e-admin@smallhouse.test", password: "E2eAdminPass123!" } });
  if (login.status() === 401 && existsSync(sessionPath)) {
    login = await api.post(`${API}/auth/login`, { data: { email: "e2e-admin@smallhouse.test", password: "E2eAdminPass123!" } });
  }
  expect(login.ok(), await login.text()).toBe(true);
  const tokens = await login.json();
  writeFileSync(sessionPath, JSON.stringify({ refreshToken: tokens.refreshToken }), { mode: 0o600 });
  headers = { Authorization: `Bearer ${tokens.accessToken}` };
  const recoveryFixtures = await (await api.get(`${API}/admin/products?search=cardv2-recovery`, { headers })).json();
  for (const product of recoveryFixtures.items as AdminProduct[]) if (product.slug.startsWith("cardv2-recovery-") && product.status === "ACTIVE") await checkedPatch(product.id, { status: "DRAFT" });
  main = await configure("e2e-color-size", "pair");
  same = await configure("e2e-size-only", "same");
  legacy = await getProduct("e2e-legacy-style");
  twelve = await makeLong(12); hundred = await makeLong(100); single = await makeLong(1);
  sparse = await makeSpecial();
  // Release A ships the card without the homepage builder: provision the
  // CMS homepage grid through the existing admin homepage endpoints so the
  // homepage entrance renders exactly the V2 fixtures.
  const sectionsResponse = await api.get(`${API}/admin/homepage/sections`, { headers });
  expect(sectionsResponse.ok(), await sectionsResponse.text()).toBe(true);
  const sections = (await sectionsResponse.json()) as Array<{ id: string; type: string; title: string | null; subtitle: string | null; enabled: boolean; sortOrder: number; payload: Record<string, unknown> }>;
  const gridSave = await api.patch(`${API}/admin/homepage/sections`, { headers, data: { sections: [
    ...sections.map(section => ({ id: section.id, type: section.type, title: section.title, subtitle: section.subtitle, enabled: section.type === "PRODUCT_GRID", sortOrder: section.type === "PRODUCT_GRID" ? 0 : section.sortOrder, payload: section.payload })),
    ...(sections.some(section => section.type === "PRODUCT_GRID") ? [] : [{ type: "PRODUCT_GRID", title: "CardV2 acceptance", enabled: true, sortOrder: 0, payload: { columns: 4 } }]),
  ] } });
  expect(gridSave.ok(), await gridSave.text()).toBe(true);
  const savedSections = (await (await api.get(`${API}/admin/homepage/sections`, { headers })).json()) as Array<{ id: string; type: string }>;
  const gridSection = savedSections.find(section => section.type === "PRODUCT_GRID")!;
  const setProducts = await api.put(`${API}/admin/homepage/sections/${gridSection.id}/products`, { headers, data: {
    rows: [main, same, twelve, hundred, single, legacy, sparse].map((p, i) => ({ productId: p.id, sortOrder: i, badge: null })),
  } });
  expect(setProducts.ok(), await setProducts.text()).toBe(true);
  const collectionList = await (await api.get(`${API}/admin/collections?search=cardv2-acceptance`, { headers })).json();
  const collection = collectionList.items.find((p: { slug: string }) => p.slug === "cardv2-acceptance");
  const response = collection ? await api.patch(`${API}/admin/collections/${collection.id}`, { headers, data: { productIds: [main.id], status: "ACTIVE" } })
    : await api.post(`${API}/admin/collections`, { headers, data: { name: "CardV2 acceptance", slug: "cardv2-acceptance", type: "NAVIGATION", productIds: [main.id], status: "ACTIVE" } });
  expect(response.ok(), await response.text()).toBe(true);
  writeFileSync(join(target.root, "browser-fixtures.json"), JSON.stringify({ main, same, twelve, hundred, single, legacy, sparse }, null, 2));
});
test.afterAll(async () => { await api?.dispose(); });
test.beforeEach(({ page }) => {
  const errors: string[] = []; issues.set(page, errors);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
});
test.afterEach(async ({ page }, info) => {
  if (page.url().startsWith("http://localhost:3217")) {
    const refreshToken = await page.evaluate(() => localStorage.getItem("sh_admin_refresh"));
    if (refreshToken) writeFileSync(sessionPath, JSON.stringify({ refreshToken }), { mode: 0o600 });
  }
  const errors = issues.get(page) ?? [];
  const expected = info.title.includes("failed add") ? /Failed to load resource.*500/ : info.title.includes("failed hover") ? /Failed to load resource.*ERR_FAILED/
    : info.title.includes("409") ? /Failed to load resource.*409/ : info.title.includes("ACTIVE phase failure") ? /Failed to load resource.*400/ : null;
  if (expected) expect(errors.filter(e => expected.test(e))).toHaveLength(1);
  expect(expected ? errors.filter(e => !expected.test(e)) : errors, "unexpected console/page errors").toEqual([]);
});

for (const width of [375, 768, 1440]) {
  test(`compact color-first card at ${width}: small solid squares and no extra option rows`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/");
    const item = card(page); await expect(item).toBeVisible();
    await expect(item.getByRole("group", { name: "Color", exact: true })).toHaveCount(1);
    await expect(item.getByRole("group", { name: "Size", exact: true })).toHaveCount(0);
    const red = item.getByRole("button", { name: "Red", exact: true });
    const square = await red.boundingBox();
    expect(square!.width).toBe(28); expect(square!.height).toBe(28);
    const color = main.options.find(option => option.kind === "COLOR")!;
    if (color.presentation === "IMAGE") {
      await expect(red.locator("img")).toHaveAttribute("src", color.values.find(value => value.label === "Red")!.thumbnailUrl!);
      expect(await red.locator("img").evaluate(node => getComputedStyle(node).objectFit)).toBe("cover");
    } else {
      expect(await red.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(192, 57, 43)");
    }
    const frame = await item.getByRole("link").first().boundingBox();
    // Mobile may need two title lines and three price/discount lines; no second option row.
    expect((await item.boundingBox())!.height - frame!.height).toBeLessThanOrEqual(260);
    const more = item.getByRole("button", { name: "More options", exact: true });
    await more.click(); const dialog = page.getByRole("dialog", { name: "Product options" });
    await expect(dialog.getByRole("group", { name: "Size options", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Blue", exact: true }).click();
    await dialog.getByRole("button", { name: "Medium", exact: true }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(more).toBeFocused();
    await expect(item.getByRole("button", { name: "Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(item.getByRole("link").first()).toHaveAttribute("href", `/products/${main.slug}?variant=${pairFor(main, "E2E-CS-BLUE-M").variant.id}`);
    await noOverflow(page);
    await item.screenshot({ path: join(target.root, `compact-card-${width}.png`) });
  });
}

for (const width of [375, 768, 1440]) for (const [entry, url] of [["home", "/"], ["category", "/categories/e2e-catalog"], ["search", "/search?q=E2E%20Color"]]) {
  test(`${entry} ${width}: independent selection, exact price and real cart`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(url!);
    const item = await selectBlueMedium(page); await noOverflow(page);
    await item.screenshot({ path: join(target.root, `v2-${entry}-${width}.png`) });
    await assertAdd(page, item, pairFor(main, "E2E-CS-BLUE-M").variant.sku!.id);
  });
}
test("collection uses the same card and actual cart", async ({ page }) => {
  await page.goto("/collections/cardv2-acceptance");
  await assertAdd(page, await selectBlueMedium(page), pairFor(main, "E2E-CS-BLUE-M").variant.sku!.id);
});
test("related card choices leave the PDP and URL unchanged", async ({ page }) => {
  await page.goto("/products/e2e-size-only");
  const url = page.url();
  const pdpChoices = () => page.locator('[aria-pressed="true"]').evaluateAll(nodes => nodes.filter(n => !n.closest('article')).map(n => n.textContent));
  const selected = await pdpChoices();
  const item = card(page, hundred);
  await item.getByRole("button", { name: "More Style options" }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("finish 99");
  await page.getByRole("dialog").getByRole("button", { name: "Performance Multi Twill, Cream with finish 99", exact: true }).click();
  await expect(item.getByTestId("price")).toContainText("₱599.00");
  expect(page.url()).toBe(url);
  expect(await pdpChoices()).toEqual(selected);
});
test("recently viewed reloads pairs using the existing batch API", async ({ page }) => {
  await page.goto("/products/e2e-color-size");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sh:rv"))).toContain(main.id);
  await page.goto("/");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Recently Viewed", exact: true }) });
  await expect(section.locator(`article[data-product-id="${main.id}"] img`).first()).toHaveAttribute("src", main.cardMedia!.unselected.cover!.url);
});
test("desktop lifts only visually and hover swaps only over the image with no product prefetch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/");
  const item = card(page); await expect(item).toBeVisible();
  const imageRegion = item.getByRole("link").first();
  const requests: string[] = [];
  page.on("request", r => { if (/\/api\/v1\/(storefront|admin)\/(products|media)/.test(r.url()) || r.url().includes(`/products/${main.slug}`)) requests.push(r.url()); });
  const before = await item.boundingBox(); const neighbor = await card(page, same).boundingBox();
  await item.getByRole("heading").hover();
  await expect.poll(() => item.evaluate(node => getComputedStyle(node).translate)).toBe("0px -6px");
  await expect(item.locator("[data-card-scene]")).toHaveCount(0);
  await imageRegion.hover();
  const scene = item.locator("[data-card-scene]");
  await expect(scene).toHaveAttribute("data-visible", "true");
  expect(await item.evaluate(n => getComputedStyle(n).transitionDuration)).toBe("0.2s");
  expect(await item.evaluate(n => getComputedStyle(n).boxShadow)).not.toBe("none");
  const frame = await imageRegion.boundingBox(); expect(frame!.width).toBeCloseTo(frame!.height, 0);
  expect(await item.locator("img").first().evaluate(n => getComputedStyle(n).objectFit)).toBe("contain");
  expect(await scene.evaluate(n => getComputedStyle(n).objectFit)).toBe("cover");
  expect((await item.boundingBox())!.y).toBeCloseTo(before!.y - 6, 0);
  expect(await card(page, same).boundingBox()).toEqual(neighbor);
  await item.getByRole("heading").hover(); await expect(scene).toHaveAttribute("data-visible", "false");
  expect(await scene.evaluate(n => getComputedStyle(n).transitionDuration)).toBe("0s");
  await item.getByRole("button", { name: "Red", exact: true }).click();
  await selectSecondary(page, item, "Small");
  expect(requests).toEqual([]);
  await item.screenshot({ path: join(target.root, "v2-lift.png") });
});
for (const width of [375, 768, 1440]) for (const count of [12, 100]) {
  test(`${count} long variants at ${width}: one row, search, full labels and selected tail`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/");
    const product = count === 12 ? twelve : hundred;
    const item = card(page, product); await item.scrollIntoViewIfNeeded();
    const group = item.getByRole("group", { name: "Style", exact: true });
    const bounds = await group.getByRole("button").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
    expect(Math.max(...bounds) - Math.min(...bounds)).toBeLessThan(1);
    const more = item.getByRole("button", { name: "More Style options" });
    await more.click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(n => n.matches(":modal"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    expect(await dialog.getByRole("group").getByRole("button").count()).toBe(count);
    if (width === 375) {
      const box = await dialog.boundingBox(); expect(box!.y + box!.height).toBeCloseTo(900, 0);
      expect(box!.height).toBeLessThanOrEqual(721);
      expect(await dialog.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
    }
    await dialog.getByRole("searchbox").fill("does-not-exist"); await expect(dialog.getByText("No matching options")).toBeVisible();
    await dialog.getByRole("button", { name: "Clear search" }).click();
    await dialog.getByRole("searchbox").fill(`finish ${count - 1}`);
    await dialog.getByRole("button", { name: `Performance Multi Twill, Cream with finish ${count - 1}`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const label = `Performance Multi Twill, Cream with finish ${count - 1}`;
    if (width === 375) await expect(group.locator(`span[title="${label}"]`)).toBeVisible();
    else await expect(item.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(item.getByTestId("price")).toContainText(`₱${500 + count - 1}.00`);
    const chosen = product.variants.find(v => v.sku?.skuCode === `CARDV2-${count}-${count - 1}`)!;
    await expect(item.getByRole("link").first()).toHaveAttribute("href", `/products/${product.slug}?variant=${chosen.id}`);
    await expect(more).toBeFocused(); await noOverflow(page);
    await item.screenshot({ path: join(target.root, `v2-long-${count}-${width}.png`) });
  });
}
test("native keyboard trap, Escape, backdrop and resize stay inside viewport", async ({ page }) => {
  await page.goto("/"); const more = card(page, twelve).getByRole("button", { name: "More Style options" });
  await more.focus(); await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(n => n.contains(document.activeElement) || (!document.hasFocus() && document.activeElement === document.body))).toBe(true);
  }
  await dialog.getByRole("searchbox").focus();
  await card(page).getByRole("link").first().evaluate((n: HTMLElement) => n.focus());
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await page.setViewportSize({ width: 768, height: 600 });
  await expect.poll(async () => { const box = await dialog.boundingBox(); return box !== null && box.x >= 0 && box.x + box.width <= 768 && box.y + box.height <= 600; }).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(more).toBeFocused();
  await more.click(); await page.mouse.click(1, 1); await expect(dialog).toHaveCount(0); await expect(more).toBeFocused();
});
test("closing after container expansion restores focus even when More disappeared", async ({ page }) => {
  await page.goto("/"); const item = card(page, twelve);
  const group = item.getByRole("group", { name: "Style", exact: true });
  await item.getByRole("button", { name: "More Style options" }).click();
  await group.evaluate((node: HTMLElement) => { node.style.width = "1500px"; });
  await expect(item.getByRole("button", { name: "More Style options" })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Performance Multi Twill, Cream with finish 0", exact: true })).toBeFocused();
});

test("same images and a cover-only single zero-price SKU never mount duplicate hover", async ({ page }) => {
  await page.goto("/");
  for (const product of [same, single]) { const item = card(page, product); await item.getByRole("link").first().hover(); await expect(item.locator("[data-card-scene]")).toHaveCount(0); }
  await expect(card(page, single).getByTestId("price")).toContainText("₱0.00");
  await assertAdd(page, card(page, single), single.variants[0]!.sku!.id);
});
test("unconfigured legacy stays a placeholder without an inferred selected default", async ({ page }) => {
  await page.goto("/"); const item = card(page, legacy);
  await expect(item.locator("img")).toHaveCount(0); await expect(item.locator('[aria-pressed="true"]')).toHaveCount(0);
});
test("late hover load after leaving the image cannot cover the current image", async ({ page }) => {
  const sceneUrl = main.cardMedia!.unselected.scene!.url;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${sceneUrl}`, async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await page.goto("/"); const item = card(page);
  await item.getByRole("link").first().hover(); await expect(item.locator("[data-card-scene]")).toHaveCount(1);
  await item.getByRole("heading").hover(); release();
  await expect.poll(() => item.locator("[data-card-scene]").evaluate((n: HTMLImageElement) => n.complete)).toBe(true);
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await expect(item.locator("img").first()).toHaveAttribute("src", main.cardMedia!.unselected.cover!.url);
});
test("failed hover keeps cover and a different variant still works", async ({ page }) => {
  await page.route(`**${main.cardMedia!.unselected.scene!.url}`, route => route.abort("failed"));
  await page.goto("/"); const item = card(page); await item.getByRole("link").first().hover();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "false");
  await item.getByRole("button", { name: "Red", exact: true }).click(); await selectSecondary(page, item, "Small");
  await item.getByRole("link").first().hover(); await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", pairFor(main, "E2E-CS-RED-S").pair.scene!.url);
});
test("keyboard preview and reduced motion have no animation or lift", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/"); const item = card(page); const link = item.getByRole("link").first();
  await page.keyboard.press("Tab"); await link.focus();
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  await link.hover(); expect(await item.evaluate(n => getComputedStyle(n).translate)).toBe("none");
  expect(await item.evaluate(n => getComputedStyle(n).transitionProperty)).toBe("none");
  expect(await item.locator("[data-card-scene]").evaluate(n => getComputedStyle(n).transitionProperty)).toBe("none");
});
test("touch first tap navigates without mounting a hover layer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, baseURL: "http://localhost:3217" });
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => { new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && (n.matches("[data-card-scene]") || n.querySelector("[data-card-scene]"))) sessionStorage.setItem("card-hover-mounted", "yes"); }).observe(document, { childList: true, subtree: true }); });
  await page.goto("/"); const item = card(page); expect(await item.evaluate(n => getComputedStyle(n).translate)).toBe("none");
  await item.getByRole("link").first().tap(); await expect(page).toHaveURL(new RegExp(`/products/${main.slug}`));
  expect(await page.evaluate(() => sessionStorage.getItem("card-hover-mounted"))).toBeNull(); expect(errors).toEqual([]); await context.close();
});
test("failed add preserves choices and retries the real SKU", async ({ page }) => {
  await page.goto("/"); const item = await selectBlueMedium(page);
  let first = true;
  await page.route("**/storefront/cart/items", async route => { if (first) { first = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "V2 retry test" }) }); } else await route.continue(); });
  await item.getByRole("button", { name: "Add to Cart", exact: true }).click(); await expect(item.getByRole("alert")).toContainText("V2 retry test");
  await expect(item.getByRole("button", { name: "Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertAdd(page, item, pairFor(main, "E2E-CS-BLUE-M").variant.sku!.id);
});
test("same-task double click emits only one real cart request", async ({ page }) => {
  await page.goto("/"); await assertAdd(page, await selectBlueMedium(page), pairFor(main, "E2E-CS-BLUE-M").variant.sku!.id, true);
});
test("compact admin preview renders solid square swatches without saving the product", async ({ page }) => {
  const before = await adminProduct(main.id);
  const saves: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/admin/products/${main.id}`)) saves.push(request.url()); });
  await loginPage(page); await page.goto(`/admin/products/${main.id}/edit`);
  await page.getByRole("tab", { name: "选项、价格与库存", exact: true }).click();
  await page.getByLabel("选项 1 展示样式", { exact: true }).selectOption("SWATCH");
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  await page.getByRole("button", { name: "Red / Small 预览此款", exact: true }).click();
  const preview = page.locator('article[data-product-id="product-card-preview"]');
  const red = preview.getByRole("button", { name: "Red", exact: true });
  const box = await red.boundingBox(); expect(box!.width).toBe(28); expect(box!.height).toBe(28);
  expect(await red.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(192, 57, 43)");
  await expect(red.locator("span")).toHaveCount(0);
  await expect(red).toBeDisabled();
  await expect(preview.getByRole("button", { name: "More options", exact: true })).toBeDisabled();
  expect(saves).toEqual([]);
  expect((await adminProduct(main.id)).options).toEqual(before.options);
  await preview.screenshot({ path: join(target.root, "compact-admin-swatch.png") });
});

test("sparse options keep missing combinations unavailable and out-of-stock SKUs selectable", async ({ page }) => {
  await page.goto("/"); const item = card(page, sparse);
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await item.getByRole("button", { name: "More options", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Product options" });
  await expect(dialog.getByRole("button", { name: "Large", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Small", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Small", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(item.getByText("Out of Stock", { exact: true })).toBeVisible();
  await expect(item.getByRole("button", { name: "Save for Later", exact: true })).toBeEnabled();
  await expect(item.getByTestId("price")).toContainText("₱702.00");
});
test("an old variant hover completing after a switch never overlays the new pair", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${main.cardMedia!.unselected.scene!.url}`, async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await page.goto("/"); const item = card(page);
  await item.getByRole("link").first().hover(); await expect(item.locator("[data-card-scene]")).toHaveCount(1);
  await item.getByRole("button", { name: "Red", exact: true }).click(); await selectSecondary(page, item, "Small");
  release(); await item.getByRole("link").first().hover();
  const red = pairFor(main, "E2E-CS-RED-S");
  await expect(item.locator("img").first()).toHaveAttribute("src", red.pair.cover!.url);
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", red.pair.scene!.url);
  await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
});
test("admin configures two variants independently, saves, reloads and leaves the gallery untouched", async ({ page }) => {
  const before = await adminProduct(main.id);
  await loginPage(page); await page.goto(`/admin/products/${main.id}/edit`);
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  for (const [name, coverIndex, hoverIndex] of [["Red / Small", 1, 2], ["Blue / Medium", 2, 3]] as const) {
    for (const [slot, index] of [["卡片封面", coverIndex], ["悬停图片", hoverIndex]] as const) {
      await page.getByRole("button", { name: `${name} ${slot}：从图库选择`, exact: true }).click();
      await page.getByRole("dialog", { name: "选择商品卡图片", exact: true }).getByRole("button", { name: `选择图片 ${index}`, exact: true }).click();
      await page.getByRole("textbox", { name: `${name} ${slot}：替代文字`, exact: true }).fill(`${name} ${slot} independent`);
    }
  }
  const savedResponse = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/admin/products/${main.id}`));
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  expect((await savedResponse).ok()).toBe(true);
  const after = await adminProduct(main.id);
  expect(after.media).toEqual(before.media);
  for (const variant of after.variants) expect(variant.sku!.id).toBe(before.variants.find(v => v.id === variant.id)!.sku!.id);
  const red = after.variants.find(v => v.sku?.skuCode === "E2E-CS-RED-S")!;
  const blue = after.variants.find(v => v.sku?.skuCode === "E2E-CS-BLUE-M")!;
  expect(red.cardMedia!.cover!.url).not.toBe(blue.cardMedia!.cover!.url);
  await page.reload(); await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Red / Small 卡片封面：替代文字", exact: true })).toHaveValue("Red / Small 卡片封面 independent");
  await page.goto("/"); const item = card(page);
  for (const [color, size, variant] of [["Red", "Small", red], ["Blue", "Medium", blue]] as const) {
    await item.getByRole("button", { name: color, exact: true }).click(); await selectSecondary(page, item, size);
    await expect(item.locator("img").first()).toHaveAttribute("src", variant.cardMedia!.cover!.url);
    await item.getByRole("link").first().hover(); await expect(item.locator("[data-card-scene]")).toHaveAttribute("src", variant.cardMedia!.hover!.url);
    await expect(item.locator("[data-card-scene]")).toHaveAttribute("data-visible", "true");
  }
});
test("real 409 leaves the current card and inventory draft visible without saving it", async ({ page }) => {
  await loginPage(page); await page.goto(`/admin/products/${main.id}/edit`);
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  const alt = page.getByRole("textbox", { name: "Red / Small 卡片封面：替代文字", exact: true });
  await alt.fill("Unsaved conflict cover");
  await page.getByRole("tab", { name: "选项、价格与库存", exact: true }).click();
  await page.getByLabel("Red / Small 的库存", { exact: true }).fill("77");
  const before = await adminProduct(main.id);
  await checkedPatch(main.id, { catalogGraphVersion: before.catalogGraphVersion, catalogGraph: {} });
  const write = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/admin/products/${main.id}`));
  await page.getByRole("button", { name: "保存更改", exact: true }).click(); expect((await write).status()).toBe(409);
  await expect(page.getByLabel("Red / Small 的库存", { exact: true })).toHaveValue("77");
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click(); await expect(alt).toHaveValue("Unsaved conflict cover");
  const after = await adminProduct(main.id);
  expect(after.variants.map(v => v.cardMedia)).toEqual(before.variants.map(v => v.cardMedia));
  expect(after.variants.map(v => v.sku?.onHand)).toEqual(before.variants.map(v => v.sku?.onHand));
});
test("new typed ACTIVE phase failure retries the same DRAFT product without a second POST", async ({ page }) => {
  await loginPage(page); await page.goto("/admin/products/new");
  const name = `CardV2 recovery ${Date.now()}`; const slug = name.toLowerCase().replaceAll(" ", "-");
  await page.getByRole("tab", { name: "选项、价格与库存", exact: true }).click();
  await page.getByLabel("Default 的 SKU 编码", { exact: true }).fill(slug);
  await page.getByLabel("Default 的售价", { exact: true }).fill("125");
  await page.getByLabel("Default 的库存", { exact: true }).fill("4");
  await page.getByRole("tab", { name: "基本信息", exact: true }).click();
  await page.getByLabel(/商品名 \*/).fill(name); await page.getByLabel(/分类 \*/).selectOption(main.categoryId);
  await page.getByRole("tab", { name: "搜索与链接", exact: true }).click(); await page.getByLabel(/Slug \*/).fill(slug);
  await page.getByRole("combobox", { name: "商品状态", exact: true }).selectOption("ACTIVE");
  const posts: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/admin/products")) posts.push(r.postData()!); });
  const first = page.waitForResponse(r => r.request().method() === "PATCH" && /\/admin\/products\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  const failed = await first; expect(failed.status()).toBe(400);
  expect(await failed.json()).toMatchObject({ code: "PRODUCT_CARD_MEDIA_INCOMPLETE" });
  expect(posts).toHaveLength(1); expect(JSON.parse(posts[0]!)).toMatchObject({ status: "DRAFT", variants: [], images: [] });
  const createdId = new URL(failed.url()).pathname.split("/").at(-1)!;
  expect((await adminProduct(createdId)).status).toBe("DRAFT");
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  const url = page.getByLabel("要添加的媒体 URL", { exact: true }).first();
  await url.fill(main.cardMedia!.unselected.cover!.url);
  await url.locator("xpath=ancestor::section[1]").getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "Default 卡片封面：从图库选择", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "选择图片 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Default 卡片封面：替代文字", exact: true }).fill("Recovered cover");
  const retry = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/admin/products/${createdId}`));
  await page.getByRole("button", { name: "保存并发布", exact: true }).click(); expect((await retry).ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/admin/products/${createdId}/edit$`));
  expect(posts).toHaveLength(1);
  const after = await adminProduct(createdId); expect(after.status).toBe("ACTIVE");
  expect(after.variants[0]!.cardMedia!.cover!.altText).toBe("Recovered cover"); expect(after.variants[0]!.sku!.onHand).toBe(4);
});
test("a completed upload arriving after navigation cannot alter the next product", async ({ page }) => {
  const before = await adminProduct(same.id);
  await loginPage(page); await page.goto(`/admin/products/${main.id}/edit`); await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let uploaded!: () => void; const stored = new Promise<void>(resolve => { uploaded = resolve; });
  await page.route("**/api/v1/admin/uploads", async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); uploaded(); await gate; await route.fulfill({ response }); });
  await page.getByLabel("Red / Small 卡片封面：上传图片", { exact: true }).setInputFiles({ name: "late.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=", "base64") });
  await stored;
  await expect(page.getByRole("button", { name: "Red / Small 设为默认款式", exact: true })).toBeDisabled();
  const next = page.goto(`/admin/products/${same.id}/edit`); release(); await next;
  await page.getByRole("tab", { name: "商品媒体", exact: true }).click();
  expect((await adminProduct(same.id)).variants.map(v => v.cardMedia)).toEqual(before.variants.map(v => v.cardMedia));
  const item = page.locator("article"); await expect(item.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
});
