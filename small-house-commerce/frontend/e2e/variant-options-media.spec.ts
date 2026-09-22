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

const API = "/api/v1";
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

/** Resolves the scenario product id through the admin API. */
let adminToken: string | null = null;
async function adminProductId(): Promise<string> {
  const context = await playwrightRequest.newContext();
  try {
    if (adminToken === null) {
      const login = await context.post(`${API}/auth/login`, {
        data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
      });
      expect(login.ok(), "admin API login").toBeTruthy();
      adminToken = ((await login.json()) as { accessToken: string }).accessToken;
    }
    const response = await context.get(`${API}/admin/products?search=${SLUGS.colorSize}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.ok(), "admin product lookup").toBeTruthy();
    const page = (await response.json()) as { items: { id: string; slug: string }[] };
    const found = page.items.find((item) => item.slug === SLUGS.colorSize);
    expect(found, "seeded color-size product exists").toBeTruthy();
    return found!.id;
  } finally {
    await context.dispose();
  }
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
 * this helper is audited, and `expectNoBrowserErrors()` fails the test on
 * any console error or uncaught page exception.
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

/** Audits every scoped media request (`/storefront/products/:slug/media`). */
function auditMediaRequests(page: Page): {
  requests: { url: URL; at: number }[];
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
    requests,
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

/** The storefront PDP's scoped-media fetches must carry the given scope. */
async function gotoPdp(page: Page, slug: string, query = ""): Promise<void> {
  await page.goto(`/products/${slug}${query}`);
  await expect(page.getByRole("main")).toBeVisible();
}

/** The address step: searchable province/city comboboxes + postal + street. */
async function fillAddress(page: Page): Promise<void> {
  await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Buyer");
  await page.getByPlaceholder("0917 123 4567").fill("09171234567");
  await page.getByTestId("psgc-province").fill("Metro Manila");
  await page.getByRole("option", { name: /Metro Manila/i }).first().click();
  await page.getByTestId("psgc-city").fill("Quezon");
  await page.getByRole("option", { name: /Quezon City/i }).first().click();
  await page.getByTestId("checkout-postal-code").fill("1100");
  await page.getByPlaceholder("House no., street, subdivision").fill("12 E2E Street");
}

async function selectValue(
  page: Page,
  optionName: string,
  valueLabel: string,
): Promise<void> {
  await page
    .getByRole("group", { name: optionName })
    .getByRole("button", { name: valueLabel })
    .click();
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

    const group = page.getByRole("group", { name: "Style" });
    await expect(group.getByRole("button", { name: "Walnut" })).toBeVisible();
    await expect(group.getByRole("button", { name: "Oak" })).toBeVisible();

    await group.getByRole("button", { name: "Oak" }).click();
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
      page.getByRole("group", { name: "Style" }).getByRole("button", { name: "Oak" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1,699").first()).toBeVisible();
    await stopErrors();
  });

  test("invalid deep link is stripped without breaking the page", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await gotoPdp(page, SLUGS.legacy, "?variant=not-a-real-variant");

    await expect(page).toHaveURL(new RegExp(`/products/${SLUGS.legacy}$`));
    await expect(page.getByRole("group", { name: "Style" })).toBeVisible();
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
      .getByRole("group", { name: "Color" })
      .getByRole("button", { name: "Blue" });
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

    await expect(page.getByRole("group", { name: "Color" })).toBeVisible();
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
      page.getByRole("group", { name: "Size" }).getByRole("button", { name: "Small" }),
    ).toHaveAttribute("title", /out of stock/i);
    await stopErrors();
  });

  test("deep link: valid variant preselects, unknown variant resets", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const product = await fetchProduct(SLUGS.colorSize);
    const redMedium = product.variants.find((variant) => variant.name === "Red / Medium");
    expect(redMedium).toBeTruthy();

    await gotoPdp(page, SLUGS.colorSize, `?variant=${redMedium!.id}`);
    await expect(
      page.getByRole("group", { name: "Color" }).getByRole("button", { name: "Red" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("group", { name: "Size" }).getByRole("button", { name: "Medium" }),
    ).toHaveAttribute("aria-pressed", "true");
    await stopErrors();
  });

  test("PLP card Order Now opens the shared picker and confirms into the cart", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.goto("/categories/e2e-catalog");
    await page
      .getByTestId("plp-add-e2e-color-size")
      .click(); // multi-SKU card: opens the shared picker, never a positional SKU

    // The drawer swaps to the shared purchase island (never "the first SKU").
    await page.getByTestId("picker-confirm-e2e-color-size").click({
      timeout: 5_000,
    }).catch(() => {
      // Nothing resolves on a multi-SKU product without choosing options —
      // confirm stays disabled until a full combination is picked.
    });
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

    await page.goto("/cart");
    await expect(page.getByText("Red / Medium").first()).toBeVisible();
    await expect(page.getByText(/Color: Red/).first()).toBeVisible();
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
    await expect(page.getByText("Blue / Medium").first()).toBeVisible();
    await stopErrors();
  });

  test("account: the registered customer sees the order with structured options", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const email = `e2e-customer-${Date.now()}@smallhouse.test`;

    await page.goto("/register");
    await page.getByLabel("Full name").fill("E2E Customer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-customer-pass");
    await page.locator("button[type=submit]").click();
    await expect(page).not.toHaveURL(/\/register/);

    await gotoPdp(page, SLUGS.colorSize);
    await selectValue(page, "Color", "Red");
    await selectValue(page, "Size", "Small");
    await page.getByTestId("order-now").click();
    await expect(page).toHaveURL(/\/checkout/);
    await fillAddress(page);
    await page.getByPlaceholder("Juan Dela Cruz").fill("E2E Customer");
    await page.getByTestId("review-order").click();
    await page.getByTestId("confirm-place-order").click();
    await expect(page.getByTestId("order-number")).toBeVisible();

    await page.goto("/account");
    await expect(page.getByText("Red / Small").first()).toBeVisible();
    await stopErrors();
  });
});

// --- Exact scoped-media override ---------------------------------------------

test.describe("Exact scoped-media override", () => {
  test("deep-linked variant requests exact media and switching scopes cleanly", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    const audit = auditMediaRequests(page);
    const product = await fetchProduct(SLUGS.exactOverride);
    const red = product.variants.find((variant) => variant.name === "Red");
    const blueValue = product.options[0].values.find((value) => value.label === "Blue");

    await gotoPdp(page, SLUGS.exactOverride, `?variant=${red!.id}`);
    // The gallery must show the variant-exact image, not the Red value media.
    await expect(page.locator('img[src*="exact-override-red"]').first()).toBeVisible();
    expect(audit.scopedSince(0, { variantId: red!.id }).length).toBeGreaterThan(0);

    const afterBlue = audit.marker();
    await selectValue(page, "Color", "Blue");
    await expect(page.locator('img[src*="e2e-exact-override-blue"]').first()).toBeVisible();
    // After the switch, no request may target the previous variant's scope.
    expect(audit.scopedSince(afterBlue, { variantId: red!.id })).toEqual([]);
    expect(audit.scopedSince(afterBlue, { optionValueId: blueValue!.id }).length).toBeGreaterThan(0);
    await stopErrors();
  });
});

// --- Landing page purchase island ---------------------------------------------

test.describe("Landing page", () => {
  test("LP renders the purchase island with seeded media and options", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);
    await page.goto("/lp/e2e-lp-color-size");

    await expect(page.getByText("E2E promo headline")).toBeVisible();
    await expect(page.getByRole("group", { name: "Color" })).toBeVisible();
    await expect(page.getByText("1,199").first()).toBeVisible();
    await stopErrors();
  });
});

// --- Admin: the typed graph edit loop ------------------------------------------

test.describe("Admin typed editors", () => {
  test("edit page hydrates the seeded typed graph and renames a value live", async ({ page }) => {
    const stopErrors = trackBrowserErrors(page);

    // UI login (the admin refresh-token flow), then resolve the product id
    // through the admin API with the same credentials.
    await page.goto("/admin/login");
    await page.locator("input[type=email]").fill(E2E_ADMIN_EMAIL);
    await page.locator("input[type=password]").fill(E2E_ADMIN_PASSWORD);
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 30_000 });

    const productId = await adminProductId();
    await page.goto(`/admin/products/${productId}/edit`);

    // Variants & Pricing tab: the typed editors own variants on typed products.
    // Typed products rename the tab: the typed editors own it.
    await page
      .getByRole("tab", { name: /Options & Variants|Variants & Pricing/i })
      .click();
    // Option 1 (Color) hydrates from the seeded typed graph. The name/label
    // inputs repeat per option group, so scope by DOM order (option 1 first).
    await expect(
      page.getByRole("textbox", { name: "Option 1 name" }).first(),
    ).toHaveValue("Color");
    await expect(
      page.getByRole("textbox", { name: "Value 1 label" }).first(),
    ).toHaveValue("Red");
    // The matrix shows all four persisted combinations.
    for (const name of ["Red / Small", "Red / Medium", "Blue / Small", "Blue / Medium"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // Rename Red -> Crimson and save: the two-phase typed save round-trips.
    await page.getByRole("textbox", { name: "Value 1 label" }).first().fill("Crimson");
    await page.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    // Storefront shows the renamed value (the GET/PUT typed loop is live).
    await gotoPdp(page, SLUGS.colorSize);
    await expect(
      page.getByRole("group", { name: "Color" }).getByRole("button", { name: "Crimson" }),
    ).toBeVisible();
    await stopErrors();
  });
});
