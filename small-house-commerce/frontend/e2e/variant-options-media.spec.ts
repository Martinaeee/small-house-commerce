import { request as playwrightRequest, expect, test, type Page } from "@playwright/test";

/**
 * Task 20 — Phase 1 browser acceptance gate.
 *
 * Covers every Phase-1 variant scenario against the REAL backend + frontend
 * running on a disposable seeded database (see playwright.config.ts):
 *
 *   - Legacy Style (graph-v0 compatibility bridge): the storefront projects
 *     the legacy variants into a synthetic "Style" option.
 *   - Color-only, Size-only, Color×Size: the typed option graph end to end.
 *   - Exact override: variant-scoped media outranks option-value media.
 *   - Valid/invalid deep links, OOS save vs Order Now, PDP/LP/Quick Add/
 *     cart/checkout/order/account/Admin, 375/768/1280 viewports,
 *     keyboard/focus, a media-request audit (no non-current scope is ever
 *     requested), and zero console/hydration errors on every page.
 */

/**
 * Browser flows go through the frontend origin (same-origin /api/v1 via the
 * next dev rewrite). API-context assertions call the BACKEND directly: in
 * Next 16 dev the rewrite proxy can serve a stale cached response, and the
 * gate must read committed truth.
 */
const API = "http://127.0.0.1:3210/api/v1";

const SLUGS = {
  legacy: "e2e-legacy-style",
  colorOnly: "e2e-color-only",
  sizeOnly: "e2e-size-only",
  colorSize: "e2e-color-size",
  exactOverride: "e2e-exact-override",
} as const;

interface ProductJson {
  id: string;
  slug: string;
  catalogGraphVersion: number;
  effectiveCoverMedia: { url: string } | null;
  options: { id: string; name: string; isMediaDriver: boolean; values: { id: string; label: string }[] }[];
  variants: { id: string; name: string; combinationKey: string; sku: { skuCode: string; price: string } | null }[];
  images: { url: string }[];
}

/** Seed credentials from backend/prisma/seed-e2e.ts. */
const E2E_ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const E2E_ADMIN_PASSWORD = "E2eAdminPass123!";

const productCache = new Map<string, ProductJson>();

// --- admin API helpers (direct backend calls) ---------------------------------

let adminToken: string | null = null;
async function withAdminToken<T>(
  run: (
    token: string,
    context: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  ) => Promise<T>,
): Promise<T> {
  const context = await playwrightRequest.newContext();
  try {
    if (adminToken === null) {
      const login = await context.post(`${API}/auth/login`, {
        data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
      });
      expect(login.ok(), "admin API login").toBeTruthy();
      adminToken = ((await login.json()) as { accessToken: string }).accessToken;
    }
    return await run(adminToken, context);
  } finally {
    await context.dispose();
  }
}

async function adminProductIdFor(slug: string): Promise<string> {
  return withAdminToken(async (token, context) => {
    const response = await context.get(`${API}/admin/products?search=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), "admin product lookup").toBeTruthy();
    const page = (await response.json()) as { items: { id: string; slug: string }[] };
    const found = page.items.find((item) => item.slug === slug);
    expect(found, `seeded product ${slug} exists`).toBeTruthy();
    return found!.id;
  });
}

/** The admin typed graph snapshot used by the mutation cleanup fallback. */
interface AdminOptionValueJson {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}
interface AdminOptionJson {
  id: string;
  kind: string;
  name: string;
  position: number;
  presentation: string;
  isMediaDriver: boolean;
  isActive: boolean;
  values: AdminOptionValueJson[];
}
interface AdminProductJson {
  id: string;
  slug: string;
  tagline: string | null;
  catalogGraphVersion: number;
  options: AdminOptionJson[];
}
async function adminApiProduct(slug: string): Promise<AdminProductJson> {
  const id = await adminProductIdFor(slug);
  return withAdminToken(async (token, context) => {
    const response = await context.get(`${API}/admin/products/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), "admin product GET").toBeTruthy();
    return (await response.json()) as AdminProductJson;
  });
}

async function adminPatch(
  productId: string,
  body: Record<string, unknown>,
): Promise<void> {
  return withAdminToken(async (token, context) => {
    const response = await context.patch(`${API}/admin/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    expect(response.ok(), `admin product PATCH (${response.status()}): ${await response.text()}`).toBeTruthy();
  });
}

async function restoreAdminColorSizeSnapshot(before: AdminProductJson): Promise<string[]> {
  const failures: string[] = [];
  let current: AdminProductJson;
  try {
    current = await adminApiProduct(SLUGS.colorSize);
  } catch (error) {
    failures.push(`read current typed product: ${error instanceof Error ? error.message : String(error)}`);
    return failures;
  }

  const desired = before.options.find((option) => option.id === current.options[0]?.id) ?? before.options[0];
  const target = current.options.find((option) => option.id === desired?.id) ?? current.options[0];
  if (!desired || !target) {
    failures.push("typed option snapshot has no recoverable option row");
  } else {
    const usedValueIds = new Set<string>();
    const values = desired.values.map((desiredValue) => {
      const targetValue =
        target.values.find((value) => value.id === desiredValue.id && !usedValueIds.has(value.id)) ??
        target.values.find((value) => value.position === desiredValue.position && !usedValueIds.has(value.id)) ??
        target.values.find((value) => !usedValueIds.has(value.id));
      if (targetValue) usedValueIds.add(targetValue.id);
      return {
        ...(targetValue ? { id: targetValue.id } : {}),
        label: desiredValue.label,
        position: desiredValue.position,
        swatchHex: desiredValue.swatchHex,
        thumbnailUrl: desiredValue.thumbnailUrl,
        thumbnailAlt: desiredValue.thumbnailAlt,
        isActive: desiredValue.isActive,
      };
    });
    const retirements = target.values
      .filter((value) => !usedValueIds.has(value.id))
      .map((value) => value.id);
    try {
      await adminPatch(current.id, {
        ...(current.tagline !== before.tagline ? { tagline: before.tagline } : {}),
        catalogGraphVersion: current.catalogGraphVersion,
        catalogGraph: {
          options: [
            {
              id: target.id,
              kind: desired.kind,
              name: desired.name,
              position: desired.position,
              presentation: desired.presentation,
              isMediaDriver: desired.isMediaDriver,
              isActive: desired.isActive,
              values,
            },
          ],
          variants: [],
          media: [],
          retirements: {
            optionIds: [],
            optionValueIds: retirements,
            variantIds: [],
            mediaIds: [],
          },
        },
      });
    } catch (firstError) {
      try {
        await adminPatch(current.id, {
          ...(current.tagline !== before.tagline ? { tagline: before.tagline } : {}),
          catalogGraphVersion: current.catalogGraphVersion,
          catalogGraph: {
            options: [
              {
                id: target.id,
                kind: desired.kind,
                name: desired.name,
                position: desired.position,
                presentation: desired.presentation,
                isMediaDriver: desired.isMediaDriver,
                isActive: desired.isActive,
                values,
              },
            ],
            variants: [],
            media: [],
            retirements: { optionIds: [], optionValueIds: [], variantIds: [], mediaIds: [] },
          },
        });
      } catch (secondError) {
        failures.push(
          `restore typed option: ${firstError instanceof Error ? firstError.message : String(firstError)}; fallback: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
        );
      }
    }
  }

  try {
    const after = await adminApiProduct(SLUGS.colorSize);
    const afterOption = after.options.find((option) => option.name === desired?.name);
    const expectedOption = before.options.find((option) => option.name === desired?.name);
    if (
      after.tagline !== before.tagline ||
      !afterOption ||
      !expectedOption ||
      afterOption.values.map((value) => value.label).join("|") !==
        expectedOption.values.map((value) => value.label).join("|")
    ) {
      failures.push("post-cleanup existing admin fixture is not canonical");
    }
  } catch (error) {
    failures.push(`verify canonical admin fixture: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failures;
}


async function fetchProduct(slug: string): Promise<ProductJson> {
  const cached = productCache.get(slug);
  if (cached) return cached;
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.get(`${API}/storefront/products/${slug}`);
    expect(response.ok(), `GET storefront product ${slug}`).toBeTruthy();
    const body = (await response.json()) as { product: ProductJson } | ProductJson;
    const product = "product" in body ? body.product : body;
    productCache.set(slug, product);
    return product;
  } finally {
    await context.dispose();
  }
}

// --- shared helpers -----------------------------------------------------------

/**
 * Zero console/hydration errors is a hard gate: every page visited through
 * this helper is audited, and `stopErrors()` fails the test on any console
 * error or uncaught page exception.
 */
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

/**
 * Audits every scoped media request (`/storefront/products/:slug/media`).
 * The URL check matches any "/media" occurrence (including harmless
 * `/_next/static/media/*` chunk names); the assertions below filter on the
 * variantId/optionValueId query params, so the noise can never match.
 */
function auditMediaRequests(page: Page): {
  marker: () => number;
  scopedSince: (
    since: number,
    scope: { variantId?: string; optionValueId?: string },
  ) => URL[];
} {
  const requests: { url: URL; at: number }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/media")) {
      requests.push({ url: new URL(request.url()), at: Date.now() });
    }
  });
  return {
    marker: () => Date.now(),
    scopedSince(since, scope) {
      return requests
        .filter((entry) => entry.at >= since)
        .map((entry) => entry.url)
        .filter((url) =>
          scope.variantId !== undefined
            ? url.searchParams.get("variantId") === scope.variantId
            : url.searchParams.get("optionValueId") === scope.optionValueId,
        );
    },
  };
}

/**
 * Navigates and waits out the `next dev` hydration race: the HTML paints
 * before React attaches event handlers, so a click straight after goto can
 * fire into a not-yet-hydrated island. networkidle settles once the initial
 * chunk requests finished, i.e. hydration has run.
 */
async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** The storefront PDP's scoped-media fetches must carry the given scope. */
async function gotoPdp(page: Page, slug: string, query = ""): Promise<void> {
  await goto(page, `/products/${slug}${query}`);
  await expect(page.getByRole("main")).toBeVisible();
}

/**
 * Selects an option value. The fieldset (named "Color: …" from its legend)
 * and the inner role=group (named exactly "Color") both carry the option
 * name as a substring, so the group lookup must be exact.
 */
async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  const value = page
    .getByRole("group", { name: optionName, exact: true })
    .getByRole("button", { name: valueLabel, exact: true });
  // Click + verify: a click landing just before React attaches handlers is
  // swallowed silently, which would leave the combination unconfirmed and
  // reroute Order Now through the buy-now confirm interstitial.
  await expect(async () => {
    await value.click();
    await expect(value).toHaveAttribute("aria-pressed", "true");
  }).toPass({ timeout: 15_000 });
}

/** The address step: searchable province/city comboboxes + postal + street. */
async function fillAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  // The PSGC dataset names the NCR city plain "Quezon".
  await page.getByRole("option", { name: "Quezon", exact: true }).first().click();
  await page.getByTestId("checkout-postal-code").fill("1100");
  await page.getByPlaceholder("House no., street, subdivision").fill("12 E2E Street");
}

test.beforeAll(async () => {
  // Warm the product cache so deep-link variant ids resolve per test.
  for (const slug of Object.values(SLUGS)) {
    await fetchProduct(slug);
  }
});

// --- Legacy Style: the graph-v0 compatibility bridge -------------------------

test.describe("Legacy Style compatibility", () => {
  test("projects legacy variants into a Style picker with per-style prices", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.legacy);

    const group = page.getByRole("group", { name: "Style", exact: true });
    await expect(group.getByRole("button", { name: "Walnut", exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: "Oak", exact: true })).toBeVisible();

    await group.getByRole("button", { name: "Oak", exact: true }).click();
    await expect(page.getByText("1,699").first()).toBeVisible();
    await stopErrors();
  });

  test("valid deep link preselects the style", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const product = await fetchProduct(SLUGS.legacy);
    const oak = product.variants.find((variant) => variant.name === "Oak");
    expect(oak).toBeTruthy();

    await gotoPdp(page, SLUGS.legacy, `?variant=${oak!.id}`);

    await expect(
      page
        .getByRole("group", { name: "Style", exact: true })
        .getByRole("button", { name: "Oak", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1,699").first()).toBeVisible();
    await stopErrors();
  });

  test("invalid deep link is stripped without breaking the page", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.legacy, "?variant=not-a-real-variant");

    await expect(page).toHaveURL(new RegExp(`/products/${SLUGS.legacy}$`));
    await expect(
      page.getByRole("group", { name: "Style", exact: true }),
    ).toBeVisible();
    await stopErrors();
  });
});

// --- Color-only: typed graph + scoped media audit -----------------------------

test.describe("Color-only", () => {
  test("selecting values switches price and requests only the current media scope", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const audit = auditMediaRequests(page);
    const product = await fetchProduct(SLUGS.colorOnly);
    const blue = product.options[0].values.find((value) => value.label === "Blue");
    const red = product.options[0].values.find((value) => value.label === "Red");

    await gotoPdp(page, SLUGS.colorOnly);
    await selectValue(page, "Color", "Red");
    await expect(page.getByText("1,299").first()).toBeVisible();

    const afterBlue = audit.marker();
    await selectValue(page, "Color", "Blue");
    await expect(page.getByText("1,199").first()).toBeVisible();

    // Blue IS requested (current scope); Red is never requested again.
    const blueRequests = audit.scopedSince(afterBlue, { optionValueId: blue!.id });
    expect(blueRequests.length).toBeGreaterThan(0);
    expect(audit.scopedSince(afterBlue, { optionValueId: red!.id })).toEqual([]);
    await stopErrors();
  });

  test("keyboard: focus reaches the swatches and Enter selects", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.colorOnly);

    const blue = page
      .getByRole("group", { name: "Color", exact: true })
      .getByRole("button", { name: "Blue", exact: true });
    await blue.focus();
    await expect(blue).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1,199").first()).toBeVisible();
    await stopErrors();
  });

  test("375px: purchase island stays usable and adds to the cart", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoPdp(page, SLUGS.colorOnly);

    await selectValue(page, "Color", "Blue");
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByText("Your Cart")).toBeVisible();
    await stopErrors();
  });

  test("768px: option selector and gallery render", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoPdp(page, SLUGS.colorOnly);

    await expect(page.getByRole("group", { name: "Color", exact: true })).toBeVisible();
    await expect(page.getByText("1,199").first()).toBeVisible();
    await stopErrors();
  });
});

// --- Size-only: OOS save vs Order Now -----------------------------------------

test.describe("Size-only stock behavior", () => {
  test("out-of-stock selection keeps save-for-later and drops Order Now", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.sizeOnly);

    await selectValue(page, "Size", "Small");
    // OOS save-for-later: the add button stays enabled with save copy.
    await expect(page.getByTestId("add-to-cart")).toBeEnabled();
    await expect(page.getByTestId("oos-contact")).toBeVisible();

    await page.getByTestId("add-to-cart").click();
    await expect(page.getByText("Your Cart")).toBeVisible();
    await stopErrors();
  });

  test("in-stock selection orders now into checkout", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.sizeOnly);

    await selectValue(page, "Size", "Medium");
    await page.getByTestId("order-now").click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByTestId("review-order")).toBeVisible();
    await stopErrors();
  });
});

// --- Color×Size: full matrix, deep links, quick add, cart, checkout, order ----

test.describe("Color x Size end-to-end purchase", () => {
  test("matrix resolves combinations and marks the OOS one", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.colorSize);

    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Medium");
    await expect(page.getByTestId("order-now")).toBeEnabled();

    // Blue / Small is seeded out of stock: the value announces it.
    await selectValue(page, "Color", "Blue");
    await expect(
      page
        .getByRole("group", { name: "Size", exact: true })
        .getByRole("button", { name: "Small", exact: true }),
    ).toHaveAttribute("title", /out of stock/i);
    await stopErrors();
  });

  test("deep link: valid variant preselects, unknown variant resets", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const product = await fetchProduct(SLUGS.colorSize);
    const redMedium = product.variants.find((variant) => variant.name === "Red / Medium");
    expect(redMedium).toBeTruthy();

    // Valid deep link: the named combination preselects both options.
    await gotoPdp(page, SLUGS.colorSize, `?variant=${redMedium!.id}`);
    await expect(
      page
        .getByRole("group", { name: "Color", exact: true })
        .getByRole("button", { name: "Red", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .getByRole("group", { name: "Size", exact: true })
        .getByRole("button", { name: "Medium", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // Unknown variant: the param is stripped and the selection resets to
    // exactly what a fresh load of the clean URL initializes (nothing
    // selected — the price falls back to the "from" floor).
    await gotoPdp(page, SLUGS.colorSize, "?variant=not-a-real-variant-id");
    await expect(page).toHaveURL(new RegExp(`/products/${SLUGS.colorSize}$`));
    await expect(
      page
        .getByRole("group", { name: "Color", exact: true })
        .getByRole("button", { name: "Red", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page
        .getByRole("group", { name: "Size", exact: true })
        .getByRole("button", { name: "Medium", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("From").first()).toBeVisible();
    await stopErrors();
  });

  test("PLP card Order Now opens the shared picker and confirms into the cart", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await goto(page, "/categories/e2e-catalog");
    await page
      .getByTestId("plp-add-e2e-color-size")
      .click(); // multi-SKU card: opens the shared picker, never a positional SKU

    // The confirm button stays disabled until a full combination is picked —
    // nothing resolves on a multi-SKU product without choosing options.
    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Medium");
    await page.getByTestId("picker-confirm-e2e-color-size").click();
    await expect(page.getByText("Your Cart")).toBeVisible();
    await stopErrors();
  });

  test("cart shows the structured option values and checks out", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.colorSize);
    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Medium");
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByText("Your Cart")).toBeVisible();

    await goto(page, "/cart");
    // Cart lines show the structured option values (T18 contract).
    await expect(page.getByText(/Color: Red · Size: Medium/).first()).toBeVisible();
    await page.getByTestId("proceed-checkout").click();
    await expect(page).toHaveURL(/\/checkout/);
    await stopErrors();
  });

  test("guest checkout places a COD order that shows the chosen options", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.colorSize);
    await selectValue(page, "Color", "Blue");
    await selectValue(page, "Size", "Medium");
    await page.getByTestId("order-now").click();
    await expect(page).toHaveURL(/\/checkout/);

    await fillAddress(page);
    await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Guest Buyer");

    await page.getByTestId("review-order").click();
    await page.getByTestId("confirm-place-order").click();

    await expect(page).toHaveURL(/\/order-success/);
    await expect(page.getByTestId("order-number")).toBeVisible();
    await stopErrors();
  });

  test("account: the registered customer sees the order with structured options", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const email = `e2e-customer-${Date.now()}@smallhouse.test`;
    // Unique per run: a phone can belong to only one customer account.
    const phone = `0917${String(Date.now() % 10000000).padStart(7, "0")}`;

    await goto(page, "/register");
    await page.getByLabel("Full name").fill("E2E Customer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-customer-pass");
    await page.locator("button[type=submit]").click();
    await expect(page).not.toHaveURL(/\/register/);

    // The account links COD orders by mobile number, so the profile number
    // must exist BEFORE the order is placed.
    await goto(page, "/account");
    await page.getByLabel(/Mobile number/).fill(phone);
    await page.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await gotoPdp(page, SLUGS.colorSize);
    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Small");
    await page.getByTestId("order-now").click();
    await expect(page).toHaveURL(/\/checkout/);
    await fillAddress(page);
    await page.getByPlaceholder("0917 123 4567").fill(phone);
    await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Customer");
    await page.getByTestId("review-order").click();
    await page.getByTestId("confirm-place-order").click();
    await expect(page.getByTestId("order-number")).toBeVisible();

    await goto(page, "/account");
    await expect(page.getByText(/Color: Red/).first()).toBeVisible();
    await expect(page.getByText(/Size: Small/).first()).toBeVisible();
    await stopErrors();
  });
});

// --- Exact scoped-media override ---------------------------------------------
// Viewport note: tests that do not call setViewportSize run at the Desktop
// Chrome default 1280x720, which is the gate's desktop leg.

test.describe("Exact scoped-media override", () => {
  test("deep-linked variant shows exact media and switching scopes cleanly", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const audit = auditMediaRequests(page);
    const product = await fetchProduct(SLUGS.exactOverride);
    const red = product.variants.find((variant) => variant.name === "Red");
    const blueValue = product.options[0].values.find((value) => value.label === "Blue");

    await gotoPdp(page, SLUGS.exactOverride, `?variant=${red!.id}`);
    // The gallery must show the variant-exact image, not the Red value media.
    // (The initial scope arrives SSR-provided, so no client /media request is
    // expected for the deep-linked first scope.)
    await expect(page.locator('img[src*="exact-override-red"]').first()).toBeVisible();

    const afterBlue = audit.marker();
    await selectValue(page, "Color", "Blue");
    await expect(page.locator('img[src*="e2e-exact-override-blue"]').first()).toBeVisible();
    // After the switch, no request may target the previous variant's scope,
    // and the current option-value scope IS requested.
    expect(audit.scopedSince(afterBlue, { variantId: red!.id })).toEqual([]);
    expect(
      audit.scopedSince(afterBlue, { optionValueId: blueValue!.id }).length,
    ).toBeGreaterThan(0);
    await stopErrors();
  });
});

// --- Landing page purchase island ---------------------------------------------

test.describe("Landing page", () => {
  test("LP renders the purchase island with seeded media and options", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await goto(page, "/lp/e2e-lp-color-size");

    await expect(page.getByText("E2E promo headline")).toBeVisible();
    await expect(page.getByRole("group", { name: "Color", exact: true })).toBeVisible();
    // The seed's default display variant is Red / Small at 1,299; Blue is
    // selected explicitly in the Color-only coverage above.
    await expect(page.getByText("1,299").first()).toBeVisible();
    await stopErrors();
  });
});

// --- Admin: the typed graph edit loop ------------------------------------------

test.describe("Admin typed editors", () => {
  test("edit page hydrates the seeded typed graph and renames a value live", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const before = await adminApiProduct(SLUGS.colorSize);
    let primaryError: unknown = null;

    try {
      // UI login (the admin refresh-token flow), then resolve the product id
      // through the admin API with the same credentials.
      await goto(page, "/admin/login");
      await page.locator("input[type=email]").fill(E2E_ADMIN_EMAIL);
      await page.locator("input[type=password]").fill(E2E_ADMIN_PASSWORD);
      await page.locator("button[type=submit]").click();
      await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 30_000 });

      const productId = await adminProductIdFor(SLUGS.colorSize);
      await goto(page, `/admin/products/${productId}/edit`);

      // Variants & Pricing tab: the typed editors own variants on typed products.
      await page
        .getByRole("tab", { name: /Options & Variants|Variants & Pricing|选项、价格与库存/i })
        .click();
      // Option 1 (Color) hydrates from the seeded typed graph. The name/label
      // inputs repeat per option group, so scope by DOM order (option 1 first).
      await expect(
        page.getByRole("textbox", { name: /Option 1 name|选项 1 名称/i }).first(),
      ).toHaveValue("Color");
      const initialLabel = await page
        .getByRole("textbox", { name: /Value 1 label|选项值 1 标签/i })
        .first()
        .inputValue();
      expect(initialLabel).toBeTruthy();
      // The matrix shows all four persisted combinations.
      for (const name of ["Red / Small", "Red / Medium", "Blue / Small", "Blue / Medium"]) {
        await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      }

      // Rename Red -> Crimson-<nonce> and save: the two-phase typed save
      // round-trips. Verified through the admin API — the dev server's
      // storefront fetch cache is sticky (Next 16 dev).
      const renamed = `Crimson ${Date.now() % 100000}`;
      expect(initialLabel).not.toBe(renamed);
      await page.getByRole("textbox", { name: /Value 1 label|选项值 1 标签/i }).first().fill(renamed);
      await page.getByRole("button", { name: /Save changes|保存更改/i }).click();
      await expect(page.getByText(/Product saved\.|商品已保存。/i)).toBeVisible();
      const renamedProduct = await adminApiProduct(SLUGS.colorSize);
      const renamedColor = renamedProduct.options.find((option) => option.name === "Color");
      expect(renamedColor?.values[0]?.label).toBe(renamed);

      // Restore through the browser when possible; the finally fallback below
      // also repairs the fixture if this UI save or any assertion fails.
      await page.getByRole("textbox", { name: /Value 1 label|选项值 1 标签/i }).first().fill("Red");
      await page.getByRole("button", { name: /Save changes|保存更改/i }).click();
      await expect(page.getByText(/Product saved\.|商品已保存。/i)).toBeVisible();
      const restored = await adminApiProduct(SLUGS.colorSize);
      const restoredColor = restored.options.find((option) => option.name === "Color");
      expect(restoredColor?.values[0]?.label).toBe("Red");
      await stopErrors();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupFailures = await restoreAdminColorSizeSnapshot(before);
      if (primaryError) {
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [primaryError, ...cleanupFailures.map((message) => new Error(message))],
            "existing admin fixture assertion failed; cleanup also reported failures",
          );
        }
        throw primaryError;
      }
      if (cleanupFailures.length > 0) {
        throw new Error(`existing admin fixture cleanup failed: ${cleanupFailures.join("; ")}`);
      }
    }
  });
});
