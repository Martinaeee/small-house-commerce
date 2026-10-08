import {
  request as playwrightRequest,
  expect,
  test,
  type Page,
  type Request,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";
import { emptyDocument, type HomepageDocument } from "../src/lib/homepage-document";

/**
 * Homepage Builder P1 — Task 22: real-browser acceptance for the three-pane
 * visual editor, the publish/schedule/restore workflow, the token-gated draft
 * preview and the storefront switches (HeroSlider v2 + AnnouncementBar v2).
 *
 * Runs against the same guarded stack as the other e2e specs: the worktree
 * backend (:3210) + storefront frontend (:3211) pointed at the disposable
 * `small_house_variant_test` database. Nothing here may touch production.
 *
 * Session budget: POST /auth/login is throttled to 10 / 10 min per IP and the
 * pre-existing suites already spend that budget, so this spec NEVER calls the
 * login endpoint. Instead it seeds a `refresh_tokens` row out-of-band (same
 * inline `tsx -e` DB pattern already used by `admin-product-editor.spec.ts`)
 * and exchanges it through `POST /auth/refresh` (throttled at 30 / 10 min) to
 * mint the access token AND a rotation-ready refresh token. Browser pages get
 * the stored-session seeding (`localStorage["sh_admin_refresh"]`) exactly like
 * `openEditorWithStoredSession()`, and the app's own rotation chain keeps the
 * module cache fresh.
 *
 * Storefront assertions read the BACKEND at 127.0.0.1:3210 directly where
 * possible: `next dev` masks Cache-Control headers and can answer a cached
 * body (Next 16 dev fetch cache stickeriness), so page-render assertions that
 * must be fresh go through a request context that sends `Cache-Control: no-cache`
 * to the dev origin (the only header `next dev` honors for revalidation).
 */

const API = "http://127.0.0.1:3210/api/v1";
const FRONTEND = "http://localhost:3211";

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
assertE2EDatabaseUrl(E2E_DATABASE_URL);

const E2E_ADMIN_EMAIL = "e2e-admin@smallhouse.test";
// Family for the out-of-band seeded refresh row — never collides with rows
// the app creates (real logins use their own families).
const SEED_FAMILY = "00000000-0000-7000-8000-0000000000ad";

/**
 * The same fixed >= 32-char TEST secret as playwright.config.ts
 * (`BACKEND_ENV.HOMEPAGE_PREVIEW_SECRET`). Needed to craft covers tokens
 * (expired / wrong-scope) that the backend would only ever mint under a secret
 * we control. Production never reuses this value.
 */
const PREVIEW_SECRET = "e2e-homepage-preview-secret-0123456789abcdef";
const PREVIEW_SCOPE = "homepage-draft-preview";
const MEDIA_URL = "/uploads/e2e/color-only-shared-1.svg";

/**
 * The migrated version v1 (seeded by the `add_homepage_document_versions`
 * migration) and the content that migration writes into its document. On a
 * freshly recreated database the legacy `homepage_sections` tables are empty
 * at migration time, so v1 carries NO hero section — this announcement item
 * (deterministic id + copy from the migration SQL) is the migrated content
 * the version routes must round-trip.
 */
const MIGRATED_VERSION_NO = 1;
const MIGRATED_ANNOUNCEMENT_ID = "00000000-0000-7000-8000-0000000000a1";
const MIGRATED_ANNOUNCEMENT_FRAGMENT = "Free Metro Manila delivery on orders";
/**
 * uuid v7 (RFC 9562): version nibble 7, variant bits 10xx. This is the exact
 * shape `ParseUUIDPipe({ version: "7" })` accepts on EVERY `/versions/:id`
 * route (detail / restore / unpublish), matching Prisma's `@default(uuid(7))`
 * for app-published versions.
 */
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const zh = {
  saveDraft: "保存草稿",
  saved: "已保存",
  previewDraft: "预览草稿",
  publish: "发布",
  versions: "版本历史",
  livePreview: "实时预览",
  settings: "设置",
  headingText: "文案",
  xPct: "X（%）",
  yPct: "Y（%）",
  confirmWarnings: "确认风险并发布",
  publishSuccess: "已发布版本",
  versionPreview: "预览",
  versionRestore: "恢复到草稿",
  versionRestoreSuccess: "已恢复到草稿，发布后生效。",
  confirm: "确认",
  cancel: "取消",
  previewBanner: "草稿预览 · 未发布",
};

let adminAccessToken: string | null = null;
let adminRefreshToken: string | null = null;

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// --- admin session (zero-login: seeded refresh row + refresh exchange) ------

/**
 * Wipes the out-of-band seed family for the e2e admin and inserts one fresh
 * refresh-token row, printing the raw token to stdout (the ONLY consumer).
 * Runs through the backend's tsx so the generated Prisma client and the
 * `PrismaPg` adapter are available — the same inline pattern as
 * `admin-product-editor.spec.ts` fixture cleanup.
 */
function seedAdminRefreshRow(): string {
  const script = `
    import { createHash, randomBytes, randomUUID } from 'node:crypto';
    import { PrismaPg } from '@prisma/adapter-pg';
    import { PrismaClient } from './src/generated/prisma/client.ts';
    import { assertE2EDatabaseUrl } from '../frontend/src/lib/e2e-guard.ts';
    async function main() {
      assertE2EDatabaseUrl(process.env.DATABASE_URL);
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
      try {
        const user = await prisma.user.findUnique({
          where: { email: process.env.SEED_EMAIL },
          select: { id: true },
        });
        if (!user) throw new Error('e2e admin missing — run prisma seed first');
        await prisma.refreshToken.deleteMany({ where: { userId: user.id, familyId: process.env.SEED_FAMILY } });
        const token = randomBytes(48).toString('base64url');
        await prisma.refreshToken.create({
          data: {
            userId: user.id,
            familyId: process.env.SEED_FAMILY,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        process.stdout.write('SEED_TOKEN=' + token + '\\n');
      } finally {
        await prisma.$disconnect();
      }
    }
    main().catch((error) => { console.error(error); process.exit(1); });
  `;
  const out = execFileSync("pnpm", ["exec", "tsx", "-e", script], {
    cwd: resolve(__dirname, "../../backend"),
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      SEED_EMAIL: E2E_ADMIN_EMAIL,
      SEED_FAMILY,
    },
    encoding: "utf8",
  });
  const match = /SEED_TOKEN=([A-Za-z0-9_-]{16,})/.exec(out);
  expect(match, `seeded refresh token printed: ${out.slice(0, 200)}`).not.toBeNull();
  const token = match![1];
  return token;
}

/**
 * Exchange the seeded refresh row for an access token + a NEW refresh token
 * (which then feeds the browser stored-session chain). One call per run: the
 * access token lives an hour and the refresh token rotates.
 */
async function bootstrapAdminSession(): Promise<void> {
  const context = await playwrightRequest.newContext();
  try {
    const seed = seedAdminRefreshRow();
    const response = await context.post(`${API}/auth/refresh`, {
      data: { refreshToken: seed },
    });
    expect(
      response.ok(),
      `auth refresh from seeded row (${response.status()}): ${await response.text()}`,
    ).toBeTruthy();
    const body = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    adminAccessToken = body.accessToken;
    adminRefreshToken = body.refreshToken;
  } finally {
    await context.dispose();
  }
}

let bootstrapPromise: Promise<void> | null = null;
async function ensureAdminAuth(): Promise<void> {
  if (adminAccessToken !== null) return;
  // Fail-safe: if a previous bootstrap rotated everything away, re-seed.
  bootstrapPromise ??= (async () => {
    try {
      await bootstrapAdminSession();
    } catch (error) {
      bootstrapPromise = null;
      throw error;
    }
  })();
  await bootstrapPromise;
}

async function withAdmin<T>(
  run: (token: string, context: Awaited<ReturnType<typeof playwrightRequest.newContext>>) => Promise<T>,
): Promise<T> {
  await ensureAdminAuth();
  const context = await playwrightRequest.newContext();
  try {
    return await run(adminAccessToken as string, context);
  } finally {
    await context.dispose();
  }
}

async function adminGet<T>(path: string): Promise<T> {
  return withAdmin(async (token, context) => {
    const response = await context.get(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), `admin GET ${path} (${response.status()})`).toBeTruthy();
    return (await response.json()) as T;
  });
}

async function adminPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return withAdmin(async (token, context) => {
    const response = await context.post(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: body ?? {},
    });
    expect(response.ok(), `admin POST ${path} (${response.status()}): ${await response.text()}`).toBeTruthy();
    const text = await response.text();
    return text.trim() === "" ? (undefined as T) : (JSON.parse(text) as T);
  });
}

type DraftSnapshot = {
  draft: HomepageDocument;
  draftRev: number;
  published: { versionNo: number; publishAt: string } | null;
};

async function getDraft(): Promise<DraftSnapshot> {
  return adminGet<DraftSnapshot>("/admin/homepage/draft");
}

async function putDraft(snapshot: DraftSnapshot): Promise<void> {
  const current = await getDraft();
  await withAdmin(async (token, context) => {
    const response = await context.put(`${API}/admin/homepage/draft`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { draft: snapshot.draft, expectedRev: current.draftRev },
    });
    expect(response.ok(), `restore draft (${response.status()}): ${await response.text()}`).toBeTruthy();
  });
}

async function unpublishVersion(versionNo: number): Promise<void> {
  const versions = await adminGet<
    { id: string; versionNo: number; unpublishAt: string | null }[]
  >("/admin/homepage/versions");
  const version = versions.find((candidate) => candidate.versionNo === versionNo);
  if (!version || version.unpublishAt !== null) return;
  await adminPost(`/admin/homepage/versions/${version.id}/unpublish`);
}

async function restoreHomepageSnapshot(
  snapshot: DraftSnapshot,
  publishedVersionNo: number | null,
): Promise<void> {
  if (publishedVersionNo !== null) await unpublishVersion(publishedVersionNo);
  await putDraft(snapshot);
}

/**
 * Saves a draft whose hero is valid to publish: media (SVG served from the
 * E2E backend uploads), heading text, and EXTERNAL https CTA links so the
 * publish gate returns no errors and no CTA warnings. Section announcement is
 * left untouched. If the draft has NO hero (a freshly recreated database at
 * migration time has zero sections until the editor saves one), the default
 * document's hero is spliced in — it is schema-identical to what the editor
 * would create.
 */
async function savePublishableDraft(heading: string): Promise<void> {
  const snapshot = await getDraft();
  const doc = snapshot.draft;
  let hero = doc.sections.find((section) => section.type === "HERO");
  if (!hero) {
    const defaults = emptyDocument();
    hero = defaults.sections.find((section) => section.type === "HERO")!;
    doc.sections.unshift({
      ...hero,
      id: cryptoRandomUuid(),
      sortOrder: 0,
    });
    doc.sections = doc.sections.map((section, index) => ({ ...section, sortOrder: index * 10 }));
    // The splice removed hero-less defaults; announcement stays as it is.
  }
  const slide = hero.payload.slides[0];
  slide.name = "E2E slide";
  slide.elements.heading.text = heading;
  slide.media = {
    type: "IMAGE" as const,
    image: { url: MEDIA_URL, alt: "E2E hero media" },
    video: null,
    mobileOverride: { enabled: false, image: null, video: null },
    fit: "COVER" as const,
    focal: { x: 50, y: 50 },
    objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
  };
  for (const key of ["ctaPrimary", "ctaSecondary"] as const) {
    slide.elements[key].link = { type: "EXTERNAL" as const, url: `https://example.com/${key}` };
  }
  await withAdmin(async (token, context) => {
    const response = await context.put(`${API}/admin/homepage/draft`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { draft: doc, expectedRev: snapshot.draftRev },
    });
    expect(response.ok(), `PUT draft (${response.status()}): ${await response.text()}`).toBeTruthy();
  });
}

function publishableHeroHeading(
  snapshot: DraftSnapshot,
): string | null {
  const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
  return hero?.payload?.slides?.[0]?.elements?.heading?.text ?? null;
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

// --- stored-session browser helpers -----------------------------------------

/**
 * Seeds the stored admin refresh token then opens an admin route. Returns the
 * ROTATED refresh token the app wrote into localStorage (the seeded token is
 * revoked on first use, exactly like `openEditorWithStoredSession`).
 */
async function openAdmin(page: Page, path: string): Promise<void> {
  // Guarantee a cached session exists (the caller may never have used the API).
  await withAdmin(async () => undefined);
  expect(adminRefreshToken, "cached admin session").not.toBeNull();
  const seed = adminRefreshToken as string;
  await page.addInitScript((token) => {
    const marker = "sh:e2e-hp-refresh-seeded";
    if (window.sessionStorage.getItem(marker) === "1") return;
    window.localStorage.setItem("sh_admin_refresh", token);
    window.sessionStorage.setItem(marker, "1");
  }, seed);
  await navigateAdmin(page, path);
}

/**
 * Navigates to an admin route on an already-authenticated page and keeps the
 * module session token in lockstep with the app: every admin navigation
 * consumes the stored refresh token and rotates it, so the module cache is
 * re-read from localStorage after each navigation (otherwise the next
 * scenario would seed a now-revoked token).
 */
async function navigateAdmin(page: Page, path: string): Promise<void> {
  // Pre-goto read of the current stored token keeps a long-lived page's
  // rotation chain in the module cache. The read can fail on the very first
  // page driver bytes (about:blank is an opaque origin for localStorage).
  try {
    const live = await page.evaluate(() => window.localStorage.getItem("sh_admin_refresh"));
    if (live) adminRefreshToken = live;
  } catch {
    // about:blank or an in-flight navigation; the seed/navigation below is
    // authoritative for this page anyway.
  }
  await page.goto(`${FRONTEND}${path}`);
  // The AdminShell renders its `<nav aria-label="Admin navigation">` (desktop
  // rail first, mobile drawer behind it) only while authed; on the login page
  // there is no nav at all. Attachment (not visibility) keeps this work at
  // every viewport: the rail is `hidden` below `md` and the drawer needs the
  // hamburger to open.
  await expect(page.locator('nav[aria-label="Admin navigation"]').first()).toBeAttached({
    timeout: 30_000,
  });
  // By nav render time the app has already consumed and rotated the stored
  // refresh token, so the value in localStorage is the newest valid one.
  const rotated = await page.evaluate(() => window.localStorage.getItem("sh_admin_refresh"));
  expect(rotated, "admin refresh token rotated").toBeTruthy();
  adminRefreshToken = rotated;
}

/** Waits for the builder shell: status bar + the three panes rendered. */
async function openBuilder(page: Page): Promise<void> {
  await openAdmin(page, "/admin/homepage");
  await expect(page.getByRole("button", { name: zh.saveDraft })).toBeVisible();
  await expect(page.locator('[data-pane="modules"]')).toBeAttached();
  await expect(page.locator('[data-pane="preview"]')).toBeAttached();
  await expect(page.locator('[data-pane="settings"]')).toBeAttached();
}

/**
 * The preview/settings panes live in the DeviceFrame grid above 1280px and
 * behind the tab switcher below it. This helper makes the PREVIEW pane the
 * visible one for the current viewport.
 */
async function revealPreviewPane(page: Page, viewportWidth: number): Promise<void> {
  if (viewportWidth < 1280) {
    await page.getByRole("tab", { name: zh.livePreview }).click();
  }
  await expect(page.locator('[data-hero-element="heading"]')).toBeAttached();
}

/** Selects a hero element on the canvas, opening its settings group. */
async function selectHeroElement(page: Page, key: string): Promise<void> {
  await page.locator(`[data-hero-element="${key}"]`).click({ force: true, timeout: 30_000 });
  await expect(page.locator(`[data-panel="settings-panel"]`)).toBeVisible();
}

/** Reads the hero heading text straight from the backend draft. */
async function draftHeroHeading(): Promise<string | null> {
  return publishableHeroHeading(await getDraft());
}

/** Polls the backend storefront contract until the hero heading matches. */
async function waitForStorefrontHeading(
  heading: string,
  timeoutMs = 15_000,
): Promise<void> {
  await expect
    .poll(async () => {
      const context = await playwrightRequest.newContext();
      try {
        const response = await context.get(`${API}/storefront/homepage`);
        expect(response.ok()).toBeTruthy();
        const body = (await response.json()) as {
          sections: { type: string; payload: { slides: { elements: { heading: { text: string } } }[] } }[];
        };
        const hero = body.sections.find((section) => section.type === "HERO");
        return hero?.payload?.slides?.[0]?.elements?.heading?.text ?? null;
      } finally {
        await context.dispose();
      }
    }, { timeout: timeoutMs, message: `storefront hero should serve "${heading}"` })
    .toBe(heading);
}

/** The dev server honors `Cache-Control: no-cache` and re-fetches the origin
 * (documented Next 16 dev fetch-cache behavior), so page-render assertions use
 * it to defeat the sticky cache. */
async function freshPageHtml(url: string): Promise<string> {
  const context = await playwrightRequest.newContext({
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
  });
  try {
    const response = await context.get(url);
    expect(response.ok(), `GET ${url} (${response.status()})`).toBeTruthy();
    return await response.text();
  } finally {
    await context.dispose();
  }
}

async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(
    metrics.docScroll,
    `${label}: document scrollWidth ${metrics.docScroll} > clientWidth ${metrics.docClient}`,
  ).toBeLessThanOrEqual(metrics.docClient + 1);
  expect(
    metrics.bodyScroll,
    `${label}: body scrollWidth ${metrics.bodyScroll} > clientWidth ${metrics.docClient}`,
  ).toBeLessThanOrEqual(metrics.docClient + 1);
}

/** Retries `read` until it returns a truthy value (bounded), for values that
 * only appear after a React render/commit. */
async function pollValue<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  let last: T | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = await read();
    if (last !== null && last !== 0 && last !== "") return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`pollValue: never settled for ${label}; last=${String(last)}`);
}

function collectConsoleIssues(page: Page): () => { errors: string[]; pageErrors: string[] } {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(`pageerror: ${error.message}`);
  });
  return () => ({ errors, pageErrors });
}

function isTrackingRequest(request: Request): boolean {
  return /facebook|fbevents|\/tr\b|\/pixel\b|beacon/i.test(request.url());
}

// --- preview token crafting (for expired / wrong-scope cases) ---------------

function signToken(overrides: Partial<{ scope: string; draftRev: number; exp: number }>): string {
  const payload = Buffer.from(
    JSON.stringify({
      scope: PREVIEW_SCOPE,
      draftRev: 1,
      exp: Date.now() + 30 * 60 * 1000,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", PREVIEW_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test.describe("homepage builder (P1 Task 22)", () => {
  test("the migrated version v1 stays addressable through the uuid-v7 version routes", async ({ page }) => {
    // Regression guard for the migration seed: `add_homepage_document_versions`
    // writes version v1 with a DETERMINISTIC uuid v7 id (same convention as the
    // singleton document id). Every `/versions/:id` route validates
    // `ParseUUIDPipe({ version: "7" })`, so a non-v7 seed — e.g.
    // `gen_random_uuid()`, which is v4 — makes detail/restore/unpublish answer
    // 400 `Validation failed (uuid v7 is expected)` for the migrated row.
    // The rest of this suite only ever restores app-published v7 versions, so
    // this scenario is the ONLY guard against that regression. It is read-only
    // on purpose (no draft PUT, no publish, no restore/unpublish): the shared
    // uuid gate is what all three routes enforce, so the detail 200 plus the
    // id assertion pin them without mutating any state, which keeps the
    // scenario order-independent for the write scenarios that follow.
    const versions = await adminGet<
      { id: string; versionNo: number; note: string | null }[]
    >("/admin/homepage/versions");
    const migrated = versions.find((row) => row.versionNo === MIGRATED_VERSION_NO);
    expect(migrated, `migrated version v${MIGRATED_VERSION_NO} is listed`).toBeTruthy();
    expect(migrated!.note ?? "", "migrated row note").toContain("Migrated");

    // The live regression surface: the detail route must answer 200 for the
    // migrated id. Inline `withAdmin` (not `adminGet`) so the failure message
    // carries the response body — the exact ParseUUIDPipe error on RED.
    const detail = await withAdmin(async (token, context) => {
      const response = await context.get(
        `${API}/admin/homepage/versions/${migrated!.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(
        response.ok(),
        `GET migrated version detail (${response.status()}): ${await response.text()}`,
      ).toBeTruthy();
      return (await response.json()) as {
        versionNo: number;
        document: HomepageDocument;
      };
    });

    // The id itself satisfies the uuid-v7 gate shared by detail/restore/unpublish.
    expect(migrated!.id, "migrated version id is a uuid v7").toMatch(UUID_V7);
    expect(detail.versionNo).toBe(MIGRATED_VERSION_NO);
    // The migrated document round-trips: schemaVersion plus the announcement
    // item the migration SQL writes (the only seeded content on a fresh db).
    expect(detail.document.schemaVersion).toBe(1);
    const migratedItem = detail.document.announcement.items.find(
      (item) => item.id === MIGRATED_ANNOUNCEMENT_ID,
    );
    expect(migratedItem, "migrated announcement item present").toBeTruthy();
    expect(migratedItem!.text).toContain(MIGRATED_ANNOUNCEMENT_FRAGMENT);

    // The user-visible failure mode: the versions-page 预览 dialog must render
    // the migrated document instead of the load-error alert.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page, "/admin/homepage/versions");
    const row = page.locator(`tr[data-version-row="${migrated!.id}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: zh.versionPreview }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-version-announcement]")).toContainText(
      MIGRATED_ANNOUNCEMENT_FRAGMENT,
    );
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });

  test("edits hero text and sees the live preview update without saving", async ({ page }) => {
    // Establish a known hero in the draft first: on a freshly recreated
    // database the migration backfill writes an EMPTY document (sections: []),
    // so the canvas would have no hero element to edit.
    const seeded = unique("E2E SEEDED HERO");
    await savePublishableDraft(seeded);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    await revealPreviewPane(page, 1440);

    // Track PUTs to the draft endpoint for the whole scenario.
    const draftPuts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && /\/admin\/homepage\/draft/.test(request.url())) {
        draftPuts.push(request.url());
      }
    });

    await selectHeroElement(page, "heading");
    const textarea = page.getByLabel(zh.headingText);
    await textarea.waitFor({ state: "visible" });
    const live = unique("E2E LIVE PREVIEW");
    await textarea.fill(live);

    // The 300 ms typing-burst commit updates the canvas BEFORE the 3 s
    // autosave can PUT anything.
    await expect
      .poll(() => page.locator('[data-hero-element="heading"]').textContent())
      .toContain(live);
    expect(draftPuts, "no draft save before the live preview updated").toHaveLength(0);

    // Let the autosave settle so later scenarios start from a clean saved state.
    await expect(page.getByText(zh.saved)).toBeVisible({ timeout: 6000 });
  });

  test("drags a hero element and persists the percentage after Save Draft", async ({ page }) => {
    await savePublishableDraft(unique("E2E DRAG SEED"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    await revealPreviewPane(page, 1440);

    const startX = (await draftHeroSnapshotHeadingLayout()).xPct;
    await selectHeroElement(page, "heading");

    const stage = page.locator("[data-hero-stage]");
    const rect = await stage.boundingBox();
    expect(rect).not.toBeNull();

    const heading = page.locator('[data-hero-element="heading"]');
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();

    // Drag +12 percentage points horizontally (a snap-safe target: static
    // guides sit at 4/5/10/25/31/50; element edges near 7.4/31; 19.4 is clear).
    const targetX = startX + 12;
    const dx = ((targetX - startX) / 100) * rect!.width;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2, { steps: 8 });
    await page.mouse.up();

    // The settings Position group reflects the committed percentage.
    const xInput = page.getByLabel(zh.xPct);
    await expect(xInput).toBeVisible();
    const committed = await pollValue(
      async () => {
        const raw = await xInput.inputValue();
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : null;
      },
      "X input after drag",
    );
    expect(Math.abs(committed - startX)).toBeGreaterThan(2);

    await page.getByRole("button", { name: zh.saveDraft }).click();
    await expect(page.getByText(zh.saved)).toBeVisible({ timeout: 6000 });

    // Reload and re-read the Position value from the persisted draft.
    await navigateAdmin(page, "/admin/homepage");
    await revealPreviewPane(page, 1440);
    await selectHeroElement(page, "heading");
    const persistedInput = page.getByLabel(zh.xPct);
    await expect(persistedInput).toBeVisible();
    const persisted = await pollValue(
      async () => {
        const raw = await persistedInput.inputValue();
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : null;
      },
      "X input after reload",
    );
    expect(Math.abs(persisted - committed), "persisted x% after reload").toBeLessThan(0.11);

    // Backend truth: the draft's heading layout matches the committed value.
    const backend = await draftHeroSnapshotHeadingLayout();
    expect(Math.abs(backend.xPct - committed)).toBeLessThan(0.11);
  });

  test("publishes and the storefront homepage serves the new slide", async ({ page }) => {
    const heading = unique("E2E PUBLISHED");
    await savePublishableDraft(heading);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);

    await page.getByRole("button", { name: zh.publish }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The publish panel first saves, then validates the saved draft. Warning
    // confirmation is required only when warnings exist; the old GRID_EMPTY
    // warnings can be present, so drive the two-step confirm+published flow.
    const publishButton = dialog.getByRole("button", { name: zh.publish });
    if (await dialog.getByRole("button", { name: zh.confirmWarnings }).isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: zh.confirmWarnings }).click();
    }
    await expect(publishButton).toBeEnabled({ timeout: 15_000 });
    await publishButton.click();

    await expect(
      dialog.getByText(new RegExp(zh.publishSuccess)),
      "publish success appears",
    ).toBeVisible({ timeout: 15_000 });

    // Storefront contract: the backend serves the new slide.
    await waitForStorefrontHeading(heading);

    // Page render, forced fresh across the dev fetch cache.
    const html = await freshPageHtml(`${FRONTEND}/`);
    expect(html).toContain(heading);
  });

  test("a scheduled version stays invisible until its publishAt", async () => {
    const scheduled = unique("E2E SCHEDULED");
    const liveHeading = unique("E2E LIVE NOW");
    await savePublishableDraft(liveHeading);
    await adminPost("/admin/homepage/publish", {
      note: "Task22 live baseline",
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
    });
    await waitForStorefrontHeading(liveHeading);

    await savePublishableDraft(scheduled);
    const publishAt = new Date(Date.now() + 4000).toISOString();
    await adminPost("/admin/homepage/publish", {
      note: "Task22 scheduled",
      publishAt,
      unpublishAt: null,
      confirmWarnings: true,
    });

    // Immediately: the scheduled version is not effective yet — the storefront
    // still serves the live baseline, and the scheduled heading stays hidden.
    const storefrontNow = await adminGet<{
      sections: { type: string; payload: { slides: { elements: { heading: { text: string } } }[] } }[];
    }>("/storefront/homepage");
    const heroNow = storefrontNow.sections.find((section) => section.type === "HERO");
    expect(heroNow?.payload?.slides?.[0]?.elements?.heading?.text).toBe(liveHeading);

    // Wait for the window to open, then assert the storefront serves it.
    await waitForStorefrontHeading(scheduled, 15_000);
  });

  test("restores a previous version into the draft without changing the storefront", async ({ page }) => {
    const base = unique("E2E RESTORE BASE");
    await savePublishableDraft(base);
    const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
      note: "Task22 restore baseline",
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
    });
    await waitForStorefrontHeading(base);
    // The LIVE version is the one just published — match by versionNo rather
    // than list order, because a future-scheduled version (published later in
    // the window list first) must not be picked here.
    const liveRow = (await adminGet<
      { id: string; versionNo: number }[]
    >("/admin/homepage/versions")).find((row) => row.versionNo === published.versionNo);
    expect(liveRow, `live version ${published.versionNo} listed`).toBeTruthy();
    const liveId = liveRow!.id;

    // New draft content (unpublished) so restore-vs-live is discriminating.
    const fresh = unique("E2E RESTORE NEW");
    await savePublishableDraft(fresh);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page, "/admin/homepage/versions");
    const row = page.locator(`tr[data-version-row="${liveId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: zh.versionRestore }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: zh.confirm }).click();

    await expect(page.getByText(zh.versionRestoreSuccess)).toBeVisible();

    // Restore writes the draft only: the storefront still serves `base`.
    expect(await draftHeroHeading()).toBe(base);
    expect(published.versionNo).toBeGreaterThan(0);
    await waitForStorefrontHeading(base);

    // The editor draft reflects the restored version.
    await navigateAdmin(page, "/admin/homepage");
    await page.setViewportSize({ width: 1440, height: 900 });
    await revealPreviewPane(page, 1440);
    await expect(page.locator('[data-hero-element="heading"]')).toContainText(base);
  });

  test("draft preview shows unpublished changes and fires zero tracking requests", async ({ page }) => {
    const draftHeading = unique("E2E PREVIEW DRAFT");
    await savePublishableDraft(draftHeading);
    const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");

    const state = collectConsoleIssues(page);
    const tracked: string[] = [];
    page.on("request", (request) => {
      if (isTrackingRequest(request)) tracked.push(request.url());
    });

    await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
    await expect(page.locator("[data-draft-preview-banner]")).toBeVisible();
    await expect
      .poll(() => page.locator('[data-hero-element="heading"]').textContent())
      .toContain(draftHeading);
    const html = await page.content();
    expect(html).not.toContain("connect.facebook.net");
    expect(html).not.toContain("fbevents");

    const issues = state();
    expect(issues.errors, "preview page console errors").toHaveLength(0);
    expect(issues.pageErrors, "preview page pageerrors").toHaveLength(0);
    expect(tracked, "preview fires zero tracking requests").toHaveLength(0);
  });

  test("expired/tampered preview tokens never expose the draft; blanks 404", async ({ page }) => {
    const draftHeading = unique("E2E PREVIEW SECRET");
    await savePublishableDraft(draftHeading);

    // A whitespace-only token dies at the route gate with 404.
    for (const token of [" ", "", "   \t"]) {
      const response = await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
      expect(response?.status(), `blank token "${JSON.stringify(token)}" → 404`).toBe(404);
    }
    // No token param at all.
    const noToken = await page.goto(`${FRONTEND}/preview/homepage`);
    expect(noToken?.status(), "missing token → 404").toBe(404);

    // A TAMPERED token (payload flipped) must never render the draft. NOTE the
    // Task 21 backend contract (Ruling 49/51) answers 200 here with the LIVE
    // document ("silent fallback, no detection signal"). Spec §5.2 originally
    // required a uniform 404 for tampered/expired tokens; the E2E pins the
    // security property that the production must hold in EITHER contract:
    // the draft-only content is never served. The 200-vs-404 divergence is
    // logged and flagged in the Task 22 report (backend fix out of scope).
    const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
    const tampered = await page.goto(
      `${FRONTEND}/preview/homepage?token=${encodeURIComponent("z" + token.slice(1))}`,
    );
    expect(tampered, "tampered token answers a page today (200 live-doc fallback)").not.toBeNull();
    await page.waitForLoadState("domcontentloaded");
    const tamperedBody = await page.content();
    expect(tamperedBody, "tampered token must not leak draft content").not.toContain(draftHeading);

    // An EXPIRED token (crafted with exp in the past) likewise never exposes draft content.
    const expired = signToken({ exp: Date.now() - 1000 });
    await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(expired)}`);
    await expect(page.locator("[data-draft-preview-banner]")).toBeAttached();
    const expiredBody = await page.content();
    expect(expiredBody, "expired token must not leak draft content").not.toContain(draftHeading);

    // Control: the same secret-bound token DOES render the draft (proves the
    // assertions above are discriminating, not vacuous).
    const { token: fresh } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
    await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(fresh)}`);
    await expect
      .poll(() => page.locator('[data-hero-element="heading"]').textContent())
      .toContain(draftHeading);
  });

  test("375 / 768 / 1440: builder and storefront hero render without horizontal overflow or console errors", async ({ page }) => {
    const heading = unique("E2E OVERFLOW");
    await savePublishableDraft(heading);
    // Make the hero LIVE so the storefront at all widths renders the v2 slider.
    await adminPost("/admin/homepage/publish", {
      note: "Task22 overflow baseline",
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
    });
    await waitForStorefrontHeading(heading);

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 1024 });

      // Storefront home page.
      const storefrontState = collectConsoleIssues(page);
      await page.goto(`${FRONTEND}/`);
      await expect(page.locator("[data-hero-slider]")).toBeVisible({ timeout: 30_000 });
      await assertNoPageOverflow(page, `storefront @ ${width}`);
      const storefrontIssues = storefrontState();
      expect(storefrontIssues.errors, `storefront console errors @ ${width}`).toHaveLength(0);
      expect(storefrontIssues.pageErrors, `storefront pageerrors @ ${width}`).toHaveLength(0);

      // Builder page.
      const builderState = collectConsoleIssues(page);
      await openAdmin(page, "/admin/homepage");
      await expect(page.getByRole("button", { name: zh.saveDraft })).toBeVisible({ timeout: 30_000 });
      await assertNoPageOverflow(page, `builder @ ${width}`);
      const builderIssues = builderState();
      expect(builderIssues.errors, `builder console errors @ ${width}`).toHaveLength(0);
      expect(builderIssues.pageErrors, `builder pageerrors @ ${width}`).toHaveLength(0);
    }
  });

  test("countdown banner blocks an expired publish, then renders and expires on the storefront", async ({ page }) => {
    const heading = unique("E2E BANNER HERO");
    const promoTitle = unique("E2E PROMO");
    const countdownTitle = unique("E2E COUNTDOWN");
    const original = await getDraft();
    let publishedVersionNo: number | null = null;

    try {
      await savePublishableDraft(heading);

      // Append a promo banner and a countdown banner whose end time has passed.
      const snapshot = await getDraft();
      const doc = snapshot.draft;
      doc.sections = [
        ...doc.sections,
        {
          id: cryptoRandomUuid(),
          type: "PROMO_BANNER",
          title: promoTitle,
          subtitle: null,
          enabled: true,
          sortOrder: 500,
          schedule: { publishAt: null, unpublishAt: null },
          payload: { ctaText: "Shop now", ctaLink: "/collections/sale" },
          products: [],
        },
        {
          id: cryptoRandomUuid(),
          type: "COUNTDOWN_BANNER",
          title: countdownTitle,
          subtitle: null,
          enabled: true,
          sortOrder: 510,
          schedule: { publishAt: null, unpublishAt: null },
          payload: {
            endsAt: new Date(Date.now() - 60_000).toISOString(),
            ctaText: "Grab it",
            ctaLink: "#featured",
          },
          products: [],
        },
      ] as typeof doc.sections;
      await withAdmin(async (token, context) => {
        const response = await context.put(`${API}/admin/homepage/draft`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          data: { draft: doc, expectedRev: snapshot.draftRev },
        });
        expect(response.ok(), `PUT draft (${response.status()}): ${await response.text()}`).toBeTruthy();
      });

      // The publish gate refuses an enabled countdown whose end time has passed.
      await withAdmin(async (token, context) => {
        const response = await context.post(`${API}/admin/homepage/publish`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          data: { note: "expired countdown", publishAt: null, unpublishAt: null, confirmWarnings: true },
        });
        expect(response.status(), "expired countdown blocks publish").toBe(422);
        expect(await response.text()).toContain("countdown end time");
      });

      // Move the end time slightly into the future and publish for real.
      const live = await getDraft();
      const countdown = live.draft.sections.find(
        (section) => section.type === "COUNTDOWN_BANNER",
      );
      if (!countdown) throw new Error("draft is missing the countdown banner");
      countdown.payload.endsAt = new Date(Date.now() + 15_000).toISOString();
      await withAdmin(async (token, context) => {
        const response = await context.put(`${API}/admin/homepage/draft`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          data: { draft: live.draft, expectedRev: live.draftRev },
        });
        expect(response.ok(), `PUT draft (${response.status()}): ${await response.text()}`).toBeTruthy();
      });
      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
        note: "live countdown",
        publishAt: null,
        unpublishAt: null,
        confirmWarnings: true,
      });
      publishedVersionNo = published.versionNo;
      await pollValue(async () => {
        const storefront = await adminGet<{ sections: { type: string }[] }>("/storefront/homepage");
        return storefront.sections.some((section) => section.type === "COUNTDOWN_BANNER")
          ? true
          : null;
      }, "storefront serves the countdown banner");

      // The storefront page renders both banners; the countdown reads the clock
      // only after hydration (server HTML carries no digits).
      await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
      await page.goto(`${FRONTEND}/`);
      await expect(page.getByText(promoTitle)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(countdownTitle)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("timer")).toBeVisible();

      // At the deadline the countdown removes itself entirely, without a reload;
      // the promo banner stays.
      await expect(page.getByText(countdownTitle)).toBeHidden({ timeout: 25_000 });
      await expect(page.getByRole("timer")).toHaveCount(0);
      await expect(page.getByText(promoTitle)).toBeVisible();
    } finally {
      await restoreHomepageSnapshot(original, publishedVersionNo);
    }
  });
});

// --- small helpers ----------------------------------------------------------

async function draftHeroSnapshotHeadingLayout(): Promise<{ xPct: number }> {
  const snapshot = await getDraft();
  const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
  const xPct = hero?.payload?.slides?.[0]?.elements?.heading?.layout?.xPct;
  if (typeof xPct !== "number") throw new Error("draft has no hero heading layout to read");
  return { xPct };
}