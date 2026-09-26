import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const API = "http://127.0.0.1:3210/api/v1";
const PDP_SLUG = "e2e-color-size";
const LP_SLUG = "e2e-lp-color-size";
const SCREENSHOTS = resolve(process.cwd(), "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

interface MediaJson {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
}

interface ProductJson {
  images: MediaJson[];
  initialMediaSet: { media: MediaJson[] } | null;
  detailBlocks: MediaJson[];
}

let product: ProductJson;
let galleryVideo: MediaJson;
let galleryVideoIndex: number;

async function fetchProduct(): Promise<ProductJson> {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(
      `${API}/storefront/products/${PDP_SLUG}`,
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as ProductJson | { product: ProductJson };
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
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return () => expect(errors).toEqual([]);
}

async function goto(page: Page, path: string): Promise<Locator> {
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto(`http://localhost:3211${path}`);
  const main = page.getByRole("main");
  await expect(main.getByTestId("pdp-purchase")).toBeVisible();
  return main;
}

async function selectGalleryVideo(main: Locator): Promise<Locator> {
  await main
    .getByRole("button", { name: `View media ${galleryVideoIndex + 1}` })
    .click();
  const video = main.locator('video[data-video-mode="TEASER"]');
  await expect(video).toHaveAttribute("src", galleryVideo.url);
  return video;
}

async function expectPlaying(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
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

async function installPlayCounter(
  page: Page,
  outcome: "resolve" | "reject" = "resolve",
): Promise<void> {
  await page.addInitScript((result) => {
    const scope = window as typeof window & { __videoPlayAttempts: number };
    scope.__videoPlayAttempts = 0;
    HTMLMediaElement.prototype.play = function () {
      scope.__videoPlayAttempts += 1;
      return result === "reject"
        ? Promise.reject(new DOMException("Blocked", "NotAllowedError"))
        : Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  }, outcome);
}

async function playAttempts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as typeof window & { __videoPlayAttempts?: number })
        .__videoPlayAttempts ?? 0,
  );
}

test.beforeAll(async () => {
  product = await fetchProduct();
  const gallery = product.initialMediaSet?.media ?? product.images;
  galleryVideoIndex = gallery.findIndex((media) => media.type === "VIDEO");
  galleryVideo = gallery[galleryVideoIndex]!;
  expect(galleryVideoIndex, "seeded shared gallery video exists").toBeGreaterThanOrEqual(0);
  expect(
    product.detailBlocks.some((block) => block.type === "VIDEO"),
    "seeded detail video exists",
  ).toBe(true);
});

test.describe("PDP viewport video system", () => {
  test("coordinates gallery, detail, lightbox, and variant switching on desktop", async ({
    page,
  }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const videoRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("product-video.webm")) {
        videoRequests.push(request.url());
      }
    });
    const main = await goto(page, `/products/${PDP_SLUG}`);

    expect(videoRequests).toEqual([]);
    const teaser = await selectGalleryVideo(main);
    await expectPlaying(teaser);
    expect(videoRequests.length).toBeGreaterThan(0);
    await page.screenshot({
      path: screenshotPath("phase3-gallery-video-desktop.png"),
    });

    const detail = main.locator('video[data-video-mode="CONTENT"]');
    await expect(detail).toHaveCount(1);
    await detail.scrollIntoViewIfNeeded();
    await expect(detail).toHaveAttribute("src", galleryVideo.url);
    await expectPlaying(detail);
    await expect.poll(() => teaser.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);

    const stage = main.getByRole("button", { name: "Open image gallery" });
    await stage.scrollIntoViewIfNeeded();
    await expectPlaying(teaser);
    await stage.click();
    const dialog = page.getByRole("dialog", { name: "Product image gallery" });
    const lightboxVideo = dialog.locator('video[data-video-mode="LIGHTBOX"]');
    await expect(lightboxVideo).toHaveAttribute("controls", "");
    await expect.poll(() => teaser.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
    await page.screenshot({
      path: screenshotPath("phase3-lightbox-video-desktop.png"),
    });
    await dialog.getByRole("button", { name: "Close image gallery" }).click();
    await expectPlaying(teaser);

    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Small");
    await expect(main.locator('video[data-video-mode="TEASER"]')).toHaveCount(0);
    await expect(stage.locator("img")).toBeVisible();
    stopErrors();
  });

  test("respects reduced motion", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await installPlayCounter(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const main = await goto(page, `/products/${PDP_SLUG}`);
    const teaser = await selectGalleryVideo(main);

    await expect(teaser).toHaveAttribute("preload", "none");
    expect(await playAttempts(page)).toBe(0);
    stopErrors();
  });

  test("respects Save-Data", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: {
          saveData: true,
          addEventListener() {},
          removeEventListener() {},
        },
      });
    });
    await installPlayCounter(page);
    const main = await goto(page, `/products/${PDP_SLUG}`);
    const teaser = await selectGalleryVideo(main);

    await expect(teaser).toHaveAttribute("preload", "none");
    expect(await playAttempts(page)).toBe(0);
    stopErrors();
  });

  test("handles autoplay rejection once without page errors", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await installPlayCounter(page, "reject");
    const main = await goto(page, `/products/${PDP_SLUG}`);
    const teaser = await selectGalleryVideo(main);
    await expect(teaser).toBeVisible();
    await expect.poll(() => playAttempts(page)).toBe(1);

    await teaser.scrollIntoViewIfNeeded();
    await page.getByRole("heading", { name: /E2E Color x Size Cabinet/ }).scrollIntoViewIfNeeded();
    await teaser.scrollIntoViewIfNeeded();
    expect(await playAttempts(page)).toBe(1);
    stopErrors();
  });

  test("keeps landing-page video usable at 375px", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const main = await goto(page, `/lp/${LP_SLUG}`);
    const detail = main.locator('video[data-video-mode="CONTENT"]');
    await expect(detail).toHaveCount(1);
    await detail.scrollIntoViewIfNeeded();
    await expect(detail).toHaveAttribute("src", galleryVideo.url);
    await expectPlaying(detail);

    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.client + 1);
    await page.screenshot({
      path: screenshotPath("phase3-detail-video-mobile-375.png"),
    });
    stopErrors();
  });
});
