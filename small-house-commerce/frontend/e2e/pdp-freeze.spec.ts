import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 5 — PDP V1 freeze audit.
 *
 * READ-ONLY: this spec never places an order, never writes admin data and
 * never mutates the seeded catalogue. It re-checks the whole frozen PDP
 * contract in one real-stack session and captures the final evidence set.
 * Functional depth lives in the dedicated gates (pdp-ux-phase-1,
 * pdp-quick-cod, pdp-video, variant-options-media); this file proves every
 * checklist item still renders together on the shipped PDP and LP.
 */

const API = "http://127.0.0.1:3210/api/v1";
const PDP_SLUG = "e2e-color-size";
const LP_SLUG = "e2e-lp-color-size";
const SCREENSHOTS = resolve(process.cwd(), "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

const RECENT_SLUGS = [
  "e2e-exact-override",
  "e2e-size-only",
  PDP_SLUG,
  "e2e-color-only",
  "e2e-legacy-style",
  "e2e-related-oos",
] as const;

interface MediaJson {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
}

interface ProductJson {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  images: MediaJson[];
  initialMediaSet?: { media: MediaJson[] };
  detailBlocks: MediaJson[];
  variants: { id: string; name: string }[];
}

let product: ProductJson;
let galleryVideoIndex = -1;
let galleryVideo: MediaJson;
let redSmall: { id: string; name: string };
const recentIds = new Map<string, string>();

async function fetchProduct(slug: string): Promise<ProductJson> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(`${API}/storefront/products/${slug}`);
    expect(response.ok(), `GET storefront product ${slug}`).toBeTruthy();
    const body = (await response.json()) as
      | ProductJson
      | { product: ProductJson };
    return "product" in body ? body.product : body;
  } finally {
    await context.dispose();
  }
}

function screenshotPath(name: string): string {
  return resolve(SCREENSHOTS, name);
}

function trackBrowserErrors(page: Page): () => void {
  const errors: string[] = [];
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning" && /hydrat/i.test(message.text())) {
      hydration.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return () => {
    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
    expect(hydration, `hydration warnings:\n${hydration.join("\n")}`).toEqual(
      [],
    );
  };
}

async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(metrics.document, `${label}: document must not overflow`).toBeLessThanOrEqual(
    metrics.viewport + 1,
  );
  expect(metrics.body, `${label}: body must not overflow`).toBeLessThanOrEqual(
    metrics.viewport + 1,
  );
}

async function goto(page: Page, path: string): Promise<Locator> {
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto(`http://localhost:3211${path}`);
  const main = page.getByRole("main");
  await expect(main.getByTestId("pdp-purchase")).toBeVisible();
  // Next dev streams the page and then swaps in the hydrated tree, which can
  // briefly leave two copies of a subtree in the DOM. Wait for the settled
  // single hero before any strict page-scoped assertion runs.
  await expect(page.getByTestId("pdp-purchase")).toHaveCount(1);
  return main;
}

async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  // The PDP renders the shared selector twice (hero + the inline COD card),
  // so option lookups are scoped to the hero.
  const value = page
    .locator("#pdp-purchase")
    .getByRole("group", { name: optionName, exact: true })
    .getByRole("button", { name: valueLabel, exact: true });
  await expect(async () => {
    await value.click();
    await expect(value).toHaveAttribute("aria-pressed", "true");
  }).toPass({ timeout: 15_000 });
}

function sectionByHeading(page: Page, heading: string): Locator {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=ancestor::section[1]");
}

test.beforeAll(async () => {
  product = await fetchProduct(PDP_SLUG);
  const gallery = product.initialMediaSet?.media ?? product.images;
  galleryVideoIndex = gallery.findIndex((media) => media.type === "VIDEO");
  galleryVideo = gallery[galleryVideoIndex]!;
  expect(galleryVideoIndex, "seeded shared gallery video exists").toBeGreaterThanOrEqual(0);
  const redSmallVariant = product.variants.find(
    (variant) => variant.name === "Red / Small",
  );
  expect(redSmallVariant, "seeded Red / Small variant exists").toBeTruthy();
  redSmall = redSmallVariant!;
  for (const slug of RECENT_SLUGS) {
    const fixture = slug === PDP_SLUG ? product : await fetchProduct(slug);
    recentIds.set(slug, fixture.id);
  }
});

test.describe("PDP V1 freeze", () => {
  test("desktop checklist and the 1440 evidence set", async ({ page }) => {
    test.setTimeout(180_000);
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      ({ ids }) => window.localStorage.setItem("sh:rv", JSON.stringify(ids)),
      { ids: RECENT_SLUGS.map((slug) => recentIds.get(slug)!) },
    );

    await goto(page, `/products/${PDP_SLUG}`);
    const hero = page.getByRole("main").getByTestId("pdp-purchase");

    // --- Hero ---------------------------------------------------------------
    await expect(
      hero.getByRole("heading", { name: product.name, exact: true }),
    ).toBeVisible();
    await expect(hero.getByText(product.tagline!, { exact: true })).toBeVisible();
    await expect(
      hero.getByRole("list", { name: "Selling points" }).getByRole("listitem"),
    ).toHaveText(["Foldable", "Easy to Move"]);
    await expect(hero.getByTestId("pdp-dimensions-line")).toContainText(
      "Dimensions:",
    );
    const delivery = hero.getByTestId("pdp-delivery");
    await expect(delivery.getByText("Estimated delivery")).toBeVisible();
    await expect(
      delivery.getByRole("list", { name: "Service assurances" }).getByRole("listitem"),
    ).toHaveText([
      "✓COD & Free Shipping",
      "✓Arrived in 1-5 days",
      "✓7-Day Free Return & Exchange",
    ]);
    await expect(page.locator('section[aria-label="Why shop with us"]')).toBeVisible();

    // --- Variant + Price + CTA ---------------------------------------------
    // Nothing is chosen yet: the COD summary points at the inline selector
    // instead of presenting the default display variant as the ordered one.
    await expect(
      page
        .getByRole("main")
        .locator("#quick-cod-order")
        .getByTestId("quick-cod-variant")
        .getByRole("link", { name: "Choose options" }),
    ).toHaveAttribute("href", "#quick-cod-options");

    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Small");
    await expect(hero.getByTestId("order-now")).toHaveText("ORDER NOW");
    await expect(hero.getByText("₱1,299.00").first()).toBeVisible();
    await expect(hero.getByTestId("add-to-cart")).toBeVisible();

    // --- Gallery + Video ----------------------------------------------------
    const galleryButton = page.getByRole("main").getByRole("button", {
      name: "Open image gallery",
    });
    await expect(galleryButton).toBeVisible();
    const mediaCount = (product.initialMediaSet?.media ?? product.images).length;
    await expect(
      page.getByRole("main").getByRole("button", { name: /^View media \d+$/ }),
    ).toHaveCount(Math.min(5, mediaCount));
    await page.getByRole("main")
      .getByRole("button", { name: `View media ${galleryVideoIndex + 1}` })
      .click();
    const teaser = page.getByRole("main").locator('video[data-video-mode="TEASER"]');
    await expect(teaser).toHaveAttribute("src", galleryVideo.url);
    await expect.poll(() => teaser.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
    await galleryButton.screenshot({ path: screenshotPath("phase5-video.png") });

    // --- Frozen hero screenshot --------------------------------------------
    await selectValue(page, "Color", "Red");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath("phase5-pdp-hero-1440.png") });

    // --- Sticky navigation --------------------------------------------------
    const navigation = page.getByRole("navigation", { name: "Product sections" });
    await expect(navigation.getByRole("link")).toHaveText([
      "Details",
      "Specifications",
      "Delivery & FAQs",
      "Reviews",
      "Order Now",
    ]);
    await navigation.getByRole("link", { name: "Details" }).click();
    await expect(page.locator("#details")).toBeInViewport();
    await navigation.getByRole("link", { name: "Specifications" }).click();
    await expect(page.locator("#specifications")).toBeInViewport();

    // --- Details + Description + Benefits + Detail media --------------------
    await page.locator("#details").scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Why You’ll Love It" }),
    ).toBeVisible();
    const validBlocks = product.detailBlocks.filter(
      (block) => block.url.trim() !== "",
    );
    const renderedDetailMedia = page.locator(
      'img[alt^="PDP detail"], video[aria-label^="PDP detail"]',
    );
    await expect(renderedDetailMedia).toHaveCount(validBlocks.length);
    expect(
      await renderedDetailMedia.evaluateAll((nodes) =>
        nodes.map((node) => {
          if (node instanceof HTMLVideoElement) {
            return node.dataset.videoSource ?? new URL(node.currentSrc || node.src).pathname;
          }
          return new URL((node as HTMLImageElement).src).pathname;
        }),
      ),
    ).toEqual(validBlocks.map((block) => block.url));
    await page.screenshot({ path: screenshotPath("phase5-pdp-details-1440.png") });

    // --- Specifications + Material & Dimensions + FAQ -----------------------
    await expect(page.locator("#specifications")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Product Specifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Material & Dimensions" }),
    ).toBeVisible();
    await expect(page.getByText("23 kg")).toBeVisible();
    const faq = page.locator("#shipping-faq");
    await expect(faq).toBeVisible();
    await expect(
      faq.getByRole("heading", { name: "Delivery, Returns & FAQs" }),
    ).toBeVisible();
    await expect(
      faq.getByText("Delivery & Cash on Delivery", { exact: true }),
    ).toBeVisible();

    // --- Inline COD ---------------------------------------------------------
    const cod = page.getByRole("main").locator("#quick-cod-order");
    await cod.scrollIntoViewIfNeeded();
    await expect(
      cod.getByRole("heading", { name: "Order Now — Cash on Delivery" }),
    ).toBeVisible();
    await expect(cod.getByTestId("quick-cod-variant")).toHaveText("Red / Small");
    await cod.screenshot({ path: screenshotPath("phase5-inline-cod.png") });

    // --- Sticky Buy ---------------------------------------------------------
    await page.locator("#details").evaluate((node) =>
      node.scrollIntoView({ block: "start" }),
    );
    const sticky = page.getByTestId("sticky-buy");
    await expect(sticky).toBeVisible();
    await expect(sticky).toContainText("Red / Small");
    await expect(sticky).toContainText("₱1,299.00");
    await page.screenshot({ path: screenshotPath("phase5-sticky-buy.png") });

    // --- Reviews / Related / Recently Viewed --------------------------------
    const reviews = page.locator("#reviews");
    await reviews.scrollIntoViewIfNeeded();
    await expect(
      reviews.getByRole("heading", { name: "Customer Reviews" }),
    ).toBeVisible();
    await reviews.screenshot({ path: screenshotPath("phase5-reviews.png") });

    const related = sectionByHeading(page, "You May Also Like");
    await related.scrollIntoViewIfNeeded();
    await expect(related.locator("article")).toHaveCount(4);
    await related.screenshot({ path: screenshotPath("phase5-related.png") });

    const recent = sectionByHeading(page, "Recently Viewed");
    await recent.scrollIntoViewIfNeeded();
    await expect(recent.locator("article")).toHaveCount(4);
    await recent.screenshot({ path: screenshotPath("phase5-recently-viewed.png") });

    // --- SEO metadata + recently-viewed tracking ----------------------------
    await expect(page).toHaveTitle(new RegExp(product.name));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/products/${PDP_SLUG}$`),
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /.{20,}/,
    );
    const storedRecent = await page.evaluate(
      () => window.localStorage.getItem("sh:rv"),
    );
    expect(JSON.parse(storedRecent ?? "[]")[0]).toBe(product.id);

    await assertNoPageOverflow(page, "PDP freeze desktop");
    stopErrors();
  });

  test("variant deep link and out-of-stock state stay truthful", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await goto(page, `/products/${PDP_SLUG}?variant=${redSmall.id}`);
    await expect(
      page
        .locator("#pdp-purchase")
        .getByRole("group", { name: "Color", exact: true })
        .getByRole("button", { name: "Red", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .locator("#pdp-purchase")
        .getByRole("group", { name: "Size", exact: true })
        .getByRole("button", { name: "Small", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // Next dev can briefly hold two hero trees while hydration replaces the
    // streamed markup; wait for the settled single button before asserting.
    await expect(page.getByTestId("order-now")).toHaveCount(1);
    await expect(page.getByTestId("order-now")).toHaveText("ORDER NOW");
    await goto(
      page,
      `/products/${PDP_SLUG}?aid=freeze-aid&utm_source=facebook&utm_campaign=freeze`,
    );
    await expect(page.getByRole("main").locator("#quick-cod-order")).toBeVisible();

    // Blue / Small is seeded out of stock: Order Now disappears, the restock
    // contact stays, and the sticky bar switches to its restock action.
    await selectValue(page, "Color", "Blue");
    await selectValue(page, "Size", "Small");
    await expect(page.getByTestId("oos-contact")).toBeVisible();
    await expect(page.getByTestId("order-now")).toHaveCount(0);
    await page.locator("#details").evaluate((node) =>
      node.scrollIntoView({ block: "start" }),
    );
    const sticky = page.getByTestId("sticky-buy");
    await expect(sticky).toBeVisible();
    await expect(sticky.getByTestId("sticky-contact-restock")).toBeVisible();
    await expect(sticky.getByTestId("sticky-order-now")).toHaveCount(0);

    await selectValue(page, "Color", "Red");
    await expect(page.getByTestId("order-now")).toHaveCount(1);
    await expect(page.getByTestId("order-now")).toHaveText("ORDER NOW");
    stopErrors();
  });

  test("390 mobile hero, sticky actions, and inline COD remain usable", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await goto(page, `/products/${PDP_SLUG}`);
    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Small");
    await assertNoPageOverflow(page, "PDP freeze 390 top");
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
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath("phase5-pdp-mobile-hero-390.png") });

    const cod = page.getByRole("main").locator("#quick-cod-order");
    await cod.scrollIntoViewIfNeeded();
    await expect(cod.getByTestId("quick-cod-submit")).toBeVisible();
    await assertNoPageOverflow(page, "PDP freeze 390 COD");

    await page.locator("#details").evaluate((node) =>
      node.scrollIntoView({ block: "start" }),
    );
    await expect(page.getByTestId("sticky-buy")).toBeVisible();
    await assertNoPageOverflow(page, "PDP freeze 390 sticky");
    stopErrors();
  });

  test("landing-page reuse keeps the frozen contract", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const main = await goto(page, `/lp/${LP_SLUG}`);
    // The promo block renders once per responsive layout variant.
    await expect(page.getByText("E2E promo headline").first()).toBeVisible();
    await expect(main.locator("#quick-cod-order")).toBeVisible();
    await expect(main.locator("#reviews")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Product sections" }),
    ).toBeVisible();
    await expect(sectionByHeading(page, "You May Also Like").locator("article")).toHaveCount(4);
    await assertNoPageOverflow(page, "LP freeze 1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(main.getByTestId("pdp-purchase")).toBeVisible();
    await expect(page.getByTestId("pdp-purchase")).toHaveCount(1);
    await assertNoPageOverflow(page, "LP freeze 390");
    stopErrors();
  });
});
