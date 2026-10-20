import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";
import type { AdminFaqItem } from "../src/lib/admin-api";

/**
 * FAQ closeout browser acceptance: server-calculated impact confirmation,
 * permission-split roles, ordering/preview/CUSTOM copy, authoritative
 * membership refresh, and the mobile confirmation layout. Runs against the
 * real stack (Nest + next dev + disposable Postgres) with normal logins;
 * tokens stay in memory only.
 */

const API = "http://127.0.0.1:3210/api/v1";
const FRONTEND_ORIGIN =
  process.env.E2E_FRONTEND_ORIGIN ?? "http://localhost:3211";
const ADMIN_EMAIL = "e2e-admin@smallhouse.test";
// The permission-split scenario grants these roles one extra permission for
// the duration of the test; see backend/prisma/e2e-faq-role-grants.ts.
const OPTIMIZER_EMAIL = "e2e-optimizer@smallhouse.test";
const WAREHOUSE_EMAIL = "e2e-warehouse@smallhouse.test";
const ADMIN_PASSWORD = "E2eAdminPass123!";
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");
const SHOT_DIR =
  process.env.E2E_FAQ_SCREENSHOTS ?? path.join(tmpdir(), "faq-closeout-shots");

assertE2EDatabaseUrl(DATABASE_URL);
mkdirSync(SHOT_DIR, { recursive: true });

test.use({ trace: "off" });

const IMPACT_ITEM: AdminFaqItem = {
  id: "70000000-0000-4000-8000-000000000001",
  title: "E2E impact confirmation question?",
  answer: [{ kind: "paragraph", text: "Confirmed through the shared library." }],
  enabled: true,
  position: 500,
  defaultOpen: false,
};

const ORDER_SHARED_ITEM: AdminFaqItem = {
  id: "70000000-0000-4000-8000-000000000002",
  title: "E2E shared question for ordering?",
  answer: [{ kind: "paragraph", text: "Rendered before product questions." }],
  enabled: true,
  position: 501,
  defaultOpen: false,
};

const MEMBERSHIP_ITEM: AdminFaqItem = {
  id: "70000000-0000-4000-8000-000000000021",
  title: "E2E membership-refresh question?",
  answer: [{ kind: "paragraph", text: "Removed before the mode switch." }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

const PRODUCT_ITEM_ONE: AdminFaqItem = {
  id: "70000000-0000-4000-8000-000000000011",
  title: "E2E first product question?",
  answer: [{ kind: "paragraph", text: "First in the product list." }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

const PRODUCT_ITEM_TWO: AdminFaqItem = {
  id: "70000000-0000-4000-8000-000000000012",
  title: "E2E second product question?",
  answer: [{ kind: "paragraph", text: "Second in the product list." }],
  enabled: true,
  position: 1,
  defaultOpen: false,
};

type ProductResponse = {
  id: string;
  name: string;
  slug: string;
  productCode: string | null;
  faq?: {
    mode: "SHARED" | "EXTEND" | "CUSTOM";
    items: AdminFaqItem[];
    version: number;
  };
};

type SharedResponse = {
  id: string;
  items: AdminFaqItem[];
  version: number;
};

// POST /auth/login is throttled per IP (10 attempts / 10 minutes). The
// scenarios share one API token per account so the whole file stays inside
// that budget; the token lives in process memory only.
const apiTokens = new Map<string, string>();

async function login(
  api: APIRequestContext,
  email: string = ADMIN_EMAIL,
): Promise<string> {
  const cached = apiTokens.get(email);
  if (cached !== undefined) return cached;
  const response = await api.post(`${API}/auth/login`, {
    data: { email, password: ADMIN_PASSWORD },
  });
  expect(
    response.ok(),
    `login failed for ${email}: ${response.status()}`,
  ).toBeTruthy();
  const token = ((await response.json()) as { accessToken: string })
    .accessToken;
  apiTokens.set(email, token);
  return token;
}

async function productId(
  api: APIRequestContext,
  token: string,
  slug: string,
): Promise<string> {
  const response = await api.get(
    `${API}/admin/products?search=${slug}&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    items: { id: string; slug: string }[];
  };
  const product = body.items.find((item) => item.slug === slug);
  expect(product, `seeded product ${slug} is missing`).toBeTruthy();
  return product!.id;
}

async function getProduct(
  api: APIRequestContext,
  token: string,
  id: string,
): Promise<ProductResponse> {
  const response = await api.get(`${API}/admin/products/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ProductResponse;
}

async function patchProduct(
  api: APIRequestContext,
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<ProductResponse> {
  const response = await api.patch(`${API}/admin/products/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  expect(
    response.ok(),
    `product PATCH failed: ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as ProductResponse;
}

async function getSharedFaq(
  api: APIRequestContext,
  token: string,
): Promise<SharedResponse> {
  const response = await api.get(`${API}/admin/faq/shared`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SharedResponse;
}

async function updateSharedFaq(
  api: APIRequestContext,
  token: string,
  items: AdminFaqItem[],
  expectedVersion: number,
): Promise<{ version: number }> {
  const response = await api.put(`${API}/admin/faq/shared`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { items, expectedVersion },
  });
  expect(
    response.ok(),
    `shared FAQ PUT failed: ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as { version: number };
}

async function appendSharedItem(
  api: APIRequestContext,
  token: string,
  item: AdminFaqItem,
): Promise<SharedResponse> {
  const before = await getSharedFaq(api, token);
  await updateSharedFaq(api, token, [...before.items, item], before.version);
  return before;
}

async function replaceSharedItems(
  api: APIRequestContext,
  token: string,
  items: AdminFaqItem[],
): Promise<SharedResponse> {
  const before = await getSharedFaq(api, token);
  await updateSharedFaq(api, token, items, before.version);
  return before;
}

async function restoreSharedItems(
  api: APIRequestContext,
  token: string,
  items: AdminFaqItem[],
): Promise<void> {
  const current = await getSharedFaq(api, token);
  await updateSharedFaq(api, token, items, current.version);
}

async function loginInBrowser(
  page: Page,
  email: string = ADMIN_EMAIL,
): Promise<void> {
  // Next's dev-only fetch cache can otherwise survive FAQ writes between
  // scenarios. Ask the test server for current data, not its HMR snapshot.
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.locator("button[type=submit]").click();
  // A failed login leaves the page on /admin/login, so "somewhere under
  // /admin/" is not proof of success — the landing page must not be the
  // login form.
  await expect(page).toHaveURL(
    (url) =>
      url.pathname !== "/admin/login" &&
      (url.pathname === "/admin" || url.pathname.startsWith("/admin/")),
  );
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

function faqRoleGrants(mode: "grant" | "revoke"): void {
  execFileSync("pnpm", ["exec", "tsx", "prisma/e2e-faq-role-grants.ts", mode], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
}

function faqCardMediaPrepare(): void {
  execFileSync(
    "pnpm",
    ["exec", "tsx", "prisma/e2e-faq-card-media-prepare.ts"],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL },
      stdio: "inherit",
    },
  );
}

function metricNumber(text: string | null): number {
  const digits = (text ?? "").replace(/\D/g, "");
  expect(digits, `metric text "${text}" has no number`).not.toBe("");
  return Number(digits);
}

test.describe("FAQ closeout acceptance", () => {
  test.setTimeout(240_000);

  // FAQ writes PATCH the seeded ACTIVE products through the legacy branch,
  // which enforces the product-card readiness gate. A freshly seeded
  // database has no variant card media, so write the covers once before
  // any scenario (idempotent, test-only fixture).
  test.beforeAll(() => {
    faqCardMediaPrepare();
  });

  test("impact confirmation: cancel keeps the draft, confirm saves, failure keeps the draft", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const api = await request.newContext();
    const token = await login(api);
    const sharedBefore = await appendSharedItem(api, token, IMPACT_ITEM);
    const draftTitle = "E2E impact confirmation question (edited)?";

    try {
      await loginInBrowser(page);
      await page.goto("/admin/faq");
      await expect(
        page.getByRole("heading", { name: "FAQ 管理" }),
      ).toBeVisible();
      const sharedSection = page.getByRole("region", { name: "共享问题" });
      await expect(sharedSection.getByText(IMPACT_ITEM.title)).toBeVisible();

      // --- Cancel: the server is asked for impact, nothing is written. ---
      await sharedSection
        .getByRole("button", { name: `编辑 — ${IMPACT_ITEM.title}` })
        .click();
      const editor = page.getByRole("dialog", { name: "编辑共享问题" });
      await editor.getByLabel("问题").fill(draftTitle);
      const impactResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/admin/faq/shared/impact"),
      );
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      const { productCount } = (await (await impactResponse).json()) as {
        productCount: number;
      };
      const confirmation = page.getByRole("dialog", {
        name: "确认共享 FAQ 修改",
      });
      await expect(
        confirmation.getByText(`本次修改会更新 ${productCount} 个在售商品`, {
          exact: false,
        }),
      ).toBeVisible();
      await shot(page, "impact-confirm-dialog");
      await confirmation.getByRole("button", { name: "取消" }).click();

      const restoredEditor = page.getByRole("dialog", {
        name: "编辑共享问题",
      });
      await expect(restoredEditor.getByLabel("问题")).toHaveValue(draftTitle);
      expect(
        (await getSharedFaq(api, token)).items.find(
          (item) => item.id === IMPACT_ITEM.id,
        )?.title,
      ).toBe(IMPACT_ITEM.title);

      // --- Confirm: the exact draft is written once, after the preview. ---
      const writes: string[] = [];
      page.on("request", (request) => {
        if (
          request.url().includes("/api/v1/admin/faq/shared") &&
          request.method() !== "GET"
        ) {
          writes.push(
            request.url().endsWith("/impact")
              ? "impact"
              : `${request.method()} ${request.url()}`,
          );
        }
      });
      await restoredEditor
        .getByRole("button", { name: "保存", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "确认共享 FAQ 修改" })
        .getByRole("button", { name: "保存共享 FAQ" })
        .click();
      await expect(
        page.getByRole("dialog", { name: "编辑共享问题" }),
      ).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await getSharedFaq(api, token)).items.find(
              (item) => item.id === IMPACT_ITEM.id,
            )?.title,
        )
        .toBe(draftTitle);
      expect(writes[0]).toBe("impact");
      expect(writes.some((entry) => entry.startsWith("PUT"))).toBe(true);

      // --- Impact failure: the server message surfaces, draft stays, no write. ---
      await page.route("**/api/v1/admin/faq/shared/impact", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "E2E impact failure" }),
        }),
      );
      await sharedSection
        .getByRole("button", { name: `编辑 — ${draftTitle}` })
        .click();
      const failingEditor = page.getByRole("dialog", {
        name: "编辑共享问题",
      });
      const failingTitle = "E2E impact failure keeps this draft?";
      await failingEditor.getByLabel("问题").fill(failingTitle);
      await failingEditor
        .getByRole("button", { name: "保存", exact: true })
        .click();
      await expect(failingEditor.getByRole("alert")).toContainText(
        "E2E impact failure",
      );
      await expect(failingEditor.getByLabel("问题")).toHaveValue(failingTitle);
      await shot(page, "impact-failure-alert");
      await page.unroute("**/api/v1/admin/faq/shared/impact");
      expect(
        (await getSharedFaq(api, token)).items.find(
          (item) => item.id === IMPACT_ITEM.id,
        )?.title,
      ).toBe(draftTitle);

      expect(pageErrors).toEqual([]);
    } finally {
      await restoreSharedItems(api, token, sharedBefore.items);
      await api.dispose();
    }
  });

  test("impact succeeds but a concurrently changed library surfaces the named conflict", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const api = await request.newContext();
    const token = await login(api);
    const sharedBefore = await appendSharedItem(api, token, IMPACT_ITEM);
    const draftTitle = "E2E stale confirm should not write?";

    try {
      await loginInBrowser(page);
      await page.goto("/admin/faq");
      const sharedSection = page.getByRole("region", { name: "共享问题" });
      await sharedSection
        .getByRole("button", { name: `编辑 — ${IMPACT_ITEM.title}` })
        .click();
      const editor = page.getByRole("dialog", { name: "编辑共享问题" });
      await editor.getByLabel("问题").fill(draftTitle);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "确认共享 FAQ 修改" }),
      ).toBeVisible();

      // Another administrator saves the library between impact and confirm.
      const current = await getSharedFaq(api, token);
      await updateSharedFaq(api, token, current.items, current.version);

      await page
        .getByRole("dialog", { name: "确认共享 FAQ 修改" })
        .getByRole("button", { name: "保存共享 FAQ" })
        .click();

      const conflicted = page.getByRole("dialog", { name: "编辑共享问题" });
      await expect(
        conflicted.getByText("内容已在其他位置修改，请重新加载后再保存。"),
      ).toBeVisible();
      await shot(page, "impact-put-conflict");
      expect(
        (await getSharedFaq(api, token)).items.find(
          (item) => item.id === IMPACT_ITEM.id,
        )?.title,
      ).toBe(IMPACT_ITEM.title);

      await conflicted.getByRole("button", { name: "重新加载" }).click();
      await expect(
        page.getByRole("dialog", { name: "编辑共享问题" }),
      ).toHaveCount(0);
      await expect(sharedSection.getByText(IMPACT_ITEM.title)).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await restoreSharedItems(api, token, sharedBefore.items);
      await api.dispose();
    }
  });

  test("permission-split roles see exactly their FAQ section", async ({
    browser,
  }) => {
    const api = await request.newContext();
    const token = await login(api);
    const sharedBefore = await appendSharedItem(api, token, IMPACT_ITEM);
    const pageErrors: string[] = [];
    faqRoleGrants("grant");
    try {
      // Shared-only operator (OPTIMIZER + temporary shared permission).
      const sharedContext = await browser.newContext({
        baseURL: FRONTEND_ORIGIN,
      });
      const sharedPage = await sharedContext.newPage();
      pageErrors.push(...trackPageErrors(sharedPage));
      await loginInBrowser(sharedPage, OPTIMIZER_EMAIL);
      await sharedPage.goto("/admin/faq");
      await expect(
        sharedPage.getByRole("heading", { name: "FAQ 管理" }),
      ).toBeVisible();
      await expect(
        sharedPage.getByRole("region", { name: "共享问题" }),
      ).toBeVisible();
      await expect(
        sharedPage.getByRole("region", { name: "商品专属问题" }),
      ).toHaveCount(0);
      await expect(
        sharedPage.getByRole("button", { name: "新增共享 FAQ" }),
      ).toBeVisible();
      await expect(
        sharedPage.getByRole("button", { name: "新增商品专属 FAQ" }),
      ).toHaveCount(0);
      await shot(sharedPage, "role-shared-only");
      await sharedContext.close();

      // Product-only operator (WAREHOUSE + temporary product permission).
      const productContext = await browser.newContext({
        baseURL: FRONTEND_ORIGIN,
      });
      const productPage = await productContext.newPage();
      pageErrors.push(...trackPageErrors(productPage));
      await loginInBrowser(productPage, WAREHOUSE_EMAIL);
      await productPage.goto("/admin/faq");
      await expect(
        productPage.getByRole("region", { name: "商品专属问题" }),
      ).toBeVisible();
      await expect(
        productPage.getByRole("region", { name: "共享问题" }),
      ).toHaveCount(0);
      await expect(
        productPage.getByRole("button", { name: "新增共享 FAQ" }),
      ).toHaveCount(0);
      await shot(productPage, "role-product-only");
      await productContext.close();

      // Full operator (SUPER_ADMIN) keeps both sections.
      const fullContext = await browser.newContext({
        baseURL: FRONTEND_ORIGIN,
      });
      const fullPage = await fullContext.newPage();
      pageErrors.push(...trackPageErrors(fullPage));
      await loginInBrowser(fullPage, ADMIN_EMAIL);
      await fullPage.goto("/admin/faq");
      await expect(
        fullPage.getByRole("region", { name: "共享问题" }),
      ).toBeVisible();
      await expect(
        fullPage.getByRole("region", { name: "商品专属问题" }),
      ).toBeVisible();
      await fullContext.close();

      expect(pageErrors).toEqual([]);
    } finally {
      faqRoleGrants("revoke");
      await restoreSharedItems(api, token, sharedBefore.items);
      await api.dispose();
    }
  });

  test("ordering, unsaved preview, and CUSTOM copy reach the storefront", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const api = await request.newContext();
    const token = await login(api);
    const id = await productId(api, token, "e2e-color-size");
    const before = await getProduct(api, token, id);
    const original = before.faq ?? { mode: "SHARED", items: [], version: 0 };
    // Replace the library so the expected preview order is deterministic.
    const sharedBefore = await replaceSharedItems(api, token, [
      ORDER_SHARED_ITEM,
    ]);

    try {
      await patchProduct(api, token, id, {
        faq: {
          mode: "EXTEND",
          items: [PRODUCT_ITEM_ONE, PRODUCT_ITEM_TWO],
          expectedVersion: original.version,
        },
      });

      await loginInBrowser(page);
      await page.goto(`/admin/products/${id}/edit`);
      await page.getByRole("tab", { name: "FAQ" }).click();
      await expect(
        page.getByRole("heading", { name: "FAQ 与购买说明" }),
      ).toBeVisible();

      const savedPreview = page.getByRole("region", { name: "顾客预览" });
      await expect
        .poll(async () => savedPreview.locator("summary").allTextContents())
        .toEqual([
          ORDER_SHARED_ITEM.title,
          PRODUCT_ITEM_ONE.title,
          PRODUCT_ITEM_TWO.title,
        ]);

      // Move the first product question down; the draft preview follows.
      await page
        .locator("article")
        .filter({ hasText: "问题 1" })
        .getByRole("button", { name: "下移问题" })
        .click();
      const draftPreview = page.getByRole("region", {
        name: "未保存的顾客预览",
      });
      await expect
        .poll(async () => draftPreview.locator("summary").allTextContents())
        .toEqual([
          ORDER_SHARED_ITEM.title,
          PRODUCT_ITEM_TWO.title,
          PRODUCT_ITEM_ONE.title,
        ]);
      await shot(page, "product-draft-preview-order");

      // CUSTOM + copy-applicable-shared-questions appends a product-owned copy.
      await page.getByLabel("FAQ 使用方式").selectOption("CUSTOM");
      await page.getByRole("button", { name: "复制适用的共享问题" }).click();
      await expect
        .poll(async () => draftPreview.locator("summary").allTextContents())
        .toEqual([
          PRODUCT_ITEM_TWO.title,
          PRODUCT_ITEM_ONE.title,
          ORDER_SHARED_ITEM.title,
        ]);
      await shot(page, "product-custom-copy-preview");

      await page.getByRole("button", { name: "保存更改" }).click();
      await expect(page.getByText(/商品已保存/)).toBeVisible();

      await expect
        .poll(async () => (await getProduct(api, token, id)).faq?.mode)
        .toBe("CUSTOM");
      const saved = (await getProduct(api, token, id)).faq!;
      expect(saved.items.map((item) => item.title)).toEqual([
        PRODUCT_ITEM_TWO.title,
        PRODUCT_ITEM_ONE.title,
        ORDER_SHARED_ITEM.title,
      ]);
      const copied = saved.items.find(
        (item) => item.title === ORDER_SHARED_ITEM.title,
      )!;
      expect(copied.id).not.toBe(ORDER_SHARED_ITEM.id);

      await page.goto("/products/e2e-color-size");
      const storefrontFeedback = page.locator("#reviews");
      await storefrontFeedback.getByRole("tab", { name: /^Q&A \(/ }).click();
      await expect
        .poll(async () => storefrontFeedback.locator("summary").allTextContents())
        .toEqual([
          PRODUCT_ITEM_TWO.title,
          PRODUCT_ITEM_ONE.title,
          ORDER_SHARED_ITEM.title,
        ]);
      const main = page.getByRole("main");
      for (const title of [
        PRODUCT_ITEM_TWO.title,
        PRODUCT_ITEM_ONE.title,
        ORDER_SHARED_ITEM.title,
      ]) {
        await expect(main.getByText(title, { exact: true })).toBeVisible();
      }
      await expect(page.locator("#reviews:visible")).toHaveCount(1);
      await storefrontFeedback.scrollIntoViewIfNeeded();
      await shot(page, "storefront-custom-copy");

      const landing = await api.get(`${API}/storefront/lp/e2e-lp-color-size`);
      expect(landing.ok()).toBeTruthy();
      const composite = (await landing.json()) as {
        product: { effectiveFaq: AdminFaqItem[] };
      };
      expect(composite.product.effectiveFaq.map((item) => item.title)).toEqual([
        PRODUCT_ITEM_TWO.title,
        PRODUCT_ITEM_ONE.title,
        ORDER_SHARED_ITEM.title,
      ]);
      expect(JSON.stringify(composite.product.effectiveFaq)).not.toMatch(
        /audience|productIds|origin/,
      );
      await page.goto("/lp/e2e-lp-color-size");
      await expect
        .poll(async () => page.locator("#shipping-faq:visible summary").allTextContents())
        .toEqual([
          PRODUCT_ITEM_TWO.title,
          PRODUCT_ITEM_ONE.title,
          ORDER_SHARED_ITEM.title,
        ]);
      const landingFaq = page.locator("#shipping-faq:visible");
      await expect(landingFaq).toHaveCount(1);
      await landingFaq.scrollIntoViewIfNeeded();
      await shot(page, "landing-custom-copy");

      expect(pageErrors).toEqual([]);
    } finally {
      try {
        const current = await getProduct(api, token, id);
        await patchProduct(api, token, id, {
          faq: {
            mode: original.mode,
            items: original.items,
            expectedVersion: current.faq?.version ?? 0,
          },
        });
      } finally {
        // This scenario replaced the shared library outright, so the
        // restore must run even when the product restore above fails.
        await restoreSharedItems(api, token, sharedBefore.items);
        await api.dispose();
      }
    }
  });

  test("a saved product leaves the default list with authoritative totals", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const api = await request.newContext();
    const token = await login(api);
    const id = await productId(api, token, "e2e-exact-override");
    const before = await getProduct(api, token, id);
    const original = before.faq ?? { mode: "SHARED", items: [], version: 0 };

    try {
      await patchProduct(api, token, id, {
        faq: {
          mode: "CUSTOM",
          items: [MEMBERSHIP_ITEM],
          expectedVersion: original.version,
        },
      });

      await loginInBrowser(page);
      await page.goto("/admin/faq?view=product");
      const productSection = page.getByRole("region", {
        name: "商品专属问题",
      });
      const group = productSection
        .locator("details")
        .filter({ hasText: before.name })
        .first();
      await expect(group).toBeVisible();
      const metricBefore = metricNumber(
        await page.getByTestId("faq-product-count").textContent(),
      );

      // Remove the only question: mode stays CUSTOM, so it remains listed.
      await group.getByText(before.name).first().click();
      await group
        .getByRole("button", { name: `更多操作 — ${MEMBERSHIP_ITEM.title}` })
        .click();
      await page
        .getByRole("button", { name: `删除 — ${MEMBERSHIP_ITEM.title}` })
        .click();
      const deleteDialog = page.getByRole("dialog", {
        name: "删除这条问题？",
      });
      await deleteDialog
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await expect(group.getByText(MEMBERSHIP_ITEM.title)).toHaveCount(0);
      expect(
        metricNumber(await page.getByTestId("faq-product-count").textContent()),
      ).toBe(metricBefore);

      // Switching to the shared library empties its membership server-side.
      await page
        .getByRole("button", { name: `FAQ 设置 — ${before.name}` })
        .click();
      const settings = page.getByRole("dialog", { name: "FAQ 设置" });
      await settings.getByLabel("FAQ 使用方式").selectOption("SHARED");
      await settings.getByRole("button", { name: "保存设置" }).click();
      await expect(settings).toHaveCount(0);

      await expect
        .poll(async () =>
          metricNumber(
            await page.getByTestId("faq-product-count").textContent(),
          ),
        )
        .toBe(metricBefore - 1);
      await expect(productSection.getByText(before.name)).toHaveCount(0);
      await shot(page, "membership-refresh-after-save");
      await expect
        .poll(async () => (await getProduct(api, token, id)).faq?.mode)
        .toBe("SHARED");

      expect(pageErrors).toEqual([]);
    } finally {
      const current = await getProduct(api, token, id);
      await patchProduct(api, token, id, {
        faq: {
          mode: original.mode,
          items: original.items,
          expectedVersion: current.faq?.version ?? 0,
        },
      });
      await api.dispose();
    }
  });

  test("the impact confirmation fits a narrow viewport", async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await request.newContext();
    const token = await login(api);
    const sharedBefore = await appendSharedItem(api, token, IMPACT_ITEM);

    try {
      await loginInBrowser(page);
      await page.goto("/admin/faq");
      // Reserve scrollbar space as browsers with classic (non-overlay)
      // scrollbars do; the regression is visible there, not with overlay bars.
      await page.addStyleTag({
        content: '[role="dialog"] { scrollbar-gutter: stable; }',
      });
      await page
        .getByRole("region", { name: "共享问题" })
        .getByRole("button", { name: `编辑 — ${IMPACT_ITEM.title}` })
        .click();
      const editor = page.getByRole("dialog", { name: "编辑共享问题" });
      await editor.getByLabel("问题").fill("E2E mobile impact draft?");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      const confirmation = page.getByRole("dialog", {
        name: "确认共享 FAQ 修改",
      });
      await expect(confirmation).toBeVisible();
      const geometry = await confirmation.evaluate((element) => ({
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
      await shot(page, "mobile-impact-confirm");
      await confirmation.getByRole("button", { name: "取消" }).click();
      await expect(
        page.getByRole("dialog", { name: "编辑共享问题" }),
      ).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await restoreSharedItems(api, token, sharedBefore.items);
      await api.dispose();
    }
  });
});
