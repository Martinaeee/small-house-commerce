/**
 * Task 14 — real-browser acceptance for the Storefront Shell / Brand Editor.
 *
 * Runs against the plan-owned runtime (backend 127.0.0.1:3230, frontend
 * localhost:3231) with the dedicated `small_house_marketing_dev` database.
 * Fixtures are created once per gate run by global setup and restored by global
 * teardown, so worker restarts after an assertion failure do not delete the
 * accounts or lose the original shell snapshot.
 *
 *   pnpm --dir small-house-commerce/frontend exec playwright test \
 *     --config ../../.superpowers/sdd/2026-10-12-storefront-shell-brand-editor/\
 * runtime/playwright.storefront-shell.config.ts e2e/storefront-shell.spec.ts --workers=1
 *
 * The admin login route throttles ten requests per ten minutes per IP. A normal
 * single-worker run spends exactly two form logins (SUPER_ADMIN and ADMIN) and
 * keeps both refresh tokens only inside their browser contexts.
 */
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  SHELL_GATE_ASSETS,
  SHELL_GATE_PLAIN,
  SHELL_GATE_SCREENSHOTS_DIR,
  SHELL_GATE_SUPER,
  runShellFixtures,
} from "./storefront-shell-prepare";

const ADMIN_EDITOR = "/admin/storefront-shell";
const PUBLIC_PRODUCT = "/products/marketing-browser-chair";
const PUBLIC_LANDING = "/lp/shell-gate-landing";
const SHELL_GATE_NAV_LABEL = "Shell Gate Nav";

/** Per-test fixtures. */
type GateFixtures = {
  superPage: Page;
  plainPage: Page;
  anonPage: Page;
};

/** Worker-scoped fixtures: one sign-in per account and one anonymous context. */
type GateWorkerFixtures = {
  superContext: BrowserContext;
  plainContext: BrowserContext;
  anonContext: BrowserContext;
};

type ConsoleSink = { errors: string[] };

const consoleSinks = new WeakMap<Page, ConsoleSink>();
const allConsoleErrors: string[] = [];

function watchPage(page: Page): void {
  const sink: ConsoleSink = { errors: [] };
  consoleSinks.set(page, sink);
  const record = (message: string) => {
    sink.errors.push(message);
    allConsoleErrors.push(message);
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const source = location.url
      ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
      : page.url();
    record(`${message.text()} @ ${source}`);
  });
  page.on("pageerror", (error) =>
    record(`pageerror @ ${page.url()}: ${error.message}`),
  );
}

function pageErrors(page: Page): string[] {
  return consoleSinks.get(page)?.errors ?? [];
}

async function consumeExpectedHttpConsoleError(
  page: Page,
  status: number,
  path: string,
): Promise<void> {
  const matches = (message: string) =>
    message.includes(`status of ${status}`) && message.includes(path);
  await expect
    .poll(() => pageErrors(page).findIndex(matches), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(0);

  const sink = consoleSinks.get(page);
  const localIndex = sink?.errors.findIndex(matches) ?? -1;
  if (!sink || localIndex < 0) return;
  const expected = sink.errors.splice(localIndex, 1)[0]!;
  const globalIndex = allConsoleErrors.indexOf(expected);
  if (globalIndex >= 0) allConsoleErrors.splice(globalIndex, 1);
}

const ADMIN_SHELL = { name: "Admin navigation" } as const;

async function formLogin(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto("/admin/login");
  // The form is inert until hydration finishes; submitting earlier leaves the
  // page on /admin/login with no request sent.
  await page.waitForLoadState("networkidle");
  await page.locator("input[type=email]").fill(account.email);
  await page.locator("input[type=password]").fill(account.password);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 30_000 });
  // The session token lands in localStorage only after the post-login round
  // trip settles. Navigating before that aborts the write and the next page
  // load finds no session at all.
  await page.waitForFunction(
    () => window.localStorage.getItem("sh_admin_refresh") !== null,
    undefined,
    { timeout: 30_000 },
  );
}

/** Opens one signed-in browser context without exporting its refresh token. */
async function signedInContext(
  browser: Browser,
  account: { email: string; password: string },
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const authTraffic: string[] = [];
  page.on("response", (response) => {
    if (/\/auth\/(login|refresh|me|logout)/.test(response.url())) {
      authTraffic.push(`${response.status()} ${response.url().split("/api/v1")[1]}`);
    }
  });

  await formLogin(page, account);
  const ready = await page
    .getByRole("navigation", ADMIN_SHELL)
    .first()
    .isVisible({ timeout: 30_000 })
    .catch(() => false);
  if (ready) {
    await page.close();
    return context;
  }

  const diagnostic = await page.evaluate(() => ({
    url: location.href,
    localKeys: Object.keys(window.localStorage),
    railNav: Boolean(document.querySelector('nav[aria-label="Admin navigation"]')),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 160),
  }));
  await page.close();
  throw new Error(
    `signed-in shell never appeared for ${account.email}; auth traffic: ${authTraffic.join(", ") || "none"}; page: ${JSON.stringify(diagnostic)}`,
  );
}

const test = base.extend<GateFixtures, GateWorkerFixtures>({
  superContext: [
    async ({ browser }, provide) => {
      const context = await signedInContext(browser, SHELL_GATE_SUPER);
      await provide(context);
      await context.close();
    },
    { scope: "worker" } as const,
  ],
  plainContext: [
    async ({ browser }, provide) => {
      const context = await signedInContext(browser, SHELL_GATE_PLAIN);
      await provide(context);
      await context.close();
    },
    { scope: "worker" } as const,
  ],
  anonContext: [
    async ({ browser }, provide) => {
      const context = await browser.newContext();
      await provide(context);
      await context.close();
    },
    { scope: "worker" } as const,
  ],
  superPage: async ({ superContext }, provide) => {
    const page = await superContext.newPage();
    watchPage(page);
    await provide(page);
    await page.close();
  },
  plainPage: async ({ plainContext }, provide) => {
    const page = await plainContext.newPage();
    watchPage(page);
    await provide(page);
    await page.close();
  },
  anonPage: async ({ anonContext }, provide) => {
    const page = await anonContext.newPage();
    watchPage(page);
    await provide(page);
    await page.close();
  },
});

/** Reads the public shell payload through the storefront proxy. */
async function publicShell(page: Page): Promise<{
  publishedRevision: number;
  brand: { brandName: string; horizontalLogo: { url: string } | null; squareMark: { url: string } | null };
  header: { items: { id: string; label: string }[] };
  theme: Record<string, string>;
  derivedTheme: { actionForeground: string };
}> {
  const response = await page.request.get("/api/v1/storefront/shell");
  expect(response.ok(), "public shell read").toBeTruthy();
  return response.json();
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(ADMIN_EDITOR);
  await expect(page.getByTestId("storefront-shell-publish-bar")).toBeVisible();
  // Any settled status is fine: an earlier scenario may have left a saved but
  // unpublished draft behind.
  await expect(page.getByLabel("品牌名称")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("shell-version")).toBeVisible();
}

async function openTab(
  page: Page,
  tab: "品牌与主题" | "页眉" | "页脚",
): Promise<void> {
  await page.getByRole("button", { name: tab, exact: true }).click();
}

async function uploadBrand(page: Page, slot: "横向 Logo（桌面页眉与页脚）" | "方形标识（手机页眉、站点图标与开屏）", file: string): Promise<void> {
  await page.getByLabel(slot).setInputFiles(file);
}

/** Waits for the publish bar to settle out of a transient status. */
async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/品牌图片上传中|正在保存草稿|正在发布|正在检查草稿/)).toHaveCount(0, {
    timeout: 30_000,
  });
}

/**
 * Captures the meaningful hydrated public DOM in a clean browser context.
 * Next's streamed response can move metadata and RSC script chunks between
 * requests without changing what a shopper sees, so compare the shared
 * Header/main/Footer plus published theme tokens after hydration instead of
 * comparing non-canonical flight bytes.
 */
async function publicSurfaceSnapshot(
  browser: Browser,
  path: string,
): Promise<{ header: string; main: string; footer: string; theme: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  watchPage(page);
  try {
    const response = await page.goto(path);
    expect(response?.status(), `${path} status`).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    // BootSplash unmounts 600 ms after its hydration effect. Waiting for that
    // node to leave is a deterministic "client tree is hydrated" signal; a
    // merely visible server-rendered <main> can still have input attributes
    // reconciled underneath us.
    await expect(page.locator("#boot-splash")).toHaveCount(0, {
      timeout: 30_000,
    });
    const phone = page.locator("#quick-cod-phone");
    if ((await phone.count()) > 0) {
      await expect(phone).toHaveAttribute("type", "tel", { timeout: 30_000 });
    }
    return await page.evaluate(() => {
      const stableDom = (selector: string): string => {
        const source = document.querySelector(selector);
        if (!source) return "";
        const serialize = (node: Node): string => {
          if (node.nodeType === Node.COMMENT_NODE) return "";
          if (node.nodeType === Node.TEXT_NODE) {
            return `#text(${JSON.stringify(node.textContent ?? "")})`;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return "";
          const element = node as Element;
          if (
            element.tagName === "TEMPLATE" &&
            element.id.startsWith("B:")
          ) {
            return "";
          }
          const attributes = [...element.attributes]
            .map(({ name, value }) => [name, value] as const)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
            .join(" ");
          const children = [...element.childNodes].map(serialize).join("");
          const tag = element.tagName.toLowerCase();
          return `<${tag}${attributes ? ` ${attributes}` : ""}>${children}</${tag}>`;
        };
        return serialize(source);
      };
      return {
        header: stableDom("header"),
        main: stableDom("main"),
        footer: stableDom("footer"),
        theme:
          document.querySelector("style#storefront-theme-tokens")?.textContent ??
          "",
      };
    });
  } finally {
    await context.close();
  }
}

function expectSameSurface(
  actual: Awaited<ReturnType<typeof publicSurfaceSnapshot>>,
  expected: Awaited<ReturnType<typeof publicSurfaceSnapshot>>,
  label: string,
): void {
  for (const key of ["header", "main", "footer", "theme"] as const) {
    if (actual[key] === expected[key]) continue;
    let index = 0;
    while (
      index < actual[key].length &&
      index < expected[key].length &&
      actual[key][index] === expected[key][index]
    ) {
      index += 1;
    }
    const from = Math.max(0, index - 100);
    throw new Error(
      `${label}.${key} changed at ${index}; before=${JSON.stringify(expected[key].slice(from, index + 180))}; after=${JSON.stringify(actual[key].slice(from, index + 180))}`,
    );
  }
}

test.describe("storefront shell gate", () => {
  test("1. Website navigation is visible to SUPER_ADMIN and hidden from ADMIN", async ({
    superPage,
    plainPage,
  }) => {
    await superPage.goto("/admin/products");
    await expect(superPage.getByRole("link", { name: "页眉与页脚" })).toBeVisible();
    await expect(superPage.getByText("网站", { exact: true }).first()).toBeVisible();

    await plainPage.goto("/admin/products");
    // Wait for auth hydration before asserting an absent permission-gated link;
    // otherwise "zero links" also matches the loading skeleton and a following
    // navigation can abort refresh-token rotation.
    await expect(
      plainPage.getByRole("navigation", ADMIN_SHELL).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(plainPage.getByRole("link", { name: "页眉与页脚" })).toHaveCount(0);

    await plainPage.goto(ADMIN_EDITOR);
    await expect(plainPage.getByText("没有页眉与页脚管理权限。")).toBeVisible();
  });

  test("2. Local edits and real uploads move only the inert preview", async ({
    superPage,
    anonPage,
  }) => {
    const before = await publicShell(anonPage);
    await openEditor(superPage);

    await superPage.getByLabel("品牌名称").fill("Gate Draft Brand");
    await uploadBrand(superPage, "横向 Logo（桌面页眉与页脚）", SHELL_GATE_ASSETS.horizontal);
    await settle(superPage);

    await expect(superPage.getByText("有未保存的本地修改")).toBeVisible();
    const canvas = superPage.getByTestId("storefront-shell-preview-canvas");
    await expect(canvas.getByLabel("Gate Draft Brand home")).toBeVisible();
    await expect(canvas.locator("img").first()).toBeVisible();
    await superPage.screenshot({
      path: `${SHELL_GATE_SCREENSHOTS_DIR}/editor-header-desktop.png`,
      fullPage: true,
    });

    const after = await publicShell(anonPage);
    expect(after.publishedRevision).toBe(before.publishedRevision);
    expect(after.brand.brandName).toBe(before.brand.brandName);
    expect(after.brand.horizontalLogo).toEqual(before.brand.horizontalLogo);
  });

  test("3. Public Homepage and PDP stay DOM-equivalent across a draft save", async ({
    browser,
    superPage,
    anonPage,
  }) => {
    const shellBefore = await publicShell(anonPage);
    const homeBefore = await publicSurfaceSnapshot(browser, "/");
    const pdpBefore = await publicSurfaceSnapshot(browser, PUBLIC_PRODUCT);

    await openEditor(superPage);
    await superPage.getByLabel("品牌名称").fill("Gate Saved Brand");
    await superPage.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(superPage.getByText("草稿已保存，等待发布")).toBeVisible({ timeout: 30_000 });

    expect(await publicShell(anonPage)).toEqual(shellBefore);
    expectSameSurface(
      await publicSurfaceSnapshot(browser, "/"),
      homeBefore,
      "homepage",
    );
    expectSameSurface(
      await publicSurfaceSnapshot(browser, PUBLIC_PRODUCT),
      pdpBefore,
      "pdp",
    );
  });

  test("4. A pending upload locks save, publish and restore, then resolves", async ({
    superPage,
  }) => {
    await openEditor(superPage);
    let release: (() => void) | undefined;
    let confirmIntercepted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      confirmIntercepted = resolve;
    });
    await superPage.route(
      (url) =>
        url.pathname === "/api/v1/admin/storefront-shell/upload",
      async (route) => {
        confirmIntercepted?.();
        await gate;
        await route.continue();
      },
    );

    await uploadBrand(superPage, "方形标识（手机页眉、站点图标与开屏）", SHELL_GATE_ASSETS.square);
    await intercepted;
    await expect(superPage.getByText("品牌图片上传中")).toBeVisible();
    await expect(superPage.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    await expect(superPage.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
    await expect(superPage.getByRole("button", { name: "恢复默认" })).toBeDisabled();
    await expect(superPage.getByLabel("横向 Logo（桌面页眉与页脚）")).toBeDisabled();

    release?.();
    await settle(superPage);
    await expect(superPage.getByLabel("横向 Logo（桌面页眉与页脚）")).toBeEnabled();
    await expect(superPage.getByText("有未保存的本地修改")).toBeVisible();
  });

  test("5. Saving a draft changes neither the public revision nor the favicon", async ({
    superPage,
    anonPage,
  }) => {
    const revisionBefore = (await publicShell(anonPage)).publishedRevision;
    const etagBefore = (await anonPage.request.get("/brand-mark")).headers()["etag"];

    await openEditor(superPage);
    await superPage.getByLabel("品牌名称").fill("Gate Draft Only");
    await superPage.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(superPage.getByText("草稿已保存，等待发布")).toBeVisible({ timeout: 30_000 });

    expect((await publicShell(anonPage)).publishedRevision).toBe(revisionBefore);
    expect((await anonPage.request.get("/brand-mark")).headers()["etag"]).toBe(etagBefore);
  });

  test("6. The saved-draft preview renders the server draft and is private", async ({
    superPage,
    anonPage,
  }) => {
    const posts: string[] = [];
    superPage.on("request", (request) => {
      if (request.method() !== "GET" && /cart|checkout|orders|track/.test(request.url())) {
        posts.push(request.url());
      }
    });

    const [previewResponse] = await Promise.all([
      superPage.waitForResponse((response) =>
        response.url().includes("/api/v1/admin/storefront-shell/preview"),
      ),
      superPage.goto("/admin/storefront-shell/preview"),
    ]);
    expect(previewResponse.status()).toBe(200);
    // The admin API carries a bearer token minted in memory, so the response is
    // captured from the page's own request rather than replayed via
    // `page.request`, which would arrive unauthenticated.
    expect(previewResponse.headers()["cache-control"]).toContain("no-store");
    const html = await superPage.content();
    expect(html).toContain('name="robots"');
    expect(html).toMatch(/noindex/);
    expect(posts).toEqual([]);

    // The route is not public: an anonymous visitor is sent to the admin login.
    await anonPage.goto("/admin/storefront-shell/preview");
    await expect(anonPage).toHaveURL(/\/admin\/login/);
  });

  test("7. A stale client keeps its local work and sees the 409 conflict", async ({
    superContext,
    superPage,
  }) => {
    const stale = await superContext.newPage();
    watchPage(stale);
    await openEditor(superPage);
    await openEditor(stale);

    await stale.getByLabel("品牌名称").fill("Gate Stale Client");
    await stale.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(stale.getByText("草稿已保存，等待发布")).toBeVisible({ timeout: 30_000 });

    await superPage.getByLabel("品牌名称").fill("Gate Winning Client");
    await superPage.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(superPage.getByText("服务器草稿已被其他人更新。你的本地修改仍然保留。")).toBeVisible({
      timeout: 30_000,
    });
    await expect(superPage.getByLabel("品牌名称")).toHaveValue("Gate Winning Client");
    await consumeExpectedHttpConsoleError(
      superPage,
      409,
      "/api/v1/admin/storefront-shell",
    );
    await stale.close();
  });

  test("8. A contrast-invalid draft saves but cannot publish", async ({ superPage, anonPage }) => {
    const revisionBefore = (await publicShell(anonPage)).publishedRevision;
    await openEditor(superPage);
    // The theme palette, including the text colour, lives in the brand tab.
    await openTab(superPage, "品牌与主题");
    const textColor = superPage.getByLabel("文字色", { exact: true });
    await textColor.fill("#faf8f5");
    await superPage.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(superPage.getByText("草稿已保存，等待发布")).toBeVisible({ timeout: 30_000 });

    await expect(superPage.getByText(/草稿还有 \d+ 项需要处理。/)).toBeVisible({ timeout: 30_000 });
    await expect(superPage.getByTestId("theme-issues")).toContainText(/CONTRAST/);
    await superPage.screenshot({
      path: `${SHELL_GATE_SCREENSHOTS_DIR}/invalid-contrast.png`,
      fullPage: true,
    });

    // The bar lets the click through; the server refuses and the draft stays
    // unpublished.
    await superPage.getByRole("button", { name: "发布", exact: true }).click();
    await expect(superPage.getByRole("alert").first()).toBeVisible({ timeout: 30_000 });
    expect((await publicShell(anonPage)).publishedRevision).toBe(revisionBefore);
    await consumeExpectedHttpConsoleError(
      superPage,
      422,
      "/api/v1/admin/storefront-shell/publish",
    );

    // Hand the next scenario a publishable draft: restore the readable colour
    // and save it, so the contrast failures do not outlive this test. When this
    // scenario runs alone, that restoration makes draft and publication equal;
    // in the full serial gate, earlier scenarios may leave other draft changes.
    await textColor.fill("#222222");
    const [restored] = await Promise.all([
      superPage.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/api/v1/admin/storefront-shell"),
      ),
      superPage.getByRole("button", { name: "保存草稿", exact: true }).click(),
    ]);
    expect(restored.status()).toBe(200);
    await expect(
      superPage.getByRole("button", { name: "保存草稿", exact: true }),
    ).toBeDisabled();
    await expect(superPage.getByTestId("theme-issues")).not.toContainText(/CONTRAST/, {
      timeout: 30_000,
    });
  });

  test("9. A valid publish moves every published surface and the brand mark", async ({
    superPage,
    anonPage,
  }) => {
    const before = await publicShell(anonPage);
    const etagBefore = (await anonPage.request.get("/brand-mark")).headers()["etag"];

    await openEditor(superPage);
    // Brand name, both logo slots and the theme palette live in the brand tab.
    await openTab(superPage, "品牌与主题");
    await superPage.getByLabel("品牌名称").fill("Gate Published Brand");
    await uploadBrand(superPage, "横向 Logo（桌面页眉与页脚）", SHELL_GATE_ASSETS.horizontal);
    await settle(superPage);
    await uploadBrand(superPage, "方形标识（手机页眉、站点图标与开屏）", SHELL_GATE_ASSETS.square);
    await settle(superPage);
    await superPage.getByLabel("主色", { exact: true }).fill("#1d4ed8");
    // This green remains distinguishable from the page while requiring the
    // dark derived CTA foreground; it catches hard-coded white labels and a
    // hover derivation that darkens toward its own foreground.
    await superPage.getByLabel("按钮色", { exact: true }).fill("#5fa046");
    // A published nav item that points at a fixture target, so scenario 10 can
    // take that target offline and watch it leave the public read.
    await openTab(superPage, "页眉");
    await superPage.getByLabel("新增导航项类型").selectOption({ label: "集合" });
    await superPage.getByLabel("选择指向对象").selectOption({ label: "Shell Gate Collection" });
    const rows = superPage.locator('[data-testid^="header-row-"]');
    const rowsBefore = await rows.count();
    await superPage.getByRole("button", { name: "添加", exact: true }).click();
    await expect(rows).toHaveCount(rowsBefore + 1);
    // An empty label is invalid for publication, so the new item gets one.
    await rows.last().getByLabel("显示标签").fill(SHELL_GATE_NAV_LABEL);
    await openTab(superPage, "页脚");
    await superPage.getByLabel("页脚品牌说明").fill("Gate published tagline");
    const [saved] = await Promise.all([
      superPage.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/api/v1/admin/storefront-shell"),
      ),
      superPage.getByRole("button", { name: "保存草稿", exact: true }).click(),
    ]);
    const savedBody = (await saved.json()) as {
      issues?: { code: string; path: string[]; message: string }[];
    };
    expect(savedBody.issues ?? [], "valid draft save issues").toEqual([]);
    await expect(superPage.getByText("草稿已保存，等待发布")).toBeVisible({ timeout: 30_000 });

    await superPage.getByRole("button", { name: "发布", exact: true }).click();
    await expect(superPage.getByText("已发布最新版本")).toBeVisible({ timeout: 60_000 });

    const after = await publicShell(anonPage);
    expect(after.publishedRevision).toBe(before.publishedRevision + 1);
    expect(after.brand.brandName).toBe("Gate Published Brand");
    expect(after.brand.horizontalLogo?.url).toBeTruthy();
    expect(after.brand.squareMark?.url).toBeTruthy();
    expect(after.theme.primary).toBe("#1d4ed8");
    expect(after.theme.action).toBe("#5fa046");
    expect(after.derivedTheme.actionForeground).toBe("#222222");

    const freshBrandMark = await anonPage.request.get("/brand-mark");
    expect(freshBrandMark.status()).toBe(200);
    expect(
      freshBrandMark.headers()["etag"],
      `brand mark stayed stale across revision ${before.publishedRevision} -> ${after.publishedRevision}`,
    ).not.toBe(etagBefore);

    const brandMark = await anonPage.request.get("/brand-mark", {
      headers: etagBefore ? { "If-None-Match": etagBefore } : undefined,
    });
    expect(brandMark.status()).toBe(200);
    expect(brandMark.headers()["etag"]).toBe(freshBrandMark.headers()["etag"]);
    expect(brandMark.headers()["content-type"]).toContain("image/png");
    expect([...(await brandMark.body()).subarray(0, 4)]).toEqual([
      137, 80, 78, 71,
    ]);

    await anonPage.setViewportSize({ width: 1440, height: 900 });
    await anonPage.goto("/");
    await expect(anonPage.locator("header")).toBeVisible();
    await expect(anonPage.locator("footer")).toBeVisible();
    const renderedTheme = await anonPage.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const footer = getComputedStyle(document.querySelector("footer")!);
      const newsletterHeading = getComputedStyle(
        document.querySelector('[data-testid="newsletter-band"] h2')!,
      );
      const probe = document.createElement("button");
      probe.className = "bg-cta text-cta-foreground";
      document.body.append(probe);
      const probeStyle = getComputedStyle(probe);
      const result = {
        actionForeground: root.getPropertyValue("--color-cta-foreground").trim(),
        footerBackgroundToken: root
          .getPropertyValue("--color-footer-background")
          .trim(),
        footerBackground: footer.backgroundColor,
        footerForeground: footer.color,
        newsletterForeground: newsletterHeading.color,
        ctaBackground: probeStyle.backgroundColor,
        ctaForeground: probeStyle.color,
      };
      probe.remove();
      return result;
    });
    expect(renderedTheme).toEqual({
      actionForeground: "#222222",
      footerBackgroundToken: "#5fa046",
      footerBackground: "rgb(95, 160, 70)",
      footerForeground: "rgb(34, 34, 34)",
      newsletterForeground: "rgb(34, 34, 34)",
      ctaBackground: "rgb(95, 160, 70)",
      ctaForeground: "rgb(34, 34, 34)",
    });
    await anonPage.screenshot({
      path: `${SHELL_GATE_SCREENSHOTS_DIR}/live-shell-desktop.png`,
      fullPage: true,
    });
    await anonPage.setViewportSize({ width: 390, height: 844 });
    await anonPage.goto("/");
    await expect(anonPage.locator("header")).toBeVisible();
    await anonPage.screenshot({
      path: `${SHELL_GATE_SCREENSHOTS_DIR}/live-shell-mobile.png`,
      fullPage: true,
    });
  });

  test("10. An offline linked target disappears from the next public read", async ({
    anonPage,
  }) => {
    const before = await publicShell(anonPage);
    expect(before.publishedRevision).toBeGreaterThan(1);
    expect(JSON.stringify(before)).toContain(SHELL_GATE_NAV_LABEL);

    runShellFixtures("targets-off");
    const after = await publicShell(anonPage);
    runShellFixtures("targets-on");

    expect(after.publishedRevision).toBe(before.publishedRevision);
    expect(JSON.stringify(after)).not.toContain(SHELL_GATE_NAV_LABEL);
    // Only that item left: every other published header item is intact.
    expect(after.header.items.length).toBe(before.header.items.length - 1);
  });

  test("11. Every public surface shares one revision and theme", async ({ anonPage }) => {
    const shell = await publicShell(anonPage);
    const surfaces = [
      "/",
      "/collections",
      "/search?q=chair",
      PUBLIC_PRODUCT,
      PUBLIC_LANDING,
      "/cart",
      "/login",
      "/track-order",
    ];
    for (const path of surfaces) {
      const response = await anonPage.goto(path);
      expect(response!.status(), `${path} status`).toBeLessThan(400);
      const html = await anonPage.content();
      expect(html, `${path} brand`).toContain(shell.brand.brandName);
    }
    await anonPage.goto("/checkout");
    expect((await anonPage.content()).length).toBeGreaterThan(0);
  });

  test("12. The mega menu and the mobile drawer stay interactive", async ({ anonPage }) => {
    await anonPage.setViewportSize({ width: 1440, height: 900 });
    await anonPage.goto("/");
    const nav = anonPage.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    // Desktop tree items open their mega panel on hover; plain links have none.
    const tree = nav.locator("[data-nav-root]").first();
    await expect(tree).toBeVisible();
    await tree.hover();
    await expect(anonPage.getByRole("region").first()).toBeVisible();

    await anonPage.setViewportSize({ width: 390, height: 844 });
    await anonPage.goto("/");
    await anonPage.getByRole("button", { name: "Open menu" }).click();
    await expect(anonPage.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    await anonPage.getByRole("button", { name: "Close menu" }).click();
    await expect(anonPage.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  });

  test("13. The editor preview is inert", async ({ superPage }) => {
    const mutations: string[] = [];
    superPage.on("request", (request) => {
      if (request.method() !== "GET") mutations.push(`${request.method()} ${request.url()}`);
    });
    await openEditor(superPage);
    const canvas = superPage.getByTestId("storefront-shell-preview-canvas");
    await expect(canvas).toBeVisible();

    // The draft preview carries no checkout form and no order-affecting control;
    // activating whatever it does render writes nothing anywhere.
    expect(await canvas.locator("form").count()).toBe(0);
    const links = canvas.locator("a");
    const linkCount = await links.count();
    for (let index = 0; index < linkCount; index += 1) {
      await links.nth(index).dispatchEvent("click").catch(() => undefined);
    }
    expect(mutations.filter((entry) => /cart|orders|track|checkout/.test(entry))).toEqual([]);
  });

  test("14. No root overflow and no clipped editor field at 390/768/1280/1440", async ({
    superPage,
  }) => {
    await openEditor(superPage);
    for (const width of [390, 768, 1280, 1440]) {
      await superPage.setViewportSize({ width, height: 900 });
      // Every iteration starts on the brand tab; a previous one may have
      // switched tabs to reach a header or footer field.
      await openTab(superPage, "品牌与主题");
      const overflow = await superPage.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `root width at ${width}`).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );
      await expect(superPage.getByLabel("品牌名称")).toBeVisible();
      if (width === 390 || width === 1280) {
        // The logo actions must stay one line each: no wrapped single
        // character, no vertical text and no overflowing label.
        const uploadButtons = superPage.getByRole("button", {
          name: /^(选择图片|更换图片)$/,
        });
        const buttonCount = await uploadButtons.count();
        expect(buttonCount, `upload buttons at ${width}`).toBeGreaterThan(0);
        for (let index = 0; index < buttonCount; index += 1) {
          const metrics = await uploadButtons.nth(index).evaluate((node) => {
            const style = getComputedStyle(node);
            return {
              whiteSpace: style.whiteSpace,
              height: node.getBoundingClientRect().height,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
            };
          });
          expect(metrics.whiteSpace, `upload button nowrap at ${width}`).toBe(
            "nowrap",
          );
          expect(
            metrics.height,
            `upload button single line at ${width}`,
          ).toBeLessThan(40);
          expect(
            metrics.scrollWidth,
            `upload button overflow at ${width}`,
          ).toBeLessThanOrEqual(metrics.clientWidth + 1);
        }
      }
      if (width === 1280) {
        await openTab(superPage, "页眉");
        const targetWidth = await superPage
          .getByLabel("选择指向对象")
          .evaluate((node) => node.getBoundingClientRect().width);
        expect(targetWidth, "header target width at 1280").toBeGreaterThanOrEqual(
          120,
        );
      }
      if (width === 390) {
        await openTab(superPage, "页脚");
        await superPage.screenshot({
          path: `${SHELL_GATE_SCREENSHOTS_DIR}/editor-footer-mobile.png`,
          fullPage: true,
        });
      }
    }
  });

  test("15. The whole journey logged zero unexpected console and page errors", async ({
    superPage,
    plainPage,
    anonPage,
  }) => {
    expect(pageErrors(superPage)).toEqual([]);
    expect(pageErrors(plainPage)).toEqual([]);
    expect(pageErrors(anonPage)).toEqual([]);
    expect(allConsoleErrors).toEqual([]);
  });
});
