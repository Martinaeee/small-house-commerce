import { execFileSync } from "node:child_process";
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

const API = "http://127.0.0.1:3210/api/v1";
const SLUG = "e2e-color-only";
const ADMIN_EMAIL = "e2e-admin@smallhouse.test";
const ADMIN_PASSWORD = "E2eAdminPass123!";
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

assertE2EDatabaseUrl(DATABASE_URL);

test.use({ trace: "off" });

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(String(error)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const ITEM = {
  id: "99999999-9999-4999-8999-999999999999",
  title: "Does the compact cart fit a narrow hallway?",
  answer: [
    { kind: "paragraph", text: "Yes — measure the doorway before ordering." },
  ],
  enabled: true,
  position: 0,
  defaultOpen: true,
};

const LEGACY_SHARED_TITLE = "E2E legacy shared question without a timestamp?";

const SHARED_ITEM = {
  id: "88888888-8888-4888-8888-888888888888",
  title: "Does the shared delivery promise apply to this product?",
  answer: [
    { kind: "paragraph", text: "Yes — the shared delivery promise applies." },
  ],
  enabled: true,
  position: 99,
  defaultOpen: false,
};

type ProductResponse = {
  id: string;
  name: string;
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

async function login(api: APIRequestContext): Promise<string> {
  const response = await api.post(`${API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(
    response.ok(),
    `admin login failed: ${response.status()}`,
  ).toBeTruthy();
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function productId(
  api: APIRequestContext,
  token: string,
  slug: string = SLUG,
): Promise<string> {
  const response = await api.get(
    `${API}/admin/products?search=${slug}&pageSize=100`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
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
    `FAQ PATCH failed: ${await response.text()}`,
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
  items: unknown[],
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

async function storefrontProduct(
  api: APIRequestContext,
): Promise<Record<string, unknown>> {
  const response = await api.get(`${API}/storefront/products/${SLUG}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function loginInBrowser(page: Page): Promise<void> {
  // Next's dev-only fetch cache can otherwise survive FAQ writes between
  // scenarios. Ask the test server for current data, not its HMR snapshot.
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/(products|orders)/);
}

// FAQ writes PATCH the seeded ACTIVE products through the legacy branch,
// which enforces the product-card readiness gate. A freshly seeded database
// has no variant card media, so write the covers once before the first
// scenario (idempotent, test-only fixture).
test.beforeAll(() => {
  execFileSync("pnpm", ["exec", "tsx", "prisma/e2e-faq-card-media-prepare.ts"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
});

test("FAQ management lists, edits in dialogs, and stays one source of truth", async ({
  page,
}) => {
  const api = await request.newContext();
  const token = await login(api);
  const id = await productId(api, token);
  const before = await getProduct(api, token, id);
  const productContext = `商品: ${before.productCode ?? "未分配编码"} · ${before.name}`;
  const original = before.faq ?? { mode: "SHARED", items: [], version: 0 };
  const sharedBefore = await getSharedFaq(api, token);
  let sharedChanged = false;

  try {
    const saved = await patchProduct(api, token, id, {
      faq: { mode: "CUSTOM", items: [ITEM], expectedVersion: original.version },
    });
    expect(saved.faq).toMatchObject({
      mode: "CUSTOM",
      version: original.version + 1,
    });

    const sharedSaved = await updateSharedFaq(
      api,
      token,
      [...sharedBefore.items, SHARED_ITEM],
      sharedBefore.version,
    );
    sharedChanged = true;
    expect(sharedSaved.version).toBe(sharedBefore.version + 1);

    await loginInBrowser(page);
    await page.goto("/admin/faq");

    // The page opens on the structure, not on a wall of inputs.
    await expect(page.getByRole("heading", { name: "FAQ 管理" })).toBeVisible();
    const toolbar = page.getByRole("toolbar", { name: "FAQ 操作" });
    await expect(
      toolbar.getByRole("button", { name: "新增共享 FAQ" }),
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "新增商品专属 FAQ" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "全部 FAQ" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const sharedSection = page.getByRole("region", { name: "共享问题" });
    await expect(sharedSection.getByText(SHARED_ITEM.title)).toBeVisible();
    await expect(sharedSection.getByText("未分类")).toBeVisible();
    // The prep fixture resets one dedicated legacy row on every invocation;
    // UI saves in other scenarios may legitimately timestamp all echoed rows.
    const legacyRow = sharedSection
      .getByRole("row")
      .filter({ hasText: LEGACY_SHARED_TITLE });
    await expect(legacyRow.getByText("未记录")).toBeVisible();
    await expect(sharedSection.getByRole("textbox")).toHaveCount(0);

    // Edit a shared question through the dialog; the list itself is read-only.
    const newSharedTitle = "Can I contact support before ordering?";
    await sharedSection
      .getByRole("button", { name: `编辑 — ${SHARED_ITEM.title}` })
      .click();
    const sharedDialog = page.getByRole("dialog", { name: "编辑共享问题" });
    await expect(sharedDialog.getByLabel("问题")).toHaveValue(
      SHARED_ITEM.title,
    );
    await sharedDialog.getByLabel("问题").fill(newSharedTitle);
    await sharedDialog.getByLabel("分类").selectOption("DELIVERY");
    const sharedWrite = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/faq/shared") &&
        response.request().method() === "PUT",
    );
    await sharedDialog
      .getByRole("button", { name: "保存", exact: true })
      .click();
    // Shared saves confirm the server-calculated impact before the PUT.
    await page
      .getByRole("dialog", { name: "确认共享 FAQ 修改" })
      .getByRole("button", { name: "保存共享 FAQ" })
      .click();
    expect((await sharedWrite).ok()).toBeTruthy();
    await expect(sharedDialog).not.toBeVisible();
    await expect(sharedSection.getByText(newSharedTitle)).toBeVisible();
    await expect(sharedSection.getByText("配送与签收")).toBeVisible();

    const sharedAfterUi = await getSharedFaq(api, token);
    expect(sharedAfterUi.version).toBe(sharedSaved.version + 1);
    expect(sharedAfterUi.items).toContainEqual(
      expect.objectContaining({ title: newSharedTitle, category: "DELIVERY" }),
    );
    // The shared edit must not have touched the product row.
    expect((await getProduct(api, token, id)).faq).toEqual(saved.faq);

    // The product group opens as a list of questions, not a form.
    const productSection = page.getByRole("region", { name: "商品专属问题" });
    const productRow = productSection
      .locator("details")
      .filter({ hasText: before.name });
    await expect(productRow).toBeVisible();
    await productRow.getByText(before.name).click();
    await expect(
      productRow.getByRole("button", { name: `编辑 — ${ITEM.title}` }),
    ).toBeVisible();

    const newProductTitle = "Is this cart delivered assembled?";
    await productRow
      .getByRole("button", { name: `编辑 — ${ITEM.title}` })
      .click();
    const productDialog = page.getByRole("dialog", { name: "编辑商品问题" });
    await expect(productDialog.getByText(productContext)).toBeVisible();
    await productDialog.getByLabel("问题").fill(newProductTitle);
    const productWrite = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/products/${id}`) &&
        response.request().method() === "PATCH",
    );
    await productDialog
      .getByRole("button", { name: "保存", exact: true })
      .click();
    expect((await productWrite).ok()).toBeTruthy();
    await expect(productDialog).not.toBeVisible();
    await expect(productRow.getByText(newProductTitle)).toBeVisible();

    const productAfterUi = await getProduct(api, token, id);
    expect(productAfterUi.faq?.version).toBe(saved.faq!.version + 1);
    expect(productAfterUi.faq?.items).toContainEqual(
      expect.objectContaining({ title: newProductTitle }),
    );
    // And the product edit must not have touched the shared library.
    expect(await getSharedFaq(api, token)).toEqual(sharedAfterUi);

    // Add a second product question through the picker -> editor flow.
    const addedTitle = "How long does assembly take?";
    await toolbar.getByRole("button", { name: "新增商品专属 FAQ" }).click();
    const picker = page.getByRole("dialog", { name: "选择商品" });
    await picker.getByLabel("搜索商品").fill(SLUG);
    await picker
      .getByRole("button", {
        name: new RegExp(before.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .click();
    const addDialog = page.getByRole("dialog", { name: "新增商品问题" });
    await expect(addDialog.getByText(productContext)).toBeVisible();
    await addDialog.getByLabel("问题").fill(addedTitle);
    await addDialog.getByLabel(/^回答/).pressSequentially("About ten minutes.");
    const addWrite = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/products/${id}`) &&
        response.request().method() === "PATCH",
    );
    await addDialog.getByRole("button", { name: "保存", exact: true }).click();
    expect((await addWrite).ok()).toBeTruthy();
    await expect(addDialog).not.toBeVisible();
    await expect(productRow.getByText(addedTitle)).toBeVisible();

    const withBoth = await getProduct(api, token, id);
    expect(withBoth.faq?.items).toHaveLength(2);

    await page.reload();
    const reloadedRow = page
      .getByRole("region", { name: "商品专属问题" })
      .locator("details")
      .filter({ hasText: before.name });
    await reloadedRow.getByText(before.name).click();
    await expect(reloadedRow.getByText(addedTitle)).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "共享问题" })
        .getByText(newSharedTitle),
    ).toBeVisible();

    // The storefront renders the same data: CUSTOM shows only product questions.
    const publicProduct = await storefrontProduct(api);
    const effective = publicProduct.effectiveFaq as Array<{ title: string }>;
    expect(effective.map((item) => item.title)).toEqual([
      newProductTitle,
      addedTitle,
    ]);
    await page.goto(`/products/${SLUG}`);
    const storefrontMain = page.getByRole("main");
    await storefrontMain.getByRole("tab", { name: /^Q&A \(/ }).click();
    await expect(
      storefrontMain.getByText(newProductTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      storefrontMain.getByText(addedTitle, { exact: true }),
    ).toBeVisible();

    // The product editor keeps its shortcut and warns before leaving a draft.
    await page.goto(`/admin/products/${id}/edit`);
    // FAQ has its own tab beside Preview; Basic Info no longer carries it.
    await expect(
      page.getByRole("heading", { name: "FAQ 与购买说明" }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "FAQ" }).click();
    await expect(
      page.getByRole("heading", { name: "FAQ 与购买说明" }),
    ).toBeVisible();
    await expect(page.getByLabel("FAQ 使用方式")).toHaveValue("CUSTOM");
    await expect(
      page.getByRole("heading", { name: "应用的共享问题" }),
    ).toBeVisible();
    await expect(
      page.getByText("当前为“仅商品专属”，共享问题不会展示。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "在 FAQ 管理中打开" }),
    ).toBeVisible();
    await expect(
      page
        .locator('section[aria-labelledby="product-faq-title"] input')
        .evaluateAll(
          (inputs, title) =>
            inputs.some((input) => (input as HTMLInputElement).value === title),
          newProductTitle,
        ),
    ).resolves.toBe(true);
  } finally {
    const current = await getProduct(api, token, id);
    await patchProduct(api, token, id, {
      faq: {
        mode: original.mode,
        items: original.items,
        expectedVersion: current.faq?.version ?? original.version + 1,
      },
    });
    if (sharedChanged) {
      const sharedCurrent = await getSharedFaq(api, token);
      await updateSharedFaq(
        api,
        token,
        sharedBefore.items,
        sharedCurrent.version,
      );
    }
    await api.dispose();
  }
});

test("a targeted shared question reaches only its selected products", async ({
  page,
}) => {
  const api = await request.newContext();
  const token = await login(api);
  // Products the first scenario never visited: `next dev` caches PDP data
  // fetches per URL, so reusing a cached product would test the cache, not the
  // audience rule.
  const targets = ["e2e-size-only", "e2e-exact-override"];
  const control = "e2e-color-size";
  const targetIds: string[] = [];
  for (const slug of targets) targetIds.push(await productId(api, token, slug));
  const controlId = await productId(api, token, control);
  const allIds = [...targetIds, controlId];
  const before = new Map<string, ProductResponse>();
  for (const id of allIds) before.set(id, await getProduct(api, token, id));
  const sharedBefore = await getSharedFaq(api, token);
  const title = "Which carts ship with a folding tray?";
  let created = false;

  try {
    // All three products inherit the shared library for this scenario; the
    // control product must not be CUSTOM or the negative check proves nothing.
    for (const id of allIds) {
      const current = await getProduct(api, token, id);
      const faq = current.faq ?? { mode: "SHARED", items: [], version: 0 };
      if (faq.mode !== "SHARED") {
        await patchProduct(api, token, id, {
          faq: {
            mode: "SHARED",
            items: faq.items,
            expectedVersion: faq.version,
          },
        });
      }
    }

    await loginInBrowser(page);
    await page.goto("/admin/faq");
    await page.getByRole("button", { name: "新增共享 FAQ" }).click();
    const dialog = page.getByRole("dialog", { name: "新增共享问题" });
    await dialog.getByLabel("问题").fill(title);
    await dialog
      .getByLabel(/^回答/)
      .pressSequentially("Only the selected products show this question.");
    await dialog.getByRole("radio", { name: "指定商品" }).check();
    await dialog.getByLabel("搜索商品").fill("e2e-");
    for (const slug of targets) {
      const row = dialog.locator("li").filter({ hasText: `/${slug}` });
      await row.getByRole("checkbox").check();
    }
    const write = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/faq/shared") &&
        response.request().method() === "PUT",
    );
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    // Shared saves confirm the server-calculated impact before the PUT.
    await page
      .getByRole("dialog", { name: "确认共享 FAQ 修改" })
      .getByRole("button", { name: "保存共享 FAQ" })
      .click();
    expect((await write).ok()).toBeTruthy();
    created = true;

    const sharedAfter = await getSharedFaq(api, token);
    expect(sharedAfter.items).toContainEqual(
      expect.objectContaining({
        title,
        audience: { scope: "PRODUCTS", productIds: targetIds },
      }),
    );
    // The list marks the narrowed scope instead of implying "all products".
    await expect(
      page
        .getByRole("region", { name: "共享问题" })
        .getByText("2 个商品")
        .first(),
    ).toBeVisible();

    // The storefront renders it on exactly the selected products.
    for (const slug of targets) {
      await page.goto(`/products/${slug}`);
      await page.getByRole("tab", { name: /^Q&A \(/ }).click();
      await expect(
        page.getByRole("main").getByText(title, { exact: true }),
      ).toBeVisible();
    }
    await page.goto(`/products/${control}`);
    await page.getByRole("tab", { name: /^Q&A \(/ }).click();
    await expect(
      page.getByRole("main").getByText(title, { exact: true }),
    ).toHaveCount(0);

    // The product editor preview filters by its own product too.
    await page.goto(`/admin/products/${targetIds[0]}/edit`);
    await page.getByRole("tab", { name: "FAQ" }).click();
    await expect(
      page.getByRole("heading", { name: "应用的共享问题" }),
    ).toBeVisible();
    // The customer preview below renders the same question through the
    // storefront component, so scope the assertion to the applicable list.
    await expect(
      page.getByRole("listitem").filter({ hasText: title }),
    ).toBeVisible();
    await page.goto(`/admin/products/${controlId}/edit`);
    await page.getByRole("tab", { name: "FAQ" }).click();
    await expect(
      page.getByRole("heading", { name: "应用的共享问题" }),
    ).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
  } finally {
    if (created) {
      const sharedNow = await getSharedFaq(api, token);
      await updateSharedFaq(api, token, sharedBefore.items, sharedNow.version);
    }
    for (const id of allIds) {
      const original = before.get(id)!;
      const current = await getProduct(api, token, id);
      const faq = original.faq ?? { mode: "SHARED", items: [], version: 0 };
      await patchProduct(api, token, id, {
        faq: {
          mode: faq.mode,
          items: faq.items,
          expectedVersion: current.faq?.version ?? 0,
        },
      });
    }
    await api.dispose();
  }
});

test("shared FAQ audience editor fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginInBrowser(page);
  await page.goto("/admin/faq");
  // Reserve scrollbar space as browsers with classic (non-overlay) scrollbars
  // do. The regression was visible there, but not with headless overlay bars.
  await page.addStyleTag({ content: '[role="dialog"] { scrollbar-gutter: stable; }' });
  await page.getByRole("button", { name: "新增共享 FAQ" }).click();
  const dialog = page.getByRole("dialog", { name: "新增共享问题" });
  await dialog.getByLabel("问题").fill("Assembly for selected products?");
  await dialog.getByLabel(/^回答/).fill("Instructions are included.");
  await dialog.getByRole("radio", { name: "指定商品" }).check();
  await dialog.getByRole("checkbox", { name: "E2E Exact Override Bench" }).check();
  await dialog.getByRole("checkbox", { name: "E2E Size Only Rack" }).check();
  const geometry = await dialog.evaluate((element) => ({
    width: element.clientWidth, contentWidth: element.scrollWidth,
    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  }));
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
});

test("duplicates a product question through the row menu", async ({ page }) => {
  const api = await request.newContext();
  const token = await login(api);
  const id = await productId(api, token);
  const before = await getProduct(api, token, id);
  const original = before.faq ?? { mode: "SHARED", items: [], version: 0 };
  const copyTitle = `${ITEM.title}（副本）`;

  try {
    const current = await getProduct(api, token, id);
    await patchProduct(api, token, id, {
      faq: {
        mode: "CUSTOM",
        items: [ITEM],
        expectedVersion: current.faq?.version ?? 0,
      },
    });

    await loginInBrowser(page);
    await page.goto(`/admin/faq?view=product&product=${id}`);
    const productSection = page.getByRole("region", { name: "商品专属问题" });
    const group = productSection
      .locator("details")
      .filter({ hasText: before.name });
    await group.getByText(before.name).click();
    const questionRow = group.locator("tr").filter({ hasText: ITEM.title });
    await questionRow
      .getByRole("button", { name: `更多操作 — ${ITEM.title}` })
      .click();
    await page.getByRole("button", { name: `复制 — ${ITEM.title}` }).click();

    const dialog = page.getByRole("dialog", { name: "新增商品问题" });
    await expect(dialog.getByLabel("问题")).toHaveValue(copyTitle);
    // Nothing is written until the dialog is saved.
    expect((await getProduct(api, token, id)).faq?.items).toHaveLength(1);

    const write = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/products/${id}`) &&
        response.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    expect((await write).ok()).toBeTruthy();

    const after = await getProduct(api, token, id);
    expect(after.faq?.items.map((item) => item.title)).toEqual([
      ITEM.title,
      copyTitle,
    ]);
    await expect(group.getByText(copyTitle)).toBeVisible();
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
