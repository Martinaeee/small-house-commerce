import {
  request as playwrightRequest,
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Response as PlaywrightResponse,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";
import { emptyDocument, emptySlide, type HomepageDocument, type SectionStyle } from "../src/lib/homepage-document";
import { defaultSection } from "../src/lib/homepage-section-factory";

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

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3210);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3211);
const PG_PORT = process.env.E2E_PG_PORT ?? "5432";
const API = `http://127.0.0.1:${BACKEND_PORT}/api/v1`;
const FRONTEND = `http://localhost:${FRONTEND_PORT}`;

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:${PG_PORT}/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;
assertE2EDatabaseUrl(
  E2E_DATABASE_URL,
  PG_PORT,
  process.env.HOMEPAGE_STUDIO_PG === "1" ? "homepage-studio" : "task5",
);
if (process.env.HOMEPAGE_STUDIO_PG === "1" && (BACKEND_PORT !== 3236 || FRONTEND_PORT !== 3237)) {
  throw new Error("Homepage Studio requires its owned 3236/3237 services.");
}

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
  addSection: "添加模块",
  promoBanner: "促销横幅",
  countdownBanner: "倒计时横幅",
  bannerCtaText: "按钮文案",
  bannerEndsAt: "截止时间",
  sectionTitle: "模块标题",
  sectionDuplicate: "复制模块",
  sectionDelete: "删除模块",
  sectionUndoDelete: "撤销删除",
  sectionDrag: "拖动排序",
  announcementBar: "公告栏",
  announcementRichText: "公告富文本",
  announcementBold: "粗体",
  announcementAlignRight: "右对齐",
  announcementCountdownEnable: "启用倒计时",
  announcementCountdownDeadline: "倒计时截止时间",
  deviceDesktop: "桌面端",
  deviceTablet: "平板端",
  deviceMobile: "移动端",
};

let adminAccessToken: string | null = null;
let adminRefreshToken: string | null = null;

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function localDatetimeInput(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
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
      assertE2EDatabaseUrl(process.env.DATABASE_URL, process.env.E2E_PG_PORT ?? '5432', process.env.HOMEPAGE_STUDIO_PG === '1' ? 'homepage-studio' : 'task5');
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await getDraft();
    const result = await withAdmin(async (token, context) => {
      const response = await context.put(`${API}/admin/homepage/draft`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { draft: snapshot.draft, expectedRev: current.draftRev },
      });
      return { ok: response.ok(), status: response.status(), body: await response.text() };
    });
    if (result.ok) return;
    if (result.status !== 409) {
      throw new Error(`restore draft (${result.status}): ${result.body}`);
    }
  }
  throw new Error("restore draft failed: the draft kept changing concurrently");
}

async function restoreHomepageSnapshot(snapshot: DraftSnapshot): Promise<void> {
  const failures: unknown[] = [];
  try {
    const versions = await adminGet<
      { id: string; note: string | null; unpublishAt: string | null }[]
    >("/admin/homepage/versions");
    for (const version of versions) {
      if (
        (version.note === "live countdown" ||
          version.note === "live rich announcement") &&
        version.unpublishAt === null
      ) {
        await adminPost(`/admin/homepage/versions/${version.id}/unpublish`);
      }
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    await putDraft(snapshot);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
}

// Keep legacy scenarios isolated from preceding module and appearance fixtures.
async function savePublishableDraft(heading: string): Promise<void> {
  const snapshot = await getDraft();
  const doc = emptyDocument();
  doc.announcement = structuredClone(snapshot.draft.announcement);
  const hero = doc.sections.find((section) => section.type === "HERO")!;
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
  await expect(page.locator('[data-pane="preview"] [data-hero-element="heading"]')).toBeAttached();
}

/** Selects a hero element on the canvas, opening its settings group. */
async function selectHeroElement(page: Page, key: string): Promise<Locator> {
  await page.locator(`[data-pane="preview"] [data-hero-element="${key}"]`).click({ force: true, timeout: 30_000 });
  const settings = page.locator(`[data-pane="settings"] fieldset[data-hero-element="${key}"]`);
  await expect(settings).toBeVisible();
  return settings;
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
  await waitForStorefrontHtml(heading);
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

// A STALE route response can precede regenerated HTML even after tag invalidation.
async function waitForStorefrontHtml(marker: string): Promise<void> {
  await expect.poll(async () => (await freshPageHtml(`${FRONTEND}/`)).includes(marker), {
    message: "the compiled storefront must serve the newly published snapshot",
  }).toBe(true);
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

async function assertNoOuterAdminScroll(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    documentScrollHeight: document.documentElement.scrollHeight,
    documentClientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
  }));
  expect(
    metrics.documentScrollHeight,
    `${label}: document scrollHeight ${metrics.documentScrollHeight} > clientHeight ${metrics.documentClientHeight}`,
  ).toBeLessThanOrEqual(metrics.documentClientHeight + 1);
  expect(
    metrics.bodyScrollHeight,
    `${label}: body scrollHeight ${metrics.bodyScrollHeight} > clientHeight ${metrics.documentClientHeight}`,
  ).toBeLessThanOrEqual(metrics.documentClientHeight + 1);
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

function isCustomerStateRequest(request: Request): boolean {
  return /\/api\/v1\/(?:auth|cart|checkout|orders|customers?|back-in-stock)(?:\/|\?|$)/i.test(
    request.url(),
  );
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

// --- responsive display acceptance fixtures (Task 7) ------------------------

const PHOTO_WIDE_URL = "/uploads/e2e/hero-photo-wide.jpg";
const PHOTO_TALL_URL = "/uploads/e2e/hero-photo-tall.jpg";
const HERO_VIDEO_URL = "/e2e/product-video.webm";
const RESPONSIVE_HEADING = "Thoughtful furniture for everyday living in a smaller home";
const RESPONSIVE_SUBHEADING =
  "Solid wood, considered proportions and honest materials, made to be lived with in rooms that have to work a little harder than most.";
const RESPONSIVE_MEDIA = {
  mobileOverride: { enabled: false, image: null, video: null },
  fit: "COVER" as const,
  focal: { x: 50, y: 50 },
  objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
};

/**
 * Saves a hero built from the plan-owned real photo fixtures with long copy, so
 * the display matrix exercises actual image metadata instead of a placeholder.
 */
async function saveResponsiveHeroFixture(
  options: { mobileOverride?: boolean; video?: boolean; naturalMobile?: boolean; focalExtremes?: boolean; mobileLayout?: boolean; appearance?: "STUDIO_V3" } = {},
): Promise<void> {
  await savePublishableDraft(RESPONSIVE_HEADING);
  const snapshot = await getDraft();
  if (options.appearance) snapshot.draft.appearance = options.appearance;
  const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
  if (!hero || hero.type !== "HERO") throw new Error("responsive fixture requires HERO");
  const slide = emptySlide(0);
  slide.name = "E2E slide";
  hero.payload.slides = [slide];
  hero.style = { contentWidth: "FULL" };
  hero.payload.display = options.naturalMobile
    ? { heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } }
    : { heightMode: "SCREEN" };
  slide.overlay = { ...slide.overlay, color: "#241B16", opacity: 0.65, gradient: "LOCAL" };
  slide.elements.eyebrow.text = "Made for smaller homes";
  slide.elements.heading.text = RESPONSIVE_HEADING;
  slide.elements.subheading.text = RESPONSIVE_SUBHEADING;
  slide.elements.ctaPrimary.text = "Shop the collection";
  slide.elements.ctaSecondary.text = "Book a design call";
  for (const key of ["ctaPrimary", "ctaSecondary"] as const) {
    slide.elements[key].link = { type: "EXTERNAL", url: `https://example.com/${key}` };
  }
  if (options.mobileLayout) {
    for (const key of ["eyebrow", "heading", "subheading", "ctaPrimary", "ctaSecondary"] as const) {
      slide.elements[key].overrides.mobile = { layout: { xPct: 7.4, widthPct: 85 } };
    }
  }
  slide.media = options.video
    ? {
        ...RESPONSIVE_MEDIA,
        type: "VIDEO",
        image: null,
        video: {
          url: HERO_VIDEO_URL, poster: PHOTO_WIDE_URL, autoplay: true, muted: true,
          loop: true, playsInline: true, showSoundToggle: false, pauseOffscreen: true,
        },
      }
    : {
        ...RESPONSIVE_MEDIA,
        type: "IMAGE",
        image: { url: PHOTO_WIDE_URL, alt: "Living room with a linen sofa" },
        video: null,
        fitOverrides: options.mobileOverride ? { mobile: "CONTAIN" } : undefined,
        mobileOverride: options.mobileOverride
          ? { enabled: true, image: { url: PHOTO_TALL_URL, alt: "Tall living room view" }, video: null }
          : { enabled: false, image: null, video: null },
      };
  if (options.focalExtremes && slide.media) {
    slide.media.objectPosition = { desktop: { x: 100, y: 100 }, tablet: null, mobile: { x: 0, y: 0 } };
  }
  await putDraft(snapshot);
}
interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface HeroLayout {
  hero: Box;
  media: Box | null;
  mediaTag: string | null;
  mediaSrc: string | null;
  mediaPoster: string | null;
  mediaFit: string | null;
  mediaPosition: string | null;
  mediaRatio: number | null;
  boxes: { key: string; box: Box }[];
  cta: Box | null;
}

/** Reads the hero's real geometry from the rendered preview page. */
async function readHeroLayout(page: Page): Promise<HeroLayout> {
  const root = page.locator("[data-hero-slider]").first();
  await expect(root).toHaveAttribute("data-readable-ready", "true");
  await root.evaluate(async (hero) => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      let previous = "";
      let stable = 0;
      const check = () => {
        const next = [hero, ...hero.querySelectorAll("[data-hero-element]")].map((node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height].join(",");
        }).join(";");
        stable = next === previous ? stable + 1 : 0;
        previous = next;
        if (stable >= 3) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  });
  return root.evaluate((heroRoot) => {
      const box = (element: Element | null): Box | null => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      // Both the common and the mobile media nodes are in the DOM; only the one
      // the current device actually displays has a measurable box.
      const media = Array.from(heroRoot.querySelectorAll("img, video")).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      }) ?? null;
      const boxes = ["heading", "subheading", "ctaPrimary", "ctaSecondary"]
        .map((key) => ({ key, box: box(heroRoot.querySelector(`[data-hero-element="${key}"]`)) }))
        .filter((entry): entry is { key: string; box: Box } => entry.box !== null);
      const html = media as HTMLImageElement | HTMLVideoElement | null;
      const natural = html instanceof HTMLVideoElement ? html.videoWidth / html.videoHeight : html?.naturalWidth ? html.naturalWidth / html.naturalHeight : null;
      return {
        hero: box(heroRoot)!,
        media: box(media),
        mediaTag: media?.tagName ?? null,
        mediaSrc: media?.getAttribute("src") ?? null,
        mediaPoster: media?.getAttribute("poster") ?? null,
        mediaFit: media ? getComputedStyle(media).objectFit : null,
        mediaPosition: media ? getComputedStyle(media).objectPosition : null,
        mediaRatio: natural,
        boxes,
        cta: box(heroRoot.querySelector('[data-hero-element="ctaPrimary"] > :is(a, span)')),
      };
    });
}

function intersect(a: Box, b: Box): boolean {
  return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

/** Every visible hero text/CTA box is inside the section, disjoint and reachable. */
function expectHeroReadable(layout: HeroLayout, label: string): void {
  for (const { key, box } of layout.boxes) {
    expect(box.top, `${label}: ${key} escapes the hero top`).toBeGreaterThanOrEqual(layout.hero.top - 1);
    expect(box.bottom, `${label}: ${key} escapes the hero bottom`).toBeLessThanOrEqual(layout.hero.bottom + 1);
    expect(box.left, `${label}: ${key} escapes the hero left`).toBeGreaterThanOrEqual(layout.hero.left - 1);
    expect(box.right, `${label}: ${key} escapes the hero right`).toBeLessThanOrEqual(layout.hero.right + 1);
  }
  for (let i = 0; i < layout.boxes.length; i += 1) {
    for (let j = i + 1; j < layout.boxes.length; j += 1) {
      expect(
        intersect(layout.boxes[i].box, layout.boxes[j].box),
        `${label}: ${layout.boxes[i].key} overlaps ${layout.boxes[j].key}`,
      ).toBe(false);
    }
  }
  expect(layout.cta, `${label}: primary CTA missing`).not.toBeNull();
  expect(layout.cta!.height, `${label}: primary CTA touch height`).toBeGreaterThanOrEqual(44);
}

/**
 * Content width vs. the widest single word for every hero text box, measured
 * with the element's own computed font. A box narrower than its longest word
 * can only render by breaking that word mid-character.
 */
async function heroWordFit(page: Page): Promise<{
  key: string; contentWidth: number; longestWord: number; fullText: number; lines: number; available: number;
}[]> {
  return page.locator("[data-hero-slider]").first().evaluate((heroRoot) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return [];
    const heroLeft = heroRoot.getBoundingClientRect().left;
    const heroWidth = heroRoot.clientWidth;
    return ["heading", "subheading", "ctaPrimary", "ctaSecondary"].flatMap((key) => {
      const element = heroRoot.querySelector(`[data-hero-element="${key}"]`);
      if (!element) return [];
      const target = element.matches('[data-hero-element^="cta"]')
        ? (element.querySelector(":scope > a, :scope > span") ?? element)
        : element;
      const style = getComputedStyle(target);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.letterSpacing = style.letterSpacing;
      const text = (target.textContent ?? "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      const longestWord = Math.max(0, ...words.map((word) => context.measureText(word).width));
      const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const contentHeight = target.clientHeight - paddingY;
      return [{
        key,
        contentWidth: target.clientWidth - paddingX,
        longestWord,
        fullText: context.measureText(text).width,
        lines: Math.max(1, Math.round(contentHeight / (Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(style.fontSize) * 1.2))),
        available: heroWidth - (target.getBoundingClientRect().left - heroLeft) - 16,
      }];
    });
  });
}

async function openSignedPreview(page: Page, token: string, view?: "desktop" | "tablet" | "mobile" | "content"): Promise<void> {
  const query = new URLSearchParams({ token });
  if (view) query.set("view", view);
  await page.goto(`${FRONTEND}/preview/homepage?${query}`);
}

async function assertPreviewInert(shell: Locator): Promise<void> {
  await expect(shell.locator("header a, footer a, form")).toHaveCount(0);
  const link = shell.locator("a[href]").first();
  if (await link.count() === 0) return;
  const url = await shell.evaluate(() => location.href);
  const scroll = await shell.evaluate(() => ({ x: scrollX, y: scrollY }));
  const pages = shell.page().context().pages().length;
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await link.press("Enter");
  await link.click({ button: "middle" });
  await shell.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await shell.evaluate(() => location.href)).toBe(url);
  expect(shell.page().context().pages().length).toBe(pages);
  await shell.evaluate((_, position) => scrollTo(position.x, position.y), scroll);
}

async function draftHero() {
  const snapshot = await getDraft();
  const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
  if (!hero || hero.type !== "HERO") throw new Error("draft has no HERO");
  return hero;
}

async function studioFixture(): Promise<{ document: HomepageDocument; categoryId: string }> {
  const category = await adminPost<{ id: string; slug: string }>("/admin/categories", {
    name: "Layout illustration", slug: unique("studio-category"), imageUrl: MEDIA_URL, status: "ACTIVE",
  });
  const products = await adminGet<{ items: { id: string; slug: string }[] }>("/admin/products?status=ACTIVE&pageSize=100");
  const product = products.items.find(({ slug }) => slug === "e2e-color-only");
  if (!product) throw new Error("Studio requires the seeded sellable product");
  const document = emptyDocument();
  document.appearance = "STUDIO_V3";
  document.announcement.enabled = false;
  delete document.defaults;
  const hero = document.sections.find((section) => section.type === "HERO");
  if (!hero || hero.type !== "HERO") throw new Error("Studio requires HERO");
  hero.payload.display = { heightMode: "SCREEN" };
  hero.payload.behavior.autoplay = false;
  const slide = emptySlide(0);
  hero.payload.slides = [slide];
  slide.name = "Layout illustration";
  slide.elements.eyebrow.text = "Layout illustration";
  slide.elements.heading.text = "Room for everyday living";
  slide.elements.subheading.text = "A local layout sample for testing comfortable type, clear links and generous spacing.";
  slide.elements.ctaPrimary.text = "Explore the sample";
  slide.elements.ctaSecondary.text = "View the same category";
  slide.overlay = { ...slide.overlay, opacity: 0.65, gradient: "LOCAL" };
  slide.media = {
    ...RESPONSIVE_MEDIA, type: "IMAGE", image: { url: PHOTO_WIDE_URL, alt: "Room layout illustration" }, video: null,
  };
  for (const element of Object.values(slide.elements)) {
    for (const field of ["fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const) delete element.style[field];
    element.overrides = {};
  }
  for (const key of ["ctaPrimary", "ctaSecondary"] as const) slide.elements[key].link = { type: "CATEGORY", id: category.id };
  const usp = defaultSection("USP", randomUUID(), 10);
  usp.payload.items = ["Small rooms", "Everyday spaces", "Room to move", "Simple routines"].map((label) => ({ label, sub: "Layout illustration only" }));
  const navigation = defaultSection("CATEGORY_TILES", randomUUID(), 20);
  navigation.title = "Explore a smaller space";
  navigation.payload.entries = ["Living areas", "Work spaces", "Dining corners", "Quiet rooms", "Shared spaces", "Storage ideas"].map((label) => ({
    id: randomUUID(), label, imageUrl: PHOTO_WIDE_URL, link: { type: "CATEGORY", id: category.id },
  }));
  const grid = defaultSection("PRODUCT_GRID", randomUUID(), 30);
  grid.title = "A real catalog sample";
  grid.products = [{ productId: product.id, sortOrder: 0, badge: null }];
  const solutions = defaultSection("SOLUTIONS", randomUUID(), 40);
  solutions.title = "Room for your routine";
  solutions.payload.items = ["A flexible corner", "A quieter workspace", "A shared room"].map((title) => ({ title,
    blurb: "This is sample content for testing readable cards and wrapping links.", link: `/categories/${category.slug}` }));
  const story = defaultSection("PRODUCT_STORY", randomUUID(), 50);
  story.payload = { heading: "A little more breathing room", body: "A layout illustration with enough room for a useful paragraph. The text should remain comfortable to read on a phone, a tablet and a desktop.",
    imageUrl: PHOTO_WIDE_URL, ctaText: "Explore the sample category", ctaLink: `/categories/${category.slug}` };
  const room = defaultSection("ROOM_INSPIRATION", randomUUID(), 60);
  room.title = "A room layout illustration";
  room.payload = { heading: "See the room", body: "A reference photo used only for local layout testing.", imageUrl: PHOTO_WIDE_URL,
    scenes: [{ id: randomUUID().replaceAll("-", "").slice(0, 12), imageUrl: PHOTO_WIDE_URL, alt: "Room layout illustration", hotspots: [] }] };
  const ugc = defaultSection("UGC", randomUUID(), 70);
  ugc.title = "Room photo illustrations";
  ugc.payload.entries = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), imageUrl: index % 2 ? PHOTO_TALL_URL : PHOTO_WIDE_URL,
    name: "Layout sample", comment: "Layout illustration only — this is not a customer review.", productId: product.id }));
  ugc.payload.presentation = { layout: "COLLAGE", featuredEntryId: ugc.payload.entries[0].id, showQuote: true, overlay: "SOFT" };
  const brand = defaultSection("BRAND_STORY", randomUUID(), 80);
  brand.payload = { heading: "Make space for the everyday", body: "A local typography and spacing illustration. This paragraph tests the reading width without changing any live brand content.",
    bullets: ["A clear reading order", "Comfortable line lengths", "Space around each idea"] };
  const confidence = defaultSection("CONFIDENCE", randomUUID(), 90);
  confidence.payload = { heading: "A clear next step", body: "Layout sample — not a shipping or service guarantee.",
    bullets: ["Review the sample", "Explore the category", "Return to the layout"] };
  const promo = defaultSection("PROMO_BANNER", randomUUID(), 100);
  promo.title = "A simple layout message";
  promo.subtitle = "A layout illustration, not a live offer.";
  promo.payload = { ctaText: "Explore the sample", ctaLink: `/categories/${category.slug}` };
  const countdown = defaultSection("COUNTDOWN_BANNER", randomUUID(), 110);
  countdown.title = "A timer layout sample";
  countdown.subtitle = "This local preview timer is not a live promotion.";
  countdown.payload = { endsAt: new Date(Date.now() + 86_400_000).toISOString(), ctaText: "View the sample", ctaLink: `/categories/${category.slug}` };
  document.sections = [hero, usp, navigation, grid, solutions, story, room, ugc, brand, confidence, promo, countdown];
  return { document, categoryId: category.id };
}

async function removeStudioCategory(categoryId: string): Promise<void> {
  await withAdmin(async (token, context) => {
    const response = await context.delete(`${API}/admin/categories/${categoryId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), "remove owned Studio category").toBe(true);
  });
}

async function restoreStudioSnapshot(page: Page, snapshot: DraftSnapshot, categoryId: string, publishedIds: string[] = []): Promise<void> {
  try { if (!page.isClosed()) await page.goto("about:blank"); }
  finally {
    try { for (const id of [...publishedIds].reverse()) await adminPost(`/admin/homepage/versions/${id}/unpublish`); }
    finally {
      try { await restoreHomepageSnapshot(snapshot); }
      finally { await removeStudioCategory(categoryId); }
    }
  }
}

async function readStudioAppearance(root: Locator) {
  await expect(root).toBeVisible();
  return root.evaluate(async (node) => {
    await document.fonts.ready;
    await Promise.all([...node.querySelectorAll("img")].map((image) => {
      image.loading = "eager";
      return image.decode().catch(() => undefined);
    }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const get = (selector: string): HTMLElement => {
      const target = node.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`Studio measurement target missing: ${selector}`);
      return target;
    };
    const style = (selector: string) => getComputedStyle(get(selector));
    const section = (type: string) => `[data-homepage-section-type="${type}"]`;
    const heading = style(`${section("CATEGORY_TILES")} h2`);
    const body = style(`${section("BRAND_STORY")} [data-homepage-role="body"]`);
    const story = style(`${section("PRODUCT_STORY")} [data-homepage-role="story-heading"]`);
    const shell = style(`${section("CATEGORY_TILES")} [data-homepage-section-shell]`);
    const quote = style(`${section("UGC")} blockquote`);
    const hero = style('[data-hero-element="heading"]');
    const cta = get('[data-hero-element="ctaPrimary"] > a, [data-hero-element="ctaPrimary"] > span');
    const label = cta.firstChild;
    if (!label) throw new Error("Studio CTA label missing");
    const labelRange = document.createRange();
    labelRange.selectNodeContents(label);
    return {
      width: (node as HTMLElement).clientWidth,
      headingSize: parseFloat(heading.fontSize), headingWeight: heading.fontWeight,
      bodySize: parseFloat(body.fontSize), bodyLineHeight: parseFloat(body.lineHeight),
      storySize: parseFloat(story.fontSize), paddingTop: parseFloat(shell.paddingTop),
      categoryGap: parseFloat(style(`${section("CATEGORY_TILES")} .grid`).gap),
      productGap: parseFloat(style(`${section("PRODUCT_GRID")} .grid`).gap),
      storyGap: parseFloat(style(`${section("PRODUCT_STORY")} .grid`).gap),
      ugcGap: parseFloat(style("[data-ugc-layout]").gap), quoteSize: parseFloat(quote.fontSize),
      ugcFeaturedMinHeight: parseFloat(style("[data-ugc-featured]").minHeight),
      ugcQuotePadding: parseFloat(style("[data-ugc-featured] figcaption").paddingLeft),
      heroSize: parseFloat(hero.fontSize), heroWeight: hero.fontWeight,
      ctaHeight: cta.offsetHeight, ctaLines: labelRange.getClientRects().length,
    };
  });
}

async function saveStudioDraft(page: Page): Promise<HomepageDocument> {
  const response = page.waitForResponse((response) => response.request().method() === "PUT" && /\/admin\/homepage\/draft(?:\?|$)/.test(response.url()) && response.ok());
  await page.getByRole("button", { name: zh.saveDraft, exact: true }).click();
  await response;
  return (await getDraft()).draft;
}

async function studioHistoryKey(page: Page, redo = false): Promise<void> {
  await page.getByTestId("homepage-status-bar").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+${redo ? "Shift+" : ""}z`);
}

test.describe("homepage builder (P1 Task 22)", () => {
  test("[studio-appearance] [studio-preview] V3 defaults match public, signed content and all three real editing widths", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    const fixtureHero = fixture.document.sections.find((section) => section.type === "HERO");
    if (!fixtureHero || fixtureHero.type !== "HERO") throw new Error("Studio requires HERO");
    fixtureHero.payload.slides[0].elements.ctaPrimary.text = "Explore the layout";
    const issues = collectConsoleIssues(page);
    let publishedId: string | undefined;
    try {
      await putDraft({ ...original, draft: fixture.document });
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
        note: unique("studio appearance defaults"), publishAt: null, unpublishAt: null, confirmWarnings: true,
      });
      const versions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      publishedId = versions.find(({ versionNo }) => versionNo === published.versionNo)?.id;
      expect(publishedId).toBeTruthy();
      const hero = fixture.document.sections.find((section) => section.type === "HERO")!;
      await waitForStorefrontHtml(hero.payload.slides[0].id);
      const measurements = new Map<number, Awaited<ReturnType<typeof readStudioAppearance>>>();
      for (const width of [375, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
        await openSignedPreview(page, token, "content");
        const preview = await readStudioAppearance(page.locator('[data-homepage-appearance="STUDIO_V3"]'));
        const tier = width < 768 ? 2 : width < 1024 ? 1 : 0;
        expect(preview.width).toBe(width);
        expect(preview.headingSize).toBe([29, 27, 24][tier]);
        expect(preview.headingWeight).toBe("500");
        expect(preview.bodySize).toBe(15);
        expect(preview.bodyLineHeight).toBeCloseTo(26.25, 1);
        expect(preview.storySize).toBe([34, 30, 28][tier]);
        expect(preview.paddingTop).toBe([64, 52, 40][tier]);
        expect(preview.categoryGap).toBe([32, 24, 16][tier]);
        expect(preview.productGap).toBe([24, 20, 16][tier]);
        expect(preview.storyGap).toBe([64, 36, 28][tier]);
        expect(preview.ugcGap).toBe([20, 16, 12][tier]);
        expect(preview.ugcFeaturedMinHeight).toBe([420, 420, 340][tier]);
        expect(preview.ugcQuotePadding).toBe([24, 24, 20][tier]);
        expect(preview.quoteSize).toBe([22, 20, 18][tier]);
        expect(preview.heroSize).toBeGreaterThanOrEqual([56, 44, 36][tier]);
        expect(preview.heroSize).toBeLessThanOrEqual([76, 56, 44][tier]);
        expect(preview.heroWeight).toBe("500");
        expect(preview.ctaHeight).toBeGreaterThanOrEqual(44);
        expect(preview.ctaLines).toBe(1);
        await assertNoPageOverflow(page, `Studio signed content ${width}`);
        await page.goto(`${FRONTEND}/`);
        const live = await readStudioAppearance(page.locator('[data-homepage-appearance="STUDIO_V3"]'));
        expect(live).toEqual(preview);
        measurements.set(width, live);
        await assertNoPageOverflow(page, `Studio public ${width}`);
        await page.screenshot({ path: testInfo.outputPath(`studio-public-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openBuilder(page);
      for (const [label, width] of [[zh.deviceDesktop, 1440], [zh.deviceTablet, 768], [zh.deviceMobile, 390]] as const) {
        await page.getByRole("group", { name: "预览设备", exact: true }).getByRole("button", { name: label, exact: true }).click();
        const inline = await readStudioAppearance(page.locator('[data-homepage-live-preview] [data-homepage-appearance="STUDIO_V3"]'));
        expect(inline).toEqual(measurements.get(width));
      }
      expect(issues().pageErrors).toEqual([]);
      expect(issues().errors).toEqual([]);
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId, publishedId ? [publishedId] : []);
    }
  });

  test("[studio-appearance] explicit old styles survive selection, scoped conversion, undo, comparison, publish and old-version restore", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    const document = fixture.document;
    delete document.appearance;
    document.defaults = { contentWidth: "STANDARD", backgroundColor: "#F5F4EF", paddingTop: 12, paddingBottom: 18,
      overrides: { mobile: { paddingTop: 0, paddingBottom: 7, textColor: "#293B32" } } };
    const hero = document.sections.find((section) => section.type === "HERO")!;
    const story = document.sections.find((section) => section.type === "PRODUCT_STORY")!;
    const category = document.sections.find((section) => section.type === "CATEGORY_TILES")!;
    if (hero.type !== "HERO" || story.type !== "PRODUCT_STORY" || category.type !== "CATEGORY_TILES") throw new Error("Studio fixture types changed");
    for (const [key, element] of Object.entries(hero.payload.slides[0].elements)) {
      element.style = { ...element.style, fontSize: key === "heading" ? 56 : 24, fontWeight: 700, lineHeight: 1.4, letterSpacing: 0.8 };
      element.overrides.mobile = { style: { fontSize: key === "heading" ? 32 : 16, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0, textColor: "#FFFFFF" } };
    }
    story.style = { contentWidth: "NARROW", backgroundColor: "#FFFFFF", paddingTop: 20, paddingBottom: 24,
      overrides: { mobile: { paddingTop: 0, paddingBottom: 0, contentWidth: "STANDARD" } } };
    story.payload.layout = { gap: 11, imageRatio: "LANDSCAPE", overrides: { tablet: { gap: 7 }, mobile: { gap: 0, imageRatio: "PORTRAIT" } } };
    category.payload.layout = { columns: 5, gap: 3, imageRatio: "SQUARE", overrides: { mobile: { columns: 1, gap: 0 } } };
    const publishedIds: string[] = [];
    try {
      await putDraft({ ...original, draft: document });
      const legacy = structuredClone((await getDraft()).draft);
      const oldVersion = await adminPost<{ versionNo: number }>("/admin/homepage/publish", { note: unique("studio legacy"), confirmWarnings: true });
      const oldVersions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      const legacyId = oldVersions.find(({ versionNo }) => versionNo === oldVersion.versionNo)!.id;
      publishedIds.push(legacyId);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openBuilder(page);
      await page.getByRole("button", { name: "首页默认设置", exact: true }).click();
      await page.getByRole("radio", { name: "V3 舒展外观", exact: true }).check();
      const selected = await saveStudioDraft(page);
      expect(selected).toEqual({ ...legacy, appearance: "STUDIO_V3" });
      const expected = structuredClone(selected);
      await page.getByRole("button", { name: "应用整页默认间距", exact: true }).click();
      await studioHistoryKey(page);
      expect(await saveStudioDraft(page)).toEqual(selected);
      await studioHistoryKey(page, true);
      delete expected.defaults!.paddingTop;
      delete expected.defaults!.paddingBottom;
      delete expected.defaults!.overrides!.mobile!.paddingTop;
      delete expected.defaults!.overrides!.mobile!.paddingBottom;
      expect(await saveStudioDraft(page)).toEqual(expected);
      await page.getByRole("combobox", { name: "目标模块", exact: true }).selectOption(story.id);
      await page.getByRole("button", { name: "应用模块间距", exact: true }).click();
      const expectedStory = expected.sections.find((section) => section.type === "PRODUCT_STORY")!;
      if (expectedStory.type !== "PRODUCT_STORY") throw new Error("Story type changed");
      const expectedStoryStyle = expectedStory.style as SectionStyle;
      delete expectedStoryStyle.paddingTop;
      delete expectedStoryStyle.paddingBottom;
      delete expectedStoryStyle.overrides!.mobile!.paddingTop;
      delete expectedStoryStyle.overrides!.mobile!.paddingBottom;
      delete expectedStory.payload.layout!.gap;
      delete expectedStory.payload.layout!.overrides!.tablet;
      delete expectedStory.payload.layout!.overrides!.mobile!.gap;
      expect(await saveStudioDraft(page)).toEqual(expected);
      await page.getByRole("combobox", { name: "目标模块", exact: true }).selectOption(hero.id);
      await page.getByRole("button", { name: "应用 Hero 文字版式", exact: true }).click();
      const expectedHero = expected.sections.find((section) => section.type === "HERO")!;
      for (const element of Object.values(expectedHero.payload.slides[0].elements)) {
        for (const field of ["fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const) {
          delete element.style[field];
          delete element.overrides.mobile!.style![field];
        }
      }
      expect(await saveStudioDraft(page)).toEqual(expected);
      const beforeCompare = await getDraft();
      const saves: string[] = [];
      const observeSave = (request: Request) => { if (request.method() === "PUT" && /\/admin\/homepage\/draft/.test(request.url())) saves.push(request.url()); };
      page.on("request", observeSave);
      await page.getByRole("checkbox", { name: "对比现有外观", exact: true }).check();
      await expect(page.locator("[data-homepage-live-preview] [data-homepage-appearance]")).toHaveCount(0);
      await expect(page.getByText("仅预览：正在对比现有外观", { exact: true })).toBeVisible();
      await page.getByRole("group", { name: "预览设备", exact: true }).getByRole("button", { name: zh.deviceMobile, exact: true }).click();
      await page.waitForTimeout(3500);
      expect(saves).toEqual([]);
      expect(await getDraft()).toEqual(beforeCompare);
      await page.getByRole("button", { name: "结束对比", exact: true }).click();
      await expect(page.locator('[data-homepage-live-preview] [data-homepage-appearance="STUDIO_V3"]')).toHaveCount(1);
      page.off("request", observeSave);
      await page.screenshot({ path: testInfo.outputPath("studio-scoped-conversion-mobile.png"), fullPage: true });
      const currentVersion = await adminPost<{ versionNo: number }>("/admin/homepage/publish", { note: unique("studio converted"), confirmWarnings: true });
      const versions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      const currentId = versions.find(({ versionNo }) => versionNo === currentVersion.versionNo)!.id;
      publishedIds.push(currentId);
      const detail = await adminGet<{ document: HomepageDocument }>(`/admin/homepage/versions/${currentId}`);
      expect(detail.document).toEqual(expected);
      await adminPost(`/admin/homepage/versions/${legacyId}/restore`);
      expect((await getDraft()).draft).toEqual(legacy);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, token, "content");
      await expect(page.locator("[data-homepage-appearance]")).toHaveCount(0);
      await waitForStorefrontHtml(hero.payload.slides[0].id);
      await page.goto(`${FRONTEND}/`);
      await expect(page.locator('[data-homepage-appearance="STUDIO_V3"]')).toHaveCount(1);
      expect((await adminGet<{ document: HomepageDocument }>(`/admin/homepage/versions/${legacyId}`)).document).toEqual(legacy);
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId, publishedIds);
    }
  });

  test("[studio-appearance] explicit zero spacing, width and background beat V3 defaults in eight real modules", async ({ page }) => {
    test.setTimeout(120_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    const types = ["USP", "SOLUTIONS", "BRAND_STORY", "CONFIDENCE", "ROOM_INSPIRATION", "PROMO_BANNER", "COUNTDOWN_BANNER", "UGC"];
    let publishedId: string | undefined;
    for (const section of fixture.document.sections) {
      if (types.includes(section.type)) section.style = { paddingTop: 30, paddingBottom: 20, contentWidth: "NARROW", backgroundColor: "#FAF6E9",
        overrides: { mobile: { paddingTop: 0, paddingBottom: 0, contentWidth: "FULL", backgroundColor: "#F0F3E9" } } };
    }
    fixture.document.defaults = { paddingTop: 42, overrides: { mobile: { paddingTop: 19 } } };
    try {
      await putDraft({ ...original, draft: fixture.document });
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", { note: unique("studio explicit styles"), confirmWarnings: true });
      publishedId = (await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions")).find(({ versionNo }) => versionNo === published.versionNo)!.id;
      await waitForStorefrontHtml(fixture.document.sections.find((section) => section.type === "HERO")!.payload.slides[0].id);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        let preview: unknown;
        for (const url of [`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}&view=content`, `${FRONTEND}/`]) {
          await page.goto(url);
          await expect(page.locator('[data-homepage-appearance="STUDIO_V3"]')).toBeVisible();
          const metrics = await page.locator('[data-homepage-appearance="STUDIO_V3"]').evaluate((root, sectionTypes) => sectionTypes.map((type) => {
            const section = root.querySelector(`[data-homepage-section-type="${type}"] [data-homepage-section-shell]`)!;
            const inner = section.querySelector("[data-homepage-confidence-inner]") ?? section;
            const outerStyle = getComputedStyle(section);
            const innerStyle = getComputedStyle(inner);
            return { type, paddingTop: outerStyle.paddingTop, paddingBottom: outerStyle.paddingBottom, background: outerStyle.backgroundColor,
              maxWidth: innerStyle.maxWidth, innerPadding: type === "CONFIDENCE" ? [innerStyle.paddingTop, innerStyle.paddingBottom] : null };
          }), types);
          for (const metric of metrics) {
            expect(metric.paddingTop, `${metric.type} top at ${width}`).toBe(width < 768 ? "0px" : "30px");
            expect(metric.paddingBottom, `${metric.type} bottom at ${width}`).toBe(width < 768 ? "0px" : "20px");
            expect(metric.maxWidth, `${metric.type} width at ${width}`).toBe(width < 768 ? "none" : "840px");
            expect(metric.background).toBe(width < 768 ? "rgb(240, 243, 233)" : "rgb(250, 246, 233)");
            if (metric.innerPadding) expect(metric.innerPadding).toEqual(["0px", "0px"]);
          }
          if (!preview) preview = metrics;
          else expect(metrics).toEqual(preview);
        }
      }
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId, publishedId ? [publishedId] : []);
    }
  });

  test("[studio-navigation] custom images and real collection/category targets survive editing and have circular hit areas", async ({ page }, testInfo) => {
    const original = await getDraft();
    const fixture = await studioFixture();
    let publishedId: string | undefined;
    try {
      const collections = await adminGet<{ items: { id: string; name: string; slug: string; status: string }[] }>("/admin/collections?pageSize=100");
      const collection = collections.items.find(({ status }) => status === "ACTIVE");
      if (!collection) throw new Error("Studio navigation requires a seeded active collection");
      const navigation = fixture.document.sections.find((section) => section.type === "CATEGORY_TILES")!;
      if (navigation.type !== "CATEGORY_TILES") throw new Error("Navigation type changed");
      const first = navigation.payload.entries![0];
      first.link = { type: "COLLECTION", id: collection.id };
      const categoriesBefore = await adminGet<unknown[]>("/admin/categories");
      await putDraft({ ...original, draft: fixture.document });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openBuilder(page);
      await page.locator('[data-pane="modules"]').getByText(navigation.title!, { exact: true }).click();
      const entry = page.locator(`[data-homepage-entry-id="${first.id}"]`);
      const type = entry.getByRole("combobox");
      expect(await type.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual(["", "CATEGORY", "COLLECTION"]);
      await type.selectOption("CATEGORY");
      await type.selectOption("COLLECTION");
      await entry.locator("ul").getByText(collection.name, { exact: true }).click();
      await entry.locator('input[id^="navigation-image-"]').fill(PHOTO_TALL_URL);
      await entry.locator('input[id^="navigation-image-"]').press("Tab");
      const saved = await saveStudioDraft(page);
      const savedNavigation = saved.sections.find(({ id }) => id === navigation.id)!;
      if (savedNavigation.type !== "CATEGORY_TILES") throw new Error("Navigation type changed");
      expect(savedNavigation.payload.entries![0]).toEqual({ ...first, imageUrl: PHOTO_TALL_URL });
      expect(await adminGet<unknown[]>("/admin/categories")).toEqual(categoriesBefore);
      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", { note: unique("studio navigation"), confirmWarnings: true });
      const versions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      publishedId = versions.find(({ versionNo }) => versionNo === published.versionNo)!.id;
      await waitForStorefrontHtml(first.id);
      await page.goto(`${FRONTEND}/`);
      const circle = page.locator(`[data-homepage-navigation-entry="${first.id}"] a`);
      await circle.scrollIntoViewIfNeeded();
      await expect(circle.locator("img")).toBeVisible();
      const geometry = await circle.evaluate((link) => {
        const rect = link.getBoundingClientRect();
        return { width: rect.width, height: rect.height,
          cornerOwnsLink: link.contains(document.elementFromPoint(rect.left + 1, rect.top + 1)),
          imageLoaded: (link.querySelector("img")?.naturalWidth ?? 0) > 0 };
      });
      expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(1);
      expect(geometry.cornerOwnsLink).toBe(false);
      expect(geometry.imageLoaded).toBe(true);
      await expect(circle).toHaveAttribute("href", `/collections/${collection.slug}`);
      await page.screenshot({ path: testInfo.outputPath("studio-navigation-circle.png"), fullPage: false });
      await Promise.all([page.waitForURL(`${FRONTEND}/collections/${collection.slug}`), circle.click()]);
      await page.goto(`${FRONTEND}/`);
      const categoryLink = page.locator(`[data-homepage-navigation-entry="${navigation.payload.entries![1].id}"] a`);
      const categoryHref = await categoryLink.getAttribute("href");
      expect(categoryHref).toMatch(/^\/categories\//);
      await Promise.all([page.waitForURL(`${FRONTEND}${categoryHref}`), categoryLink.click()]);
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId, publishedId ? [publishedId] : []);
    }
  });

  test("[studio-ugc] one through six photos retain featured identity and hide the overlay without clearing product associations", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    try {
      const ugc = fixture.document.sections.find((section) => section.type === "UGC")!;
      if (ugc.type !== "UGC") throw new Error("UGC type changed");
      const sampleProductId = ugc.payload.entries![0].productId;
      const entries = Array.from({ length: 6 }, (_, index) => ({ id: randomUUID(), imageUrl: index % 2 ? PHOTO_TALL_URL : PHOTO_WIDE_URL,
        name: index === 5 ? "Layout illustration ".repeat(5).trim() : `Layout sample ${index + 1}`,
        comment: index === 5 ? "Layout illustration only, not a customer review. ".repeat(24).slice(0, 1000) : `Layout illustration ${index + 1}, not a customer review.`,
        productId: sampleProductId }));
      for (let count = 1; count <= 6; count += 1) {
        ugc.payload.entries = entries.slice(0, count);
        const featured = entries[count - 1];
        ugc.payload.presentation = { layout: "COLLAGE", featuredEntryId: featured.id, showQuote: true, overlay: count % 2 ? "SOFT" : "STRONG" };
        await putDraft({ ...original, draft: fixture.document });
        const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await openSignedPreview(page, token, "content");
          const collage = page.locator("[data-ugc-layout]");
          await expect(collage.locator("figure")).toHaveCount(count);
          await expect(collage.locator("[data-ugc-featured]")).toHaveAttribute("data-ugc-entry-id", featured.id);
          await expect(collage.locator("blockquote")).toHaveText(`“${featured.comment}”`);
          const bounds = await collage.locator("[data-ugc-featured]").evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return [...node.querySelectorAll("blockquote, p, a")].map((element) => {
              const box = element.getBoundingClientRect();
              return { left: box.left - rect.left, right: rect.right - box.right, bottom: rect.bottom - box.bottom,
                overflow: element.scrollWidth - element.clientWidth };
            });
          });
          for (const box of bounds) {
            expect(box.left).toBeGreaterThanOrEqual(-1);
            expect(box.right).toBeGreaterThanOrEqual(-1);
            expect(box.bottom).toBeGreaterThanOrEqual(-1);
            expect(box.overflow).toBeLessThanOrEqual(1);
          }
          await assertNoPageOverflow(page, `UGC ${count} photos at ${width}`);
          if (count === 6) {
            await readStudioAppearance(page.locator('[data-homepage-appearance="STUDIO_V3"]'));
            await expect(collage.locator("img")).toHaveCount(count);
            for (const image of await collage.locator("img").all()) {
              expect(await image.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
            }
            await page.screenshot({ path: testInfo.outputPath(`studio-ugc-long-${width}.png`), fullPage: true });
          }
        }
      }
      ugc.payload.presentation!.showQuote = false;
      await putDraft({ ...original, draft: fixture.document });
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, token, "content");
      const featured = page.locator("[data-ugc-featured]");
      await expect(featured.locator("blockquote")).toHaveCount(0);
      await expect(featured.locator('a[href^="/products/"]')).toHaveCount(0);
      const hiddenSnapshot = (await getDraft()).draft.sections.find(({ id }) => id === ugc.id)!;
      if (hiddenSnapshot.type !== "UGC") throw new Error("UGC type changed");
      expect(hiddenSnapshot.payload.entries).toEqual(entries);
      ugc.payload.presentation = { layout: "CARDS" };
      await putDraft({ ...original, draft: fixture.document });
      const legacyToken = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, legacyToken.token, "content");
      await expect(page.locator('[data-homepage-role="ugc-grid"] figure')).toHaveCount(6);
      await expect(page.locator('[data-homepage-role="ugc-grid"] blockquote').last()).toContainText(entries[5].comment);
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId);
    }
  });

  test("[studio-ugc] SOFT and STRONG text meet contrast on actual bright and photo background pixels", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    const readImage = createRequire(resolve(__dirname, "../../backend/package.json"))("sharp");
    const luminance = (red: number, green: number, blue: number) => [red, green, blue].reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const measurements: { width: number; imageUrl: string; overlay: string; minimumContrast: number }[] = [];
    try {
      const ugc = fixture.document.sections.find((section) => section.type === "UGC")!;
      if (ugc.type !== "UGC") throw new Error("UGC type changed");
      ugc.payload.entries = [ugc.payload.entries![0]];
      for (const imageUrl of ["/uploads/e2e/studio-bright.svg", PHOTO_WIDE_URL]) {
        ugc.payload.entries[0].imageUrl = imageUrl;
        for (const overlay of ["SOFT", "STRONG"] as const) {
          ugc.payload.presentation = { layout: "COLLAGE", featuredEntryId: ugc.payload.entries[0].id, showQuote: true, overlay };
          await putDraft({ ...original, draft: fixture.document });
          const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
          for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await openSignedPreview(page, token, "content");
            const featured = page.locator("[data-ugc-featured]");
            await featured.scrollIntoViewIfNeeded();
            await featured.locator("img").evaluate((node) => (node as HTMLImageElement).decode());
            const quote = featured.locator("blockquote");
            const color = await quote.evaluate((node) => getComputedStyle(node).color.match(/[\d.]+/g)!.slice(0, 3).map(Number));
            const foreground = luminance(color[0], color[1], color[2]);
            const panel = quote.locator("..");
            const padding = await panel.evaluate((node) => {
              const style = getComputedStyle(node);
              return { x: parseFloat(style.paddingLeft), y: parseFloat(style.paddingTop) };
            });
            await panel.locator(":scope > *").evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLElement).style.visibility = "hidden"; }));
            let screenshot: Buffer;
            try { screenshot = await panel.screenshot(); }
            finally { await panel.locator(":scope > *").evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLElement).style.removeProperty("visibility"); })); }
            const { data, info } = await readImage(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            let minimumContrast = Infinity;
            for (let y = Math.ceil(padding.y); y < info.height - padding.y; y += 4) {
              for (let x = Math.ceil(padding.x); x < info.width - padding.x; x += 4) {
                const offset = (y * info.width + x) * info.channels;
                const background = luminance(data[offset], data[offset + 1], data[offset + 2]);
                minimumContrast = Math.min(minimumContrast, (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05));
              }
            }
            expect(Number.isFinite(minimumContrast)).toBe(true);
            expect(minimumContrast, `${overlay} at ${width} over ${imageUrl}`).toBeGreaterThanOrEqual(4.5);
            measurements.push({ width, imageUrl, overlay, minimumContrast });
            await featured.screenshot({ path: testInfo.outputPath(`studio-ugc-contrast-${imageUrl.endsWith("svg") ? "bright" : "photo"}-${overlay}-${width}.png`) });
          }
        }
      }
      await writeFile(testInfo.outputPath("studio-ugc-contrast.json"), JSON.stringify(measurements, null, 2));
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId);
    }
  });

  test("[studio-layout] editor panes retain a single settings scroller across short laptops, tablets and phones", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const original = await getDraft();
    const fixture = await studioFixture();
    const issues = collectConsoleIssues(page);
    try {
      await putDraft({ ...original, draft: fixture.document });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openBuilder(page);
      await page.getByRole("button", { name: "首页默认设置", exact: true }).click();
      for (const [width, height] of [[1470, 713], [1440, 900], [1366, 768], [1280, 650], [1024, 600], [768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height });
        if (width >= 768) await expect(page.locator("aside").first()).toBeVisible();
        const settingsTab = page.getByRole("tab", { name: zh.settings, exact: true });
        if (width < 1280) {
          await expect(settingsTab).toBeVisible();
          await settingsTab.click();
          await expect(settingsTab).toHaveAttribute("aria-selected", "true");
        }
        const pane = page.locator('[data-pane="settings"]');
        await expect(pane).toBeVisible();
        await pane.locator("[data-homepage-settings-scroll]").evaluate((node) => { node.scrollTop = node.scrollHeight; });
        const settingsHeader = pane.locator('[data-panel-head="settings"]');
        await expect(settingsHeader).toContainText("首页默认设置");
        await expect(settingsHeader).toContainText("桌面端");
        await expect(settingsHeader).toBeInViewport();
        const actions = page.getByTestId("homepage-status-bar");
        for (const name of ["撤销", "重做"]) {
          const action = actions.getByRole("button", { name, exact: true });
          await expect(action).toBeVisible();
          await expect(action).toBeInViewport();
          await expect(action).toBeDisabled();
        }
        const geometry = await pane.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const scrollers = [node, ...node.querySelectorAll("*")].filter((element) => {
            const style = getComputedStyle(element);
            return /^(auto|scroll)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
          });
          return { right: rect.right, bottom: rect.bottom, scrollers: scrollers.length };
        });
        expect(geometry.right).toBeLessThanOrEqual(width + 1);
        expect(geometry.bottom).toBeLessThanOrEqual(height + 1);
        expect(geometry.scrollers).toBe(1);
        await assertNoOuterAdminScroll(page, `Studio settings ${width}x${height}`);
        await assertNoPageOverflow(page, `Studio settings ${width}x${height}`);
        await page.screenshot({ path: testInfo.outputPath(`studio-editor-${width}x${height}.png`), fullPage: true });
      }
      expect(issues().pageErrors).toEqual([]);
      expect(issues().errors).toEqual([]);
    } finally {
      await restoreStudioSnapshot(page, original, fixture.categoryId);
    }
  });

  test("responsive controls save sparse device settings and expose real canvas metrics", async ({ page }, testInfo) => {
    const original = await getDraft();
    const issues = collectConsoleIssues(page);
    try {
      await saveResponsiveHeroFixture({ mobileLayout: true });
      const prepared = await getDraft();
      const hero = prepared.draft.sections.find((section) => section.type === "HERO")!;
      hero.title = "Living room hero";
      hero.payload.display = { heightMode: "SCREEN" };
      hero.style = { contentWidth: "FULL" };
      await putDraft(prepared);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openBuilder(page);
      await page.getByRole("button", { name: "Living room hero", exact: true }).click();
      await page.getByRole("button", { name: "E2E slide", exact: true }).click();
      const devices = page.getByRole("group", { name: "预览设备", exact: true });
      await devices.getByRole("button", { name: zh.deviceMobile, exact: true }).click();
      await page.getByRole("combobox", { name: "首屏高度", exact: true }).selectOption("NATURAL");
      await page.getByRole("combobox", { name: "适应方式", exact: true }).selectOption("CONTAIN");
      await page.getByRole("spinbutton", { name: "顶部间距（px）", exact: true }).fill("0");
      await page.getByRole("combobox", { name: "内容宽度", exact: true }).selectOption("STANDARD");
      await page.locator('[data-settings-group="layout"] > div > details > summary').click();
      await page.getByRole("combobox", { name: "遮罩渐变", exact: true }).selectOption("FULL");
      await page.getByRole("button", { name: zh.saveDraft, exact: true }).click();
      await expect.poll(async () => (await getDraft()).draft.sections.find((section) => section.type === "HERO")?.payload.display)
        .toEqual({ heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } });
      const saved = (await getDraft()).draft.sections.find((section) => section.type === "HERO")!;
      expect(saved.style).toEqual({ contentWidth: "FULL", overrides: { mobile: { paddingTop: 0, contentWidth: "STANDARD" } } });
      expect(saved.payload.slides[0].media?.fit).toBe("COVER");
      expect(saved.payload.slides[0].media?.fitOverrides).toEqual({ mobile: "CONTAIN" });
      expect(saved.payload.slides[0].overlay.gradient).toBe("LOCAL");
      expect(saved.payload.slides[0].overlay.overrides?.mobile?.gradient).toBe("FULL");
      const metrics = await page.locator("[data-preview-viewport]").evaluate((node) => ({
        width: (node as HTMLElement).offsetWidth,
        scale: new DOMMatrix(getComputedStyle(node).transform).a,
      }));
      await expect(page.locator("[data-preview-metrics]")).toHaveText(`缩放编辑预览 · ${metrics.width}px · ${Math.round(metrics.scale * 100)}%`);
      expect(metrics.width).toBe(390);
      await devices.getByRole("button", { name: zh.deviceDesktop, exact: true }).click();
      await expect(page.getByRole("combobox", { name: "首屏高度", exact: true })).toHaveValue("SCREEN");
      await expect(page.getByRole("combobox", { name: "适应方式", exact: true })).toHaveValue("COVER");
      await devices.getByRole("button", { name: zh.deviceMobile, exact: true }).click();
      await page.getByRole("button", { name: "恢复首屏展示继承", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "首屏高度", exact: true })).toHaveValue("SCREEN");
      await expect(page.getByRole("combobox", { name: "适应方式", exact: true })).toHaveValue("CONTAIN");
      await page.getByRole("button", { name: zh.saveDraft, exact: true }).click();
      await expect.poll(async () => (await getDraft()).draft.sections.find((section) => section.type === "HERO")?.payload.display).toEqual({ heightMode: "SCREEN" });
      await assertNoPageOverflow(page, "responsive editor controls");
      await page.screenshot({ path: testInfo.outputPath("responsive-editor-controls.png"), fullPage: true });
      expect(issues().errors).toEqual([]);
      expect(issues().pageErrors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      await putDraft(original);
    }
  });

  test("one independent preview action opens true desktop, tablet and mobile iframe viewports without customer side effects", async ({ page, context }, testInfo) => {
    const original = await getDraft();
    const fixture = await studioFixture();
    const forbidden: string[] = [];
    const referrers: string[] = [];
    const errors: string[] = [];
    const popups: Page[] = [];
    const previewDocuments: Array<{ url: string; cacheControl: string }> = [];
    const inspectResponse = (response: PlaywrightResponse) => {
      if (!response.request().isNavigationRequest() || new URL(response.url()).pathname !== "/preview/homepage") return;
      previewDocuments.push({ url: response.url(), cacheControl: response.headers()["cache-control"] ?? "" });
    };
    const track = (request: Request) => {
      if (!request.isNavigationRequest() && request.frame().page() === page) return;
      if (isTrackingRequest(request) || isCustomerStateRequest(request)) forbidden.push(new URL(request.url()).pathname);
      const referrer = request.headers().referer;
      if (referrer?.includes("token=")) referrers.push("token-bearing referrer");
    };
    const watch = (popup: Page) => { popups.push(popup); popup.on("pageerror", (error) => errors.push(error.message)); };
    try {
      const prepared = { ...original, draft: fixture.document };
      prepared.draft.sections.find((section) => section.type === "HERO")!.payload.slides[0].elements.heading.text = "Thoughtful furniture for everyday living";
      await putDraft(prepared);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openBuilder(page);
      await context.addInitScript(() => {
        if (location.pathname !== "/preview/homepage") return;
        const writes: string[] = [];
        Object.defineProperty(window, "__hpPreviewWrites", { value: writes });
        for (const method of ["setItem", "removeItem", "clear"] as const) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args: string[]) {
            writes.push(`storage.${method}`);
            return Reflect.apply(original, this, args);
          };
        }
        const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
        Object.defineProperty(document, "cookie", {
          get: () => cookie.get!.call(document),
          set: (value: string) => { writes.push("cookie"); cookie.set!.call(document, value); },
        });
      });
      context.on("request", track);
      context.on("response", inspectResponse);
      context.on("page", watch);
      for (const view of ["desktop", "tablet", "mobile"] as const) {
        const devices = page.getByRole("group", { name: "预览设备", exact: true });
        await devices.getByRole("button", { name: view === "mobile" ? zh.deviceMobile : view === "tablet" ? zh.deviceTablet : zh.deviceDesktop, exact: true }).click();
        const opened = context.waitForEvent("page");
        await devices.getByRole("button", { name: "独立预览", exact: true }).click();
        const popup = await opened;
        await popup.setViewportSize({ width: 1440, height: 900 });
        const frame = popup.frameLocator("iframe");
        await expect(frame.getByRole("heading", { name: "Thoughtful furniture for everyday living", exact: true })).toBeVisible();
        expect(new URL(popup.url()).searchParams.get("view")).toBe(view);
        const iframe = popup.locator("iframe");
        await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
        expect(await iframe.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
        expect(await frame.locator("body").evaluate(() => window.innerWidth)).toBe(view === "mobile" ? 390 : view === "tablet" ? 768 : 1440);
        await expect(frame.locator("[data-draft-preview-banner]")).toHaveCount(0);
        await expect(frame.locator("[data-storefront-preview-shell] header")).toBeVisible();
        await expect(frame.locator("[data-storefront-preview-shell] footer")).toBeAttached();
        await expect(frame.locator("[data-homepage-navigation-entry] a")).toHaveCount(6);
        await assertPreviewInert(frame.locator("[data-storefront-preview-shell]"));
        const token = new URL(popup.url()).searchParams.get("token");
        const documents = previewDocuments.filter((document) => new URL(document.url).searchParams.get("token") === token);
        expect(documents.map((document) => new URL(document.url).searchParams.get("view")).sort()).toEqual([view, "content"].sort());
        expect(documents.every((document) => document.cacheControl.includes("private") && document.cacheControl.includes("no-store"))).toBe(true);
        if (view !== "desktop") {
          await popup.screenshot({ path: testInfo.outputPath(`independent-${view}-desktop-window.png`), fullPage: true });
          await popup.setViewportSize({ width: 375, height: 812 });
          await expect.poll(() => frame.locator("body").evaluate(() => window.innerWidth)).toBe(375);
          await assertNoPageOverflow(popup, "375px preview wrapper");
          expect(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          await popup.screenshot({ path: testInfo.outputPath(`independent-${view}-375.png`), fullPage: true });
        }
        for (const document of popup.frames()) {
          expect(await document.evaluate(() => (window as unknown as { __hpPreviewWrites: string[] }).__hpPreviewWrites), "wrapper and content never write shopper state").toEqual([]);
        }
        await popup.close();
      }
      expect(forbidden).toEqual([]);
      expect(referrers).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      context.off("request", track); context.off("response", inspectResponse); context.off("page", watch);
      try {
        for (const popup of popups) if (!popup.isClosed()) await popup.close();
        if (!page.isClosed()) await page.goto("about:blank");
      } finally { await restoreStudioSnapshot(page, original, fixture.categoryId); }
    }
  });

  test("independent preview rejects a token made stale between wrapper and child navigation", async ({ page }) => {
    const original = await getDraft();
    try {
      await savePublishableDraft("Private draft before revision change");
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      let changed = false;
      await page.route("**/preview/homepage?**", async (route) => {
        if (new URL(route.request().url()).searchParams.get("view") === "content" && !changed) {
          changed = true;
          const next = await getDraft();
          next.draft.announcement.rotationMs = next.draft.announcement.rotationMs === 5000 ? 5001 : 5000;
          await putDraft(next);
        }
        await route.continue();
      });
      const response = await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}&view=mobile`);
      expect(response?.status()).toBe(200);
      const child = page.frameLocator("iframe");
      await expect(child.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      await expect(child.locator("[data-storefront-preview-shell]")).toHaveCount(0);
      await expect(child.locator("[data-preview-section-id]")).toHaveCount(0);
      expect(changed).toBe(true);
      expect((await page.reload())?.status()).toBe(404);
      await expect(page.locator("iframe")).toHaveCount(0);
    } finally { await page.unrouteAll(); await putDraft(original); }
  });

  test("production preview responses retain privacy headers and reject invalid view queries", async ({ request }) => {
    test.skip(process.env.HOMEPAGE_PRODUCTION_GATE !== "1", "requires the production-build runtime");
    const original = await getDraft();
    try {
      await saveResponsiveHeroFixture();
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const encoded = encodeURIComponent(token);
      for (const suffix of ["", "&view=desktop", "&view=mobile", "&view=content", "&view=", "&view=unknown", "&view=mobile&view=content", `&token=${encoded}`]) {
        const response = await request.get(`${FRONTEND}/preview/homepage?token=${encoded}${suffix}`);
        const invalid = suffix === "&view=" || suffix.includes("unknown") || suffix.includes("&view=mobile&view=content") || suffix.startsWith("&token=");
        expect(response.status(), `view gate ${suffix.startsWith("&token=") ? "duplicate-token" : suffix}`).toBe(invalid ? 404 : 200);
        expect(response.headers()["cache-control"]).toContain("private");
        expect(response.headers()["cache-control"]).toContain("no-store");
        expect(response.headers()["referrer-policy"]).toBe("no-referrer");
        const html = await response.text();
        expect(/name="robots" content="[^"]*noindex/.test(html)).toBe(true);
        if (invalid) expect(html.includes(RESPONSIVE_HEADING)).toBe(false);
      }
      for (const endpoint of ["homepage", "announcement"]) {
        for (const query of [`previewToken=${encoded}`, "previewToken=invalid", `previewToken=${encoded}&previewToken=${encoded}`]) {
          const response = await request.get(`${API}/storefront/${endpoint}?${query}`);
          expect(response.status()).toBe(query === `previewToken=${encoded}` ? 200 : 404);
          expect(response.headers()["cache-control"]).toBe("private, no-store");
        }
      }
    } finally { await putDraft(original); }
  });

  test("the published real-photo homepage retains the signed draft layout on desktop and mobile", async ({ page }, testInfo) => {
    const original = await getDraft();
    const issues = collectConsoleIssues(page);
    let publishedId: string | null = null;
    try {
      await saveResponsiveHeroFixture({ mobileLayout: true });
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
        note: "responsive real-photo visual acceptance", publishAt: null, unpublishAt: null, confirmWarnings: true,
      });
      const versions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      publishedId = versions.find((version) => version.versionNo === published.versionNo)!.id;
      await waitForStorefrontHeading(RESPONSIVE_HEADING);
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await openSignedPreview(page, token);
        const preview = await readHeroLayout(page);
        await page.goto(`${FRONTEND}/`);
        await expect(page.getByRole("heading", { name: RESPONSIVE_HEADING, exact: true })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const live = await readHeroLayout(page);
        expectHeroReadable(live, `published photo at ${viewport.width}`);
        expect(live.hero.width).toBeCloseTo(preview.hero.width, 1);
        expect(live.mediaFit).toBe(preview.mediaFit);
        expect(live.mediaPosition).toBe(preview.mediaPosition);
        expect(live.boxes.map(({ key, box }) => ({ key, width: box.width }))).toEqual(preview.boxes.map(({ key, box }) => ({ key, width: box.width })));
        await assertNoPageOverflow(page, `published real photo at ${viewport.width}`);
        await page.screenshot({ path: testInfo.outputPath(`public-real-photo-${viewport.width}.png`), fullPage: true });
      }
      expect(issues().errors).toEqual([]);
      expect(issues().pageErrors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      try { if (publishedId) await adminPost(`/admin/homepage/versions/${publishedId}/unpublish`); }
      finally { await restoreHomepageSnapshot(original); }
    }
  });

  test("a real-photo hero keeps long copy readable over the image across viewports and rotation", async ({ page }, testInfo) => {
    const original = await getDraft();
    const issues = collectConsoleIssues(page);
    try {
      await saveResponsiveHeroFixture();
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      for (const viewport of [
        { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 },
        { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await openSignedPreview(page, token);
        await expect(page.locator('div[data-hero-element="heading"]')).toContainText("Thoughtful furniture");
        const layout = await readHeroLayout(page);
        const label = `hero ${viewport.width}x${viewport.height}`;
        // The real photo (1800x1350) is what the browser measured, not a placeholder.
        expect(layout.mediaRatio, `${label}: loaded media ratio`).toBeCloseTo(1800 / 1350, 2);
        expect(layout.mediaFit, `${label}: cover fit compiled`).toBe("cover");
        expectHeroReadable(layout, label);
        expect(intersect(layout.boxes[0].box, layout.media!), `${label}: copy stays over the image`).toBe(true);
        await page.evaluate(() => document.fonts.ready);
        for (const fit of await heroWordFit(page)) {
          expect(
            fit.contentWidth,
            `${label}: ${fit.key} (${fit.contentWidth.toFixed(0)}px) is narrower than its longest word (${fit.longestWord.toFixed(0)}px)`,
          ).toBeGreaterThanOrEqual(fit.longestWord - 1);
          if (fit.key.startsWith("cta") && fit.fullText <= fit.available) {
            expect(fit.lines, `${label}: ${fit.key} wraps although its label fits on one line`).toBe(1);
          }
        }
        await assertNoPageOverflow(page, label);
        if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath("hero-real-photo-390.png"), fullPage: true });
        if (viewport.width === 375) await page.screenshot({ path: testInfo.outputPath("hero-real-photo-375.png"), fullPage: true });
        if (viewport.width === 1440) await page.screenshot({ path: testInfo.outputPath("hero-real-photo-1440.png"), fullPage: true });
        if (viewport.width === 768) await page.screenshot({ path: testInfo.outputPath("hero-real-photo-768.png"), fullPage: true });
        if (viewport.width === 390 || viewport.width === 1440) {
          const root = page.locator("[data-hero-slider]").first();
          const tag = `hero-${viewport.width}`;
          const text = await root.evaluate((hero) => {
            const bounds = hero.getBoundingClientRect();
            const samples: { key: string; color: string; fontSize: number; weight: number; rects: { x: number; y: number; width: number; height: number }[] }[] = [];
            for (const element of hero.querySelectorAll<HTMLElement>("[data-hero-element]")) {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let node: Node | null;
              while ((node = walker.nextNode())) {
                if (!node.textContent?.trim() || !node.parentElement) continue;
                const style = getComputedStyle(node.parentElement);
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
                  x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height,
                }));
                if (rects.length) samples.push({ key: element.dataset.heroElement!, color: style.color, fontSize: parseFloat(style.fontSize), weight: parseFloat(style.fontWeight), rects });
              }
            }
            return samples;
          });
          await writeFile(testInfo.outputPath(`contrast-${tag}.json`), JSON.stringify(text, null, 2));
          const mask = await page.addStyleTag({ content: "[data-hero-element], [data-hero-element] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }" });
          try { await root.screenshot({ path: testInfo.outputPath(`contrast-${tag}-background.png`) }); }
          finally { await mask.evaluate((node) => (node as HTMLStyleElement).remove()); }
        }
      }
      // Rotation: re-measure after the viewport flips rather than trusting the first pass.
      await page.setViewportSize({ width: 390, height: 844 });
      await openSignedPreview(page, token);
      const portrait = await readHeroLayout(page);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => window.innerWidth === 844);
      const landscape = await readHeroLayout(page);
      expectHeroReadable(landscape, "rotated hero");
      expect(landscape.hero.width).toBeGreaterThan(portrait.hero.width);
      expect(landscape.mediaFit).toBe("cover");
      expect(issues().errors).toEqual([]);
      expect(issues().pageErrors).toEqual([]);
    } finally { await page.goto("about:blank"); await restoreHomepageSnapshot(original); }
  });

  test("[studio-appearance] V3 real-photo long copy remains whole and readable across viewport rotation", async ({ page }, testInfo) => {
    const original = await getDraft();
    try {
      await saveResponsiveHeroFixture({ appearance: "STUDIO_V3" });
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      for (const viewport of [
        { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 },
        { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await openSignedPreview(page, token);
        await expect(page.locator('[data-homepage-appearance="STUDIO_V3"]')).toBeAttached();
        expectHeroReadable(await readHeroLayout(page), `V3 long copy ${viewport.width}x${viewport.height}`);
        for (const fit of await heroWordFit(page)) {
          expect(fit.contentWidth, `V3 ${viewport.width}: ${fit.key} must fit its longest word`).toBeGreaterThanOrEqual(fit.longestWord - 1);
          if (fit.key.startsWith("cta") && fit.fullText <= fit.available) expect(fit.lines).toBe(1);
        }
        await assertNoPageOverflow(page, `V3 long copy ${viewport.width}`);
        if (viewport.width === 390 || viewport.width === 1440) {
          await page.screenshot({ path: testInfo.outputPath(`studio-hero-long-${viewport.width}.png`), fullPage: true });
        }
      }
    } finally {
      try { if (!page.isClosed()) await page.goto("about:blank"); }
      finally { await restoreHomepageSnapshot(original); }
    }
  });

  test("natural ratio, the mobile image override and a video hero all keep the copy over media", async ({ page }, testInfo) => {
    const original = await getDraft();
    try {
      await saveResponsiveHeroFixture({ mobileOverride: true, naturalMobile: true, focalExtremes: true, mobileLayout: true });
      expect((await draftHero()).payload.slides[0].elements.heading.layout.xPct, "visual fixture must not inherit an earlier drag").toBe(7.4);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await page.setViewportSize({ width: 390, height: 844 });
      await openSignedPreview(page, token);
      await expect(page.locator('div[data-hero-element="heading"]')).toContainText("Thoughtful furniture");
      const mobile = await readHeroLayout(page);
      expect(mobile.mediaPosition, "mobile focal follows its own device value").toBe("0% 0%");
      expect(mobile.mediaSrc, "mobile uses its own image").toContain("hero-photo-tall.jpg");
      expect(mobile.mediaRatio, "tall fixture ratio").toBeCloseTo(1200 / 1800, 2);
      // NATURAL never crops the tall subject vertically.
      expect(mobile.hero.height, "natural height follows the tall image").toBeGreaterThanOrEqual(mobile.hero.width * 1.5 - 2);
      expectHeroReadable(mobile, "natural mobile hero");
      await page.screenshot({ path: testInfo.outputPath("hero-natural-mobile-390.png"), fullPage: true });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openSignedPreview(page, token);
      const desktop = await readHeroLayout(page);
      expect(desktop.mediaSrc, "desktop keeps the common image").toContain("hero-photo-wide.jpg");
      expect(desktop.mediaPosition, "desktop focal follows the other end").toBe("100% 100%");
      expectHeroReadable(desktop, "desktop hero");

      await saveResponsiveHeroFixture({ video: true });
      const video = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      for (const reduced of [false, true]) {
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await page.setViewportSize({ width: 390, height: 844 });
        await openSignedPreview(page, video.token);
        await expect(page.locator('div[data-hero-element="heading"]')).toContainText("Thoughtful furniture");
        const layout = await readHeroLayout(page);
        expect(layout.mediaTag, "video element rendered").toBe("VIDEO");
        expect(layout.mediaPoster, "poster keeps a real frame").toContain("hero-photo-wide.jpg");
        expectHeroReadable(layout, `video hero (reduced=${reduced})`);
        await assertNoPageOverflow(page, `video hero (reduced=${reduced})`);
      }
      await page.emulateMedia({ reducedMotion: null });
      await page.screenshot({ path: testInfo.outputPath("hero-video-mobile-390.png"), fullPage: true });
    } finally { await page.goto("about:blank"); await restoreHomepageSnapshot(original); }
  });

  test("unbroken headings and long CTA labels wrap inside the readable hero safe area", async ({ page }) => {
    const original = await getDraft();
    try {
      await saveResponsiveHeroFixture({ mobileOverride: true, naturalMobile: true });
      const snapshot = await getDraft();
      const hero = snapshot.draft.sections.find((section) => section.type === "HERO")!;
      const slide = hero.payload.slides[0];
      slide.elements.heading.text = "ThoughtfullyCraftedFurnitureForEverydayLivingInASmallerHome";
      slide.elements.ctaPrimary.text = "ExploreEveryThoughtfullyCraftedFurnitureCollection";
      slide.elements.ctaPrimary.button.paddingX = 48;
      slide.elements.ctaSecondary.text = "Book a personal design consultation for your smaller home";
      await putDraft(snapshot);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      for (const width of [375, 390, 430]) {
        await page.setViewportSize({ width, height: 812 });
        await openSignedPreview(page, token);
        const layout = await readHeroLayout(page);
        expectHeroReadable(layout, `unbroken copy at ${width}`);
        for (const content of await page.locator("[data-hero-element]").evaluateAll((nodes) => nodes.map((node) => ({
          key: (node as HTMLElement).dataset.heroElement,
          width: (node as HTMLElement).clientWidth,
          content: (node as HTMLElement).scrollWidth,
        })))) {
          expect(content.content, `${content.key} text must not be clipped`).toBeLessThanOrEqual(content.width + 1);
        }
        await assertNoPageOverflow(page, `unbroken copy at ${width}`);
      }
    } finally { await page.goto("about:blank"); await restoreHomepageSnapshot(original); }
  });

  test("display and layout JSON survives save, reload, preview, publish, history and restore", async ({ page }) => {
    const original = await getDraft();
    try {
      // A legacy baseline published BEFORE any new field exists. Fresh factory
      // sections already carry the new defaults, so strip them explicitly.
      await savePublishableDraft(unique("E2E LEGACY BASE"));
      const legacySnapshot = await getDraft();
      const legacyHero = legacySnapshot.draft.sections.find((section) => section.type === "HERO");
      if (!legacyHero || legacyHero.type !== "HERO") throw new Error("legacy baseline requires HERO");
      delete legacyHero.payload.display;
      await putDraft(legacySnapshot);
      const legacy = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
        note: unique("legacy base"), publishAt: null, unpublishAt: null, confirmWarnings: true,
      });

      await saveResponsiveHeroFixture({ mobileOverride: true, naturalMobile: true });
      const fixture = await getDraft();
      const category = defaultSection("CATEGORY_TILES", randomUUID(), 10);
      category.payload = { categoryIds: [], layout: { gap: 12, overrides: { mobile: { gap: 0, imageRatio: "PORTRAIT" } } } };
      category.style = { contentWidth: "STANDARD", overrides: { mobile: { paddingTop: 0 } } };
      const grid = defaultSection("PRODUCT_GRID", randomUUID(), 20);
      grid.payload = { columns: 2, layout: { overrides: { mobile: { columns: 1 } } } };
      fixture.draft.sections = [...fixture.draft.sections, category, grid];
      fixture.draft.defaults = { paddingTop: 30, overrides: { mobile: { paddingTop: 0 } } };
      await putDraft(fixture);

      // Reload the editor: the controls read the saved values back.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openBuilder(page);
      const devices = page.getByRole("group", { name: "预览设备", exact: true });
      await devices.getByRole("button", { name: zh.deviceMobile, exact: true }).click();
      await expect(page.getByRole("combobox", { name: "首屏高度", exact: true })).toHaveValue("NATURAL");

      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, token);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => (await readHeroLayout(page)).mediaSrc).toContain("hero-photo-tall.jpg");
      const saved = await draftHero();
      expect(saved.payload.display).toEqual({ heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } });
      expect(saved.payload.slides[0].media?.fitOverrides).toEqual({ mobile: "CONTAIN" });
      expect(saved.payload.slides[0].media?.mobileOverride.image?.url).toBe(PHOTO_TALL_URL);

      const published = await adminPost<{ versionNo: number }>("/admin/homepage/publish", {
        note: unique("responsive display"), publishAt: null, unpublishAt: null, confirmWarnings: true,
      });
      const versions = await adminGet<{ id: string; versionNo: number }[]>("/admin/homepage/versions");
      const publishedRow = versions.find((row) => row.versionNo === published.versionNo);
      expect(publishedRow, "published version listed").toBeTruthy();
      const detail = await adminGet<{ document: HomepageDocument }>(`/admin/homepage/versions/${publishedRow!.id}`);
      const storedHero = detail.document.sections.find((section) => section.type === "HERO");
      expect(storedHero && storedHero.type === "HERO" ? storedHero.payload.display : null)
        .toEqual({ heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } });
      const storedGrid = detail.document.sections.find((section) => section.type === "PRODUCT_GRID");
      expect(storedGrid && storedGrid.type === "PRODUCT_GRID" ? storedGrid.payload.layout : null)
        .toEqual({ overrides: { mobile: { columns: 1 } } });
      expect(detail.document.defaults).toEqual({ paddingTop: 30, overrides: { mobile: { paddingTop: 0 } } });

      // Restoring the legacy version leaves the new fields absent, not defaulted.
      const legacyRow = versions.find((row) => row.versionNo === legacy.versionNo)!;
      await adminPost(`/admin/homepage/versions/${legacyRow.id}/restore`);
      const restored = await draftHero();
      expect(restored.payload.display).toBeUndefined();
      expect(restored.payload.slides[0].media?.fitOverrides).toBeUndefined();
      const legacyPreview = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, legacyPreview.token);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('div[data-hero-element="heading"]')).toBeVisible();
      expect(await page.locator("[data-hero-height-mode]").count()).toBe(0);
      await assertNoPageOverflow(page, "legacy restored preview");

      // Restoring the responsive version brings every field back intact.
      await adminPost(`/admin/homepage/versions/${publishedRow!.id}/restore`);
      const roundTrip = await draftHero();
      expect(roundTrip.payload.display).toEqual({ heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } });
      expect(roundTrip.payload.slides[0].media?.mobileOverride.image?.url).toBe(PHOTO_TALL_URL);
      const backPreview = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await openSignedPreview(page, backPreview.token);
      await expect.poll(async () => (await readHeroLayout(page)).mediaSrc).toContain("hero-photo-tall.jpg");
      expect(await page.locator("[data-hero-height-mode]").count()).toBeGreaterThan(0);
    } finally { await page.goto("about:blank"); await restoreHomepageSnapshot(original); }
  });

  test("responsive Hero SCREEN uses real mobile shell space and contains long copy", async ({ page }) => {
    const original = await getDraft();
    try {
      await savePublishableDraft("Thoughtful furniture for everyday living in a smaller home");
      const snapshot = await getDraft();
      const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
      if (!hero || hero.type !== "HERO") throw new Error("responsive fixture requires HERO");
      hero.style = { ...hero.style, contentWidth: "FULL" };
      hero.payload.display = { heightMode: "SCREEN" };
      hero.payload.slides[0].overlay.overrides = { mobile: { gradient: "LOCAL", opacity: 0.65 } };
      await putDraft(snapshot);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
      const root = page.locator("[data-hero-slider]").first();
      await expect(root).toBeVisible();
      await expect.poll(() => root.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(600);
      const metrics = await root.evaluate((node) => {
        const hero = node.getBoundingClientRect();
        return [...node.querySelectorAll<HTMLElement>("[data-hero-element]")]
          .filter((element) => element.innerText.trim() !== "")
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { key: element.dataset.heroElement, inside: box.left >= hero.left &&
              box.right <= hero.right + 1 && box.top >= hero.top && box.bottom <= hero.bottom + 1 };
          });
      });
      expect(metrics.every(({ inside }) => inside), JSON.stringify(metrics)).toBe(true);
      await assertNoPageOverflow(page, "responsive mobile Hero");
    } finally {
      await restoreHomepageSnapshot(original);
    }
  });
  test("responsive Hero keeps overlay copy and touch targets safe across fit, height and viewport changes", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const original = await getDraft();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/uploads/e2e/responsive-*.svg", async (route) => {
      const tall = route.request().url().includes("responsive-3-2");
      await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${tall ? 600 : 300}"><rect width="100%" height="100%" fill="#819488"/><rect x="400" y="100" width="360" height="150" rx="15" fill="#dcc6a4"/></svg>` });
    });
    const measurements: unknown[] = [];
    try {
      await savePublishableDraft("Thoughtfully designed furniture that makes everyday living calmer, more comfortable and more spacious in a smaller home");
      for (const ratio of ["3-2", "3-1"] as const) {
        for (const fit of ["COVER", "CONTAIN"] as const) {
          for (const heightMode of ["SCREEN", "BANNER", "NATURAL"] as const) {
            const snapshot = await getDraft();
            const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
            if (!hero || hero.type !== "HERO") throw new Error("responsive fixture requires HERO");
            hero.style = { contentWidth: "FULL" };
            hero.payload.display = { heightMode };
            hero.payload.behavior.autoplay = false;
            const slide = hero.payload.slides[0];
            slide.media!.image = { url: `/uploads/e2e/responsive-${ratio}.svg`, alt: "Furniture display" };
            slide.media!.fit = fit;
            slide.elements.heading.style = { fontSize: 28, lineHeight: 1.2 };
            slide.elements.heading.layout = { ...slide.elements.heading.layout, xPct: 8, yPct: 8, widthPct: 84, align: "LEFT" };
            slide.elements.ctaPrimary.text = "Explore furniture";
            slide.elements.ctaSecondary.text = "Find your inspiration";
            slide.elements.ctaPrimary.layout = { ...slide.elements.ctaPrimary.layout, xPct: 8, yPct: 36, widthPct: 38, align: "LEFT" };
            slide.elements.ctaSecondary.layout = { ...slide.elements.ctaSecondary.layout, xPct: 54, yPct: 36, widthPct: 38, align: "LEFT" };
            slide.elements.ctaPrimary.button = { ...slide.elements.ctaPrimary.button!, paddingY: 2 };
            slide.elements.ctaSecondary.button = { ...slide.elements.ctaSecondary.button!, paddingY: 2 };
            await putDraft(snapshot);
            const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
            for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
              const label = `${ratio}/${fit}/${heightMode}/${viewport.width}x${viewport.height}`;
              await page.setViewportSize(viewport);
              await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
              const root = page.locator("[data-hero-slider]").first();
              await expect(root).toHaveAttribute("data-readable-ready", "true");
              await expect.poll(() => root.locator("[data-hero-media] img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(900);
              const metrics = await root.evaluate((node) => {
                const hero = node.getBoundingClientRect();
                const boxes = [...node.querySelectorAll<HTMLElement>("[data-hero-element]")]
                  .filter((element) => element.innerText.trim() !== "")
                  .map((element) => {
                    const box = element.getBoundingClientRect();
                    const child = element.querySelector<HTMLElement>("a, span");
                    const target = child?.getBoundingClientRect();
                    return { key: element.dataset.heroElement!, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
                      inside: box.left >= hero.left - 1 && box.right <= hero.right + 1 && box.top >= hero.top - 1 && box.bottom <= hero.bottom + 1,
                      targetHeight: target?.height ?? null, targetInside: !target || (target.left >= hero.left - 1 && target.right <= hero.right + 1) };
                  });
                const image = node.querySelector<HTMLImageElement>("[data-hero-media] img")!;
                const media = image.parentElement!.getBoundingClientRect();
                const intersects = boxes.some((box, i) => boxes.slice(i + 1).some((other) =>
                  box.left < other.right - 1 && box.right > other.left + 1 && box.top < other.bottom - 1 && box.bottom > other.top + 1));
                return { boxes, intersects, fit: getComputedStyle(image).objectFit, overlay: media.top <= hero.top + 1 && media.bottom >= hero.bottom - 1, height: hero.height };
              });
              measurements.push({ label, ...metrics });
              expect(metrics.boxes.every((box) => box.inside && box.targetInside), label + JSON.stringify(metrics)).toBe(true);
              expect(metrics.intersects, label).toBe(false);
              expect(metrics.overlay, label).toBe(true);
              expect(metrics.fit, label).toBe(fit.toLowerCase());
              for (const box of metrics.boxes.filter((box) => box.key.startsWith("cta"))) expect(box.targetHeight, `${label}/${box.key}`).toBeGreaterThanOrEqual(44);
              await assertNoPageOverflow(page, label);
              if (viewport.width === 375 && ratio === "3-1" && fit === "CONTAIN" && heightMode === "NATURAL") {
                await page.screenshot({ path: testInfo.outputPath("hero-mobile-long-copy.png"), fullPage: true });
              }
            }
          }
        }
      }
      expect(errors.filter((error) => /ResizeObserver|Maximum update depth|hydration/i.test(error))).toEqual([]);
      await testInfo.attach("hero-responsive-matrix", { body: JSON.stringify({ measurements, errors }, null, 2), contentType: "application/json" });
    } finally {
      await restoreHomepageSnapshot(original);
    }
  });

  test("responsive Hero NATURAL follows loaded image ratio at standard content width", async ({ page }) => {
    const original = await getDraft();
    await page.route("**/uploads/e2e/responsive-natural.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="900" height="300" fill="#819488"/></svg>' }));
    try {
      await savePublishableDraft("Calm living");
      const snapshot = await getDraft();
      const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
      if (!hero || hero.type !== "HERO") throw new Error("responsive fixture requires HERO");
      hero.style = { contentWidth: "STANDARD" };
      hero.payload.display = { heightMode: "NATURAL" };
      const slide = hero.payload.slides[0];
      for (const element of Object.values(slide.elements)) element.text = "";
      slide.elements.heading.text = "Calm living";
      slide.elements.heading.style = { fontSize: 20 };
      slide.elements.heading.layout = { ...slide.elements.heading.layout, xPct: 8, yPct: 8, widthPct: 84 };
      slide.media!.image = { url: "/uploads/e2e/responsive-natural.svg", alt: "Wide furniture image" };
      await putDraft(snapshot);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
      const root = page.locator("[data-hero-slider]").first();
      await expect(root).toHaveAttribute("data-readable-ready", "true");
      await expect.poll(() => root.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return Math.abs(box.height - box.width / 3);
      })).toBeLessThanOrEqual(1);
      expect(await root.evaluate((node) => node.clientWidth)).toBeLessThan(1440);
      await assertNoPageOverflow(page, "standard NATURAL image");
    } finally { await restoreHomepageSnapshot(original); }
  });

  test("responsive Hero keeps long copy over the image with JavaScript disabled", async ({ browser }, testInfo) => {
    const original = await getDraft();
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
    try {
      await savePublishableDraft("Thoughtfully designed furniture that makes everyday living calmer, more comfortable and more spacious in a smaller home");
      const snapshot = await getDraft();
      const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
      if (!hero || hero.type !== "HERO") throw new Error("responsive fixture requires HERO");
      hero.payload.display = { heightMode: "SCREEN" };
      hero.payload.slides[0].elements.ctaPrimary.text = "Explore furniture";
      await putDraft(snapshot);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const page = await context.newPage();
      await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
      const root = page.locator("[data-hero-slider]").first();
      await expect(root.getByText("Explore furniture")).toBeVisible();
      const safe = await root.evaluate((node) => {
        const hero = node.getBoundingClientRect();
        const media = node.querySelector<HTMLElement>("[data-hero-media]")!.getBoundingClientRect();
        return [...node.querySelectorAll<HTMLElement>("[data-hero-element]")].filter((element) => element.innerText.trim()).every((element) => {
          const box = element.getBoundingClientRect();
          return box.left >= hero.left && box.right <= hero.right + 1 && box.top >= hero.top && box.bottom <= hero.bottom + 1 && media.top <= box.top && media.bottom >= box.bottom - 1;
        });
      });
      expect(safe).toBe(true);
      await assertNoPageOverflow(page, "SSR over-image copy");
      await page.screenshot({ path: testInfo.outputPath("hero-mobile-no-js.png"), fullPage: true });
    } finally {
      await context.close();
      await restoreHomepageSnapshot(original);
    }
  });

  test("responsive modules match public breakpoints and the selected mobile editing canvas", async ({ page }, testInfo) => {
    const original = await getDraft();
    let fixtureCategoryId: string | undefined;
    try {
      const fixtureCategory = await adminPost<{ id: string }>("/admin/categories", {
        name: "Living room", slug: unique("responsive-category"), imageUrl: MEDIA_URL, status: "ACTIVE",
      });
      fixtureCategoryId = fixtureCategory.id;
      const products = await adminGet<{ items: { id: string; slug: string }[] }>("/admin/products?status=ACTIVE&pageSize=100");
      const sellable = products.items.find((product) => product.slug === "e2e-color-only");
      if (!sellable) throw new Error("responsive fixture requires the seeded sellable color-only product");
      const category = defaultSection("CATEGORY_TILES", randomUUID(), 0);
      category.title = "Shop your room";
      category.payload = { categoryIds: [fixtureCategoryId], layout: { columns: 5, gap: 12,
        overrides: { tablet: { columns: 3, gap: 20 }, mobile: { columns: 1, gap: 8, imageRatio: "PORTRAIT" } } } };
      category.style = { paddingTop: 20, overrides: { tablet: { paddingTop: 8 }, mobile: { paddingTop: 0 } } };
      const grid = defaultSection("PRODUCT_GRID", randomUUID(), 10);
      grid.title = "Made for your space";
      grid.products = [{ productId: sellable.id, sortOrder: 0, badge: null }];
      grid.payload = { columns: 2, layout: { gap: 8, overrides: { mobile: { columns: 1, gap: 6 } } } };
      grid.style = { paddingTop: 24 };
      const story = defaultSection("PRODUCT_STORY", randomUUID(), 20);
      story.payload = { heading: "Make everyday living calmer", body: "Thoughtful furniture, made for smaller homes.", imageUrl: MEDIA_URL,
        layout: { gap: 24, imageRatio: "LANDSCAPE", overrides: { mobile: { gap: 12, imageRatio: "PORTRAIT" } } } };
      const snapshot = await getDraft();
      snapshot.draft.sections = [category, grid, story];
      snapshot.draft.defaults = { paddingTop: 30, paddingBottom: 40, overrides: { mobile: { paddingTop: 0, paddingBottom: 12 } } };
      await putDraft(snapshot);
      const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
      const read = async (title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).evaluate((node) => {
        const root = getComputedStyle(node);
        const grid = getComputedStyle(node.querySelector(".grid")!);
        const image = node.querySelector<HTMLElement>('a.group, img');
        return { columns: grid.gridTemplateColumns.split(" ").length, gap: Number.parseFloat(grid.gap),
          ratio: image ? getComputedStyle(image).aspectRatio : "", paddingTop: Number.parseFloat(root.paddingTop), paddingBottom: Number.parseFloat(root.paddingBottom) };
      });
      for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
        const mobile = viewport.width < 768;
        await page.setViewportSize(viewport);
        await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
        await expect(page.getByRole("heading", { name: "Shop your room", exact: true })).toBeVisible();
        expect(await read("Shop your room")).toEqual({ columns: mobile ? 1 : viewport.width < 1024 ? 3 : 5,
          gap: mobile ? 8 : viewport.width < 1024 ? 20 : 12, ratio: mobile ? "3 / 4" : "1 / 1",
          paddingTop: mobile ? 0 : viewport.width < 1024 ? 8 : 20, paddingBottom: mobile ? 12 : 40 });
        const product = await read("Made for your space");
        expect(product.columns).toBe(mobile ? 1 : 2);
        expect(product.gap).toBe(mobile ? 6 : 8);
        expect(product.paddingTop).toBe(24);
        const feature = await read("Make everyday living calmer");
        expect(feature.columns).toBe(mobile ? 1 : 2);
        expect(feature.gap).toBe(mobile ? 12 : 24);
        expect(feature.ratio).toBe(mobile ? "3 / 4" : "4 / 3");
        expect(feature.paddingTop).toBe(mobile ? 0 : 30);
        await assertNoPageOverflow(page, `responsive modules ${viewport.width}`);
        if (viewport.width === 375) await page.screenshot({ path: testInfo.outputPath("responsive-modules-mobile.png"), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openBuilder(page);
      const previewTab = page.getByRole("tab", { name: zh.livePreview });
      if (await previewTab.isVisible()) await previewTab.click();
      await page.getByRole("button", { name: zh.deviceMobile, exact: true }).click();
      const preview = page.locator("[data-homepage-live-preview]");
      const inline = preview.locator(`[data-preview-section-id="${category.id}"] section`);
      await expect(inline).toBeVisible();
      expect(await inline.evaluate((node) => {
        const grid = getComputedStyle(node.querySelector(".grid")!);
        return { columns: grid.gridTemplateColumns.split(" ").length, gap: grid.gap, padding: getComputedStyle(node).paddingTop };
      })).toEqual({ columns: 1, gap: "8px", padding: "0px" });
    } finally {
      await restoreHomepageSnapshot(original);
      if (fixtureCategoryId) await withAdmin(async (token, context) => {
        const response = await context.delete(`${API}/admin/categories/${fixtureCategoryId}`, { headers: { Authorization: `Bearer ${token}` } });
        expect(response.ok(), "remove owned responsive category fixture").toBe(true);
      });
    }
  });

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

    const headingSettings = await selectHeroElement(page, "heading");
    const textarea = headingSettings.getByLabel(zh.headingText);
    await textarea.waitFor({ state: "visible" });
    const live = unique("E2E LIVE PREVIEW");
    await textarea.fill(live);

    // The 300 ms typing-burst commit updates the canvas BEFORE the 3 s
    // autosave can PUT anything.
    await expect
      .poll(() => page.locator('div[data-hero-element="heading"]').textContent())
      .toContain(live);
    expect(draftPuts, "no draft save before the live preview updated").toHaveLength(0);

    // Let the autosave settle so later scenarios start from a clean saved state.
    await expect(page.getByText(zh.saved)).toBeVisible({ timeout: 6000 });
  });

  test("drags a hero element and persists the percentage after Save Draft", async ({ page }) => {
    await savePublishableDraft(unique("E2E DRAG SEED"));
    // Reset before moving right so repeated suite runs cannot pin xPct at 100.
    await seedHeroHeadingXPct(40);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    await revealPreviewPane(page, 1440);

    const startX = (await draftHeroSnapshotHeadingLayout()).xPct;
    await selectHeroElement(page, "heading");
    await expect(page.locator("[data-hero-settings-context]")).toContainText("主标题");
    await expect(page.locator("[data-hero-settings-context]")).toContainText("桌面端");

    const stage = page.locator("[data-hero-stage]");
    const rect = await stage.boundingBox();
    expect(rect).not.toBeNull();

    const heading = page.locator('div[data-hero-element="heading"]');
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

    const positionSettings = page.locator('[data-pane="settings"] fieldset[data-hero-element="heading"]');
    await positionSettings.locator("details > summary").click();
    const xInput = positionSettings.getByLabel(zh.xPct);
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
    const headingSettings = await selectHeroElement(page, "heading");
    await headingSettings.locator("details > summary").click();
    const persistedInput = headingSettings.getByLabel(zh.xPct);
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
    await expect(page.locator('div[data-hero-element="heading"]')).toContainText(base);
  });

  test("draft preview shows unpublished changes in the complete inert shell and fires zero customer or tracking requests", async ({ page }) => {
    const draftHeading = unique("E2E PREVIEW DRAFT");
    await savePublishableDraft(draftHeading);
    const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");

    const state = collectConsoleIssues(page);
    const tracked: string[] = [];
    const customerState: string[] = [];
    page.on("request", (request) => {
      if (isTrackingRequest(request)) tracked.push(request.url());
      if (isCustomerStateRequest(request)) customerState.push(request.url());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`);
    await expect(page.locator("[data-draft-preview-banner]")).toBeVisible();
    await expect
      .poll(() => page.locator('div[data-hero-element="heading"]').textContent())
      .toContain(draftHeading);

    const shell = page.locator("[data-storefront-preview-shell]");
    await expect(shell).toBeVisible();
    await expect(shell.locator("header")).toBeVisible();
    await expect(shell.locator("footer")).toBeVisible();
    await expect(shell.locator("[data-preview-cart-drawer='closed']")).toBeAttached();
    await expect(shell.locator("[data-preview-messenger]")).toBeVisible();
    await expect(shell.locator("[data-preview-back-to-top]")).toBeVisible();
    await assertPreviewInert(shell);

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 1024 });
      await assertNoPageOverflow(page, `token preview @ ${width}`);
      const mobileTabs = shell.locator("[data-preview-mobile-tab-bar]");
      if (width === 375) await expect(mobileTabs).toBeVisible();
      else await expect(mobileTabs).toBeHidden();
    }

    const html = await page.content();
    expect(html).not.toContain("connect.facebook.net");
    expect(html).not.toContain("fbevents");

    const issues = state();
    expect(issues.errors, "preview page console errors").toHaveLength(0);
    expect(issues.pageErrors, "preview page pageerrors").toHaveLength(0);
    expect(tracked, "preview fires zero tracking requests").toHaveLength(0);
    expect(customerState, "preview fires zero customer-state requests").toHaveLength(0);
  });

  test("edits, sanitizes, saves, previews, publishes, expires, and restores a rich announcement", async ({ page }) => {
    const original = await getDraft();
    const richText = unique("E2E RICH ANNOUNCEMENT");
    const itemId = cryptoRandomUuid();

    try {
      await savePublishableDraft(unique("E2E RICH HERO"));
      const prepared = await getDraft();
      prepared.draft.announcement = {
        enabled: true,
        rotationMs: 5000,
        items: [
          {
            id: itemId,
            text: "Legacy announcement",
            link: null,
            linkLabel: null,
            textColor: "#292724",
            backgroundColor: "#F2EFE9",
            schedule: { publishAt: null, unpublishAt: null },
            countdown: null,
            enabled: true,
            sortOrder: 0,
          },
        ],
      };
      await putDraft(prepared);

      await page.setViewportSize({ width: 1440, height: 900 });
      await openBuilder(page);
      await page.locator("[data-announcement-node]").click();

      const card = page.locator(`li[data-item-id="${itemId}"]`).first();
      await expect(card).toBeVisible();
      const editor = card.getByRole("textbox", { name: zh.announcementRichText });
      await expect(editor).toBeVisible();
      await editor.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await editor.evaluate(
        (element, payload) => {
          const transfer = new DataTransfer();
          transfer.setData("text/plain", payload.plain);
          transfer.setData("text/html", payload.html);
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            }),
          );
        },
        {
          plain: richText,
          html: `<a href="javascript:alert(1)"><script>alert(1)</script>${richText}</a>`,
        },
      );
      await expect(editor).toHaveText(richText);
      await expect(editor.locator("a, script")).toHaveCount(0);

      await editor.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await card.getByRole("button", { name: zh.announcementBold }).click();
      await card.getByRole("button", { name: zh.announcementAlignRight }).click();
      await card.getByLabel(zh.announcementCountdownEnable).check();
      await card
        .getByLabel(zh.announcementCountdownDeadline)
        .fill(localDatetimeInput(new Date(Date.now() + 10 * 60_000)));

      await page.waitForTimeout(350);
      await page.getByRole("button", { name: zh.saveDraft }).click();
      await expect
        .poll(async () => {
          const current = await getDraft();
          return current.draft.announcement.items.find((item) => item.id === itemId)
            ?.text ?? null;
        })
        .toBe(richText);

      const persisted = await getDraft();
      const persistedItem = persisted.draft.announcement.items.find(
        (item) => item.id === itemId,
      );
      if (!persistedItem?.content || !persistedItem.countdown?.endsAt) {
        throw new Error("rich announcement or countdown did not persist");
      }
      expect(persistedItem.content.doc.content[0]?.attrs.textAlign).toBe("right");
      expect(
        persistedItem.content.doc.content.some((paragraph) =>
          paragraph.content.some((node) =>
            node.marks?.some((mark) => mark.type === "bold"),
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(persistedItem.content)).not.toMatch(
        /javascript:|<script|href/i,
      );

      await navigateAdmin(page, "/admin/homepage");
      await page.locator("[data-announcement-node]").click();
      const reloadedCard = page.locator(`li[data-item-id="${itemId}"]`).first();
      const reloadedEditor = reloadedCard.getByRole("textbox", {
        name: zh.announcementRichText,
      });
      await expect(reloadedEditor).toHaveText(richText);
      await expect(reloadedEditor.locator("strong")).toContainText(richText);

      const embeddedShell = page.locator(
        '[data-pane="preview"] [data-storefront-preview-shell]',
      );
      await expect(embeddedShell.locator("header")).toBeVisible();
      await expect(embeddedShell.locator("footer")).toBeVisible();
      await expect(
        embeddedShell.locator("[data-announcement-bar] strong"),
      ).toContainText(richText);
      await expect(embeddedShell.locator("[data-announcement-bar]").getByRole("timer")).toBeVisible();
      await assertPreviewInert(embeddedShell);

      const deviceSwitch = page.getByRole("group", {
        name: "预览设备",
      });
      for (const [label, device, mobile] of [
        [zh.deviceDesktop, "desktop", false],
        [zh.deviceTablet, "tablet", false],
        [zh.deviceMobile, "mobile", true],
      ] as const) {
        await deviceSwitch.getByRole("button", { name: label }).click();
        await expect(embeddedShell).toHaveAttribute("data-device", device);
        const mobileTabs = embeddedShell.locator("[data-preview-mobile-tab-bar]");
        if (mobile) await expect(mobileTabs).toBeVisible();
        else await expect(mobileTabs).toHaveCount(0);
      }

      const { token } = await adminPost<{ token: string }>(
        "/admin/homepage/preview-token",
      );
      const previewState = collectConsoleIssues(page);
      const tracked: string[] = [];
      const customerState: string[] = [];
      page.on("request", (request) => {
        if (isTrackingRequest(request)) tracked.push(request.url());
        if (isCustomerStateRequest(request)) customerState.push(request.url());
      });
      await page.goto(
        `${FRONTEND}/preview/homepage?token=${encodeURIComponent(token)}`,
      );
      const tokenShell = page.locator("[data-storefront-preview-shell]");
      await expect(tokenShell.locator("header")).toBeVisible();
      await expect(tokenShell.locator("footer")).toBeVisible();
      await expect(
        tokenShell.locator("[data-announcement-bar] strong"),
      ).toContainText(richText);
      await expect(tokenShell.getByRole("timer")).toBeVisible();
      await assertPreviewInert(tokenShell);
      const tokenIssues = previewState();
      expect(tokenIssues.errors, "rich token preview console errors").toHaveLength(0);
      expect(tokenIssues.pageErrors, "rich token preview pageerrors").toHaveLength(0);
      expect(tracked, "rich token preview tracking requests").toHaveLength(0);
      expect(customerState, "rich token preview customer-state requests").toHaveLength(0);

      const expiring = await getDraft();
      const expiringItem = expiring.draft.announcement.items.find(
        (item) => item.id === itemId,
      );
      if (!expiringItem?.countdown) {
        throw new Error("countdown disappeared before publish");
      }
      expiringItem.countdown.endsAt = new Date(Date.now() + 25_000).toISOString();
      await putDraft(expiring);
      const published = await adminPost<{ versionNo: number }>(
        "/admin/homepage/publish",
        {
          note: "live rich announcement",
          publishAt: null,
          unpublishAt: null,
          confirmWarnings: true,
        },
      );
      expect(published.versionNo).toBeGreaterThan(0);

      await expect
        .poll(async () => {
          const context = await playwrightRequest.newContext();
          try {
            const response = await context.get(`${API}/storefront/announcement`);
            const body = await response.text();
            if (!response.ok() || body.trim() === "" || body === "null") return null;
            const announcement = JSON.parse(body) as {
              items?: { id: string; text: string }[];
            };
            return announcement.items?.find((item) => item.id === itemId)?.text ?? null;
          } finally {
            await context.dispose();
          }
        })
        .toBe(richText);

      await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await waitForStorefrontHtml(richText);
      await page.goto(`${FRONTEND}/`);
      const liveBar = page.locator("[data-announcement-bar]");
      await expect(liveBar.locator("strong")).toContainText(richText, {
        timeout: 15_000,
      });
      await expect(liveBar.getByRole("timer")).toBeVisible();
      await expect(liveBar).toBeHidden({ timeout: 35_000 });

      const changed = await getDraft();
      const changedItem = changed.draft.announcement.items.find(
        (item) => item.id === itemId,
      );
      if (!changedItem) throw new Error("announcement missing before restore");
      changedItem.text = "Changed after publish";
      delete changedItem.content;
      changedItem.countdown = null;
      await putDraft(changed);

      const version = (
        await adminGet<{ id: string; note: string | null }[]>(
          "/admin/homepage/versions",
        )
      ).find((entry) => entry.note === "live rich announcement");
      expect(version, "rich announcement version listed").toBeTruthy();
      await adminPost(`/admin/homepage/versions/${version!.id}/restore`);
      const restored = await getDraft();
      const restoredItem = restored.draft.announcement.items.find(
        (item) => item.id === itemId,
      );
      expect(restoredItem?.text).toBe(richText);
      expect(restoredItem?.content).toEqual(persistedItem.content);
      expect(restoredItem?.countdown?.endsAt).toBeTruthy();
    } finally {
      await restoreHomepageSnapshot(original);
    }
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

    // Tampered and expired tokens fail closed with the same 404; neither may
    // render the draft or silently substitute the live document under a draft
    // preview banner.
    const { token } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
    const tampered = await page.goto(
      `${FRONTEND}/preview/homepage?token=${encodeURIComponent("z" + token.slice(1))}`,
    );
    expect(tampered?.status(), "tampered token → 404").toBe(404);
    expect(await page.content(), "tampered token must not leak draft content").not.toContain(
      draftHeading,
    );

    const expired = signToken({ exp: Date.now() - 1000 });
    const expiredResponse = await page.goto(
      `${FRONTEND}/preview/homepage?token=${encodeURIComponent(expired)}`,
    );
    expect(expiredResponse?.status(), "expired token → 404").toBe(404);
    expect(await page.content(), "expired token must not leak draft content").not.toContain(
      draftHeading,
    );

    // Control: the same secret-bound token DOES render the draft (proves the
    // assertions above are discriminating, not vacuous).
    const { token: fresh } = await adminPost<{ token: string }>("/admin/homepage/preview-token");
    await page.goto(`${FRONTEND}/preview/homepage?token=${encodeURIComponent(fresh)}`);
    await expect
      .poll(() => page.locator('div[data-hero-element="heading"]').textContent())
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
      await assertNoOuterAdminScroll(page, `builder @ ${width}`);
      const builderIssues = builderState();
      expect(builderIssues.errors, `builder console errors @ ${width}`).toHaveLength(0);
      expect(builderIssues.pageErrors, `builder pageerrors @ ${width}`).toHaveLength(0);
    }
  });

  test("adds, edits, duplicates, reorders, deletes, restores, and reloads banners", async ({ page }) => {
    const original = await getDraft();
    const promoTitle = unique("E2E UI PROMO");
    const countdownTitle = unique("E2E UI COUNTDOWN");
    try {
      await openAdmin(page, "/admin/homepage");
      await expect(page.getByRole("button", { name: zh.saveDraft })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: zh.addSection }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: zh.promoBanner })).toBeVisible();
      await expect(dialog.getByRole("button", { name: zh.countdownBanner })).toBeVisible();
      await expect(dialog.locator("[data-section-type]")).toHaveCount(11);
      await dialog.getByRole("button", { name: zh.promoBanner }).click();

      await expect(
        page.locator('[data-section-content-editor="PROMO_BANNER"]'),
      ).toBeVisible();
      await page.getByRole("textbox", { name: zh.sectionTitle }).fill(promoTitle);
      await page.getByRole("textbox", { name: zh.bannerCtaText }).fill("Shop now");

      const promoRows = page.locator("[data-section-row]").filter({ hasText: promoTitle });
      await expect(promoRows).toHaveCount(1);
      await promoRows.first().getByRole("button", { name: zh.sectionDuplicate }).click();
      await expect(promoRows).toHaveCount(2);

      const originalId = await promoRows.first().getAttribute("data-section-row");
      const duplicateId = await promoRows.nth(1).getAttribute("data-section-row");
      expect(originalId).not.toBeNull();
      expect(duplicateId).not.toBeNull();
      const originalRow = page.locator(`[data-section-row="${originalId}"]`);
      const duplicateRow = page.locator(`[data-section-row="${duplicateId}"]`);

      await duplicateRow.getByRole("button", { name: zh.sectionDelete }).click();
      await expect(promoRows).toHaveCount(1);
      await page.getByRole("button", { name: zh.sectionUndoDelete }).click();
      await expect(promoRows).toHaveCount(2);

      await page.getByRole("button", { name: zh.addSection }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: zh.countdownBanner })
        .click();
      await expect(
        page.locator('[data-section-content-editor="COUNTDOWN_BANNER"]'),
      ).toBeVisible();
      await page.getByRole("textbox", { name: zh.sectionTitle }).fill(countdownTitle);
      await page.getByLabel(zh.bannerEndsAt).fill("2099-12-31T23:59");

      const targetIndex = await originalRow.evaluate((row) =>
        Array.from(row.parentElement?.children ?? []).indexOf(row),
      );
      const dragHandle = duplicateRow.getByRole("button", { name: zh.sectionDrag });
      const sourceBox = await dragHandle.boundingBox();
      const targetBox = await originalRow.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(targetBox).not.toBeNull();
      await page.mouse.move(
        sourceBox!.x + sourceBox!.width / 2,
        sourceBox!.y + sourceBox!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(sourceBox!.x + 8, sourceBox!.y - 8, { steps: 4 });
      await page.mouse.move(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height / 2,
        { steps: 12 },
      );
      await page.mouse.up();
      await expect.poll(async () =>
        duplicateRow.evaluate((row) =>
          Array.from(row.parentElement?.children ?? []).indexOf(row),
        ),
      ).toBe(targetIndex);

      await page.keyboard.press("Control+s");
      await expect(page.getByText(zh.saved)).toBeVisible({ timeout: 6000 });
      await navigateAdmin(page, "/admin/homepage");
      await expect(
        page.locator("[data-section-row]").filter({ hasText: promoTitle }),
      ).toHaveCount(2);
      await expect(
        page.locator("[data-section-row]").filter({ hasText: countdownTitle }),
      ).toHaveCount(1);
    } finally {
      if (!page.isClosed()) await page.close();
      await restoreHomepageSnapshot(original);
    }
  });

  test("countdown banner blocks an expired publish, then renders and expires on the storefront", async ({ page }) => {
    const heading = unique("E2E BANNER HERO");
    const promoTitle = unique("E2E PROMO");
    const countdownTitle = unique("E2E COUNTDOWN");
    const original = await getDraft();

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

      // Leave enough time for a cold next-dev compile with retries disabled.
      const live = await getDraft();
      const countdown = live.draft.sections.find(
        (section) => section.type === "COUNTDOWN_BANNER",
      );
      if (!countdown) throw new Error("draft is missing the countdown banner");
      countdown.payload.endsAt = new Date(Date.now() + 30_000).toISOString();
      await withAdmin(async (token, context) => {
        const response = await context.put(`${API}/admin/homepage/draft`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          data: { draft: live.draft, expectedRev: live.draftRev },
        });
        expect(response.ok(), `PUT draft (${response.status()}): ${await response.text()}`).toBeTruthy();
      });
      await adminPost("/admin/homepage/publish", {
        note: "live countdown",
        publishAt: null,
        unpublishAt: null,
        confirmWarnings: true,
      });
      await pollValue(async () => {
        const storefront = await adminGet<{ sections: { type: string }[] }>("/storefront/homepage");
        return storefront.sections.some((section) => section.type === "COUNTDOWN_BANNER")
          ? true
          : null;
      }, "storefront serves the countdown banner");

      // Scope the timer so a future Hero countdown cannot make it ambiguous.
      await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
      await waitForStorefrontHtml(promoTitle);
      await page.goto(`${FRONTEND}/`);
      await expect(page.getByText(promoTitle)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(countdownTitle)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();

      // Verify live banners at all supported preview widths.
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 375 ? 800 : 1024 });
        const state = collectConsoleIssues(page);
        await page.goto(`${FRONTEND}/`);
        await expect(page.getByText(promoTitle)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(countdownTitle)).toBeVisible({ timeout: 15_000 });
        await assertNoPageOverflow(page, `banner storefront @ ${width}`);
        const issues = state();
        expect(issues.errors, `banner console errors @ ${width}`).toHaveLength(0);
        expect(issues.pageErrors, `banner pageerrors @ ${width}`).toHaveLength(0);
      }

      // At the deadline the countdown removes itself entirely, without a reload;
      // the promo banner stays.
      await expect(page.getByText(countdownTitle)).toBeHidden({ timeout: 35_000 });
      await expect(page.getByRole("timer", { name: "Time left" })).toHaveCount(0);
      await expect(page.getByText(promoTitle)).toBeVisible();
    } finally {
      await restoreHomepageSnapshot(original);
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

async function seedHeroHeadingXPct(xPct: number): Promise<void> {
  const snapshot = await getDraft();
  const hero = snapshot.draft.sections.find((section) => section.type === "HERO");
  const layout = hero?.payload?.slides?.[0]?.elements?.heading?.layout;
  if (!layout) throw new Error("draft has no hero heading layout to seed");
  layout.xPct = xPct;
  await withAdmin(async (token, context) => {
    const response = await context.put(`${API}/admin/homepage/draft`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { draft: snapshot.draft, expectedRev: snapshot.draftRev },
    });
    expect(response.ok(), `seed heading xPct (${response.status()}): ${await response.text()}`).toBeTruthy();
  });
}