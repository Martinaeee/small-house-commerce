import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

const API = "http://127.0.0.1:3210/api/v1";
const PDP_SLUG = "e2e-color-size";
const LP_SLUG = "e2e-lp-color-size";
const RELATED_OOS_SLUG = "e2e-related-oos";
const TAGLINE = "Compact storage, built for flexible homes.";
const DETAIL_ALT_PREFIX = "PDP detail";
const SCREENSHOT_DIR = path.resolve(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function screenshotPath(name: string): string {
  return path.join(SCREENSHOT_DIR, name);
}

const RECENT_SLUGS = [
  "e2e-exact-override",
  "e2e-size-only",
  PDP_SLUG,
  "e2e-color-only",
  "e2e-legacy-style",
  RELATED_OOS_SLUG,
] as const;

interface ProductFixture {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  materials: string | null;
  features: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  foldedWidth: number | null;
  foldedHeight: number | null;
  foldedDepth: number | null;
  detailBlocks: {
    id: string;
    type: "IMAGE" | "VIDEO";
    url: string;
    altText: string | null;
    sortOrder: number;
  }[];
  variants: {
    id: string;
    name: string;
    sku: {
      id: string;
      skuCode: string;
      productWeight: number | null;
      packageWidth: number | null;
      packageHeight: number | null;
      packageDepth: number | null;
      packageWeight: number | null;
      availableInventory: number;
    } | null;
  }[];
}

async function fetchProduct(slug: string): Promise<ProductFixture> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(`${API}/storefront/products/${slug}`);
    expect(response.ok(), `GET storefront product ${slug}`).toBeTruthy();
    const body = (await response.json()) as
      | ProductFixture
      | { product: ProductFixture };
    return "product" in body ? body.product : body;
  } finally {
    await context.dispose();
  }
}

function monitorPage(page: Page): () => Promise<void> {
  const browserErrors: string[] = [];
  const failedMedia: string[] = [];

  const isProductMedia = (url: string): boolean =>
    url.includes("/uploads/") ||
    /\/storefront\/products\/[^/]+\/media(?:\?|$)/.test(url);

  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (isProductMedia(request.url())) {
      failedMedia.push(
        `${request.url()} — ${request.failure()?.errorText ?? "request failed"}`,
      );
    }
  });
  page.on("response", (response) => {
    if (isProductMedia(response.url()) && response.status() >= 400) {
      failedMedia.push(`${response.status()} ${response.url()}`);
    }
  });

  return async () => {
    expect(
      browserErrors,
      `expected zero console/page/hydration errors:\n${browserErrors.join("\n")}`,
    ).toEqual([]);
    expect(
      failedMedia,
      `expected zero failed product-media requests:\n${failedMedia.join("\n")}`,
    ).toEqual([]);
  };
}

async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
}

async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  const value = page
    .getByRole("group", { name: optionName, exact: true })
    .getByRole("button", { name: valueLabel, exact: true });
  await expect(async () => {
    await value.click();
    await expect(value).toHaveAttribute("aria-pressed", "true");
  }).toPass({ timeout: 15_000 });
}

async function expectDocumentOrder(locators: readonly Locator[]): Promise<void> {
  for (let index = 0; index < locators.length - 1; index += 1) {
    const current = locators[index];
    const next = locators[index + 1];
    const nextHandle = await next.elementHandle();
    expect(nextHandle, `document-order item ${index + 1} exists`).not.toBeNull();
    const precedes = await current.evaluate(
      (node, following) =>
        Boolean(
          node.compareDocumentPosition(following as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      nextHandle,
    );
    expect(precedes, `document-order item ${index} precedes ${index + 1}`).toBe(
      true,
    );
  }
}

async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(
    metrics.document,
    `${label}: documentElement must not overflow the viewport`,
  ).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.body, `${label}: body must not overflow the viewport`).toBeLessThanOrEqual(
    metrics.viewport,
  );
}

async function assertNoBrokenImages(page: Page): Promise<void> {
  const images = page.getByRole("main").locator("img");
  await expect(async () => {
    const count = await images.count();
    for (let index = 0; index < count; index += 1) {
      await images.nth(index).scrollIntoViewIfNeeded();
    }
  }).toPass({ timeout: 15_000 });
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes
          .map((node) => node as HTMLImageElement)
          .filter((image) => !image.complete || image.naturalWidth === 0)
          .map((image) => image.currentSrc || image.src),
      ),
    )
    .toEqual([]);
}

function sectionByHeading(page: Page, heading: string): Locator {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=ancestor::section[1]");
}

test.describe("PDP UX Phase 1", () => {
  test("renders the conversion hero, five truthful anchors, and conserved structured details", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const assertHealthy = monitorPage(page);
    const product = await fetchProduct(PDP_SLUG);

    expect(product.tagline).toBe(TAGLINE);
    expect(product.description).toContain("space-smart cabinet");
    expect(product.features?.split("\n").filter(Boolean)).toHaveLength(3);
    expect(product.materials).toBe("Powder-coated steel and engineered wood");
    expect(product.width).toBe(88);
    expect(product.variants[0]?.sku?.productWeight).toBe(23);

    await goto(page, `/products/${PDP_SLUG}`);

    const hero = page.getByTestId("pdp-purchase");
    const orderNow = hero.getByTestId("order-now");
    const addToCart = hero.getByTestId("add-to-cart");
    await expectDocumentOrder([
      hero.getByRole("heading", { level: 1, name: product.name }),
      hero.getByText(TAGLINE),
      hero.getByText("No reviews yet"),
      hero.getByTestId("price").first(),
      hero.getByRole("group", { name: "Color", exact: true }),
      hero.locator("#pdp-dimensions-summary"),
      hero.getByText("Estimated delivery"),
      hero.getByTestId("qty"),
      orderNow,
      addToCart,
    ]);
    await expect(orderNow).toHaveText("CHOOSE OPTIONS");
    await expect(addToCart).toHaveText("CHOOSE OPTIONS");
    await page.screenshot({
      path: screenshotPath("phase-pdp-ux-hero-1440.png"),
    });

    const navigation = page.getByRole("navigation", {
      name: "Product sections",
    });
    await expect(navigation.getByRole("link")).toHaveText([
      "Details",
      "Specifications",
      "Delivery & FAQs",
      "Reviews",
      "Order Now",
    ]);
    await expect(
      navigation.getByRole("link", { name: "Order Now" }),
    ).toHaveAttribute("href", "#pdp-purchase");

    await navigation.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(/#details$/);
    await expect(page.locator("#details")).toBeInViewport();

    const validBlocks = product.detailBlocks.filter(
      (block) => block.url.trim() !== "",
    );
    expect(validBlocks.map((block) => block.altText)).toEqual([
      "PDP detail first",
      "PDP detail second",
      "PDP detail third",
      "PDP detail fourth",
    ]);
    const renderedDetailMedia = page.locator(
      `img[alt^="${DETAIL_ALT_PREFIX}"], video[aria-label^="${DETAIL_ALT_PREFIX}"]`,
    );
    await expect(renderedDetailMedia).toHaveCount(validBlocks.length);
    expect(
      await renderedDetailMedia.evaluateAll((nodes) =>
        nodes.map((node) => {
          if (node instanceof HTMLVideoElement) {
            return new URL(node.querySelector("source")?.src ?? "").pathname;
          }
          return new URL((node as HTMLImageElement).src).pathname;
        }),
      ),
    ).toEqual(validBlocks.map((block) => block.url));
    for (const block of validBlocks) {
      await expect(page.getByText(block.altText ?? "", { exact: true })).toHaveCount(
        block.type === "VIDEO" ? 1 : 0,
      );
      await expect(page.locator(`img[alt="${block.altText}"]`)).toHaveCount(
        block.type === "IMAGE" ? 1 : 0,
      );
    }

    await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Why You’ll Love It" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Product Specifications" }),
    ).toBeVisible();
    await expect(page.getByText("Powder-coated steel and engineered wood").first()).toBeVisible();
    await expect(page.getByText("23 kg")).toBeVisible();
    await expect(
      page
        .locator("#specifications")
        .getByText(
          /Package width|Package height|Package depth|Package weight|Volumetric|Load Capacity/i,
        ),
    ).toHaveCount(0);
    await page
      .locator("#details")
      .locator("xpath=..")
      .screenshot({
        path: screenshotPath("phase-pdp-ux-details-1440.png"),
      });

    await assertNoPageOverflow(page, "PDP desktop");
    await assertNoBrokenImages(page);
    await assertHealthy();
  });

  test("shows four buyable related products and four recent products in visit order", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const assertHealthy = monitorPage(page);
    const products = await Promise.all(RECENT_SLUGS.map(fetchProduct));
    const bySlug = new Map(products.map((product) => [product.slug, product]));
    const current = bySlug.get(PDP_SLUG)!;

    await page.addInitScript(
      ({ ids }) => window.localStorage.setItem("sh:rv", JSON.stringify(ids)),
      { ids: RECENT_SLUGS.map((slug) => bySlug.get(slug)!.id) },
    );

    try {
      await goto(page, `/products/${PDP_SLUG}`);

      const related = sectionByHeading(page, "You May Also Like");
      await expect(related.locator("article")).toHaveCount(4);
      const relatedHrefs = await related.locator("h3 a").evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      );
      expect(relatedHrefs).not.toContain(`/products/${PDP_SLUG}`);
      expect(relatedHrefs).not.toContain(`/products/${RELATED_OOS_SLUG}`);

      const recent = sectionByHeading(page, "Recently Viewed");
      await expect(recent.locator("article")).toHaveCount(4);
      const recentHrefs = await recent.locator("h3 a").evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      );
      expect(recentHrefs).toEqual(
        RECENT_SLUGS.filter((slug) => slug !== PDP_SLUG)
          .slice(0, 4)
          .map((slug) => `/products/${slug}`),
      );
      expect(recentHrefs).not.toContain(`/products/${current.slug}`);

      await assertNoBrokenImages(page);

      await goto(page, `/lp/${LP_SLUG}`);
      const landingRelated = sectionByHeading(page, "You May Also Like");
      await expect(landingRelated.locator("article")).toHaveCount(4);
      const landingRelatedHrefs = await landingRelated
        .locator("h3 a")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(landingRelatedHrefs).not.toContain(`/products/${PDP_SLUG}`);
      expect(landingRelatedHrefs).not.toContain(
        `/products/${RELATED_OOS_SLUG}`,
      );

      const landingRecent = sectionByHeading(page, "Recently Viewed");
      await expect(landingRecent.locator("article")).toHaveCount(4);
      const landingRecentHrefs = await landingRecent
        .locator("h3 a")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(landingRecentHrefs).toEqual(recentHrefs);
      expect(landingRecentHrefs).not.toContain(`/products/${current.slug}`);

      await assertNoBrokenImages(page);
      await assertHealthy();
    } finally {
      await page
        .evaluate(() => window.localStorage.removeItem("sh:rv"))
        .catch(() => undefined);
      await page.context().clearCookies();
    }
  });

  test("shows one shared-state sticky bar and sends one cart mutation for one click", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const assertHealthy = monitorPage(page);
    const cartMutations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/storefront/cart/items"
      ) {
        cartMutations.push(request.url());
      }
    });

    try {
      await goto(page, `/products/${PDP_SLUG}`);
      await selectValue(page, "Color", "Red");
      await selectValue(page, "Size", "Medium");
      await expect(page.getByTestId("order-now")).toHaveText("ORDER NOW");

      await page.locator("#details").evaluate((node) =>
        node.scrollIntoView({ block: "start" }),
      );
      const sticky = page.getByTestId("sticky-buy");
      await expect(sticky).toBeVisible();
      await expect(sticky).toHaveCount(1);
      await expect(sticky).toContainText("Red / Medium");
      await expect(sticky).toContainText("₱1,299.00");
      await page.screenshot({
        path: screenshotPath("phase-pdp-ux-sticky-buy-1440.png"),
      });

      await sticky.getByRole("button", { name: "Increase sticky quantity" }).click();
      await expect(page.getByTestId("sticky-qty")).toHaveText("2");
      await expect(page.getByTestId("qty")).toHaveText("2");

      const stickyAdd = sticky.getByTestId("sticky-add-to-cart");
      await stickyAdd.evaluate((node) => {
        node.addEventListener("click", () => {
          node.dataset.e2eClicks = String(
            Number(node.dataset.e2eClicks ?? "0") + 1,
          );
        });
      });
      await stickyAdd.click();
      await expect(page.getByText("Added to cart")).toBeVisible();
      await expect.poll(() => cartMutations.length).toBe(1);
      await expect(stickyAdd).toHaveAttribute("data-e2e-clicks", "1");

      await assertNoPageOverflow(page, "PDP sticky desktop");
      await assertHealthy();
    } finally {
      await page.context().clearCookies();
    }
  });

  test("keeps PDP and landing-page chrome inside 375, 768, 1440, and 1920 viewports", async ({
    page,
  }) => {
    const assertHealthy = monitorPage(page);
    const cases = [
      { width: 375, height: 812, path: `/products/${PDP_SLUG}` },
      { width: 768, height: 1024, path: `/products/${PDP_SLUG}` },
      { width: 1440, height: 900, path: `/products/${PDP_SLUG}` },
      { width: 1920, height: 1080, path: `/lp/${LP_SLUG}` },
    ] as const;

    for (const entry of cases) {
      await page.setViewportSize({ width: entry.width, height: entry.height });
      await goto(page, entry.path);
      await assertNoPageOverflow(page, `${entry.width}x${entry.height} top`);
      if (entry.width === 375) {
        const heroActions = page.locator(
          '[data-testid="order-now"], [data-testid="add-to-cart"]',
        );
        await expect(heroActions).toHaveCount(2);
        for (let index = 0; index < 2; index += 1) {
          const box = await heroActions.nth(index).boundingBox();
          expect(box, `mobile hero action ${index + 1} has a box`).not.toBeNull();
          expect(
            box!.height,
            `mobile hero action ${index + 1} keeps a touch-safe height`,
          ).toBeGreaterThanOrEqual(48);
        }
      }
      if (entry.path.startsWith("/lp/")) {
        await page.screenshot({
          path: screenshotPath("phase-pdp-ux-landing-1920.png"),
        });
      }

      await page.locator("#details").evaluate((node) =>
        node.scrollIntoView({ block: "start" }),
      );
      const sticky = page.getByTestId("sticky-buy");
      await expect(sticky).toBeVisible();
      const box = await sticky.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(entry.width);
      const stickyActions = sticky.locator(
        '[data-testid="sticky-order-now"], [data-testid="sticky-add-to-cart"]',
      );
      await expect(stickyActions).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) {
        const actionBox = await stickyActions.nth(index).boundingBox();
        expect(actionBox, `sticky action ${index + 1} has a box`).not.toBeNull();
        expect(actionBox!.height).toBeGreaterThanOrEqual(44);
        expect(actionBox!.x).toBeGreaterThanOrEqual(0);
        expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
          entry.width,
        );
      }
      if (entry.width === 375) {
        const bodyPadding = await page.evaluate(() =>
          Number.parseFloat(window.getComputedStyle(document.body).paddingBottom),
        );
        expect(bodyPadding).toBeGreaterThanOrEqual(box!.height);
        await page.screenshot({
          path: screenshotPath("phase-pdp-ux-mobile-375.png"),
        });
      }
      await assertNoPageOverflow(page, `${entry.width}x${entry.height} sticky`);
    }

    await assertHealthy();
  });
});
