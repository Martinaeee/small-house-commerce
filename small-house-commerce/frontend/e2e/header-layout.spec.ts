import { expect, test, type Page } from "@playwright/test";

// The header's overlays are client portals, so their containers only exist
// once React has hydrated. Interaction tests must wait for one before
// hovering/clicking, otherwise a fast assertion can run against the
// server-rendered markup before any handler is attached.
async function waitForInteractiveHeader(page: Page) {
  await expect(
    page.locator('body > [aria-hidden] [role="dialog"][aria-label="Menu"]'),
  ).toBeAttached();
}

for (const width of [1280, 1440, 1920]) {
  test(`desktop header uses the screen width without crowding its navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/**", (route) =>
      route.request().method() === "GET"
        ? route.continue()
        : route.fulfill({ status: 204 }),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const layout = await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const brand = header.querySelector('a[aria-label$=" home"]')!;
      const nav = header.querySelector('nav[aria-label="Main navigation"]')!;
      const search = header.querySelector('input[aria-label="Search products"]')!;
      const rect = (node: Element) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
      };
      const items = [...nav.children].map((node) => {
        const label = node.matches("a") ? node : node.querySelector("a")!;
        return { ...rect(node), fontSize: parseFloat(getComputedStyle(label).fontSize) };
      });
      return {
        viewport: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        header: rect(header),
        row: rect(header.firstElementChild!),
        brand: rect(brand),
        search: rect(search),
        items,
      };
    });

    expect(layout.row.width).toBeCloseTo(layout.viewport, 0);
    expect(layout.brand.left).toBeGreaterThanOrEqual(32);
    expect(layout.brand.left).toBeLessThanOrEqual(40);
    expect(layout.brand.height).toBe(52);
    expect(layout.header.height).toBe(89);
    expect(layout.items.length).toBeGreaterThan(1);
    expect(layout.overflow).toBe(0);
    for (let index = 0; index < layout.items.length; index += 1) {
      expect(layout.items[index].fontSize).toBe(15);
      if (index > 0) {
        const gap = layout.items[index].left - layout.items[index - 1].right;
        expect(gap).toBeGreaterThanOrEqual(24);
        expect(gap).toBeLessThanOrEqual(32.1);
      }
    }
    const first = layout.items[0];
    const last = layout.items[layout.items.length - 1];
    const categoryCenter = (first.left + last.right) / 2;
    const middleRegionCenter = (layout.brand.right + layout.search.left) / 2;
    expect(Math.abs(categoryCenter - middleRegionCenter)).toBeLessThan(2);
    expect(first.left - layout.brand.right).toBeGreaterThanOrEqual(24);
    expect(layout.search.left - last.right).toBeGreaterThanOrEqual(24);
  });
}

test("desktop category menus and search still work after spacing changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/v1/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 204 }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForInteractiveHeader(page);
  const header = page.locator("header");
  const category = header.locator("[data-nav-root]").first().getByRole("link");
  const label = await category.innerText();
  await category.hover();
  const panel = page.getByRole("region", { name: label, exact: true });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const headerBox = await header.boundingBox();
  expect(panelBox!.y).toBeCloseTo(headerBox!.y + headerBox!.height, 0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await category.focus();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  const destination = await category.getAttribute("href");
  await category.click();
  // The URL commits only when the RSC payload arrives. Against the local
  // read-only API proxy a category page can take 15s+ to render, so this
  // waits on real server work rather than the default 5s expect timeout.
  await expect(page).toHaveURL(new RegExp(destination!), { timeout: 45000 });

  const search = header.getByRole("combobox", { name: "Search products" });
  await search.fill("rack");
  const suggestions = page.getByRole("listbox");
  await expect(suggestions).toBeVisible();
  const suggestionsBox = await suggestions.boundingBox();
  expect(suggestionsBox!.x).toBeGreaterThanOrEqual(0);
  expect(suggestionsBox!.x + suggestionsBox!.width).toBeLessThanOrEqual(1440);
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=rack$/, { timeout: 45000 });
});

test("mobile menu and search keep their focus and close behavior", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.route("**/api/v1/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 204 }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForInteractiveHeader(page);
  const header = page.locator("header");
  const menu = header.getByRole("button", { name: "Open menu" });
  await menu.click();
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeHidden();
  await expect(menu).toBeFocused();

  const search = header.getByRole("button", { name: "Search", exact: true });
  await search.click();
  const input = page.locator("[data-mobile-search]").getByRole("combobox");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(search).toBeFocused();
});

for (const width of [375, 390, 430]) {
  test(`mobile header retains its centered logo and separate controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/v1/**", (route) =>
      route.request().method() === "GET"
        ? route.continue()
        : route.fulfill({ status: 204 }),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const header = page.locator("header");
    await expect(header.getByRole("button", { name: "Open menu" })).toBeVisible();
    await expect(header.getByRole("navigation", { name: "Main navigation", exact: true })).toBeHidden();
    const layout = await header.evaluate((node) => {
      const brand = node.querySelector('a[aria-label$=" home"]')!.getBoundingClientRect();
      const menu = node.querySelector('button[aria-label="Open menu"]')!.getBoundingClientRect();
      const search = node.querySelector('button[aria-label="Search"]')!.getBoundingClientRect();
      return {
        center: brand.left + brand.width / 2,
        viewportCenter: document.documentElement.clientWidth / 2,
        height: brand.height,
        menuGap: brand.left - menu.right,
        searchGap: search.left - brand.right,
        headerHeight: node.getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.center).toBeCloseTo(layout.viewportCenter, 0);
    expect(layout.height).toBe(40);
    expect(layout.headerHeight).toBe(65);
    expect(layout.menuGap).toBeGreaterThan(0);
    expect(layout.searchGap).toBeGreaterThanOrEqual(0);
    expect(layout.overflow).toBe(0);
  });
}
